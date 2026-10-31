"""
Podcast audio pipeline.

Chapter audio is rendered once on the server, stored under a content hash (script text +
voice settings + provider version) and served from cache afterwards, so replays, shared
links and downloads cost nothing. Concurrent requests for the same clip share one render.
"""
import asyncio
from dataclasses import dataclass
import hashlib
import json
import logging
import os
import struct
import time
import weakref
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from models import PodcastTurn
from services import podcast_store
from services.podcast_tts_service import (
    PROVIDER_VERSION,
    KeyRunner,
    SynthesisResult,
    _skip_id3,
    concat_mp3,
    detect_effective_language,
    mp3_duration_seconds,
    normalize_engine,
    pcm_to_mp3,
    release_unused_memory,
    silence_pcm,
    synthesize_segment,
)

logger = logging.getLogger(__name__)

AUDIO_URL_PREFIX = "/api/podcast-audio/"
FALLBACK_RETRY_SECONDS = 600.0
CHAPTER_GAP_SECONDS = 0.6
# Bump when the continuous episode file layout changes so stored files are rebuilt.
EPISODE_AUDIO_VERSION = "1"

# Interactive chapter requests (player clicks / previews) jump ahead of background episode renders.
PRIORITY_INTERACTIVE = 0
PRIORITY_BACKGROUND = 1


def _engine_concurrency_limit(engine: str) -> int:
    norm = normalize_engine(engine)
    if norm == "gemini":
        return max(1, int(os.getenv("GEMINI_TTS_CONCURRENCY", "1")))
    if norm == "gcloud":
        return max(1, int(os.getenv("GCLOUD_TTS_CONCURRENCY", "3")))
    return max(1, int(os.getenv("EDGE_TTS_CONCURRENCY", "3")))


@dataclass
class _GateTicket:
    priority: int
    seq: int
    future: "asyncio.Future[None]"
    granted: bool = False


class _PriorityGate:
    """Loop-bound priority concurrency limiter so interactive chapter clicks preempt background renders."""

    def __init__(self, engine: str) -> None:
        self.engine = normalize_engine(engine)
        self._active = 0
        self._seq = 0
        self._waiters: List[_GateTicket] = []

    @property
    def limit(self) -> int:
        return _engine_concurrency_limit(self.engine)

    def create_ticket(self, priority: int) -> _GateTicket:
        self._seq += 1
        return _GateTicket(
            priority=priority,
            seq=self._seq,
            future=asyncio.get_running_loop().create_future(),
        )

    async def acquire(self, ticket: _GateTicket) -> None:
        if self._active < self.limit and not self._waiters:
            self._active += 1
            return
        self._waiters.append(ticket)
        try:
            await ticket.future
        except BaseException:
            if ticket in self._waiters:
                self._waiters.remove(ticket)
            elif ticket.granted:
                ticket.granted = False
                self.release()
            raise

    def release(self) -> None:
        self._waiters = [w for w in self._waiters if not w.future.done()]
        if self._waiters and self._active <= self.limit:
            best = min(self._waiters, key=lambda w: (w.priority, w.seq))
            self._waiters.remove(best)
            best.granted = True
            best.future.set_result(None)
            return
        self._active = max(0, self._active - 1)


@dataclass
class _InflightClip:
    key: str
    waiters: int = 0
    interactive_waiters: int = 0
    started_synthesis: bool = False
    ticket: Optional[_GateTicket] = None
    task: Optional["asyncio.Task[Dict[str, Any]]"] = None

    @property
    def effective_priority(self) -> int:
        return PRIORITY_INTERACTIVE if self.interactive_waiters > 0 else PRIORITY_BACKGROUND

    def sync_priority(self) -> None:
        if self.ticket is not None:
            self.ticket.priority = self.effective_priority


_engine_gates: Dict[Tuple[int, str], Tuple[weakref.ReferenceType, _PriorityGate]] = {}
_inflight: Dict[str, _InflightClip] = {}
_variant_tasks: Dict[Tuple[str, str, str], "asyncio.Task[None]"] = {}
_variant_owners: Dict[Tuple[str, str, str], Optional[str]] = {}
_episode_locks: Dict[str, asyncio.Lock] = {}


