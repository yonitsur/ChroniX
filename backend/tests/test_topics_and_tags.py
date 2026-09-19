import pytest
import json
from services.storage import (
    _extract_categories,
    _extract_tags,
    list_public_timelines,
    save_timeline_data
)
import main

@pytest.fixture
def mock_storage(tmp_path, monkeypatch):
    """Setup an isolated local directory for testing topic and tag features."""
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    timelines_file = data_dir / "timelines.json"
    likes_file = data_dir / "timeline_likes.json"
    comments_file = data_dir / "timeline_comments.json"

    # Disable Supabase so local JSON storage is used
    monkeypatch.setattr("services.storage.SUPABASE_URL", "")
    monkeypatch.setattr("services.storage.SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr("services.storage.DATA_DIR", data_dir)
    monkeypatch.setattr("services.storage.TIMELINES_FILE", timelines_file)
    monkeypatch.setattr("services.storage.LIKES_FILE", likes_file)
    monkeypatch.setattr("services.storage.COMMENTS_FILE", comments_file)

    timelines = [
        {
            "id": "tl-tech-usa",
            "title": "History of Silicon Valley and Computing",
            "description": "The rapid rise of microprocessors and personal computing in America.",
            "timeScale": "calendar",
            "categories": ["Science & Technology", "History & Politics"],
            "tags": ["America", "Technology", "Computing", "Silicon Valley"],
            "articles": [
                {"id": "ev-1", "title": "Fairchild Semiconductor", "category": "Technology"},
                {"id": "ev-2", "title": "Birth of Apple", "category": "Technology"}
            ],
            "is_public": True,
            "updatedAt": "2026-03-01T10:00:00Z"
        },
        {
            "id": "tl-nature-horse",
            "title": "Evolution of the Horse",
            "description": "50 million years of equine adaptation from Eohippus to modern Equus.",
            "timeScale": "prehistoric",
            "categories": ["Nature & Evolution"],
            "tags": ["Evolution", "Mammals", "Paleontology"],
            "articles": [
                {"id": "ev-3", "title": "Eohippus appears", "category": "Prehistoric"},
                {"id": "ev-4", "title": "Modern Equus", "category": "Biology"}
            ],
            "is_public": True,
            "updatedAt": "2026-03-02T10:00:00Z"
        },
        {
            "id": "tl-space-apollo",
            "title": "The Apollo Moon Program",
            "description": "NASA's historic manned lunar landing missions in the 1960s.",
            "timeScale": "calendar",
            "categories": ["Space & Aviation", "Science & Technology"],
            "tags": ["America", "Space", "NASA", "Moon"],
            "articles": [
                {"id": "ev-5", "title": "Apollo 11 Landing", "category": "Space Exploration"}
            ],
            "is_public": True,
            "updatedAt": "2026-03-03T10:00:00Z"
        },
        {
            "id": "tl-fallback-rome",
            "title": "The Rise and Fall of the Roman Empire",
            "description": "From Republic to Augustus, military conquests and the fall of Rome.",
            "timeScale": "calendar",
            # No explicit categories or tags: should test smart fallback extraction!
            "articles": [
                {"id": "ev-6", "title": "Crossing the Rubicon", "category": "Military"},
                {"id": "ev-7", "title": "Pax Romana", "category": "Politics"}
            ],
            "is_public": True,
            "updatedAt": "2026-03-04T10:00:00Z"
        }
    ]

    with open(timelines_file, "w", encoding="utf-8") as f:
        json.dump(timelines, f)

    return timelines_file


def test_explicit_categories_and_tags_extraction():
    data = {
        "title": "Sample",
        "categories": ["Space & Aviation", "Science & Technology"],
        "tags": ["NASA", "Rocket", "Moon"]
    }
    cats = _extract_categories(data)
    tags = _extract_tags(data)
    assert cats == ["Space & Aviation", "Science & Technology"]
    assert tags == ["NASA", "Rocket", "Moon"]


def test_smart_fallback_extraction():
    data = {
        "title": "Rise of Ancient Rome and Julius Caesar",
        "description": "The military battles and politics of the Roman Republic.",
        "articles": [
            {"title": "Gallic Wars", "category": "Military"},
            {"title": "Senate reforms", "category": "Politics"}
        ]
    }
    cats = _extract_categories(data)
    tags = _extract_tags(data)

    assert "History & Politics" in cats or "Military & Wars" in cats
    assert any(t in ["Ancient", "War", "Military", "Politics"] for t in tags)


def test_filter_by_topic(mock_storage):
    # Filter by topic key "nature"
    res_nature = list_public_timelines(topic="nature")
    assert res_nature["total"] == 1
    assert res_nature["timelines"][0]["id"] == "tl-nature-horse"

    # Filter by topic key "technology"
    res_tech = list_public_timelines(topic="technology")
    tech_ids = [t["id"] for t in res_tech["timelines"]]
    assert "tl-tech-usa" in tech_ids
    assert "tl-space-apollo" in tech_ids
    assert "tl-nature-horse" not in tech_ids

    # Filter with "all" returns all items
    res_all = list_public_timelines(topic="all")
    assert res_all["total"] == 4


def test_filter_by_tag(mock_storage):
    # Filter by specific entity tag "America"
    res_usa = list_public_timelines(tag="America")
    usa_ids = [t["id"] for t in res_usa["timelines"]]
    assert "tl-tech-usa" in usa_ids
    assert "tl-space-apollo" in usa_ids
    assert "tl-nature-horse" not in usa_ids

    # Filter with hashtag prefix "#Evolution"
    res_evo = list_public_timelines(tag="#Evolution")
    assert res_evo["total"] == 1
    assert res_evo["timelines"][0]["id"] == "tl-nature-horse"


def test_combined_topic_and_search_filter(mock_storage):
    # Search for "Moon" within topic "technology"
    res = list_public_timelines(search="Moon", topic="technology")
    assert res["total"] == 1
    assert res["timelines"][0]["id"] == "tl-space-apollo"


@pytest.mark.asyncio
async def test_api_endpoint_topic_and_tag(mock_storage):
    # Test through the FastAPI route function
    resp = await main.get_community_timelines(topic="space", user=None)
    assert resp["total"] >= 1
    assert any("space" in t["title"].lower() or "apollo" in t["title"].lower() for t in resp["timelines"])

    resp_tag = await main.get_community_timelines(tag="NASA", user=None)
    assert resp_tag["total"] >= 1
    assert resp_tag["timelines"][0]["id"] == "tl-space-apollo"


def test_language_filter_and_author_extraction(mock_storage):
    from services.storage import _extract_language, _extract_author

    # Hebrew script detection
    hebrew_data = {"title": "תולדות ירושלים", "description": "היסטוריה של העיר"}
    assert _extract_language(hebrew_data) == "he"

    # English script detection
    english_data = {"title": "History of Rome"}
    assert _extract_language(english_data) == "en"

    # Author extraction
    author_data = {"authorName": "Dr. Sarah Cohen"}
    assert _extract_author(author_data) == "Dr. Sarah Cohen"

    anon_data = {"authorName": "Dr. Sarah Cohen", "isAnonymous": True}
    assert _extract_author(anon_data) == "Community Explorer"

    # Filter by language
    res_en = list_public_timelines(language="en")
    assert all(t["language"] == "en" for t in res_en["timelines"])


def test_multilingual_categorization_and_tag_guarantee():
    # Albert Einstein in Hebrew -> Science & Technology / Biographies & Figures
    einstein = {"title": "אלברט איינשטיין: פריצות דרך מדעיות ותחנות חיים"}
    einstein_cats = _extract_categories(einstein)
    einstein_tags = _extract_tags(einstein)
    assert any(c in ["Science & Technology", "Biographies & Figures"] for c in einstein_cats)
    assert 3 <= len(einstein_tags) <= 5
    assert "Albert Einstein" in einstein_tags or any("איינשטיין" in t for t in einstein_tags)

    # Vikings in Hebrew -> Geography & Nations
    vikings = {"title": "תור הוויקינגים"}
    vikings_cats = _extract_categories(vikings)
    vikings_tags = _extract_tags(vikings)
    assert "Geography & Nations" in vikings_cats or "Military & Wars" in vikings_cats
    assert 3 <= len(vikings_tags) <= 5
    assert "Vikings" in vikings_tags or any("ויקינג" in t for t in vikings_tags)

    # Six-Day War in Hebrew -> Military & Wars
    six_day = {"title": "מלחמת ששת הימים"}
    six_day_cats = _extract_categories(six_day)
    six_day_tags = _extract_tags(six_day)
    assert "Military & Wars" in six_day_cats
    assert 3 <= len(six_day_tags) <= 5
    assert "Six-Day War" in six_day_tags or any("ששת הימים" in t for t in six_day_tags)


def test_all_languages_categorization_and_detection():
    from services.storage import _extract_language, _extract_categories

    # Spanish timeline
    es_timeline = {
        "title": "La Segunda Guerra Mundial en Europa",
        "description": "Una cronología detallada de las batallas y el conflicto bélico entre las fuerzas aliadas y el eje.",
    }
    assert _extract_language(es_timeline) == "es"
    assert "Military & Wars" in _extract_categories(es_timeline)

    # French timeline
    fr_timeline = {
        "title": "Histoire de la conquête spatiale",
        "description": "Les missions spatiales et les fusées dans la course à la lune.",
    }
    assert _extract_language(fr_timeline) == "fr"
    assert "Space & Aviation" in _extract_categories(fr_timeline)

    # German timeline
    de_timeline = {
        "title": "Wissenschaft und Quantenphysik im 20. Jahrhundert",
        "description": "Die Entdeckung der Quantenmechanik und der Relativitätstheorie.",
    }
    assert _extract_language(de_timeline) == "de"
    assert "Science & Technology" in _extract_categories(de_timeline)

    # Arabic timeline
    ar_timeline = {
        "title": "تاريخ علم الفلك واستكشاف الفضاء",
        "description": "رحلة استكشاف الكواكب والنجوم من المراصد القديمة إلى العصر الحديث.",
    }
    assert _extract_language(ar_timeline) == "ar"
    assert "Space & Aviation" in _extract_categories(ar_timeline)

