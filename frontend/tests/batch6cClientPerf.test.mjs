// Batch 6C: mobile card feed (P-16), App prop stability (P-17), canvas data (P-18),
// split-pane drag (P-23) and the boot path (P-24).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { needsRichText } from '../src/utils/richText.js';
import {
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  computeSplitRatioFromClientY,
  createFrameThrottle,
  getTimelinePaneHeight,
} from '../src/utils/splitPane.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(FRONTEND_DIR, ...parts), 'utf8');

const APP = read('src', 'App.jsx');
const CARDS = read('src', 'components', 'CardsListDrawer.jsx');
const MATH_MARKDOWN = read('src', 'components', 'MathMarkdown.jsx');
const MAIN = read('src', 'main.jsx');
const BOOT = read('src', 'bootApp.jsx');
const INDEX_HTML = read('index.html');
const THEME_INIT = read('public', 'theme-init.js');

// ---------------------------------------------------------------- P-16

test('needsRichText keeps plain subtitles on the plain-text path', () => {
  for (const text of [
    'A plain description of the event',
    'The war ends in Europe (1945), and the UN is founded.',
    "Neil Armstrong's first step on the Moon",
    'תחילת עידן החלל המודרני והמרוץ הטכנולוגי',
    'Population grew to 1.5 million people',
    '',
    null,
    undefined,
  ]) {
    assert.equal(needsRichText(text), false, String(text));
  }
});

test('needsRichText sends Markdown, math and normaliser-sensitive text to MathMarkdown', () => {
  for (const text of [
    'Energy $E = mc^2$ was proposed',
    'Uses \\alpha particles',
    'A **bold** claim',
    'An _emphasised_ word',
    'Run `code` here',
    'See [the paper](https://example.com)',
    'AT&amp;T is founded',
    'Line one\nLine two',
    '1945. The war ends',
    '- a list item',
    '# Heading',
    'Uncertainty (Delta x Delta p >= hbar/2) explained',
    '<b>html</b>',
  ]) {
    assert.equal(needsRichText(text), true, text);
  }
});

