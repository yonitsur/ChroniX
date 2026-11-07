import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areTextsRtl,
  detectTextDirection,
  getTextDir,
  isTextRtl,
} from './textDirection.js';

test('detects direction from the text itself', () => {
  assert.equal(detectTextDirection('History of the Roman Empire'), 'ltr');
  assert.equal(detectTextDirection('תולדות האימפריה הרומית'), 'rtl');
  assert.equal(detectTextDirection('خط زمني'), 'rtl');
  assert.equal(detectTextDirection('История России'), 'ltr');
});

test('neutral text has no direction', () => {
  assert.equal(detectTextDirection(''), null);
  assert.equal(detectTextDirection('1948 - 1967'), null);
  assert.equal(detectTextDirection(null), null);
});

test('majority wins for mixed text', () => {
  assert.equal(detectTextDirection('The Knesset (הכנסת) and Israeli politics'), 'ltr');
  assert.equal(detectTextDirection('iPhone – ההיסטוריה המלאה'), 'rtl');
});

test('interface direction is only a fallback for neutral text', () => {
  // English content in a Hebrew interface stays LTR
  assert.equal(getTextDir('World War II', true), 'ltr');
  assert.equal(isTextRtl('World War II', true), false);
  // Hebrew content in an English interface stays RTL
  assert.equal(getTextDir('מלחמת העולם השנייה', false), 'rtl');
  // Neutral content falls back to the interface
  assert.equal(getTextDir('1945', true), 'rtl');
  assert.equal(getTextDir('', false), 'ltr');
});

test('combined fragments (title + subtitle)', () => {
  assert.equal(areTextsRtl(['Moon landing', 'Apollo 11 lands'], true), false);
  assert.equal(areTextsRtl(['', 'נחיתה על הירח'], false), true);
  assert.equal(areTextsRtl(['', undefined], true), true);
});
