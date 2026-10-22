from prompts.timeline import (
    AUTONOMOUS_CURATOR_GUIDELINE,
    KIDS_CURATOR_GUIDELINE,
    KIDS_MODE_SYSTEM_ADDENDUM,
    TEENS_CURATOR_GUIDELINE,
    TEENS_MODE_SYSTEM_ADDENDUM,
    build_generation_prompt,
    build_grounding_research_prompt,
    normalize_content_mode,
)
from services.gemini_service import get_system_instruction, get_chat_system_instruction
from models import GenerateTimelineRequest, TimelineData


def test_generation_prompt_preserves_topic_focus_and_lane_default():
    prompt = build_generation_prompt("History of Computing", "women pioneers")

    assert 'History of Computing' in prompt
    assert 'Special focus: women pioneers' in prompt
    assert 'exactly ONE single timeline lane' in prompt
    assert AUTONOMOUS_CURATOR_GUIDELINE in prompt


def test_generation_prompt_kids_mode():
    prompt = build_generation_prompt("Dinosaurs", content_mode="kids")

    assert "Dinosaurs" in prompt
    assert KIDS_CURATOR_GUIDELINE in prompt
    assert AUTONOMOUS_CURATOR_GUIDELINE not in prompt
    assert "ages 8 to 11" in prompt


def test_generation_prompt_teens_mode():
    prompt = build_generation_prompt("The French Revolution", content_mode="teens")

    assert TEENS_CURATOR_GUIDELINE in prompt
    assert KIDS_CURATOR_GUIDELINE not in prompt
    assert AUTONOMOUS_CURATOR_GUIDELINE not in prompt
    assert "ages 12 to 15" in prompt


def test_unknown_content_mode_falls_back_to_classic():
    assert normalize_content_mode("adults") == "classic"
    assert normalize_content_mode(None) == "classic"
    assert AUTONOMOUS_CURATOR_GUIDELINE in build_generation_prompt("Rome", content_mode="bogus")


def test_grounding_prompt_requires_verified_dates_and_bilingual_search():
    prompt = build_grounding_research_prompt("The Space Race")

    assert 'The Space Race' in prompt
    assert 'without guessing arbitrary days or months' in prompt
    assert 'topic\'s own language and in English' in prompt
    assert '10 to 50 events' in prompt


def test_grounding_prompt_kids_mode():
    prompt = build_grounding_research_prompt("The Space Race", content_mode="kids")

    assert "The Space Race" in prompt
    assert "12 to 24 most fascinating, memorable, and kid-friendly" in prompt


def test_grounding_prompt_teens_mode():
    prompt = build_grounding_research_prompt("The Space Race", content_mode="teens")

    assert "16 to 30 most significant" in prompt
    assert "kid-friendly" not in prompt


def test_system_instructions_kids_vs_classic():
    classic_sys = get_system_instruction("classic")
    kids_sys = get_system_instruction("kids")

    assert KIDS_MODE_SYSTEM_ADDENDUM not in classic_sys
    assert KIDS_MODE_SYSTEM_ADDENDUM in kids_sys

    classic_chat = get_chat_system_instruction("Space Exploration", "classic")
    kids_chat = get_chat_system_instruction("Space Exploration", "kids")

    assert "KIDS MODE" not in classic_chat
    assert "KIDS MODE" in kids_chat

    teens_sys = get_system_instruction("teens")
    assert TEENS_MODE_SYSTEM_ADDENDUM in teens_sys
    assert KIDS_MODE_SYSTEM_ADDENDUM not in teens_sys

    teens_chat = get_chat_system_instruction("Space Exploration", "teens")
    assert "TEENS MODE" in teens_chat
    assert "KIDS MODE" not in teens_chat
    assert "TEENS MODE" not in classic_chat


def test_models_content_mode_serialization():
    req = GenerateTimelineRequest(prompt="Dinosaurs", content_mode="kids")
    assert req.content_mode == "kids"

    tl = TimelineData(id="tl-1", title="Dinosaurs", contentMode="kids")
    dumped = tl.model_dump(by_alias=True)
    assert dumped["contentMode"] == "kids"

    teens_req = GenerateTimelineRequest(prompt="Dinosaurs", content_mode="teens")
    assert teens_req.content_mode == "teens"
    assert TimelineData(id="tl-2", title="X", contentMode="teens").model_dump(by_alias=True)["contentMode"] == "teens"

