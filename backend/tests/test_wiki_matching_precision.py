"""Deterministic regressions for Wikipedia-link and image matching precision (no network)."""
import pytest

from services import wiki_enricher
from services.wiki_enricher import (
    _filename_from_url,
    _image_key,
    is_year_article_title,
    qualifier_supported,
    score_candidate,
    score_image,
    title_year_conflicts,
    MIN_CONFIDENCE_THRESHOLD,
)


def test_title_year_conflicts_only_uses_qualifier_years():
    assert title_year_conflicts("Siege of Jerusalem (1099)", -63) is True
    assert title_year_conflicts("The Legend of Zelda: Ocarina of Time (משחק וידאו, 2026)", 1986) is True
    # Compatible qualifier years (BCE markers are compared by magnitude)
    assert title_year_conflicts("Love Me Tender (1956 film)", 1956) is False
    assert title_year_conflicts('קרב בית חורון (166 לפנה"ס)', -166) is False
    assert title_year_conflicts("Battle of Mantinea (418 BC)", -418) is False
    assert title_year_conflicts("John Smith (1580–1631)", 1607) is False
    # Numbers in the title body are part of the name, not a date
    assert title_year_conflicts("STS-114", 2005) is False
    assert title_year_conflicts("Intel 4004", 1971) is False
    assert title_year_conflicts("Siege of Jerusalem (1099)", None) is False


def test_year_article_titles_rejected_but_numbered_names_kept():
    for t in ["1792", "1983", "1990s", "79 BC", 'AD 79', '63 לפנה"ס']:
        assert is_year_article_title(t) is True, t
    for t in ["Apollo 11", "STS-114", "GW170817", "Area 51", "Intel 4004", "2001: A Space Odyssey", "1917 (2019 film)"]:
        assert is_year_article_title(t) is False, t


def test_qualifier_must_be_reflected_in_landed_article():
    light = {"wikiTitle": "אור", "description": "קרינה אלקטרומגנטית בסביבת התחום הנראה", "extract": "אור הוא קרינה אלקטרומגנטית"}
    ur_continent = {"wikiTitle": "Ur (continent)", "description": "Hypothetical Archaean supercontinent", "extract": "Ur is a hypothesized supercontinent"}
    journalist = {"wikiTitle": "יואש אלרואי", "description": "עיתונאי ישראלי", "extract": "יואש אלרואי הוא עיתונאי ושדר ישראלי"}
    king = {"wikiTitle": "יואש מלך ישראל", "description": "מלך ממלכת ישראל", "extract": "יואש היה מלך ישראל"}

    assert qualifier_supported("continent", light) is False
    assert qualifier_supported("continent", ur_continent) is True
    # 'ישראלי' (Israeli) must not satisfy 'מלך ישראל' (king of Israel) on its own
    assert qualifier_supported("מלך ישראל", journalist) is False
    assert qualifier_supported("מלך ישראל", king) is True


def test_search_scoring_rejects_other_senses_and_single_generic_words():
    creation_film = {"wikiTitle": "Creation (1922 film)", "description": "1922 film", "extract": "Creation is a 1922 British silent film."}
    assert score_candidate(creation_film, "Creation (Rivera)", context_text="Diego Rivera mural 1922", year=1922) < MIN_CONFIDENCE_THRESHOLD

    tethys_goddess = {"wikiTitle": "Tethys", "description": "Titaness and sea goddess", "extract": "Tethys was a Titaness in Greek mythology."}
    assert score_candidate(tethys_goddess, "Tethys (ocean)", context_text="Pangaea breakup ocean") < MIN_CONFIDENCE_THRESHOLD

    crash = {"wikiTitle": "התרסקות", "description": "", "extract": "התרסקות היא אירוע שבו כלי טיס פוגע בקרקע", "imageUrl": "x"}
    assert score_candidate(crash, "התרסקות משחקי הווידאו של 1983", context_text="משחקי הווידאו משבר", year=1983) < MIN_CONFIDENCE_THRESHOLD

    scooby = {"wikiTitle": "סקובי-דו ופלישת החייזרים", "description": "סרט", "extract": "סרט אנימציה משנת 2000", "imageUrl": "x"}
    assert score_candidate(scooby, "פלישת החייזרים", context_text="משחקי הווידאו השקת Space Invaders", year=1978) < MIN_CONFIDENCE_THRESHOLD

    # Legitimate matches keep passing
    mercury = {"wikiTitle": "Mercury (planet)", "description": "Planet in the Solar System", "extract": "Mercury is the first planet from the Sun."}
    assert score_candidate(mercury, "Mercury (planet)", context_text="solar system planets") >= MIN_CONFIDENCE_THRESHOLD
    cambrian = {"wikiTitle": "Cambrian", "description": "First period of the Paleozoic Era", "extract": "The Cambrian is the first geological period of the Paleozoic Era.", "imageUrl": "x"}
    assert score_candidate(cambrian, "The Cambrian Period", context_text="geological time scale Paleozoic period") >= MIN_CONFIDENCE_THRESHOLD


