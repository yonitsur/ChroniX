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
  text = text.replace(/(^|[\s(])\$(\d+(?:[.,]\d+)*(?:\s*(?:million|billion|trillion|k|m|b))?)(?=[,\.\s\)]|$)/gi, (_match, p1, p2) => `${p1}&#36;${p2}`);

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
  // But DON'T match if it's already surrounded by $...$ (like $(...)$)
  text = text.replace(/(?<!\$)\(\s*([^()]*?\\[a-zA-Z]+[^()]*?)\s*\)(?!\$)/g, (match, inner) => {
    const trimmed = inner.trim();
    if (/^\${1,2}[^$]+\${1,2}$/.test(trimmed)) return match;
    let cleaned = trimmed.replace(/^\$+|\$+$/g, '').trim();
    cleaned = cleaned.replace(GREEK_REGEX, '\\$1');
    return `($${cleaned}$)`;
  });

  // Also catch parenthesized expressions that have Greek letters without backslash
  text = text.replace(/(?<!\$)\(\s*([^()]*?\b(?:Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|tau|phi|psi|omega)\b[^()]*?)\s*\)(?!\$)/g, (match, inner) => {
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
