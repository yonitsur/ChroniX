import pytest
from services.storage import (
    _extract_categories,
    _extract_tags,
    _extract_language,
    _extract_author,
)


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


def test_language_and_author_extraction():
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
    assert _extract_author(anon_data) == "Explorer"


def test_multilingual_categorization_and_tag_guarantee():
    # Albert Einstein -> Science & Technology / Biographies & Figures
    einstein = {"title": "Albert Einstein: Scientific Breakthroughs and Milestones"}
    einstein_cats = _extract_categories(einstein)
    einstein_tags = _extract_tags(einstein)
    assert any(c in ["Science & Technology", "Biographies & Figures"] for c in einstein_cats)
    assert 3 <= len(einstein_tags) <= 5
    assert "Albert Einstein" in einstein_tags or "Physics" in einstein_tags

    # Vikings -> Geography & Nations / Military & Wars
    vikings = {"title": "The Age of Vikings"}
    vikings_cats = _extract_categories(vikings)
    vikings_tags = _extract_tags(vikings)
    assert "Geography & Nations" in vikings_cats or "Military & Wars" in vikings_cats
    assert 3 <= len(vikings_tags) <= 5
    assert "Vikings" in vikings_tags or "Military History" in vikings_tags

    # Six-Day War -> Military & Wars
    six_day = {"title": "The Six-Day War"}
    six_day_cats = _extract_categories(six_day)
    six_day_tags = _extract_tags(six_day)
    assert "Military & Wars" in six_day_cats
    assert 3 <= len(six_day_tags) <= 5
    assert "Six-Day War" in six_day_tags or "Military History" in six_day_tags


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


def test_personal_timeline_category_isolation_and_historical_dynasties():
    from services.storage import _get_category_keys

    # Personal timeline mentioning Jerusalem, America, and medicine stays strictly in Personal & Family Stories
    personal_he = {
        "title": "שורשי משפחת בן-שושן: ממרקש לירושלים",
        "description": "מסע משפחתי דרך צרפת, ישראל ורפואת ילדים",
        "isPersonal": True,
        "articles": [
            {"title": "עלייה לירושלים", "category": "משפחה"},
            {"title": "לימודי מדע באמריקה", "category": "קריירה"},
        ],
    }
    cats_he = _extract_categories(personal_he)
    assert cats_he == ["Personal & Family Stories"]
    assert _get_category_keys(cats_he) == ["personal"]
    tags_he = _extract_tags(personal_he)
    assert 3 <= len(tags_he) <= 5

    # Historical dynasties must NOT accidentally match the 'personal' category
    ming_he = {
        "title": "שושלת מינג בסין הקיסרית",
        "description": "תולדות הקיסרים והמסחר הימי של סין",
    }
    assert "personal" not in _get_category_keys(_extract_categories(ming_he))

    ming_en = {
        "title": "The Ming Dynasty and Imperial China",
        "description": "Royal lineage and imperial palaces of Beijing",
    }
    assert "personal" not in _get_category_keys(_extract_categories(ming_en))


