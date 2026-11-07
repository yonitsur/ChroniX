"""One structured Gemini call with the book-import retry policy.

A book import makes hundreds of calls on a single key (BYOK has no failover), so unlike the
interactive flows this layer:
- retries rate limits with backoff (honoring Google's retry-after) and shrinks concurrency (AIMD);
- turns daily-quota / billing / invalid-key errors into `PauseImport` instead of failing the import;
- falls back to no-schema JSON when a model rejects the schema, and asks callers to split work when
  the output was cut off (`SplitRequired`) rather than repairing truncated JSON.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Type, TypeVar

from pydantic import BaseModel, ValidationError

from services.ai_errors import AiErrorKind, classify_ai_error, retry_after_seconds

logger = logging.getLogger("ChroniXBookImport")

T = TypeVar("T", bound=BaseModel)

RATE_LIMIT_MAX_ATTEMPTS = 10
TRANSIENT_MAX_ATTEMPTS = 3
BACKOFF_START = 5.0
BACKOFF_MAX = 120.0


class PauseImport(Exception):
    """The import can't continue right now (needs_key | daily_quota | billing | invalid_key | retry_later)."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason
        self.detail = detail


class SplitRequired(Exception):
    """The model's output hit the token ceiling; the caller should split the request."""


class StageCallError(Exception):
    """All models failed for a non-retryable reason."""


class AimdLimiter:
    """Adaptive concurrency: halves on rate limits (min 1), +1 after every `grow_after` successes."""

    def __init__(self, ceiling: int, grow_after: int = 20, start: Optional[int] = None):
        self.ceiling = max(1, ceiling)
        self.limit = max(1, min(self.ceiling, start or self.ceiling))
        self.grow_after = max(1, grow_after)
        self._in_use = 0
        self._successes = 0
        self._cond = asyncio.Condition()

    async def acquire(self) -> None:
        async with self._cond:
            while self._in_use >= self.limit:
                await self._cond.wait()
            self._in_use += 1

    async def release(self) -> None:
        async with self._cond:
            self._in_use = max(0, self._in_use - 1)
            self._cond.notify_all()

    async def on_success(self) -> None:
        async with self._cond:
            self._successes += 1
            if self._successes >= self.grow_after and self.limit < self.ceiling:
                self.limit += 1
                self._successes = 0
                self._cond.notify_all()

    async def on_rate_limit(self) -> None:
        async with self._cond:
            self.limit = max(1, self.limit // 2)
            self._successes = 0


_GLOBAL_SEMAPHORE: Optional[asyncio.Semaphore] = None
_GLOBAL_SEMAPHORE_LOOP: Any = None


def _global_semaphore(size: int) -> asyncio.Semaphore:
    global _GLOBAL_SEMAPHORE, _GLOBAL_SEMAPHORE_LOOP
    loop = asyncio.get_running_loop()
    if _GLOBAL_SEMAPHORE is None or _GLOBAL_SEMAPHORE_LOOP is not loop:
        _GLOBAL_SEMAPHORE = asyncio.Semaphore(max(1, size))
        _GLOBAL_SEMAPHORE_LOOP = loop
    return _GLOBAL_SEMAPHORE


def _price_override() -> Optional[Dict[str, float]]:
    """Exact per-million-token prices from env (BOOK_IMPORT_PRICE_INPUT_PER_M, ..._CACHED_INPUT_PER_M,
    ..._OUTPUT_PER_M, ..._THINKING_PER_M), so logged costs can match Google's current price list instead
    of the app's built-in table. Unset -> None (the app table is used)."""
    import os

    def f(name: str) -> Optional[float]:
        raw = (os.getenv(name) or "").strip()
        try:
            return float(raw) if raw else None
        except ValueError:
            return None

    inp, out = f("BOOK_IMPORT_PRICE_INPUT_PER_M"), f("BOOK_IMPORT_PRICE_OUTPUT_PER_M")
    if inp is None or out is None:
        return None
    cached = f("BOOK_IMPORT_PRICE_CACHED_INPUT_PER_M")
    think = f("BOOK_IMPORT_PRICE_THINKING_PER_M")
    return {"input": inp, "cached": cached if cached is not None else inp * 0.25, "output": out, "thinking": think if think is not None else out}


def call_cost(model: str, metrics: Dict[str, int]) -> Tuple[float, str]:
    """(USD, price source) for one call's token counts. Prompt tokens include cached tokens."""
    prompt = int(metrics.get("prompt_tokens", 0))
    cached = min(prompt, int(metrics.get("cached_tokens", 0)))
    out = int(metrics.get("candidates_tokens", 0))
    think = int(metrics.get("thoughts_tokens", 0))
    rates = _price_override()
    if rates is not None:
        usd = ((prompt - cached) * rates["input"] + cached * rates["cached"] + out * rates["output"] + think * rates["thinking"]) / 1_000_000
        return round(usd, 8), "env"
    from services.gemini_service import calculate_token_cost_usd

    return calculate_token_cost_usd(prompt, out, think, model_name=model, cached_tokens=cached), "app_table"


@dataclass
class UsageMeter:
    """Accumulates token usage and cost across many calls (per stage / per import) and keeps one
    entry per model call (`entries`), optionally streamed to `sink` as it happens."""

    calls: int = 0
    prompt_tokens: int = 0
    cached_tokens: int = 0
    candidates_tokens: int = 0
    thoughts_tokens: int = 0
    cost_usd: float = 0.0
    by_model: Dict[str, int] = field(default_factory=dict)
    entries: List[Dict[str, Any]] = field(default_factory=list)
    sink: Optional[Callable[[Dict[str, Any]], None]] = None
    stage: str = ""

    def add(self, model: str, metrics: Dict[str, int], *, label: str = "", secs: float = 0.0, outcome: str = "ok") -> Dict[str, Any]:
        cost, source = call_cost(model, metrics)
        self.calls += 1
        self.prompt_tokens += int(metrics.get("prompt_tokens", 0))
        self.cached_tokens += int(metrics.get("cached_tokens", 0))
        self.candidates_tokens += int(metrics.get("candidates_tokens", 0))
        self.thoughts_tokens += int(metrics.get("thoughts_tokens", 0))
        self.cost_usd += cost
        self.by_model[model] = self.by_model.get(model, 0) + 1
        entry = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stage": self.stage,
            "label": label,
            "model": model,
            "inputTokens": int(metrics.get("prompt_tokens", 0)),
            "cachedTokens": int(metrics.get("cached_tokens", 0)),
            "outputTokens": int(metrics.get("candidates_tokens", 0)),
            "thinkingTokens": int(metrics.get("thoughts_tokens", 0)),
            "costUsd": cost,
            "priceSource": source,
            "secs": round(secs, 2),
            "outcome": outcome,
        }
        self.entries.append(entry)
        if self.sink is not None:
            try:
                self.sink(entry)
            except Exception:  # a broken sink never breaks the import
                pass
        return entry

    def as_dict(self) -> Dict[str, Any]:
        return {
            "calls": self.calls,
            "promptTokens": self.prompt_tokens,
            "cachedTokens": self.cached_tokens,
            "candidatesTokens": self.candidates_tokens,
            "thoughtsTokens": self.thoughts_tokens,
            "costUsd": round(self.cost_usd, 6),
            "byModel": dict(self.by_model),
        }

    def merge(self, other: "UsageMeter") -> None:
        self.calls += other.calls
        self.prompt_tokens += other.prompt_tokens
        self.cached_tokens += other.cached_tokens
        self.candidates_tokens += other.candidates_tokens
        self.thoughts_tokens += other.thoughts_tokens
        self.cost_usd += other.cost_usd
        for k, v in other.by_model.items():
            self.by_model[k] = self.by_model.get(k, 0) + v
        self.entries.extend(other.entries)


