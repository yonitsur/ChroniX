import asyncio
import io
import wave
from types import SimpleNamespace

import pytest

from models import PodcastSegment, PodcastTurn, TimelineArticle
from services import podcast_audio, podcast_store, podcast_tts_service as tts, quota_service
from services.gemini_service import (
    PODCAST_FOCUSED_MAX_EVENTS,
    PODCAST_FULL_MAX_EVENTS,
    PODCAST_MUSIC_MOODS,
    clean_podcast_segments,
    default_host_names,
    get_podcast_max_events,
    normalize_music_mood,
    select_podcast_events,
)
from services.podcast_tts_service import (
    SynthesisResult,
    _extract_gemini_audio,
    _pcm_to_wav_bytes,
    available_engines,
    clean_text_for_tts,
    concat_mp3,
    default_engine_for_language,
    detect_effective_language,
    estimate_sentences,
    get_edge_voice,
    mp3_duration_seconds,
    pcm_to_mp3,
    proportional_turn_starts,
    silence_pcm,
    synthesize_segment,
    wav_to_pcm,
)


@pytest.fixture(autouse=True)
def local_podcast_store(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_TTS_HE_MALE_VOICE", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_TTS_HE_FEMALE_VOICE", raising=False)
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "daily_usage.json")
    podcast_store.clip_cache.clear()


def _article(aid, title, year, rank=5):
    return TimelineArticle(id=aid, title=title, **{"from": {"year": year}}, rank=rank)


def _fake_result(engine="edge", seconds=1.0):
    audio = pcm_to_mp3(silence_pcm(seconds))
    return SynthesisResult(audio=audio, duration=mp3_duration_seconds(audio), engine=engine, turn_starts=[0.0], voice="fake")


# --- Text & voices ---------------------------------------------------------------------------

def test_clean_text_for_tts_strips_markdown_and_stage_directions():
    raw = "**ברוכים הבאים** ל-*ChroniX*! [מוזיקת פתיחה] כאן נדבר על `היסטוריה` [link](https://example.com)."
    cleaned = clean_text_for_tts(raw)
    for token in ("**", "*", "`", "[מוזיקת פתיחה]", "https://example.com"):
        assert token not in cleaned
    assert "ברוכים הבאים" in cleaned and "ChroniX" in cleaned and "link" in cleaned


def test_detect_effective_language_and_edge_voices():
    assert detect_effective_language("שלום עולם", "en") == "he"
    assert detect_effective_language("Hello world", "en") == "en"
    assert detect_effective_language("Hello world", "he") == "he"
    assert get_edge_voice("he", "male") == "he-IL-AvriNeural"
    assert get_edge_voice("he", "female") == "he-IL-HilaNeural"
    assert get_edge_voice("xx", "female") == "en-US-AvaMultilingualNeural"


def test_available_engines_respects_gcloud_config(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_TTS_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_TTS_API_KEY", raising=False)
    monkeypatch.delenv("GCLOUD_API_KEY", raising=False)
    engines = {e["id"]: e for e in available_engines("en")}
    assert set(engines) == {"edge", "gcloud", "gemini"}
    assert engines["edge"]["available"] and engines["gemini"]["requires_quota"]
    assert engines["gcloud"]["available"] is False and engines["gcloud"]["reason"] == "unconfigured"

    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "gcloud-key")
    en_engines = {e["id"]: e for e in available_engines("en")}
    assert en_engines["gcloud"]["available"] is True and en_engines["gcloud"]["reason"] is None
    assert default_engine_for_language("en") == "edge"

    he_engines = {e["id"]: e for e in available_engines("he")}
    assert he_engines["gcloud"]["available"] is True
    assert default_engine_for_language("he") == "gcloud"

    monkeypatch.setenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", "0")
    capped_engines = {e["id"]: e for e in available_engines("he")}
    assert capped_engines["gcloud"]["available"] is False and capped_engines["gcloud"]["reason"] == "quota_exhausted"
    assert default_engine_for_language("he") == "edge"


# --- Audio encoding --------------------------------------------------------------------------

def test_pcm_to_mp3_matches_edge_format_and_duration():
    mp3 = pcm_to_mp3(silence_pcm(2.0))
    assert mp3[:2] == b"\xff\xf3"  # MPEG-2 Layer III, same frame header family as Edge's 24 kHz output
    assert abs(mp3_duration_seconds(mp3) - 2.0) < 0.15


