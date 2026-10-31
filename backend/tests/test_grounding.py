import pytest
from unittest.mock import MagicMock
from google.genai import types
from models import (
    GenerateTimelineRequest,
    TimelineData,
    GroundingMetadataPayload,
    GroundingSource,
    GroundingCitation
)
from services.gemini_service import (
    build_grounding_tool,
    extract_grounding_metadata
)

def test_build_grounding_tool():
    tool = build_grounding_tool()
    assert tool is not None
    assert tool.google_search is not None
    assert isinstance(tool.google_search, types.GoogleSearch)

def test_extract_grounding_metadata_empty():
    assert extract_grounding_metadata(None) is None
    
    mock_resp = MagicMock()
    mock_resp.candidates = []
    assert extract_grounding_metadata(mock_resp) is None

    mock_resp.candidates = [MagicMock(grounding_metadata=None)]
    assert extract_grounding_metadata(mock_resp) is None

def test_extract_grounding_metadata_populated():
    mock_meta = MagicMock()
    mock_meta.web_search_queries = ["Artemis 2 launch date", "NASA lunar timeline"]
    
    chunk1 = MagicMock()
    chunk1.web = MagicMock(title="NASA Artemis Overview", uri="https://nasa.gov/artemis")
    mock_meta.grounding_chunks = [chunk1]

    support1 = MagicMock()
    support1.segment = MagicMock(text="Artemis II will fly around the moon.")
    support1.grounding_chunk_indices = [0]
    support1.confidence_scores = [0.95]
    mock_meta.grounding_supports = [support1]

    mock_meta.search_entry_point = MagicMock(rendered_content="<div class='chip'>Search query</div>")

    mock_candidate = MagicMock(grounding_metadata=mock_meta)
    mock_response = MagicMock(candidates=[mock_candidate])

    payload = extract_grounding_metadata(mock_response)
    assert payload is not None
    assert payload.is_grounded is True
    assert len(payload.search_queries) == 2
    assert payload.search_queries[0] == "Artemis 2 launch date"
    assert len(payload.sources) == 1
    assert payload.sources[0].title == "NASA Artemis Overview"
    assert payload.sources[0].url == "https://nasa.gov/artemis"
    assert len(payload.citations) == 1
    assert payload.citations[0].text_segment == "Artemis II will fly around the moon."
    assert payload.citations[0].source_indices == [0]
    assert payload.citations[0].confidence_score == 0.95
    assert payload.search_entry_point_html == "<div class='chip'>Search query</div>"

def test_generate_timeline_request_with_grounding():
    req = GenerateTimelineRequest(
        prompt="The Space Race",
        enable_grounding=True
    )
    assert req.enable_grounding is True

    req_default = GenerateTimelineRequest(prompt="Ancient Rome")
    assert req_default.enable_grounding is False

def test_timeline_data_grounding_serialization():
    payload = GroundingMetadataPayload(
        is_grounded=True,
        search_queries=["Roman Emperors timeline"],
        sources=[GroundingSource(title="Roman Empire", url="https://example.com/rome")],
        citations=[GroundingCitation(text_segment="Augustus was the first emperor", source_indices=[0], confidence_score=0.98)]
    )
    timeline = TimelineData(
        id="test-rome",
        title="Roman Emperors",
        grounding=payload
    )
    data = timeline.model_dump(by_alias=True)
    assert data.get("grounding") is not None
    assert data["grounding"]["is_grounded"] is True
    assert len(data["grounding"]["sources"]) == 1
    assert data["grounding"]["sources"][0]["title"] == "Roman Empire"


