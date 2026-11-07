import pytest
from pydantic import ValidationError

from models import TimelineData


def _timeline(meta):
    return {
        "id": "tl-story",
        "title": "Claire & Ethan",
        "isPersonal": True,
        "articles": [
            {"id": "ss-met", "title": "Claire & Ethan meet", "from": {"year": 2019, "precision": "year"},
             "storyAnchor": "met", "circa": True, "provenance": "user"},
        ],
        "storyStudio": meta,
    }


def test_story_studio_meta_round_trips():
    meta = {"blueprint": "couple", "version": 2, "people": {"p1": "Claire", "p2": "Ethan"},
            "hiddenAutoChapters": ["auto-beforeMet"], "autoWritten": ["auto-together"]}
    tl = TimelineData.model_validate(_timeline(meta))
    dumped = tl.model_dump(by_alias=True)
    assert dumped["storyStudio"] == meta
    # Studio fields on articles are kept (TimelineArticle allows extra fields).
    art = dumped["articles"][0]
    assert art["storyAnchor"] == "met" and art["circa"] is True


def test_story_studio_meta_is_optional():
    assert TimelineData.model_validate(_timeline(None)).storyStudio is None


@pytest.mark.parametrize("bad", ["couple", ["x"], {"blob": "x" * 20_000}])
def test_story_studio_meta_rejects_non_objects_and_oversized(bad):
    with pytest.raises(ValidationError):
        TimelineData.model_validate(_timeline(bad))
