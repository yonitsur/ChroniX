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


def test_svg_and_gif_not_in_reject_extensions():
    """SVGs and GIFs must not be blanket-rejected, enabling motion diagrams and animations."""
    assert ".svg" not in IMAGE_REJECT_EXT
    assert ".gif" not in IMAGE_REJECT_EXT
    assert ".ogg" in IMAGE_REJECT_EXT
    assert ".pdf" in IMAGE_REJECT_EXT


def test_score_image_preserves_motion_gif():
    """Historical/scientific animated GIFs should score positively."""
    pangea_gif = {
        "filename": "Pangea_animation_03.gif",
        "caption": "Continental drift animated model",
        "mime": "image/gif",
        "width": 480,
        "isLead": True,
        "source": "article",
        "is_animated": True,
    }
    score = score_image(pangea_gif, "Continental drift Pangea")
    assert score is not None
    assert score >= 20


def test_score_image_commons_gif_boost_and_disqualification():
    """Commons GIF candidates must receive boost on match, and be disqualified on zero match or static frameCount."""
    matched_gif = {
        "filename": "1969-Apollo-11-Saturn-V-Launch-Pad-Camera-4.gif",
        "caption": "Launch pad camera of Saturn V",
        "mime": "image/gif",
        "width": 400,
        "isLead": False,
        "source": "commons_gif",
        "is_animated": True,
    }
    # Matching context (>=2 keywords) -> boosted score
    score = score_image(matched_gif, "Apollo 11 Moon Landing 1969")
    assert score is not None
    assert score >= 50

    # Unrelated context with 0 token overlap -> disqualified
    unrelated_gif = {
        "filename": "Cat_jumping_funny.gif",
        "caption": "Funny cat jumping",
        "mime": "image/gif",
        "width": 400,
        "isLead": False,
        "source": "commons_gif",
        "is_animated": True,
    }
    unrelated_score = score_image(unrelated_gif, "Apollo 11 Moon Landing 1969")
    assert unrelated_score is None

    # Static 1-frame GIF from Commons -> disqualified even if title matches
    static_gif = {
        "filename": "1969-Apollo-11-Mission-Patch-Seal.gif",
        "caption": "Mission patch",
        "mime": "image/gif",
        "width": 400,
        "isLead": False,
        "source": "commons_gif",
        "is_animated": False,
    }
    assert score_image(static_gif, "Apollo 11 Moon Landing 1969") is None

    # A weak 1-overlap external Commons GIF is rejected in favor of the article photo
    lead_photo = {
        "filename": "Apollo_11_launch.jpg",
        "caption": "Apollo 11 Liftoff Saturn V",
        "mime": "image/jpeg",
        "width": 800,
        "isLead": True,
        "source": "article",
    }
    weak_overlap_gif = {
        "filename": "Apollo_smoke_exhaust_test.gif",
        "caption": "Smoke exhaust test",
        "mime": "image/gif",
        "width": 400,
        "isLead": False,
        "source": "commons_gif",
        "is_animated": True,
    }
    lead_score = score_image(lead_photo, "Apollo 11 Moon Landing 1969")
    weak_score = score_image(weak_overlap_gif, "Apollo 11 Moon Landing 1969")
    assert lead_score is not None
    assert weak_score is None


def test_animated_image_requires_specific_event_subject_match():
    """Broad or stem-like matches must not let an unrelated animation replace a static image."""
    pyramid_graph = {
        "filename": "Pyramid_of_35_spheres_animation.gif",
        "caption": "Pyramid of 35 spheres animation",
        "mime": "image/gif",
        "width": 500,
        "source": "commons_gif",
        "is_animated": True,
    }
    dreamtime_road = {
        "filename": "Speed_Dreams_Track_Subsegments-Sections_animation.gif",
        "caption": "Speed Dreams track sections animation",
        "mime": "image/gif",
        "width": 500,
        "source": "commons_gif",
        "is_animated": True,
    }

    assert score_image(
        pyramid_graph,
        "Ancient Egypt Pyramid Texts Religion Writing",
        "Pyramid Texts",
    ) is None
    assert score_image(
        dreamtime_road,
        "Australian Aboriginal Dreamtime Oral tradition Culture",
        "Dreamtime",
    ) is None


def test_animated_image_accepts_multiple_exact_subject_anchors():
    """A GIF with strong event-specific evidence remains eligible and preferred."""
    apollo_gif = {
        "filename": "1969-Apollo-11-Saturn-V-Launch-Pad-Camera-4.gif",
        "caption": "Launch pad camera of Saturn V",
        "mime": "image/gif",
        "width": 400,
        "source": "commons_gif",
        "is_animated": True,
    }

    score = score_image(
        apollo_gif,
        "Space Race Apollo 11 Moon Landing 1969",
        "Apollo 11 Moon Landing",
    )
    assert score is not None
    assert score >= 50


