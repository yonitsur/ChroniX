import pytest
from dotenv import load_dotenv
load_dotenv()
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane
from services.wiki_enricher import fetch_wikipedia_summary, enrich_events_with_wikipedia
import httpx
import asyncio

def test_models_serialization():
    article = TimelineArticle(
        id="test-1",
        title="Apollo 11",
        subtitle="First Moon Landing",
        lane="space",
        from_=TimelineDate(year=1969, month=7, day=20, precision="day"),
        imageUrl="https://example.com/apollo.jpg",
        wikiTitle="Apollo 11",
        wikiUrl="https://en.wikipedia.org/wiki/Apollo_11",
        extract="Apollo 11 was the American spaceflight that first landed humans on the Moon.",
        rank=10
    )
    dumped = article.model_dump(by_alias=True)
    assert dumped["id"] == "test-1"
    assert dumped["from"]["year"] == 1969
    assert dumped["from"]["month"] == 7
    assert dumped["from"]["precision"] == "day"
    assert dumped["title"] == "Apollo 11"


def test_timeline_pin_serialization_and_saved_list(tmp_path, monkeypatch):
    from services import storage

    timeline = TimelineData(id="pinned-timeline", title="Pinned", isPinned=True)
    assert timeline.model_dump(by_alias=True)["isPinned"] is True

    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage.save_timeline_data(timeline.model_dump(by_alias=True))
    saved = storage.list_all_timelines()
    assert saved[0]["isPinned"] is True

@pytest.mark.asyncio
async def test_wikipedia_enrichment():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary("George Washington", client, sem)
        assert res is not None
        assert "wikiTitle" in res
        assert "George Washington" in res["wikiTitle"]
        assert res.get("imageUrl") is not None
        assert res.get("wikiUrl") is not None

@pytest.mark.asyncio
async def test_batch_enrichment():
    sample_events = [
        {"id": "1", "title": "Abraham Lincoln", "from": {"year": 1861}},
        {"id": "2", "title": "Tyrannosaurus", "from": {"year": -68000000, "precision": "million-years"}}
    ]
    enriched = await enrich_events_with_wikipedia(sample_events)
    assert len(enriched) == 2
    assert enriched[0].get("imageUrl") is not None
    assert enriched[1].get("imageUrl") is not None

def test_unicode_slug_and_relevance():
    import re
    from services.wiki_enricher import is_title_relevant

    # 1. Verify slug generation handles diverse unicode alphabets & scripts
    sample_prompts = [
        "Révolution française",
        "Вторая мировая война",
        "الثورة الفرنسية",
        "World War II",
        "第二次世界大戦"
    ]
    for prompt in sample_prompts:
        slug = re.sub(r'[\W_]+', '-', prompt.lower(), flags=re.UNICODE).strip('-')[:24]
        assert len(slug) > 0, f"Expected non-empty slug for {prompt}"

    # 2. Verify multi-word containment is language-agnostic
    assert is_title_relevant("Mount Everest", "First ascent of Mount Everest") is True
    assert is_title_relevant("Bataille d'Austerlitz", "Campagne de la Bataille d'Austerlitz") is True

@pytest.mark.asyncio
async def test_multilingual_wikipedia_enrichment_french():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary("Bataille d'Austerlitz", client, sem, lang="fr")
        assert res is not None
        assert "fr.wikipedia.org" in res.get("wikiUrl", "")
        assert res.get("extract") is not None
        assert len(res.get("extract", "")) > 0
        assert res.get("imageUrl") is not None

@pytest.mark.asyncio
async def test_multilingual_batch_enrichment_french():
    events = [
        {"id": "1", "title": "Bataille de Waterloo", "wikipedia_title": "Bataille de Waterloo"},
        {"id": "2", "title": "Bataille de Stalingrad", "wikipedia_title": "Bataille de Stalingrad"}
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="fr")
    assert len(enriched) == 2
    assert "fr.wikipedia.org" in enriched[0].get("wikiUrl", "")
    assert enriched[0].get("imageUrl") is not None
    assert "fr.wikipedia.org" in enriched[1].get("wikiUrl", "")
    assert enriched[1].get("imageUrl") is not None

def test_title_variations_generator():
    from services.wiki_enricher import generate_title_variations
    
    # Subtitle colon separation
    v1 = generate_title_variations("Battle of Midway: Pacific Operations")
    assert "Battle of Midway" in v1

    # Parenthetical qualifier stripping
    v2 = generate_title_variations("Apollo 11 (spacecraft)", lang="en")
    assert "Apollo 11" in v2

    # Dash separation
    v3 = generate_title_variations("Battle of Midway - Pacific Theatre", lang="en")
    assert "Battle of Midway" in v3

@pytest.mark.asyncio
async def test_complex_title_enrichment():
    from services.wiki_enricher import fetch_wikipedia_summary
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        # Test that colon-separated complex title resolves
        res1 = await fetch_wikipedia_summary("Bataille d'Austerlitz: Campagne des Trois Empereurs", client, sem, lang="fr")
        assert res1 is not None
        assert "fr.wikipedia.org" in res1.get("wikiUrl", "")
        assert "Austerlitz" in res1.get("wikiTitle", "")

@pytest.mark.asyncio
async def test_disambiguation_with_context():
    """
    Test that ambiguous title 'Mercury' correctly resolves to 'Mercury (planet)'
    when provided with planetary/astronomical context.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "Mercury",
            client,
            sem,
            lang="en",
            context_text="solar system planet orbit astronomy terrestrial planet",
            year=None
        )
        assert res is not None
        assert "wikiTitle" in res
        assert "planet" in res.get("wikiTitle", "").lower() or "planet" in res.get("extract", "").lower()
        assert "en.wikipedia.org" in res.get("wikiUrl", "")

@pytest.mark.asyncio
async def test_batch_disambiguation_with_timeline_topic():
    events = [
        {
            "id": "1",
            "title": "Mercury",
            "subtitle": "innermost terrestrial planet",
            "from": {"year": 1631, "precision": "year"}
        }
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="en", timeline_topic="Planets of the Solar System")
    assert len(enriched) == 1
    assert "planet" in enriched[0].get("wikiTitle", "").lower() or "planet" in enriched[0].get("extract", "").lower()

@pytest.mark.asyncio
async def test_missing_article_rejection_nonexistent():
    """
    Test that an event without a dedicated Wikipedia page
    does NOT attach an irrelevant article and is gracefully left without a Wikipedia link.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "NonexistentFictionalBattle998877",
            client,
            sem,
            lang="en",
            context_text="obscure battle history conflict",
            year=1812
        )
        assert not res or not res.get("wikiUrl")

@pytest.mark.asyncio
async def test_search_wikipedia_candidates_lucy():
    from services.wiki_enricher import search_wikipedia_candidates
    async with httpx.AsyncClient(follow_redirects=True) as client:
        candidates = await search_wikipedia_candidates(
            "Lucy",
            client,
            lang="en",
            context_text="Human Evolution & Early Hominids",
            limit=5
        )
        assert len(candidates) > 0
        titles = [c["wikiTitle"] for c in candidates]
        assert "Lucy (hominid)" in titles or any("hominid" in t.lower() or "australopithecus" in t.lower() for t in titles)

