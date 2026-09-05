import pytest
from dotenv import load_dotenv
load_dotenv()
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane
from services.wiki_enricher import fetch_wikipedia_summary, enrich_events_with_wikipedia
import httpx
import asyncio

def test_models_serialization():
    article = TimelineArticle(
        id="test-1",
        title="Apollo 11",
        subtitle="First Moon Landing",
        lane="space",
        from_=TimelineDate(year=1969, month=7, day=20, precision="day"),
        imageUrl="https://example.com/apollo.jpg",
        wikiTitle="Apollo 11",
        wikiUrl="https://en.wikipedia.org/wiki/Apollo_11",
        extract="Apollo 11 was the American spaceflight that first landed humans on the Moon.",
        rank=10
    )
    dumped = article.model_dump(by_alias=True)
    assert dumped["id"] == "test-1"
    assert dumped["from"]["year"] == 1969
    assert dumped["from"]["month"] == 7
    assert dumped["from"]["precision"] == "day"
    assert dumped["title"] == "Apollo 11"

@pytest.mark.asyncio
async def test_wikipedia_enrichment():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary("George Washington", client, sem)
        assert res is not None
        assert "wikiTitle" in res
        assert "George Washington" in res["wikiTitle"]
        assert res.get("imageUrl") is not None
        assert res.get("wikiUrl") is not None

@pytest.mark.asyncio
async def test_batch_enrichment():
    sample_events = [
        {"id": "1", "title": "Abraham Lincoln", "from": {"year": 1861}},
        {"id": "2", "title": "Tyrannosaurus", "from": {"year": -68000000, "precision": "million-years"}}
    ]
    enriched = await enrich_events_with_wikipedia(sample_events)
    assert len(enriched) == 2
    assert enriched[0].get("imageUrl") is not None
    assert enriched[1].get("imageUrl") is not None

def test_hebrew_detection():
    from services.gemini_service import is_hebrew_text
    assert is_hebrew_text("מלחמת העולם השנייה") is True
    assert is_hebrew_text("World War II") is False
    assert is_hebrew_text("1942 קרב מידוויי") is True

@pytest.mark.asyncio
async def test_hebrew_wikipedia_enrichment():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary("מלחמת העולם השנייה", client, sem, lang="he")
        assert res is not None
        assert "he.wikipedia.org" in res.get("wikiUrl", "")
        assert res.get("extract") is not None
        assert len(res.get("extract", "")) > 0
        assert res.get("imageUrl") is not None

@pytest.mark.asyncio
async def test_hebrew_batch_enrichment():
    events = [
        {"id": "1", "title": "הפלישה לפולין", "wikipedia_title": "הפלישה לפולין"},
        {"id": "2", "title": "קרב סטלינגרד", "wikipedia_title": "קרב סטלינגרד"}
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="he")
    assert len(enriched) == 2
    assert "he.wikipedia.org" in enriched[0].get("wikiUrl", "")
    assert enriched[0].get("imageUrl") is not None
    assert "he.wikipedia.org" in enriched[1].get("wikiUrl", "")
    assert enriched[1].get("imageUrl") is not None

def test_title_variations_generator():
    from services.wiki_enricher import generate_title_variations
    
    # Subtitle colon separation
    v1 = generate_title_variations("מערת קסם: מוקדי אש ועיבוד מזון", lang="he")
    assert "מערת קסם" in v1

    # Parenthetical qualifier stripping
    v2 = generate_title_variations("Apollo 11 (spacecraft)", lang="en")
    assert "Apollo 11" in v2

    # Dash separation
    v3 = generate_title_variations("Battle of Midway - Pacific Theatre", lang="en")
    assert "Battle of Midway" in v3

