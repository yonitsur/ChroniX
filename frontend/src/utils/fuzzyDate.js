// Forgiving date parser for personal-story input.
// Real memories are rarely exact: "around 1950", "summer '82", "the 1960s", "June 1952",
// "12/6/1952". parseFuzzyDate turns that text into a timeline date object
// ({ year, month?, day?, precision, circa }) or null when it can't be read.
// Pure module (no React / import.meta) so it runs under node --test.

const EN_MONTHS = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'],
  ['may'], ['june', 'jun'], ['july', 'jul'], ['august', 'aug'],
  ['september', 'sep', 'sept'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec'],
];
const HE_MONTHS = [
  ['ינואר'], ['פברואר'], ['מרץ', 'מרס'], ['אפריל'], ['מאי'], ['יוני'],
  ['יולי'], ['אוגוסט'], ['ספטמבר'], ['אוקטובר'], ['נובמבר'], ['דצמבר'],
];
const EN_MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HE_MONTHS_FULL = HE_MONTHS.map((m) => m[0]);

// Seasons map to a representative month and are always approximate.
const SEASONS = {
  spring: 4, summer: 7, autumn: 10, fall: 10, winter: 1,
  'אביב': 4, 'קיץ': 7, 'סתיו': 10, 'חורף': 1,
};

const CIRCA_PREFIX = /^(?:c\.|ca\.|circa|around|about|approx\.?|approximately|roughly|~|בערך|בסביבות|סביב|סביבות|כ-|כ־)\s*/i;

const MIN_YEAR = 1000;
const MAX_YEAR = 2200;

function monthFromWord(word) {
  if (!word) return null;
  let w = word.toLowerCase().replace(/\.$/, '');
  // Hebrew prepositions glued to month names: "ביוני", "מיוני", "לאוגוסט".
  if (/^[בלמ]/.test(w) && !HE_MONTHS.some((names) => names.includes(w))) w = w.slice(1);
  for (let i = 0; i < 12; i += 1) {
    if (EN_MONTHS[i].includes(w) || HE_MONTHS[i].includes(w)) return i + 1;
  }
  return null;
}

function seasonFromWord(word) {
  if (!word) return null;
  let w = word.toLowerCase();
  if (SEASONS[w]) return SEASONS[w];
  if (/^[בל]/.test(w) && SEASONS[w.slice(1)]) return SEASONS[w.slice(1)];
  return null;
}

function expandTwoDigitYear(yy, nowYear) {
  const n = Number(yy);
  const century = Math.floor(nowYear / 100) * 100;
  return n <= (nowYear % 100) + 1 ? century + n : century - 100 + n;
}

