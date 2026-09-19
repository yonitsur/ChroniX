import pytest
from services.wiki_enricher import (
    is_title_relevant,
    score_image,
    enrich_events_with_wikipedia,
    IMAGE_REJECT_EXT,
    IMAGE_JUNK_KEYWORDS,
)


def test_is_title_relevant_single_word_entities():
    """Verify single-word canonical entities match descriptive queries across languages."""
    # English entity containment
    assert is_title_relevant("Cambrian", "The Cambrian Period") is True
    assert is_title_relevant("Rodinia", "Supercontinent Rodinia") is True
    assert is_title_relevant("Jurassic", "Jurassic Period") is True
    assert is_title_relevant("Hadean", "Hadean Eon") is True
    assert is_title_relevant("Everest", "Mount Everest Expedition") is True

    # Multi-word entity containment
    assert is_title_relevant("Mount Everest", "First ascent of Mount Everest") is True

    # Unrelated or false substring matches should be rejected
    assert is_title_relevant("Apple", "Pineapple Cultivation") is False
    assert is_title_relevant("Mars", "Marshall Islands History") is False
    assert is_title_relevant("Random", "Completely Unrelated Subject") is False


def test_svg_not_in_reject_extensions():
    """SVGs must not be blanket-rejected as they are rendered to PNG thumbnails by Commons."""
    assert ".svg" not in IMAGE_REJECT_EXT
    assert ".ogg" in IMAGE_REJECT_EXT
    assert ".pdf" in IMAGE_REJECT_EXT


def test_score_image_preserves_authentic_maps():
    """Paleogeographic and historical battle maps must not be disqualified as junk."""
    paleo_map = {
        "filename": "Mollweide_Paleographic_Map_of_Earth,_510_Ma.png",
        "caption": "Paleogeographic map of Cambrian Earth",
        "mime": "image/png",
        "width": 400,
        "isLead": True,
        "source": "article",
    }
    score = score_image(paleo_map, "Cambrian geology")
    assert score is not None
    assert score >= 10

    # Generic locator map should still be rejected
    locator_map = {
        "filename": "Locator_map_of_France_in_the_EU.svg.png",
        "caption": "Location map",
        "mime": "image/png",
        "width": 400,
        "isLead": False,
        "source": "article",
    }
    assert score_image(locator_map, "France history") is None


@pytest.mark.asyncio
async def test_lead_image_fallback_prevents_imageless_events(monkeypatch):
    """If candidate deduplication consumes unique images, fallback to verified lead image."""
    from services import wiki_enricher

    async def fake_summary(title, client, semaphore, **kwargs):
        # Both events resolve to articles with a valid lead image
        return {
            "wikiTitle": title,
            "wikiUrl": f"https://en.wikipedia.org/wiki/{title}",
            "extract": "Summary text",
            "imageUrl": f"https://img.example/lead_{title}.jpg",
            "lat": None,
            "lng": None,
            "lang": "en",
        }

    async def fake_candidates(title, client, semaphore, **kwargs):
        # Both articles share the exact same single overview candidate
        return [
            {
                "url": "https://img.example/shared_overview.jpg",
                "filename": "Shared_overview.jpg",
                "caption": "Overview",
                "width": 500,
                "mime": "image/jpeg",
                "isLead": True,
                "source": "article",
                "key": "shared_overview.jpg",
            }
        ]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [
        {"id": "ev1", "title": "Period 1", "wikipedia_title": "Period 1", "rank": 10, "from": {"year": 1900}},
        {"id": "ev2", "title": "Period 2", "wikipedia_title": "Period 2", "rank": 5, "from": {"year": 1910}},
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="en")
    e1 = next(e for e in enriched if e["id"] == "ev1")
    e2 = next(e for e in enriched if e["id"] == "ev2")

    # Higher ranked event got the shared candidate
    assert e1["imageUrl"] == "https://img.example/shared_overview.jpg"
    # Lower ranked event fell back to its verified article lead image rather than being left empty
    assert e2["imageUrl"] == "https://img.example/lead_Period 2.jpg"


def test_are_tokens_related_morphology():
    """Verify generic language-agnostic morphological stem and affix matching."""
    from services.wiki_enricher import are_tokens_related, generic_token_overlap

    # Suffix attachments (plurals / inflections)
    assert are_tokens_related("period", "periods") is True
    assert are_tokens_related("extinction", "extinctions") is True
    assert are_tokens_related("dinosaur", "dinosaurs") is True

    # Common prefix / stem matching
    assert are_tokens_related("geology", "geological") is True
    assert are_tokens_related("city", "cities") is True

    # Unrelated tokens must not match
    assert are_tokens_related("apple", "orange") is False
    assert are_tokens_related("paris", "london") is False
    assert are_tokens_related("cat", "dog") is False


def test_generic_token_overlap_matches_inflections():
    """Verify generic_token_overlap counts inflectional variations of words."""
    from services.wiki_enricher import generic_token_overlap

    s1 = "Geological periods of ancient Earth"
    s2 = "Geology and major extinction period"
    # Overlaps: geological ~ geology, periods ~ period
    overlap = generic_token_overlap(s1, s2)
    assert overlap >= 2