@pytest.mark.asyncio
async def test_suggest_event_details_lucy():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import suggest_event_details
    res = await suggest_event_details(
        query="Lucy",
        timeline_topic="Human Evolution & Early Hominids",
        time_scale="prehistoric",
        lanes=[{"id": "fossils", "title": "Fossils"}, {"id": "tools", "title": "Stone Tools"}]
    )
    assert res is not None
    assert res.get("title")
    assert res.get("from", {}).get("year") is not None
    # For prehistoric hominid Lucy, the year should be negative millions of years ago
    assert res["from"]["year"] < -1000000
    assert res["from"]["precision"] == "million-years"
    assert res.get("imageUrl") or res.get("wikiUrl")


def test_input_validation_max_length():
    from pydantic import ValidationError
    from models import GenerateTimelineRequest, RefineTimelineRequest, EventSuggestionRequest, TimelineData

    # Valid prompt within bounds
    req = GenerateTimelineRequest(prompt="Valid prompt")
    assert req.prompt == "Valid prompt"

    # Prompt exceeding 400 characters must fail validation
    long_prompt = "A" * 401
    with pytest.raises(ValidationError):
        GenerateTimelineRequest(prompt=long_prompt)

    # Custom focus exceeding 300 characters must fail
    with pytest.raises(ValidationError):
        GenerateTimelineRequest(prompt="Valid prompt", custom_focus="F" * 301)

    # Refine instruction exceeding 500 characters must fail
    dummy_tl = TimelineData(id="1", title="Test")
    with pytest.raises(ValidationError):
        RefineTimelineRequest(timeline=dummy_tl, instruction="I" * 501)
    # 450 characters should succeed
    valid_refine = RefineTimelineRequest(timeline=dummy_tl, instruction="I" * 450)
    assert len(valid_refine.instruction) == 450

    # Event query exceeding 150 characters must fail
    with pytest.raises(ValidationError):
        EventSuggestionRequest(query="Q" * 151)


@pytest.mark.asyncio
async def test_simple_rate_limiter():
    from main import SimpleRateLimiter
    from fastapi import HTTPException
    from unittest.mock import MagicMock

    limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="test")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "192.168.1.100"

    # First 3 calls should succeed
    for _ in range(3):
        await limiter(mock_req, x_gemini_api_key=None)

    # 4th call should raise 429
    with pytest.raises(HTTPException) as exc_info:
        await limiter(mock_req, x_gemini_api_key=None)
    assert exc_info.value.status_code == 429


def test_timeline_article_geographic_fields():
    from models import TimelineArticle
    article = TimelineArticle(
        id="geo-test",
        title="Battle of Normandy",
        **{"from": {"year": 1944, "month": 6, "day": 6, "precision": "day"}},
        locationName="Normandy, France",
        lat=49.33,
        lng=-0.45,
        googleMapsUrl="https://www.google.com/maps/search/?api=1&query=49.33,-0.45"
    )
    dumped = article.model_dump(by_alias=True)
    assert dumped["locationName"] == "Normandy, France"
    assert dumped["lat"] == 49.33
    assert dumped["lng"] == -0.45
    assert dumped["googleMapsUrl"] == "https://www.google.com/maps/search/?api=1&query=49.33,-0.45"


def test_sample_timeline_has_geographic_data():
    from services.storage import get_sample_timeline
    sample = get_sample_timeline()
    articles_with_geo = [a for a in sample["articles"] if a.get("lat") is not None and a.get("lng") is not None]
    assert len(articles_with_geo) >= 6
    assert articles_with_geo[0]["locationName"] is not None
    assert articles_with_geo[0]["googleMapsUrl"] is not None


def test_system_instruction_single_lane_default():
    from services.gemini_service import get_system_instruction
    inst = get_system_instruction()
    assert "EXACTLY ONE" in inst
    assert "DO NOT divide or split the timeline into multiple lanes by default" in inst
    assert "EXPLICIT MULTI-LANE EXCEPTION" in inst
    # Language handling must be generic (no language special-cased in the instruction)
    assert "LANGUAGE REQUIREMENT" in inst
    assert "detected_language" in inst


def test_system_instruction_factual_integrity_guardrails():
    """Verify factual accuracy, date calibration, anti-narrative fallacy, and dispute handling in system instructions."""
    from services.gemini_service import get_system_instruction
    inst = get_system_instruction()
    assert "SCHOLARLY & HISTORIOGRAPHICAL CONSENSUS" in inst
    assert "ANTI-NARRATIVE FALLACY" in inst
    assert "HISTORICAL DISPUTES" in inst
    assert "DATE PRECISION & CALIBRATION" in inst
    assert "ANTI-PADDING" in inst


@pytest.mark.asyncio
async def test_gemini_generation_default_single_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Prompt with no mention of lanes should produce exactly 1 lane
    tl = await generate_timeline_with_gemini(
        prompt="History of the Steam Engine"
    )
    assert tl is not None
    assert len(tl.lanes) == 1, f"Expected 1 lane by default, got {len(tl.lanes)}: {[l.title for l in tl.lanes]}"
    assert len(tl.articles) > 0
    lane_id = tl.lanes[0].id
    for a in tl.articles:
        assert a.lane == lane_id, f"Article {a.title} has lane {a.lane}, expected {lane_id}"


@pytest.mark.asyncio
async def test_gemini_generation_explicit_multi_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Prompt with explicit request for division into lanes should produce multiple lanes
    tl = await generate_timeline_with_gemini(
        prompt="The Space Race, divided into separate swimlanes for USA and Soviet Union"
    )
    assert tl is not None
    assert len(tl.lanes) >= 2, f"Expected multiple lanes on explicit instruction, got {len(tl.lanes)}"
    assert len(tl.articles) > 0
    assigned_lanes = {a.lane for a in tl.articles if a.lane}
    assert len(assigned_lanes) >= 2, f"Expected events in at least 2 lanes, got {assigned_lanes}"