test('card subtitles skip MathMarkdown unless needed, and cards are memoised', () => {
  assert.match(CARDS, /const RowCard = memo\(function RowCard/);
  assert.match(CARDS, /const FeedCard = memo\(function FeedCard/);
  assert.match(CARDS, /needsRichText\(text\) \? <MathMarkdown content=\{text\} inline \/> : text/);
  assert.ok(!/<MathMarkdown content=\{art\.subtitle\}/.test(CARDS), 'subtitles must go through CardSubtitle');
  // Stable wrappers around the parent's per-render closures keep the memo effective.
  assert.match(CARDS, /const handleSelectCard = useCallback\(\(art\) => cardHandlersRef\.current\.onSelectArticle\?\.\(art\), \[\]\)/);
  assert.match(CARDS, /onSelect=\{handleSelectCard\}/);
  assert.match(CARDS, /onToggleStar=\{handleToggleCardStar\}/);
});

test('MathMarkdown is memoised, hoists its plugin/component objects and loads KaTeX lazily', () => {
  assert.match(MATH_MARKDOWN, /export default memo\(MathMarkdown\);/);
  assert.ok(!/^import .*rehype-katex/m.test(MATH_MARKDOWN), 'rehype-katex must not be a static import');
  assert.ok(!/^import .*remark-math/m.test(MATH_MARKDOWN), 'remark-math must not be a static import');
  assert.match(MATH_MARKDOWN, /import\('remark-math'\), import\('rehype-katex'\)/);
  assert.match(MATH_MARKDOWN, /const INLINE_COMPONENTS = \{/);
  assert.match(MATH_MARKDOWN, /const BLOCK_COMPONENTS = \{/);
  assert.ok(!/remarkPlugins=\{\[/.test(MATH_MARKDOWN), 'no inline plugin arrays');
  assert.ok(!/rehypePlugins=\{\[/.test(MATH_MARKDOWN), 'no inline plugin arrays');
  // Hooks run before the empty-content early return.
  assert.ok(MATH_MARKDOWN.indexOf('useMemo(') < MATH_MARKDOWN.indexOf('if (!content) return null;'));
});

test('the mobile card feed mounts on first show and stays alive afterwards', () => {
  const feedIdx = APP.indexOf('<TimelineCardFeed');
  assert.ok(feedIdx > 0);
  const before = APP.slice(Math.max(0, feedIdx - 600), feedIdx);
  assert.match(before, /<LazyMount[\s\S]*isOpen=\{mobileTimelineView === 'feed'\}/);
  // The wrapper still toggles visibility instead of unmounting (keep-alive).
  assert.match(before, /mobileTimelineView === 'feed' \? 'visible' : 'invisible pointer-events-none'/);
});

// ---------------------------------------------------------------- P-17 / P-18

test('App keeps prop identities stable for the map, canvas and lists', () => {
  assert.ok(!/(articles|lanes)=\{visibleTimeline\?\.(articles|lanes) \|\| \[\]\}/.test(APP));
  assert.match(APP, /const EMPTY_ARTICLES = \[\];/);
  assert.match(APP, /const EMPTY_LANES = \[\];/);
  // A star toggle that changes nothing keeps the same Set.
  assert.match(APP, /if \(shouldBeStarred === prev\.has\(articleId\)\) return prev;/);
  assert.match(APP, /setStarredArticleIds\(\(prev\) => \(prev\.size === 0 \? prev : new Set\(\)\)\)/);
});

test('TimelineView receives the visible timeline, whose identity only follows timeline data and hidden layers', () => {
  assert.match(APP, /timelineData=\{visibleTimeline\}/);
  assert.ok(!APP.includes('timelineCanvasData'));
  assert.ok(!APP.includes('computeTimelineCanvasArticlesSignature'));
  assert.match(
    APP,
    /const visibleTimeline = useMemo\(\s*\(\) => applyHiddenLayersToTimeline\(currentTimeline, hiddenLayerIds\),\s*\[currentTimeline, hiddenLayerIds\]\s*\);/
  );
});

// ---------------------------------------------------------------- P-23

const fakeContainer = ({ top = 100, height = 600, paddingTop = '0px', paddingBottom = '0px' } = {}) => ({
  el: { getBoundingClientRect: () => ({ top, height }) },
  style: () => ({ paddingTop, paddingBottom }),
});

test('computeSplitRatioFromClientY matches the previous inline maths and clamps', () => {
  const { el, style } = fakeContainer({ top: 100, height: 652, paddingTop: '52px', paddingBottom: '0px' });
  // usable 600px, pointer 300px below the padding -> 50%
  assert.equal(computeSplitRatioFromClientY(el, 100 + 52 + 300, style), 50);
  assert.equal(computeSplitRatioFromClientY(el, 0, style), SPLIT_RATIO_MIN);
  assert.equal(computeSplitRatioFromClientY(el, 5000, style), SPLIT_RATIO_MAX);
  const empty = fakeContainer({ height: 0 });
  assert.equal(computeSplitRatioFromClientY(empty.el, 10, empty.style), null);
  assert.equal(computeSplitRatioFromClientY(null, 10, style), null);
});

test('getTimelinePaneHeight keeps the divider allowance per viewport', () => {
  assert.equal(getTimelinePaneHeight(33, false), 'calc(67% - 14px)');
  assert.equal(getTimelinePaneHeight(40, true), 'calc(60% - 24px)');
});

test('createFrameThrottle applies at most once per frame and flushes the last value', () => {
  const frames = [];
  const applied = [];
  const throttle = createFrameThrottle((v) => applied.push(v), {
    requestFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelFrame: (id) => { frames[id - 1] = null; },
  });
  throttle.schedule(20);
  throttle.schedule(30);
  throttle.schedule(40);
  assert.equal(frames.length, 1, 'one frame requested for several moves');
  frames[0]();
  assert.deepEqual(applied, [40]);

  throttle.schedule(50);
  throttle.flush();
  assert.deepEqual(applied, [40, 50], 'flush applies the pending value immediately');
  assert.equal(frames[1], null, 'flush cancels the queued frame');
  throttle.flush();
  assert.deepEqual(applied, [40, 50], 'nothing pending, nothing applied');

  throttle.schedule(60);
  throttle.cancel();
  throttle.flush();
  assert.deepEqual(applied, [40, 50]);
});

test('the divider drag writes pane heights through refs and commits splitRatio on release only', () => {
  const start = APP.indexOf('const beginSplitDrag = (subscribe) => {');
  const end = APP.indexOf('const handleSplitMouseDown', start);
  assert.ok(start > 0 && end > start);
  const body = APP.slice(start, end);
  const moveStart = body.indexOf('const onMove = (clientY) => {');
  const moveBody = body.slice(moveStart, body.indexOf('};', moveStart));
  assert.ok(!moveBody.includes('setSplitRatio'), 'no React state update per move');
  assert.match(moveBody, /throttle\.schedule\(ratio\)/);
  assert.match(body, /mapPaneRef\.current\.style\.height = `\$\{ratio\}%`/);
  assert.match(body, /timelinePaneRef\.current\.style\.height = getTimelinePaneHeight\(ratio, narrow\)/);
  assert.match(body, /throttle\.flush\(\);\s*setIsDraggingSplit\(false\);\s*if \(lastRatio != null\) setSplitRatio\(lastRatio\);/);
  assert.match(APP, /ref=\{mapPaneRef\}/);
  assert.match(APP, /ref=\{timelinePaneRef\}/);
  // Touch and mouse both still drive the same drag; double-click still resets.
  assert.match(APP, /onMouseDown=\{handleSplitMouseDown\}/);
  assert.match(APP, /onTouchStart=\{handleSplitTouchStart\}/);
  assert.match(APP, /window\.addEventListener\('touchmove', onTouchMove, \{ passive: true \}\)/);
  assert.match(APP, /onDoubleClick=\{\(\) => \{\s*setSplitRatio\(DEFAULT_SPLIT_RATIO\);/);
});

// ---------------------------------------------------------------- P-24

test('the entry requests the locale and the app chunk in parallel and renders after both', () => {
  assert.ok(!/import App from/.test(MAIN), 'App must not be in the entry chunk');
  assert.ok(!/from 'react-dom\/client'/.test(MAIN), 'React must not be in the entry chunk');
  const localeIdx = MAIN.indexOf('const localeReady = ensureLanguageLoaded(initialLanguage);');
  assert.match(MAIN, /document\.documentElement\.dir = initialLanguage === 'he' \? 'rtl' : 'ltr';/);
  const appIdx = MAIN.indexOf("const appReady = import('./bootApp.jsx');");
  const renderIdx = MAIN.indexOf('Promise.all([appReady, localeReady');
  assert.ok(localeIdx > 0 && appIdx > 0 && renderIdx > appIdx && renderIdx > localeIdx);
  assert.match(MAIN, /import '\.\/index\.css';/);
  assert.match(MAIN, /installVitePreloadErrorHandler\(\);/);
  assert.match(BOOT, /export function renderApp\(rootElement\)/);
  assert.match(BOOT, /<LanguageProvider>/);
});

test('Google Fonts no longer block rendering and unused families are gone', () => {
  const links = INDEX_HTML.match(/<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || [];
  assert.equal(links.length, 2);
  const [preload, sheet] = links;
  assert.match(preload, /rel="preload"/);
  assert.match(preload, /as="style"/);
  assert.match(sheet, /id="chronix-webfonts"/);
  assert.match(sheet, /rel="stylesheet"/);
  assert.match(sheet, /media="print"/);
  assert.equal(preload.match(/href="([^"]+)"/)[1], sheet.match(/href="([^"]+)"/)[1]);
  assert.ok(!/\son[a-z]+=/i.test(INDEX_HTML), 'no inline event handlers (CSP)');
  assert.ok(INDEX_HTML.indexOf('id="chronix-webfonts"') < INDEX_HTML.indexOf('<script src="/theme-init.js"'));

  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
});

function runThemeInit(link) {
  const listeners = {};
  if (link) link.addEventListener = (type, fn) => { listeners[type] = fn; };
  const context = {
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null },
    document: {
      documentElement: { classList: { add() {}, remove() {} } },
      getElementById: (id) => (id === 'chronix-webfonts' ? link : null),
    },
  };
  vm.runInNewContext(THEME_INIT, context);
  return listeners;
}

test('theme-init.js applies the font stylesheet once it has loaded', () => {
  const pending = { media: 'print', sheet: null };
  const listeners = runThemeInit(pending);
  assert.equal(pending.media, 'print', 'not applied before load');
  listeners.load();
  assert.equal(pending.media, 'all');

  const cached = { media: 'print', sheet: {} };
  runThemeInit(cached);
  assert.equal(cached.media, 'all', 'already-loaded sheet is applied immediately');

  assert.doesNotThrow(() => runThemeInit(null));
});
