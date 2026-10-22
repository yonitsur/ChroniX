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


@pytest.mark.asyncio
async def test_bunten_disambiguation_strips_section_anchor_and_ignores_see_also(monkeypatch):
    """
    Regression for 'Art of the Meiji Era' -> 'Inauguration of the Bunten (Ministry of Education Fine Arts Exhibition)':
    1. Section anchor '[[Japan Fine Arts Exhibition#Bunten|Japan Fine Arts Exhibition]]' must match mainspace_links.
    2. '==See also==' entry '[[Danielle Bunten Berry]]' must be ignored.
    3. Random contemporaries (1875–1935) with 0 topical overlap and nearby years ('1908' vs '1907') must not win.
    """
    wikitext = (
        "'''Bunten''' may refer to:\n"
        "==People==\n"
        "*Alice Chambers Bunten (1850–1940), Scottish lyricist for ''[[Salut d'Amour]]'', composer, and biographer of [[Alice Barnham]]\n"
        "*[[Bill Bunten]] (1930–2020), American politician from Kansas\n"
        "*[[James Clark Bunten (engineer)]] (1838–1901), Scottish engineer who became chairman of the Caledonian Railway\n"
        "*[[James Clark Bunten (sailor)]] (1875–1935), Scottish sailor who competed at the 1908 Summer Olympics\n\n"
        "==Other==\n"
        "*Bunten, a name for the [[Japan Fine Arts Exhibition#Bunten|Japan Fine Arts Exhibition]]\n\n"
        "==See also==\n"
        "*[[Danielle Bunten Berry]], American game designer and programmer\n"
    )

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "parse": {
                    "links": [
                        {"ns": 0, "*": "Salut d'Amour"},
                        {"ns": 0, "*": "Alice Barnham"},
                        {"ns": 0, "*": "Bill Bunten"},
                        {"ns": 0, "*": "James Clark Bunten (engineer)"},
                        {"ns": 0, "*": "James Clark Bunten (sailor)"},
                        {"ns": 0, "*": "Japan Fine Arts Exhibition"},
                        {"ns": 0, "*": "Danielle Bunten Berry"},
                    ],
                    "wikitext": {"*": wikitext},
                }
            }

    class FakeClient:
        async def get(self, *args, **kwargs):
            return FakeResp()

    async def fake_summary(title, client, lang="en", resolve_disambig=True, context_text="", year=None):
        return {"wikiTitle": title, "wikiUrl": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"}

    monkeypatch.setattr(wiki_enricher, "_get_summary_direct", fake_summary)

    res = await wiki_enricher._resolve_disambiguation(
        "Bunten",
        FakeClient(),
        lang="en",
        context_text="Art of the Meiji Era Inauguration of the Bunten (Ministry of Education Fine Arts Exhibition) Painting & Calligraphy 1907",
        year=1907,
    )
    assert res is not None
    assert res["wikiTitle"] == "Japan Fine Arts Exhibition"

    # Also when the event title omits "Fine Arts Exhibition" ("Inauguration of the Bunten Government Salon")
    # and the subtitle includes common verbs like "became" that appear in "James Clark Bunten (engineer)"
    res_salon = await wiki_enricher._resolve_disambiguation(
        "Bunten",
        FakeClient(),
        lang="en",
        context_text=(
            "Art of the Meiji Era Inauguration of the Bunten Government Salon Institutional & Politics "
            "The Ministry of Education established the annual Bunten exhibition, modeling it directly on "
            "the French Salon. Divided into sections for Japanese Painting, Western Painting, and Sculpture, "
            "the salon became the preeminent arena for modern Japanese art. 1907"
        ),
        year=1907,
    )
    assert res_salon is not None
    assert res_salon["wikiTitle"] == "Japan Fine Arts Exhibition"


def test_hyphenated_and_morphological_multiword_title_relevance():
    """Hyphenated compounds ('Hakuba-kai' vs 'Hakubakai') and plural/singular multi-word titles must match."""
    from services.wiki_enricher import is_title_relevant

    assert is_title_relevant("Hakuba-kai", "Hakubakai") is True
    assert is_title_relevant("National Industrial Exhibitions", "First National Industrial Exhibition") is True


def test_single_word_query_rejected_against_multiword_person_name():
    """A 1-word query ('Bunten') must not match a multi-word person name ('Danielle Bunten Berry') or inflate via stopwords."""
    from services.wiki_enricher import is_title_relevant

    assert is_title_relevant("Danielle Bunten Berry", "Bunten") is False

    danielle = {
        "wikiTitle": "Danielle Bunten Berry",
        "description": "American game designer and programmer",
        "extract": (
            "Danielle Bunten Berry, was an American game designer and programmer, known for the "
            "1983 game M.U.L.E., one of the first influential multiplayer video games, and 1984's "
            "The Seven Cities of Gold."
        ),
        "imageUrl": "https://upload.wikimedia.org/danielle.jpg",
    }
    score = score_candidate(
        danielle,
        "Bunten",
        context_text="Art of the Meiji Era Inauguration of the Bunten (Ministry of Education Fine Arts Exhibition) 1907",
        year=1907,
    )
    assert score < MIN_CONFIDENCE_THRESHOLD


@pytest.mark.asyncio
async def test_cross_lingual_false_homograph_falls_back_to_english_bridge(monkeypatch):
    """
    When a local Hebrew title ('גיאה' = Moshav Ge'a) has 0 context overlap with a car design event
    and explicit fallback_title='Carrozzeria Ghia' exists on English Wikipedia without linking to 'גיאה',
    discard the false local homograph and use the English bridge.
    """
    import asyncio

    async def fake_lookup_direct(title, client, lang, context_text="", year=None, skip_exact=False):
        if lang == "he" and title == "גיאה":
            return {
                "wikiTitle": "גיאה",
                "wikiUrl": "https://he.wikipedia.org/wiki/גיאה",
                "description": "מושב במישור החוף הדרומי",
                "extract": "גיאה הוא מושב באזור אשקלון שהוקם בשנת 1949.",
                "lang": "he",
            }
        if lang == "en" and title == "Carrozzeria Ghia":
            return {
                "wikiTitle": "Carrozzeria Ghia",
                "wikiUrl": "https://en.wikipedia.org/wiki/Carrozzeria_Ghia",
                "description": "Italian automobile design and coachbuilding firm",
                "extract": "Carrozzeria Ghia is an Italian automobile design firm.",
                "lang": "en",
            }
        return None

    async def fake_probe(title, from_lang, to_lang, client):
        if title == "Carrozzeria Ghia":
            return {"exists": True, "langlink": None}
        return {"exists": False, "langlink": None}

    monkeypatch.setattr(wiki_enricher, "_lookup_direct", fake_lookup_direct)
    monkeypatch.setattr(wiki_enricher, "_probe_title", fake_probe)

    res = await wiki_enricher.fetch_wikipedia_summary(
        "גיאה",
        None,
        asyncio.Semaphore(1),
        lang="he",
        context_text="ג'ורג'טו ג'וג'ארו הצטרפות לסדנת העיצוב גיאה קריירה מוקדמת Carrozzeria Ghia 1965",
        year=1965,
        fallback_lang="en",
        fallback_title="Carrozzeria Ghia",
    )
    assert res["wikiTitle"] == "Carrozzeria Ghia"


@pytest.mark.asyncio
async def test_batch_llm_adjudicator_rescues_alias_rejects_homograph_and_ranks_image(monkeypatch):
    """
    Verify _llm_adjudicate_enrichment:
    - Event 0: Rescues a romaji alias ('Monbushō Bijutsu Tenrankai') with 0 English lexical overlap
      by selecting candidate A0 ('Japan Fine Arts Exhibition') and refreshing its image candidates.
    - Event 1: Suppresses a false homograph ('Battle of Morotai' on a geological timeline) when LLM returns 'NONE'.
    - Event 2: Promotes the LLM-selected period-accurate image ('I1') for the de-duplication pass.
    """
    import asyncio

    captured_payload = {}

    async def fake_gemini_adjudicator(payload, api_key, preferred_model=None):
        captured_payload.update(payload)
        return {
            "decisions": [
                {"event_index": 0, "article_id": "A0", "image_id": None},
                {"event_index": 1, "article_id": "NONE", "image_id": "NONE"},
                {"event_index": 2, "article_id": "A0", "image_id": "I1"},
            ]
        }

    async def fake_fetch_images(title, client, semaphore, **kwargs):
        if title == "Japan Fine Arts Exhibition":
            return [
                {
                    "url": "https://img.example/Bunten_1907.jpg",
                    "filename": "Bunten_1907.jpg",
                    "caption": "First Bunten exhibition in Ueno, 1907",
                    "width": 500,
                    "mime": "image/jpeg",
                    "isLead": True,
                    "source": "article",
                    "key": "bunten_1907.jpg",
                }
            ]
        return []

    monkeypatch.setattr(wiki_enricher, "_call_gemini_adjudicator_json", fake_gemini_adjudicator)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_fetch_images)

    events_data = [
        {
            "id": "ev0",
            "title": "Inauguration of the Bunten Government Salon",
            "subtitle": "The Ministry of Education established the annual Bunten exhibition.",
            "wikipedia_title": "Monbushō Bijutsu Tenrankai",
            "from": {"year": 1907},
        },
        {
            "id": "ev1",
            "title": "Subduction of the Halmahera Plate under Morotai",
            "subtitle": "Tectonic uplift formed the Morotai basin during the Miocene.",
            "wikipedia_title": "Morotai",
            "from": {"year": -15000000},
        },
        {
            "id": "ev2",
            "title": "Launch of the Volkswagen Golf Mk1",
            "subtitle": "Giugiaro's folded-paper hatchback design debuted in 1974.",
            "wikipedia_title": "Volkswagen Golf",
            "from": {"year": 1974},
        },
    ]

    results = [
        {
            "res": {},
            "article_candidates": [
                {
                    "wikiTitle": "Japan Fine Arts Exhibition",
                    "wikiUrl": "https://en.wikipedia.org/wiki/Japan_Fine_Arts_Exhibition",
                    "description": "Annual art exhibition in Japan",
                    "extract": "The Japan Fine Arts Exhibition (Nitten), initially called Bunten (Monbushō Bijutsu Tenrankai), began in 1907.",
                    "imageUrl": "https://img.example/Bunten_1907.jpg",
                    "lang": "en",
                }
            ],
            "candidates": [],
            "image_context": "Inauguration of the Bunten Government Salon 1907",
            "anchors": ["Monbushō Bijutsu Tenrankai"],
            "event_year": 1907,
        },
        {
            "res": {
                "wikiTitle": "Battle of Morotai",
                "wikiUrl": "https://en.wikipedia.org/wiki/Battle_of_Morotai",
                "description": "1944 World War II Pacific battle",
                "extract": "The Battle of Morotai was fought in September 1944 during World War II.",
                "imageUrl": "https://img.example/Morotai_1944.jpg",
                "lang": "en",
                "_resolution_mode": "search",
            },
            "article_candidates": [],
            "candidates": [],
            "image_context": "Subduction of the Halmahera Plate under Morotai",
            "anchors": ["Battle of Morotai"],
            "event_year": -15000000,
        },
        {
            "res": {
                "wikiTitle": "Volkswagen Golf",
                "wikiUrl": "https://en.wikipedia.org/wiki/Volkswagen_Golf",
                "description": "Compact car manufactured by Volkswagen",
                "extract": "The Volkswagen Golf is a compact car produced since 1974, designed by Giorgetto Giugiaro.",
                "lang": "en",
                "_resolution_mode": "direct",
            },
            "article_candidates": [],
            "candidates": [
                {
                    "url": "https://img.example/VW_Golf_generic.jpg",
                    "filename": "VW_Golf_generic.jpg",
                    "caption": "Volkswagen Golf",
                    "width": 500,
                    "mime": "image/jpeg",
                    "isLead": True,
                    "source": "article",
                    "key": "vw_golf_generic.jpg",
                },
                {
                    "url": "https://img.example/VW_Golf_Mk1_Giugiaro_sketch.jpg",
                    "filename": "VW_Golf_Mk1_Giugiaro_sketch.jpg",
                    "caption": "Original Giugiaro folded-paper design study",
                    "width": 500,
                    "mime": "image/jpeg",
                    "isLead": False,
                    "source": "article",
                    "key": "vw_golf_mk1_giugiaro_sketch.jpg",
                },
            ],
            "image_context": "Launch of the Volkswagen Golf Mk1 Volkswagen Golf 1974",
            "anchors": ["Volkswagen Golf"],
            "event_year": 1974,
        },
    ]

    await wiki_enricher._llm_adjudicate_enrichment(
        events_data=events_data,
        results=results,
        client=None,
        semaphore=asyncio.Semaphore(5),
        lang="en",
        timeline_topic="Test Topic",
        api_key="fake-key",
    )

    # Event 0 rescued "Japan Fine Arts Exhibition" and fetched its image candidates
    assert results[0]["res"]["wikiTitle"] == "Japan Fine Arts Exhibition"
    assert len(results[0]["candidates"]) == 1
    assert results[0]["candidates"][0]["filename"] == "Bunten_1907.jpg"

    # Event 1 false match "Battle of Morotai" suppressed completely
    assert results[1]["res"] == {}
    assert results[1]["candidates"] == []
    assert results[1].get("_suppress_lead_fallback") is True

    # Event 2 promoted LLM-selected image I1
    assert results[2].get("llm_preferred_image_key") == "vw_golf_mk1_giugiaro_sketch.jpg"


