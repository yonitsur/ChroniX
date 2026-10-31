import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareEventDates,
  getTimelineAnchorArticleIds,
  isRtlText,
  isSameArticleId,
} from './timelineArticles.js';

test('article ids compare consistently across strings and numbers', () => {
  assert.equal(isSameArticleId(42, '42'), true);
  assert.equal(isSameArticleId(null, undefined), false);
  assert.equal(isSameArticleId('42', '043'), false);
});

test('date comparison handles BCE dates and missing month/day values', () => {
  assert.ok(compareEventDates({ from: { year: -431 } }, { from: { year: -404 } }) < 0);
  assert.ok(compareEventDates({ from: { year: 1969, month: 7 } }, { from: { year: 1969, month: 8 } }) < 0);
});

test('timeline anchors include global and per-lane chronological boundaries', () => {
  const anchors = getTimelineAnchorArticleIds([
    { id: 'a', lane: 'one', from: { year: 1900 } },
    { id: 'b', lane: 'one', from: { year: 1950 } },
    { id: 'c', lane: 'two', from: { year: 1920 }, to: { year: 1980 } },
    { id: 'd', lane: 'two', from: { year: 1930 } },
  ]);

  assert.deepEqual([...anchors].sort(), ['a', 'b', 'c']);
});

test('RTL detection recognizes Hebrew and Arabic text', () => {
  assert.equal(isRtlText('ChroniX'), false);
  assert.equal(isRtlText('ציר זמן'), true);
  assert.equal(isRtlText('خط زمني'), true);
});