@pytest.mark.asyncio
async def test_refine_timeline_restructuring_and_preservation():
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineDate, GeminiTimelineOutput, GeminiLaneItem, GeminiEventItem
    from services.gemini_service import refine_timeline_with_gemini

    # Existing timeline with 2 events in a single "main" lane
    initial_tl = TimelineData(
        id="tl-ww2",
        title="World War II",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(
                id="ev-dday",
                title="D-Day Normandy Landings",
                subtitle="Allied invasion of France",
                lane="main",
                **{"from": {"year": 1944, "month": 6, "day": 6, "precision": "day"}},
                imageUrl="https://upload.wikimedia.org/dday.jpg",
                wikiUrl="https://en.wikipedia.org/wiki/Normandy_landings",
                wikiTitle="Normandy landings",
                extract="Landings in Normandy...",
                rank=10,
                locationName="Normandy, France",
                lat=49.33,
                lng=-0.56,
                googleMapsUrl="https://www.google.com/maps/search/?api=1&query=49.33,-0.56"
            ),
            TimelineArticle(
                id="ev-pearl",
                title="Attack on Pearl Harbor",
                subtitle="Surprise attack by Imperial Japanese Navy",
                lane="main",
                **{"from": {"year": 1941, "month": 12, "day": 7, "precision": "day"}},
                imageUrl="https://upload.wikimedia.org/pearl.jpg",
                wikiUrl="https://en.wikipedia.org/wiki/Pearl_Harbor",
                wikiTitle="Attack on Pearl Harbor",
                extract="Attack on Pearl Harbor...",
                rank=9
            )
        ]
    )

    # Mock Gemini response restructuring into two lanes: Europe and Pacific/America
    mock_gemini_output = GeminiTimelineOutput(
        title="World War II - Divided Arenas",
        description="Restructured by operational theater",
        overview="A narrative overview of WWII split across its major theaters.",
        lanes=[
            GeminiLaneItem(id="europe", title="European Theater", color="#2b5278"),
            GeminiLaneItem(id="pacific", title="Pacific & American Theater", color="#b84a39")
        ],
        events=[
            # Reassign ev-dday to Europe
            GeminiEventItem(
                id="ev-dday",
                title="D-Day Normandy Landings",
                subtitle="Allied invasion of Normandy",
                lane="europe",
                from_year=1944,
                from_month=6,
                from_day=6,
                from_precision="day",
                wikipedia_title="Normandy landings"
            ),
            # Reassign ev-pearl to Pacific
            GeminiEventItem(
                id="ev-pearl",
                title="Attack on Pearl Harbor",
                subtitle="Surprise attack in Hawaii",
                lane="pacific",
                from_year=1941,
                from_month=12,
                from_day=7,
                from_precision="day",
                wikipedia_title="Attack on Pearl Harbor"
            ),
            # Add new event in Europe
            GeminiEventItem(
                id="new_battle_of_bulge",
                title="Battle of the Bulge",
                subtitle="German counter-offensive in the Ardennes",
                lane="europe",
                from_year=1944,
                from_month=12,
                from_day=16,
                from_precision="day",
                wikipedia_title="Battle of the Bulge"
            )
        ]
    )

    mock_response = MagicMock()
    mock_response.parsed = mock_gemini_output

    with patch("services.gemini_service.get_gemini_client") as mock_get_client, \
         patch("services.gemini_service.enrich_events_with_wikipedia") as mock_enrich:
        
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        # Return mock enriched item for the new event
        mock_enrich.return_value = [
            {
                "id": "new_battle_of_bulge",
                "title": "Battle of the Bulge",
                "subtitle": "German counter-offensive in the Ardennes",
                "lane": "europe",
                "from": {"year": 1944, "month": 12, "day": 16, "precision": "day"},
                "rank": 5,
                "imageUrl": "https://upload.wikimedia.org/bulge.jpg",
                "wikiTitle": "Battle of the Bulge",
                "wikiUrl": "https://en.wikipedia.org/wiki/Battle_of_the_Bulge",
                "extract": "Major German campaign...",
                "locationName": "Ardennes",
                "lat": 50.25,
                "lng": 5.66
            }
        ]

        refined = await refine_timeline_with_gemini(
            current_timeline=initial_tl,
            instruction="divide the events into two timelines - one for Europe and one for Pacific/America and add Battle of the Bulge",
            api_key="test_key"
        )

        # 1. Lanes restructured to Europe and Pacific
        lane_ids = [l.id for l in refined.lanes]
        assert "europe" in lane_ids
        assert "pacific" in lane_ids

        # 2. Articles count
        assert len(refined.articles) == 3

        # 3. Verify ev-dday reassigned to europe and metadata preserved
        dday = next(a for a in refined.articles if a.id == "ev-dday")
        assert dday.lane == "europe"
        assert dday.imageUrl == "https://upload.wikimedia.org/dday.jpg", "Preserved existing thumbnail"
        assert dday.lat == 49.33, "Preserved coordinates"
        assert dday.wikiTitle == "Normandy landings"

        # 4. Verify ev-pearl reassigned to pacific
        pearl = next(a for a in refined.articles if a.id == "ev-pearl")
        assert pearl.lane == "pacific"
        assert pearl.imageUrl == "https://upload.wikimedia.org/pearl.jpg", "Preserved existing thumbnail"

        # 5. Verify new event enriched and present in europe
        bulge = next(a for a in refined.articles if a.id == "new_battle_of_bulge")
        assert bulge.lane == "europe"
        assert bulge.from_.year == 1944
        assert bulge.from_.month == 12


@pytest.mark.asyncio
async def test_chat_about_timeline_answer():
    """A plain question returns action='answer' and no edit instruction."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineChatOutput
    from services.gemini_service import chat_about_timeline

    tl = TimelineData(
        id="tl-q",
        title="World War II",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(
                id="ev-dday",
                title="D-Day",
                lane="main",
                **{"from": {"year": 1944, "month": 6, "day": 6, "precision": "day"}},
            )
        ],
    )

    mock_out = TimelineChatOutput(
        reply="D-Day was the Allied invasion of Normandy on 6 June 1944.",
        action="answer",
        edit_instruction=None,
        detected_language="en",
    )
    mock_response = MagicMock()
    mock_response.parsed = mock_out

    with patch("services.gemini_service.get_gemini_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        result, grounding = await chat_about_timeline(
            current_timeline=tl,
            message="What was D-Day?",
            history=[],
            api_key="test_key",
            enable_grounding=False,
        )

    assert result.action == "answer"
    assert result.edit_instruction is None
    assert "Normandy" in result.reply
    assert grounding is None


@pytest.mark.asyncio
async def test_chat_about_timeline_edit_intent():
    """An edit request returns action='edit' with a self-contained instruction."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineChatOutput
    from services.gemini_service import chat_about_timeline

    tl = TimelineData(
        id="tl-e",
        title="World War II",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[],
    )

    mock_out = TimelineChatOutput(
        reply="Sure — adding the Battle of the Bulge.",
        action="edit",
        edit_instruction="Add the Battle of the Bulge (Dec 1944) to the timeline.",
        detected_language="en",
    )
    mock_response = MagicMock()
    mock_response.parsed = mock_out

    with patch("services.gemini_service.get_gemini_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        result, _ = await chat_about_timeline(
            current_timeline=tl,
            message="Please add the Battle of the Bulge",
            history=[{"role": "user", "content": "hi"}],
            api_key="test_key",
            enable_grounding=False,
        )

    assert result.action == "edit"
    assert result.edit_instruction and "Bulge" in result.edit_instruction


