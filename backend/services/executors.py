"""
Dedicated thread pools for blocking work (SC-08).

Every `asyncio.to_thread` call used to share the event loop's default executor
(min(32, cpu + 4) threads), so a burst of slow work - photo uploads, multi-MB timeline saves, the
Library rebuild, podcast audio - could hold every thread while the fast, critical calls (quota
reservations, ownership checks) queued behind it. Each class of work now gets its own small pool:

- quota:   usage counters / credit reservations. Short, latency-critical Supabase RPCs.
- storage: timeline reads and writes, Library index queries.
- bulk:    photo / podcast Storage uploads and downloads, account-wide deletes, Library rebuilds.
- cpu:     Pillow decoding / re-encoding and other CPU-bound helpers.
- book:    PDF parsing/rendering for book imports. pdfium is not thread-safe, so this pool has ONE
           thread by default (EXECUTOR_BOOK_WORKERS); everything that touches a PdfDocument runs here.

The helpers copy the caller's contextvars exactly like `asyncio.to_thread` does, so request-scoped
state (client IP, AI tier header, activity record, job phase) still reaches the worker.
Sizes are env-tunable; the defaults match the HTTP connection pools in storage / quota_service,
so a worker never waits for a connection.
"""
from __future__ import annotations

import asyncio
import contextvars
import functools
import os
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Dict, TypeVar

T = TypeVar("T")


def _env_workers(name: str, default: int) -> int:
    try:
        return max(1, min(128, int(os.getenv(name, "") or default)))
    except ValueError:
        return default


QUOTA_WORKERS = _env_workers("EXECUTOR_QUOTA_WORKERS", 16)
STORAGE_WORKERS = _env_workers("EXECUTOR_STORAGE_WORKERS", 24)
BULK_WORKERS = _env_workers("EXECUTOR_BULK_WORKERS", 8)
CPU_WORKERS = _env_workers("EXECUTOR_CPU_WORKERS", max(2, min(8, os.cpu_count() or 2)))
BOOK_WORKERS = _env_workers("EXECUTOR_BOOK_WORKERS", 1)

_POOLS: Dict[str, ThreadPoolExecutor] = {
    "quota": ThreadPoolExecutor(max_workers=QUOTA_WORKERS, thread_name_prefix="chronix-quota"),
    "storage": ThreadPoolExecutor(max_workers=STORAGE_WORKERS, thread_name_prefix="chronix-storage"),
    "bulk": ThreadPoolExecutor(max_workers=BULK_WORKERS, thread_name_prefix="chronix-bulk"),
    "cpu": ThreadPoolExecutor(max_workers=CPU_WORKERS, thread_name_prefix="chronix-cpu"),
    "book": ThreadPoolExecutor(max_workers=BOOK_WORKERS, thread_name_prefix="chronix-book"),
}


def executor(kind: str) -> ThreadPoolExecutor:
    return _POOLS[kind]


async def _run(kind: str, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    loop = asyncio.get_running_loop()
    ctx = contextvars.copy_context()
    call = functools.partial(ctx.run, fn, *args, **kwargs)
    return await loop.run_in_executor(_POOLS[kind], call)


async def run_quota(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await _run("quota", fn, *args, **kwargs)


async def run_storage(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await _run("storage", fn, *args, **kwargs)


async def run_bulk(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await _run("bulk", fn, *args, **kwargs)


async def run_cpu(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await _run("cpu", fn, *args, **kwargs)


async def run_book_cpu(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Book-import PDF work (single thread: pdfium isn't thread-safe)."""
    return await _run("book", fn, *args, **kwargs)


def submit_bulk(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Future:
    """Fire-and-forget from sync code (e.g. a background Library rebuild)."""
    ctx = contextvars.copy_context()
    return _POOLS["bulk"].submit(ctx.run, fn, *args, **kwargs)