function parseYearToken(token, nowYear) {
  if (!token) return null;
  const t = token.replace(/^['’]/, '');
  if (/^\d{3,4}$/.test(t)) return Number(t);
  if (/^['’]\d{2}$/.test(token)) return expandTwoDigitYear(t, nowYear);
  return null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function build(year, month, day, circa, precisionOverride) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month != null && (month < 1 || month > 12)) return null;
  if (day != null && (month == null || day < 1 || day > daysInMonth(year, month))) return null;
  const precision = precisionOverride || (day != null ? 'day' : month != null ? 'month' : 'year');
  const out = { year, precision, circa: Boolean(circa) };
  if (month != null) out.month = month;
  if (day != null) out.day = day;
  return out;
}

/**
 * Parse free-form date text. `lang` decides how to read ambiguous numeric dates:
 * 'he' (and most of the world) reads 3/4/1990 as day/month; 'en' reads it as month/day.
 * A component above 12 always resolves the ambiguity.
 */
export function parseFuzzyDate(input, { lang = 'en', now = new Date() } = {}) {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const nowYear = now.getFullYear();

  let circa = false;
  if (CIRCA_PREFIX.test(s)) {
    circa = true;
    s = s.replace(CIRCA_PREFIX, '').trim();
  }
  if (/\?$/.test(s)) {
    circa = true;
    s = s.replace(/\?+$/, '').trim();
  }
  s = s.replace(/^the\s+/i, '');

  // Decades: "1950s", "'50s", "50s", "שנות ה-50", "שנות ה־1950", "שנות ה50".
  let m = s.match(/^(\d{3})0['’]?s$/i);
  if (m) return build(Number(`${m[1]}0`), null, null, circa, 'decade');
  m = s.match(/^['’]?(\d)0['’]?s$/i);
  if (m) return build(Math.floor(expandTwoDigitYear(`${m[1]}0`, nowYear) / 10) * 10, null, null, circa, 'decade');
  m = s.match(/^שנות\s*ה[-־]?\s*(\d{2}|\d{4})$/);
  if (m) {
    const y = m[1].length === 4 ? Number(m[1]) : expandTwoDigitYear(m[1], nowYear);
    return build(Math.floor(y / 10) * 10, null, null, circa, 'decade');
  }

  // ISO: 1952-06-12 or 1952-06.
  m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) return build(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, circa);

  // Numeric with / . or - separators: d/m/yyyy, m/d/yyyy, m/yyyy.
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3].length === 2 ? expandTwoDigitYear(m[3], nowYear) : Number(m[3]);
    let day;
    let month;
    if (a > 12) { day = a; month = b; } else if (b > 12) { month = a; day = b; } else if (lang === 'en') { month = a; day = b; } else { day = a; month = b; }
    return build(year, month, day, circa);
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{4})$/);
  if (m) return build(Number(m[2]), Number(m[1]), null, circa);

  // Plain year: 1952, '82.
  const yearOnly = parseYearToken(s, nowYear);
  if (yearOnly != null) return build(yearOnly, null, null, circa);

  // Word forms. Tokenize on spaces and commas: "June 12, 1952", "12 June 1952", "summer '82", "12 ביוני 1952".
  const tokens = s.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (tokens.length >= 2 && tokens.length <= 4) {
    const yearTok = tokens[tokens.length - 1];
    const year = parseYearToken(yearTok, nowYear);
    if (year == null) return null;
    const rest = tokens.slice(0, -1).map((tk) => tk.replace(/(st|nd|rd|th)$/i, ''));

    if (rest.length === 1) {
      const season = seasonFromWord(rest[0]);
      if (season) return build(year, season, null, true, 'month');
      const month = monthFromWord(rest[0]);
      if (month) return build(year, month, null, circa);
      // "early 1950", "late 1950", "סוף 1950" are read as approximate years.
      if (/^(early|mid|late|תחילת|אמצע|סוף)$/i.test(rest[0])) return build(year, null, null, true);
      return null;
    }
    if (rest.length === 2) {
      const [x, y] = rest;
      const mx = monthFromWord(x);
      const my = monthFromWord(y);
      if (mx && /^\d{1,2}$/.test(y)) return build(year, mx, Number(y), circa);
      if (my && /^\d{1,2}$/.test(x)) return build(year, my, Number(x), circa);
    }
  }
  return null;
}

/** Human-readable label for a parsed fuzzy date, e.g. "June 12, 1952", "c. 1950", "1950s". */
export function formatFuzzyDate(date, lang = 'en') {
  if (!date || !Number.isInteger(date.year)) return '';
  const he = lang === 'he';
  let core;
  const fine = ['day', 'hour', 'minute'].includes(date.precision);
  if (date.precision === 'decade') {
    // Two digits only when they read back as the same decade ("שנות ה-20" would mean the 2020s).
    const yy = String(date.year).slice(-2);
    const roundTrips = expandTwoDigitYear(yy, new Date().getFullYear()) === date.year;
    core = he ? `שנות ה-${roundTrips ? yy : date.year}` : `${date.year}s`;
  } else if (fine && date.month && date.day) {
    core = he
      ? `${date.day} ב${HE_MONTHS_FULL[date.month - 1]} ${date.year}`
      : `${EN_MONTHS_FULL[date.month - 1]} ${date.day}, ${date.year}`;
  } else if ((date.precision === 'month' || fine) && date.month) {
    core = he ? `${HE_MONTHS_FULL[date.month - 1]} ${date.year}` : `${EN_MONTHS_FULL[date.month - 1]} ${date.year}`;
  } else {
    core = String(date.year);
  }
  if (!date.circa) return core;
  return he ? `בערך ${core}` : `c. ${core}`;
}

/** Converts a parsed date to a fractional year for layout (1952.42). */
export function fuzzyDateToDecimal(date) {
  if (!date || !Number.isInteger(date.year)) return null;
  const month = date.month ? date.month - 1 : 0;
  const day = date.day ? date.day - 1 : 0;
  return date.year + month / 12 + day / 365;
}

/** Timeline-article date object (TimelineArticle.from / .to) for a parsed fuzzy date. */
export function toTimelineDate(date) {
  if (!date) return null;
  const out = { year: date.year, precision: date.precision };
  if (date.month) out.month = date.month;
  if (date.day) out.day = date.day;
  return out;
}