@pytest.mark.asyncio
async def test_chat_about_timeline_guardrail_off_topic():
    """An off-topic / abuse query returns is_relevant=False and a polite redirection."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineChatOutput
    from services.gemini_service import chat_about_timeline

    tl = TimelineData(
        id="tl-gt",
        title="Ancient Rome",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[],
    )

    mock_out = TimelineChatOutput(
        reply="I am your timeline guide for Ancient Rome. I cannot assist with personal chat or general code tasks, but I'd love to help you explore Roman history!",
        action="answer",
        edit_instruction=None,
        is_relevant=False,
        detected_language="en",
    )
    mock_response = MagicMock()
    mock_response.parsed = mock_out

    with patch("services.gemini_service.get_gemini_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        result, _ = await chat_about_timeline(
            current_timeline=tl,
            message="Write me a python script to scrape a website and how was your weekend?",
            history=[],
            api_key="test_key",
            enable_grounding=False,
        )

    assert result.action == "answer"
    assert result.is_relevant is False
    assert result.edit_instruction is None
    assert "Ancient Rome" in result.reply


@pytest.mark.asyncio
async def test_chat_about_timeline_destructive_edit_declined():
    """A wipe-and-repurpose request is not treated as an edit: no edit_instruction, warm redirect."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineChatOutput
    from services.gemini_service import chat_about_timeline

    tl = TimelineData(
        id="tl-dz",
        title="Ancient Rome",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[],
    )

    mock_out = TimelineChatOutput(
        reply="I can refine this Ancient Rome timeline, but for a brand-new topic like the Russia-Ukraine war, start a fresh timeline from the home screen.",
        action="answer",
        edit_instruction=None,
        is_relevant=True,
        detected_language="en",
    )
    mock_response = MagicMock()
    mock_response.parsed = mock_out

    with patch("services.gemini_service.get_gemini_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        result, _ = await chat_about_timeline(
            current_timeline=tl,
            message="Delete the entire timeline and create a new one about the Russia-Ukraine war (in-depth)",
            history=[],
            api_key="test_key",
            enable_grounding=False,
        )

    assert result.action == "answer"
    assert result.edit_instruction is None


def test_chat_system_instruction_has_destruction_guardrail():
    """The chat instruction forbids wholesale wipe / topic-hijack edits."""
    from services.gemini_service import get_chat_system_instruction

    inst = get_chat_system_instruction().lower()
    assert "wholesale-delete" in inst or "wipe" in inst
    assert "unrelated subject" in inst


def test_chat_system_instruction_factual_rigor():
    """Verify factual accuracy, dispute handling, and date calibration in chat instructions."""
    from services.gemini_service import get_chat_system_instruction

    inst = get_chat_system_instruction()
    assert "FACTUAL INTEGRITY & HISTORICAL RIGOR" in inst
    assert "SCHOLARSHIP vs. POPULAR MYTHS" in inst
    assert "DISPUTES & CONTRADICTIONS" in inst
    assert "EPISTEMIC CALIBRATION" in inst
    assert "DATE PRECISION & CALIBRATION" in inst


def test_chat_request_validation():
    """Chat message length bounds are enforced."""
    from pydantic import ValidationError
    from models import TimelineChatRequest, TimelineData

    dummy_tl = TimelineData(id="tl-x", title="X")
    with pytest.raises(ValidationError):
        TimelineChatRequest(timeline=dummy_tl, message="")
    with pytest.raises(ValidationError):
        TimelineChatRequest(timeline=dummy_tl, message="M" * 1001)
    ok = TimelineChatRequest(timeline=dummy_tl, message="Tell me more about this era")
    assert ok.enable_grounding is False


def test_normalize_event_dates_point_in_time():
    from services.gemini_service import normalize_event_dates
    from_dict, to_dict, is_present = normalize_event_dates(
        from_year=1969, from_month=7, from_day=20, from_precision="day",
        to_year=None, to_month=None, to_day=None, to_precision=None,
        is_to_present=False
    )
    assert from_dict["year"] == 1969
    assert from_dict["month"] == 7
    assert from_dict["day"] == 20
    assert to_dict is None
    assert is_present is False


def test_normalize_event_dates_valid_span():
    from services.gemini_service import normalize_event_dates
    from_dict, to_dict, is_present = normalize_event_dates(
        from_year=1939, from_month=9, from_day=1, from_precision="day",
        to_year=1945, to_month=9, to_day=2, to_precision="day",
        is_to_present=False
    )
    assert from_dict["year"] == 1939
    assert to_dict["year"] == 1945
    assert is_present is False


def test_normalize_event_dates_ongoing_to_present():
    from services.gemini_service import normalize_event_dates
    from_dict, to_dict, is_present = normalize_event_dates(
        from_year=1948, from_month=5, from_day=14, from_precision="day",
        to_year=2024, to_month=1, to_day=1, to_precision="day",
        is_to_present=True
    )
    assert from_dict["year"] == 1948
    assert to_dict is None
    assert is_present is True


def test_normalize_event_dates_reversed_bce():
    from services.gemini_service import normalize_event_dates
    # Peloponnesian War: -431 to -404 BCE. If model erroneously returned from=-404, to=-431:
    from_dict, to_dict, is_present = normalize_event_dates(
        from_year=-404, from_month=None, from_day=None, from_precision="year",
        to_year=-431, to_month=None, to_day=None, to_precision="year",
        is_to_present=False
    )
    assert from_dict["year"] == -431
    assert to_dict["year"] == -404
    assert is_present is False


def test_normalize_event_dates_identical_collapses():
    from services.gemini_service import normalize_event_dates
    # If identical from and to are provided, collapse to point-in-time
    from_dict, to_dict, is_present = normalize_event_dates(
        from_year=1776, from_month=7, from_day=4, from_precision="day",
        to_year=1776, to_month=7, to_day=4, to_precision="day",
        is_to_present=False
    )
    assert from_dict["year"] == 1776
    assert to_dict is None
    assert is_present is False


def test_schema_descriptions_for_gemini():
    from models import GeminiEventItem, EventSuggestionOutput
    gemini_schema = GeminiEventItem.model_json_schema()
    assert "description" in gemini_schema["properties"]["to_year"]
    assert "MANDATORY" in gemini_schema["properties"]["to_year"]["description"]
    assert "description" in gemini_schema["properties"]["is_to_present"]
    assert "wikipedia_title_en" in gemini_schema["properties"]

    sugg_schema = EventSuggestionOutput.model_json_schema()
    assert "description" in sugg_schema["properties"]["to_year"]
    assert "description" in sugg_schema["properties"]["is_to_present"]
    assert "wikipedia_title_en" in sugg_schema["properties"]


