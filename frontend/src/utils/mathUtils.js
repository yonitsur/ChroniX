/**
 * mathUtils.js
 * Utilities for normalizing and preparing mathematical and scientific formulas
 * for flawless rendering with KaTeX and ReactMarkdown.
 */

// Common Greek letters frequently used in mathematical and physical equations
const GREEK_LETTERS = [
  'Delta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta',
  'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho',
  'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'
];

const GREEK_REGEX = new RegExp(`(?<!\\\\)\\b(${GREEK_LETTERS.join('|')})\\b`, 'g');

// LaTeX math commands and operators
const LATEX_COMMANDS = [
  ...GREEK_LETTERS,
  'frac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'iiint', 'oint',
  'partial', 'ge', 'le', 'geq', 'leq', 'approx', 'neq', 'equiv', 'sim', 'propto',
  'times', 'div', 'pm', 'mp', 'cdot', 'hbar', 'infty', 'nabla',
  'to', 'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow',
  'subset', 'subseteq', 'supset', 'supseteq', 'in', 'notin', 'cap', 'cup',
  'forall', 'exists', 'nabla', 'vec', 'hat', 'bar', 'dot', 'ddot', 'quad', 'qquad'
];

const LATEX_COMMAND_CHECK_REGEX = new RegExp(`\\\\(${LATEX_COMMANDS.join('|')})\\b`);

// Matches an already-delimited math segment: $$...$$ (display) or $...$ (inline)
const MATH_SEGMENT_REGEX = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g;

/** Returns [start, end) index ranges of all already-delimited math segments in text. */
function getMathRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(MATH_SEGMENT_REGEX)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** True when [start, end) lies entirely within one existing math segment. */
function isInsideMath(ranges, start, end) {
  return ranges.some(([s, e]) => start >= s && end <= e);
}

/**
 * Normalizes text containing mathematical equations so that KaTeX / remark-math
 * can parse and render them cleanly.
 *
 * Handles:
 * 1. Currency protection ($50, $100 -> &#36;50, &#36;100) so they don't break math parsing.
 * 2. Escaped dollar signs from JSON/LLM output: \$ -> $, \$\$ -> $$.
 * 3. LaTeX bracket delimiters: \(...\) -> $...$ and \[...\] -> $$...$$.
 * 4. Malformed formulas enclosed in parentheses, e.g. (Delta x \Delta p \ge \hbar/2$\$ )
 *    or (\Delta x \Delta p \ge \hbar/2).
 * 5. Missing backslashes on Greek letters in formulas (e.g. Delta x \Delta p -> \Delta x \Delta p).
 * 6. Standalone unwrapped LaTeX commands in text.
 *
 * @param {string} rawText
 * @returns {string} Normalized text with standardized $...$ and $$...$$ math delimiters.
 */
export function normalizeMathInText(rawText) {
  if (!rawText || typeof rawText !== 'string') return rawText || '';

  let text = rawText;

  // Fix JSON escape artifacts for LaTeX commands where LLM produced single backslash:
  // e.g. \frac -> \x0c + rac, \theta -> \x09 + heta, \beta -> \x08 + eta, \rho -> \x0d + ho
  text = text.replace(/\x0c(?=rac|orall)/g, '\\f');
  text = text.replace(/\x09(?=heta|imes|au|o\b|ext)/g, '\\t');
  text = text.replace(/\x08(?=eta|ar|inom|oldsymbol)/g, '\\b');
  text = text.replace(/\x0d(?=ho|ight|angle|ightarrow)/g, '\\r');
  text = text.replace(/\n(?=abla|u\b|eq|otin)/g, '\\n');

  // 0. Protect currency symbols: e.g. $50, $100, $1,000, $2.5M so remark-math doesn't treat them as math delimiters
  text = text.replace(/(^|[\s(])\$(\d+(?:[.,]\d+)*(?:\s*(?:million|billion|trillion|k|m|b))?)(?=[,.]?(?:[\s)]|$))/gi, (_match, p1, p2) => `${p1}&#36;${p2}`);

  // 1. Normalize escaped dollar signs around math: \$ -> $ or \\$ -> $
  text = text.replace(/\\+\$/g, '$');

  // 2. Convert standard LaTeX delimiters \( ... \) -> $ ... $ and \[ ... \] -> $$ ... $$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');

  // 3. Fix erroneous \i used as imaginary unit (LaTeX math doesn't support text-mode \i, and LLMs often write \i\gamma, \i\hbar, etc.)
  //    Keep valid commands like \int, \in, \infty, \iota, \imath intact.
  text = text.replace(/\\i(?=\\[a-zA-Z])|(?<![a-zA-Z])\\i(?![a-zA-Z])/g, 'i');

  // 4. Handle parenthesized formulas that are NOT yet wrapped in $, e.g.:
  //    - (Delta x \Delta p \ge \hbar/2$$ )
  //    - (\Delta x \Delta p \ge \hbar/2)
  //    - ($$\i\gamma^\mu \partial_\mu - m)\psi = 0
  //    First normalize unclosed / stray delimiters inside parentheses without adding extra dollars to ($x$):
  text = text.replace(/\(\s*\${1,2}\s*([^()$]+?)\s*\${0,2}\s*\)/g, '($$$1$)');

  // Now, catch parenthesized expressions containing LaTeX commands or Greek letters outside of $
  // Example: (Delta x \Delta p \ge \hbar/2) or (\Delta x \Delta p \ge \hbar/2)
  // But DON'T match if it's already surrounded by $...$ (like $(...)$), and DON'T touch
  // parentheses that live INSIDE an existing formula, e.g. $|\Psi(\mathbf{r})|^2$ — wrapping
  // those would inject extra dollars and break the delimiter pairing.
  let mathRanges = getMathRanges(text);
  text = text.replace(/(?<!\$)\(\s*([^()]*?\\[a-zA-Z]+[^()]*?)\s*\)(?!\$)/g, (match, inner, offset) => {
    if (isInsideMath(mathRanges, offset, offset + match.length)) return match;
    const trimmed = inner.trim();
    if (/^\${1,2}[^$]+\${1,2}$/.test(trimmed)) return match;
    let cleaned = trimmed.replace(/^\$+|\$+$/g, '').trim();
    cleaned = cleaned.replace(GREEK_REGEX, '\\$1');
    return `($${cleaned}$)`;
  });

  // Also catch parenthesized expressions that have Greek letters without backslash
  mathRanges = getMathRanges(text);
  text = text.replace(/(?<!\$)\(\s*([^()]*?\b(?:Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|tau|phi|psi|omega)\b[^()]*?)\s*\)(?!\$)/g, (match, inner, offset) => {
    if (isInsideMath(mathRanges, offset, offset + match.length)) return match;
    const trimmed = inner.trim();
    if (/^\${1,2}[^$]+\${1,2}$/.test(trimmed)) return match;
    let cleaned = trimmed.replace(/^\$+|\$+$/g, '').trim();
    cleaned = cleaned.replace(GREEK_REGEX, '\\$1');
    return `($${cleaned}$)`;
  });

  // 5. Catch unwrapped LaTeX formulas containing backslash commands outside of $...$
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let part = parts[i];
    if (!part) continue;

    if (LATEX_COMMAND_CHECK_REGEX.test(part)) {
      part = part.replace(/([^\s\n\(\)\[\]]*?\\[a-zA-Z]+[^\n\(\)\[\]]*?)(?=[,\.\s\(\)\[\]]|$)/g, (m) => {
        let trimmed = m.trim();
        if (!trimmed) return m;

        let trailingPunct = '';
        if (/[,;.]$/.test(trimmed)) {
          trailingPunct = trimmed.slice(-1);
          trimmed = trimmed.slice(0, -1);
        }

        trimmed = trimmed.replace(GREEK_REGEX, '\\$1');
        return `$${trimmed}$` + trailingPunct;
      });
    }

    parts[i] = part;
  }

  // Also clean up any Greek letter inside math blocks that missed a backslash
  for (let i = 1; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(GREEK_REGEX, '\\$1');
  }

  text = parts.join('');

  return text;
}

