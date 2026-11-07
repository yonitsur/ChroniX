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

// Ensures a date object's `precision` matches its supplied components (year/month/day/hour/minute),
// preventing HistropediaJS from snapping day/month events to Jan 1 when precision is 'year', or
// stretching calendar year-only events into 10/100-year bars when precision is 'decade'/'century'.
export function normalizeDatePrecision(d) {
  if (!d || typeof d !== 'object') return d;
  const year = d.year;
  const hasMonth = isInt(d.month) && d.month >= 1 && d.month <= 12;
  const hasDay = hasMonth && isInt(d.day) && d.day >= 1 && d.day <= 31;
  const rawPrec = d.precision || 'year';
  let hasHour = hasDay && isInt(d.hour) && d.hour >= 0 && d.hour <= 23;
  let hasMinute = hasHour && isInt(d.minute) && d.minute >= 0 && d.minute <= 59;
  if (!SUB_DAY_PRECISIONS.includes(rawPrec) && d.hour === 0 && !d.minute) {
    hasHour = false;
    hasMinute = false;
  }

  let precision = rawPrec;
  if (hasMinute) {
    precision = 'minute';
  } else if (hasHour) {
    precision = 'hour';
  } else if (hasDay) {
    precision = 'day';
  } else if (hasMonth) {
    precision = 'month';
  } else if (typeof year === 'number' && Math.abs(year) >= 1_000_000) {
    precision = 'million-years';
  } else if (typeof year === 'number' && Math.abs(year) >= 10_000) {
    precision = (rawPrec === 'millennium' || rawPrec === 'million-years') ? rawPrec : 'millennium';
  } else {
    precision = 'year';
  }

  const out = { ...d, precision };
  if (!hasMonth && out.day !== undefined) {
    delete out.day;
  }
  if (!hasHour) {
    delete out.hour;
    delete out.minute;
  } else if (!hasMinute) {
    delete out.minute;
  }
  return out;
}

const SUB_YEAR_PRECISIONS = new Set(['minute', 'hour', 'day', 'month']);

// Converts a ChroniX date object for the HistropediaJS canvas engine:
// HistropediaJS's `getHistoricalPeriodBounds(year, size)` snaps negative years with
// 'millennium', 'million-years', or 'billion-years' precision backwards to the start of the
// period bucket (with a `1 - year` offset that shifts -13,000,000,000 to -14,000,000,000 and
// -2,000,000,000 to -3,000,000,000) and turns point-in-time events into period bars.
// Passing 'year' for all year-only / prehistoric dates places every event at its exact `year`.
export function toHistropediaDate(d) {
  const norm = normalizeDatePrecision(d);
  if (!norm || typeof norm !== 'object') return norm;
  if (!SUB_YEAR_PRECISIONS.has(norm.precision)) {
    return { ...norm, precision: 'year' };
  }
  return norm;
}

// When a deep-time prehistoric timeline (span >= 10,000,000 years) has multiple consecutive
// events in the same lane clustered within < 0.2% of the total timeline span (e.g. 5 early-universe
// events between -13,800,000,000 and -13,799,620,000 before the next event at -13,600,000,000),
// spread their canvas `from.year` values monotonically across the available gap before the next
// event so their cards and connector arrows step cleanly from left to right on the canvas.
export function spreadPrehistoricClusterDates(articles) {
  if (!Array.isArray(articles) || articles.length < 2) return articles;
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (let i = 0; i < articles.length; i++) {
    const fy = articles[i]?.from?.year;
    const ty = articles[i]?.to?.year;
    if (typeof fy === 'number' && Number.isFinite(fy)) {
      if (fy < minYear) minYear = fy;
      if (fy > maxYear) maxYear = fy;
    }
    if (typeof ty === 'number' && Number.isFinite(ty)) {
      if (ty > maxYear) maxYear = ty;
    }
  }
  const span = maxYear - minYear;
  if (!Number.isFinite(span) || span < 10_000_000) return articles;

  const clusterThreshold = span * 0.002;
  const maxStep = Math.round(span * 0.003);
  const cloned = articles.map((a) => ({ ...a }));

  const byLane = new Map();
  for (let i = 0; i < cloned.length; i++) {
    const art = cloned[i];
    const fy = art?.from?.year;
    if (typeof fy !== 'number' || !Number.isFinite(fy)) continue;
    const laneKey = String(art.lane ?? '');
    let list = byLane.get(laneKey);
    if (!list) {
      list = [];
      byLane.set(laneKey, list);
    }
    list.push(art);
  }

  byLane.forEach((laneList) => {
    let idx = 0;
    while (idx < laneList.length) {
      const startArt = laneList[idx];
      const startYear = startArt.from.year;
      if (startYear > -1_000_000) {
        idx++;
        continue;
      }
      let endIdx = idx;
      while (endIdx + 1 < laneList.length) {
        const prevY = laneList[endIdx].from.year;
        const nextY = laneList[endIdx + 1].from.year;
        if (nextY <= -1_000_000 && nextY >= prevY && (nextY - prevY) <= clusterThreshold) {
          endIdx++;
        } else {
          break;
        }
      }
      const count = endIdx - idx + 1;
      if (count >= 2) {
        const nextArt = laneList[endIdx + 1];
        const nextBound = typeof nextArt?.from?.year === 'number' ? nextArt.from.year : maxYear;
        const availableGap = nextBound - startYear;
        const step = Math.min(maxStep, Math.floor((availableGap * 0.8) / count));
        if (step > 0) {
          for (let m = 1; m < count; m++) {
            const target = laneList[idx + m];
            const spreadYear = Math.max(target.from.year, startYear + m * step);
            target.from = { ...target.from, year: spreadYear };
            if (target.to && typeof target.to.year === 'number' && target.to.year < spreadYear) {
              target.to = { ...target.to, year: spreadYear };
            }
          }
        }
      }
      idx = endIdx + 1;
    }
  });

  return cloned;
}