@pytest.mark.asyncio
async def test_complex_hebrew_title_enrichment():
    from services.wiki_enricher import fetch_wikipedia_summary
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        # Test that colon-separated complex title resolves to "מערת קסם"
        res1 = await fetch_wikipedia_summary("מערת קסם: מוקדי אש ועיבוד מזון", client, sem, lang="he")
        assert res1 is not None
        assert "he.wikipedia.org" in res1.get("wikiUrl", "")
        assert "קסם" in res1.get("wikiTitle", "")

        # Test that descriptive prefix "המאובן במערת..." resolves to "מערת מיסליה"
        res2 = await fetch_wikipedia_summary("המאובן במערת מיסליה", client, sem, lang="he")
        assert res2 is not None
        assert "he.wikipedia.org" in res2.get("wikiUrl", "")
        assert "מיסליה" in res2.get("wikiTitle", "")

@pytest.mark.asyncio
async def test_prehistoric_disambiguation_yiftahel():
    """
    Test that ambiguous title 'יפתחאל' correctly resolves to 'יפתחאל (אתר ארכאולוגי)'
    when provided with prehistoric context, and does NOT resolve to modern 'אורן יפתחאל'.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "יפתחאל",
            client,
            sem,
            lang="he",
            context_text="ארץ ישראל פרהיסטוריה אתר נאוליתי קדם-קרמי",
            year=-7000,
            is_prehistoric=True
        )
        assert res is not None
        assert "wikiTitle" in res
        # Must resolve to the archaeological site, NOT Oren Yiftachel
        assert "אתר ארכאולוגי" in res.get("wikiTitle", "")
        assert "אורן" not in res.get("wikiTitle", "")
        assert "he.wikipedia.org" in res.get("wikiUrl", "")
        assert "אתר ארכאולוגי" in (res.get("extract", "") + res.get("wikiTitle", ""))

@pytest.mark.asyncio
async def test_batch_disambiguation_with_timeline_topic():
    events = [
        {
            "id": "1",
            "title": "יפתחאל",
            "subtitle": "אתר נאוליתי",
            "from": {"year": -7000, "precision": "year"}
        }
    ]
    enriched = await enrich_events_with_wikipedia(events, lang="he", timeline_topic="ארץ ישראל פרהיסטוריה")
    assert len(enriched) == 1
    assert "אתר ארכאולוגי" in enriched[0].get("wikiTitle", "")
    assert "אורן" not in enriched[0].get("wikiTitle", "")

@pytest.mark.asyncio
async def test_missing_article_rejection_evron():
    """
    Test that an event without a dedicated Wikipedia page (e.g. 'אתר עברון')
    does NOT attach an irrelevant article (such as 'יוסף עבו עברון' or 'אמנון עברון' or 'עברון'),
    and is gracefully left without a Wikipedia link.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            "אתר עברון",
            client,
            sem,
            lang="he",
            context_text="ארץ ישראל פרהיסטוריה אתר פלאוליתי קדום מחצבה",
            year=-1000000,
            is_prehistoric=True
        )
        # Must be empty or have no wikiUrl to avoid false-positive linking
        assert not res or not res.get("wikiUrl")
        if res:
            assert "יוסף" not in res.get("wikiTitle", "")
            assert "אמנון" not in res.get("wikiTitle", "")
            assert "מינה" not in res.get("wikiTitle", "")

@pytest.mark.asyncio
async def test_search_wikipedia_candidates_lucy():
    from services.wiki_enricher import search_wikipedia_candidates
    async with httpx.AsyncClient(follow_redirects=True) as client:
        candidates = await search_wikipedia_candidates(
            "Lucy",
            client,
            lang="en",
            context_text="Human Evolution & Early Hominids",
            limit=5
        )
        assert len(candidates) > 0
        titles = [c["wikiTitle"] for c in candidates]
        assert "Lucy (hominid)" in titles or any("hominid" in t.lower() or "australopithecus" in t.lower() for t in titles)

@pytest.mark.asyncio
async def test_suggest_event_details_lucy():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import suggest_event_details
    res = await suggest_event_details(
        query="Lucy",
        timeline_topic="Human Evolution & Early Hominids",
        time_scale="prehistoric",
        lanes=[{"id": "fossils", "title": "Fossils"}, {"id": "tools", "title": "Stone Tools"}]
    )
    assert res is not None
    assert res.get("title")
    assert res.get("from", {}).get("year") is not None
    # For prehistoric hominid Lucy, the year should be negative millions of years ago
    assert res["from"]["year"] < -1000000
    assert res["from"]["precision"] == "million-years"
    assert res.get("imageUrl") or res.get("wikiUrl")


