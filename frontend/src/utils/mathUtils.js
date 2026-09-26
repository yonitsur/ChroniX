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

  // 0. Protect currency symbols: e.g. $50, $100, $1,000, $2.5M so remark-math doesn't treat them as math delimiters
  text = text.replace(/(^|[\s(])\$(\d+(?:[.,]\d+)*(?:\s*(?:million|billion|trillion|k|m|b))?)(?=[,\.\s\)]|$)/gi, (_match, p1, p2) => `${p1}&#36;${p2}`);

  // 1. Normalize escaped dollar signs around math: \$ -> $ or \\$ -> $
  text = text.replace(/\\+\$/g, '$');

  // 2. Convert standard LaTeX delimiters \( ... \) -> $ ... $ and \[ ... \] -> $$ ... $$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');

  // 3. Catch parenthesized expressions containing LaTeX commands or malformed delimiters, e.g.:
  //    - (Delta x \Delta p \ge \hbar/2$$ )
  //    - (\Delta x \Delta p \ge \hbar/2)
  //    - ($Delta x \Delta p \ge \hbar/2$)
  text = text.replace(/\(\s*([^()]*?\\[a-zA-Z]+[^()]*?)\s*\)/g, (match, inner) => {
    const trimmed = inner.trim();
    // If it's already cleanly wrapped like $...$ or $$...$$, leave it
    if (/^\${1,2}[^$]+\${1,2}$/.test(trimmed)) return match;

    // Clean any trailing or leading stray dollars or backslashes
    let cleaned = trimmed.replace(/^\$+|\$+$/g, '').trim();

    // Fix common missing backslash on Greek letters like Delta, alpha, etc. if not already preceded by \
    cleaned = cleaned.replace(GREEK_REGEX, '\\$1');

    return `($${cleaned}$)`;
  });

  // 4. Catch unwrapped LaTeX formulas containing backslash commands outside of $...$
  //    e.g. text containing `\Delta x \Delta p \ge \hbar/2` without any $ around it
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let part = parts[i];
    if (LATEX_COMMAND_CHECK_REGEX.test(part)) {
      // Find sequences containing math commands and wrap them
      part = part.replace(/([^\s\n\(\)\[\]]*?\\[a-zA-Z]+[^\n\(\)\[\]]*?)(?=[,\.\s\(\)\[\]]|$)/g, (m) => {
        let trimmed = m.trim();
        if (!trimmed) return m;

        // Clean any leading/trailing punctuation like commas or periods
        let trailingPunct = '';
        if (/[,;.]$/.test(trimmed)) {
          trailingPunct = trimmed.slice(-1);
          trimmed = trimmed.slice(0, -1);
        }

        // Apply Greek letter fix if needed
        trimmed = trimmed.replace(GREEK_REGEX, '\\$1');

        return `$${trimmed}$` + trailingPunct;
      });
      parts[i] = part;
    }
  }
  text = parts.join('');

  return text;
}