/**
 * Quick check whether a string contains LaTeX math ($...$, $$...$$, \(...\) or \command).
 * @param {string} text
 * @returns {boolean}
 */
export function containsMath(text) {
  if (!text || typeof text !== 'string') return false;
  return /\$[^$\n]+\$|\\[a-zA-Z(\[]/.test(text);
}

const PLAIN_SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  hbar: 'ħ', infty: '∞', partial: '∂', nabla: '∇', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
  Leftrightarrow: '⇔', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cap: '∩', cup: '∪',
  forall: '∀', exists: '∃', sum: '∑', prod: '∏', int: '∫', oint: '∮', sqrt: '√', langle: '⟨', rangle: '⟩',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '',
};
const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUBSCRIPTS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };

function toScript(content, map, marker) {
  const chars = [...content];
  if (chars.every((c) => map[c])) return chars.map((c) => map[c]).join('');
  return chars.length === 1 ? `${marker}${content}` : `${marker}(${content})`;
}

function latexToPlain(latex) {
  let s = latex;
  // \frac{a}{b} -> a/b, \sqrt{x} -> √x
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1');
  }
  // Font / text wrappers: \mathbf{r} -> r
  s = s.replace(/\\(?:mathbf|mathrm|mathit|mathcal|mathbb|boldsymbol|text|textbf|textit|operatorname|vec|hat|bar|tilde|dot|ddot|overline)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '');
  // Named symbols
  s = s.replace(/\\([a-zA-Z]+|[,;!])/g, (m, name) => (name in PLAIN_SYMBOLS ? PLAIN_SYMBOLS[name] : name));
  // Super/subscripts
  s = s.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_m, a, b) => toScript(a ?? b, SUPERSCRIPTS, '^'));
  s = s.replace(/_\{([^{}]*)\}|_(\S)/g, (_m, a, b) => toScript(a ?? b, SUBSCRIPTS, '_'));
  s = s.replace(/[{}]/g, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Converts text containing LaTeX formulas into readable plain Unicode text, for places that
 * can't render KaTeX (canvas timeline cards, map popups, document titles, aria-labels).
 * e.g. "Mass-Energy Equivalence ($E = mc^2$)" -> "Mass-Energy Equivalence (E = mc²)"
 *
 * @param {string} rawText
 * @returns {string}
 */
export function mathToPlainText(rawText) {
  if (!rawText || typeof rawText !== 'string') return rawText || '';
  if (!containsMath(rawText) && !rawText.includes('$')) return rawText;

  const CURRENCY = '\u0000';
  let text = rawText
    // Protect currency amounts ($50, $1,000) so they aren't paired as math delimiters
    .replace(/(^|[\s(])\$(?=\d+(?:[.,]\d+)*(?:\s*(?:million|billion|trillion|k|m|b))?[,.]?(?:[\s)]|$))/gi, `$1${CURRENCY}`)
    .replace(/\\+\$/g, '$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');

  text = text.replace(MATH_SEGMENT_REGEX, (seg) => {
    const inner = seg.startsWith('$$') ? seg.slice(2, -2) : seg.slice(1, -1);
    return latexToPlain(inner);
  });

  // Stray LaTeX commands outside delimiters
  if (/\\[a-zA-Z]/.test(text)) text = latexToPlain(text);

  return text.replace(/\u0000/g, '$');
}
