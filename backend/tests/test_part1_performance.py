"""Tests for Part 1 performance review improvements."""
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

import main
from models import (
    GeminiEventItem,
    GeminiTimelineOutput,
    TimelineChatOutput,
    TimelineChatRequest,
    TimelineData,
)
from services import gemini_service, wiki_enricher


def test_wiki_cache_limits_raised_within_memory_budget():
    assert wiki_enricher._WIKI_CACHE_MAX_ENTRIES == 2000
    assert wiki_enricher._IMAGE_LIST_CACHE_MAX_ENTRIES == 512


@pytest.mark.asyncio
async def test_rehydrate_stripped_timeline_media_restores_only_stripped_fields(monkeypatch):
    stored_payload: Dict[str, Any] = {
        "id": "tl-rehydrate",
        "title": "Space Race",
        "grounding": {"is_grounded": True, "search_queries": ["space race"], "sources": []},
        "quiz": [
            {
                "id": "q1",
                "question": "When did Sputnik launch?",
                "options": ["1957", "1961", "1969", "1972"],
                "correct_index": 0,
                "explanation": "Sputnik 1 launched in October 1957.",
            }
        ],
        "articles": [
            {
                "id": "e1",
                "title": "Sputnik 1",
                "from": {"year": 1957},
                "imageUrl": "data:image/jpeg;base64,STORED_IMG_1",
                "additionalImages": [{"url": "data:image/jpeg;base64,EXTRA_1"}],
                "videos": [{"videoId": "vid-1", "title": "Sputnik"}],
            },
            {
                "id": "e2",
                "title": "Apollo 11",
                "from": {"year": 1969},
                "imageUrl": "data:image/jpeg;base64,OLD_IMAGE_USER_REMOVED",
            },
        ],
    }

    lookup_calls: List[str] = []

    def fake_get_with_meta(tid: str):
        lookup_calls.append(tid)
        return {"data": stored_payload, "owner_id": "u-1", "is_shared": False}

    monkeypatch.setattr(main, "get_timeline_with_meta", fake_get_with_meta)

    incoming = TimelineData.model_validate(
        {
            "id": "tl-rehydrate",
            "title": "Space Race",
            "articles": [
                {
                    "id": "e1",
                    "title": "Sputnik 1",
                    "from": {"year": 1957},
                    "_strippedMediaFields": ["imageUrl", "additionalImages", "videos"],
                },
                {
                    "id": "e2",
                    "title": "Apollo 11",
                    "from": {"year": 1969},
                    "imageUrl": None,
                },
            ],
        }
    )

    await main._rehydrate_stripped_timeline_media(incoming, media_stripped=True)
    assert lookup_calls == ["tl-rehydrate"]
    dumped = incoming.model_dump(by_alias=True)
    assert dumped["grounding"]["is_grounded"] is True
    assert len(dumped["quiz"]) == 1
    assert dumped["articles"][0]["imageUrl"] == "data:image/jpeg;base64,STORED_IMG_1"
    assert dumped["articles"][0]["additionalImages"] == [{"url": "data:image/jpeg;base64,EXTRA_1"}]
    assert dumped["articles"][0]["videos"] == [{"videoId": "vid-1", "title": "Sputnik"}]
    assert "_strippedMediaFields" not in dumped["articles"][0]
    # e2 did NOT have _strippedMediaFields, so its cleared imageUrl stays None
    assert dumped["articles"][1]["imageUrl"] is None