@pytest.mark.asyncio
async def test_stripped_qualifier_landing_on_other_sense_is_rejected(monkeypatch):
    """'Ur (continent)' missing -> bare 'Ur' lands on 'Light'; that must not be accepted."""
    calls = []

    async def fake_summary(title, client, lang="en", resolve_disambig=True, context_text="", year=None):
        calls.append(title)
        if title == "אור":
            return {"wikiTitle": "אור", "description": "קרינה אלקטרומגנטית", "extract": "אור הוא קרינה", "lang": "he"}
        return None

    monkeypatch.setattr(wiki_enricher, "_get_summary_direct", fake_summary)
    res = await wiki_enricher._lookup_direct("אור (יבשת-על)", client=None, lang="he", context_text="היסטוריה של כדור הארץ")
    assert res is None
    assert calls == ["אור (יבשת-על)", "אור"]


@pytest.mark.asyncio
async def test_exact_fallback_title_beats_loose_local_search(monkeypatch):
    """Cross-lingual: the exact English article must be used before any fuzzy local search."""
    search_calls = []

    async def fake_summary(title, client, lang="en", resolve_disambig=True, context_text="", year=None):
        if lang == "en" and title == "Battle of Amphipolis":
            return {"wikiTitle": "Battle of Amphipolis", "wikiUrl": "https://en.wikipedia.org/wiki/Battle_of_Amphipolis", "lang": "en"}
        return None

    async def fake_probe(title, from_lang, to_lang, client):
        return {"exists": title == "Battle of Amphipolis", "langlink": None}

    async def fake_search(**kwargs):
        search_calls.append(kwargs.get("lang"))
        return {"wikiTitle": "אמפיפוליס", "lang": "he"}  # the city: a loose local hit

    monkeypatch.setattr(wiki_enricher, "_get_summary_direct", fake_summary)
    monkeypatch.setattr(wiki_enricher, "_probe_title", fake_probe)
    monkeypatch.setattr(wiki_enricher, "_find_best_search_candidate", fake_search)

    import asyncio
    res = await wiki_enricher.fetch_wikipedia_summary(
        "קרב אמפיפוליס", None, asyncio.Semaphore(1), lang="he", year=-422,
        fallback_lang="en", fallback_title="Battle of Amphipolis",
    )
    assert res["wikiTitle"] == "Battle of Amphipolis"
    assert search_calls == []


@pytest.mark.asyncio
async def test_disambiguation_ignores_shared_name_and_requires_clear_winner(monkeypatch):
    class FakeResp:
        status_code = 200

        def __init__(self, wikitext):
            self._wt = wikitext

        def json(self):
            return {"parse": {"links": [], "wikitext": {"*": self._wt}}}

    class FakeClient:
        def __init__(self, wikitext):
            self.wt = wikitext

        async def get(self, *args, **kwargs):
            return FakeResp(self.wt)

    async def fake_summary(title, client, lang="en", resolve_disambig=True, context_text="", year=None):
        return {"wikiTitle": title}

    monkeypatch.setattr(wiki_enricher, "_get_summary_direct", fake_summary)

    page = "* [[יואש אלרואי]], עיתונאי ושדר\n* [[יואש (מלך ישראל)]], מלך ממלכת ישראל"
    res = await wiki_enricher._resolve_disambiguation(
        "יואש", FakeClient(page), lang="he", context_text="מלכי ישראל ויהודה מלחמת יואש מלך ישראל ואמציה"
    )
    assert res["wikiTitle"] == "יואש (מלך ישראל)"

    # Only the shared name overlaps -> no evidence -> no link
    res = await wiki_enricher._resolve_disambiguation(
        "יואש", FakeClient(page), lang="he", context_text="יואש"
    )
    assert res is None