def thinking_config(model: str, budget: int):
    from google.genai import types

    m = (model or "").lower()
    if "lite" in m:
        return None
    if "pro" in m:
        # Pro models always think; 0 is rejected, so give them at least a small budget.
        return types.ThinkingConfig(thinking_budget=max(int(budget), 128))
    if "3.6-flash" in m:
        return types.ThinkingConfig(thinking_budget=max(int(budget), 256))
    return types.ThinkingConfig(thinking_budget=max(0, int(budget)))


def _finish_reason(response) -> str:
    try:
        cand = (response.candidates or [None])[0]
        reason = getattr(cand, "finish_reason", None)
        return str(getattr(reason, "name", reason) or "")
    except Exception:
        return ""


def _parse(response, schema: Type[T]) -> T:
    from services.gemini_service import clean_json_text, extract_response_text

    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    if isinstance(parsed, dict):
        return schema.model_validate(parsed)
    text = extract_response_text(response)
    if not text or not text.strip():
        raise ValueError("empty model response")
    return schema.model_validate_json(clean_json_text(text))


async def call_structured(
    *,
    api_key: Optional[str],
    schema: Type[T],
    parts: Sequence[Any],
    system_instruction: str,
    models: Sequence[str],
    thinking_budget: int = 0,
    max_output_tokens: int = 65536,
    temperature: float = 0.1,
    media_resolution: Optional[str] = None,
    limiter: Optional[AimdLimiter] = None,
    global_concurrency: int = 12,
    meter: Optional[UsageMeter] = None,
    label: str = "",
    sleep=asyncio.sleep,
) -> T:
    """Runs one schema-constrained call through the model chain. See module docstring for policy."""
    from google.genai import types

    from services.gemini_service import _generate_with_retry, aget_gemini_client, extract_token_metrics

    client = await aget_gemini_client(api_key)
    contents = [types.Content(role="user", parts=list(parts))]
    last_error: Optional[BaseException] = None
    sem = _global_semaphore(global_concurrency)

    for model in models:
        use_schema = True
        transient_attempts = 0
        rate_attempts = 0
        while True:
            cfg: Dict[str, Any] = dict(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
            if use_schema:
                cfg["response_schema"] = schema
            tc = thinking_config(model, thinking_budget)
            if tc is not None:
                cfg["thinking_config"] = tc
            if media_resolution:
                cfg["media_resolution"] = media_resolution
            config = types.GenerateContentConfig(**cfg)

            if limiter is not None:
                await limiter.acquire()
            started = time.time()
            try:
                async with sem:
                    response = await _generate_with_retry(
                        client, max_retries=0, model=model, contents=contents, config=config
                    )
            except Exception as e:  # noqa: BLE001 - classified below
                if limiter is not None:
                    await limiter.release()
                last_error = e
                kind = classify_ai_error(e)
                text = str(e)
                if kind == AiErrorKind.RATE_LIMIT:
                    rate_attempts += 1
                    if limiter is not None:
                        await limiter.on_rate_limit()
                    if rate_attempts >= RATE_LIMIT_MAX_ATTEMPTS:
                        raise PauseImport("retry_later", "Gemini kept rate-limiting this import.") from e
                    wait = retry_after_seconds(e)
                    if wait is None:
                        wait = min(BACKOFF_MAX, BACKOFF_START * (2 ** (rate_attempts - 1)))
                    await sleep(min(BACKOFF_MAX, max(1.0, wait)) + random.uniform(0, 2.0))
                    continue
                if kind in (AiErrorKind.DAILY_QUOTA, AiErrorKind.BILLING, AiErrorKind.INVALID_KEY):
                    raise PauseImport(kind.value, text[:300]) from e
                if use_schema and ("schema" in text.lower() or " 400" in text or "INVALID_ARGUMENT" in text):
                    logger.warning(f"[book_import:{label}] {model} rejected the schema, retrying as plain JSON: {text[:200]}")
                    use_schema = False
                    continue
                if kind == AiErrorKind.TRANSIENT and transient_attempts + 1 < TRANSIENT_MAX_ATTEMPTS:
                    transient_attempts += 1
                    await sleep(min(30.0, 2.0 * (2 ** transient_attempts)) + random.uniform(0, 1.0))
                    continue
                logger.warning(f"[book_import:{label}] {model} failed ({kind.value}): {text[:300]}")
                break  # next model
            else:
                if limiter is not None:
                    await limiter.release()
                    await limiter.on_success()

            finish = _finish_reason(response)
            try:
                metrics = extract_token_metrics(response)
            except Exception:  # pragma: no cover - usage is best effort
                metrics = {}
            result = None
            parse_error: Optional[BaseException] = None
            if finish != "MAX_TOKENS":
                try:
                    result = _parse(response, schema)
                except (ValidationError, ValueError) as e:
                    parse_error = e
            outcome = "truncated" if finish == "MAX_TOKENS" else ("unparseable" if parse_error else "ok")
            # Every billed call is recorded with its tokens and cost, retries included. The log shows
            # per-stage and per-import totals (runner.py); single calls only at DEBUG.
            if meter is not None:
                cost = meter.add(model, metrics, label=label, secs=time.time() - started, outcome=outcome)["costUsd"]
            else:
                cost = call_cost(model, metrics)[0]
            logger.debug(
                f"[book_import:cost] {label} model={model} in={metrics.get('prompt_tokens', 0)} "
                f"cached={metrics.get('cached_tokens', 0)} out={metrics.get('candidates_tokens', 0)} "
                f"thinking={metrics.get('thoughts_tokens', 0)} usd={cost:.6f} secs={time.time() - started:.1f} {outcome}"
            )
            if finish == "MAX_TOKENS":
                raise SplitRequired(f"{label}: output exceeded {max_output_tokens} tokens on {model}")
            if parse_error is not None:
                last_error = parse_error
                transient_attempts += 1
                logger.warning(f"[book_import:{label}] {model} returned unparseable output ({parse_error}); attempt {transient_attempts}")
                if transient_attempts < TRANSIENT_MAX_ATTEMPTS:
                    continue
                break
            return result

    raise StageCallError(f"{label}: all models failed: {last_error}")
