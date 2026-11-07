"""B-06: one out-of-range field in model output must not truncate the timeline or drop trailing keys."""
import json

from services.gemini_service import parse_timeline_json


def _events(n=10):
    return [
        {"id": f"e{i}", "title": f"Event {i}", "subtitle": "s", "from_year": 1900 + i, "importance_rank": 5}
        for i in range(1, n + 1)
    ]


def _payload(events):
    return {
        "title": "Test Timeline",
        "description": "desc",
        "overview": "overview",
        "lanes": [{"id": "main", "title": "Main"}],
        "time_bands": [],
        "events": events,
        "keep_unmentioned_events": False,
        "related_prompts": ["Next prompt A", "Next prompt B"],
        "chat_questions": ["Why?"],
        "chat_edit_ideas": ["Add more"],
        "categories": ["History & Politics"],
        "tags": ["tag-a", "tag-b"],
    }


def test_invalid_day_on_one_event_keeps_all_events_and_trailing_keys():
    events = _events(10)
    events[2]["from_day"] = 0
    events[2]["from_month"] = 5

    result = parse_timeline_json(json.dumps(_payload(events)))

    assert len(result.events) == 10
    assert result.events[2].from_day is None
    assert result.events[2].from_month == 5
    assert result.related_prompts == ["Next prompt A", "Next prompt B"]
    assert result.chat_questions == ["Why?"]
    assert result.chat_edit_ideas == ["Add more"]
    assert result.categories == ["History & Politics"]
    assert result.tags == ["tag-a", "tag-b"]
    assert result.keep_unmentioned_events is False


def test_bad_rank_hour_minute_month_and_precision_are_repaired():
    events = _events(6)
    events[0]["importance_rank"] = 15
    events[1]["importance_rank"] = 0
    events[2]["from_hour"] = 24
    events[2]["to_minute"] = 75
    events[3]["to_month"] = 13
    events[4]["from_precision"] = "Sometime"
    events[4]["to_precision"] = "eon"
    events[5]["from_day"] = "12"

    result = parse_timeline_json(json.dumps(_payload(events)))

    assert len(result.events) == 6
    assert result.events[0].importance_rank == 10
    assert result.events[1].importance_rank == 1
    assert result.events[2].from_hour is None and result.events[2].to_minute is None
    assert result.events[3].to_month is None
    assert result.events[4].from_precision == "year" and result.events[4].to_precision is None
    assert result.events[5].from_day == 12


def test_only_irreparable_events_are_dropped():
    events = _events(5)
    events[1]["from_year"] = "not a year"
    events[3]["title"] = None

    result = parse_timeline_json(json.dumps(_payload(events)))

    assert [e.id for e in result.events] == ["e1", "e3", "e5"]
    assert result.related_prompts == ["Next prompt A", "Next prompt B"]


def test_invalid_time_band_fields_are_repaired():
    payload = _payload(_events(3))
    payload["time_bands"] = [{"title": "Era", "from_year": 1900, "to_year": 1950, "from_month": 0, "precision": "?"}]

    result = parse_timeline_json(json.dumps(payload))

    assert len(result.time_bands) == 1
    assert result.time_bands[0].from_month is None and result.time_bands[0].precision == "year"
    assert len(result.events) == 3


def test_genuinely_truncated_json_still_salvages_complete_events():
    text = json.dumps(_payload(_events(4)), indent=2)
    cut = text.index('"Event 4"')
    truncated = text[:cut]

    result = parse_timeline_json(truncated)

    assert [e.title for e in result.events] == ["Event 1", "Event 2", "Event 3"]
    assert result.title == "Test Timeline"


def test_truncated_json_with_an_invalid_field_keeps_all_complete_events():
    events = _events(4)
    events[1]["from_day"] = 0
    text = json.dumps(_payload(events), indent=2)
    truncated = text[: text.index('"Event 4"')]

    result = parse_timeline_json(truncated)

    assert [e.title for e in result.events] == ["Event 1", "Event 2", "Event 3"]
    assert result.events[1].from_day is None


def test_valid_output_is_returned_unchanged():
    payload = _payload(_events(3))
    payload["events"][0].update({"from_month": 7, "from_day": 20, "from_precision": "day", "importance_rank": 9})

    result = parse_timeline_json("```json\n" + json.dumps(payload) + "\n```")

    assert result.events[0].from_day == 20 and result.events[0].from_precision == "day"
    assert result.events[0].importance_rank == 9