def test_input_validation_max_length():
    from pydantic import ValidationError
    from models import GenerateTimelineRequest, RefineTimelineRequest, EventSuggestionRequest, TimelineData

    # Valid prompt within bounds
    req = GenerateTimelineRequest(prompt="Valid prompt")
    assert req.prompt == "Valid prompt"

    # Prompt exceeding 400 characters must fail validation
    long_prompt = "A" * 401
    with pytest.raises(ValidationError):
        GenerateTimelineRequest(prompt=long_prompt)

    # Custom focus exceeding 300 characters must fail
    with pytest.raises(ValidationError):
        GenerateTimelineRequest(prompt="Valid prompt", custom_focus="F" * 301)

    # Refine instruction exceeding 500 characters must fail
    dummy_tl = TimelineData(id="1", title="Test")
    with pytest.raises(ValidationError):
        RefineTimelineRequest(timeline=dummy_tl, instruction="I" * 501)
    # 450 characters should succeed
    valid_refine = RefineTimelineRequest(timeline=dummy_tl, instruction="I" * 450)
    assert len(valid_refine.instruction) == 450

    # Event query exceeding 150 characters must fail
    with pytest.raises(ValidationError):
        EventSuggestionRequest(query="Q" * 151)


@pytest.mark.asyncio
async def test_simple_rate_limiter():
    from main import SimpleRateLimiter
    from fastapi import HTTPException
    from unittest.mock import MagicMock

    limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="test")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "192.168.1.100"

    # First 3 calls should succeed
    for _ in range(3):
        await limiter(mock_req, x_gemini_api_key=None)

    # 4th call should raise 429
    with pytest.raises(HTTPException) as exc_info:
        await limiter(mock_req, x_gemini_api_key=None)
    assert exc_info.value.status_code == 429


def test_timeline_article_geographic_fields():
    from models import TimelineArticle
    article = TimelineArticle(
        id="geo-test",
        title="Battle of Normandy",
        **{"from": {"year": 1944, "month": 6, "day": 6, "precision": "day"}},
        locationName="Normandy, France",
        lat=49.33,
        lng=-0.45,
        googleMapsUrl="https://www.google.com/maps/search/?api=1&query=49.33,-0.45"
    )
    dumped = article.model_dump(by_alias=True)
    assert dumped["locationName"] == "Normandy, France"
    assert dumped["lat"] == 49.33
    assert dumped["lng"] == -0.45
    assert dumped["googleMapsUrl"] == "https://www.google.com/maps/search/?api=1&query=49.33,-0.45"


def test_sample_timeline_has_geographic_data():
    from services.storage import get_sample_timeline
    sample = get_sample_timeline()
    articles_with_geo = [a for a in sample["articles"] if a.get("lat") is not None and a.get("lng") is not None]
    assert len(articles_with_geo) >= 6
    assert articles_with_geo[0]["locationName"] is not None
    assert articles_with_geo[0]["googleMapsUrl"] is not None


def test_system_instruction_single_lane_default():
    from services.gemini_service import get_system_instruction
    inst_en = get_system_instruction(is_hebrew=False)
    assert "EXACTLY ONE" in inst_en
    assert "DO NOT divide or split the timeline into multiple lanes by default" in inst_en
    assert "EXPLICIT MULTI-LANE EXCEPTION" in inst_en

    inst_he = get_system_instruction(is_hebrew=True)
    assert "EXACTLY ONE" in inst_he
    assert "DO NOT divide or split the timeline into multiple lanes by default" in inst_he
    assert "EXPLICIT MULTI-LANE EXCEPTION" in inst_he


@pytest.mark.asyncio
async def test_gemini_generation_default_single_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Prompt with no mention of lanes should produce exactly 1 lane
    tl = await generate_timeline_with_gemini(
        prompt="History of the Steam Engine",
        detail_level="overview"
    )
    assert tl is not None
    assert len(tl.lanes) == 1, f"Expected 1 lane by default, got {len(tl.lanes)}: {[l.title for l in tl.lanes]}"
    assert len(tl.articles) > 0
    lane_id = tl.lanes[0].id
    for a in tl.articles:
        assert a.lane == lane_id, f"Article {a.title} has lane {a.lane}, expected {lane_id}"


