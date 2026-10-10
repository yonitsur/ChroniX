from prompts.timeline import (
    AUTONOMOUS_CURATOR_GUIDELINE,
    build_generation_prompt,
    build_grounding_research_prompt,
)


def test_generation_prompt_preserves_topic_focus_and_lane_default():
    prompt = build_generation_prompt("History of Computing", "women pioneers")

    assert 'History of Computing' in prompt
    assert 'Special focus: women pioneers' in prompt
    assert 'exactly ONE single timeline lane' in prompt
    assert AUTONOMOUS_CURATOR_GUIDELINE in prompt


def test_grounding_prompt_requires_verified_dates_and_bilingual_search():
    prompt = build_grounding_research_prompt("The Space Race")

    assert 'The Space Race' in prompt
    assert 'without guessing arbitrary days or months' in prompt
    assert 'topic\'s own language and in English' in prompt
    assert '10 to 50 events' in prompt
