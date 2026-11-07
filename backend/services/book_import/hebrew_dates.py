"""Hebrew-calendar dates: a small gematria parser for dates written in Hebrew letters, and conversion to
Gregorian with pyluach. Used to check (not replace) the model's conversion."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Tuple

_LETTERS = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70,
    "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200, "ש": 300, "ת": 400,
}
_PUNCT = "\"'״׳`"

# Month name -> (pyluach month number, canonical English name). pyluach: Nisan=1 ... Adar=12, Adar II=13.
_MONTHS = [
    (("מרחשוון", "מרחשון", "חשוון", "חשון"), 8, "Cheshvan"),
    (("תשרי",), 7, "Tishrei"),
    (("כסליו", "כסלו"), 9, "Kislev"),
    (("טבת",), 10, "Tevet"),
    (("שבט",), 11, "Shevat"),
    (("אדר ב", "אדר שני", "ואדר"), 13, "Adar II"),
    (("אדר א", "אדר ראשון"), 12, "Adar I"),
    (("אדר",), 12, "Adar"),
    (("ניסן",), 1, "Nisan"),
    (("אייר",), 2, "Iyar"),
    (("סיוון", "סיון"), 3, "Sivan"),
    (("תמוז",), 4, "Tammuz"),
    (("מנחם אב", "אב"), 5, "Av"),
    (("אלול",), 6, "Elul"),
]
ENGLISH_TO_PYLUACH = {
    "Nisan": 1, "Iyar": 2, "Sivan": 3, "Tammuz": 4, "Av": 5, "Elul": 6, "Tishrei": 7, "Cheshvan": 8,
    "Kislev": 9, "Tevet": 10, "Shevat": 11, "Adar": 12, "Adar I": 12, "Adar II": 13,
}


def gematria(token: str) -> Optional[int]:
    clean = "".join(ch for ch in token if ch not in _PUNCT and not ch.isspace())
    if not clean or any(ch not in _LETTERS for ch in clean):
        return None
    return sum(_LETTERS[ch] for ch in clean)


def hebrew_year_value(token: str) -> Optional[int]:
    """'תש״ד' -> 5704, 'ה'תשכ"ג' -> 5723, 'התשכ"ג' -> 5723. Years under 1000 get the 5000 prefix."""
    clean = "".join(ch for ch in token if not ch.isspace())
    thousands = 5000
    m = re.match(r"^([א-ת])['׳]", clean)
    if m and _LETTERS.get(m.group(1), 0) <= 9:
        thousands = _LETTERS[m.group(1)] * 1000
        clean = clean[2:]
    value = gematria(clean)
    if value is None:
        return None
    if value < 1000:
        if clean.startswith("ה") and value - 5 >= 100 and gematria(clean[1:]) is not None:
            # A bare leading ה is the thousands digit only when what follows is itself a valid year.
            value -= 5
        return thousands + value
    return value


@dataclass
class HebrewDate:
    year: Optional[int]
    month: Optional[int]  # pyluach numbering
    month_name: Optional[str]
    day: Optional[int]


_MONTH_ALT = "|".join(sorted((re.escape(n) for names, _, _ in _MONTHS for n in names), key=len, reverse=True))
_DATE_RE = re.compile(
    rf"(?:(?<![א-ת])ב?(?P<day>[א-ת]{{1,2}}[\"'׳״]?[א-ת]?)\s+)?ב?(?P<month>{_MONTH_ALT})(?:['׳]|\s+[אב]['׳])?"
    rf"(?:\s+(?:שנת\s+)?(?P<year>[א-ת]['׳]?[א-ת\"'׳״]{{2,6}}))?"
)


def parse_hebrew_date(text: str) -> Optional[HebrewDate]:
    """Finds the first Hebrew-calendar date in `text`: 'בו׳ באב תש״ד', 'ט״ו בשבט תשכ״ג', 'כ"ה באדר ב' תש"ח'."""
    if not text:
        return None
    for m in _DATE_RE.finditer(text):
        month_raw = m.group("month")
        month_num, month_name = None, None
        for names, num, eng in _MONTHS:
            if month_raw in names:
                month_num, month_name = num, eng
                break
        tail = text[m.end("month"): m.end("month") + 4]
        if month_name == "Adar" and re.match(r"\s*ב['׳]", tail):
            month_num, month_name = 13, "Adar II"
        elif month_name == "Adar" and re.match(r"\s*א['׳]", tail):
            month_num, month_name = 12, "Adar I"
        day = gematria(m.group("day") or "") if m.group("day") else None
        if day is not None and not (1 <= day <= 30):
            day = None
        year = hebrew_year_value(m.group("year")) if m.group("year") else None
        if year is not None and not (5000 <= year <= 6000):
            year = None
        if day is None and year is None:
            continue  # a bare month word ("אב" = father) is not a date
        return HebrewDate(year=year, month=month_num, month_name=month_name, day=day)
    m = re.search(r"(?:שנת\s+)?(?<![א-ת])(ה['׳]?)?(ת[א-ת\"'׳״]{2,5})", text)
    if m:
        year = hebrew_year_value((m.group(1) or "") + m.group(2))
        if year is not None and 5600 <= year <= 5900:
            return HebrewDate(year=year, month=None, month_name=None, day=None)
    return None


def to_gregorian(year: int, month: Optional[int], day: Optional[int]) -> Optional[Tuple[int, Optional[int], Optional[int]]]:
    """Converts with pyluach. Returns (year, month, day); month/day None when the Hebrew date lacks them.
    A Hebrew year alone spans two Gregorian years: the year of its Tishrei-Dec part is returned
    (callers mark it circa)."""
    try:
        from pyluach import dates
    except ImportError:  # pragma: no cover
        return None
    try:
        if month is None:
            g = dates.HebrewDate(year, 7, 1).to_greg()
            return g.year, None, None
        if month == 13:
            from pyluach import utils as _u  # noqa: F401
            if not _is_leap(year):
                month = 12
        if day is None:
            g = dates.HebrewDate(year, month, 1).to_greg()
            return g.year, g.month, None
        g = dates.HebrewDate(year, month, day).to_greg()
        return g.year, g.month, g.day
    except Exception:
        return None


def _is_leap(year: int) -> bool:
    return ((7 * year) + 1) % 19 < 7