@pytest.mark.asyncio
async def test_multilingual_wikipedia_enrichment_french():
    """Verify that querying French Wikipedia returns French URL, extract, and thumbnail."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "Bataille d'Austerlitz",
            client,
            sem,
            lang="fr",
            fallback_lang="en",
            fallback_title="Battle of Austerlitz"
        )
        assert res is not None
        assert "fr.wikipedia.org" in res.get("wikiUrl", "")
        assert "Austerlitz" in res.get("wikiTitle", "")
        assert res.get("extract") is not None
        assert len(res.get("extract", "")) > 0
        assert res.get("imageUrl") is not None


@pytest.mark.asyncio
async def test_multilingual_wikipedia_enrichment_with_english_fallback():
    """
    Verify that an entity lacking an article in a foreign language Wikipedia
    gracefully falls back to English Wikipedia using fallback_title.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        # Query an entity with an intentionally nonexistent title in Hebrew/French, with English fallback
        res = await fetch_wikipedia_summary(
            "NonExistentArticleXYZ123456",
            client,
            sem,
            lang="fr",
            fallback_lang="en",
            fallback_title="Owyhee County Courthouse"
        )
        assert res is not None
        assert "en.wikipedia.org" in res.get("wikiUrl", "")
        assert "Owyhee" in res.get("wikiTitle", "")
        assert res.get("imageUrl") is not None


@pytest.mark.asyncio
async def test_multilingual_batch_enrichment_spanish_and_fallback():
    """Verify batch enrichment in Spanish with English fallback."""
    events = [
        {
            "id": "1",
            "title": "Revolución mexicana",
            "wikipedia_title": "Revolución mexicana",
            "wikipedia_title_en": "Mexican Revolution"
        },
        {
            "id": "2",
            "title": "Obscure Event Without Spanish Article",
            "wikipedia_title": "CompletelyFakeArticleTitleABC999",
            "wikipedia_title_en": "Declaration of Independence of the United States"
        }
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="es")
    assert len(enriched) == 2
    # First event should resolve to Spanish Wikipedia
    assert "es.wikipedia.org" in enriched[0].get("wikiUrl", "")
    assert enriched[0].get("imageUrl") is not None

    # Second event should gracefully fall back to English Wikipedia
    assert "en.wikipedia.org" in enriched[1].get("wikiUrl", "")
    assert enriched[1].get("imageUrl") is not None


