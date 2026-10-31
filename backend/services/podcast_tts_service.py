"""
Text-to-speech providers for ChroniX podcasts.

Every provider returns the same audio format — 24 kHz mono 48 kbps MP3 (MPEG-2 Layer III) —
so clips from any engine can be cached, streamed, concatenated and downloaded as one file.
Each result also carries exact per-turn start times and sentence timings (exact for Edge,
proportional estimates for Google Cloud and Gemini) for transcript highlighting.
"""
import asyncio
import base64
import ctypes
import gc
import io
import logging
import math
import os
import re
import struct
import sys
import time
import wave
from array import array
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional, Tuple

import edge_tts
import httpx
import lameenc
from google import genai
from google.genai import types

from models import PodcastTurn
from services.gemini_service import get_gemini_client
from services.quota_service import (
    get_google_cloud_tts_remaining_chars,
    refund_google_cloud_tts_chars,
    reserve_google_cloud_tts_chars,
)

logger = logging.getLogger(__name__)

# Bump whenever voices, prompts or encoding change so cached clips are re-rendered.
PROVIDER_VERSION = "7"

TARGET_SAMPLE_RATE = 24000
TARGET_BITRATE_KBPS = 48
GEMINI_TTS_TIMEOUT_SECONDS = max(5.0, float(os.getenv("GEMINI_TTS_TIMEOUT_SECONDS", "60")))

_LIBC_MALLOC_TRIM: Any = False


def release_unused_memory() -> None:
    """Reclaim cyclic Python garbage and return free glibc heap pages to the OS on Linux."""
    global _LIBC_MALLOC_TRIM
    try:
        gc.collect()
    except Exception:
        pass
    if not sys.platform.startswith("linux"):
        return
    if _LIBC_MALLOC_TRIM is False:
        try:
            libc = ctypes.CDLL("libc.so.6")
            trim_fn = libc.malloc_trim
            trim_fn.argtypes = [ctypes.c_size_t]
            trim_fn.restype = ctypes.c_int
            _LIBC_MALLOC_TRIM = trim_fn
        except Exception:
            _LIBC_MALLOC_TRIM = None
    if _LIBC_MALLOC_TRIM is not None:
        try:
            _LIBC_MALLOC_TRIM(0)
        except Exception:
            pass

EngineName = Literal["edge", "gcloud", "gemini"]
ENGINES: Tuple[str, ...] = ("edge", "gcloud", "gemini")

EDGE_VOICES_BY_LANG: Dict[str, Dict[str, str]] = {
    "he": {"male": "he-IL-AvriNeural", "female": "he-IL-HilaNeural"},
    "en": {"male": "en-US-AndrewMultilingualNeural", "female": "en-US-AvaMultilingualNeural"},
    "ar": {"male": "ar-SA-HamedNeural", "female": "ar-SA-ZariyahNeural"},
    "es": {"male": "es-ES-AlvaroNeural", "female": "es-ES-ElviraNeural"},
    "fr": {"male": "fr-FR-RemyMultilingualNeural", "female": "fr-FR-VivienneMultilingualNeural"},
    "de": {"male": "de-DE-FlorianMultilingualNeural", "female": "de-DE-SeraphinaMultilingualNeural"},
    "ru": {"male": "ru-RU-DmitryNeural", "female": "ru-RU-SvetlanaNeural"},
    "it": {"male": "it-IT-GiuseppeMultilingualNeural", "female": "it-IT-IsabellaNeural"},
    "pt": {"male": "pt-BR-AntonioNeural", "female": "pt-BR-FranciscaNeural"},
    "ja": {"male": "ja-JP-KeitaNeural", "female": "ja-JP-NanamiNeural"},
    "zh": {"male": "zh-CN-YunxiNeural", "female": "zh-CN-XiaoxiaoNeural"},
}

GOOGLE_CLOUD_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

# Google Cloud TTS WaveNet voices corresponding to each Edge voice (1M chars/month free tier).
GOOGLE_CLOUD_VOICE_FOR_EDGE_VOICE: Dict[str, Tuple[str, str]] = {
    "he-IL-AvriNeural": ("he-IL", "he-IL-Wavenet-D"),
    "he-IL-HilaNeural": ("he-IL", "he-IL-Wavenet-A"),
    "en-US-AndrewMultilingualNeural": ("en-US", "en-US-Wavenet-D"),
    "en-US-AvaMultilingualNeural": ("en-US", "en-US-Wavenet-F"),
    "ar-SA-HamedNeural": ("ar-XA", "ar-XA-Wavenet-B"),
    "ar-SA-ZariyahNeural": ("ar-XA", "ar-XA-Wavenet-A"),
    "es-ES-AlvaroNeural": ("es-ES", "es-ES-Wavenet-B"),
    "es-ES-ElviraNeural": ("es-ES", "es-ES-Wavenet-C"),
    "fr-FR-RemyMultilingualNeural": ("fr-FR", "fr-FR-Wavenet-B"),
    "fr-FR-VivienneMultilingualNeural": ("fr-FR", "fr-FR-Wavenet-C"),
    "de-DE-FlorianMultilingualNeural": ("de-DE", "de-DE-Wavenet-B"),
    "de-DE-SeraphinaMultilingualNeural": ("de-DE", "de-DE-Wavenet-F"),
    "ru-RU-DmitryNeural": ("ru-RU", "ru-RU-Wavenet-B"),
    "ru-RU-SvetlanaNeural": ("ru-RU", "ru-RU-Wavenet-A"),
    "it-IT-GiuseppeMultilingualNeural": ("it-IT", "it-IT-Wavenet-C"),
    "it-IT-IsabellaNeural": ("it-IT", "it-IT-Wavenet-A"),
    "pt-BR-AntonioNeural": ("pt-BR", "pt-BR-Wavenet-B"),
    "pt-BR-FranciscaNeural": ("pt-BR", "pt-BR-Wavenet-A"),
    "ja-JP-KeitaNeural": ("ja-JP", "ja-JP-Wavenet-C"),
    "ja-JP-NanamiNeural": ("ja-JP", "ja-JP-Wavenet-B"),
    "zh-CN-YunxiNeural": ("cmn-CN", "cmn-CN-Wavenet-B"),
    "zh-CN-XiaoxiaoNeural": ("cmn-CN", "cmn-CN-Wavenet-A"),
}

