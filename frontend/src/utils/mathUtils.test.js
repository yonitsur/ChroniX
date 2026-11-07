import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMathInText, mathToPlainText } from './mathUtils.js';

describe('normalizeMathInText', () => {
  it('normalizes the exact Heisenberg uncertainty formula', () => {
    const raw = 'Werner Heisenberg formulated the uncertainty principle, defining limits on measuring conjugate variables such as position and momentum (Delta x \\Delta p \\ge \\hbar/2\\$\\$ ) , becoming a foundation of quantum mechanics';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('($\\Delta x \\Delta p \\ge \\hbar/2$)'));
  });

  it('preserves standard inline math $...$', () => {
    const raw = 'The famous formula $E = mc^2$ by Albert Einstein';
    assert.equal(normalizeMathInText(raw), raw);
  });

  it('preserves standard display math $$...$$', () => {
    const raw = 'Schrodinger equation:\n\n$$i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi$$';
    assert.equal(normalizeMathInText(raw), raw);
  });

  it('converts LaTeX bracket delimiters \\(...\\) and \\[...\\]', () => {
    const raw = 'Formula \\(E = mc^2\\) and block \\[\\int_0^1 x dx\\]';
    const normalized = normalizeMathInText(raw);
    assert.equal(normalized, 'Formula $E = mc^2$ and block $$\\int_0^1 x dx$$');
  });

  it('does not treat a decimal-leading formula as currency', () => {
    const out = normalizeMathInText('spacing of approximately $3.4\\text{ \\AA}$. Though');
    assert.ok(out.includes('$3.4\\text{ \\AA}$'));
    assert.ok(!out.includes('&#36;'));
  });

  it('protects currency amounts from being parsed as math', () => {
    const raw = 'The price was $50 and now it is $100 or $1,000.';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('&#36;50'));
    assert.ok(normalized.includes('&#36;100'));
    assert.ok(normalized.includes('&#36;1,000'));
    assert.ok(!normalized.includes('$50 and'));
  });

  it('handles parenthesized math formulas without $ signs', () => {
    const raw = 'Inequality (\\Delta x \\Delta p \\ge \\hbar/2) explains everything';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('($\\Delta x \\Delta p \\ge \\hbar/2$)'));
  });

  it('handles unwrapped LaTeX commands in text', () => {
    const raw = 'The constant \\hbar represents the reduced Planck constant';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('$\\hbar$'));
  });

  it('preserves formulas with internal parentheses like the Dirac equation', () => {
    const raw = 'Dirac constructed the four-component spinor equation, $(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$. The equation naturally produced';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('$(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$'));
    assert.ok(!normalized.includes('$($$'));
    assert.ok(!normalized.includes('($$'));
  });

  it('normalizes imaginary unit \\i to i in formulas without breaking valid LaTeX commands', () => {
    const raw = 'Equation $(\\i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$ alongside $\\int_0^1 x dx$ and $x \\in \\mathbb{R}$';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('$(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$'));
    assert.ok(normalized.includes('\\int_0^1 x dx'));
    assert.ok(normalized.includes('\\in \\mathbb{R}'));
  });

  it('handles malformed formula starting with ($$ without crashing KaTeX', () => {
    const raw = 'constructed the four-component spinor equation, ($$\\i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0. The equation';
    const normalized = normalizeMathInText(raw);
    assert.ok(!normalized.includes('$$'));
    assert.ok(normalized.includes('($i\\gamma^\\mu \\partial_\\mu - m$)'));
  });

  it('preserves clean parenthesized variables like ($x$) and ($p$) in Hebrew without corrupting dollars', () => {
    const raw = 'המיקום ($x$) ואת התנע ($p$) של חלקיק, כאשר אי-הוודאות מקיימת $\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}$.';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('($x$)'));
    assert.ok(normalized.includes('($p$)'));
    assert.ok(!normalized.includes('($x$$)'));
    assert.ok(!normalized.includes('($p$$)'));
    assert.ok(normalized.includes('$\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}$'));
  });

  it('restores LaTeX commands corrupted by JSON escape sequences (e.g. \\x0crac -> \\frac)', () => {
    const raw = 'תנע קווי $p = \x0crac{h}{\\lambda}$, מה שסתם';
    const normalized = normalizeMathInText(raw);
    assert.ok(normalized.includes('$p = \\frac{h}{\\lambda}$'));
  });

  it('does not inject dollars into parentheses inside an existing formula', () => {
    const raw = 'Born postulated that the squared modulus $|\\Psi(\\mathbf{r})|^2$ yields the probability density';
    assert.equal(normalizeMathInText(raw), raw);
    const raw2 = 'The wavefunction $\\psi(\\theta, \\phi)$ and $f(\\alpha) = \\sin(\\alpha)$ are fine';
    assert.equal(normalizeMathInText(raw2), raw2);
  });
});

describe('mathToPlainText', () => {
  it('converts inline LaTeX in titles to readable Unicode', () => {
    assert.equal(
      mathToPlainText('Derivation of Mass-Energy Equivalence ($E = mc^2$)'),
      'Derivation of Mass-Energy Equivalence (E = mc²)',
    );
    assert.equal(
      mathToPlainText('Uncertainty ($\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}$)'),
      'Uncertainty (Δ x Δ p ≥ ħ/2)',
    );
    assert.equal(mathToPlainText('$|\\Psi(\\mathbf{r})|^2$'), '|Ψ(r)|²');
  });

  it('leaves plain titles and currency untouched', () => {
    assert.equal(mathToPlainText('Apollo 11 Moon Landing'), 'Apollo 11 Moon Landing');
    assert.equal(mathToPlainText('Louisiana Purchase for $15 million'), 'Louisiana Purchase for $15 million');
  });
});