@pytest.mark.asyncio
async def test_multilingual_langlinks_interlanguage_resolution():
    """
    Verify that an entity whose English title is known (e.g. 'French Directory')
    correctly discovers the exact, differently-phrased local language article
    via Wikipedia's interlanguage links (langlinks / Wikidata), rather than falling back to English.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        # 1. Test Arabic resolution: English 'French Directory' -> Arabic 'حكومة المديرين الفرنسية 1795–1799'
        res_ar = await fetch_wikipedia_summary(
            "French Directory",
            client,
            sem,
            lang="ar",
            fallback_lang="en",
            fallback_title="French Directory"
        )
        assert res_ar is not None
        assert "ar.wikipedia.org" in res_ar.get("wikiUrl", "")
        assert res_ar.get("lang") == "ar"
        assert res_ar.get("imageUrl") is not None

        # 2. Test Japanese resolution: English 'French Directory' -> Japanese '総裁政府'
        res_ja = await fetch_wikipedia_summary(
            "French Directory",
            client,
            sem,
            lang="ja",
            fallback_lang="en",
            fallback_title="French Directory"
        )
        assert res_ja is not None
        assert "ja.wikipedia.org" in res_ja.get("wikiUrl", "")
        assert res_ja.get("lang") == "ja"


def test_related_prompts_models_and_serialization():
    from models import GeminiTimelineOutput
    # Test Gemini output with related_prompts
    output = GeminiTimelineOutput(
        title="The Roman Republic",
        description="Rise and fall of Rome",
        overview="Narrative overview of Rome.",
        related_prompts=[
            "The Punic Wars & Hannibal",
            "Julius Caesar & the Fall of the Republic",
            "Pax Romana & the Early Empire"
        ]
    )
    assert len(output.related_prompts) == 3
    assert output.related_prompts[0] == "The Punic Wars & Hannibal"

    # Test TimelineData with relatedPrompts
    tl = TimelineData(
        id="tl-1",
        title="The Roman Republic",
        relatedPrompts=output.related_prompts
    )
    dumped = tl.model_dump(by_alias=True)
    assert "relatedPrompts" in dumped
    assert dumped["relatedPrompts"] == [
        "The Punic Wars & Hannibal",
        "Julius Caesar & the Fall of the Republic",
        "Pax Romana & the Early Empire"
    ]

    # Test deserialization with snake_case alias
    tl2 = TimelineData.model_validate({
        "id": "tl-2",
        "title": "Ancient Greece",
        "related_prompts": ["Peloponnesian War", "Golden Age of Athens"]
    })
    assert tl2.relatedPrompts == ["Peloponnesian War", "Golden Age of Athens"]


def test_parse_timeline_json_recovery():
    """Verify that truncated JSON from FinishReason.MAX_TOKENS is automatically recovered."""
    from services.gemini_service import parse_timeline_json

    truncated_json = '''{
      "title": "Ancient Rome",
      "description": "A timeline of Rome",
      "overview": "Overview of Roman history.",
      "lanes": [{"id": "main", "title": "Main", "color": "#2b5278", "order": 1}],
      "time_bands": [],
      "events": [
        {"id": "1", "title": "Founding of Rome", "subtitle": "Legendary founding by Romulus", "category": "Politics", "from_year": -753},
        {"id": "2", "title": "Roman Republic", "subtitle": "Overthrow of the Roman monarchy", "category": "Politics", "from_year": -509},
        {"id": "3", "title": "Battle of Zama", "subtitle": "Scipio defeats Hannibal, ending the Second Punic
    '''

    res = parse_timeline_json(truncated_json)
    assert res.title == "Ancient Rome"
    assert len(res.events) == 2
    assert res.events[0].title == "Founding of Rome"
    assert res.events[1].title == "Roman Republic"


def test_extract_response_text_without_warning():
    """Verify that extract_response_text safely handles candidate parts with thought_signature."""
    from unittest.mock import MagicMock
    from services.gemini_service import extract_response_text

    part1 = MagicMock()
    part1.text = "Hello "
    part1.thought_signature = b"binary_signature"

    part2 = MagicMock()
    part2.text = "World"
    part2.thought_signature = b"another_signature"

    mock_cand = MagicMock()
    mock_cand.content.parts = [part1, part2]

    mock_resp = MagicMock()
    mock_resp.candidates = [mock_cand]

    extracted = extract_response_text(mock_resp)
    assert extracted == "Hello World"


@pytest.mark.asyncio
async def test_temporal_disambiguation_precision():
    """Verify that temporal lifespan correctly guides resolution for shared names."""
    from services.wiki_enricher import fetch_wikipedia_summary
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "John Adams",
            client,
            sem,
            lang="en",
            context_text="American Revolution Continental Congress Declaration of Independence",
            year=1776
        )
        assert res is not None
        assert "wikiTitle" in res
        assert "president" in res.get("extract", "").lower() or "statesman" in res.get("extract", "").lower()


def test_temporal_mismatch_disqualification():
    """Verify that an entity whose lifespan completely contradicts the event year is rejected."""
    from services.wiki_enricher import score_candidate, extract_temporal_span, is_temporally_compatible

    cand = {
        "wikiTitle": "David Cohen (politician)",
        "description": "American politician",
        "extract": "David Cohen (born 1960) is an American politician and member of the Democratic Party",
        "imageUrl": "https://upload.wikimedia.org/david_cohen.jpg"
    }
    span = extract_temporal_span(f"{cand['description']} {cand['extract']}")
    assert span == (1960, None)
    assert is_temporally_compatible(1850, span) is False

    score = score_candidate(cand, "David Cohen", context_text="19th century American history", year=1850)
    assert score < 0


@pytest.mark.asyncio
async def test_descriptive_narrative_without_wikipedia_title_not_searched():
    """Verify that a long descriptive narrative sentence without a dedicated wikipedia title is NOT attached to a spurious article."""
    events = [
        {
            "id": "1",
            "title": "General Washington crosses the icy Delaware River in dense fog during Christmas night",
            "wikipedia_title": "",
            "wikipedia_title_en": "",
            "from": {"year": 1776, "month": 12, "day": 25}
        }
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="en")
    assert len(enriched) == 1
    # Because wikipedia_title was empty and title is a long descriptive sentence (> 6 words), no spurious search is executed
    assert enriched[0].get("wikiUrl") is None


def test_filename_from_url_and_image_scoring():
    """Image junk rejection and composite scoring (Phase 2)."""
    from services.wiki_enricher import score_image, _filename_from_url

    # Thumbnail + original URLs both resolve to the underlying Commons file name
    assert _filename_from_url(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_Bar.jpg/330px-Foo_Bar.jpg"
    ) == "Foo_Bar.jpg"
    assert _filename_from_url(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_Bar.jpg"
    ) == "Foo_Bar.jpg"

    # Junk categories are disqualified entirely (return None)
    assert score_image({"filename": "Flag_of_France.svg", "mime": "image/svg+xml"}) is None
    assert score_image({"filename": "Location_map_France.png", "mime": "image/png"}) is None
    assert score_image({"filename": "Commons-logo.svg"}) is None
    assert score_image({"filename": "Napoleon.ogg", "mime": "audio/ogg"}) is None

    # A real photo scores positively; lead + Wikidata canonical outrank a plain article image
    base = score_image({"filename": "Napoleon.jpg", "mime": "image/jpeg", "width": 500, "source": "article"})
    lead = score_image({"filename": "Napoleon.jpg", "mime": "image/jpeg", "width": 500, "source": "article", "isLead": True})
    p18 = score_image({"filename": "Napoleon.jpg", "mime": "image/jpeg", "width": 500, "source": "wikidata"})
    assert base is not None and lead is not None and p18 is not None
    assert lead > base
    assert p18 > base

    # Context overlap boosts a relevant caption/filename
    ctx = score_image(
        {"filename": "Battle_of_Austerlitz.jpg", "mime": "image/jpeg", "width": 500, "source": "article"},
        event_context="Battle of Austerlitz Napoleon 1805",
    )
    assert ctx > base


@pytest.mark.asyncio
async def test_image_dedup_across_timeline(monkeypatch):
    """The same image is never reused across events; higher-ranked events pick first (Phase 1)."""
    from services import wiki_enricher

    async def fake_summary(title, client, semaphore, **kwargs):
        return {
            "wikiTitle": title,
            "wikiUrl": f"https://en.wikipedia.org/wiki/{title}",
            "extract": "x",
            "imageUrl": "https://img.example/shared.jpg",
            "lat": None, "lng": None, "lang": "en",
        }

    def cand(fn, url, lead=False, width=400, source="article"):
        return {"url": url, "filename": fn, "caption": "", "width": width,
                "mime": "image/jpeg", "isLead": lead, "source": source, "key": fn.lower()}

    async def fake_candidates(title, client, semaphore, **kwargs):
        if "Alpha" in title:
            return [cand("Shared.jpg", "https://img.example/shared.jpg", lead=True),
                    cand("Alpha2.jpg", "https://img.example/alpha2.jpg")]
        return [cand("Shared.jpg", "https://img.example/shared.jpg", lead=True),
                cand("Beta2.jpg", "https://img.example/beta2.jpg")]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [
        {"id": "a", "title": "Alpha", "wikipedia_title": "Alpha", "rank": 10, "from": {"year": 1900}},
        {"id": "b", "title": "Beta", "wikipedia_title": "Beta", "rank": 5, "from": {"year": 1901}},
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="en")
    a = next(e for e in enriched if e["id"] == "a")
    b = next(e for e in enriched if e["id"] == "b")
    assert a["imageUrl"] == "https://img.example/shared.jpg"  # highest rank keeps the best image
    assert b["imageUrl"] == "https://img.example/beta2.jpg"   # deduped to its own distinct image
    assert a["imageUrl"] != b["imageUrl"]


@pytest.mark.asyncio
async def test_image_suppressed_when_no_acceptable_candidate(monkeypatch):
    """Prefer no image over an unrelated one: junk-only candidate sets yield no image."""
    from services import wiki_enricher

    async def fake_summary(title, client, semaphore, **kwargs):
        return {"wikiTitle": title, "wikiUrl": f"https://en.wikipedia.org/wiki/{title}",
                "extract": "x", "imageUrl": None, "lat": None, "lng": None, "lang": "en"}

    async def fake_candidates(title, client, semaphore, **kwargs):
        # Only a flag SVG and a location map — both disqualified by score_image
        return [
            {"url": "https://img.example/Flag.svg", "filename": "Flag_of_X.svg", "caption": "",
             "width": 400, "mime": "image/svg+xml", "isLead": True, "source": "article", "key": "flag_of_x.svg"},
            {"url": "https://img.example/Map.png", "filename": "Location_map_X.png", "caption": "",
             "width": 400, "mime": "image/png", "isLead": False, "source": "article", "key": "location_map_x.png"},
        ]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [{"id": "a", "title": "Xland", "wikipedia_title": "Xland", "rank": 8, "from": {"year": 1900}}]
    enriched = await enrich_events_with_wikipedia(events, lang="en")
    assert enriched[0].get("imageUrl") is None
    assert enriched[0].get("wikiUrl") is not None  # link is still kept


def test_token_usage_metrics_and_cost():
    from services.gemini_service import extract_token_metrics, calculate_token_cost_usd, log_token_usage_summary

    class MockUsage:
        prompt_token_count = 2500
        candidates_token_count = 12000
        thoughts_token_count = 1800
        total_token_count = 16300

    class MockResponse:
        usage_metadata = MockUsage()

    metrics = extract_token_metrics(MockResponse())
    assert metrics["prompt_tokens"] == 2500
    assert metrics["candidates_tokens"] == 12000
    assert metrics["thoughts_tokens"] == 1800
    assert metrics["total_tokens"] == 16300

    # Flash pricing: 2500*0.10/1M + (12000+1800)*0.40/1M = 0.00025 + 0.00552 = 0.00577
    cost = calculate_token_cost_usd(metrics["prompt_tokens"], metrics["candidates_tokens"], metrics["thoughts_tokens"], "gemini-3.8-flash")
    assert cost == 0.00577

    summary = log_token_usage_summary(
        operation="Test Generation",
        model_name="gemini-3.8-flash",
        label="Test Topic",
        generation_usage=metrics,
        events_count=45,
        elapsed_seconds=14.25,
        timing_breakdown={"llm": 9.10, "wikipedia": 5.15}
    )
    assert summary["totalTokens"] == 16300
    assert summary["estimatedCostUsd"] == 0.00577
    assert summary["elapsedSeconds"] == 14.25
    assert summary["timingBreakdown"]["llm"] == 9.10
    assert summary["timingBreakdown"]["wikipedia"] == 5.15

    # Verify TimelineData stores tokenUsage
    tl = TimelineData(id="test-token-tl", title="Test Token Timeline", tokenUsage=summary)
    dumped = tl.model_dump(by_alias=True)
    assert dumped["tokenUsage"]["totalTokens"] == 16300
    assert dumped["tokenUsage"]["estimatedCostUsd"] == 0.00577
    assert dumped["tokenUsage"]["elapsedSeconds"] == 14.25


@pytest.mark.asyncio
async def test_refine_timeline_condense_drops_omitted_events():
    """Asking to condense the timeline keeps only the selected events without restoring omitted ones."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, GeminiTimelineOutput, GeminiLaneItem, GeminiEventItem
    from services.gemini_service import refine_timeline_with_gemini

    initial_tl = TimelineData(
        id="tl-condense",
        title="French Revolution",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-1", title="Estates General", lane="main", **{"from": {"year": 1789}}),
            TimelineArticle(id="ev-2", title="Storming of Bastille", lane="main", **{"from": {"year": 1789}}),
            TimelineArticle(id="ev-3", title="Women's March", lane="main", **{"from": {"year": 1789}}),
            TimelineArticle(id="ev-4", title="Flight to Varennes", lane="main", **{"from": {"year": 1791}}),
            TimelineArticle(id="ev-5", title="Execution of Louis XVI", lane="main", **{"from": {"year": 1793}}),
        ]
    )

    mock_gemini_output = GeminiTimelineOutput(
        title="French Revolution - Key Milestones",
        description="Condensed to defining moments",
        overview="A condensed narrative focusing on key turning points.",
        lanes=[GeminiLaneItem(id="main", title="Main Timeline", color="#2b5278")],
        events=[
            GeminiEventItem(id="ev-2", title="Storming of the Bastille", lane="main", from_year=1789),
            GeminiEventItem(id="ev-5", title="Execution of Louis XVI", lane="main", from_year=1793),
        ],
        keep_unmentioned_events=False
    )

    mock_response = MagicMock()
    mock_response.parsed = mock_gemini_output

    with patch("services.gemini_service.get_gemini_client") as mock_get_client, \
         patch("services.gemini_service.enrich_events_with_wikipedia") as mock_enrich:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        mock_enrich.return_value = []

        refined = await refine_timeline_with_gemini(
            current_timeline=initial_tl,
            instruction="condense the timeline to just the 2 key events",
            api_key="test_key"
        )

        assert len(refined.articles) == 2
        remaining_ids = {a.id for a in refined.articles}
        assert remaining_ids == {"ev-2", "ev-5"}