def test_filename_from_thumb_url_uses_original_name():
    generic = (
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/Lieutenant_General_Bernard_Montgomery%2C"
        "_at_El_Alamein.jpg/500px-thumbnail.jpg?utm_source=commons.wikimedia.org"
    )
    assert _filename_from_url(generic) == "Lieutenant_General_Bernard_Montgomery,_at_El_Alamein.jpg"
    lang_render = (
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Map_Peloponnesian_War_431_BC-en.svg/"
        "langhe-330px-Map_Peloponnesian_War_431_BC-en.svg.png"
    )
    assert _filename_from_url(lang_render) == "Map_Peloponnesian_War_431_BC-en.svg"
    # API titles (spaces) and URLs (underscores) share one dedup key
    assert _image_key("Foo bar.jpg") == _image_key("Foo_bar.jpg")


def test_gif_gate_uses_canonical_titles_not_narrative_event_title():
    green = {
        "filename": "Green Function of Wave Equation - 2D vs 3D.gif", "caption": "", "mime": "image/gif",
        "width": 556, "source": "commons_gif", "is_animated": True,
    }
    ctx = "Paul Dirac Predicts Antimatter with Relativistic Wave Equation Dirac equation 1928"
    assert score_image(green, ctx, ["Dirac equation"]) is None

    packet = {
        "filename": "Schrödinger_equation_wave_packet.gif", "caption": "", "mime": "image/gif",
        "width": 400, "source": "article", "is_animated": True,
    }
    assert score_image(packet, "Erwin Schrödinger Publishes Wave Mechanics Schrödinger equation 1926", ["Schrödinger equation"]) is not None


def test_search_derived_media_needs_specific_subject_evidence():
    # Commons static fallback with no subject evidence (was accepted at score 6)
    scan = {
        "filename": "KU-620A_-_DPLA_-_071d0992a583373d79bc3fee113063b9_(page_2).jpg", "caption": "",
        "mime": "image/jpeg", "width": 400, "source": "commons",
    }
    assert score_image(scan, "Jerry Donohue Corrects Tautomeric Base Forms Jerry Donohue 1953", ["Jerry Donohue"]) is None
    portrait = dict(scan, filename="Jerry_Donohue_1950.jpg")
    assert score_image(portrait, "Jerry Donohue Corrects Tautomeric Base Forms Jerry Donohue 1953", ["Jerry Donohue"]) is not None

    # A one-word subject echoed back by the search term is not enough...
    spinning = {"filename": "Spinning Mars.gif", "caption": "", "mime": "image/gif", "width": 400,
                "source": "commons_gif", "is_animated": True}
    assert score_image(spinning, "Mars Rover Landing Mars 2012", ["Mars"]) is None
    # ...but an extra event-specific token makes it specific.
    breakup = {"filename": "Pangaea Breakup.gif", "caption": "", "mime": "image/gif", "width": 400,
               "source": "commons_gif", "is_animated": True}
    assert score_image(breakup, "Breakup of Pangaea Pangaea -175000000", ["Pangaea"]) is not None


@pytest.mark.asyncio
async def test_timeline_topic_no_longer_outranks_article_lead(monkeypatch):
    """Topic words shared by every event must not pull in an off-era on-theme photo."""

    async def fake_summary(title, client, semaphore, **kwargs):
        return {"wikiTitle": "Roald Amundsen", "wikiUrl": "https://en.wikipedia.org/wiki/Roald_Amundsen",
                "extract": "Norwegian explorer", "imageUrl": "https://img.example/Amundsen_in_fur_skins.jpg",
                "lat": None, "lng": None, "lang": "en"}

    async def fake_candidates(title, client, semaphore, **kwargs):
        return [
            {"url": "https://img.example/Amundsen_in_fur_skins.jpg", "filename": "Amundsen_in_fur_skins.jpg",
             "caption": "", "width": 400, "mime": "image/jpeg", "isLead": True, "source": "article",
             "key": "amundsen_in_fur_skins.jpg"},
            {"url": "https://img.example/station.jpg", "filename": "Amundsen-scott-south_pole_station_2007.jpg",
             "caption": "", "width": 400, "mime": "image/jpeg", "isLead": False, "source": "article",
             "key": "amundsen-scott-south_pole_station_2007.jpg"},
        ]

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    events = [{"id": "a", "title": "Amundsen Announces Victory to the World", "wikipedia_title": "Roald Amundsen",
               "rank": 8, "from": {"year": 1912}}]
    enriched = await wiki_enricher.enrich_events_with_wikipedia(
        events, lang="en", timeline_topic="Amundsen vs Scott: The Race to the South Pole"
    )
    assert enriched[0]["imageUrl"] == "https://img.example/Amundsen_in_fur_skins.jpg"
