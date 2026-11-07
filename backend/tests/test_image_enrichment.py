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


def test_score_image_rejects_non_encyclopedic_gif_junk():
    """Cartoons, memes, weather loops, and demographic charts must be rejected even if words overlap."""
    cartoon_black_hole = {
        "filename": "Black Hole Week- Traveler and Friends GIFs (SVS14131 - BHW Singularity and Event Horizon).gif",
        "caption": "Black Hole Week Traveler and Friends Singularity and Event Horizon",
        "mime": "image/gif",
        "width": 540,
        "source": "commons_gif",
        "is_animated": True,
        "isLead": False,
    }
    assert score_image(cartoon_black_hole, "The Event Horizon Telescope Captures Black Hole Shadow", "Event Horizon Telescope") is None

    demographic_pyramid = {
        "filename": "Population_pyramid_of_Japan_(Animation).gif",
        "caption": "Population pyramid of Japan Animation",
        "mime": "image/gif",
        "width": 640,
        "source": "commons_gif",
        "is_animated": True,
        "isLead": False,
    }
    assert score_image(demographic_pyramid, "Ancient Egypt Pyramid Texts", "Pyramid Texts") is None

    weather_loop = {
        "filename": "2021_CIMSS_18E_Terry_visible_infrared_satellite_loop.gif",
        "caption": "Terry visible infrared satellite loop",
        "mime": "image/gif",
        "width": 600,
        "source": "commons_gif",
        "is_animated": True,
        "isLead": False,
    }
    assert score_image(weather_loop, "Terry Fox Marathon of Hope", "Terry Fox") is None

    viral_challenge = {
        "filename": "Fire_challenge.gif",
        "caption": "Fire challenge viral stunt",
        "mime": "image/gif",
        "width": 400,
        "source": "commons_gif",
        "is_animated": True,
        "isLead": False,
    }
    assert score_image(viral_challenge, "Domestication and control of fire", "Control of fire") is None


def test_editorial_lead_image_beats_external_commons_gif():
    """An editorial lead photograph must not be casually displaced by an external Commons GIF search."""
    eht_photo = {
        "filename": "Event_Horizon_Telescope_Collaboration_(testing-general-relativity-with-the-event-horizon).jpg",
        "caption": "Event Horizon Telescope Collaboration testing general relativity with event horizon",
        "mime": "image/jpeg",
        "width": 330,
        "isLead": True,
        "source": "article",
        "is_animated": False,
    }
    # Valid authentic animation from Commons
    accretion_sim = {
        "filename": "BH Accretion Disk Sim 360 Continuous.gif",
        "caption": "Accretion disk simulation around black hole",
        "mime": "image/gif",
        "width": 500,
        "isLead": False,
        "source": "commons_gif",
        "is_animated": True,
    }
    ctx = "The Event Horizon Telescope Captures the First Direct Image of a Black Hole Shadow Event Horizon Telescope 2019"
    anchors = ["Event Horizon Telescope"]

    photo_score = score_image(eht_photo, ctx, anchors)
    sim_score = score_image(accretion_sim, ctx, anchors)
    assert photo_score is not None
    # Editorial lead photo has higher authority than an external Commons search hit
    assert sim_score is None or photo_score > sim_score


def test_in_article_technical_animation_preserved():
    """In-article animations with technical filenames (e.g. Brownian motion) must not be disqualified."""
    brownian_in_article = {
        "filename": "2d_random_walk_ag_adatom_ag111.gif",
        "caption": "2d random walk ag adatom ag111",
        "mime": "image/gif",
        "width": 400,
        "isLead": True,
        "source": "article",
        "is_animated": True,
    }
    score = score_image(brownian_in_article, "Explanation of Brownian Motion", ["Brownian motion"])
    assert score is not None
    assert score >= 50


def test_score_image_prefers_period_generation_over_anachronistic_modern_lead():
    """On a 1974 Volkswagen Golf Mk1 event, the 1st-gen photo must outscore the 2017 Mk7 lead photo."""
    modern_lead = {
        "filename": "2017_Volkswagen_Golf_(5G_MY17)_1.4_SE_TSI_hatchback_(2017-08-30).jpg",
        "caption": "",
        "mime": "image/jpeg",
        "width": 400,
        "isLead": True,
        "source": "article",
    }
    mk1_body = {
        "filename": "Vw_golf_1_v_sst.jpg",
        "caption": "",
        "mime": "image/jpeg",
        "width": 400,
        "isLead": False,
        "source": "article",
    }
    ctx = "עיצוב פולקסווגן גולף דור ראשון פולקסווגן גולף Volkswagen Golf 1974"
    anchors = ["פולקסווגן גולף", "Volkswagen Golf"]
    s_modern = score_image(modern_lead, ctx, anchors)
    s_mk1 = score_image(mk1_body, ctx, anchors)
    assert s_modern is not None and s_mk1 is not None
    assert s_mk1 > s_modern


