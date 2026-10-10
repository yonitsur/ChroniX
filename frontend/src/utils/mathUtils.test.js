import { describe, it, expect } from 'vitest';
import { normalizeMathInText } from './mathUtils.js';

describe('normalizeMathInText', () => {
  it('normalizes the exact Heisenberg uncertainty formula', () => {
    const raw = 'Werner Heisenberg formulated the uncertainty principle, defining limits on measuring conjugate variables such as position and momentum (Delta x \\Delta p \\ge \\hbar/2\\$\\$ ) , becoming a foundation of quantum mechanics';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('($\\Delta x \\Delta p \\ge \\hbar/2$)');
  });

  it('preserves standard inline math $...$', () => {
    const raw = 'The famous formula $E = mc^2$ by Albert Einstein';
    expect(normalizeMathInText(raw)).toBe(raw);
  });

  it('preserves standard display math $$...$$', () => {
    const raw = 'Schrodinger equation:\n\n$$i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi$$';
    expect(normalizeMathInText(raw)).toBe(raw);
  });

  it('converts LaTeX bracket delimiters \\(...\\) and \\[...\\]', () => {
    const raw = 'Formula \\(E = mc^2\\) and block \\[\\int_0^1 x dx\\]';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toBe('Formula $E = mc^2$ and block $$\\int_0^1 x dx$$');
  });

  it('protects currency amounts from being parsed as math', () => {
    const raw = 'The price was $50 and now it is $100 or $1,000.';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('&#36;50');
    expect(normalized).toContain('&#36;100');
    expect(normalized).toContain('&#36;1,000');
    expect(normalized).not.toContain('$50 and');
  });

  it('handles parenthesized math formulas without $ signs', () => {
    const raw = 'Inequality (\\Delta x \\Delta p \\ge \\hbar/2) explains everything';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('($\\Delta x \\Delta p \\ge \\hbar/2$)');
  });

  it('handles unwrapped LaTeX commands in text', () => {
    const raw = 'The constant \\hbar represents the reduced Planck constant';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('$\\hbar$');
  });

  it('preserves formulas with internal parentheses like the Dirac equation', () => {
    const raw = 'Dirac constructed the four-component spinor equation, $(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$. The equation naturally produced';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('$(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$');
    // Ensure nested parenthesis regex did NOT mutilate the dollar pairing
    expect(normalized).not.toContain('$($$');
    expect(normalized).not.toContain('($$');
  });

  it('normalizes imaginary unit \\i to i in formulas without breaking valid LaTeX commands', () => {
    const raw = 'Equation $(\\i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$ alongside $\\int_0^1 x dx$ and $x \\in \\mathbb{R}$';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('$(i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0$');
    expect(normalized).toContain('\\int_0^1 x dx');
    expect(normalized).toContain('\\in \\mathbb{R}');
  });

  it('handles malformed formula starting with ($$ without crashing KaTeX', () => {
    const raw = 'constructed the four-component spinor equation, ($$\\i\\gamma^\\mu \\partial_\\mu - m)\\psi = 0. The equation';
    const normalized = normalizeMathInText(raw);
    expect(normalized).not.toContain('$$');
    expect(normalized).toContain('($i\\gamma^\\mu \\partial_\\mu - m$)');
  });

  it('preserves clean parenthesized variables like ($x$) and ($p$) in Hebrew without corrupting dollars', () => {
    const raw = 'המיקום ($x$) ואת התנע ($p$) של חלקיק, כאשר אי-הוודאות מקיימת $\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}$.';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('($x$)');
    expect(normalized).toContain('($p$)');
    expect(normalized).not.toContain('($x$$)');
    expect(normalized).not.toContain('($p$$)');
    expect(normalized).toContain('$\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}$');
  });

  it('restores LaTeX commands corrupted by JSON escape sequences (e.g. \\x0crac -> \\frac)', () => {
    const raw = 'תנע קווי $p = \x0crac{h}{\\lambda}$, מה שסתם';
    const normalized = normalizeMathInText(raw);
    expect(normalized).toContain('$p = \\frac{h}{\\lambda}$');
  });
});