@pytest.mark.asyncio
async def test_refine_timeline_condense_model_flag_omits_unmentioned():
    """AI-native keep_unmentioned_events=False correctly omits unselected events."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, GeminiTimelineOutput, GeminiLaneItem, GeminiEventItem
    from services.gemini_service import refine_timeline_with_gemini

    initial_tl = TimelineData(
        id="tl-condense-flag",
        title="French Revolution",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-1", title="Event 1", lane="main", **{"from": {"year": 1789}}),
            TimelineArticle(id="ev-2", title="Event 2", lane="main", **{"from": {"year": 1790}}),
            TimelineArticle(id="ev-3", title="Event 3", lane="main", **{"from": {"year": 1791}}),
        ]
    )

    mock_gemini_output = GeminiTimelineOutput(
        title="French Revolution",
        description="Condensed events",
        overview="Condensed overview",
        lanes=[GeminiLaneItem(id="main", title="Main Timeline", color="#2b5278")],
        events=[
            GeminiEventItem(id="ev-1", title="Event 1", lane="main", from_year=1789),
        ],
        keep_unmentioned_events=False
    )

    mock_response = MagicMock()
    mock_response.parsed = mock_gemini_output

    with patch("services.gemini_service.get_gemini_client") as mock_get_client, \
         patch("services.gemini_service.enrich_events_with_wikipedia") as mock_enrich:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        mock_enrich.return_value = []

        refined = await refine_timeline_with_gemini(
            current_timeline=initial_tl,
            instruction="condense down to the single most pivotal event",
            api_key="test_key"
        )

        assert len(refined.articles) == 1
        assert refined.articles[0].id == "ev-1"


@pytest.mark.asyncio
async def test_refine_timeline_lane_merging():
    """Merging lanes collapses lanes into a single lane and reassigns all events."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, GeminiTimelineOutput, GeminiLaneItem, GeminiEventItem
    from services.gemini_service import refine_timeline_with_gemini

    initial_tl = TimelineData(
        id="tl-merge",
        title="WWII",
        lanes=[
            TimelineLane(id="europe", title="Europe", color="#2b5278", order=1),
            TimelineLane(id="pacific", title="Pacific", color="#b84a39", order=2),
        ],
        articles=[
            TimelineArticle(id="ev-dday", title="D-Day", lane="europe", **{"from": {"year": 1944}}),
            TimelineArticle(id="ev-midway", title="Midway", lane="pacific", **{"from": {"year": 1942}}),
        ]
    )

    mock_gemini_output = GeminiTimelineOutput(
        title="WWII - Unified Timeline",
        description="Merged into a single track",
        overview="All operational theaters merged into one timeline.",
        lanes=[GeminiLaneItem(id="main", title="Main Timeline", color="#2b5278")],
        events=[
            GeminiEventItem(id="ev-dday", title="D-Day", lane="main", from_year=1944),
            GeminiEventItem(id="ev-midway", title="Midway", lane="main", from_year=1942),
        ],
        keep_unmentioned_events=True
    )

    mock_response = MagicMock()
    mock_response.parsed = mock_gemini_output

    with patch("services.gemini_service.get_gemini_client") as mock_get_client, \
         patch("services.gemini_service.enrich_events_with_wikipedia") as mock_enrich:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        mock_enrich.return_value = []

        refined = await refine_timeline_with_gemini(
            current_timeline=initial_tl,
            instruction="merge all lanes back into one single timeline",
            api_key="test_key"
        )

        assert len(refined.lanes) == 1
        assert refined.lanes[0].id == "main"
        assert len(refined.articles) == 2
        assert all(a.lane == "main" for a in refined.articles)