def test_animated_image_matches_glued_pascalcase_filename():
    """Glued PascalCase/letter-digit Commons filenames must tokenize and match the subject."""
    oscillator_gif = {
        "filename": "QuantumHarmonicOscillatorAnimation.gif",
        "caption": "",
        "mime": "image/gif",
        "width": 480,
        "source": "commons_gif",
        "is_animated": True,
    }
    double_slit_gif = {
        "filename": "DoubleSlitExperiment secondspace 2013-01-12.gif",
        "caption": "",
        "mime": "image/gif",
        "width": 480,
        "source": "commons_gif",
        "is_animated": True,
    }

    oscillator_score = score_image(
        oscillator_gif,
        "Quantum harmonic oscillator",
        "Quantum harmonic oscillator",
    )
    double_slit_score = score_image(
        double_slit_gif,
        "Double-slit experiment",
        "Double-slit experiment",
    )
    assert oscillator_score is not None
    assert double_slit_score is not None


def test_glued_token_split_still_rejects_unrelated_animations():
    """Splitting glued tokens must not reopen unrelated collisions (single anchor is insufficient)."""
    collapse_gif = {
        "filename": "WTCBuilding7Collapse001.gif",
        "caption": "",
        "mime": "image/gif",
        "width": 480,
        "source": "commons_gif",
        "is_animated": True,
    }
    assert score_image(
        collapse_gif,
        "Wave function collapse",
        "Wave function collapse",
    ) is None


@pytest.mark.asyncio
async def test_enrichment_prefers_static_wikipedia_image_over_weak_gif(monkeypatch):
    """A broad-context GIF match must not replace the resolved article's static image."""
    from services import wiki_enricher

    async def fake_summary(title, client, semaphore, **kwargs):
        return {
            "wikiTitle": "Pyramid Texts",
            "wikiUrl": "https://en.wikipedia.org/wiki/Pyramid_Texts",
            "extract": "Ancient Egyptian religious texts.",
            "imageUrl": "https://img.example/Unas_chamber.jpg",
            "lat": None,
            "lng": None,
            "lang": "en",
        }

    async def fake_candidates(title, client, semaphore, **kwargs):
        return [
            {
                "url": "https://img.example/Pyramid_of_35_spheres_animation.gif",
                "filename": "Pyramid_of_35_spheres_animation.gif",
                "caption": "Pyramid of 35 spheres animation",
                "width": 500,
                "mime": "image/gif",
                "source": "commons_gif",
                "key": "pyramid_of_35_spheres_animation.gif",
                "is_animated": True,
            },
            {
                "url": "https://img.example/Unas_chamber.jpg",
                "filename": "Unas_chamber.jpg",
                "caption": "",
                "width": 400,
                "mime": "image/jpeg",
                "isLead": True,
                "source": "article",
                "key": "unas_chamber.jpg",
            },
        ]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [{
        "id": "pyramid-texts",
        "title": "Pyramid Texts in Ancient Egypt",
        "wikipedia_title": "Pyramid Texts",
        "category": "Religion and Writing",
        "rank": 8,
        "from": {"year": -2400},
    }]
    enriched = await enrich_events_with_wikipedia(
        events,
        lang="en",
        timeline_topic="Ancient Egyptian history",
    )

    assert enriched[0]["imageUrl"] == "https://img.example/Unas_chamber.jpg"
    assert enriched[0].get("mediaType") != "gif"


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


@pytest.mark.asyncio
async def test_fetch_commons_gif_candidates_filters_scanned_documents(monkeypatch):
    """Scanned draft cards, certificates, and static 1-frame GIFs must be filtered out."""
    from services.wiki_enricher import fetch_commons_gif_candidates

    class FakeResponse:
        status_code = 200
        def json(self):
            return {
                "query": {
                    "pages": {
                        "1": {
                            "title": "File:World War I Draft Registration Card for Person.gif",
                            "imageinfo": [{
                                "thumburl": "https://img/draft.gif",
                                "mime": "image/gif",
                                "width": 400,
                                "metadata": [{"name": "frameCount", "value": 1}]
                            }]
                        },
                        "2": {
                            "title": "File:Second world war europe animation large de.gif",
                            "imageinfo": [{
                                "thumburl": "https://img/animation.gif",
                                "mime": "image/gif",
                                "width": 400,
                                "metadata": [{"name": "frameCount", "value": 14}]
                            }]
                        },
                        "3": {
                            "title": "File:World War Historical Battlefield Seal.gif",
                            "imageinfo": [{
                                "thumburl": "https://img/seal.gif",
                                "mime": "image/gif",
                                "width": 400,
                                "metadata": [{"name": "frameCount", "value": 1}]
                            }]
                        }
                    }
                }
            }

    class FakeClient:
        async def get(self, url, **kwargs):
            return FakeResponse()

    results = await fetch_commons_gif_candidates("World War", FakeClient(), limit=4)
    # Draft card and static seal must be filtered out; legitimate animation is kept
    assert len(results) == 1
    assert "animation" in results[0]["filename"]
    assert results[0]["source"] == "commons_gif"
    assert results[0]["is_animated"] is True
    assert results[0]["frame_count"] == 14

