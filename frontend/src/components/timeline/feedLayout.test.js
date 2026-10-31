import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeedItems,
  describeSpan,
  pickBucketUnit,
  bucketForYear,
  findBandForDate,
  toFractionalYear,
} from './feedLayout.js';

const art = (id, year, month, day) => ({ id, from: { year, month, day } });
const types = (items) => items.map((i) => i.type[0]).join('');

test('toFractionalYear refines by month/day and handles BCE', () => {
  assert.equal(toFractionalYear({ year: 1945 }), 1945);
  assert.ok(Math.abs(toFractionalYear({ year: 1945, month: 7 }) - 1945.5) < 1e-9);
  assert.equal(toFractionalYear({ year: -500 }), -500);
  assert.equal(toFractionalYear(null), null);
});

test('pickBucketUnit scales with total span', () => {
  assert.equal(pickBucketUnit(6), 'year');
  assert.equal(pickBucketUnit(120), 'decade');
  assert.equal(pickBucketUnit(2000), 'century');
  assert.equal(pickBucketUnit(10000), 'millennium');
  assert.equal(pickBucketUnit(4e9), 'megaannum');
});

test('bucketForYear floors negative years correctly', () => {
  assert.deepEqual(bucketForYear(1945, 'decade'), { start: 1940, end: 1949 });
  assert.deepEqual(bucketForYear(-45, 'century'), { start: -100, end: -1 });
  assert.deepEqual(bucketForYear(-66000000, 'megaannum'), { start: -66000000, end: -65000001 });
});

test('describeSpan picks a readable unit', () => {
  assert.deepEqual(describeSpan(3 / 365.25), { unit: 'day', n: 3 });
  assert.deepEqual(describeSpan(0.5), { unit: 'month', n: 6 });
  assert.deepEqual(describeSpan(12.4), { unit: 'year', n: 12 });
  assert.deepEqual(describeSpan(-2.6e6), { unit: 'megaannum', n: 2.6 });
});

test('auto buckets emit a header when the year changes', () => {
  const items = buildFeedItems([art(1, 1939, 9, 1), art(2, 1939, 12, 1), art(3, 1940, 5, 10), art(4, 1941, 6, 22)], []);
  const headers = items.filter((i) => i.type === 'header').map((i) => i.header.start);
  assert.deepEqual(headers, [1939, 1940, 1941]);
  assert.equal(items.filter((i) => i.type === 'event').length, 4);
});

test('narrowest containing time band wins; uncovered events fall back to buckets', () => {
  const bands = [
    { id: 'war', title: 'War', from: { year: 1939 }, to: { year: 1945 } },
    { id: 'blitz', title: 'Blitzkrieg', from: { year: 1939, month: 9 }, to: { year: 1940, month: 6 } },
  ];
  assert.equal(findBandForDate({ year: 1940, month: 5 }, bands.map((b) => ({
    ...b, end: { year: b.to.year, month: b.to.month ?? 12, day: 31, hour: 23, minute: 59 },
    width: (b.to.year + ((b.to.month ?? 12) - 1) / 12) - (b.from.year + ((b.from.month ?? 1) - 1) / 12),
  }))).id, 'blitz');

  const items = buildFeedItems([art(1, 1939, 9, 1), art(2, 1942, 1, 1), art(3, 1950, 6, 25)], bands);
  const headers = items.filter((i) => i.type === 'header').map((i) => i.header.title || i.header.kind);
  assert.deepEqual(headers, ['Blitzkrieg', 'War', 'bucket']);
});

test('band end year is inclusive and legacy from_year/to_year work', () => {
  const items = buildFeedItems([art(1, 1945, 12, 31)], [{ id: 'b', title: 'B', from_year: 1939, to_year: 1945 }]);
  assert.equal(items[0].header.title, 'B');
});

test('a long silence produces a gap marker before the next section', () => {
  const list = [art(1, 1900, 1, 1), art(2, 1901, 1, 1), art(3, 1902, 1, 1), art(4, 1903, 1, 1), art(5, 1950, 1, 1)];
  const items = buildFeedItems(list, []);
  const gapIndex = items.findIndex((i) => i.type === 'gap');
  assert.ok(gapIndex > 0);
  assert.equal(items[gapIndex].direction, 'later');
  assert.deepEqual(items[gapIndex].span, { unit: 'year', n: 47 });
  assert.equal(items[gapIndex + 1].type, 'header');
});

test('evenly spaced events produce no gaps', () => {
  const list = Array.from({ length: 10 }, (_, i) => art(i, 1900 + i * 5, 1, 1));
  assert.equal(buildFeedItems(list, []).some((i) => i.type === 'gap'), false);
});

test('descending order labels gaps as earlier', () => {
  const list = [art(5, 1950, 1, 1), art(4, 1903, 1, 1), art(3, 1902, 1, 1), art(2, 1901, 1, 1), art(1, 1900, 1, 1)];
  const items = buildFeedItems(list, [], { descending: true });
  const gap = items.find((i) => i.type === 'gap');
  assert.equal(gap.direction, 'earlier');
  assert.equal(types(items).startsWith('he'), true);
});

test('empty and dateless inputs are safe', () => {
  assert.deepEqual(buildFeedItems([], []), []);
  assert.equal(types(buildFeedItems([{ id: 1 }, { id: 2 }], [])), 'ee');
});
