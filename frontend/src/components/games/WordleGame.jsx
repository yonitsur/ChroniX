import React, { useState, useMemo, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Star,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Lightbulb,
  Crosshair,
  Delete,
  CornerDownLeft,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import { shuffleArray } from './gameUtils';
import { GameHud, GameResults, RoundFeedback, formatPoints, starsForRatio } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

const MAX_ATTEMPTS = 6;
const MAX_ROUNDS = 5;
const MAX_HINTS = 3;

/**
 * Comprehensive Hebrew stop-words, linking words, generic framing nouns (שמות פעולה / נסמכים),
 * common verbs, time words, quantifiers, and generic adjectives that should NEVER be chosen
 * as the target Wordle keyword.
 */
const HEBREW_STOP_WORDS = new Set([
  // Prepositions, conjunctions, linking words, pronouns, adverbs
  'בשנת', 'לאחר', 'לפני', 'במהלך', 'מתוך', 'עבור', 'אשר', 'כנגד', 'בעקבות',
  'לפי', 'תחת', 'מעל', 'בתוך', 'מבין', 'לבין', 'אודות', 'סביב', 'למען',
  'בגלל', 'למרות', 'כאשר', 'אחרי', 'לקראת', 'בסוף', 'בתחילת', 'באמצע',
  'בראשית', 'בשלהי', 'בערך', 'כמעט', 'ביותר', 'בלבד', 'אפילו', 'כלומר',
  'למשל', 'בנוסף', 'בעיקר', 'במיוחד', 'לראשונה', 'מחדש', 'אותו', 'אותה',
  'אותם', 'אותן', 'אלה', 'אלו', 'הזה', 'הזאת', 'האלה', 'האלו', 'עצמו',
  'עצמה', 'עצמם', 'שלהם', 'שלהן', 'שלו', 'שלה', 'שלנו', 'בידי', 'מידי',
  'נגד', 'אצל', 'כמו', 'ללא', 'בלי', 'יחד', 'אלא', 'אולם', 'לכן', 'משום',
  'כיצד', 'איפה', 'מתי', 'האם', 'כאילו', 'לעבר', 'מול', 'דרך', 'סמוך',

  // Generic framing / verbal nouns (שמות פעולה ומסגרת של אירועים)
  'חיבור', 'החיבור', 'כתיבה', 'הכתיבה', 'כתיבת', 'יצירה', 'היצירה', 'יצירת',
  'בנייה', 'הבנייה', 'בניית', 'הקמה', 'ההקמה', 'הקמת', 'ייסוד', 'הייסוד',
  'הופעה', 'ההופעה', 'הופעת', 'הופעתו', 'הופעתה', 'הופעתם',
  'עלייה', 'העלייה', 'עליית', 'עלייתו', 'עלייתה', 'נפילה', 'הנפילה', 'נפילת', 'נפילתו', 'נפילתה',
  'פלישה', 'הפלישה', 'פלישת', 'כיבוש', 'הכיבוש', 'כיבושו', 'כיבושה',
  'ניצחון', 'הניצחון', 'ניצחונו', 'ניצחונה', 'תבוסה', 'התבוסה', 'תבוסת',
  'לידה', 'הלידה', 'לידת', 'לידתו', 'לידתה', 'הולדת', 'מותו', 'מותה', 'מותם',
  'פטירה', 'פטירת', 'פטירתו', 'פטירתה', 'רצח', 'הרצח', 'הירצחו', 'הוצאה', 'הוצאתו',
  'גילוי', 'הגילוי', 'גילויו', 'גילויה', 'המצאה', 'ההמצאה', 'המצאת', 'המצאתו',
  'פיתוח', 'הפיתוח', 'פיתוחו', 'שכלול', 'ייצור', 'הייצור',
  'פרסום', 'הפרסום', 'פרסומו', 'פרסומה', 'הדפסה', 'הדפסת', 'הוצאת',
  'חתימה', 'החתימה', 'חתימת', 'אישור', 'האישור', 'אימוץ', 'האימוץ', 'ביטול', 'הביטול',
  'הכרזה', 'ההכרזה', 'הכרזת', 'הצהרה', 'ההצהרה', 'הצהרת',
  'פתיחה', 'הפתיחה', 'פתיחת', 'סגירה', 'סגירת', 'סיום', 'הסיום', 'תחילת', 'תחילה',
  'ראשית', 'פרוץ', 'התפרצות', 'שיא', 'השיא', 'דעיכה', 'דעיכת', 'קריסה', 'קריסת',
  'הכתרה', 'הכתרת', 'הכתרתו', 'הכתרתה', 'הדחה', 'הדחת', 'הדחתו', 'מינוי', 'מינויו', 'בחירה', 'בחירת', 'בחירתו',
  'גירוש', 'הגירוש', 'איחוד', 'האיחוד', 'פיצול', 'הפיצול', 'חלוקה', 'חלוקת', 'החלוקה',
  'שיגור', 'השיגור', 'נחיתה', 'הנחיתה', 'נחיתת', 'טיסה', 'הטיסה', 'טיסת', 'מסע', 'המסע', 'מסעו',
  'התפשטות', 'התפתחות', 'התגבשות', 'התארגנות', 'התיישבות', 'הגירה', 'ההגירה',
  'מעבר', 'המעבר', 'שינוי', 'השינוי', 'רפורמה', 'הרפורמה', 'משבר', 'המשבר',
  'ניסיון', 'הניסיון', 'מאבק', 'המאבק', 'עימות', 'העימות', 'סכסוך', 'הסכסוך',
  'שחרור', 'השחרור', 'הצלה', 'הצלת', 'השמדה', 'השמדת', 'חורבן', 'החורבן',
  'הפצה', 'ההפצה', 'הפצת', 'תרגום', 'התרגום', 'עריכה', 'עריכת', 'איסוף', 'חשיפה', 'חשיפת',

  // Generic narrative / event container nouns
  'עלילות', 'עלילה', 'העלילה', 'סיפור', 'הסיפור', 'סיפורי', 'סיפורים',
  'אגדה', 'האגדה', 'אגדת', 'אגדות', 'מיתוס', 'המיתוס', 'מיתוסים',
  'מסורת', 'המסורת', 'מסורות', 'כתבי', 'כתבים', 'הכתבים', 'ספר', 'הספר', 'ספרי',
  'מגילה', 'מגילת', 'המגילה', 'חוקי', 'חוקים', 'החוקים', 'שירה', 'שירת', 'השירה',
  'מלחמה', 'המלחמה', 'מלחמת', 'מלחמות', 'קרב', 'הקרב', 'קרבות',
  'מצור', 'המצור', 'מרד', 'המרד', 'מרידה', 'מהפכה', 'המהפכה', 'מהפכת',
  'הסכם', 'ההסכם', 'הסכמי', 'ברית', 'הברית', 'אמנה', 'אמנת', 'האמנה',
  'ועידה', 'ועידת', 'הוועידה', 'קונגרס', 'מועצה', 'מועצת', 'המועצה',
  'פרשה', 'פרשת', 'הפרשה', 'אירוע', 'האירוע', 'אירועי', 'אירועים',
  'תקופה', 'התקופה', 'תקופת', 'עידן', 'העידן', 'שושלת', 'השושלת',
  'אימפריה', 'האימפריה', 'אימפריית', 'ממלכה', 'הממלכה', 'ממלכת',
  'מדינה', 'המדינה', 'מדינת', 'רפובליקה', 'הרפובליקה', 'שלטון', 'השלטון', 'ממשלה', 'הממשלה',
  'דמות', 'דמותו', 'דמותה', 'הדמות', 'פולחן', 'הפולחן', 'תרבות', 'התרבות',

  // Common verbs & participles
  'היה', 'הייתה', 'היו', 'יהיה', 'הפך', 'הפכה', 'הפכו', 'הקים', 'הקימה', 'הוקם', 'הוקמה',
  'נבנה', 'נבנתה', 'נבנו', 'נכתב', 'נכתבה', 'נכתבו', 'נוצר', 'נוצרה', 'נוצרו',
  'החל', 'החלה', 'החלו', 'הסתיים', 'הסתיימה', 'נכבש', 'נכבשה', 'נהרג', 'נרצח',
  'נולד', 'נולדה', 'נפטר', 'נפטרה', 'גילה', 'המציא', 'פיתח', 'כבש', 'שלט', 'הנהיג',
  'ייסד', 'ייסדה', 'פורסם', 'פורסמה', 'נחתם', 'נחתמה', 'הוכרז', 'הוכרזה',
  'נבחר', 'נבחרה', 'מונה', 'הודח', 'גורש', 'נפל', 'נפלה', 'עלה', 'עלתה',
  'יצא', 'יצאה', 'הגיע', 'הגיעה', 'הוביל', 'הובילה', 'נקרא', 'נקראה',
  'נחשב', 'נחשבת', 'מתאר', 'מתארת', 'מספר', 'מספרת', 'כולל', 'כוללת',

  // Generic adjectives, numbers, time & place words
  'גדול', 'גדולה', 'הגדול', 'הגדולה', 'גדולים', 'גדולות',
  'קטן', 'קטנה', 'הקטן', 'הקטנה', 'חדש', 'חדשה', 'החדש', 'החדשה', 'חדשים', 'חדשות',
  'עתיק', 'עתיקה', 'העתיק', 'העתיקה', 'עתיקים', 'עתיקות',
  'קדום', 'קדומה', 'הקדום', 'הקדומה', 'קדומים', 'קדומות',
  'מודרני', 'מודרנית', 'המודרני', 'המודרנית', 'מרכזי', 'מרכזית', 'המרכזי', 'המרכזית',
  'ראשי', 'ראשית', 'הראשי', 'הראשית', 'עיקרי', 'עיקרית', 'העיקרי', 'העיקרית',
  'חשוב', 'חשובה', 'החשוב', 'החשובה', 'מפורסם', 'מפורסמת', 'ידוע', 'ידועה',
  'ראשון', 'ראשונה', 'הראשון', 'הראשונה', 'ראשונים', 'ראשונות',
  'שני', 'שנייה', 'השני', 'השנייה', 'שלישי', 'שלישית', 'השלישי', 'השלישית',
  'רביעי', 'רביעית', 'חמישי', 'חמישית', 'אחרון', 'אחרונה', 'האחרון', 'האחרונה',
  'שונים', 'שונות', 'רבים', 'רבות', 'מספר', 'כמה', 'שנים', 'השנים',
  'מאה', 'המאה', 'אלף', 'האלף', 'ימים', 'הימים', 'חודש', 'שנה', 'השנה',
  'עולם', 'העולם', 'עולמי', 'עולמית', 'העולמי', 'העולמית',
  'לאומי', 'לאומית', 'הלאומי', 'הלאומית', 'בינלאומי', 'בינלאומית',
  'ציבורי', 'ציבורית', 'רשמי', 'רשמית', 'מקומי', 'מקומית', 'פנימי', 'חיצוני',
  'צפון', 'הצפון', 'דרום', 'הדרום', 'מזרח', 'המזרח', 'מערב', 'המערב',
  'צפוני', 'צפונית', 'דרומי', 'דרומית', 'מזרחי', 'מזרחית', 'מערבי', 'מערבית',
  'תיכון', 'התיכון', 'התיכונה', 'עליון', 'העליון', 'תחתון', 'התחתון',
  'שומרי', 'שומרית', 'השומרי', 'השומרית', 'שומרים', 'שומריות', 'השומרים', 'השומריות',
  'יווני', 'יוונית', 'היווני', 'היוונית', 'יוונים', 'יווניות', 'היוונים', 'היווניות',
  'מצרי', 'מצרית', 'המצרי', 'המצרית', 'מצרים', 'מצריות', 'המצריות',
  'רומי', 'רומית', 'הרומי', 'הרומית', 'רומים', 'רומיות', 'הרומים', 'הרומיות',
  'בבלי', 'בבלית', 'הבבלי', 'הבבלית', 'נורדי', 'נורדית', 'הנורדי', 'הנורדית',
]);

const ENGLISH_STOP_WORDS = new Set([
  'after', 'before', 'during', 'first', 'second', 'third', 'fourth', 'fifth',
  'under', 'between', 'about', 'their', 'which', 'where', 'while', 'until',
  'since', 'through', 'against', 'within', 'without', 'around', 'among',
  'world', 'state', 'states', 'united', 'early', 'later', 'years', 'event',
  'events', 'begins', 'began', 'started', 'starts', 'ended', 'great', 'major',
  'minor', 'other', 'three', 'seven', 'eight', 'found', 'founded', 'founding',
  'built', 'building', 'construction', 'creation', 'created', 'written',
  'writing', 'published', 'publication', 'discovery', 'discovered', 'invention',
  'invented', 'birth', 'death', 'battle', 'treaty', 'agreement', 'declaration',
  'period', 'dynasty', 'empire', 'kingdom', 'republic', 'ancient', 'modern',
  'central', 'national', 'international', 'northern', 'southern', 'eastern',
  'western', 'middle', 'upper', 'lower', 'story', 'stories', 'tales', 'legend',
  'legends', 'myths', 'mythology', 'history', 'historical', 'century', 'decade',
  'launch', 'landing', 'flight', 'voyage', 'campaign', 'revolt', 'rebellion',
  'revolution', 'reform', 'crisis', 'rise', 'fall', 'siege', 'conquest', 'victory',
]);

const HEBREW_FINAL_TO_BASE = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

const HEBREW_BASE_TO_FINAL = {
  'כ': 'ך',
  'מ': 'ם',
  'נ': 'ן',
  'פ': 'ף',
  'צ': 'ץ',
};

const HEBREW_KEYBOARD_ROWS = [
  ['ק', 'ר', 'א', 'ט', 'ו', 'פ'],
  ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל'],
  ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת'],
];

function formatHebrewCharForPosition(ch, colIdx, wordLength, isHeb) {
  if (!ch || !isHeb) return ch;
  const base = HEBREW_FINAL_TO_BASE[ch] || ch;
  if (colIdx === wordLength - 1 && HEBREW_BASE_TO_FINAL[base]) {
    return HEBREW_BASE_TO_FINAL[base];
  }
  return base;
}

const ENGLISH_KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const ARABIC_KEYBOARD_ROWS = [
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ذ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د'],
];

const CYRILLIC_KEYBOARD_ROWS = [
  ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
  ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э'],
  ['Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю'],
];

function detectWordScript(text) {
  if (!text) return 'latn';
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u0400-\u04FF]/.test(text)) return 'cyrl';
  return 'latn';
}