_gcloud_tts_disabled_until: Dict[str, float] = {}
_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_GCLOUD_CLIENT: Optional[httpx.AsyncClient] = None
_SHARED_GCLOUD_CLIENT_LOOP_ID: Optional[int] = None


@asynccontextmanager
async def _gcloud_http_client():
    """Reuse a persistent loop-bound AsyncClient for Google Cloud TTS calls unless monkeypatched."""
    global _SHARED_GCLOUD_CLIENT, _SHARED_GCLOUD_CLIENT_LOOP_ID
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        client_cls = httpx.AsyncClient
        async with client_cls(follow_redirects=True) as client:
            yield client
        return
    loop_id = id(asyncio.get_running_loop())
    if (
        _SHARED_GCLOUD_CLIENT is None
        or _SHARED_GCLOUD_CLIENT.is_closed
        or _SHARED_GCLOUD_CLIENT_LOOP_ID != loop_id
    ):
        if _SHARED_GCLOUD_CLIENT is not None and not _SHARED_GCLOUD_CLIENT.is_closed:
            try:
                await _SHARED_GCLOUD_CLIENT.aclose()
            except Exception:
                pass
        _SHARED_GCLOUD_CLIENT = _ORIG_ASYNC_CLIENT(
            follow_redirects=True,
            timeout=20.0,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
        )
        _SHARED_GCLOUD_CLIENT_LOOP_ID = loop_id
    yield _SHARED_GCLOUD_CLIENT

# Gemini prebuilt voices (Charon = deep narrative male, Aoede = warm articulate female)
GEMINI_VOICES: Dict[str, str] = {"male": "Charon", "female": "Aoede"}

_HEBREW_RE = re.compile(r"[\u0590-\u05FF]")
_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?。！？])\s+")


@dataclass
class SynthesisResult:
    audio: bytes
    duration: float
    engine: str
    turn_starts: List[float] = field(default_factory=list)
    sentences: List[Dict[str, Any]] = field(default_factory=list)
    cost_usd: float = 0.0
    voice: str = ""
    model: str = ""
    fallback_from: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0


# --- Text helpers ---------------------------------------------------------------------------

