import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  translations,
  ensureLanguageLoaded,
  isLanguageLoaded,
} from '../src/locales/translations.js';
import {
  stripTimelineForChatOrRefine,
  restoreTimelineMediaFromLocal,
} from '../src/utils/timelinePayload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');

test('index.html excludes unused CJK/Arabic/Devanagari Google Fonts while keeping active UI & theme fonts', () => {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  for (const removed of [
    'Noto+Sans+Arabic',
    'Noto+Sans+Devanagari',
    'Noto+Sans+JP',
    'Noto+Sans+KR',
    'Noto+Sans+SC',
    'Suez+One',
    // Batch 6C: only ever fallbacks behind an always-loaded family with the same coverage.
    'Cinzel',
    'Plus+Jakarta+Sans',
  ]) {
    assert.ok(!html.includes(removed), `Expected ${removed} to be removed from index.html`);
  }
  for (const kept of [
    'Frank+Ruhl+Libre',
    'Fredoka',
    'Heebo',
    'Inter',
    'Outfit',
    'Rubik',
  ]) {
    assert.ok(html.includes(kept), `Expected ${kept} to remain in index.html`);
  }
});

test('translations.js provides synchronous date/export seeds and loads full bundles on demand', async () => {
  assert.equal(translations.en.dates.bce, 'BCE');
  assert.equal(translations.he.dates.bce, 'לפנה״ס');
  assert.equal(translations.en.timelineExport.untitledTimeline, 'Untitled Timeline');
  assert.equal(translations.he.timelineExport.untitledTimeline, 'ציר זמן ללא שם');

  assert.equal(isLanguageLoaded('en'), false);
  assert.equal(isLanguageLoaded('he'), false);

  await ensureLanguageLoaded('he');
  assert.equal(isLanguageLoaded('he'), true);
  assert.equal(isLanguageLoaded('en'), false);
  assert.ok(typeof translations.he.toolbar?.zoomIn === 'string');

  await ensureLanguageLoaded('en');
  assert.equal(isLanguageLoaded('en'), true);
  assert.ok(typeof translations.en.toolbar?.zoomIn === 'string');
});

test('stripTimelineForChatOrRefine strips heavy blobs/media, preserves user removals, and restores cleanly', () => {
  const raw = {
    id: 'tl-42',
    title: 'Apollo Program',
    grounding: { is_grounded: true, search_queries: ['apollo'], sources: [] },
    quiz: [{ id: 'q1', question: 'Q?' }],
    whoami: [{ id: 'w1', target_event_id: 'e1' }],
    articles: [
      {
        id: 'e1',
        title: 'Apollo 11',
        from: { year: 1969 },
        imageUrl: 'data:image/jpeg;base64,' + 'A'.repeat(50_000),
        additionalImages: [{ url: 'data:image/jpeg;base64,BBBB' }],
        videos: [{ videoId: 'v1' }],
      },
      {
        id: 'e2',
        title: 'Apollo 13 (image removed by user)',
        from: { year: 1970 },
        imageUrl: null,
      },
    ],
  };

  const { timeline: stripped, mediaStripped } = stripTimelineForChatOrRefine(raw);
  assert.equal(mediaStripped, true);
  assert.equal('grounding' in stripped, false);
  assert.equal('quiz' in stripped, false);
  assert.equal('whoami' in stripped, false);
  assert.equal('imageUrl' in stripped.articles[0], false);
  assert.equal('additionalImages' in stripped.articles[0], false);
  // P-09: video lists are small and stay in the payload; only inline images are stripped.
  assert.deepEqual(stripped.articles[0].videos, raw.articles[0].videos);
  assert.deepEqual(stripped.articles[0]._strippedMediaFields, ['imageUrl', 'additionalImages']);
  assert.equal('_strippedMediaFields' in stripped.articles[1], false);

  // Unsaved merged timelines are left untouched so first persistence has full data
  const unsavedMerged = { ...raw, _unsavedMerged: true };
  const skipped = stripTimelineForChatOrRefine(unsavedMerged);
  assert.equal(skipped.mediaStripped, false);
  assert.equal(skipped.timeline, unsavedMerged);

  // Client fallback restoration cleans transient markers and restores missing media without touching e2
  const restored = restoreTimelineMediaFromLocal(stripped, raw);
  assert.equal(restored.articles[0].imageUrl, raw.articles[0].imageUrl);
  assert.deepEqual(restored.articles[0].additionalImages, raw.articles[0].additionalImages);
  assert.deepEqual(restored.articles[0].videos, raw.articles[0].videos);
  assert.equal('_strippedMediaFields' in restored.articles[0], false);
  assert.equal(restored.articles[1].imageUrl, null);
  assert.deepEqual(restored.grounding, raw.grounding);
});

test('App.jsx keeps heavy timeline views, modals, games, and html-to-image lazy-loaded', () => {
  const appSource = fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'App.jsx'), 'utf8');
  for (const mod of [
    './components/TimelineView',
    './components/EventDrawer',
    './components/GeoMapView',
    './components/TimelineQuizPanel',
    './components/TimelinePodcastPlayer',
    './components/AdminPanel',
  ]) {
    assert.match(
      appSource,
      new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\(['"]${mod.replace(/[./]/g, '\\$&')}['"]\\)\\)`),
      `Expected ${mod} to be loaded via React.lazy in App.jsx`
    );
  }
  assert.ok(!/import\s+.*\s+from\s+['"]html-to-image['"]/.test(appSource));
  assert.ok(!/import\s+.*\s+from\s+['"]canvas-confetti['"]/.test(appSource));
});