def test_concat_mp3_durations_add_up_and_id3_is_skipped():
    a, b = pcm_to_mp3(silence_pcm(1.0)), pcm_to_mp3(silence_pcm(1.5))
    joined = concat_mp3([a, b])
    assert abs(mp3_duration_seconds(joined) - (mp3_duration_seconds(a) + mp3_duration_seconds(b))) < 0.01
    tagged = podcast_audio.build_id3_tag("כותרת") + joined
    assert tagged[:3] == b"ID3"
    assert abs(mp3_duration_seconds(tagged) - mp3_duration_seconds(joined)) < 0.01


def test_wav_round_trip_and_gemini_audio_extraction():
    raw_pcm = b"\x00\x01" * 100
    wav_bytes = _pcm_to_wav_bytes(raw_pcm, sample_rate=24000)
    pcm, rate, channels = wav_to_pcm(wav_bytes)
    assert (pcm, rate, channels) == (raw_pcm, 24000, 1)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        assert wf.getnframes() == 100

    part = SimpleNamespace(inline_data=SimpleNamespace(data=raw_pcm, mime_type="audio/L16;codec=pcm;rate=24000"))
    resp = SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])
    out_bytes, mime = _extract_gemini_audio(resp)
    assert mime == "audio/wav" and out_bytes[:4] == b"RIFF"


def test_sentence_and_turn_timing_estimates():
    sentences = estimate_sentences("Short one. A much longer second sentence here.", 1.0, 5.0, 2)
    assert len(sentences) == 2
    assert sentences[0]["start"] == 1.0 and abs(sentences[-1]["end"] - 5.0) < 0.01
    assert sentences[0]["end"] - sentences[0]["start"] < sentences[1]["end"] - sentences[1]["start"]
    assert all(s["turn"] == 2 for s in sentences)
    starts = proportional_turn_starts([PodcastTurn(text="aaaa"), PodcastTurn(text="aaaa")], 10.0)
    assert starts == [0.0, 5.0]


# --- Provider fallback -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_synthesize_segment_falls_back_to_edge_and_records_it(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    async def fake_edge(*args, **kwargs):
        return _fake_result("edge")

    monkeypatch.setattr(tts.PROVIDERS["gemini"], "synthesize", boom)
    monkeypatch.setattr(tts.PROVIDERS["edge"], "synthesize", fake_edge)
    result = await synthesize_segment("gemini", [PodcastTurn(text="Hello there.")], language="en")
    assert result.engine == "edge" and result.fallback_from == "gemini"

    with pytest.raises(RuntimeError):
        await synthesize_segment("gemini", [PodcastTurn(text="Hello")], language="en", allow_fallback=False)


@pytest.mark.asyncio
async def test_edge_retries_transient_failures(monkeypatch):
    provider = tts.EdgeProvider()
    calls = {"n": 0}
    audio = pcm_to_mp3(silence_pcm(0.5))

    async def flaky(text, voice):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("No audio was received")
        return audio, [{"start": 0.0, "end": 0.4, "text": text}]

    monkeypatch.setattr(provider, "_synthesize_turn_once", flaky)
    monkeypatch.setattr(provider, "retry_delay", 0.0)
    result = await provider.synthesize([PodcastTurn(text="Hello there.")], language="en")
    assert calls["n"] == 2 and result.engine == "edge" and result.sentences[0]["text"] == "Hello there."


@pytest.mark.asyncio
async def test_gcloud_provider_uses_google_cloud_tts_and_edge_provider_stays_direct(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "gcloud-test-key")
    tts._gcloud_tts_disabled_until.clear()
    wav = _pcm_to_wav_bytes(silence_pcm(1.0))
    b64_wav = __import__("base64").b64encode(wav).decode("ascii")
    seen = []

    async def fake_post(self, url, headers=None, json=None, timeout=None):
        seen.append((url, headers, json))
        return SimpleNamespace(
            status_code=200,
            raise_for_status=lambda: None,
            json=lambda: {"audioContent": b64_wav},
        )

    monkeypatch.setattr(tts.httpx.AsyncClient, "post", fake_post)
    provider = tts.GoogleCloudProvider()
    result = await provider.synthesize(
        [
            PodcastTurn(speaker="host1", text="ברוכים הבאים לכרוניקס. בואו נצא למסע."),
            PodcastTurn(speaker="host2", text="נכון מאוד!"),
        ],
        format_mode="duo",
        voice_gender="male",
        language="he",
    )
    assert len(seen) == 2
    assert seen[0][1] == {"X-Goog-Api-Key": "gcloud-test-key"}
    assert seen[0][2]["voice"] == {"languageCode": "he-IL", "name": "he-IL-Wavenet-D"}
    assert seen[1][2]["voice"] == {"languageCode": "he-IL", "name": "he-IL-Wavenet-A"}
    assert result.engine == "gcloud"
    assert abs(result.duration - 2.0) < 0.25
    assert [s["text"] for s in result.sentences] == [
        "ברוכים הבאים לכרוניקס.",
        "בואו נצא למסע.",
        "נכון מאוד!",
    ]