def clean_text_for_tts(text: str) -> str:
    """Strip markdown formatting, stage directions in brackets, and excess whitespace before TTS."""
    if not text:
        return ""
    cleaned = str(text)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"\[[^\]]{1,40}\]", " ", cleaned)
    # Angle brackets are vocal-event tags for Gemini TTS (e.g. <sigh>); never pass them through.
    cleaned = re.sub(r"<[^<>]{0,40}>", " ", cleaned).replace("<", " ").replace(">", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def detect_effective_language(text: str, hint_lang: Optional[str] = "en") -> str:
    """Detect effective 2-letter language code from text script first, falling back to hint_lang."""
    if _HEBREW_RE.search(text or ""):
        return "he"
    if _ARABIC_RE.search(text or ""):
        return "ar"
    if _CYRILLIC_RE.search(text or ""):
        return "ru"
    code = (hint_lang or "en").strip().lower()[:2]
    return code if code else "en"


def _norm_gender(gender: Optional[str]) -> str:
    return "female" if (gender or "").lower() == "female" else "male"


def _other_gender(gender: str) -> str:
    return "male" if gender == "female" else "female"


def _turn_gender(turn: PodcastTurn, fmt: str, primary: str) -> str:
    return _other_gender(primary) if (fmt == "duo" and turn.speaker == "host2") else primary


def _valid_turns(turns: List[PodcastTurn]) -> List[PodcastTurn]:
    out = [PodcastTurn(speaker=t.speaker, text=clean_text_for_tts(t.text)) for t in (turns or [])]
    out = [t for t in out if t.text]
    if not out:
        raise ValueError("No spoken text to synthesize.")
    return out


def split_sentences(text: str) -> List[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(text or "") if p and p.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


def estimate_sentences(text: str, start: float, end: float, turn_index: int) -> List[Dict[str, Any]]:
    """Spread a turn's sentences across [start, end] proportionally to their character length."""
    sentences = split_sentences(text)
    if not sentences:
        return []
    total = sum(max(1, len(s)) for s in sentences)
    span = max(0.0, end - start)
    out, cursor = [], start
    for s in sentences:
        d = span * max(1, len(s)) / total
        out.append({"start": round(cursor, 3), "end": round(cursor + d, 3), "turn": turn_index, "text": s})
        cursor += d
    return out


def proportional_turn_starts(turns: List[PodcastTurn], duration: float) -> List[float]:
    lengths = [max(1, len(t.text)) for t in turns]
    total = sum(lengths)
    starts, acc = [], 0.0
    for n in lengths:
        starts.append(round(duration * acc / total, 3))
        acc += n
    return starts


def get_edge_voice(lang: str, gender: str) -> str:
    """Return the Edge neural voice name for the given language and gender ('male' or 'female')."""
    norm_lang = detect_effective_language("", lang)
    voice_pair = EDGE_VOICES_BY_LANG.get(norm_lang, EDGE_VOICES_BY_LANG["en"])
    return voice_pair[_norm_gender(gender)]


def get_google_cloud_tts_api_key() -> str:
    """
    Return the API key for Google Cloud Text-to-Speech (`GOOGLE_CLOUD_TTS_API_KEY` or `GOOGLE_TTS_API_KEY`,
    falling back to `GCLOUD_API_KEY` when shared on the same GCP project).
    Set `GOOGLE_CLOUD_TTS_ENABLED=false` to disable.
    """
    if os.getenv("GOOGLE_CLOUD_TTS_ENABLED", "true").strip().lower() in ("0", "false", "no", "off"):
        return ""
    return (
        os.getenv("GOOGLE_CLOUD_TTS_API_KEY")
        or os.getenv("GOOGLE_TTS_API_KEY")
        or os.getenv("GCLOUD_API_KEY")
        or ""
    ).strip()


def get_google_cloud_voice(edge_voice: str) -> Tuple[str, str]:
    """Return `(language_code, voice_name)` for Google Cloud TTS corresponding to `edge_voice`."""
    if edge_voice == "he-IL-AvriNeural":
        override = (os.getenv("GOOGLE_CLOUD_TTS_HE_MALE_VOICE") or "").strip()
        if override:
            return "he-IL", override
    elif edge_voice == "he-IL-HilaNeural":
        override = (os.getenv("GOOGLE_CLOUD_TTS_HE_FEMALE_VOICE") or "").strip()
        if override:
            return "he-IL", override
    return GOOGLE_CLOUD_VOICE_FOR_EDGE_VOICE.get(edge_voice, ("en-US", "en-US-Wavenet-D"))


async def synthesize_turn_google_cloud(text: str, edge_voice: str, api_key: str) -> bytes:
    """Synthesize a single turn via Google Cloud Text-to-Speech REST API and encode to canonical MP3."""
    char_count = len(text or "")
    if not await asyncio.to_thread(reserve_google_cloud_tts_chars, char_count):
        raise RuntimeError("Google Cloud TTS monthly character cap (950,000) reached.")
    lang_code, voice_name = get_google_cloud_voice(edge_voice)
    payload = {
        "input": {"text": text},
        "voice": {"languageCode": lang_code, "name": voice_name},
        "audioConfig": {
            "audioEncoding": "LINEAR16",
            "sampleRateHertz": TARGET_SAMPLE_RATE,
        },
    }
    try:
        async with _gcloud_http_client() as client:
            resp = await client.post(
                GOOGLE_CLOUD_TTS_URL,
                # Header, not ?key=: httpx logs full request URLs at INFO, which leaked the key into logs.
                headers={"X-Goog-Api-Key": api_key},
                json=payload,
                timeout=20.0,
            )
            if resp.status_code in (401, 403):
                _gcloud_tts_disabled_until[api_key] = time.time() + 60.0
                raise RuntimeError(f"Google Cloud TTS HTTP {resp.status_code}: {resp.text[:240]}")
            resp.raise_for_status()
            data = resp.json()
        audio_b64 = (data.get("audioContent") or "").strip()
        del data, resp
        if not audio_b64:
            raise ValueError(f"Google Cloud TTS returned empty audioContent for voice {voice_name}")
        audio_bytes, kind, rate, channels = _decode_audio_to_pcm_or_mp3(audio_b64, "audio/wav")
        del audio_b64
        if kind == "mp3":
            return audio_bytes
        if rate != TARGET_SAMPLE_RATE:
            audio_bytes = resample_pcm(audio_bytes, rate)
            rate = TARGET_SAMPLE_RATE
        return pcm_to_mp3(audio_bytes, rate, channels)
    except Exception:
        await asyncio.to_thread(refund_google_cloud_tts_chars, char_count)
        raise


# --- Audio helpers ---------------------------------------------------------------------------

_MPEG_BITRATES = {
    # (version_is_mpeg1, layer3) -> bitrate table index 1..14 in kbps
    True: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    False: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_MPEG_SAMPLE_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def _skip_id3(data: bytes) -> int:
    if len(data) >= 10 and data[:3] == b"ID3":
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        return 10 + size
    return 0


def mp3_duration_seconds(data: bytes) -> float:
    """Exact duration of an MPEG Layer III stream, computed by walking its frame headers."""
    pos = _skip_id3(data)
    n = len(data)
    total = 0.0
    while pos + 4 <= n:
        b1, b2, b3 = data[pos + 1], data[pos + 2], data[pos + 3]
        if data[pos] != 0xFF or (b1 & 0xE0) != 0xE0:
            pos += 1
            continue
        version_bits = (b1 >> 3) & 0x03
        layer_bits = (b1 >> 1) & 0x03
        bitrate_idx = (b2 >> 4) & 0x0F
        sr_idx = (b2 >> 2) & 0x03
        padding = (b2 >> 1) & 0x01
        if version_bits == 1 or layer_bits != 1 or bitrate_idx in (0, 15) or sr_idx == 3:
            pos += 1
            continue
        is_mpeg1 = version_bits == 3
        bitrate = _MPEG_BITRATES[is_mpeg1][bitrate_idx] * 1000
        sample_rate = _MPEG_SAMPLE_RATES[version_bits][sr_idx]
        samples = 1152 if is_mpeg1 else 576
        frame_len = (samples // 8 * bitrate) // sample_rate + padding
        if frame_len <= 0:
            pos += 1
            continue
        total += samples / sample_rate
        pos += frame_len
    return round(total, 3)


def concat_mp3(parts: List[bytes]) -> bytes:
    """Join MP3 clips of identical format into one stream (ID3 headers are dropped)."""
    return b"".join(memoryview(p)[_skip_id3(p):] for p in parts if p)


def _pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 24000, channels: int = 1, sampwidth: int = 2) -> bytes:
    """Wrap raw 16-bit signed little-endian PCM bytes into a standard RIFF WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


def wav_to_pcm(wav_bytes: bytes) -> Tuple[bytes, int, int]:
    """Return (pcm16, sample_rate, channels) from a WAV buffer (handles extra RIFF chunks)."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as rf:
        if rf.getsampwidth() != 2:
            raise ValueError("Only 16-bit PCM WAV audio is supported.")
        return rf.readframes(rf.getnframes()), rf.getframerate() or TARGET_SAMPLE_RATE, rf.getnchannels() or 1


def _downmix_to_mono(pcm: bytes, channels: int) -> bytes:
    if channels <= 1:
        return pcm
    count = len(pcm) // (2 * channels)
    samples = _pcm16_array(pcm[: count * channels * 2])
    out = array("h", (sum(samples[i * channels:(i + 1) * channels]) // channels for i in range(count)))
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


def pcm_to_mp3(pcm: bytes, sample_rate: int = TARGET_SAMPLE_RATE, channels: int = 1) -> bytes:
    """Encode 16-bit PCM to the canonical 24 kHz mono 48 kbps MP3 used for every podcast clip."""
    mono = _downmix_to_mono(pcm, channels)
    del pcm
    enc = lameenc.Encoder()
    enc.set_bit_rate(TARGET_BITRATE_KBPS)
    enc.set_in_sample_rate(sample_rate)
    enc.set_out_sample_rate(TARGET_SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    step = max(2, sample_rate * 2 * 4)
    buf = bytearray()
    for offset in range(0, len(mono), step):
        chunk = enc.encode(mono[offset:offset + step])
        if chunk:
            buf.extend(chunk)
    tail = enc.flush()
    if tail:
        buf.extend(tail)
    del mono
    data = bytes(buf)
    del buf
    return data


def silence_pcm(seconds: float, sample_rate: int = TARGET_SAMPLE_RATE) -> bytes:
    return b"\x00\x00" * int(max(0.0, seconds) * sample_rate)


# --- Loudness normalization -----------------------------------------------------------------
# Generative TTS renders every chapter at a slightly different level; bringing each one to the
# same gated speech loudness keeps the host sounding like one continuous recording.

SPEECH_TARGET_DBFS = -19.0
_LOUDNESS_BLOCK_SEC = 0.4
_ABSOLUTE_GATE_DBFS = -60.0
_RELATIVE_GATE_DB = -10.0
_MAX_GAIN_DB = 12.0
_MIN_GAIN_CHANGE_DB = 0.25
_LIMITER_THRESHOLD = 0.75
_LIMITER_CEILING = 0.97
_FULL_SCALE_SQ = 32768.0 ** 2


def _pcm16_array(pcm: bytes, typecode: str = "h") -> array:
    samples = array(typecode)
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if sys.byteorder == "big":
        samples.byteswap()
    return samples


def _sum_squares(samples: array) -> float:
    if hasattr(math, "sumprod"):
        return float(math.sumprod(samples, samples))
    return float(sum(v * v for v in samples))


def speech_level_dbfs(pcm: bytes, sample_rate: int = TARGET_SAMPLE_RATE) -> Optional[float]:
    """Gated RMS level of mono 16-bit PCM (BS.1770-style gating, unweighted). None for silence."""
    samples = _pcm16_array(pcm)
    if not samples:
        return None
    block = max(1, int(sample_rate * _LOUDNESS_BLOCK_SEC))
    energies = [
        _sum_squares(samples[i:i + block]) / block
        for i in range(0, len(samples) - block + 1, block)
    ] or [_sum_squares(samples) / len(samples)]
    gated = [e for e in energies if e > _FULL_SCALE_SQ * 10 ** (_ABSOLUTE_GATE_DBFS / 10)]
    if not gated:
        return None
    threshold = (sum(gated) / len(gated)) * 10 ** (_RELATIVE_GATE_DB / 10)
    speech = [e for e in gated if e > threshold] or gated
    return 10 * math.log10((sum(speech) / len(speech)) / _FULL_SCALE_SQ)


@lru_cache(maxsize=8)
def _gain_lut(gain_db: float) -> array:
    """Sample map (indexed by the unsigned 16-bit pattern) applying `gain_db` plus a soft peak limiter.

    Stored as a compact int16 array (128 KB) rather than a tuple of 65,536 Python ints (~2.3 MB).
    """
    gain = 10 ** (gain_db / 20)
    knee = _LIMITER_CEILING - _LIMITER_THRESHOLD
    out = array("h", bytes(2 * 65536))
    for u in range(65536):
        x = (u - 65536 if u >= 32768 else u) / 32768.0 * gain
        ax = abs(x)
        if ax > _LIMITER_THRESHOLD:
            ax = _LIMITER_THRESHOLD + knee * math.tanh((ax - _LIMITER_THRESHOLD) / knee)
        out[u] = max(-32768, min(32767, int(round(math.copysign(ax, x) * 32767))))
    return out


def normalize_speech_loudness(pcm: bytes, sample_rate: int = TARGET_SAMPLE_RATE) -> bytes:
    """Bring mono 16-bit PCM to SPEECH_TARGET_DBFS (gain capped at ±12 dB, peaks soft-limited)."""
    level = speech_level_dbfs(pcm, sample_rate)
    if level is None:
        return pcm
    gain_db = round(max(-_MAX_GAIN_DB, min(_MAX_GAIN_DB, SPEECH_TARGET_DBFS - level)), 1)
    if abs(gain_db) < _MIN_GAIN_CHANGE_DB:
        return pcm
    lut = _gain_lut(gain_db)
    raw_u16 = _pcm16_array(pcm, "H")
    out = array("h", map(lut.__getitem__, raw_u16))
    del raw_u16
    if sys.byteorder == "big":
        out.byteswap()
    result = out.tobytes()
    del out
    return result


def encode_normalized_mp3(pcm: bytes, sample_rate: int = TARGET_SAMPLE_RATE, channels: int = 1) -> bytes:
    """Downmix, loudness-normalize and encode generated speech to the canonical clip MP3."""
    mono = _downmix_to_mono(pcm, channels)
    del pcm
    norm = normalize_speech_loudness(mono, sample_rate)
    del mono
    return pcm_to_mp3(norm, sample_rate, 1)


def _extract_gemini_audio(response: Any) -> Optional[Tuple[bytes, str]]:
    """Extract `(audio_bytes, mime_type)` from a Gemini TTS response; raw PCM is wrapped as WAV."""
    if response is None:
        return None
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if not (inline and getattr(inline, "data", None)):
                continue
            raw_data = inline.data
            raw_data = base64.b64decode(raw_data) if isinstance(raw_data, str) else bytes(raw_data)
            if not raw_data:
                continue
            mime = (getattr(inline, "mime_type", None) or "").lower()
            if raw_data[:4] == b"RIFF":
                return raw_data, "audio/wav"
            if raw_data[:3] == b"ID3" or raw_data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
                return raw_data, "audio/mpeg"
            rate = 24000
            rate_match = re.search(r"rate=(\d+)", mime)
            if rate_match:
                rate = int(rate_match.group(1))
            return _pcm_to_wav_bytes(raw_data, sample_rate=rate), "audio/wav"
    return None


def _log_synthesis(result: SynthesisResult, elapsed: float) -> None:
    logger.info(
        "podcast_tts engine=%s model=%s voice=%s audio_sec=%.1f elapsed_sec=%.2f cost_usd=%.6f",
        result.engine, result.model or "-", result.voice, result.duration, elapsed, result.cost_usd,
    )


# --- Providers -------------------------------------------------------------------------------

class EdgeProvider:
    """Microsoft Edge neural voices (free; unofficial endpoint used by the `edge-tts` library)."""

    name = "edge"
    max_concurrency = 4
    attempts = 3
    retry_delay = 0.6

    def __init__(self) -> None:
        self._semaphores: Dict[int, asyncio.Semaphore] = {}

    def _semaphore(self) -> asyncio.Semaphore:
        # The endpoint drops bursts of parallel websocket sessions, so cap them per event loop.
        loop_id = id(asyncio.get_running_loop())
        sem = self._semaphores.get(loop_id)
        if sem is None:
            sem = self._semaphores[loop_id] = asyncio.Semaphore(self.max_concurrency)
        return sem

    def is_available(self, lang: str, format_mode: str, voice_gender: str) -> bool:
        return True

    def unavailable_reason(self, lang: str, format_mode: str, voice_gender: str) -> Optional[str]:
        return None

    async def _synthesize_turn(self, text: str, voice: str) -> Tuple[bytes, List[Dict[str, Any]]]:
        last_err: Optional[Exception] = None
        for attempt in range(self.attempts):
            try:
                async with self._semaphore():
                    return await self._synthesize_turn_once(text, voice)
            except Exception as e:
                last_err = e
                if attempt < self.attempts - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
        raise RuntimeError(f"edge-tts failed after {self.attempts} attempts: {last_err}")

    async def _synthesize_turn_once(self, text: str, voice: str) -> Tuple[bytes, List[Dict[str, Any]]]:
        communicate = edge_tts.Communicate(text, voice, boundary="SentenceBoundary")
        out = io.BytesIO()
        marks: List[Dict[str, Any]] = []
        async for chunk in communicate.stream():
            ctype = chunk.get("type")
            if ctype == "audio" and chunk.get("data"):
                out.write(chunk["data"])
            elif ctype in ("SentenceBoundary", "WordBoundary"):
                marks.append({
                    "start": chunk.get("offset", 0) / 1e7,
                    "end": (chunk.get("offset", 0) + chunk.get("duration", 0)) / 1e7,
                    "text": chunk.get("text", ""),
                })
        data = out.getvalue()
        if not data:
            raise ValueError(f"edge-tts returned empty audio for voice {voice}")
        return data, marks

    async def synthesize(
        self,
        turns: List[PodcastTurn],
        format_mode: str = "single",
        voice_gender: str = "male",
        language: Optional[str] = "en",
        api_key: Optional[str] = None,
        content_mode: Optional[str] = None,
    ) -> SynthesisResult:
        t0 = time.time()
        valid = _valid_turns(turns)
        primary = _norm_gender(voice_gender)
        base_lang = detect_effective_language(" ".join(t.text for t in valid), language)
        voices = [get_edge_voice(detect_effective_language(t.text, base_lang), _turn_gender(t, format_mode, primary)) for t in valid]
        parts = await asyncio.gather(*(self._synthesize_turn(t.text, v) for t, v in zip(valid, voices)))

        turn_starts: List[float] = []
        sentences: List[Dict[str, Any]] = []
        cursor = 0.0
        for idx, (audio, marks) in enumerate(parts):
            turn_starts.append(round(cursor, 3))
            dur = mp3_duration_seconds(audio)
            if marks:
                for m in marks:
                    sentences.append({
                        "start": round(cursor + m["start"], 3),
                        "end": round(cursor + m["end"], 3),
                        "turn": idx,
                        "text": m["text"],
                    })
            else:
                sentences.extend(estimate_sentences(valid[idx].text, cursor, cursor + dur, idx))
            cursor += dur

        audio = concat_mp3([p[0] for p in parts])
        result = SynthesisResult(
            audio=audio,
            duration=round(cursor, 3),
            engine=self.name,
            turn_starts=turn_starts,
            sentences=sentences,
            voice=" + ".join(dict.fromkeys(voices)),
        )
        _log_synthesis(result, time.time() - t0)
        return result


class GoogleCloudProvider:
    """Google Cloud Text-to-Speech WaveNet voices (free within the monthly character budget)."""

    name = "gcloud"

    def is_available(self, lang: str, format_mode: str, voice_gender: str) -> bool:
        return self.unavailable_reason(lang, format_mode, voice_gender) is None

    def unavailable_reason(self, lang: str, format_mode: str, voice_gender: str) -> Optional[str]:
        gcloud_key = get_google_cloud_tts_api_key()
        if not gcloud_key:
            return "unconfigured"
        if time.time() < _gcloud_tts_disabled_until.get(gcloud_key, 0.0):
            return "unavailable"
        if get_google_cloud_tts_remaining_chars() <= 0:
            return "quota_exhausted"
        return None

    async def synthesize(
        self,
        turns: List[PodcastTurn],
        format_mode: str = "single",
        voice_gender: str = "male",
        language: Optional[str] = "en",
        api_key: Optional[str] = None,
        content_mode: Optional[str] = None,
    ) -> SynthesisResult:
        t0 = time.time()
        gcloud_key = get_google_cloud_tts_api_key()
        if not gcloud_key:
            raise RuntimeError("Google Cloud TTS API key is not configured.")
        if time.time() < _gcloud_tts_disabled_until.get(gcloud_key, 0.0):
            raise RuntimeError("Google Cloud TTS is temporarily in cooldown.")
        valid = _valid_turns(turns)
        primary = _norm_gender(voice_gender)
        base_lang = detect_effective_language(" ".join(t.text for t in valid), language)
        edge_voices = [
            get_edge_voice(detect_effective_language(t.text, base_lang), _turn_gender(t, format_mode, primary))
            for t in valid
        ]
        gcloud_voices = [get_google_cloud_voice(v)[1] for v in edge_voices]
        audios = await asyncio.gather(
            *(synthesize_turn_google_cloud(t.text, v, gcloud_key) for t, v in zip(valid, edge_voices))
        )

        turn_starts: List[float] = []
        sentences: List[Dict[str, Any]] = []
        cursor = 0.0
        for idx, audio in enumerate(audios):
            turn_starts.append(round(cursor, 3))
            dur = mp3_duration_seconds(audio)
            sentences.extend(estimate_sentences(valid[idx].text, cursor, cursor + dur, idx))
            cursor += dur

        result = SynthesisResult(
            audio=concat_mp3(list(audios)),
            duration=round(cursor, 3),
            engine=self.name,
            turn_starts=turn_starts,
            sentences=sentences,
            voice=" + ".join(dict.fromkeys(gcloud_voices)),
            model="WaveNet",
        )
        _log_synthesis(result, time.time() - t0)
        return result


def resample_pcm(pcm: bytes, from_rate: int, to_rate: int = TARGET_SAMPLE_RATE) -> bytes:
    """Nearest-neighbour resample of mono 16-bit PCM (only used when a backend ignores the 24 kHz default)."""
    if from_rate == to_rate or not pcm:
        return pcm
    samples = _pcm16_array(pcm)
    count = len(samples)
    if not count:
        return pcm
    out_count = int(count * to_rate / from_rate)
    out = array("h", (samples[min(count - 1, int(i * from_rate / to_rate))] for i in range(out_count)))
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


_GEMINI_PERSONAS = {
    "kids": (
        "A warm, friendly, gently playful children's storyteller in their thirties; bright but calm, "
        "with clear articulation and an unhurried pace of about 135 words per minute."
    ),
    "teens": (
        "An upbeat, engaging storyteller in their late twenties with natural conversational energy; "
        "confident and relaxed, at about 160 words per minute."
    ),
    "classic": (
        "A warm, engaging documentary podcast narrator in their forties; calm authority, relaxed and "
        "natural, at about 150 words per minute."
    ),
}

# Every chapter is a separate generation, so the same fixed recording brief is sent with each one.
_GEMINI_CONSISTENCY = (
    "This is one chapter of a multi-chapter series recorded in a single studio session with the same host: "
    "keep exactly the same voice, timbre, pitch, accent, energy, loudness and microphone distance as every "
    "other chapter. Close-mic, dry studio sound with no room echo; steady, even pacing; no whispering, "
    "shouting, singing or character voices."
)


def gemini_style(content_mode: Optional[str]) -> str:
    """Delivery style for Gemini TTS. Sent as speech metadata only — never inside the spoken text."""
    persona = _GEMINI_PERSONAS.get(content_mode or "classic", _GEMINI_PERSONAS["classic"])
    return f"{persona} {_GEMINI_CONSISTENCY}"


# Backoff (seconds) between retries when an episode is pinned to one Gemini TTS model.
GEMINI_PINNED_RETRY_DELAYS: Tuple[float, ...] = (1.5, 4.0)


def get_gemini_tts_models_to_try() -> List[str]:
    env_model = (os.getenv("GEMINI_TTS_MODEL") or "").strip()
    defaults = [
        "gemini-3.8-flash-tts",
        "gemini-3.8-flash-lite-tts",
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-pro-preview-tts",
    ]
    if env_model:
        return [env_model] + [m for m in defaults if m != env_model]
    return defaults


def uses_interactions_api(model_name: str) -> bool:
    """Gemini 3.x TTS models take a verbatim transcript + speech metadata via the Interactions API."""
    return not (model_name or "").lower().startswith("gemini-2.")


def _get_gemini_tts_rates(model_name: str) -> Tuple[float, float]:
    """(input $/1M text tokens, output $/1M audio tokens) for Gemini native-audio TTS models."""
    m = (model_name or "").lower()
    if "pro" in m:
        return 1.00, 20.00
    if "lite" in m:
        return 0.10, 2.00
    return 0.50, 10.00


def _gemini_speakers(turns: List[PodcastTurn], format_mode: str, voice_gender: str) -> Tuple[bool, Dict[str, str]]:
    """(multi_speaker, {speaker_label: voice}) for a chapter.

    Duo episodes always use the multi-speaker setup (even for a chapter with one speaker) because the
    single- and multi-speaker modes render the same voice noticeably differently.
    """
    primary = _norm_gender(voice_gender)
    voices = {"Host1": GEMINI_VOICES[primary], "Host2": GEMINI_VOICES[_other_gender(primary)]}
    if format_mode == "duo":
        return True, voices
    return False, {"Host1": voices["Host1"]}


def build_gemini_interaction_request(
    turns: List[PodcastTurn],
    format_mode: str,
    voice_gender: str,
    content_mode: Optional[str],
) -> Dict[str, Any]:
    """
    Interactions API request for Gemini 3.x TTS: each turn's `text` is the exact transcript and
    the delivery style lives in its `speech_metadata` annotation, so instructions are never read aloud.
    """
    multi, voices = _gemini_speakers(turns, format_mode, voice_gender)
    style = gemini_style(content_mode)
    if multi:
        content = [
            {
                "type": "text",
                "text": t.text,
                "annotations": [{
                    "type": "speech_metadata",
                    "speaker": "Host2" if t.speaker == "host2" else "Host1",
                    "style": style,
                }],
            }
            for t in turns
        ]
        speech_config: Any = {"speakers": [{"speaker": s, "voice": v} for s, v in voices.items()]}
    else:
        content = [{
            "type": "text",
            "text": " ".join(t.text for t in turns),
            "annotations": [{"type": "speech_metadata", "style": style}],
        }]
        speech_config = [{"voice": next(iter(voices.values()))}]
    return {
        "input": [{"type": "user_input", "content": content}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": speech_config},
    }


def build_gemini_legacy_request(
    turns: List[PodcastTurn], format_mode: str, voice_gender: str
) -> Tuple[str, Any]:
    """generate_content request for Gemini 2.5 TTS fallbacks: the transcript only, with no style text."""
    multi, voices = _gemini_speakers(turns, format_mode, voice_gender)
    if multi:
        contents = "\n".join(f"{'Host2' if t.speaker == 'host2' else 'Host1'}: {t.text}" for t in turns)
        speech_config = types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=[
                    types.SpeakerVoiceConfig(
                        speaker=speaker,
                        voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)),
                    )
                    for speaker, voice in voices.items()
                ]
            )
        )
    else:
        contents = " ".join(t.text for t in turns)
        speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=next(iter(voices.values())))
            )
        )
    return contents, speech_config


