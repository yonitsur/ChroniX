// Pure layout planner for the mobile vertical-timeline feed.
//
// Turns a chronologically sorted article list into a flat list of render items:
//   { type: 'header', key, header }   – a section (time band or auto year/decade/century bucket)
//   { type: 'gap', key, span, direction } – a marker for an unusually long silence between events
//   { type: 'event', key, article }
// Rendering, i18n and date formatting stay in the component.

import { compareDateParts } from '../../utils/dateTime.js';

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// Fractional year of a date part (month/day refine the year when present).
export function toFractionalYear(d) {
  if (!d || typeof d !== 'object') return null;
  const year = num(d.year, null);
  if (year === null) return null;
  const month = num(d.month, 1);
  const day = num(d.day, 1);
  return year + (month - 1) / 12 + (day - 1) / 365.25;
}

function normalizeBandDate(band, key) {
  const value = band?.[key];
  if (value && typeof value === 'object' && typeof value.year === 'number') return value;
  const legacy = band?.[`${key}_year`];
  return typeof legacy === 'number' ? { year: legacy } : null;
}

// Fills the unspecified parts of an end date with their latest value so "to: 1945" covers all of 1945.
function endOfDatePart(d) {
  if (!d) return d;
  return {
    year: d.year,
    month: num(d.month, 12),
    day: num(d.day, 31),
    hour: num(d.hour, 23),
    minute: num(d.minute, 59),
  };
}

function normalizeBands(timeBands) {
  if (!Array.isArray(timeBands)) return [];
  return timeBands
    .map((band, index) => {
      const from = normalizeBandDate(band, 'from');
      if (!from) return null;
      const to = normalizeBandDate(band, 'to') || from;
      const fromYear = toFractionalYear(from);
      const toYear = toFractionalYear(endOfDatePart(to));
      return {
        id: band.id ?? `band-${index}`,
        title: band.title || '',
        color: band.color || null,
        from,
        to,
        end: endOfDatePart(to),
        width: Math.max(0, toYear - fromYear),
      };
    })
    .filter(Boolean);
}

// The narrowest band containing the date; ties go to the band that starts latest.
export function findBandForDate(date, bands) {
  let best = null;
  for (const band of bands) {
    if (compareDateParts(date, band.from) < 0 || compareDateParts(date, band.end) > 0) continue;
    if (
      !best
      || band.width < best.width
      || (band.width === best.width && compareDateParts(band.from, best.from) > 0)
    ) {
      best = band;
    }
  }
  return best;
}

// Granularity for automatic sections, chosen from the total span of the timeline.
export function pickBucketUnit(spanYears) {
  if (!(spanYears > 0)) return 'year';
  if (spanYears <= 30) return 'year';
  if (spanYears <= 300) return 'decade';
  if (spanYears <= 3000) return 'century';
  if (spanYears <= 30000) return 'millennium';
  return 'megaannum';
}

const BUCKET_SIZE = { year: 1, decade: 10, century: 100, millennium: 1000, megaannum: 1e6 };

export function bucketForYear(year, unit) {
  const size = BUCKET_SIZE[unit] || 1;
  const start = Math.floor(year / size) * size;
  return { start, end: start + size - 1 };
}

// Converts a duration in years into the coarsest readable unit: { unit, n }.
export function describeSpan(years) {
  const y = Math.abs(years);
  if (y >= 1e6) return { unit: 'megaannum', n: Math.round((y / 1e6) * 10) / 10 };
  if (y >= 1) return { unit: 'year', n: Math.round(y) };
  const months = y * 12;
  if (months >= 1) return { unit: 'month', n: Math.round(months) };
  return { unit: 'day', n: Math.max(1, Math.round(y * 365.25)) };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const GAP_MEDIAN_FACTOR = 3;
const GAP_SPAN_FRACTION = 1 / 40;
const GAP_MIN_EVENTS = 4;

/**
 * Builds feed items from articles that are already in display order.
 * @param {Array} articles - sorted (ascending or descending, see options.descending)
 * @param {Array} timeBands - timeline time bands (optional)
 * @param {{descending?: boolean}} options
 */
export function buildFeedItems(articles, timeBands, { descending = false } = {}) {
  const list = Array.isArray(articles) ? articles.filter(Boolean) : [];
  if (!list.length) return [];

  const bands = normalizeBands(timeBands);
  const years = list.map((a) => toFractionalYear(a.from));
  const knownYears = years.filter((y) => y !== null);
  const minYear = knownYears.length ? Math.min(...knownYears) : 0;
  const maxYear = knownYears.length ? Math.max(...knownYears) : 0;
  const totalSpan = maxYear - minYear;
  const unit = pickBucketUnit(totalSpan);

  const gaps = [];
  for (let i = 1; i < list.length; i += 1) {
    if (years[i] !== null && years[i - 1] !== null) gaps.push(Math.abs(years[i] - years[i - 1]));
  }
  const gapThreshold = list.length >= GAP_MIN_EVENTS
    ? Math.max(median(gaps) * GAP_MEDIAN_FACTOR, totalSpan * GAP_SPAN_FRACTION)
    : Infinity;

  const items = [];
  let prevHeaderKey = null;
  let prevYear = null;

  list.forEach((article, index) => {
    const year = years[index];

    if (prevYear !== null && year !== null && totalSpan > 0) {
      const gap = Math.abs(year - prevYear);
      if (gap > 0 && gap >= gapThreshold) {
        items.push({
          type: 'gap',
          key: `gap-${article.id ?? index}`,
          span: describeSpan(gap),
          direction: descending ? 'earlier' : 'later',
        });
      }
    }

    const band = article.from ? findBandForDate(article.from, bands) : null;
    let header = null;
    if (band) {
      header = { kind: 'band', key: `band:${band.id}`, title: band.title, color: band.color, from: band.from, to: band.to };
    } else if (year !== null) {
      const { start, end } = bucketForYear(Math.floor(year), unit);
      header = { kind: 'bucket', key: `bucket:${unit}:${start}`, unit, start, end };
    }

    if (header && header.key !== prevHeaderKey) {
      items.push({ type: 'header', key: `h-${header.key}-${index}`, header });
      prevHeaderKey = header.key;
    }

    items.push({ type: 'event', key: `e-${article.id ?? index}`, article });
    if (year !== null) prevYear = year;
  });

  return items;
}
