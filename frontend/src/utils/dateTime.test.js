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
  normalizeDatePrecision,
  pickTimeFields,
  spreadPrehistoricClusterDates,
  toHistropediaDate,
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

test('normalizeDatePrecision aligns precision with supplied components', () => {
  // Day + month with coarse "year" precision upgrades to "day"
  assert.deepEqual(
    normalizeDatePrecision({ year: 1967, month: 6, day: 5, precision: 'year' }),
    { year: 1967, month: 6, day: 5, precision: 'day' }
  );
  // Month only with "year" precision upgrades to "month"
  assert.deepEqual(
    normalizeDatePrecision({ year: 1967, month: 5, precision: 'year' }),
    { year: 1967, month: 5, precision: 'month' }
  );
  // Calendar year-only with "century" or "decade" normalizes to "year"
  assert.deepEqual(
    normalizeDatePrecision({ year: 1000, precision: 'century' }),
    { year: 1000, precision: 'year' }
  );
  assert.deepEqual(
    normalizeDatePrecision({ year: 990, precision: 'decade' }),
    { year: 990, precision: 'year' }
  );
  // Prehistoric deep-time year with "year" or "billion-years" normalizes to "million-years"
  assert.deepEqual(
    normalizeDatePrecision({ year: -66000000, precision: 'year' }),
    { year: -66000000, precision: 'million-years' }
  );
  assert.deepEqual(
    normalizeDatePrecision({ year: -4500000000, precision: 'billion-years' }),
    { year: -4500000000, precision: 'million-years' }
  );
  // HistropediaJS canvas date uses 'year' precision for year-level/prehistoric dates so negative years never bucket-shift
  assert.deepEqual(
    toHistropediaDate({ year: -13000000000, precision: 'billion-years' }),
    { year: -13000000000, precision: 'year' }
  );
  assert.deepEqual(
    toHistropediaDate({ year: 1967, month: 6, day: 5, precision: 'year' }),
    { year: 1967, month: 6, day: 5, precision: 'day' }
  );
});

test('spreadPrehistoricClusterDates spreads tight early-universe clusters monotonically before next event', () => {
  const articles = [
    { id: '1', from: { year: -13800000000, precision: 'year' } },
    { id: '2', from: { year: -13800000000, precision: 'year' } },
    { id: '3', from: { year: -13800000000, precision: 'year' } },
    { id: '4', from: { year: -13799620000, precision: 'year' } },
    { id: '5', from: { year: -13799620000, precision: 'year' }, to: { year: -13600000000, precision: 'year' } },
    { id: '6', from: { year: -13600000000, precision: 'year' } },
    { id: '30', from: { year: 1965, precision: 'year' } },
  ];
  const spread = spreadPrehistoricClusterDates(articles);
  for (let i = 1; i < spread.length; i++) {
    assert.ok(spread[i].from.year > spread[i - 1].from.year, `Expected event ${i + 1} (${spread[i].from.year}) > event ${i} (${spread[i - 1].from.year})`);
  }
  assert.equal(spread[0].from.year, -13800000000);
  assert.equal(spread[5].from.year, -13600000000);
});
