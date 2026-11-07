// Batch 6B (P-17 / P-24, GeoMapView): markers are built only when pin-shaping inputs change,
// selection/hover restyle single pins, tooltip thumbnails are injected (never inlined as data:
// URLs) and KaTeX is lazy-loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPinStateClasses,
  buildPinIconHtml,
  createLazyModuleLoader,
  ensurePinTooltipImage,
  escapeHtml,
  getCollapsibleStackKeyById,
  getEffectiveStarredIds,
  getMarkerBuildDeps,
  getPinStateClasses,
  hydratePopupImage,
  renderInlineRichText,
  shouldRebuildMarkers,
  textsNeedKatex,
} from '../src/components/geoMap/geoMapMarkers.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO_MAP_SOURCE = fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'components', 'GeoMapView.jsx'), 'utf8');

const BIG_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(80 * 1024)}`;

// --- minimal DOM stand-ins -------------------------------------------------------------------
class FakeClassList {
  constructor(initial = '') { this.set = new Set(initial.split(/\s+/).filter(Boolean)); }
  add(...t) { t.forEach((x) => this.set.add(x)); }
  remove(...t) { t.forEach((x) => this.set.delete(x)); }
  contains(t) { return this.set.has(t); }
  toggle(t, force) { const on = force ?? !this.set.has(t); if (on) this.set.add(t); else this.set.delete(t); return on; }
}
class FakeElement {
  constructor(tag, className = '', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(className);
    this.attrs = { ...attrs };
    this.children = [];
    this.style = {};
    this.ownerDocument = { createElement: (t) => new FakeElement(t) };
  }
  set className(v) { this.classList = new FakeClassList(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k === 'src' ? (this.src ?? this.attrs.src ?? null) : (this.attrs[k] ?? null); }
  get firstChild() { return this.children[0] ?? null; }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const m = selector.match(/^(\w+)?\[([\w-]+)\]$/);
    if (m) return (!m[1] || this.tagName === m[1].toUpperCase()) && m[2] in this.attrs;
    return false;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function makePinDom() {
  const leafletIcon = new FakeElement('div', 'chronix-custom-pin');
  const root = new FakeElement('div', 'group z-10', { 'data-pin-article-id': 'a1' });
  const pin = new FakeElement('div', 'chronix-map-pin group-hover:scale-115');
  const circle = new FakeElement('div', 'chronix-pin-circle border-surface-raised');
  const tip = new FakeElement('div', 'chronix-pin-tip border-surface-raised');
  const tooltip = new FakeElement('div', 'chronix-pin-hover-tooltip hidden group-hover:flex');
  tooltip.children.push(new FakeElement('span', 'flex flex-col'));
  pin.children.push(circle, tip);
  root.children.push(pin, tooltip);
  leafletIcon.children.push(root);
  return { leafletIcon, root, pin, circle, tip, tooltip };
}

const baseDepsInput = () => ({
  filteredGeoArticles: [{ id: 'a1', lat: 1, lng: 2 }],
  categories: ['war'],
  selectedStackKey: null,
  expandedStackKey: null,
  isMobile: false,
  isRtl: false,
  language: 'en',
  isDark: false,
  isToy: false,
  hasNavigation: true,
  visibleEventCount: 1,
});

// --- rebuild decision ------------------------------------------------------------------------
test('selection changes do not rebuild markers unless they open a collapsed stack', () => {
  const input = baseDepsInput();
  const before = getMarkerBuildDeps(input);
  // A new selection is not an input at all; only the stack it falls into is.
  assert.equal(shouldRebuildMarkers(before, getMarkerBuildDeps({ ...input })), false);
  assert.equal(shouldRebuildMarkers(before, getMarkerBuildDeps({ ...input, selectedStackKey: 'stack-1' })), true);
});

test('pin-shaping inputs (articles, theme, layout, language) do rebuild markers', () => {
  const input = baseDepsInput();
  const before = getMarkerBuildDeps(input);
  for (const patch of [
    { filteredGeoArticles: [...input.filteredGeoArticles] },
    { isDark: true },
    { isToy: true },
    { isMobile: true },
    { isRtl: true },
    { language: 'he' },
    { expandedStackKey: 'k' },
    { visibleEventCount: 2 },
    { categories: ['war', 'peace'] },
  ]) {
    assert.equal(shouldRebuildMarkers(before, getMarkerBuildDeps({ ...input, ...patch })), true, JSON.stringify(Object.keys(patch)));
  }
  assert.equal(shouldRebuildMarkers(null, before), true);
});

test('starred ids only matter while the starred-only filter is on', () => {
  const setA = new Set(['a1']);
  const setB = new Set(['a1', 'a2']); // App hands a fresh Set on every star toggle
  assert.equal(getEffectiveStarredIds(false, setA), null);
  assert.equal(getEffectiveStarredIds(false, setA), getEffectiveStarredIds(false, setB));
  assert.equal(getEffectiveStarredIds(true, setB), setB);
  assert.equal(getEffectiveStarredIds(true, null), null);
});

test('GeoMapView keys the marker build on getMarkerBuildDeps and filters with effective starred ids', () => {
  const buildEffectDeps = GEO_MAP_SOURCE.match(/\}, getMarkerBuildDeps\(\{([\s\S]*?)\}\)\);/);
  assert.ok(buildEffectDeps, 'marker build effect should use getMarkerBuildDeps');
  assert.ok(!/selectedArticleId|starredArticleIds|filterStarredOnly/.test(buildEffectDeps[1]));
  assert.ok(GEO_MAP_SOURCE.includes('[geoArticles, activeFilter, effectiveStarredIds]'));
  assert.ok(!/\[geoArticles, activeFilter, filterStarredOnly, starredArticleIds\]/.test(GEO_MAP_SOURCE));
});

test('collapsible stack lookup only indexes stacks above the ring size', () => {
  const groups = [
    { key: 's1', members: [{ id: 1 }, { id: 2 }] },
    { key: 's2', members: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}` })) },
  ];
  const map = getCollapsibleStackKeyById(groups, 6);
  assert.equal(map.get('1'), undefined);
  assert.equal(map.get('b3'), 's2');
});