def _decode_audio_bytes(data: Any, mime: str) -> Tuple[bytes, str]:
    """Normalize returned audio (base64 or bytes; WAV, MP3 or raw PCM) into (bytes, mime)."""
    raw = base64.b64decode(data) if isinstance(data, str) else bytes(data)
    if not raw:
        raise ValueError("Gemini TTS returned empty audio.")
    if raw[:4] == b"RIFF":
        return raw, "audio/wav"
    if raw[:3] == b"ID3" or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return raw, "audio/mpeg"
    rate_match = re.search(r"rate=(\d+)", (mime or "").lower())
    return _pcm_to_wav_bytes(raw, sample_rate=int(rate_match.group(1)) if rate_match else 24000), "audio/wav"


def _decode_audio_to_pcm_or_mp3(data: Any, mime: str) -> Tuple[bytes, str, int, int]:
    """Decode base64/bytes audio directly into `(audio_bytes, 'pcm' | 'mp3', sample_rate, channels)`.

    Avoids wrapping multi-MB raw PCM into a temporary RIFF WAV buffer only to unwrap it back to PCM.
    """
    raw = base64.b64decode(data) if isinstance(data, str) else bytes(data)
    if not raw:
        raise ValueError("Gemini TTS returned empty audio.")
    if raw[:3] == b"ID3" or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return raw, "mp3", TARGET_SAMPLE_RATE, 1
    if raw[:4] == b"RIFF":
        pcm, rate, channels = wav_to_pcm(raw)
        return pcm, "pcm", rate, channels
    mime_lc = (mime or "").lower()
    rate_match = re.search(r"rate=(\d+)", mime_lc)
    chan_match = re.search(r"channels=(\d+)", mime_lc)
    rate = int(rate_match.group(1)) if rate_match else TARGET_SAMPLE_RATE
    channels = max(1, int(chan_match.group(1))) if chan_match else 1
    return raw, "pcm", rate, channels