def _get_engine_gate(engine: str) -> _PriorityGate:
    loop = asyncio.get_running_loop()
    norm = normalize_engine(engine)
    gate_key = (id(loop), norm)
    existing = _engine_gates.get(gate_key)
    if existing is not None and existing[0]() is loop:
        return existing[1]
    if len(_engine_gates) > 16:
        for k, (lref, _) in list(_engine_gates.items()):
            if lref() is None:
                _engine_gates.pop(k, None)
    gate = _PriorityGate(norm)
    _engine_gates[gate_key] = (weakref.ref(loop), gate)
    return gate

PREVIEW_TEXT: Dict[str, str] = {
    "en": "Welcome to ChroniX. Let's travel through time together, one turning point at a time.",
    "he": "ברוכים הבאים לכרוניקס. בואו נצא יחד למסע בזמן, נקודת מפנה אחר נקודת מפנה.",
    "ar": "مرحبًا بكم في كرونيكس. لننطلق معًا في رحلة عبر الزمن.",
    "es": "Bienvenidos a ChroniX. Viajemos juntos a través del tiempo, un momento decisivo a la vez.",
    "fr": "Bienvenue sur ChroniX. Voyageons ensemble à travers le temps, un tournant après l'autre.",
    "de": "Willkommen bei ChroniX. Lass uns gemeinsam durch die Zeit reisen, Wendepunkt für Wendepunkt.",
    "ru": "Добро пожаловать в ChroniX. Давайте вместе отправимся в путешествие во времени.",
    "it": "Benvenuti su ChroniX. Viaggiamo insieme nel tempo, una svolta alla volta.",
    "pt": "Bem-vindos ao ChroniX. Vamos viajar juntos pelo tempo, um momento decisivo de cada vez.",
    "ja": "クロニクスへようこそ。一緒に時間を旅しましょう。",
    "zh": "欢迎来到 ChroniX。让我们一起穿越时间，探索每一个转折点。",
    "hi": "क्रोनिक्स में आपका स्वागत है। आइए साथ मिलकर समय की यात्रा करें।",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_gender(voice_gender: Optional[str]) -> str:
    return "female" if (voice_gender or "").strip().lower() == "female" else "male"


def episode_language(episode: Dict[str, Any]) -> str:
    return detect_effective_language("", episode.get("detected_language") or "en")


def clip_key(
    engine: str,
    episode: Dict[str, Any],
    segment: Dict[str, Any],
    voice_gender: Optional[str] = None,
) -> str:
    engine = normalize_engine(engine)
    gender = normalize_gender(voice_gender or episode.get("voice_gender"))
    payload = {
        "v": PROVIDER_VERSION,
        "engine": engine,
        "format": episode.get("format") or "single",
        "gender": gender,
        "lang": episode_language(episode),
        "tone": (episode.get("content_mode") or "classic") if engine == "gemini" else None,
        "turns": [[t.get("speaker") or "host1", t.get("text") or ""] for t in segment.get("turns") or []],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def clip_url(key: str) -> str:
    return f"{AUDIO_URL_PREFIX}{key}.mp3"


def _public_clip(meta: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "key": meta["key"],
        "url": clip_url(meta["key"]),
        "duration": meta.get("duration") or 0.0,
        "engine": meta.get("engine") or "edge",
        "requested_engine": meta.get("requested_engine"),
        "fallback_from": meta.get("fallback_from"),
        "turn_starts": meta.get("turn_starts") or [],
        "sentences": meta.get("sentences") or [],
        "cost_usd": meta.get("cost_usd") or 0.0,
        "model": meta.get("model") or "",
    }
    in_tok = int(meta.get("input_tokens") or 0)
    out_tok = int(meta.get("output_tokens") or 0)
    think_tok = int(meta.get("thinking_tokens") or 0)
    if in_tok > 0 or out_tok > 0 or think_tok > 0:
        out["input_tokens"] = in_tok
        out["output_tokens"] = out_tok
        out["thinking_tokens"] = think_tok
    return out


def clip_summary(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Compact clip record stored on the episode document."""
    out = {
        "key": meta["key"],
        "duration": meta.get("duration") or 0.0,
        "engine": meta.get("engine") or "edge",
        "fallback_from": meta.get("fallback_from"),
        "cost_usd": meta.get("cost_usd") or 0.0,
        "model": meta.get("model") or "",
    }
    in_tok = int(meta.get("input_tokens") or 0)
    out_tok = int(meta.get("output_tokens") or 0)
    think_tok = int(meta.get("thinking_tokens") or 0)
    if in_tok > 0 or out_tok > 0 or think_tok > 0:
        out["input_tokens"] = in_tok
        out["output_tokens"] = out_tok
        out["thinking_tokens"] = think_tok
    return out


def _needs_retry(meta: Dict[str, Any]) -> bool:
    return bool(meta.get("fallback_from")) and (time.time() - float(meta.get("created_ts") or 0)) > FALLBACK_RETRY_SECONDS


def _off_pin(meta: Dict[str, Any], model: Optional[str]) -> bool:
    """A cached Gemini clip rendered by a different model than the one the episode is pinned to."""
    return bool(model) and meta.get("engine") == "gemini" and bool(meta.get("model")) and meta.get("model") != model


async def _render_and_store(
    key: str,
    engine: str,
    episode: Dict[str, Any],
    segment: Dict[str, Any],
    key_runner: Optional[KeyRunner],
    allow_fallback: bool,
    voice_gender: Optional[str] = None,
    model: Optional[str] = None,
    inflight_entry: Optional[_InflightClip] = None,
) -> Dict[str, Any]:
    gate = _get_engine_gate(engine)
    init_priority = inflight_entry.effective_priority if inflight_entry is not None else PRIORITY_BACKGROUND
    ticket = gate.create_ticket(init_priority)
    if inflight_entry is not None:
        inflight_entry.ticket = ticket
        inflight_entry.sync_priority()
    await gate.acquire(ticket)
    if inflight_entry is not None:
        inflight_entry.started_synthesis = True
        inflight_entry.ticket = None
    try:
        turns = [
            PodcastTurn(speaker=t.get("speaker") or "host1", text=t.get("text") or "")
            for t in segment.get("turns") or []
        ]
        gender = normalize_gender(voice_gender or episode.get("voice_gender"))
        result: SynthesisResult = await synthesize_segment(
            engine,
            turns,
            format_mode=episode.get("format") or "single",
            voice_gender=gender,
            language=episode_language(episode),
            content_mode=episode.get("content_mode"),
            key_runner=key_runner,
            allow_fallback=allow_fallback,
            model=model,
        )
        meta = {
            "key": key,
            "requested_engine": normalize_engine(engine),
            "engine": result.engine,
            "fallback_from": result.fallback_from,
            "duration": result.duration,
            "turn_starts": result.turn_starts,
            "sentences": result.sentences,
            "cost_usd": result.cost_usd,
            "voice": result.voice,
            "model": result.model,
            "input_tokens": int(getattr(result, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(result, "output_tokens", 0) or 0),
            "thinking_tokens": int(getattr(result, "thinking_tokens", 0) or 0),
            "bytes": len(result.audio),
            "created_ts": time.time(),
        }
        audio_bytes = result.audio
        result.audio = b""
        await asyncio.to_thread(podcast_store.put_clip, key, audio_bytes, meta)
        del audio_bytes
        return meta
    finally:
        gate.release()


async def render_clip(
    episode: Dict[str, Any],
    segment: Dict[str, Any],
    engine: str,
    key_runner: Optional[KeyRunner] = None,
    allow_fallback: bool = True,
    voice_gender: Optional[str] = None,
    model: Optional[str] = None,
    priority: int = PRIORITY_BACKGROUND,
) -> Dict[str, Any]:
    """
    Return the stored clip for a chapter, rendering it once if needed (shared across callers).
    Gemini chapters never fall back to another engine (a different voice mid-episode is worse than
    a retry), and `model` re-renders cached Gemini clips made by a different model than the pin.
    """
    if normalize_engine(engine) == "gemini":
        allow_fallback = False
    key = clip_key(engine, episode, segment, voice_gender=voice_gender)
    meta = await asyncio.to_thread(podcast_store.get_clip_meta, key)
    if meta and not _needs_retry(meta) and not _off_pin(meta, model):
        return _public_clip(meta)

    is_interactive = priority <= PRIORITY_INTERACTIVE
    entry = _inflight.get(key)
    if entry is None or entry.task is None or entry.task.done():
        entry = _InflightClip(
            key=key,
            waiters=1,
            interactive_waiters=1 if is_interactive else 0,
        )
        task = asyncio.create_task(
            _render_and_store(
                key,
                engine,
                episode,
                segment,
                key_runner,
                allow_fallback,
                voice_gender=voice_gender,
                model=model,
                inflight_entry=entry,
            )
        )
        entry.task = task
        _inflight[key] = entry
        task.add_done_callback(lambda _t, k=key, e=entry: _inflight.pop(k, None) if _inflight.get(k) is e else None)
    else:
        entry.waiters += 1
        if is_interactive:
            entry.interactive_waiters += 1
        entry.sync_priority()

    assert entry.task is not None
    try:
        meta = await asyncio.shield(entry.task)
    except asyncio.CancelledError:
        entry.waiters = max(0, entry.waiters - 1)
        if is_interactive:
            entry.interactive_waiters = max(0, entry.interactive_waiters - 1)
        entry.sync_priority()
        if entry.waiters == 0 and not entry.started_synthesis and not entry.task.done():
            entry.task.cancel()
        raise
    except Exception:
        entry.waiters = max(0, entry.waiters - 1)
        if is_interactive:
            entry.interactive_waiters = max(0, entry.interactive_waiters - 1)
        entry.sync_priority()
        stale = await asyncio.to_thread(podcast_store.get_clip_meta, key)
        if stale:
            return _public_clip(stale)
        raise
    else:
        entry.waiters = max(0, entry.waiters - 1)
        if is_interactive:
            entry.interactive_waiters = max(0, entry.interactive_waiters - 1)
        entry.sync_priority()
    return _public_clip(meta)


# --- Episode documents -----------------------------------------------------------------------

def _episode_lock(episode_id: str) -> asyncio.Lock:
    lock = _episode_locks.get(episode_id)
    if lock is None:
        if len(_episode_locks) > 128:
            for k in [ek for ek, lk in _episode_locks.items() if not lk.locked()][:64]:
                _episode_locks.pop(k, None)
        lock = _episode_locks[episode_id] = asyncio.Lock()
    return lock


async def update_episode(
    timeline_id: str,
    episode_id: str,
    mutate: Callable[[Dict[str, Any]], None],
) -> Optional[Dict[str, Any]]:
    """Read-modify-write an episode document under a per-episode lock."""
    async with _episode_lock(episode_id):
        doc = await asyncio.to_thread(podcast_store.get_episode, timeline_id, episode_id)
        if not doc:
            return None
        mutate(doc)
        doc["updated_at"] = _now_iso()
        await asyncio.to_thread(podcast_store.save_episode, doc)
        return doc


def variant_state(doc: Dict[str, Any], engine: str) -> Dict[str, Any]:
    audio = doc.setdefault("audio", {})
    return audio.setdefault(engine, {"status": "pending", "charged": False, "clips": {}})


def gender_variant_state(doc: Dict[str, Any], engine: str, voice_gender: Optional[str] = None) -> Dict[str, Any]:
    """Per-gender audio clip map and status for `engine`, preserving both male and female renders on one script."""
    state = variant_state(doc, engine)
    doc_gender = normalize_gender(doc.get("voice_gender"))
    target_gender = normalize_gender(voice_gender or doc_gender)
    by_gender = state.setdefault("by_gender", {})
    if not by_gender and state.get("clips"):
        by_gender[doc_gender] = {
            "status": state.get("status", "pending"),
            "clips": dict(state.get("clips") or {}),
            "total_duration": state.get("total_duration"),
        }
    return by_gender.setdefault(target_gender, {"status": "pending", "clips": {}})


def sync_engine_state_for_gender(doc: Dict[str, Any], engine: str, voice_gender: Optional[str] = None) -> Dict[str, Any]:
    """Mirror the active gender's clips/status/total_duration onto top-level `audio[engine]`."""
    state = variant_state(doc, engine)
    target_gender = normalize_gender(voice_gender or doc.get("voice_gender"))
    g_state = gender_variant_state(doc, engine, target_gender)
    state["clips"] = dict(g_state.get("clips") or {})
    state["status"] = g_state.get("status", "pending")
    state["total_duration"] = g_state.get("total_duration")
    return state


def record_clip_summary(
    doc: Dict[str, Any],
    engine: str,
    segment_id: str,
    summary: Dict[str, Any],
    voice_gender: Optional[str] = None,
) -> None:
    doc_gender = normalize_gender(doc.get("voice_gender"))
    target_gender = normalize_gender(voice_gender or doc_gender)
    g_state = gender_variant_state(doc, engine, target_gender)
    clips = g_state.setdefault("clips", {})
    if clips.get(segment_id) != summary:
        g_state.pop("episode_audio", None)
    clips[segment_id] = summary
    if engine == "gemini" and summary.get("engine") == "gemini" and summary.get("model") and not pinned_model(doc, engine, target_gender):
        g_state["model"] = summary["model"]
        g_state["model_version"] = PROVIDER_VERSION
    if target_gender == doc_gender:
        variant_state(doc, engine).setdefault("clips", {})[segment_id] = summary
    episode_id = doc.get("id") or ""
    if (
        doc.get("segments")
        and not is_variant_rendering(episode_id, engine, target_gender)
        and variant_is_complete(doc, engine, target_gender)
    ):
        g_state["status"] = "ready"
        g_state["total_duration"] = round(
            sum((c or {}).get("duration") or 0 for c in clips.values()), 3
        )
        if target_gender == doc_gender:
            sync_engine_state_for_gender(doc, engine, target_gender)


def pinned_model(doc: Dict[str, Any], engine: str, voice_gender: Optional[str] = None) -> Optional[str]:
    """
    The Gemini model every chapter of this episode variant must use (set by the first rendered chapter).
    Pins reset whenever PROVIDER_VERSION changes, so a retired model never blocks re-renders.
    """
    if normalize_engine(engine) != "gemini":
        return None
    target_gender = normalize_gender(voice_gender or doc.get("voice_gender"))
    g_state = (((doc.get("audio") or {}).get(engine) or {}).get("by_gender") or {}).get(target_gender) or {}
    if g_state.get("model") and g_state.get("model_version") == PROVIDER_VERSION:
        return g_state["model"]
    return None


def render_order(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Intro first (fast first audio), then chapters in listening order."""
    intro = [s for s in segments if s.get("type") == "intro"][:1]
    return intro + [s for s in segments if s not in intro]


def variant_is_complete(doc: Dict[str, Any], engine: str, voice_gender: Optional[str] = None) -> bool:
    """Every chapter has a clip rendered with the current voice settings and provider version."""
    engine_state = (doc.get("audio") or {}).get(engine) or {}
    target_gender = normalize_gender(voice_gender or doc.get("voice_gender"))
    if voice_gender is not None or "by_gender" in engine_state:
        by_gender = engine_state.get("by_gender") or {}
        if target_gender in by_gender:
            clips = by_gender[target_gender].get("clips") or {}
        elif target_gender == normalize_gender(doc.get("voice_gender")):
            clips = engine_state.get("clips") or {}
        else:
            clips = {}
    else:
        clips = engine_state.get("clips") or {}
    return all(
        (clips.get(s.get("id")) or {}).get("key") == clip_key(engine, doc, s, voice_gender=target_gender)
        for s in doc.get("segments") or []
    )


async def _render_variant(
    timeline_id: str,
    episode_id: str,
    engine: str,
    key_runner: Optional[KeyRunner],
    on_complete: Optional[Callable[[Dict[str, Any]], Awaitable[None]]],
    voice_gender: Optional[str] = None,
) -> None:
    doc = await asyncio.to_thread(podcast_store.get_episode, timeline_id, episode_id)
    if not doc:
        return
    target_gender = normalize_gender(voice_gender or doc.get("voice_gender"))
    concurrency = 1 if engine == "gemini" else 2
    sem = asyncio.Semaphore(concurrency)
    failed: List[Dict[str, Any]] = []
    pin: Dict[str, Optional[str]] = {"model": pinned_model(doc, engine, target_gender)}

    async def _one(seg: Dict[str, Any]) -> None:
        async with sem:
            if engine == "gemini" and not pin["model"]:
                latest_doc = await asyncio.to_thread(podcast_store.get_episode, timeline_id, episode_id)
                if latest_doc:
                    pin["model"] = pinned_model(latest_doc, engine, target_gender)
            try:
                clip = await render_clip(
                    doc,
                    seg,
                    engine,
                    key_runner,
                    voice_gender=target_gender,
                    model=pin["model"],
                    priority=PRIORITY_BACKGROUND,
                )
            except Exception as e:
                failed.append(seg)
                logger.warning(f"Podcast {episode_id}: chapter {seg.get('id')} failed to render with {engine}/{target_gender}: {e}")
                return
            if engine == "gemini" and not pin["model"] and clip.get("engine") == "gemini" and clip.get("model"):
                pin["model"] = clip["model"]
            summary = clip_summary(clip)
            await update_episode(
                timeline_id, episode_id,
                lambda d: record_clip_summary(d, engine, seg["id"], summary, target_gender),
            )

    ordered = render_order(doc.get("segments") or [])
    try:
        if ordered:
            if engine == "gemini":
                # Render sequentially so at most one background chapter waits in memory at a time
                # and interactive user chapter skips jump straight to the front of the gate.
                for seg in ordered:
                    await _one(seg)
            else:
                await _one(ordered[0])
                await asyncio.gather(*(_one(s) for s in ordered[1:]))
        retry, failed[:] = list(failed), []
        for seg in retry:
            await _one(seg)
    except asyncio.CancelledError:
        def _mark_cancelled(d: Dict[str, Any]) -> None:
            g_state = gender_variant_state(d, engine, target_gender)
            if variant_is_complete(d, engine, target_gender):
                g_state["status"] = "ready"
            else:
                g_state["status"] = "partial" if g_state.get("clips") else "pending"
            g_state["total_duration"] = round(
                sum((c or {}).get("duration") or 0 for c in (g_state.get("clips") or {}).values()), 3
            )
            if normalize_gender(d.get("voice_gender")) == target_gender:
                sync_engine_state_for_gender(d, engine, target_gender)

        try:
            cancelled_doc = await asyncio.shield(update_episode(timeline_id, episode_id, _mark_cancelled))
            if cancelled_doc and on_complete:
                await asyncio.shield(on_complete(cancelled_doc))
        except Exception as e:
            logger.debug(f"Podcast {episode_id}: cancelled variant cleanup skipped: {e}")
        release_unused_memory()
        raise

    failures = len(failed)

    episode_file: Optional[Dict[str, Any]] = None
    if not failures:
        try:
            episode_file = await build_episode_audio(doc, engine, voice_gender=target_gender, model=pin["model"])
        except Exception as e:
            logger.warning(f"Podcast {episode_id}: continuous episode audio failed for {engine}/{target_gender}: {e}")

    def _finish(d: Dict[str, Any]) -> None:
        g_state = gender_variant_state(d, engine, target_gender)
        g_state["status"] = "ready" if variant_is_complete(d, engine, target_gender) else ("error" if failures else "partial")
        g_state["total_duration"] = round(sum((c or {}).get("duration") or 0 for c in g_state["clips"].values()), 3)
        if episode_file and g_state["status"] == "ready":
            g_state["episode_audio"] = episode_audio_summary(episode_file)
        if normalize_gender(d.get("voice_gender")) == target_gender:
            sync_engine_state_for_gender(d, engine, target_gender)

    final = await update_episode(timeline_id, episode_id, _finish)
    if final and on_complete:
        try:
            await on_complete(final)
        except Exception as e:
            logger.warning(f"Podcast {episode_id}: variant completion hook failed: {e}")
    release_unused_memory()


def cancel_episode_renders(episode_id: str, engine: Optional[str] = None) -> int:
    """Cancel any running background variant render tasks for `episode_id`."""
    norm_eng = normalize_engine(engine) if engine else None
    cancelled = 0
    for (ep, eng, gender), task in list(_variant_tasks.items()):
        if ep == episode_id and (norm_eng is None or eng == norm_eng) and not task.done():
            task.cancel()
            cancelled += 1
    return cancelled


def ensure_variant_render(
    timeline_id: str,
    episode_id: str,
    engine: str,
    key_runner: Optional[KeyRunner] = None,
    on_complete: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    voice_gender: Optional[str] = None,
    owner_id: Optional[str] = None,
) -> bool:
    """Start rendering every chapter of an episode in the background. Returns False if already running."""
    norm_engine = normalize_engine(engine)
    target_gender = normalize_gender(voice_gender)
    task_key = (episode_id, norm_engine, target_gender)
    running = _variant_tasks.get(task_key)
    if running and not running.done():
        return False

    # Never let one user accumulate multiple abandoned background Gemini episode renders in parallel.
    if norm_engine == "gemini" and owner_id:
        for other_key, other_task in list(_variant_tasks.items()):
            if other_key != task_key and other_key[1] == "gemini" and not other_task.done():
                if _variant_owners.get(other_key) == owner_id:
                    logger.info(
                        "Cancelling superseded background Gemini render %s for owner %s (starting %s)",
                        other_key[0],
                        owner_id,
                        episode_id,
                    )
                    other_task.cancel()

    task = asyncio.create_task(
        _render_variant(timeline_id, episode_id, norm_engine, key_runner, on_complete, voice_gender=target_gender)
    )
    _variant_tasks[task_key] = task
    _variant_owners[task_key] = owner_id

    def _cleanup(_t: "asyncio.Task[None]", k: Tuple[str, str, str] = task_key, created: "asyncio.Task[None]" = task) -> None:
        if _variant_tasks.get(k) is created:
            _variant_tasks.pop(k, None)
            _variant_owners.pop(k, None)

    task.add_done_callback(_cleanup)
    return True


def is_variant_rendering(episode_id: str, engine: str, voice_gender: Optional[str] = None) -> bool:
    if voice_gender is not None:
        task = _variant_tasks.get((episode_id, engine, normalize_gender(voice_gender)))
        return bool(task and not task.done())
    return any(
        ep == episode_id and eng == engine and not t.done()
        for (ep, eng, _g), t in list(_variant_tasks.items())
    )


# --- Download --------------------------------------------------------------------------------

_gap_mp3: Optional[bytes] = None


def _chapter_gap() -> bytes:
    global _gap_mp3
    if _gap_mp3 is None:
        _gap_mp3 = pcm_to_mp3(silence_pcm(CHAPTER_GAP_SECONDS))
    return _gap_mp3


def _id3_text_frame(frame_id: str, text: str) -> bytes:
    body = b"\x01" + "\ufeff".encode("utf-16-le") + text.encode("utf-16-le")
    return frame_id.encode("ascii") + struct.pack(">I", len(body)) + b"\x00\x00" + body


def build_id3_tag(title: str, artist: str = "ChroniX", album: str = "ChroniX Podcasts") -> bytes:
    """Minimal ID3v2.3 tag so downloaded episodes show a proper title in media players."""
    frames = b"".join(
        _id3_text_frame(fid, txt) for fid, txt in (("TIT2", title), ("TPE1", artist), ("TALB", album)) if txt
    )
    size = len(frames)
    syncsafe = bytes([(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127])
    return b"ID3\x03\x00\x00" + syncsafe + frames


async def build_episode_mp3(
    episode: Dict[str, Any],
    engine: str,
    key_runner: Optional[KeyRunner] = None,
    voice_gender: Optional[str] = None,
) -> bytes:
    model = pinned_model(episode, engine, voice_gender)
    buf = bytearray(build_id3_tag(episode.get("title") or "ChroniX Podcast"))
    gap = _chapter_gap()
    gap_view = memoryview(gap)[_skip_id3(gap):]
    for idx, seg in enumerate(episode.get("segments") or []):
        clip = await render_clip(
            episode, seg, engine, key_runner, voice_gender=voice_gender, model=model, priority=PRIORITY_BACKGROUND
        )
        audio = await asyncio.to_thread(podcast_store.get_clip_audio, clip["key"])
        if not audio:
            raise RuntimeError(f"Audio for chapter {seg.get('id')} is unavailable.")
        if idx:
            buf.extend(gap_view)
        buf.extend(memoryview(audio)[_skip_id3(audio):])
        del audio
    data = bytes(buf)
    del buf
    release_unused_memory()
    return data


# --- Continuous episode audio ------------------------------------------------------------------
# Mobile browsers leave an audible gap whenever the <audio> source is swapped between chapter
# files, so once every chapter is rendered the player streams one continuous file and treats
# chapters as time offsets inside it.

def episode_audio_key(clip_metas: List[Dict[str, Any]], title: str) -> str:
    payload = {
        "v": EPISODE_AUDIO_VERSION,
        "gap": CHAPTER_GAP_SECONDS,
        "title": title,
        "clips": [[m.get("key"), m.get("created_ts")] for m in clip_metas],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _public_episode_audio(meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": meta["key"],
        "url": clip_url(meta["key"]),
        "duration": meta.get("duration") or 0.0,
        "chapters": meta.get("chapters") or [],
    }


def episode_audio_summary(manifest: Dict[str, Any]) -> Dict[str, Any]:
    """Compact record of the continuous file stored on the episode document."""
    return {"key": manifest["key"], "duration": manifest.get("duration") or 0.0}


async def build_episode_audio(
    episode: Dict[str, Any],
    engine: str,
    voice_gender: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Join the already-rendered chapters into one continuous MP3 (stored like a clip, so it is served
    with Range support) and return its manifest: URL, duration and each chapter's start offset with
    its transcript timings. Returns None while any chapter is missing — this never renders speech.
    """
    segments = episode.get("segments") or []
    if not segments:
        return None
    gender = normalize_gender(voice_gender or episode.get("voice_gender"))
    metas: List[Dict[str, Any]] = []
    for seg in segments:
        meta = await asyncio.to_thread(podcast_store.get_clip_meta, clip_key(engine, episode, seg, voice_gender=gender))
        if not meta or _off_pin(meta, model):
            return None
        metas.append(meta)

    title = episode.get("title") or "ChroniX Podcast"
    key = episode_audio_key(metas, title)
    existing = await asyncio.to_thread(podcast_store.get_clip_meta, key)
    if existing and existing.get("kind") == "episode":
        return _public_episode_audio(existing)

    gap = _chapter_gap()
    gap_duration = mp3_duration_seconds(gap)
    gap_view = memoryview(gap)[_skip_id3(gap):]
    buf = bytearray(build_id3_tag(title))
    chapters: List[Dict[str, Any]] = []
    cursor = 0.0
    for idx, (seg, meta) in enumerate(zip(segments, metas)):
        audio = await asyncio.to_thread(podcast_store.get_clip_audio, meta["key"])
        if not audio:
            return None
        if idx:
            buf.extend(gap_view)
            cursor += gap_duration
        duration = mp3_duration_seconds(audio)
        chapters.append({
            "id": seg.get("id"),
            "start": round(cursor, 3),
            "duration": round(duration, 3),
            "turn_starts": meta.get("turn_starts") or [],
            "sentences": meta.get("sentences") or [],
        })
        buf.extend(memoryview(audio)[_skip_id3(audio):])
        del audio
        cursor += duration

    data = bytes(buf)
    del buf
    stored = {
        "key": key,
        "kind": "episode",
        "engine": normalize_engine(engine),
        "duration": round(cursor, 3),
        "chapters": chapters,
        "bytes": len(data),
        "created_ts": time.time(),
    }
    await asyncio.to_thread(podcast_store.put_clip, key, data, stored)
    del data
    release_unused_memory()
    return _public_episode_audio(stored)


async def get_episode_audio(
    doc: Dict[str, Any],
    engine: str,
    voice_gender: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """The continuous-file manifest for a fully rendered variant (built on first request), else None."""
    gender = normalize_gender(voice_gender or doc.get("voice_gender"))
    if is_variant_rendering(doc["id"], engine, gender) or not variant_is_complete(doc, engine, gender):
        return None
    stored = ((((doc.get("audio") or {}).get(engine) or {}).get("by_gender") or {}).get(gender) or {}).get("episode_audio") or {}
    if stored.get("key"):
        meta = await asyncio.to_thread(podcast_store.get_clip_meta, stored["key"])
        if meta and meta.get("kind") == "episode":
            return _public_episode_audio(meta)

    manifest = await build_episode_audio(doc, engine, voice_gender=gender, model=pinned_model(doc, engine, gender))
    if manifest and doc.get("timeline_id"):
        summary = episode_audio_summary(manifest)

        def _record(d: Dict[str, Any]) -> None:
            if variant_is_complete(d, engine, gender):
                gender_variant_state(d, engine, gender)["episode_audio"] = summary

        try:
            await update_episode(doc["timeline_id"], doc["id"], _record)
        except Exception as e:
            logger.warning(f"Could not record continuous audio on episode {doc.get('id')}: {e}")
    return manifest


# --- Voice previews --------------------------------------------------------------------------

def preview_language(lang: Optional[str]) -> str:
    code = detect_effective_language("", lang)
    return code if code in PREVIEW_TEXT else "en"


async def render_voice_preview(
    engine: str,
    voice_gender: str,
    language: Optional[str],
    format_mode: str = "single",
    key_runner: Optional[KeyRunner] = None,
) -> Dict[str, Any]:
    lang = preview_language(language)
    text = PREVIEW_TEXT[lang]
    episode = {"format": "single", "voice_gender": voice_gender, "detected_language": lang, "content_mode": "classic"}
    segment = {"id": "preview", "turns": [{"speaker": "host1", "text": text}]}
    if format_mode == "duo":
        sentences = text.split(". ", 1)
        if len(sentences) == 2:
            episode["format"] = "duo"
            segment["turns"] = [
                {"speaker": "host1", "text": sentences[0] + "."},
                {"speaker": "host2", "text": sentences[1]},
            ]
    return await render_clip(
        episode, segment, engine, key_runner, allow_fallback=False, priority=PRIORITY_INTERACTIVE
    )