@pytest.mark.asyncio
async def test_chat_answer_turn_does_not_fetch_stored_timeline_when_media_stripped(monkeypatch):
    lookup_calls: List[str] = []
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: lookup_calls.append(tid))

    async def fake_chat_about_timeline(**kwargs):
        out = TimelineChatOutput(
            action="answer",
            reply="Sputnik 1 launched on October 4, 1957.",
            detected_language="en",
            is_relevant=True,
        )
        out._model_used = "gemini-test"
        return out, None

    monkeypatch.setattr(main, "chat_about_timeline", fake_chat_about_timeline)

    req = TimelineChatRequest(
        timeline=TimelineData.model_validate(
            {
                "id": "tl-qa",
                "title": "Space Race",
                "articles": [
                    {
                        "id": "e1",
                        "title": "Sputnik 1",
                        "from": {"year": 1957},
                        "_strippedMediaFields": ["imageUrl"],
                    }
                ],
            }
        ),
        message="When did Sputnik launch?",
        media_stripped=True,
    )
    resp = await main._run_chat_turn(
        req,
        chat_key="fake-key",
        chat_tier="free",
        user={"id": "u-1"},
        async_job=True,
    )
    assert resp.action == "answer"
    assert lookup_calls == []


@pytest.mark.asyncio
async def test_post_processing_failure_does_not_rerun_fallback_llm_model(monkeypatch):
    llm_models_called: List[str] = []

    monkeypatch.setattr(gemini_service, "get_gemini_client", lambda api_key=None: object())
    monkeypatch.setattr(gemini_service, "get_gemini_models_to_try", lambda: ["model-primary", "model-fallback"])

    async def fake_generate_with_retry(client, model, contents, config):
        llm_models_called.append(model)
        parsed = GeminiTimelineOutput(
            title="Test",
            description="Desc",
            overview="Overview",
            detected_language="en",
            lanes=[],
            events=[
                GeminiEventItem(
                    id="ev1",
                    title="Event 1",
                    subtitle="Sub",
                    from_year=2000,
                )
            ],
        )
        return SimpleNamespace(parsed=parsed, usage_metadata=None, candidates=[])

    async def boom_finalize(*args, **kwargs):
        raise RuntimeError("Wikipedia post-processing crashed")

    monkeypatch.setattr(gemini_service, "_generate_with_retry", fake_generate_with_retry)
    monkeypatch.setattr(gemini_service, "finalize_timeline_from_parsed", boom_finalize)

    with pytest.raises(RuntimeError, match="Wikipedia post-processing crashed"):
        await gemini_service.generate_timeline_with_gemini("Test prompt", api_key="k", enable_grounding=False)

    # Model #1 already returned valid events; post-processing failure must NOT waste a second LLM call
    assert llm_models_called == ["model-primary"]


@pytest.mark.asyncio
async def test_generate_from_files_preserves_files_for_retry_when_first_model_returns_zero_events(monkeypatch):
    seen_parts_counts: List[int] = []

    monkeypatch.setattr(gemini_service, "get_gemini_client", lambda api_key=None: object())
    monkeypatch.setattr(gemini_service, "get_gemini_models_to_try", lambda: ["model-primary", "model-fallback"])

    async def fake_generate_with_retry(client, model, contents, config):
        parts = contents[0].parts
        seen_parts_counts.append(len(parts))
        events = (
            []
            if model == "model-primary"
            else [GeminiEventItem(id="ev1", title="Extracted Event", subtitle="Sub", from_year=1995)]
        )
        parsed = GeminiTimelineOutput(
            title="Doc Timeline",
            description="Desc",
            overview="Overview",
            detected_language="en",
            lanes=[],
            events=events,
        )
        return SimpleNamespace(parsed=parsed, usage_metadata=None, candidates=[])

    async def fake_finalize(parsed_data, subject_label, **kwargs):
        return TimelineData(id="tl-doc", title=subject_label, articles=[])

    monkeypatch.setattr(gemini_service, "_generate_with_retry", fake_generate_with_retry)
    monkeypatch.setattr(gemini_service, "finalize_timeline_from_parsed", fake_finalize)

    files = [(b"fake-image-bytes", "image/jpeg")]
    result = await gemini_service.generate_timeline_from_files(files=files, api_key="k")
    assert result.id == "tl-doc"
    # Both primary and fallback received instruction + 1 file part, and files list was freed afterwards
    assert seen_parts_counts == [2, 2]
    assert files == []
