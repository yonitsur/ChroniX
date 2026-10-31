import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisualTheme, isVisualThemeAvailable } from '../src/data/experienceModes.js';
import { getPublicPageContent } from '../src/data/publicPages/index.js';
import { en as localesEn } from '../src/locales/en.js';
import { he as localesHe } from '../src/locales/he.js';

test('Comic and Journal themes are unavailable by default', () => {
  delete process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES;
  assert.equal(normalizeVisualTheme('comic'), null);
  assert.equal(normalizeVisualTheme('journal'), null);
  assert.equal(isVisualThemeAvailable('comic'), false);
  for (const theme of ['classic', 'toy', 'bento']) {
    assert.equal(normalizeVisualTheme(theme), theme);
  }
  assert.equal(normalizeVisualTheme('playful'), 'toy');
});

test('Comic and Journal themes are available when the flag is enabled', () => {
  process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES = 'true';
  try {
    assert.equal(normalizeVisualTheme('comic'), 'comic');
    assert.equal(normalizeVisualTheme('journal'), 'journal');
  } finally {
    delete process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES;
  }
});

test('About and Features copy omit independent 5-theme picker claims when flag is disabled', () => {
  delete process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES;

  const heFeatures = getPublicPageContent('he').features.items.find((i) => i.id === 'kids-mode');
  const enFeatures = getPublicPageContent('en').features.items.find((i) => i.id === 'kids-mode');

  assert.ok(!heFeatures.title.includes('5 ערכות'));
  assert.ok(!heFeatures.desc.includes('לבחור באופן בלתי תלוי'));
  assert.ok(!enFeatures.title.includes('5 Visual'));
  assert.ok(!enFeatures.desc.includes('choose freely'));

  assert.ok(!localesHe.about.heroDesc.includes('5 ערכות'));
  assert.ok(!localesHe.about.features[3].title.includes('5 ערכות'));
  assert.ok(!localesHe.about.features[3].desc.includes('בחירה חופשית'));
  assert.ok(!localesHe.auth.featuresShowcaseIntro.includes('5 ערכות'));

  assert.ok(!localesEn.about.heroDesc.includes('5 visual design themes'));
  assert.ok(!localesEn.about.features[3].title.includes('5 Visual Themes'));
  assert.ok(!localesEn.about.features[3].desc.includes('5 independent visual design themes'));
  assert.ok(!localesEn.auth.featuresShowcaseIntro.includes('5 visual design themes'));
});

test('Public Features page surfaces 5-theme copy when EXTRA_VISUAL_THEMES is enabled', () => {
  process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES = 'true';
  try {
    const heFeatures = getPublicPageContent('he').features.items.find((i) => i.id === 'kids-mode');
    const enFeatures = getPublicPageContent('en').features.items.find((i) => i.id === 'kids-mode');
    assert.ok(heFeatures.title.includes('5 ערכות'));
    assert.ok(enFeatures.title.includes('5 Visual'));
  } finally {
    delete process.env.VITE_ENABLE_EXTRA_VISUAL_THEMES;
  }
});