// --- pin HTML --------------------------------------------------------------------------------
test('pin icon HTML never contains data: URLs and escapes every text field', () => {
  const html = buildPinIconHtml({
    articleId: 'x"><img src=x onerror=alert(1)>',
    title: '<script>alert(1)</script> $E=mc^2$',
    yearStr: '1900 <b>',
    locationName: 'Paris & "Lyon"',
    eventNumber: 3,
    laneColor: '#123456',
    titleDir: 'rtl',
    isSelected: false,
    isHovered: false,
    showTooltip: true,
    imageUrl: BIG_DATA_URL, // ignored on purpose: the thumbnail is injected later
  });
  assert.ok(!html.includes('data:'), 'no data: URL in pin HTML');
  assert.ok(!html.includes('<img'), 'thumbnail is not inlined');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('E=mc²'), 'math is shown as plain text in the bubble');
  assert.ok(html.includes('1900 &lt;b&gt;'));
  assert.ok(html.includes('Paris &amp; &quot;Lyon&quot;'));
  assert.ok(html.includes('data-pin-article-id="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(html.length < 4000, `pin HTML stays small (${html.length})`);
});

test('pin icon HTML omits the bubble on mobile and the tip for fanned-out pins', () => {
  const mobile = buildPinIconHtml({ articleId: 'a', title: 'T', eventNumber: 1, laneColor: '#000', showTooltip: false });
  assert.ok(!mobile.includes('chronix-pin-hover-tooltip'));
  assert.ok(mobile.includes('chronix-pin-tip'));
  const spread = buildPinIconHtml({ articleId: 'a', title: 'T', eventNumber: 1, laneColor: '#000', spreadSlot: { x: 10, y: -5 }, animateSpread: true });
  assert.ok(!spread.includes('chronix-pin-tip'));
  assert.ok(spread.includes('--spread-from-x: -10.0px'));
  assert.ok(spread.includes('chronix-pin-spread-enter'));
});

test('selected/hovered classes in the HTML match the in-place toggles', () => {
  const sel = getPinStateClasses(true, true);
  assert.equal(sel.root, 'z-50');
  assert.equal(sel.tooltip, 'hidden group-hover:flex');
  const hov = getPinStateClasses(false, true);
  assert.equal(hov.tooltip, 'flex');
  const html = buildPinIconHtml({ articleId: 'a', title: 'T', eventNumber: 1, laneColor: '#000', isSelected: true });
  assert.ok(html.includes('scale-125'));
  assert.ok(html.includes('border-accent ring-4 ring-accent-ring/40'));
});

test('applyPinStateClasses swaps selection/hover classes in place', () => {
  const dom = makePinDom();
  assert.equal(applyPinStateClasses(dom.leafletIcon, true, false), true);
  assert.ok(dom.root.classList.contains('z-50') && !dom.root.classList.contains('z-10'));
  assert.ok(dom.pin.classList.contains('scale-125') && !dom.pin.classList.contains('group-hover:scale-115'));
  assert.ok(dom.circle.classList.contains('ring-accent-ring/40') && !dom.circle.classList.contains('border-surface-raised'));
  assert.ok(dom.tip.classList.contains('bg-accent'));
  assert.ok(dom.tooltip.classList.contains('chronix-pin-hover-tooltip'), 'non-state classes survive');

  applyPinStateClasses(dom.leafletIcon, false, true);
  assert.ok(dom.root.classList.contains('z-40') && !dom.root.classList.contains('z-50'));
  assert.ok(dom.circle.classList.contains('shadow-glow-accent') && !dom.circle.classList.contains('ring-accent-ring/40'));
  assert.ok(dom.tooltip.classList.contains('flex') && !dom.tooltip.classList.contains('hidden'));

  applyPinStateClasses(dom.leafletIcon, false, false);
  assert.ok(dom.root.classList.contains('z-10'));
  assert.ok(dom.pin.classList.contains('group-hover:scale-115') && !dom.pin.classList.contains('scale-130'));
  assert.ok(dom.circle.classList.contains('border-surface-raised') && !dom.circle.classList.contains('border-accent'));
  assert.ok(dom.tooltip.classList.contains('hidden') && dom.tooltip.classList.contains('group-hover:flex'));
  assert.equal(applyPinStateClasses(null, true, false), false);
});

test('tooltip thumbnail is injected once with .src set as a property', () => {
  const dom = makePinDom();
  assert.equal(ensurePinTooltipImage(dom.leafletIcon, BIG_DATA_URL, 20, 80), true);
  const img = dom.tooltip.firstChild;
  assert.equal(img.tagName, 'IMG');
  assert.equal(img.src, BIG_DATA_URL);
  assert.equal(img.style.objectPosition, '20% 80%');
  assert.equal(img.getAttribute('data-hide-on-error'), 'self');
  assert.equal(ensurePinTooltipImage(dom.leafletIcon, BIG_DATA_URL, 20, 80), false, 'idempotent');
  assert.equal(dom.tooltip.children.length, 2);
  assert.equal(ensurePinTooltipImage(dom.leafletIcon, '', 0, 0), false);
});

test('popup image src is set after open, not inlined', () => {
  const popup = new FakeElement('div');
  const img = new FakeElement('img', '', { 'data-chronix-popup-img': '' });
  popup.children.push(img);
  assert.equal(hydratePopupImage(popup, BIG_DATA_URL), true);
  assert.equal(img.src, BIG_DATA_URL);
  assert.equal(hydratePopupImage(popup, BIG_DATA_URL), false);
  assert.ok(!/<img src="\$\{escapeHtml\(getCanvasImageUrl/.test(GEO_MAP_SOURCE), 'GeoMapView no longer inlines image URLs');
  assert.ok(GEO_MAP_SOURCE.includes('<img data-chronix-popup-img'));
});

// --- KaTeX (P-24) ----------------------------------------------------------------------------
test('rich text renders math as escaped plain text until KaTeX is available', () => {
  const plain = renderInlineRichText('Energy **bold** <i> $E = mc^2$');
  assert.ok(plain.includes('<strong>bold</strong>'));
  assert.ok(plain.includes('&lt;i&gt;'));
  assert.ok(plain.includes('E = mc²'));
  assert.ok(!plain.includes('$'));

  const calls = [];
  const fakeKatex = { renderToString: (tex) => { calls.push(tex); return `<span class="katex">${tex}</span>`; } };
  const rich = renderInlineRichText('Energy $E = mc^2$', fakeKatex);
  assert.deepEqual(calls, ['E = mc^2']);
  assert.ok(rich.includes('<span class="katex">E = mc^2</span>'));

  const throwing = { renderToString: () => { throw new Error('bad'); } };
  assert.ok(renderInlineRichText('$\\alpha$', throwing).includes('α'));
  assert.equal(textsNeedKatex('plain', null, ''), false);
  assert.equal(textsNeedKatex('plain', 'with $x^2$'), true);
});

test('lazy module loader imports once, shares the promise and retries after failure', async () => {
  let calls = 0;
  const loader = createLazyModuleLoader(async () => { calls += 1; return { default: { id: 'katex' } }; });
  assert.equal(loader.get(), null);
  const [a, b] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(loader.get(), { id: 'katex' });

  let attempts = 0;
  const flaky = createLazyModuleLoader(async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return { ok: true }; });
  await assert.rejects(flaky.load());
  assert.deepEqual(await flaky.load(), { ok: true });
});

test('GeoMapView imports KaTeX lazily', () => {
  assert.ok(!/import\s+katex\s+from\s+['"]katex['"]/.test(GEO_MAP_SOURCE), 'no static katex import');
  assert.ok(/import\(['"]katex['"]\)/.test(GEO_MAP_SOURCE));
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});
