// Content-based text direction helpers.
//
// User/AI-generated content (timeline titles, event titles, descriptions, lane and
// topic names, captions...) must be laid out according to the language of the text
// itself, NOT the interface language. The interface direction is used only as a
// fallback when the text has no strong directional letters (empty, digits, symbols).

const RTL_LETTER_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
// Strong LTR letters: Latin (incl. accents), Greek, Cyrillic, Armenian, Georgian, CJK, etc.
const LTR_LETTER_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u052F\u0530-\u058F\u10A0-\u10FF\u1E00-\u1FFF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g;

/**
 * Detects the dominant direction of a piece of text by comparing the amount of
 * RTL letters vs LTR letters. Majority counting (rather than "contains any RTL char"
 * or "first strong char") keeps an English title with one Hebrew word LTR, and a
 * Hebrew title that starts with a brand name ("iPhone – ההיסטוריה") RTL.
 *
 * @returns {'rtl' | 'ltr' | null} null when the text has no strong letters.
 */
export function detectTextDirection(text) {
  if (typeof text !== 'string' || !text) return null;
  const rtlCount = (text.match(RTL_LETTER_RE) || []).length;
  const ltrCount = (text.match(LTR_LETTER_RE) || []).length;
  if (rtlCount === 0 && ltrCount === 0) return null;
  return rtlCount >= ltrCount ? 'rtl' : 'ltr';
}

/**
 * Joins several text fragments (e.g. title + subtitle) and detects their direction.
 * @returns {'rtl' | 'ltr' | null}
 */
export function detectTextsDirection(...texts) {
  return detectTextDirection(texts.filter((t) => typeof t === 'string' && t).join(' '));
}

/**
 * Returns the `dir` attribute value for content text, falling back to the
 * interface direction only when the text itself is directionally neutral.
 */
export function getTextDir(text, fallbackRtl = false) {
  return detectTextDirection(text) || (fallbackRtl ? 'rtl' : 'ltr');
}

/** Boolean variant of {@link getTextDir}. */
export function isTextRtl(text, fallbackRtl = false) {
  return getTextDir(text, fallbackRtl) === 'rtl';
}

/** Like {@link isTextRtl} but for multiple fragments combined (e.g. title + subtitle). */
export function areTextsRtl(texts, fallbackRtl = false) {
  const dir = detectTextsDirection(...(Array.isArray(texts) ? texts : [texts]));
  return dir ? dir === 'rtl' : Boolean(fallbackRtl);
}