class GeminiProvider:
    """Gemini native-audio TTS (paid; one multi-speaker call per chapter)."""

    name = "gemini"

    def is_available(self, lang: str, format_mode: str, voice_gender: str) -> bool:
        return True

    def unavailable_reason(self, lang: str, format_mode: str, voice_gender: str) -> Optional[str]:
        return None

    async def _call_interactions(
        self, client: genai.Client, model_name: str, request: Dict[str, Any]
    ) -> Tuple[bytes, str, int, int, int, int, int]:
        interaction = await asyncio.wait_for(
            client.aio.interactions.create(model=model_name, **request),
            timeout=GEMINI_TTS_TIMEOUT_SECONDS,
        )
        out = getattr(interaction, "output_audio", None)
        raw_payload = getattr(out, "data", None) if out is not None else None
        if not raw_payload:
            raise ValueError(f"Gemini TTS model {model_name} returned no audio.")
        mime_hint = getattr(out, "mime_type", "") or ""
        usage = getattr(interaction, "usage", None)
        prompt_tok = int(getattr(usage, "total_input_tokens", 0) or 0) if usage else 0
        cand_tok = int(getattr(usage, "total_output_tokens", 0) or 0) if usage else 0
        thoughts_tok = (
            int(
                getattr(usage, "total_thought_tokens", 0)
                or getattr(usage, "thoughts_token_count", 0)
                or getattr(usage, "total_reasoning_tokens", 0)
                or 0
            )
            if usage
            else 0
        )
        del interaction, out, usage
        audio_bytes, kind, rate, channels = _decode_audio_to_pcm_or_mp3(raw_payload, mime_hint)
        del raw_payload
        return audio_bytes, kind, rate, channels, prompt_tok, cand_tok, thoughts_tok

    async def _call_legacy(
        self, client: genai.Client, model_name: str, contents: str, speech_config: Any
    ) -> Tuple[bytes, str, int, int, int, int, int]:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=speech_config),
            ),
            timeout=GEMINI_TTS_TIMEOUT_SECONDS,
        )
        usage = getattr(response, "usage_metadata", None)
        prompt_tok = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
        cand_tok = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
        thoughts_tok = int(getattr(usage, "thoughts_token_count", 0) or 0) if usage else 0
        raw_payload: Any = None
        mime_hint = ""
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                inline = getattr(part, "inline_data", None)
                if inline and getattr(inline, "data", None):
                    raw_payload = inline.data
                    mime_hint = getattr(inline, "mime_type", "") or ""
                    break
            if raw_payload is not None:
                break
        del response, usage
        if raw_payload is None:
            raise ValueError(f"Gemini TTS model {model_name} returned no audio bytes.")
        audio_bytes, kind, rate, channels = _decode_audio_to_pcm_or_mp3(raw_payload, mime_hint)
        del raw_payload
        return audio_bytes, kind, rate, channels, prompt_tok, cand_tok, thoughts_tok

    async def synthesize(
        self,
        turns: List[PodcastTurn],
        format_mode: str = "single",
        voice_gender: str = "male",
        language: Optional[str] = "en",
        api_key: Optional[str] = None,
        content_mode: Optional[str] = None,
        model: Optional[str] = None,
    ) -> SynthesisResult:
        """
        Render one chapter. With `model` (the model that rendered the episode's first chapter) only
        that model is used — retried on transient errors — because a different model sounds like a
        different host. Without it, the default model list is tried in order.
        """
        t0 = time.time()
        valid = _valid_turns(turns)
        client: genai.Client = get_gemini_client(api_key)
        _, voices = _gemini_speakers(valid, format_mode, voice_gender)
        voice_label = " + ".join(voices.values())
        transcript_chars = sum(len(t.text) for t in valid)

        attempts = [model] * (1 + len(GEMINI_PINNED_RETRY_DELAYS)) if model else get_gemini_tts_models_to_try()
        last_err: Optional[Exception] = None
        for attempt, model_name in enumerate(attempts):
            if model and attempt:
                await asyncio.sleep(GEMINI_PINNED_RETRY_DELAYS[attempt - 1])
            try:
                if uses_interactions_api(model_name):
                    request = build_gemini_interaction_request(valid, format_mode, voice_gender, content_mode)
                    audio_bytes, kind, rate, channels, prompt_tok, cand_tok, thoughts_tok = await self._call_interactions(
                        client, model_name, request
                    )
                else:
                    contents, speech_config = build_gemini_legacy_request(valid, format_mode, voice_gender)
                    audio_bytes, kind, rate, channels, prompt_tok, cand_tok, thoughts_tok = await self._call_legacy(
                        client, model_name, contents, speech_config
                    )

                if kind == "mp3":
                    mp3 = audio_bytes
                    del audio_bytes
                else:
                    mp3 = await asyncio.to_thread(encode_normalized_mp3, audio_bytes, rate, channels)
                    del audio_bytes
                release_unused_memory()
                duration = mp3_duration_seconds(mp3)

                prompt_tok = prompt_tok or max(1, transcript_chars // 4)
                cand_tok = cand_tok or max(1, int(round(duration * 25)))
                thoughts_tok = max(0, int(thoughts_tok or 0))
                in_rate, out_rate = _get_gemini_tts_rates(model_name)
                think_rate = 5.00 if "pro" in (model_name or "").lower() else 0.40
                cost = round(prompt_tok / 1e6 * in_rate + cand_tok / 1e6 * out_rate + thoughts_tok / 1e6 * think_rate, 6)

                turn_starts = proportional_turn_starts(valid, duration)
                bounds = turn_starts[1:] + [duration]
                sentences: List[Dict[str, Any]] = []
                for idx, t in enumerate(valid):
                    sentences.extend(estimate_sentences(t.text, turn_starts[idx], bounds[idx], idx))

                result = SynthesisResult(
                    audio=mp3,
                    duration=duration,
                    engine=self.name,
                    turn_starts=turn_starts,
                    sentences=sentences,
                    cost_usd=cost,
                    voice=voice_label,
                    model=model_name,
                    input_tokens=prompt_tok,
                    output_tokens=cand_tok,
                    thinking_tokens=thoughts_tok,
                )
                _log_synthesis(result, time.time() - t0)
                return result
            except Exception as e:
                logger.warning(f"Gemini TTS failed on {model_name}" + (f" (pinned, attempt {attempt + 1})" if model else "") + f": {e}")
                last_err = e
        raise RuntimeError(f"Gemini TTS synthesis failed: {last_err}")


PROVIDERS: Dict[str, Any] = {
    "edge": EdgeProvider(),
    "gcloud": GoogleCloudProvider(),
    "gemini": GeminiProvider(),
}

ENGINE_TIERS = {"edge": "standard", "gcloud": "cloud", "gemini": "premium"}


def normalize_engine(engine: Optional[str], default: str = "edge") -> str:
    e = (engine or "").strip().lower()
    return e if e in PROVIDERS else (default if default in PROVIDERS else "edge")


def default_engine_for_language(language: Optional[str]) -> str:
    """Return the default free TTS engine for `language` ('gcloud' for Hebrew when available, 'edge' otherwise)."""
    lang = detect_effective_language("", language)
    if lang == "he" and PROVIDERS["gcloud"].is_available(lang, "single", "male"):
        return "gcloud"
    return "edge"


def available_engines(language: Optional[str], format_mode: str = "single", voice_gender: str = "male") -> List[Dict[str, Any]]:
    lang = detect_effective_language("", language)
    out: List[Dict[str, Any]] = []
    for name, provider in PROVIDERS.items():
        reason = provider.unavailable_reason(lang, format_mode, voice_gender)
        out.append({
            "id": name,
            "tier": ENGINE_TIERS[name],
            "available": reason is None,
            "reason": reason,
            "requires_quota": name == "gemini",
            "requires_custom_key": False,
        })
    return out


KeyRunner = Callable[[Callable[[str], Awaitable[SynthesisResult]]], Awaitable[SynthesisResult]]


async def synthesize_segment(
    engine: str,
    turns: List[PodcastTurn],
    format_mode: str = "single",
    voice_gender: str = "male",
    language: Optional[str] = "en",
    content_mode: Optional[str] = None,
    key_runner: Optional[KeyRunner] = None,
    allow_fallback: bool = True,
    model: Optional[str] = None,
) -> SynthesisResult:
    """
    Synthesize one chapter with `engine`, falling back to free Edge voices if the engine is
    unavailable or fails. `key_runner` wraps API-key failover for engines that need a Gemini key.
    `model` pins Gemini to the model that rendered the rest of the episode.
    """
    name = normalize_engine(engine)
    provider = PROVIDERS[name]
    lang = detect_effective_language(" ".join(t.text for t in turns or []), language)
    kwargs = dict(format_mode=format_mode, voice_gender=voice_gender, language=lang, content_mode=content_mode)
    pin = {"model": model} if name == "gemini" and model else {}
    try:
        if not provider.is_available(lang, format_mode, voice_gender):
            raise ValueError(f"{name} TTS is not available for language '{lang}'.")
        if name == "gemini" and key_runner is not None:
            return await key_runner(lambda key: provider.synthesize(turns, api_key=key, **kwargs, **pin))
        return await provider.synthesize(turns, **kwargs, **pin)
    except Exception as e:
        if name == "edge" or not allow_fallback:
            raise
        logger.warning(f"{name} TTS failed ({e}); falling back to Edge voices.")
        result = await PROVIDERS["edge"].synthesize(turns, **kwargs)
        result.fallback_from = name
        return result