@pytest.mark.asyncio
async def test_gemini_generation_explicit_multi_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Prompt with explicit request for division into lanes should produce multiple lanes
    tl = await generate_timeline_with_gemini(
        prompt="The Space Race, divided into separate swimlanes for USA and Soviet Union",
        detail_level="overview"
    )
    assert tl is not None
    assert len(tl.lanes) >= 2, f"Expected multiple lanes on explicit instruction, got {len(tl.lanes)}"
    assert len(tl.articles) > 0
    assigned_lanes = {a.lane for a in tl.articles if a.lane}
    assert len(assigned_lanes) >= 2, f"Expected events in at least 2 lanes, got {assigned_lanes}"


@pytest.mark.asyncio
async def test_gemini_generation_hebrew_default_single_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Hebrew prompt with no mention of lanes should produce exactly 1 lane
    tl = await generate_timeline_with_gemini(
        prompt="תולדות הדפוס בעולם",
        detail_level="overview"
    )
    assert tl is not None
    assert len(tl.lanes) == 1, f"Expected 1 lane by default in Hebrew, got {len(tl.lanes)}: {[l.title for l in tl.lanes]}"
    assert len(tl.articles) > 0
    lane_id = tl.lanes[0].id
    for a in tl.articles:
        assert a.lane == lane_id, f"Article {a.title} has lane {a.lane}, expected {lane_id}"


@pytest.mark.asyncio
async def test_gemini_generation_hebrew_explicit_multi_lane():
    import os
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    from services.gemini_service import generate_timeline_with_gemini

    # Hebrew prompt with explicit request for division into lanes
    tl = await generate_timeline_with_gemini(
        prompt="מלחמת העולם השנייה עם חלוקה למסלולים לפי זירות (אירופה, אסיה והאוקיינוס השקט)",
        detail_level="overview"
    )
    assert tl is not None
    assert len(tl.lanes) >= 2, f"Expected multiple lanes on explicit Hebrew instruction, got {len(tl.lanes)}"
    assert len(tl.articles) > 0
    assigned_lanes = {a.lane for a in tl.articles if a.lane}
    assert len(assigned_lanes) >= 2, f"Expected events in at least 2 lanes, got {assigned_lanes}"


