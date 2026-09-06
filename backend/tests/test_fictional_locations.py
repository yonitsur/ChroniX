import pytest
import asyncio
from models import (
    TimelineData,
    TimelineArticle,
    TimelineDate,
    GeminiTimelineOutput,
    GeminiEventItem,
    EventSuggestionOutput
)
from services.wiki_enricher import is_fictional_context, enrich_events_with_wikipedia


def test_models_fictional_fields():
    """Verify isFictional field serialization on models."""
    # TimelineArticle
    art = TimelineArticle(
        id="got-1",
        title="Battle of the Blackwater",
        **{"from": {"year": 299}},
        locationName="King's Landing",
        lat=None,
        lng=None,
        googleMapsUrl=None,
        isFictional=True
    )
    dumped = art.model_dump(by_alias=True)
    assert dumped["isFictional"] is True
    assert dumped["locationName"] == "King's Landing"
    assert dumped["lat"] is None
    assert dumped["lng"] is None
    assert dumped["googleMapsUrl"] is None

    # TimelineData
    tl = TimelineData(
        id="tl-got",
        title="Game of Thrones Timeline",
        articles=[art],
        isFictional=True
    )
    tl_dumped = tl.model_dump(by_alias=True)
    assert tl_dumped["isFictional"] is True

    # Gemini Models
    ev_item = GeminiEventItem(
        id="ev-1",
        title="Frodo departs the Shire",
        from_year=3018,
        location_name="The Shire",
        lat=None,
        lng=None,
        is_fictional=True
    )
    assert ev_item.is_fictional is True

    tl_out = GeminiTimelineOutput(
        title="The Lord of the Rings Chronicles",
        description="A timeline of the Third Age of Middle-earth",
        is_fictional=True
    )
    assert tl_out.is_fictional is True

    sugg_out = EventSuggestionOutput(
        title="Red Wedding",
        from_year=299,
        location_name="The Twins",
        is_fictional=True
    )
    assert sugg_out.is_fictional is True


def test_is_fictional_context_detection():
    """Verify heuristic classification between fictional sagas and real history."""
    # Fictional queries (English & Hebrew)
    assert is_fictional_context("Game of Thrones Season 1") is True
    assert is_fictional_context("משחקי הכס: שושלת טארגאריין") is True
    assert is_fictional_context("The Narrow Sea", "Westeros") is True
    assert is_fictional_context("הים הצר") is True
    assert is_fictional_context("Lord of the Rings: Third Age of Middle-earth") is True
    assert is_fictional_context("שר הטבעות: מסע אחוות הטבעת") is True
    assert is_fictional_context("Harry Potter and the Battle of Hogwarts") is True
    assert is_fictional_context("הארי פוטר בוגוורטס") is True
    assert is_fictional_context("Star Wars: Battle of Yavin and Tatooine") is True
    assert is_fictional_context("מלחמת הכוכבים: עלייתו של סקייווקר") is True
    assert is_fictional_context("Dune: Battle of Arrakeen on Arrakis") is True
    assert is_fictional_context("חולית: פאול אטרייאידס") is True

    # Real historical / scientific queries
    assert is_fictional_context("World War II in Europe") is False
    assert is_fictional_context("Battle of Normandy", "France") is False
    assert is_fictional_context("המהפכה הצרפתית", "פריז") is False
    assert is_fictional_context("נחיתת אפולו 11 על הירח") is False
    assert is_fictional_context("Roman Empire under Julius Caesar") is False
    assert is_fictional_context("Evolution of Early Hominids in Africa") is False


@pytest.mark.asyncio
async def test_enrich_events_suppresses_fictional_coordinates():
    """Verify that fictional events strictly have coordinates wiped and geocoding bypassed."""
    fictional_events = [
        {
            "id": "got-1",
            "title": "Crossing the Narrow Sea",
            "subtitle": "Daenerys sails across the Narrow Sea",
            "location_name": "The Narrow Sea",
            # Even if dummy coordinates were hallucinated, they must be stripped
            "lat": 27.84,
            "lng": 34.56,
            "is_fictional": True,
            "from": {"year": 298}
        },
        {
            "id": "lotr-1",
            "title": "Destruction of the One Ring",
            "subtitle": "Frodo reaches Mount Doom",
            "location_name": "Mount Doom, Mordor",
            "from": {"year": 3019}
        }
    ]

    # Enrich with fictional context
    results = await enrich_events_with_wikipedia(
        fictional_events,
        lang="en",
        timeline_topic="Game of Thrones & Middle-earth Sagas",
        is_timeline_fictional=True
    )

    for ev in results:
        assert ev["is_fictional"] is True, f"Event {ev['title']} must be marked is_fictional"
        assert ev["lat"] is None, f"Event {ev['title']} must have lat=None, got {ev['lat']}"
        assert ev["lng"] is None, f"Event {ev['title']} must have lng=None, got {ev['lng']}"
        assert ev.get("location_name") is not None, "location_name must be preserved for lore"


@pytest.mark.asyncio
async def test_enrich_events_preserves_real_coordinates():
    """Verify that real events still maintain their valid coordinates."""
    real_events = [
        {
            "id": "dday-1",
            "title": "D-Day Normandy Landings",
            "subtitle": "Allied forces land on Normandy beaches",
            "location_name": "Normandy, France",
            "lat": 49.33,
            "lng": -0.45,
            "is_fictional": False,
            "from": {"year": 1944, "month": 6, "day": 6}
        }
    ]

    results = await enrich_events_with_wikipedia(
        real_events,
        lang="en",
        timeline_topic="World War II",
        is_timeline_fictional=False
    )

    assert len(results) == 1
    assert results[0]["lat"] == 49.33
    assert results[0]["lng"] == -0.45
    assert results[0].get("is_fictional") is not True


@pytest.mark.asyncio
async def test_generate_timeline_fictional_mock(monkeypatch):
    """Verify that generate_timeline_with_gemini correctly defines and handles is_fictional without NameError."""
    from unittest.mock import MagicMock
    import services.gemini_service as gs
    from models import GeminiTimelineOutput, GeminiEventItem, GeminiLaneItem

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.parsed = GeminiTimelineOutput(
        title="משחקי הכס: שושלת טארגאריין",
        description="ציר זמן בדיוני של ווסטרוז",
        is_fictional=True,
        lanes=[GeminiLaneItem(id="main", title="וסטרוז")],
        events=[
            GeminiEventItem(
                id="ev-1",
                title="כיבוש אאיגון",
                subtitle="אאיגון הראשון נוחת בווסטרוז",
                from_year=0,
                location_name="מעלה מלך",
                lat=31.5,
                lng=35.2,
                is_fictional=True
            )
        ]
    )
    mock_client.models.generate_content.return_value = mock_response
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: mock_client)

    tl = await gs.generate_timeline_with_gemini(
        prompt="משחקי הכס: שושלת טארגאריין",
        detail_level="overview"
    )

    assert tl is not None
    assert tl.isFictional is True
    assert len(tl.articles) == 1
    art = tl.articles[0]
    assert art.isFictional is True
    assert art.lat is None, "Fictional event lat must be None"
    assert art.lng is None, "Fictional event lng must be None"
    assert art.googleMapsUrl is None, "Google Maps URL must be None for fictional events"
    assert art.locationName == "מעלה מלך"