@pytest.mark.asyncio
async def test_apply_chat_edit_surgical_delete():
    """Chat surgical deletion removes targeted event instantly without calling full refine."""
    from unittest.mock import patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineChatOutput
    from main import _apply_chat_edit

    tl = TimelineData(
        id="tl-surg-del",
        title="Ancient Rome",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-caesar", title="Assassination of Caesar", lane="main", **{"from": {"year": -44}}),
            TimelineArticle(id="ev-augustus", title="Augustus becomes Emperor", lane="main", **{"from": {"year": -27}}),
        ]
    )

    chat_out = TimelineChatOutput(
        reply="I've removed the assassination of Caesar from the timeline.",
        action="edit",
        edit_type="event_delete",
        target_event_id="ev-caesar"
    )

    with patch("main.save_timeline_data"):
        updated = await _apply_chat_edit(
            chat_result=chat_out,
            current_timeline=tl,
            chat_key="test_key",
            chat_tier="free",
            user={"id": "user-1"}
        )

    assert updated is not None
    assert len(updated.articles) == 1
    assert updated.articles[0].id == "ev-augustus"


@pytest.mark.asyncio
async def test_apply_chat_edit_surgical_edit():
    """Chat surgical edit modifies event fields without touching other events."""
    from unittest.mock import patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineChatOutput, EventEditPayload
    from main import _apply_chat_edit

    tl = TimelineData(
        id="tl-surg-edit",
        title="Napoleonic Wars",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-waterloo", title="Waterloo", lane="main", category="General", **{"from": {"year": 1815}}),
            TimelineArticle(id="ev-austerlitz", title="Battle of Austerlitz", lane="main", category="General", **{"from": {"year": 1805}}),
        ]
    )

    chat_out = TimelineChatOutput(
        reply="Updated Battle of Waterloo with exact date and Military category.",
        action="edit",
        edit_type="event_edit",
        target_event_id="ev-waterloo",
        event_edits=EventEditPayload(
            title="Battle of Waterloo (Defeat of Napoleon)",
            category="Military",
            from_year=1815,
            from_month=6,
            from_day=18,
            importance_rank=10
        )
    )

    with patch("main.save_timeline_data"):
        updated = await _apply_chat_edit(
            chat_result=chat_out,
            current_timeline=tl,
            chat_key="test_key",
            chat_tier="free",
            user={"id": "user-1"}
        )

    assert updated is not None
    waterloo = next(a for a in updated.articles if a.id == "ev-waterloo")
    assert waterloo.title == "Battle of Waterloo (Defeat of Napoleon)"
    assert waterloo.category == "Military"
    assert waterloo.from_.month == 6
    assert waterloo.from_.day == 18
    assert waterloo.rank == 10

    # Verify other event is completely untouched
    austerlitz = next(a for a in updated.articles if a.id == "ev-austerlitz")
    assert austerlitz.title == "Battle of Austerlitz"
    assert austerlitz.category == "General"


@pytest.mark.asyncio
async def test_apply_chat_edit_surgical_add():
    """Chat surgical add enriches a new event with Wikipedia and inserts it chronologically."""
    from unittest.mock import patch, AsyncMock
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineChatOutput, NewEventPayload
    from main import _apply_chat_edit

    tl = TimelineData(
        id="tl-surg-add",
        title="American Revolution",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-1775", title="Battle of Lexington", lane="main", **{"from": {"year": 1775}}),
            TimelineArticle(id="ev-1783", title="Treaty of Paris", lane="main", **{"from": {"year": 1783}}),
        ]
    )

    chat_out = TimelineChatOutput(
        reply="Added the Declaration of Independence in 1776.",
        action="edit",
        edit_type="event_add",
        new_event=NewEventPayload(
            title="United States Declaration of Independence",
            subtitle="The 13 American colonies declared independence from Great Britain.",
            category="Politics",
            from_year=1776,
            from_month=7,
            from_day=4,
            wikipedia_title="United States Declaration of Independence"
        )
    )

    mock_enriched = [{
        "id": "raw-id",
        "title": "United States Declaration of Independence",
        "subtitle": "The 13 American colonies declared independence from Great Britain.",
        "category": "Politics",
        "lane": "main",
        "from": {"year": 1776, "month": 7, "day": 4, "precision": "day"},
        "rank": 9,
        "isToPresent": False,
        "imageUrl": "https://upload.wikimedia.org/declaration.jpg",
        "wikiTitle": "United States Declaration of Independence",
        "wikiUrl": "https://en.wikipedia.org/wiki/United_States_Declaration_of_Independence",
        "location_name": "Philadelphia, Pennsylvania",
        "lat": 39.95,
        "lng": -75.15
    }]

    with patch("main.save_timeline_data"), \
         patch("main.enrich_events_with_wikipedia", new=AsyncMock(return_value=mock_enriched)):
        updated = await _apply_chat_edit(
            chat_result=chat_out,
            current_timeline=tl,
            chat_key="test_key",
            chat_tier="free",
            user={"id": "user-1"}
        )

    assert updated is not None
    assert len(updated.articles) == 3
    # Check chronological ordering: 1775, 1776, 1783
    assert updated.articles[0].from_.year == 1775
    assert updated.articles[1].from_.year == 1776
    assert updated.articles[2].from_.year == 1783

    decl = updated.articles[1]
    assert decl.title == "United States Declaration of Independence"
    assert decl.imageUrl == "https://upload.wikimedia.org/declaration.jpg"
    assert decl.category == "Politics"
    assert decl.lat == 39.95


@pytest.mark.asyncio
async def test_chat_anchor_guardrail_complete_overhaul_refusal():
    """Asking to completely replace the timeline with an unrelated topic triggers anchor guardrail refusal."""
    from unittest.mock import MagicMock, AsyncMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineChatOutput
    from services.gemini_service import chat_about_timeline

    tl = TimelineData(
        id="tl-rome",
        title="History of Ancient Rome",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-founding", title="Founding of Rome", lane="main", **{"from": {"year": -753}}),
            TimelineArticle(id="ev-republic", title="Establishment of the Republic", lane="main", **{"from": {"year": -509}}),
        ]
    )

    # Model refuses overhaul per system prompt instructions
    mock_out = TimelineChatOutput(
        reply="I'm here to explore and refine your timeline about Ancient Rome. I cannot replace this timeline with Star Wars through the chat, but you can create a brand-new timeline about Star Wars from the home screen prompt bar!",
        action="answer",
        edit_type=None,
        edit_instruction=None,
        is_relevant=True,
        detected_language="en"
    )
    mock_response = MagicMock()
    mock_response.parsed = mock_out

    with patch("services.gemini_service.get_gemini_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client

        result, _ = await chat_about_timeline(
            current_timeline=tl,
            message="Delete this entire timeline and create a new timeline about Star Wars",
            history=[],
            api_key="test_key"
        )

    assert result.action == "answer"
    assert result.edit_instruction is None
    assert "Star Wars" in result.reply
    assert "Ancient Rome" in result.reply