function detectTimelineScript(articles, timelineTitle = '') {
  if (/[\u0590-\u05FF]/.test(timelineTitle)) return 'he';
  if (/[\u0600-\u06FF]/.test(timelineTitle)) return 'ar';
  if (/[\u0400-\u04FF]/.test(timelineTitle)) return 'cyrl';

  const counts = { he: 0, ar: 0, cyrl: 0, latn: 0 };
  for (const art of articles || []) {
    const sample = `${art?.title || ''} ${art?.subtitle || ''}`;
    const s = detectWordScript(sample);
    counts[s] = (counts[s] || 0) + 1;
  }
  if (counts.he > 0) return 'he';
  if (counts.ar > 0) return 'ar';
  if (counts.cyrl > 0) return 'cyrl';
  return 'latn';
}

function normalizeChar(ch) {
  if (!ch) return '';
  // Strip diacritics for Latin/Arabic/Hebrew marks
  const stripped = ch
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u0591-\u05BD\u05BF-\u05C7]/g, '');
  const upper = stripped.toUpperCase();
  return HEBREW_FINAL_TO_BASE[upper] || upper;
}

function isHebrewWord(word) {
  return /[\u0590-\u05FF]/.test(word);
}

function isRtlScript(script) {
  return script === 'he' || script === 'ar';
}

