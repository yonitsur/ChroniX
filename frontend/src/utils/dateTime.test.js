import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTimeOfDay,
  compareDateParts,
  formatSpanWithTimes,
  formatTimeOfDay,
  getFinestTimePrecision,
  getZoomMinimumForTimeline,
  hasTimeOfDay,
  pickTimeFields,
} from './dateTime.js';
import { compareEventDates } from './timelineArticles.js';

const oct7 = (hour, minute, precision = 'minute') => ({ year: 2023, month: 10, day: 7, hour, minute, precision });

test('time of day requires a known day and formats as HH:MM', () => {
  assert.equal(hasTimeOfDay(oct7(6, 29)), true);
  assert.equal(hasTimeOfDay({ year: 2023, month: 10, hour: 6 }), false);
  assert.equal(formatTimeOfDay(oct7(6, 29)), '06:29');
  assert.equal(formatTimeOfDay(oct7(9, undefined, 'hour')), '09:00');
  assert.equal(appendTimeOfDay('October 7, 2023', oct7(6, 29)), 'October 7, 2023, 06:29');
  assert.equal(appendTimeOfDay('October 7, 2023', { year: 2023, month: 10, day: 7 }), 'October 7, 2023');
});

test('same-day spans collapse to a time range', () => {
  const fmt = (d) => appendTimeOfDay('Oct 7, 2023', d);
  assert.equal(formatSpanWithTimes(oct7(6, 29), oct7(13, 0), false, fmt, 'Present'), 'Oct 7, 2023, 06:29 - 13:00');
  assert.equal(formatSpanWithTimes(oct7(6, 29), oct7(6, 29), false, fmt, 'Present'), 'Oct 7, 2023, 06:29');
});

test('chronological comparison orders events within a day by time', () => {
  assert.ok(compareDateParts(oct7(6, 29), oct7(7, 0)) < 0);
  assert.ok(compareDateParts(oct7(6, 29), oct7(6, 30)) < 0);
  // A day-only date sorts at the start of its day.
  assert.ok(compareDateParts({ year: 2023, month: 10, day: 7 }, oct7(0, 1)) < 0);
  assert.ok(compareEventDates({ from: oct7(13, 0) }, { from: oct7(6, 29) }) > 0);
});

test('sub-day zoom is only unlocked for timelines that use times', () => {
  const dayOnly = { articles: [{ from: { year: 2023, month: 10, day: 7, precision: 'day' } }] };
  const hourly = { articles: [{ from: oct7(9, undefined, 'hour') }] };
  const minutely = { articles: [{ from: oct7(9, undefined, 'hour') }, { from: oct7(6, 29) }] };
  assert.equal(getFinestTimePrecision(dayOnly), null);
  assert.equal(getFinestTimePrecision(hourly), 'hour');
  assert.equal(getFinestTimePrecision(minutely), 'minute');
  assert.equal(getZoomMinimumForTimeline(dayOnly), 0);
  assert.ok(getZoomMinimumForTimeline(minutely) < getZoomMinimumForTimeline(hourly));
  assert.ok(getZoomMinimumForTimeline(hourly) < 0);
});

test('pickTimeFields copies only set time parts', () => {
  assert.deepEqual(pickTimeFields(oct7(6, 29)), { hour: 6, minute: 29 });
  assert.deepEqual(pickTimeFields(oct7(9, undefined, 'hour')), { hour: 9 });
  assert.deepEqual(pickTimeFields({ year: 2023, month: 10, day: 7 }), {});
});
