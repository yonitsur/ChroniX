"""
Shared `httpx.AsyncClient`s for outbound calls that used to build a client (and a TLS handshake)
per request (P-14): Google Photos media, the Hugging Face / Pollinations image fallbacks.

`shared_async_client(name, **kwargs)` yields one pooled client per (name, kwargs) and event loop.
When tests monkeypatch `httpx.AsyncClient`, a fresh client is built per call exactly as before, so
fakes keep working.
"""
from __future__ import annotations

import asyncio
import contextlib
import threading
from typing import Any, AsyncIterator, Dict, Tuple

import httpx

_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_LOCK = threading.Lock()
_CLIENTS: Dict[Tuple[str, str], Tuple[httpx.AsyncClient, Any]] = {}


def _kwargs_key(kwargs: Dict[str, Any]) -> str:
    return repr(sorted((k, repr(v)) for k, v in kwargs.items()))


@contextlib.asynccontextmanager
async def shared_async_client(name: str, **client_kwargs: Any) -> AsyncIterator[httpx.AsyncClient]:
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        async with httpx.AsyncClient(**client_kwargs) as client:
            yield client
        return
    loop = asyncio.get_running_loop()
    key = (name, _kwargs_key(client_kwargs))
    with _LOCK:
        entry = _CLIENTS.get(key)
        if entry is None or entry[0].is_closed or entry[1] is not loop:
            # A client is bound to the loop that created it; a new loop (tests) gets its own.
            entry = (_ORIG_ASYNC_CLIENT(**client_kwargs), loop)
            _CLIENTS[key] = entry
    yield entry[0]


async def aclose_all() -> None:
    """Closes the clients of the running loop (app shutdown)."""
    loop = asyncio.get_running_loop()
    with _LOCK:
        mine = [k for k, (_, owner) in _CLIENTS.items() if owner is loop]
        clients = [_CLIENTS.pop(k)[0] for k in mine]
    for client in clients:
        with contextlib.suppress(Exception):
            await client.aclose()
