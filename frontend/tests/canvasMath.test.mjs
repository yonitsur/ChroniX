import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRichWords, layoutRichLines, splitMathRuns } from '../src/utils/canvasMath.js';

// Monospace stand-in for a canvas context: every character is 7px wide.
const fakeCtx = {
  textBaseline: 'middle',
  save() {},
  restore() {},
  measureText: (text) => ({
    width: [...String(text)].length * 7,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
  }),
};
const fakeMath = (width, ascent = 10, descent = 3) => () => ({ width, ascent, descent, glyphs: [], rules: [], paths: [] });
const lineText = (line) => line.pieces.map((p) => (p.type === 'math' ? `[${p.layout ? 'M' : ''}]` : p.text)).join('');

test('splitMathRuns returns null for text without formulas', () => {
  assert.equal(splitMathRuns('Plain description, costs $50 and $60.'), null);
  assert.equal(splitMathRuns(''), null);
});

test('splitMathRuns separates text and TeX runs', () => {
  assert.deepEqual(splitMathRuns('Pressure ($P \\propto 1/V$) holds.'), [
    { type: 'text', text: 'Pressure (' },
    { type: 'math', tex: 'P \\propto 1/V' },
    { type: 'text', text: ') holds.' },
  ]);
});

test('buildRichWords glues formulas to adjacent punctuation and keeps spaces as breaks', () => {
  const words = buildRichWords(splitMathRuns('law ($P^2 \\propto a^3$). Next'));
  assert.equal(words.length, 3);
  assert.deepEqual(words[1].pieces.map((p) => p.type), ['text', 'math', 'text']);
  assert.equal(words[0].spaceAfter, true);
  assert.equal(words[1].spaceAfter, true);
  assert.equal(words[2].spaceAfter, false);
});

test('layoutRichLines wraps at word boundaries and never splits a formula', () => {
  const words = buildRichWords(splitMathRuns('aaaa bbbb ($x$) cccc'));
  const lines = layoutRichLines(fakeCtx, words, 70, { fontPx: 13, lineHeight: 19, getMathLayout: fakeMath(20) });
  assert.deepEqual(lines.map(lineText), ['aaaa bbbb', '([M]) cccc']);
  assert.ok(lines.every((line) => line.width <= 70));
  assert.equal(lines[0].h, 19);
});

test('layoutRichLines grows a line for a tall formula', () => {
  const words = buildRichWords(splitMathRuns('ratio $\\frac{1}{V}$'));
  const [line] = layoutRichLines(fakeCtx, words, 200, { fontPx: 13, lineHeight: 19, getMathLayout: fakeMath(12, 20, 9) });
  assert.ok(line.h > 19);
  assert.ok(line.padTop > 0);
});

test('layoutRichLines falls back to plain text when a formula cannot be typeset', () => {
  const words = buildRichWords(splitMathRuns('Energy $E = mc^2$'));
  const [line] = layoutRichLines(fakeCtx, words, 300, { fontPx: 13, lineHeight: 19, getMathLayout: () => null });
  assert.equal(lineText(line), 'Energy E = mc²');
});

test('layoutRichLines clamps to maxLines with an ellipsis', () => {
  const words = buildRichWords(splitMathRuns('one two three $x$ four five six'));
  const lines = layoutRichLines(fakeCtx, words, 60, { fontPx: 13, lineHeight: 19, maxLines: 2, getMathLayout: fakeMath(10) });
  assert.equal(lines.length, 2);
  assert.ok(lineText(lines[1]).endsWith('…'));
  assert.ok(lines[1].width <= 60);
});