@pytest.mark.asyncio
async def test_pass2_fallback_does_not_resurrect_rejected_junk_or_duplicate_lead(monkeypatch):
    """Pass-2 lead fallback must respect score_image and used_image_keys (never resurrect junk or duplicate portraits)."""
    from services import wiki_enricher

    async def fake_summary(title, client, semaphore, **kwargs):
        if title == "JunkOnly":
            return {
                "wikiTitle": "JunkOnly",
                "wikiUrl": "https://en.wikipedia.org/wiki/JunkOnly",
                "extract": "x",
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Text_document_with_red_question_mark.svg/330px-Text_document_with_red_question_mark.svg.png",
                "lat": None,
                "lng": None,
                "lang": "en",
            }
        return {
            "wikiTitle": "Albert Einstein",
            "wikiUrl": "https://en.wikipedia.org/wiki/Albert_Einstein",
            "extract": "Physicist",
            "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/d/d3/Albert_Einstein_Head.jpg",
            "lat": None,
            "lng": None,
            "lang": "en",
        }

    async def fake_candidates(title, client, semaphore, **kwargs):
        if title == "JunkOnly":
            return []
        return [
            {
                "url": "https://upload.wikimedia.org/wikipedia/commons/d/d3/Albert_Einstein_Head.jpg",
                "filename": "Albert_Einstein_Head.jpg",
                "caption": "Albert Einstein",
                "width": 500,
                "mime": "image/jpeg",
                "isLead": True,
                "source": "article",
                "key": "albert_einstein_head.jpg",
            }
        ]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [
        {"id": "junk", "title": "JunkOnly", "wikipedia_title": "JunkOnly", "rank": 10, "from": {"year": 1950}},
        {"id": "e1", "title": "Einstein 1", "wikipedia_title": "Albert Einstein", "rank": 9, "from": {"year": 1905}},
        {"id": "e2", "title": "Einstein 2", "wikipedia_title": "Albert Einstein", "rank": 5, "from": {"year": 1915}},
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="en")
    by_id = {e["id"]: e for e in enriched}
    # Junk lead image is NOT resurrected by Pass 2
    assert by_id["junk"].get("imageUrl") is None
    # Higher-ranked Einstein event claims the portrait; lower-ranked event does NOT duplicate it
    assert by_id["e1"].get("imageUrl") == "https://upload.wikimedia.org/wikipedia/commons/d/d3/Albert_Einstein_Head.jpg"
    assert by_id["e2"].get("imageUrl") is None


def test_upgrade_wikimedia_thumb_url_high_res_and_small_originals():
    """Verify REST/MediaWiki thumbnail URLs upgrade to 1280px while respecting small raster bounds."""
    from services.wiki_enricher import _upgrade_wikimedia_thumb_url

    # Large raster image (>1280px original) -> upgraded to 1280px thumbnail step
    thumb_jpg = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/330px-Camponotus_flavomarginatus_ant.jpg"
    orig_jpg = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
    assert _upgrade_wikimedia_thumb_url(thumb_jpg, orig_jpg, 2500) == (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/1280px-Camponotus_flavomarginatus_ant.jpg"
    )

    # Small raster image (<=1280px original) -> uses original_url directly to avoid CDN upscale 404
    small_thumb = "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Small_diagram.png/330px-Small_diagram.png"
    small_orig = "https://upload.wikimedia.org/wikipedia/commons/1/12/Small_diagram.png"
    assert _upgrade_wikimedia_thumb_url(small_thumb, small_orig, 720) == small_orig

    # SVG vector map -> always upgrades to 1280px PNG render even when nominal SVG width is <1280
    svg_thumb = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Map_Peloponnesian_War_431_BC-en.svg/langhe-330px-Map_Peloponnesian_War_431_BC-en.svg.png"
    svg_orig = "https://upload.wikimedia.org/wikipedia/commons/5/57/Map_Peloponnesian_War_431_BC-en.svg"
    assert _upgrade_wikimedia_thumb_url(svg_thumb, svg_orig, 600) == (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Map_Peloponnesian_War_431_BC-en.svg/langhe-1280px-Map_Peloponnesian_War_431_BC-en.svg.png"
    )


@pytest.mark.asyncio
async def test_fetch_image_candidates_upgrades_lead_seed_url_to_high_res():
    """When fetch_image_candidates is seeded with a 320px lead_url, pageimages/imageinfo must upgrade its URL to 1280px."""
    import asyncio
    from services.wiki_enricher import fetch_image_candidates, _ARTICLE_IMAGES_CACHE

    _ARTICLE_IMAGES_CACHE.clear()

    seed_320 = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Detailed_Battle_Map.png/320px-Detailed_Battle_Map.png"
    high_res_1280 = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Detailed_Battle_Map.png/1280px-Detailed_Battle_Map.png"

    class FakeResp:
        status_code = 200
        def __init__(self, payload):
            self._payload = payload
        def json(self):
            return self._payload

    class FakeClient:
        async def get(self, url, **kwargs):
            if "prop=pageimages" in url:
                assert "pithumbsize=1280" in url
                return FakeResp({
                    "query": {
                        "pages": {
                            "10": {
                                "pageimage": "Detailed_Battle_Map.png",
                                "thumbnail": {"source": high_res_1280, "width": 1280},
                                "images": [{"ns": 6, "title": "File:Detailed Battle Map.png"}],
                            }
                        }
                    }
                })
            if "prop=imageinfo" in url and "generator=search" not in url:
                assert "iiurlwidth=1280" in url
                return FakeResp({
                    "query": {
                        "pages": {
                            "20": {
                                "title": "File:Detailed Battle Map.png",
                                "imageinfo": [{
                                    "thumburl": high_res_1280,
                                    "thumbwidth": 1280,
                                    "url": "https://upload.wikimedia.org/wikipedia/commons/5/57/Detailed_Battle_Map.png",
                                    "width": 2400,
                                    "mime": "image/png",
                                    "extmetadata": {"ImageDescription": {"value": "Detailed historical battle map"}},
                                }],
                            }
                        }
                    }
                })
            return FakeResp({"query": {"pages": {}}})

    cands = await fetch_image_candidates(
        "Battle of Test",
        FakeClient(),
        asyncio.Semaphore(2),
        lang="en",
        lead_url=seed_320,
    )
    assert len(cands) == 1
    assert cands[0]["isLead"] is True
    assert cands[0]["url"] == high_res_1280
    assert cands[0]["width"] == 1280
    assert "Detailed historical battle map" in cands[0]["caption"]