def test_grounding_client_routing_and_overage_logging(monkeypatch, tmp_path):
    import os
    import services.quota_service as qs
    import services.gemini_service as gs

    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    for var in list(os.environ.keys()):
        if var.startswith("GEMINI_API_KEY_FREE"):
            monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_MAIN")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_FALLBACK")
    monkeypatch.setenv("GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT", "2")

    requested_keys = []

    def fake_get_client(key=None):
        eff = key or "PAID_KEY_MAIN"
        requested_keys.append(eff)
        return f"client:{eff}"

    monkeypatch.setattr(gs, "get_gemini_client", fake_get_client)

    primary = gs.get_gemini_client("PAID_KEY_MAIN")
    # Under cap (0 < 2): grounding stays on paid primary client
    g_client_1, on_paid_1 = gs._prepare_grounding_client("PAID_KEY_MAIN", primary)
    assert g_client_1 == "client:PAID_KEY_MAIN"
    assert on_paid_1 is True

    # Record 2 queries -> reaches cap (2 >= 2)
    payload = GroundingMetadataPayload(
        is_grounded=True,
        search_queries=["q1", "q2"],
        sources=[],
        citations=[],
    )
    q_cnt, overage = gs._track_grounding_queries(on_paid_1, payload)
    assert (q_cnt, overage) == (2, 0.0)
    assert qs.get_google_search_grounding_monthly_usage() == 2

    # At cap with free key available: routes grounding to FREE_KEY_FALLBACK while keeping main generation separate
    g_client_2, on_paid_2 = gs._prepare_grounding_client("PAID_KEY_MAIN", primary)
    assert g_client_2 == "client:FREE_KEY_FALLBACK"
    assert on_paid_2 is False

    # At cap with NO separate free key configured: skips grounding cleanly (returns None)
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    g_client_3, on_paid_3 = gs._prepare_grounding_client("PAID_KEY_MAIN", primary)
    assert g_client_3 is None
    assert on_paid_3 is False

    # Verify log_token_usage_summary includes groundingSearchCostUsd in estimatedCostUsd
    summary = gs.log_token_usage_summary(
        operation="Timeline Generation",
        model_name="gemini-3.8-flash",
        label="Space Race",
        generation_usage={"prompt_tokens": 1000, "candidates_tokens": 1000, "thoughts_tokens": 0, "total_tokens": 2000},
        grounding_usage={"prompt_tokens": 500, "candidates_tokens": 500, "thoughts_tokens": 0, "total_tokens": 1000},
        grounding_queries_count=2,
        grounding_search_cost_usd=0.028,
    )
    assert summary["groundingQueries"] == 2
    assert summary["groundingSearchCostUsd"] == pytest.approx(0.028)
    # Token cost = 1500 * $0.10/1M ($0.00015) + 1500 * $0.40/1M ($0.0006) = $0.00075; + $0.028 = $0.02875
    assert summary["estimatedCostUsd"] == pytest.approx(0.02875)


@pytest.mark.asyncio
async def test_chat_prompt_places_grounded_facts_after_history_for_prefix_cache(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock
    from models import GroundingMetadataPayload, GroundingSource, TimelineArticle, TimelineChatOutput, TimelineData, TimelineLane
    from services import gemini_service as gs

    tl = TimelineData(
        id="tl-cache-order",
        title="Apollo Program",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(id="ev-11", title="Apollo 11", lane="main", **{"from": {"year": 1969, "month": 7, "day": 20}}),
        ],
    )

    captured_prompts = []

    research_resp = SimpleNamespace(
        text="- Neil Armstrong stepped onto the Moon at 02:56 UTC on July 21, 1969.",
        usage_metadata=SimpleNamespace(prompt_token_count=200, candidates_token_count=40, thoughts_token_count=0, total_token_count=240),
        candidates=[
            SimpleNamespace(
                grounding_metadata=SimpleNamespace(
                    web_search_queries=["Apollo 11 exact moonwalk UTC"],
                    grounding_chunks=[SimpleNamespace(web=SimpleNamespace(title="NASA", uri="https://nasa.gov/apollo11"))],
                    grounding_supports=[],
                    search_entry_point=None,
                )
            )
        ],
    )

    chat_resp = SimpleNamespace(
        parsed=TimelineChatOutput(
            reply="Armstrong stepped onto the lunar surface at 02:56 UTC on July 21, 1969.",
            action="answer",
            detected_language="en",
        ),
        usage_metadata=SimpleNamespace(
            prompt_token_count=3200,
            cached_content_token_count=2400,
            candidates_token_count=60,
            thoughts_token_count=0,
            total_token_count=3260,
        ),
    )

    async def fake_generate_content(**kwargs):
        contents = kwargs.get("contents", "")
        captured_prompts.append(contents)
        if len(captured_prompts) == 1:
            return research_resp
        return chat_resp

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=fake_generate_content)
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: mock_client)
    monkeypatch.setattr(gs, "_prepare_grounding_client", lambda api_key, client: (mock_client, False))

    out, grounding = await gs.chat_about_timeline(
        current_timeline=tl,
        message="What exact UTC time did Armstrong step onto the Moon?",
        history=[
            {"role": "user", "content": "Who commanded Apollo 11?"},
            {"role": "assistant", "content": "Neil Armstrong commanded Apollo 11."},
        ],
        api_key="test_key",
        enable_grounding=True,
    )

    assert len(captured_prompts) == 2
    main_prompt = captured_prompts[1]
    ctx_idx = main_prompt.index("## Current Timeline Context")
    conv_idx = main_prompt.index("## Conversation so far")
    facts_idx = main_prompt.index("## Verified Google Search facts")
    msg_idx = main_prompt.index("## User's new message")
    assert ctx_idx < conv_idx < facts_idx < msg_idx
    assert grounding is not None and grounding.is_grounded is True
    assert out._token_usage["cachedTokens"] == 2400