/**
 * Evaluate a guessed word against the target word using standard two-pass Wordle rules.
 * Returns array of 'correct' | 'present' | 'absent' for each letter position.
 */
function evaluateWordleGuess(guessChars, targetWord) {
  const len = targetWord.length;
  const result = Array(len).fill('absent');
  const targetNorm = Array.from(targetWord).map(normalizeChar);
  const guessNorm = guessChars.map(normalizeChar);
  const remainingCounts = {};

  // Pass 1: exact matches ('correct')
  for (let i = 0; i < len; i += 1) {
    if (guessNorm[i] === targetNorm[i]) {
      result[i] = 'correct';
    } else {
      const tChar = targetNorm[i];
      remainingCounts[tChar] = (remainingCounts[tChar] || 0) + 1;
    }
  }

  // Pass 2: misplaced matches ('present')
  for (let i = 0; i < len; i += 1) {
    if (result[i] === 'correct') continue;
    const gChar = guessNorm[i];
    if (remainingCounts[gChar] > 0) {
      result[i] = 'present';
      remainingCounts[gChar] -= 1;
    }
  }

  return result;
}

function tokenizeText(str) {
  if (!str) return [];
  return String(str)
    .split(/[\s\-–—,:;./()[\]"'״׳!?«»]+/)
    .map((tok) => tok.trim())
    .filter(Boolean);
}

/**
 * Extract words that appear inside single or double quotes in a title,
 * e.g. "החיבור של 'עלילות גלגמש' השומריות" -> ["עלילות", "גלגמש"]
 */
function extractQuotedTokens(str) {
  if (!str) return new Set();
  const out = new Set();
  const regex = /['"״׳«]([^'"״׳»]{2,40})['"״׳»]/g;
  let match = regex.exec(String(str));
  while (match) {
    for (const tok of tokenizeText(match[1])) {
      out.add(tok);
    }
    match = regex.exec(String(str));
  }
  return out;
}

/**
 * Checks if a candidate token matches the timeline's script and is a clean core noun/entity
 * rather than a stop-word, generic verbal noun, or inflected adjective.
 */
function isValidCleanWord(tok, expectedScript = 'he') {
  if (!tok) return false;

  if (expectedScript === 'he') {
    if (!/^[\u0590-\u05FF]{4,7}$/.test(tok)) return false;
    if (HEBREW_STOP_WORDS.has(tok)) return false;
    // If starts with ה and removing ה leaves a stop word (e.g. החיבור -> חיבור), reject
    if (tok.startsWith('ה') && HEBREW_STOP_WORDS.has(tok.slice(1))) return false;
    // If starts with ב/ל/מ/כ/ו/ש and removing it leaves a stop word, reject
    if (/^[בלמכוש]/.test(tok) && HEBREW_STOP_WORDS.has(tok.slice(1))) return false;
    // Reject definite plural adjectives/demonyms like השומריות, היווניים, העתיקות
    if (tok.startsWith('ה') && /(יות|יים|ים|ות)$/.test(tok)) return false;
    // Reject verbal nouns on pattern הXXXה (הקטלה / הפעלה like הקמה, הפצה, הכרזה)
    if (tok.length >= 5 && tok.startsWith('ה') && tok.endsWith('ה')) return false;
    return true;
  }

  if (expectedScript === 'ar') {
    return /^[\u0600-\u06FF]{4,7}$/.test(tok);
  }

  if (expectedScript === 'cyrl') {
    return /^[\u0400-\u04FF]{4,7}$/.test(tok);
  }

  // Latin script
  const cleanLatn = tok.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/^[A-Za-z]{4,7}$/.test(cleanLatn)) return false;
  const lower = cleanLatn.toLowerCase();
  if (ENGLISH_STOP_WORDS.has(lower)) return false;
  if (/(tion|sion|ment|ness|ance|ence|ship|ally|edly|ings)$/.test(lower)) return false;
  return true;
}

/**
 * Extract high-value, interesting target keywords/concepts from timeline articles
 * strictly in the timeline's own language/script.
 */
function extractWordleCandidates(articles, timelineTitle = '') {
  if (!Array.isArray(articles)) return [];

  const timelineScript = detectTimelineScript(articles, timelineTitle);

  // Build a corpus of unprefixed tokens across all articles so we can strip definite article 'ה'
  // when the base form is attested (or when followed by 'ה...' adjective).
  const unprefixedCorpus = new Set();
  for (const art of articles) {
    for (const src of [art?.wikiTitle, art?.title, art?.subtitle, art?.locationName]) {
      for (const tok of tokenizeText(src)) {
        if (/^[\u0590-\u05FF]{4,7}$/.test(tok) && !tok.startsWith('ה')) {
          unprefixedCorpus.add(tok);
        }
      }
    }
  }

  const normalizeCandidateToken = (rawTok, nextTok = '') => {
    let tok = rawTok;
    if (/^[\u0590-\u05FF]+$/.test(tok)) {
      // Strip leading ה if the next token is a definite adjective (ה... ה...) or if base word is in corpus
      if (
        tok.startsWith('ה') &&
        tok.length >= 5 &&
        ((nextTok && nextTok.startsWith('ה')) || unprefixedCorpus.has(tok.slice(1)))
      ) {
        tok = tok.slice(1);
      }
      // Strip leading ו/ב/ל/מ if base word is directly attested in unprefixed corpus
      if (
        /^[ובלמ]/.test(tok) &&
        tok.length >= 5 &&
        unprefixedCorpus.has(tok.slice(1))
      ) {
        tok = tok.slice(1);
      }
    }
    return tok;
  };

  const scoredPerArticle = [];

  for (const article of articles) {
    if (!article?.title) continue;

    // Determine script for this article (prefer article title script, fallback to timeline script)
    const articleScript =
      detectWordScript(article.title) !== 'latn'
        ? detectWordScript(article.title)
        : timelineScript;

    const wikiTokens = tokenizeText(article.wikiTitle);
    const titleTokens = tokenizeText(article.title);
    const subtitleTokens = tokenizeText(article.subtitle);
    const quotedSet = new Set([
      ...extractQuotedTokens(article.title),
      ...extractQuotedTokens(article.subtitle),
    ]);
    const locMain = article.locationName
      ? tokenizeText(String(article.locationName).split(',')[0])
      : [];
    const bodyText = `${article.subtitle || ''} ${article.extract || ''}`;

    const tokenScores = new Map(); // word -> score

    const addCandidate = (rawTok, nextRawTok, baseScore) => {
      const tok = normalizeCandidateToken(rawTok, nextRawTok);
      if (!isValidCleanWord(tok, articleScript)) return;

      const isLatn = articleScript === 'latn';
      const isCyrl = articleScript === 'cyrl';
      const word = isLatn
        ? tok.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
        : isCyrl
        ? tok.toUpperCase()
        : tok;
      let score = baseScore;

      // Ideal Wordle length bonus (4-6 letters)
      if (word.length >= 4 && word.length <= 6) {
        score += 15;
      } else if (word.length === 7) {
        score += 5;
      }

      // Bonus if word also appears in article subtitle/extract (confirms it's a central concept)
      if (bodyText && bodyText.includes(tok)) {
        score += 25;
      }

      // Penalty if Hebrew word still starts with ה or attached preposition
      if (articleScript === 'he' && tok.startsWith('ה')) {
        score -= 25;
      }
      // Penalty for plural / construct / adjective endings unless it's a short root
      if (articleScript === 'he' && /(ים|ות|ית)$/.test(tok) && tok.length >= 6) {
        score -= 18;
      }

      const prev = tokenScores.get(word);
      if (prev === undefined || score > prev) {
        tokenScores.set(word, score);
      }
    };

    // 1. Highest priority: `article.wikiTitle` tokens (ONLY if they match articleScript!)
    wikiTokens.forEach((tok, idx) => {
      const nextTok = wikiTokens[idx + 1] || '';
      const posBonus = wikiTokens.length === 1 ? 110 : idx > 0 ? 105 : 85;
      addCandidate(tok, nextTok, posBonus);
    });

    // 2. Quoted terms in `article.title` / `article.subtitle` (e.g. 'עלילות גלגמש')
    for (const qTok of quotedSet) {
      addCandidate(qTok, '', 95);
    }

    // 3. Location name main token (only if in same script, e.g. "אולימפוס", "גיזה")
    if (locMain.length === 1) {
      addCandidate(locMain[0], '', 75);
    }

    // 4. `article.title` tokens with structural awareness
    let seenShel = false;
    titleTokens.forEach((tok, idx) => {
      if (tok === 'של' || tok === 'על' || tok === 'ידי' || tok === 'בידי') {
        seenShel = true;
        return;
      }
      const nextTok = titleTokens[idx + 1] || '';
      let base = 45;
      if (idx === 0 && titleTokens.length > 1) {
        base = 5;
      } else if (seenShel) {
        base = 75;
      } else if (idx > 0) {
        base = 55;
      }
      addCandidate(tok, nextTok, base);
    });

    // 5. Fallback from `article.subtitle` in case `article.title` only had short/stop words
    subtitleTokens.slice(0, 12).forEach((tok, idx) => {
      const nextTok = subtitleTokens[idx + 1] || '';
      addCandidate(tok, nextTok, 38);
    });

    // Pick best word for this article
    const sortedWords = Array.from(tokenScores.entries()).sort((a, b) => b[1] - a[1]);
    if (sortedWords.length > 0) {
      const chosenWord = sortedWords[0][0];
      const chosenScript = detectWordScript(chosenWord);
      scoredPerArticle.push({
        word: chosenWord,
        score: sortedWords[0][1],
        script: chosenScript,
        isHebrew: chosenScript === 'he',
        article,
      });
    }
  }

  // Sort across all articles by keyword quality score descending and deduplicate
  scoredPerArticle.sort((a, b) => b.score - a.score);

  const uniqueCandidates = [];
  const seenNormalized = new Set();

  for (const item of scoredPerArticle) {
    const normKey = Array.from(item.word).map(normalizeChar).join('');
    if (seenNormalized.has(normKey)) continue;
    seenNormalized.add(normKey);
    uniqueCandidates.push(item);
  }

  // Keep the top-quality pool (up to 10 best keywords across the timeline) so weak fallback words are excluded
  const strongPool = uniqueCandidates.filter((c) => c.score >= 45);
  return strongPool.length >= 3 ? strongPool.slice(0, 10) : uniqueCandidates.slice(0, 8);
}

export default function WordleGame({ timeline, onSelectEvent }) {
  const { t, language: lang, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';

  const [sessionSeed, setSessionSeed] = useState(0);
  const [rounds, setRounds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guesses, setGuesses] = useState([]); // Array of { chars: string[], statuses: string[] }
  const [currentInput, setCurrentInput] = useState([]); // Array of chars in active row
  const [roundOutcome, setRoundOutcome] = useState(null); // { won: boolean, points: number, attempts: number }
  const [revealedPositions, setRevealedPositions] = useState([]); // Array of revealed column indices (up to MAX_HINTS)
  const [totalPoints, setTotalPoints] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [roundResults, setRoundResults] = useState([]);

  const allCandidates = useMemo(
    () => extractWordleCandidates(timeline?.articles || [], timeline?.title || ''),
    [timeline?.articles, timeline?.title]
  );

  const initSession = useCallback(() => {
    if (!allCandidates.length) return;
    const shuffled = shuffleArray(allCandidates);
    setRounds(shuffled.slice(0, Math.min(MAX_ROUNDS, shuffled.length)));
    setCurrentIndex(0);
    setGuesses([]);
    setCurrentInput([]);
    setRoundOutcome(null);
    setRevealedPositions([]);
    setTotalPoints(0);
    setSolvedCount(0);
    setIsCompleted(false);
    setRoundResults([]);
  }, [allCandidates]);

  useEffect(() => {
    initSession();
  }, [initSession, sessionSeed]);

  const currentRound = rounds[currentIndex] || null;
  const targetWord = currentRound?.word || '';
  const wordLength = targetWord.length;
  const wordScript = currentRound?.script || detectWordScript(targetWord);
  const isWordHeb = wordScript === 'he' || isHebrewWord(targetWord);
  const isWordRtl = isRtlScript(wordScript) || isWordHeb;
  const maxHintsForWord = Math.min(MAX_HINTS, Math.max(1, wordLength - 1));

  const resetRoundState = () => {
    setGuesses([]);
    setCurrentInput([]);
    setRoundOutcome(null);
    setRevealedPositions([]);
  };

  // Compute keyboard key states ('correct' > 'present' > 'absent') including revealed hint letters
  const keyStates = useMemo(() => {
    const map = {};
    const priority = { absent: 1, present: 2, correct: 3 };
    for (const g of guesses) {
      g.chars.forEach((ch, idx) => {
        const status = g.statuses[idx];
        const norm = normalizeChar(ch);
        const prev = map[norm];
        if (!prev || priority[status] > priority[prev]) {
          map[norm] = status;
        }
        // Mirror onto Hebrew final/base pair so both keys highlight clearly
        if (HEBREW_BASE_TO_FINAL[norm]) {
          const finalCh = HEBREW_BASE_TO_FINAL[norm];
          if (!map[finalCh] || priority[status] > priority[map[finalCh]]) {
            map[finalCh] = status;
          }
        }
      });
    }
    for (const pos of revealedPositions) {
      const ch = targetWord[pos];
      if (!ch) continue;
      const norm = normalizeChar(ch);
      map[norm] = 'correct';
      if (HEBREW_BASE_TO_FINAL[norm]) {
        map[HEBREW_BASE_TO_FINAL[norm]] = 'correct';
      }
    }
    return map;
  }, [guesses, revealedPositions, targetWord]);

  const handleAddLetter = useCallback(
    (rawLetter) => {
      if (!currentRound || roundOutcome) return;
      if (currentInput.length >= wordLength) return;
      const rawCh = isWordRtl ? rawLetter : rawLetter.toUpperCase();
      const ch = formatHebrewCharForPosition(rawCh, currentInput.length, wordLength, isWordHeb);
      setCurrentInput((prev) => [...prev, ch]);
    },
    [currentRound, roundOutcome, currentInput.length, wordLength, isWordRtl, isWordHeb]
  );

  const handleBackspace = useCallback(() => {
    if (!currentRound || roundOutcome) return;
    setCurrentInput((prev) => prev.slice(0, -1));
  }, [currentRound, roundOutcome]);

  const handleSubmitGuess = useCallback(() => {
    if (!currentRound || roundOutcome) return;
    if (currentInput.length !== wordLength) return;

    const statuses = evaluateWordleGuess(currentInput, targetWord);
    const nextGuesses = [...guesses, { chars: currentInput, statuses }];
    setGuesses(nextGuesses);
    setCurrentInput([]);

    const isWin = statuses.every((s) => s === 'correct');
    if (isWin) {
      const attemptNum = nextGuesses.length;
      const basePts = Math.max(150, 700 - attemptNum * 100);
      const pts = Math.max(100, basePts - revealedPositions.length * 50);
      setRoundOutcome({ won: true, points: pts, attempts: attemptNum });
      setRoundResults((prev) => [...prev, 'correct']);
      setTotalPoints((prev) => prev + pts);
      setSolvedCount((prev) => prev + 1);
    } else if (nextGuesses.length >= MAX_ATTEMPTS) {
      setRoundOutcome({ won: false, points: 0, attempts: MAX_ATTEMPTS });
      setRoundResults((prev) => [...prev, 'wrong']);
    }
  }, [
    currentRound,
    roundOutcome,
    currentInput,
    wordLength,
    targetWord,
    guesses,
    revealedPositions.length,
  ]);

  const handleRevealLetterHint = () => {
    if (!currentRound || roundOutcome) return;
    if (revealedPositions.length >= maxHintsForWord) return;

    const allIndices = Array.from({ length: wordLength }, (_, i) => i);
    const unrevealed = allIndices.filter((i) => !revealedPositions.includes(i));
    if (unrevealed.length === 0) return;

    // Prefer a position that hasn't already been solved green in previous guesses
    const notYetSolvedGreen = unrevealed.filter(
      (idx) => !guesses.some((g) => g.statuses[idx] === 'correct')
    );
    const nextPos = notYetSolvedGreen.length > 0 ? notYetSolvedGreen[0] : unrevealed[0];

    setRevealedPositions((prev) => [...prev, nextPos]);
  };

  // Physical keyboard listener
  useEffect(() => {
    if (!currentRound || roundOutcome || isCompleted) return undefined;

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmitGuess();
        return;
      }
      if (e.key && e.key.length === 1) {
        if (wordScript === 'he' && /^[\u0590-\u05FF]$/.test(e.key)) {
          e.preventDefault();
          handleAddLetter(e.key);
        } else if (wordScript === 'ar' && /^[\u0600-\u06FF]$/.test(e.key)) {
          e.preventDefault();
          handleAddLetter(e.key);
        } else if (wordScript === 'cyrl' && /^[\u0400-\u04FF]$/.test(e.key)) {
          e.preventDefault();
          handleAddLetter(e.key.toUpperCase());
        } else if (wordScript === 'latn' && /^[A-Za-z\u00C0-\u024F]$/.test(e.key)) {
          e.preventDefault();
          handleAddLetter(
            e.key
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toUpperCase()
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentRound,
    roundOutcome,
    isCompleted,
    wordScript,
    handleAddLetter,
    handleBackspace,
    handleSubmitGuess,
  ]);

  const handleNextRound = () => {
    if (currentIndex + 1 < rounds.length) {
      setCurrentIndex((i) => i + 1);
      resetRoundState();
    } else {
      setIsCompleted(true);
      if (rounds.length > 0 && solvedCount / rounds.length >= 0.5) {
        confetti({
          particleCount: isKidsMode ? 75 : 40,
          spread: 65,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    }
  };

  useGameCompletionReport({
    game: 'wordle',
    timelineId: timeline?.id,
    contentMode,
    isCompleted,
    stats: (() => {
      const ratio = rounds.length > 0 ? solvedCount / rounds.length : 0;
      return { correct: solvedCount, total: rounds.length, points: totalPoints, ratio, stars: starsForRatio(ratio, 0.8, 0.45) };
    })(),
  });

  if (allCandidates.length === 0) {
    return (
      <div className="game-empty">
        <p>{t('quiz.noEvents')}</p>
      </div>
    );
  }

  if (isCompleted) {
    const ratio = rounds.length > 0 ? solvedCount / rounds.length : 0;
    const resultsTitle =
      ratio >= 0.8
        ? t('quiz.wordle.resultsTitlePerfect')
        : ratio >= 0.45
        ? t('quiz.wordle.resultsTitleGreat')
        : t('quiz.wordle.resultsTitleGood');

    return (
      <GameResults
        ratio={ratio}
        starCount={starsForRatio(ratio, 0.8, 0.45)}
        title={resultsTitle}
        subtitle={t('quiz.wordle.resultsSubtitle')
          .replace('{solved}', String(solvedCount))
          .replace('{total}', String(rounds.length))
          .replace('{points}', formatPoints(totalPoints, lang))}
        scoreValue={solvedCount}
        scoreSuffix={` / ${rounds.length}`}
        scoreCaption={t('quiz.wordle.scoreLabel').replace('{points}', formatPoints(totalPoints, lang))}
        recap={rounds.map((r, idx) => ({
          key: r.article.id || idx,
          tone: roundResults[idx] || 'neutral',
          title: r.article.title,
          meta: <span className="game-recap-word" dir={r.isHebrew ? 'rtl' : 'ltr'}>{r.word}</span>,
          onClick: onSelectEvent ? () => onSelectEvent(r.article) : null,
        }))}
        actions={[
          { key: 'again', label: t('quiz.wordle.playAgainBtn'), Icon: RotateCcw, onClick: () => setSessionSeed((s) => s + 1) },
        ]}
      />
    );
  }

  if (!currentRound) return null;

  const article = currentRound.article;
  const keyboardRows =
    wordScript === 'he'
      ? HEBREW_KEYBOARD_ROWS
      : wordScript === 'ar'
      ? ARABIC_KEYBOARD_ROWS
      : wordScript === 'cyrl'
      ? CYRILLIC_KEYBOARD_ROWS
      : ENGLISH_KEYBOARD_ROWS;
  const hintsLeft = revealedPositions.length < maxHintsForWord;

  return (
    <div className="game-stack wrd-game quiz-enter">
      <GameHud
        label={t('quiz.wordle.roundProgress')
          .replace('{current}', String(currentIndex + 1))
          .replace('{total}', String(rounds.length))}
        stats={[
          { key: 'score', Icon: Star, tone: 'score', text: t('quiz.wordle.scoreLabel').replace('{points}', formatPoints(totalPoints, lang)) },
        ]}
        total={rounds.length}
        current={currentIndex}
        results={roundResults}
      />

      {!roundOutcome && (
        <div className="wrd-toolbar">
          <span className="game-chip">
            {t('quiz.wordle.wordLengthBadge').replace('{count}', String(wordLength))}
          </span>
          <div className="wrd-toolbar-actions">
            {article && onSelectEvent && (
              <button
                type="button"
                className="game-tool-btn"
                onClick={() => onSelectEvent(article)}
                title={t('quiz.wordle.focusEventHintTooltip')}
              >
                <Crosshair aria-hidden="true" />
                <span>{t('quiz.wordle.focusEventHintBtn')}</span>
              </button>
            )}
            <button
              type="button"
              className="game-tool-btn"
              disabled={!hintsLeft}
              onClick={handleRevealLetterHint}
            >
              <Lightbulb aria-hidden="true" />
              <span>
                {!hintsLeft
                  ? t('quiz.wordle.allHintsUsed').replace(/\{max\}/g, String(maxHintsForWord))
                  : t('quiz.wordle.revealLetterHintBtn')
                      .replace('{used}', String(revealedPositions.length))
                      .replace('{max}', String(maxHintsForWord))}
              </span>
            </button>
          </div>
        </div>
      )}

      <div
        className="wrd-board"
        dir={isWordRtl ? 'rtl' : 'ltr'}
        style={{ '--wrd-cols': wordLength }}
        role="grid"
        aria-label={t('quiz.wordle.title')}
      >
        {Array.from({ length: MAX_ATTEMPTS }).map((_, rowIdx) => {
          const submitted = guesses[rowIdx];
          const isCurrentRow = rowIdx === guesses.length && !roundOutcome;

          return (
            <div key={rowIdx} className="wrd-row" role="row" data-current={isCurrentRow || undefined}>
              {Array.from({ length: wordLength }).map((__, colIdx) => {
                const typedChar = isCurrentRow ? currentInput[colIdx] || '' : '';
                const isHintedCol = isCurrentRow && revealedPositions.includes(colIdx);
                const rawChar = submitted
                  ? submitted.chars[colIdx]
                  : typedChar || (isHintedCol ? targetWord[colIdx] : '');
                const char = formatHebrewCharForPosition(rawChar, colIdx, wordLength, isWordHeb);
                const state = submitted
                  ? submitted.statuses[colIdx]
                  : typedChar
                  ? 'filled'
                  : isHintedCol
                  ? 'hint'
                  : 'empty';

                return (
                  <div
                    key={colIdx}
                    role="gridcell"
                    className="wrd-tile"
                    data-state={state}
                    style={submitted ? { animationDelay: `${colIdx * 70}ms` } : undefined}
                  >
                    {char}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {roundOutcome ? (
        <RoundFeedback
          tone={roundOutcome.won ? 'correct' : 'wrong'}
          Icon={roundOutcome.won ? CheckCircle2 : XCircle}
          title={roundOutcome.won
            ? t('quiz.wordle.wonTitle').replace('{word}', targetWord).replace('{points}', formatPoints(roundOutcome.points, lang))
            : t('quiz.wordle.lostTitle').replace('{word}', targetWord)}
          onShowEvent={onSelectEvent ? () => onSelectEvent(article) : null}
          nextLabel={currentIndex + 1 < rounds.length ? t('quiz.wordle.nextWordBtn') : t('quiz.wordle.finishBtn')}
          onNext={handleNextRound}
        >
          <p className="game-feedback-event" dir={getTextDir(article.title)}>{article.title}</p>
          {article.subtitle && <p dir={getTextDir(article.subtitle)}>{article.subtitle}</p>}
        </RoundFeedback>
      ) : (
        <>
          <ul className="wrd-legend">
            <li><i data-state="correct" aria-hidden="true" />{t('quiz.wordle.legendCorrect')}</li>
            <li><i data-state="present" aria-hidden="true" />{t('quiz.wordle.legendPresent')}</li>
            <li><i data-state="absent" aria-hidden="true" />{t('quiz.wordle.legendAbsent')}</li>
          </ul>
          <div className="wrd-keyboard" dir={isWordRtl ? 'rtl' : 'ltr'}>
            {keyboardRows.map((row, rIdx) => (
              <div key={rIdx} className="wrd-kb-row">
                {rIdx === keyboardRows.length - 1 && (
                  <button
                    type="button"
                    className="wrd-key wrd-key--wide wrd-key--enter"
                    disabled={currentInput.length !== wordLength}
                    onClick={handleSubmitGuess}
                    aria-label={t('quiz.wordle.enterKey')}
                    title={t('quiz.wordle.enterKey')}
                  >
                    <CornerDownLeft aria-hidden="true" className="wrd-enter-icon" />
                    <span className="wrd-enter-label">{t('quiz.wordle.enterKey')}</span>
                  </button>
                )}
                {row.map((letter) => {
                  const state = keyStates[normalizeChar(letter)] || keyStates[letter] || undefined;
                  return (
                    <button
                      key={letter}
                      type="button"
                      className="wrd-key"
                      data-state={state}
                      onClick={() => handleAddLetter(letter)}
                    >
                      {letter}
                    </button>
                  );
                })}
                {rIdx === keyboardRows.length - 1 && (
                  <button
                    type="button"
                    className="wrd-key wrd-key--wide"
                    disabled={currentInput.length === 0}
                    onClick={handleBackspace}
                    aria-label="Backspace"
                    title="Backspace"
                  >
                    <Delete aria-hidden="true" className="wrd-backspace-icon" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
