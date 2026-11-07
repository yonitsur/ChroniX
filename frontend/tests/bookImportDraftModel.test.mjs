import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyOps, OpError, groupedEvents, filterCounts, finalizeSummary, trayPhotos, formatDraftDate, matchesSearch,
} from '../src/utils/bookImport/draftModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'backend', 'tests', 'fixtures', 'book_import', 'draft_ops_vectors.json'), 'utf8'));

// Python's json and JS objects order keys differently only cosmetically; compare structurally.
for (const c of VECTORS.cases) {
  test(`draft op vector: ${c.name}`, () => {
    if (c.error) {
      assert.throws(() => applyOps(VECTORS.draft, c.ops), OpError);
      return;
    }
    assert.deepEqual(applyOps(VECTORS.draft, c.ops), c.expected);
  });
}

test('applyOps never mutates its input', () => {
  const before = JSON.stringify(VECTORS.draft);
  applyOps(VECTORS.draft, [{ op: 'event.setStatus', ids: ['bk-0001'], status: 'rejected' }]);
  assert.equal(JSON.stringify(VECTORS.draft), before);
});

test('grouping, filters, search and summary', () => {
  const d = VECTORS.draft;
  const groups = groupedEvents(d);
  assert.deepEqual(groups.map((g) => g.chapter.id), ['ch1', 'ch2']);
  assert.equal(groupedEvents(d, { filter: 'undated' })[0].events[0].id, 'bk-0003');
  assert.equal(groupedEvents(d, { laneId: 'dad' }).length, 1);
  const counts = filterCounts(d);
  assert.equal(counts.all, 3);
  assert.equal(counts.duplicates, 2);
  assert.equal(counts.undated, 1);
  assert.equal(trayPhotos(d).length, 2);
  const sum = finalizeSummary(d);
  assert.deepEqual(sum, { events: 2, flagged: 2, undatedSkipped: 1, photos: 2, trayLeft: 2 });
  const castById = { p1: { name: 'Judy' } };
  assert.ok(matchesSearch(d.events[0], 'judy', castById));
  assert.ok(!matchesSearch(d.events[0], 'kugel', castById));
});

test('search ignores Hebrew niqqud', () => {
  const e = { title: 'מִזְמוֹר לְתוֹדָה', people: [] };
  assert.ok(matchesSearch(e, 'מזמור', {}));
});

test('formatDraftDate', () => {
  assert.equal(formatDraftDate({ year: 1944, month: 7, day: 26, precision: 'day' }), '26.07.1944');
  assert.equal(formatDraftDate({ year: 1944, month: 7, precision: 'month' }), '07.1944');
  assert.equal(formatDraftDate({ year: 1950, precision: 'decade' }), '1950s');
  assert.equal(formatDraftDate(null), '');
});

test('a 300-event draft filters fast', () => {
  const big = { ...VECTORS.draft, events: [] };
  for (let i = 0; i < 300; i += 1) {
    big.events.push({ id: `bk-${i}`, title: `Event ${i}`, status: 'accepted', chapterId: i % 2 ? 'ch1' : 'ch2', flags: i % 3 ? [] : ['date_inferred'], needsReview: !(i % 3), from: { year: 1900 + i, precision: 'year' }, people: ['p1'] });
  }
  const t0 = performance.now();
  for (let k = 0; k < 10; k += 1) groupedEvents(big, { filter: 'needsReview', query: 'event 1' });
  assert.ok((performance.now() - t0) / 10 < 20);
});
