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
});