@pytest.mark.asyncio
async def test_refine_timeline_restructuring_and_preservation():
    from unittest.mock import MagicMock, patch
    from models import TimelineData, TimelineLane, TimelineArticle, TimelineDate, GeminiTimelineOutput, GeminiLaneItem, GeminiEventItem
    from services.gemini_service import refine_timeline_with_gemini

    # Existing timeline with 2 events in a single "main" lane
    initial_tl = TimelineData(
        id="tl-ww2",
        title="World War II",
        lanes=[TimelineLane(id="main", title="Main", color="#2b5278", order=1)],
        articles=[
            TimelineArticle(
                id="ev-dday",
                title="D-Day Normandy Landings",
                subtitle="Allied invasion of France",
                lane="main",
                **{"from": {"year": 1944, "month": 6, "day": 6, "precision": "day"}},
                imageUrl="https://upload.wikimedia.org/dday.jpg",
                wikiUrl="https://en.wikipedia.org/wiki/Normandy_landings",
                wikiTitle="Normandy landings",
                extract="Landings in Normandy...",
                rank=10,
                locationName="Normandy, France",
                lat=49.33,
                lng=-0.56,
                googleMapsUrl="https://www.google.com/maps/search/?api=1&query=49.33,-0.56"
            ),
            TimelineArticle(
                id="ev-pearl",
                title="Attack on Pearl Harbor",
                subtitle="Surprise attack by Imperial Japanese Navy",
                lane="main",
                **{"from": {"year": 1941, "month": 12, "day": 7, "precision": "day"}},
                imageUrl="https://upload.wikimedia.org/pearl.jpg",
                wikiUrl="https://en.wikipedia.org/wiki/Pearl_Harbor",
                wikiTitle="Attack on Pearl Harbor",
                extract="Attack on Pearl Harbor...",
                rank=9
            )
        ]
    )

    # Mock Gemini response restructuring into two lanes: Europe and Pacific/America
    mock_gemini_output = GeminiTimelineOutput(
        title="World War II - Divided Arenas",
        description="Restructured by operational theater",
        lanes=[
            GeminiLaneItem(id="europe", title="European Theater", color="#2b5278"),
            GeminiLaneItem(id="pacific", title="Pacific & American Theater", color="#b84a39")
        ],
        events=[
            # Reassign ev-dday to Europe
            GeminiEventItem(
                id="ev-dday",
                title="D-Day Normandy Landings",
                subtitle="Allied invasion of Normandy",
                lane="europe",
                from_year=1944,
                from_month=6,
                from_day=6,
                from_precision="day",
                wikipedia_title="Normandy landings"
            ),
            # Reassign ev-pearl to Pacific
            GeminiEventItem(
                id="ev-pearl",
                title="Attack on Pearl Harbor",
                subtitle="Surprise attack in Hawaii",
                lane="pacific",
                from_year=1941,
                from_month=12,
                from_day=7,
                from_precision="day",
                wikipedia_title="Attack on Pearl Harbor"
            ),
            # Add new event in Europe
            GeminiEventItem(
                id="new_battle_of_bulge",
                title="Battle of the Bulge",
                subtitle="German counter-offensive in the Ardennes",
                lane="europe",
                from_year=1944,
                from_month=12,
                from_day=16,
                from_precision="day",
                wikipedia_title="Battle of the Bulge"
            )
        ]
    )

    mock_response = MagicMock()
    mock_response.parsed = mock_gemini_output

    with patch("services.gemini_service.get_gemini_client") as mock_get_client, \
         patch("services.gemini_service.enrich_events_with_wikipedia") as mock_enrich:
        
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        mock_get_client.return_value = mock_client

        # Return mock enriched item for the new event
        mock_enrich.return_value = [
            {
                "id": "new_battle_of_bulge",
                "title": "Battle of the Bulge",
                "subtitle": "German counter-offensive in the Ardennes",
                "lane": "europe",
                "from": {"year": 1944, "month": 12, "day": 16, "precision": "day"},
                "rank": 5,
                "imageUrl": "https://upload.wikimedia.org/bulge.jpg",
                "wikiTitle": "Battle of the Bulge",
                "wikiUrl": "https://en.wikipedia.org/wiki/Battle_of_the_Bulge",
                "extract": "Major German campaign...",
                "locationName": "Ardennes",
                "lat": 50.25,
                "lng": 5.66
            }
        ]

        refined = await refine_timeline_with_gemini(
            current_timeline=initial_tl,
            instruction="divide the events into two timelines - one for Europe and one for Pacific/America and add Battle of the Bulge",
            api_key="test_key"
        )

        # 1. Lanes restructured to Europe and Pacific
        lane_ids = [l.id for l in refined.lanes]
        assert "europe" in lane_ids
        assert "pacific" in lane_ids

        # 2. Articles count
        assert len(refined.articles) == 3

        # 3. Verify ev-dday reassigned to europe and metadata preserved
        dday = next(a for a in refined.articles if a.id == "ev-dday")
        assert dday.lane == "europe"
        assert dday.imageUrl == "https://upload.wikimedia.org/dday.jpg", "Preserved existing thumbnail"
        assert dday.lat == 49.33, "Preserved coordinates"
        assert dday.wikiTitle == "Normandy landings"

        # 4. Verify ev-pearl reassigned to pacific
        pearl = next(a for a in refined.articles if a.id == "ev-pearl")
        assert pearl.lane == "pacific"
        assert pearl.imageUrl == "https://upload.wikimedia.org/pearl.jpg", "Preserved existing thumbnail"

        # 5. Verify new event enriched and present in europe
        bulge = next(a for a in refined.articles if a.id == "new_battle_of_bulge")
        assert bulge.lane == "europe"
        assert bulge.from_.year == 1944
        assert bulge.from_.month == 12

