// Shared helpers for sub-day (hour / minute) dates.
//
// A date part is `{ year, month?, day?, hour?, minute?, precision }`. Times are local wall-clock
// time at the event's location (no timezone conversion), and are only meaningful on a known day.

export const SUB_DAY_PRECISIONS = ['hour', 'minute'];

// Finest Histropedia zoom each precision may reach (Timeline `zoom.minimum`). With the library's
// default zoom settings (ratio 0.8, 8px minimum unit) the hour scale begins near -18 and the minute
// scale near -36.5, where one minute is ~480px wide. Day-only timelines keep the library default (0)
// so users can't zoom into empty hours.
const ZOOM_MINIMUM_BY_PRECISION = {
  hour: -24, // ~1 hour ≈ 1800px: comfortable for hour-by-hour accounts
  minute: -40, // ~1 minute ≈ 1000px: room to separate events a minute apart
};
export const DEFAULT_ZOOM_MINIMUM = 0;

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

export function hasTimeOfDay(d) {
  return Boolean(d && typeof d === 'object' && d.day && isInt(d.hour));
}

// "06:29" for minute precision; "06:00" when only the hour is known.
export function formatTimeOfDay(d) {
  if (!hasTimeOfDay(d)) return '';
  const hh = String(d.hour).padStart(2, '0');
  const mm = String(isInt(d.minute) ? d.minute : 0).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Appends the time of day (if any) to an already formatted calendar date.
export function appendTimeOfDay(dateStr, d) {
  const time = formatTimeOfDay(d);
  if (!time) return dateStr;
  return dateStr ? `${dateStr}, ${time}` : time;
}

export function isSameCalendarDay(a, b) {
  return Boolean(a && b && a.year === b.year && a.month === b.month && a.day === b.day && a.day);
}

// Shared span formatter: collapses a same-day span to "Oct 7, 2023, 06:29 - 13:00".
export function formatSpanWithTimes(from, to, isToPresent, formatPart, presentLabel) {
  const fromStr = formatPart(from);
  if (isToPresent) {
    return fromStr ? `${fromStr} - ${presentLabel}` : presentLabel;
  }
  if (!to) return fromStr;
  if (hasTimeOfDay(from) && hasTimeOfDay(to) && isSameCalendarDay(from, to)) {
    const toTime = formatTimeOfDay(to);
    return toTime === formatTimeOfDay(from) ? fromStr : `${fromStr} - ${toTime}`;
  }
  const toStr = formatPart(to);
  if (!fromStr) return toStr;
  if (fromStr === toStr) return fromStr;
  return `${fromStr} - ${toStr}`;
}

// Chronological comparison of two date parts; missing parts sort as their earliest value.
export function compareDateParts(a = {}, b = {}) {
  const num = (v, fallback) => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback);
  const keys = [
    ['year', 0],
    ['month', 1],
    ['day', 1],
    ['hour', 0],
    ['minute', 0],
  ];
  for (const [key, fallback] of keys) {
    const diff = num(a?.[key], fallback) - num(b?.[key], fallback);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareArticlesByStart(a, b) {
  return compareDateParts(a?.from || {}, b?.from || {});
}

// 'minute' | 'hour' | null — the finest sub-day precision used by any article or time band.
export function getFinestTimePrecision(timelineData) {
  let finest = null;
  const visit = (d) => {
    if (!hasTimeOfDay(d)) return;
    if (d.precision === 'minute' || isInt(d.minute)) finest = 'minute';
    else if (!finest) finest = 'hour';
  };
  (timelineData?.articles || []).forEach((a) => { visit(a?.from); visit(a?.to); });
  (timelineData?.timeBands || []).forEach((tb) => { visit(tb?.from); visit(tb?.to); });
  return finest;
}

export function getZoomMinimumForTimeline(timelineData) {
  const finest = getFinestTimePrecision(timelineData);
  return finest ? ZOOM_MINIMUM_BY_PRECISION[finest] : DEFAULT_ZOOM_MINIMUM;
}

// Copies only the time fields that are set (keeps day-precision objects free of null keys).
export function pickTimeFields(d) {
  const out = {};
  if (hasTimeOfDay(d)) {
    out.hour = d.hour;
    if (isInt(d.minute)) out.minute = d.minute;
  }
  return out;
}
