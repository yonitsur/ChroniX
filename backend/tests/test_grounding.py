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
