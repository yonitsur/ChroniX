import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_DETAIL_FIELDS,
  canvasDateKey,
  computeCanvasStructureKey,
  diffCanvasArticle,
} from '../src/components/timeline/canvasArticleSync.js';

const base = () => ({
  id: 'tl-1',
  timeScale: 'calendar',
  lanes: [{ id: 'a', title: 'Lane A' }, { id: 'b', title: 'Lane B' }],
  timeBands: [{ id: 'tb', title: 'Era', from: { year: 1900 }, to: { year: 1950 }, color: '#f00' }],
  articles: [
    { id: 'e1', title: 'One', subtitle: 'first', lane: 'a', category: 'Science', from: { year: 1901 }, rank: 5 },
    { id: 'e2', title: 'Two', subtitle: 'second', lane: 'b', category: 'Art', from: { year: 1920 }, rank: 7 },
  ],
});

test('structure key ignores in-place edits (text, dates, rank, category, order, images)', () => {
  const before = computeCanvasStructureKey(base());
  const edited = base();
  edited.articles[0] = {
    ...edited.articles[0],
    title: 'Renamed',
    subtitle: 'new description',
    from: { year: 1905, month: 3 },
    rank: 9,
    category: 'Politics',
    imageUrl: 'data:image/png;base64,AAAA',
    extract: 'changed',
  };
  edited.articles.reverse();
  assert.equal(computeCanvasStructureKey(edited), before);
});

test('structure key changes for add, remove, lane moves, lanes, bands, timeline and scale', () => {
  const before = computeCanvasStructureKey(base());
  const variants = {
    add: (d) => d.articles.push({ id: 'e3', title: 'Three', lane: 'a', from: { year: 1930 } }),
    remove: (d) => d.articles.pop(),
    laneMove: (d) => { d.articles[0].lane = 'b'; },
    laneRename: (d) => { d.lanes[0].title = 'Renamed lane'; },
    laneAdd: (d) => d.lanes.push({ id: 'c', title: 'Lane C' }),
    band: (d) => { d.timeBands[0].to = { year: 1960 }; },
    bandColor: (d) => { d.timeBands[0].color = '#0f0'; },
    timeline: (d) => { d.id = 'tl-2'; },
    scale: (d) => { d.timeScale = 'geologic'; },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const data = base();
    mutate(data);
    assert.notEqual(computeCanvasStructureKey(data), before, name);
  }
  assert.equal(computeCanvasStructureKey(null), '');
});

const liveArticle = (overrides = {}) => ({
  title: 'One',
  subtitle: 'first',
  rank: 5,
  data: {
    title: 'One',
    subtitle: 'first',
    from: { year: 1901, precision: 'year' },
    category: 'Science',
    richTitle: 'One',
    richSubtitle: 'first',
    isAnchor: false,
    _chronixOrder: 0,
  },
  ...overrides,
});
const formatted = (overrides = {}) => ({
  title: 'One',
  subtitle: 'first',
  rank: 5,
  from: { year: 1901, precision: 'year' },
  to: undefined,
  isToPresent: false,
  category: 'Science',
  richTitle: 'One',
  richSubtitle: 'first',
  isAnchor: false,
  _chronixOrder: 0,
  ...overrides,
});

test('diffCanvasArticle returns null when nothing the canvas uses changed', () => {
  assert.equal(diffCanvasArticle(liveArticle(), formatted({ imageUrl: 'x', additionalImages: [1] })), null);
});

test('diffCanvasArticle reports text, rank and date edits as layout changes', () => {
  const edit = diffCanvasArticle(liveArticle(), formatted({ title: 'Renamed', subtitle: 'desc', rank: 8, richTitle: 'Renamed' }));
  assert.deepEqual(edit.options, { title: 'Renamed', subtitle: 'desc', rank: 8 });
  assert.equal(edit.affectsLayout, true);
  assert.equal(edit.details.richTitle, 'Renamed');

  const dated = diffCanvasArticle(liveArticle(), formatted({ from: { year: 1902, precision: 'year' } }));
  assert.equal(dated.datesChanged, true);
  assert.equal(dated.affectsLayout, true);
  assert.deepEqual(dated.options, {});

  const endAdded = diffCanvasArticle(liveArticle(), formatted({ to: { year: 1910, precision: 'year' } }));
  assert.equal(endAdded.datesChanged, true);
  const ongoing = diffCanvasArticle(liveArticle(), formatted({ isToPresent: true }));
  assert.equal(ongoing.datesChanged, true);
});

test('diffCanvasArticle flags category changes and detail-only edits without relayout', () => {
  const cat = diffCanvasArticle(liveArticle(), formatted({ category: 'Art' }));
  assert.equal(cat.categoryChanged, true);
  assert.equal(cat.affectsLayout, false);

  const details = diffCanvasArticle(liveArticle(), formatted({ locationName: 'Paris', isEdited: true }));
  assert.equal(details.affectsLayout, false);
  assert.deepEqual(details.details, { locationName: 'Paris', isEdited: true });

  // Localized category objects compare by value.
  const localized = liveArticle();
  localized.data.category = { en: 'Science', he: 'מדע' };
  assert.equal(diffCanvasArticle(localized, formatted({ category: { en: 'Science', he: 'מדע' } })), null);
});

test('canvasDateKey is insensitive to key order and undefined fields', () => {
  assert.equal(canvasDateKey({ year: 1900, month: 2, precision: 'month' }), canvasDateKey({ precision: 'month', month: 2, year: 1900, day: undefined }));
  assert.notEqual(canvasDateKey({ year: 1900 }), canvasDateKey({ year: 1901 }));
  assert.equal(canvasDateKey(undefined), '');
  assert.ok(CANVAS_DETAIL_FIELDS.includes('richSubtitle'));
  assert.ok(!CANVAS_DETAIL_FIELDS.includes('imageUrl'), 'images go through setArticleImage');
});
