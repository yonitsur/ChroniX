import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_MODES,
  VISUAL_THEMES,
  DEFAULT_THEME_FOR_AGE,
  THEME_CLASS,
  normalizeAgeMode,
  normalizeVisualTheme,
  toBackendContentMode,
} from '../src/data/experienceModes.js';

test('ChroniX supports strictly two modes (classic & kids) and two visual themes (classic & toy)', () => {
  assert.deepEqual(AGE_MODES, ['kids', 'classic']);
  assert.deepEqual(VISUAL_THEMES, ['classic', 'toy']);
  assert.deepEqual(DEFAULT_THEME_FOR_AGE, { kids: 'toy', classic: 'classic' });
  assert.deepEqual(THEME_CLASS, { toy: 'theme-toy' });

  assert.equal(normalizeAgeMode('kids'), 'kids');
  assert.equal(normalizeAgeMode('classic'), 'classic');
  assert.equal(normalizeAgeMode('unknown'), 'classic');
  assert.equal(normalizeAgeMode(null), 'classic');

  assert.equal(toBackendContentMode('kids'), 'kids');
  assert.equal(toBackendContentMode('classic'), 'classic');

  assert.equal(normalizeVisualTheme('classic'), 'classic');
  assert.equal(normalizeVisualTheme('toy'), 'toy');
  assert.equal(normalizeVisualTheme('playful'), 'toy');
  assert.equal(normalizeVisualTheme('unknown'), null);
});
