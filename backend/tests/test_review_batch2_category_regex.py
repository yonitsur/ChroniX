"""P-01: precompiled category matching must behave exactly like the old per-alias regexes, and fast."""
import re
import time

import pytest

from services import storage
from services.storage import CURATED_DOMAINS


# --- Verbatim copies of the pre-P-01 implementation (reference oracle) -------------------------

def _old_alias_matches(alias: str, text: str) -> bool:
    alias = alias.lower().strip()
    if not alias:
        return False
    text = text.lower()
    if " " in alias or "-" in alias or '"' in alias:
        return alias in text
    pattern = r'(?:^|[\s\.,!?:;"\'\(\)\[\]/\\])' + re.escape(alias) + r'(?:$|[\s\.,!?:;"\'\(\)\[\]/\\])'
    if re.search(pattern, text):
        return True
    if re.search(r'[֐-׿]', alias) and len(alias) >= 3:
        heb_pattern = r'(?:^|[\s\.,!?:;\"\'\(\)\[\]/\\\-])[הובכלמש]?' + re.escape(alias) + r'(?:$|[\s\.,!?:;\"\'\(\)\[\]/\\\-])'
        if re.search(heb_pattern, text):
            return True
    return bool(re.search(r'\b' + re.escape(alias) + r'\b', text))


def _old_get_category_keys(categories):
    keys = []
    for cat in categories:
        cat_lower = str(cat).lower()
        for d in CURATED_DOMAINS:
            if d["key"] == cat_lower or d["label"].lower() == cat_lower:
                if d["key"] not in keys:
                    keys.append(d["key"])
            elif any(_old_alias_matches(a, cat_lower) for a in d["aliases"]):
                if d["key"] not in keys:
                    keys.append(d["key"])
    return keys


def _old_domain_labels(text_corpus: str):
    matched = []
    for domain in CURATED_DOMAINS:
        for alias in domain["aliases"]:
            if _old_alias_matches(alias, text_corpus):
                if domain["label"] not in matched:
                    matched.append(domain["label"])
                break
        if len(matched) >= 3:
            break
    return matched or ["History & Politics"]


# --- Corpus ------------------------------------------------------------------------------------

_ALL_ALIASES = sorted({a for d in CURATED_DOMAINS for a in d["aliases"]})
_EXTRA_STRINGS = [
    "", " ", "History & Politics", "Science & Technology", "Space & Aviation", "Personal & Family Stories",
    "history", "HISTORY", "prehistory", "histories", "warfare", "war", "war-time", "post-war", "(war)", "[war]",
    "war.", "war,", "\"war\"", "'war'", "war/peace", "war\\peace", "a war\n", "Six-Day War", "six day war",
    "artificial intelligence", "AI", "ai-driven", "tech-savvy", "biotech", "the moon", "moonlight", "Apollo 11",
    "états-unis", "Moyen-Orient", "révolution française", "Österreich und Geschichte", "Raumfahrt-Geschichte",
    "מלחמת ששת הימים", "המלחמה", "ומלחמה", "במלחמה", "שמלחמה", "-מלחמה", "מלחמה-", "תמלחמה", "מלחמות",
    "ההיסטוריה של ישראל", "וההיסטוריה", "לחלל", "החלל", "בחלל.", "ירושלים", "בירושלים", "הירח", "ירחים",
    "ספורט", "הספורט", "דת", "הדת", "ודת", "סיפור אישי", "עץ משפחה", "ציר אישי", "ראש ממשלה", "בראש ממשלה",
    "تاريخ", "التاريخ", "حرب", "الحرب العالمية", "فضاء", "رياضيات",
    "Ancient Greece and Rome", "greece", "Greek", "Plato's Republic", "aristotle!", "nature?", "evolution:",
    "family tree of the Cohens", "wedding timeline 2020", "silicon valley startups", "money", "moneyball",
    "Science&Technology", "art", "artist", "arts & crafts", "film noir", "filmography", "law", "lawyer",
]


@pytest.fixture(autouse=True)
def big_re_cache(monkeypatch):
    # Only speeds up the reference oracle (it recompiles ~1,800 patterns otherwise); semantics unchanged.
    monkeypatch.setattr(re, "_MAXCACHE", 20000)


def _corpus():
    texts = list(_EXTRA_STRINGS)
    for i, alias in enumerate(_ALL_ALIASES):
        texts.append(alias)
        texts.append(f"the {alias}.")
        texts.append(("הובכלמש"[i % 7]) + alias)
        texts.append(f"x{alias}x" if i % 2 else f"-{alias}-")
    return texts


def test_single_alias_matcher_equals_old_implementation_for_every_alias():
    # Every alias against its own boundary/prefix variants plus all the extra strings.
    for alias in _ALL_ALIASES:
        variants = [alias, f"the {alias} story", f"x{alias}x", f"({alias}).", f"-{alias}-"]
        variants += [p + alias for p in "הובכלמש"]
        for text in variants + _EXTRA_STRINGS:
            assert storage._alias_matches(alias, text) == _old_alias_matches(alias, text), (alias, text)


def test_domain_matchers_and_category_keys_equal_old_implementation():
    for text in _corpus():
        lowered = text.lower()
        for domain, matcher in storage._curated_domain_matchers():
            expected = any(_old_alias_matches(a, lowered) for a in domain["aliases"])
            assert matcher.matches(lowered) == expected, (domain["key"], text)
        assert storage._get_category_keys([text]) == _old_get_category_keys([text]), text
    mixed = ["History & Politics", "מלחמת העולם", "Raumfahrt", "nothing-here", "Biotech"]
    assert storage._get_category_keys(mixed) == _old_get_category_keys(mixed)


def test_extract_categories_inference_equals_old_implementation():
    for text in _EXTRA_STRINGS + _ALL_ALIASES[::7]:
        data = {"title": text, "description": "", "articles": [{"title": "x", "category": text}]}
        corpus = f"{text}  {text} x".lower()  # same corpus _extract_categories builds for `data`
        assert storage._extract_categories(data) == _old_domain_labels(corpus), text


def _sample_card_timeline(i: int) -> dict:
    return {
        "id": f"tl-{i}",
        "title": f"מלחמת העולם השנייה {i} - World War and Space Exploration",
        "description": "A long timeline about history, science, the moon landing and the economy of Europe.",
        "articles": [
            {
                "id": f"e{j}",
                "title": f"Milestone {j} of the revolution in physics",
                "category": ["Military", "Science", "מדע", "Politics", "Culture"][j % 5],
                "from": {"year": 1900 + j},
                "rank": j % 10,
                "imageUrl": f"https://upload.wikimedia.org/img-{i}-{j}.jpg",
            }
            for j in range(30)
        ],
    }


def test_library_card_extraction_benchmark():
    timelines = [_sample_card_timeline(i) for i in range(50)]
    storage._category_keys_for.cache_clear()
    storage._curated_domain_matchers.cache_clear()  # include the one-off pattern build
    started = time.perf_counter()
    # Known (empty) podcast folders: measure pure CPU, no podcast-store I/O.
    cards = [storage._extract_library_card_meta(tl, podcast_folders=set()) for tl in timelines]
    elapsed = time.perf_counter() - started
    assert all(cards)
    assert elapsed < 1.0, f"50 library cards took {elapsed:.2f}s"
