// Decides whether a short text (a card subtitle) needs the Markdown/KaTeX pipeline or can be
// rendered as a plain string. Kept deliberately conservative: anything Markdown or the math
// normaliser could render differently from the raw string goes through MathMarkdown.
import { containsMath } from './mathUtils.js';

// Inline syntax (emphasis, code, links, HTML, entities, escapes, math, tables), line breaks,
// and block syntax at the start of the text (lists, headings, rules, indented code).
const MARKDOWN_SYNTAX = /[\\$*_`~[\]<>&|#\n\r]|^\s*(?:[-+=]|\d{1,9}[.)])|^(?: {4}|\t)/;

// normalizeMathInText also turns "(Delta x ...)" into a formula without any backslash or "$".
const BARE_GREEK_IN_PARENS = /\([^()]*\b(?:Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|tau|phi|psi|omega)\b[^()]*\)/;

export function needsRichText(text) {
  if (!text || typeof text !== 'string') return false;
  return containsMath(text) || MARKDOWN_SYNTAX.test(text) || BARE_GREEK_IN_PARENS.test(text);
}