@pytest.mark.asyncio
async def test_google_cloud_tts_403_cools_down_and_falls_back_to_edge(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "disabled-key")
    tts._gcloud_tts_disabled_until.clear()
    gcloud_calls = {"n": 0}

    async def fake_post(self, url, headers=None, json=None, timeout=None):
        gcloud_calls["n"] += 1
        return SimpleNamespace(status_code=403, text="SERVICE_DISABLED")

    class FakeCommunicate:
        def __init__(self, text, voice, **kwargs):
            self.text = text

        async def stream(self):
            yield {"type": "audio", "data": pcm_to_mp3(silence_pcm(0.5))}
            yield {"type": "SentenceBoundary", "offset": 0, "duration": int(0.5 * 1e7), "text": self.text}

    monkeypatch.setattr(tts.httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(tts.edge_tts, "Communicate", FakeCommunicate)
    result = await synthesize_segment(
        "gcloud",
        [PodcastTurn(speaker="host1", text="משפט ראשון.")],
        language="he",
    )
    assert gcloud_calls["n"] == 1
    assert result.engine == "edge" and result.fallback_from == "gcloud"
    assert result.duration > 0.4
    # Subsequent turns while key is in cooldown skip Google Cloud TTS completely
    result2 = await synthesize_segment(
        "gcloud",
        [PodcastTurn(speaker="host1", text="משפט שני.")],
        language="he",
    )
    assert gcloud_calls["n"] == 1
    assert result2.engine == "edge" and result2.fallback_from == "gcloud"
    assert result2.duration > 0.4
    # Failed 403 call refunded its reserved characters
    assert quota_service.get_google_cloud_tts_monthly_usage() == 0


@pytest.mark.asyncio
async def test_google_cloud_tts_monthly_char_cap_falls_back_to_edge(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "gcloud-cap-key")
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", "15")
    tts._gcloud_tts_disabled_until.clear()
    wav = _pcm_to_wav_bytes(silence_pcm(0.5))
    b64_wav = __import__("base64").b64encode(wav).decode("ascii")
    gcloud_texts = []
    edge_texts = []

    async def fake_post(self, url, headers=None, json=None, timeout=None):
        gcloud_texts.append(json["input"]["text"])
        return SimpleNamespace(
            status_code=200,
            raise_for_status=lambda: None,
            json=lambda: {"audioContent": b64_wav},
        )

    class FakeCommunicate:
        def __init__(self, text, voice, **kwargs):
            self.text = text
            edge_texts.append(text)

        async def stream(self):
            yield {"type": "audio", "data": pcm_to_mp3(silence_pcm(0.5))}
            yield {"type": "SentenceBoundary", "offset": 0, "duration": int(0.5 * 1e7), "text": self.text}

    monkeypatch.setattr(tts.httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(tts.edge_tts, "Communicate", FakeCommunicate)

    # Turn 1 is 10 chars (<= 15 limit -> uses Google Cloud TTS)
    r1 = await synthesize_segment("gcloud", [PodcastTurn(speaker="host1", text="שלום עולם!")], language="he")
    assert r1.engine == "gcloud" and r1.fallback_from is None
    assert gcloud_texts == ["שלום עולם!"] and edge_texts == []
    assert quota_service.get_google_cloud_tts_monthly_usage() == 10

    # Turn 2 is 10 chars (10 + 10 = 20 > 15 limit -> blocked before calling Google Cloud, falls back to edge-tts)
    r2 = await synthesize_segment("gcloud", [PodcastTurn(speaker="host1", text="עוד משפט!!")], language="he")
    assert r2.engine == "edge" and r2.fallback_from == "gcloud"
    assert gcloud_texts == ["שלום עולם!"]
    assert edge_texts == ["עוד משפט!!"]
    assert quota_service.get_google_cloud_tts_monthly_usage() == 10


@pytest.mark.asyncio
async def test_unconfigured_gcloud_falls_back_without_calling_gcloud(monkeypatch):
    called = {"gcloud": 0}

    async def fake_gcloud(*args, **kwargs):
        called["gcloud"] += 1
        return _fake_result("gcloud")

    async def fake_edge(*args, **kwargs):
        return _fake_result("edge")

    monkeypatch.delenv("GOOGLE_CLOUD_TTS_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_TTS_API_KEY", raising=False)
    monkeypatch.delenv("GCLOUD_API_KEY", raising=False)
    monkeypatch.setattr(tts.PROVIDERS["gcloud"], "synthesize", fake_gcloud)
    monkeypatch.setattr(tts.PROVIDERS["edge"], "synthesize", fake_edge)
    result = await synthesize_segment("gcloud", [PodcastTurn(text="שלום לכולם")], language="he")
    assert result.engine == "edge" and result.fallback_from == "gcloud"
    assert called["gcloud"] == 0


# --- Gemini: style must never be part of the spoken transcript -------------------------------

DUO_TURNS = [PodcastTurn(speaker="host1", text="Welcome aboard."), PodcastTurn(speaker="host2", text="Glad to be here.")]


@pytest.mark.parametrize("content_mode", ["classic", "kids", "teens"])
def test_gemini_interaction_request_keeps_style_out_of_spoken_text(content_mode):
    style = tts.gemini_style(content_mode)
    duo = tts.build_gemini_interaction_request(DUO_TURNS, "duo", "female", content_mode)
    content = duo["input"][0]["content"]
    assert [c["text"] for c in content] == ["Welcome aboard.", "Glad to be here."]
    assert [c["annotations"][0]["speaker"] for c in content] == ["Host1", "Host2"]
    assert all(c["annotations"][0] == {"type": "speech_metadata", "speaker": c["annotations"][0]["speaker"], "style": style} for c in content)
    assert {s["speaker"]: s["voice"] for s in duo["generation_config"]["speech_config"]["speakers"]} == {"Host1": "Aoede", "Host2": "Charon"}

    solo = tts.build_gemini_interaction_request([PodcastTurn(text="Hello there.")], "single", "male", content_mode)
    block = solo["input"][0]["content"][0]
    assert block["text"] == "Hello there."
    assert block["annotations"][0]["style"] == style
    assert solo["generation_config"]["speech_config"] == [{"voice": "Charon"}]


def test_gemini_legacy_request_is_transcript_only():
    contents, _ = tts.build_gemini_legacy_request([PodcastTurn(text="Hello there.")], "single", "male")
    assert contents == "Hello there."
    contents, _ = tts.build_gemini_legacy_request(DUO_TURNS, "duo", "male")
    assert contents == "Host1: Welcome aboard.\nHost2: Glad to be here."
    assert tts.uses_interactions_api("gemini-3.8-flash-tts") and not tts.uses_interactions_api("gemini-2.5-flash-preview-tts")


def test_clean_text_strips_angle_bracket_vocal_tags():
    assert clean_text_for_tts("Wait <sigh> what? Five < six.") == "Wait what? Five six."


@pytest.mark.asyncio
async def test_gemini_provider_sends_verbatim_transcript_via_interactions(monkeypatch):
    sent = {}
    wav = _pcm_to_wav_bytes(silence_pcm(1.0))

    class FakeInteractions:
        async def create(self, model, **request):
            sent["model"] = model
            sent["request"] = request
            return SimpleNamespace(
                output_audio=SimpleNamespace(data=__import__("base64").b64encode(wav).decode(), mime_type="audio/wav"),
                usage=SimpleNamespace(total_input_tokens=5, total_output_tokens=25, total_thought_tokens=10),
            )

    fake_client = SimpleNamespace(aio=SimpleNamespace(interactions=FakeInteractions()))
    monkeypatch.setattr(tts, "get_gemini_client", lambda key=None: fake_client)
    monkeypatch.delenv("GEMINI_TTS_MODEL", raising=False)
    result = await tts.PROVIDERS["gemini"].synthesize(DUO_TURNS, format_mode="duo", content_mode="kids")
    assert sent["model"] == "gemini-3.8-flash-tts"
    spoken = [c["text"] for c in sent["request"]["input"][0]["content"]]
    assert spoken == ["Welcome aboard.", "Glad to be here."]
    assert result.engine == "gemini" and abs(result.duration - 1.0) < 0.15 and result.cost_usd > 0
    assert (result.input_tokens, result.output_tokens, result.thinking_tokens) == (5, 25, 10)
    expected_cost = round(5 / 1e6 * 0.50 + 25 / 1e6 * 10.00 + 10 / 1e6 * 0.40, 6)
    assert result.cost_usd == pytest.approx(expected_cost)


# --- Script post-processing --------------------------------------------------------------------

def test_select_podcast_events_keeps_bookends_and_top_ranked_in_order():
    assert PODCAST_FOCUSED_MAX_EVENTS == 12
    assert PODCAST_FULL_MAX_EVENTS == 25
    assert get_podcast_max_events("focused") == 12
    assert get_podcast_max_events("full") == 25

    articles = [_article(f"e{i}", f"Event {i}", 1900 + i, rank=(9 if i in (5, 12) else 3)) for i in range(20)]
    # 'full' mode keeps up to 25 events in chronological order
    all_ordered = select_podcast_events(list(reversed(articles)), "full")
    assert [a.id for a in all_ordered] == [f"e{i}" for i in range(20)]

    # 'focused' mode caps at 12 events while keeping bookends and top-ranked turning points
    focused = select_podcast_events(list(reversed(articles)), "focused")
    focused_ids = [a.id for a in focused]
    assert len(focused_ids) == 12
    assert focused_ids[0] == "e0" and focused_ids[-1] == "e19"
    assert "e5" in focused_ids and "e12" in focused_ids
    assert focused_ids == sorted(focused_ids, key=lambda x: int(x[1:]))

    # On a 100-event timeline where high-rank events cluster early, stratified buckets still span the whole timeline
    hundred = [_article(f"e{i}", f"Event {i}", 1800 + i, rank=(9 if i < 30 else 4)) for i in range(100)]
    full_hundred = select_podcast_events(hundred, "full")
    assert len(full_hundred) == 25
    assert full_hundred[0].id == "e0" and full_hundred[-1].id == "e99"
    assert sum(1 for a in full_hundred if int(a.id[1:]) >= 50) >= 10

    # Custom max_events cap
    chosen = select_podcast_events(list(reversed(articles)), "full", max_events=8)
    ids = [a.id for a in chosen]
    assert len(ids) == 8
    assert ids[0] == "e0" and ids[-1] == "e19"
    assert "e5" in ids and "e12" in ids
    assert ids == sorted(ids, key=lambda x: int(x[1:]))
    assert len(select_podcast_events(articles[:5], "full")) == 5


def test_clean_podcast_segments_repairs_ids_and_sanitizes_turns():
    articles = [_article("evt-1", "Moon Landing", 1969), _article("evt-2", "Fall of the Wall", 1989)]
    raw = [
        PodcastSegment(type="intro", event_id="evt-1", chapter_title="", turns=[PodcastTurn(speaker="host2", text="**Welcome** [music]")]),
        PodcastSegment(type="event", event_id="EVT 1", chapter_title="x", turns=[PodcastTurn(text="One small step.")]),
        PodcastSegment(type="event", event_id="bogus", chapter_title="Fall of the wall", turns=[PodcastTurn(text="Berlin.")]),
        PodcastSegment(type="event", event_id="bogus", chapter_title="Unknown", turns=[PodcastTurn(text="Hmm.")]),
        PodcastSegment(type="event", event_id="evt-2", chapter_title="Empty", turns=[PodcastTurn(text="  [sfx] ")]),
        PodcastSegment(type="outro", chapter_title="", turns=[PodcastTurn(text="Goodbye.")]),
    ]
    out = clean_podcast_segments(raw, articles, "single", "en")
    assert [s.id for s in out] == ["seg-1", "seg-2", "seg-3", "seg-4", "seg-5"]
    assert out[0].event_id is None and out[0].chapter_title == "Introduction"
    assert out[0].turns[0].speaker == "host1" and out[0].turns[0].text == "Welcome"
    assert out[1].event_id == "evt-1"
    assert out[2].event_id == "evt-2"
    assert out[3].event_id is None
    assert out[4].chapter_title == "Conclusion"
    assert default_host_names("he", "female") == ("מאיה", "מיכאל")

    # Hard cap on event segments when max_events is specified
    capped = clean_podcast_segments(raw, articles, "single", "en", max_events=2)
    assert [s.id for s in capped] == ["seg-1", "seg-2", "seg-3", "seg-4"]
    assert [s.type for s in capped] == ["intro", "event", "event", "outro"]
    assert capped[1].event_id == "evt-1" and capped[2].turns[0].text == "Hmm."


# --- Audio pipeline ---------------------------------------------------------------------------

EPISODE = {
    "id": "ep1", "timeline_id": "tl1", "format": "single", "voice_gender": "male",
    "detected_language": "en", "content_mode": "classic",
    "segments": [
        {"id": "seg-1", "type": "intro", "turns": [{"speaker": "host1", "text": "Intro."}]},
        {"id": "seg-2", "type": "event", "turns": [{"speaker": "host1", "text": "Chapter."}]},
    ],
}


def test_clip_key_is_content_addressed():
    seg = EPISODE["segments"][0]
    k1 = podcast_audio.clip_key("edge", EPISODE, seg)
    assert k1 == podcast_audio.clip_key("edge", dict(EPISODE), dict(seg))
    assert k1 != podcast_audio.clip_key("gemini", EPISODE, seg)
    assert k1 != podcast_audio.clip_key("edge", EPISODE, {"turns": [{"speaker": "host1", "text": "Other."}]})
    assert podcast_store.is_valid_clip_key(k1)


def test_render_order_puts_intro_first():
    segs = [{"id": "a", "type": "event"}, {"id": "b", "type": "intro"}, {"id": "c", "type": "outro"}]
    assert [s["id"] for s in podcast_audio.render_order(segs)] == ["b", "a", "c"]


@pytest.mark.asyncio
async def test_render_clip_dedupes_concurrent_requests_and_caches(monkeypatch):
    calls = {"n": 0}

    async def slow_synth(*args, **kwargs):
        calls["n"] += 1
        await asyncio.sleep(0.05)
        return _fake_result("edge")

    monkeypatch.setattr(podcast_audio, "synthesize_segment", slow_synth)
    seg = EPISODE["segments"][0]
    results = await asyncio.gather(*(podcast_audio.render_clip(EPISODE, seg, "edge") for _ in range(5)))
    assert calls["n"] == 1
    assert len({r["key"] for r in results}) == 1
    again = await podcast_audio.render_clip(EPISODE, seg, "edge")
    assert calls["n"] == 1 and again["url"].endswith(".mp3")
    assert podcast_store.get_clip_audio(again["key"])[:2] == b"\xff\xf3"


@pytest.mark.asyncio
async def test_fallback_clips_are_retried_after_cooldown(monkeypatch):
    engines = iter(["edge-fallback", "gemini"])

    async def synth(*args, **kwargs):
        kind = next(engines)
        result = _fake_result("edge" if kind == "edge-fallback" else "gemini")
        if kind == "edge-fallback":
            result.fallback_from = "gemini"
        return result

    monkeypatch.setattr(podcast_audio, "synthesize_segment", synth)
    seg = EPISODE["segments"][1]
    first = await podcast_audio.render_clip(EPISODE, seg, "gemini")
    assert first["fallback_from"] == "gemini"
    assert (await podcast_audio.render_clip(EPISODE, seg, "gemini"))["fallback_from"] == "gemini"
    monkeypatch.setattr(podcast_audio, "FALLBACK_RETRY_SECONDS", -1)
    retried = await podcast_audio.render_clip(EPISODE, seg, "gemini")
    assert retried["engine"] == "gemini" and retried["fallback_from"] is None


# --- Voice consistency: loudness, model pinning, no mid-episode engine switch -------------------

def _tone_pcm(amplitude: float, seconds: float = 2.0, rate: int = 24000) -> bytes:
    import math as _m
    import struct as _s
    n = int(seconds * rate)
    return _s.pack(f"<{n}h", *(int(amplitude * 32767 * _m.sin(2 * _m.pi * 220 * i / rate)) for i in range(n)))


@pytest.mark.parametrize("amplitude", [0.06, 0.5])
def test_normalize_speech_loudness_brings_chapters_to_the_same_level(amplitude):
    pcm = _tone_pcm(amplitude)
    out = tts.normalize_speech_loudness(pcm)
    assert len(out) == len(pcm)
    assert abs(tts.speech_level_dbfs(out) - tts.SPEECH_TARGET_DBFS) < 1.0


def test_normalize_speech_loudness_soft_limits_peaks():
    import array as _a
    samples = _a.array("h", _tone_pcm(0.06))
    for i in range(0, len(samples), 4800):
        samples[i] = 16000  # sharp plosive-like spikes that the boost would push past full scale
    out = _a.array("h", tts.normalize_speech_loudness(samples.tobytes()))
    assert max(abs(v) for v in out) <= int(tts._LIMITER_CEILING * 32767) + 1
    assert max(abs(v) for v in out) > 16000


def test_normalize_speech_loudness_caps_the_gain():
    pcm = _tone_pcm(0.01)
    boosted = tts.speech_level_dbfs(tts.normalize_speech_loudness(pcm)) - tts.speech_level_dbfs(pcm)
    assert abs(boosted - 12.0) < 0.2


def test_normalize_speech_loudness_leaves_silence_and_on_target_audio_untouched():
    silence = silence_pcm(1.0)
    assert tts.normalize_speech_loudness(silence) == silence
    on_target = tts.normalize_speech_loudness(_tone_pcm(0.2))
    assert tts.normalize_speech_loudness(on_target) == on_target


def test_duo_chapter_with_one_speaker_still_uses_multi_speaker_voices():
    request = tts.build_gemini_interaction_request([PodcastTurn(speaker="host2", text="Only me.")], "duo", "male", "classic")
    assert {s["speaker"]: s["voice"] for s in request["generation_config"]["speech_config"]["speakers"]} == {"Host1": "Charon", "Host2": "Aoede"}
    assert request["input"][0]["content"][0]["annotations"][0]["speaker"] == "Host2"
    _, speech_config = tts.build_gemini_legacy_request([PodcastTurn(speaker="host1", text="Solo.")], "duo", "male")
    assert speech_config.multi_speaker_voice_config is not None


def test_gemini_style_carries_a_fixed_consistency_brief():
    for mode in ("classic", "kids", "teens"):
        style = tts.gemini_style(mode)
        assert "same voice" in style and style == tts.gemini_style(mode)
    assert tts.gemini_style("kids") != tts.gemini_style("classic")


@pytest.mark.asyncio
async def test_pinned_gemini_model_is_retried_and_never_swapped(monkeypatch):
    calls = []
    wav = _pcm_to_wav_bytes(_tone_pcm(0.05, seconds=0.5))

    class FakeInteractions:
        async def create(self, model, **request):
            calls.append(model)
            if len(calls) < 3:
                raise RuntimeError("503 overloaded")
            return SimpleNamespace(
                output_audio=SimpleNamespace(data=wav, mime_type="audio/wav"),
                usage=SimpleNamespace(total_input_tokens=5, total_output_tokens=25),
            )

    monkeypatch.setattr(tts, "get_gemini_client", lambda key=None: SimpleNamespace(aio=SimpleNamespace(interactions=FakeInteractions())))
    monkeypatch.setattr(tts, "GEMINI_PINNED_RETRY_DELAYS", (0.0, 0.0))
    result = await tts.PROVIDERS["gemini"].synthesize([PodcastTurn(text="Hi.")], model="gemini-3.8-flash-lite-tts")
    assert calls == ["gemini-3.8-flash-lite-tts"] * 3
    assert result.model == "gemini-3.8-flash-lite-tts"

    calls.clear()

    class AlwaysDown:
        async def create(self, model, **request):
            calls.append(model)
            raise RuntimeError("down")

    monkeypatch.setattr(tts, "get_gemini_client", lambda key=None: SimpleNamespace(aio=SimpleNamespace(interactions=AlwaysDown())))
    with pytest.raises(RuntimeError):
        await tts.PROVIDERS["gemini"].synthesize([PodcastTurn(text="Hi.")], model="gemini-3.8-flash-tts")
    assert set(calls) == {"gemini-3.8-flash-tts"}


@pytest.mark.asyncio
async def test_gemini_chapters_never_fall_back_and_respect_the_pin(monkeypatch):
    seen = []

    async def synth(engine, turns, **kwargs):
        seen.append(kwargs)
        result = _fake_result("gemini")
        result.model = kwargs.get("model") or "gemini-3.8-flash-tts"
        return result

    monkeypatch.setattr(podcast_audio, "synthesize_segment", synth)
    seg = EPISODE["segments"][0]
    first = await podcast_audio.render_clip(EPISODE, seg, "gemini")
    assert seen[-1]["allow_fallback"] is False and first["model"] == "gemini-3.8-flash-tts"

    # Same pin: served from cache. Different pin: re-rendered with the pinned model.
    await podcast_audio.render_clip(EPISODE, seg, "gemini", model="gemini-3.8-flash-tts")
    assert len(seen) == 1
    repinned = await podcast_audio.render_clip(EPISODE, seg, "gemini", model="gemini-3.8-flash-lite-tts")
    assert len(seen) == 2 and seen[-1]["model"] == "gemini-3.8-flash-lite-tts"
    assert repinned["model"] == "gemini-3.8-flash-lite-tts"


def test_first_gemini_clip_pins_the_episode_model():
    doc = {"id": "ep", "voice_gender": "male", "segments": EPISODE["segments"], "audio": {}}
    assert podcast_audio.pinned_model(doc, "gemini") is None
    podcast_audio.record_clip_summary(doc, "gemini", "seg-1", {"key": "a", "engine": "gemini", "model": "m1"})
    podcast_audio.record_clip_summary(doc, "gemini", "seg-2", {"key": "b", "engine": "gemini", "model": "m2"})
    assert podcast_audio.pinned_model(doc, "gemini") == "m1"
    assert podcast_audio.pinned_model(doc, "gemini", "female") is None
    assert podcast_audio.pinned_model(doc, "edge") is None
    doc["audio"]["gemini"]["by_gender"]["male"]["model_version"] = "old"
    assert podcast_audio.pinned_model(doc, "gemini") is None


def test_record_clip_summary_marks_variant_ready_when_final_chapter_completes_on_demand():
    doc = {
        **EPISODE,
        "id": "ep-partial",
        "audio": {
            "gemini": {
                "status": "partial",
                "charged": True,
                "clips": {},
                "by_gender": {"male": {"status": "partial", "clips": {}}},
            }
        },
    }
    seg1, seg2 = doc["segments"]
    k1 = podcast_audio.clip_key("gemini", doc, seg1, voice_gender="male")
    k2 = podcast_audio.clip_key("gemini", doc, seg2, voice_gender="male")
    podcast_audio.record_clip_summary(doc, "gemini", seg1["id"], {"key": k1, "duration": 12.5, "engine": "gemini", "model": "m1"}, "male")
    assert doc["audio"]["gemini"]["status"] == "partial"

    podcast_audio.record_clip_summary(doc, "gemini", seg2["id"], {"key": k2, "duration": 17.25, "engine": "gemini", "model": "m1"}, "male")
    assert doc["audio"]["gemini"]["status"] == "ready"
    assert doc["audio"]["gemini"]["by_gender"]["male"]["status"] == "ready"
    assert doc["audio"]["gemini"]["total_duration"] == 29.75


# --- Continuous episode audio -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_episode_audio_joins_chapters_with_exact_offsets(monkeypatch):
    lengths = {"Intro.": 1.0, "Chapter.": 1.5}

    async def synth(engine, turns, **kwargs):
        return _fake_result("edge", seconds=lengths[turns[0].text])

    monkeypatch.setattr(podcast_audio, "synthesize_segment", synth)
    assert await podcast_audio.build_episode_audio(EPISODE, "edge") is None  # nothing rendered yet

    for seg in EPISODE["segments"]:
        await podcast_audio.render_clip(EPISODE, seg, "edge")
    manifest = await podcast_audio.build_episode_audio(EPISODE, "edge")
    assert manifest and manifest["url"].endswith(".mp3")
    first, second = manifest["chapters"]
    assert [first["id"], second["id"]] == ["seg-1", "seg-2"]
    assert first["start"] == 0.0
    assert abs(second["start"] - (first["duration"] + mp3_duration_seconds(podcast_audio._chapter_gap()))) < 0.01
    data = podcast_store.get_clip_audio(manifest["key"])
    assert data[:3] == b"ID3"
    assert abs(mp3_duration_seconds(data) - manifest["duration"]) < 0.01
    assert abs(manifest["duration"] - (second["start"] + second["duration"])) < 0.01
    assert (await podcast_audio.build_episode_audio(EPISODE, "edge"))["key"] == manifest["key"]


def test_music_mood_is_normalized_with_audience_default_and_legacy_mapping():
    assert normalize_music_mood(" Cinematic_Orchestra ") == "cinematic_orchestra"
    assert normalize_music_mood(None) == "sunrise_piano"
    assert normalize_music_mood("techno", "kids") == "indie_groove"
    assert normalize_music_mood("cello_elegy", "kids") == "cello_elegy"
    # Legacy 6-mood values map deterministically into the 9 curated compositions.
    assert normalize_music_mood("epic") == "cinematic_orchestra"
    assert normalize_music_mood("somber") == "cello_elegy"
    assert normalize_music_mood("reflective", seed="ep-99") in PODCAST_MUSIC_MOODS
    assert len(PODCAST_MUSIC_MOODS) == 9
    assert "reflective" not in PODCAST_MUSIC_MOODS
