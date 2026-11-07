// Groups photo metadata (see photoMeta.js) into draft events: by time gaps and distance, with
// "home" detection so years of everyday camera-roll photos don't turn into hundreds of events,
// and trip detection for chapters. Pure and O(n) after the sort, so 10k+ photos are fine.

import { dayKey } from './photoMeta.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Grouping presets behind the "Fewer / Balanced / More events" control.
 * - gapHours: a pause longer than this starts a new event.
 * - distKm: moving further than this from the event's centre starts a new event.
 * - dayBreakHours: on a new calendar day, a pause longer than this starts a new event
 *   (null = days alone never split).
 * - mergeAwayDays: consecutive days in the same place away from home become one event.
 * - mergeTrips: a whole trip away from home becomes one event.
 * - minHomePhotos: events at home with fewer photos are "everyday" (hidden by default).
 */
export const GROUPING_PRESETS = {
  fewer: { gapHours: 24, distKm: 60, dayBreakHours: null, mergeAwayDays: true, mergeTrips: true, minHomePhotos: 8 },
  balanced: { gapHours: 6, distKm: 25, dayBreakHours: 3, mergeAwayDays: true, mergeTrips: false, minHomePhotos: 4 },
  more: { gapHours: 2, distKm: 5, dayBreakHours: 1, mergeAwayDays: false, mergeTrips: false, minHomePhotos: 2 },
};
/**
 * Fixed-bucket levels: one event per calendar day, per clock hour, or per photo (wall clock).
 * No gap/distance/home rules and no "everyday" folding: the user gets exactly what they picked.
 * Photos dated by day only (placeholder noon) share one hourly bucket for their day.
 */
export const FIXED_GROUPING = { day: 'day', hour: 'hour', photo: 'photo' };
// The single "how finely to split" scale, coarsest first.
export const GROUPING_PRESET_KEYS = ['fewer', 'balanced', 'more', 'day', 'hour', 'photo'];
export const isFixedGrouping = (key) => Object.prototype.hasOwnProperty.call(FIXED_GROUPING, key);

export const HOME_RADIUS_KM = 15;
export const TRIP_MIN_DISTANCE_KM = 80;
const MERGE_GAP_HOURS = 36;
const TRIP_GAP_HOURS = 72;
const HOME_CELL_DEG = 0.05;
const BURST_MS = 2000;

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km between {lat,lng} points. */
export function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

const hasGps = (p) => p && p.lat != null && p.lng != null;

/**
 * The place the photos keep coming back to: the ~5 km cell seen on the most distinct days.
 * Only claimed for long-running imports (>= 60 days, >= 5 home days, >= 30% of photo days),
 * so a two-week trip never gets its main city mistaken for home.
 *
 * @returns {{lat: number, lng: number, days: number, share: number}|null}
 */
export function detectHome(photos) {
  const cells = new Map();
  const allDays = new Set();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const p of photos || []) {
    if (!p?.time || !hasGps(p)) continue;
    const day = dayKey(p.time.wall);
    allDays.add(day);
    minMs = Math.min(minMs, p.time.wallMs);
    maxMs = Math.max(maxMs, p.time.wallMs);
    const key = `${Math.floor(p.lat / HOME_CELL_DEG)}:${Math.floor(p.lng / HOME_CELL_DEG)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { days: new Set(), latSum: 0, lngSum: 0, n: 0 };
      cells.set(key, cell);
    }
    cell.days.add(day);
    cell.latSum += p.lat;
    cell.lngSum += p.lng;
    cell.n += 1;
  }
  if (!cells.size || maxMs - minMs < 60 * DAY) return null;
  let best = null;
  for (const cell of cells.values()) {
    if (!best || cell.days.size > best.days.size || (cell.days.size === best.days.size && cell.n > best.n)) best = cell;
  }
  const share = best.days.size / allDays.size;
  if (best.days.size < 5 || share < 0.3) return null;
  return { lat: best.latSum / best.n, lng: best.lngSum / best.n, days: best.days.size, share };
}

function newCluster(p) {
  const c = { photos: [p], startMs: p.time.sortMs, endMs: p.time.sortMs, latSum: 0, lngSum: 0, gpsCount: 0 };
  if (hasGps(p)) addGps(c, p);
  return c;
}

function addGps(c, p) {
  c.latSum += p.lat;
  c.lngSum += p.lng;
  c.gpsCount += 1;
}

const centroidOf = (c) => (c.gpsCount ? { lat: c.latSum / c.gpsCount, lng: c.lngSum / c.gpsCount } : null);

function mergeInto(a, b) {
  a.photos.push(...b.photos);
  a.endMs = Math.max(a.endMs, b.endMs);
  a.startMs = Math.min(a.startMs, b.startMs);
  a.latSum += b.latSum;
  a.lngSum += b.lngSum;
  a.gpsCount += b.gpsCount;
  return a;
}

function sequentialPass(dated, preset) {
  const out = [];
  let cur = null;
  let last = null;
  for (const p of dated) {
    if (!cur) {
      cur = newCluster(p);
      last = p;
      continue;
    }
    const gapMs = p.time.sortMs - last.time.sortMs;
    let split = gapMs > preset.gapHours * HOUR;
    if (!split && preset.dayBreakHours != null && dayKey(p.time.wall) !== dayKey(last.time.wall) && gapMs > preset.dayBreakHours * HOUR) {
      split = true;
    }
    if (!split && hasGps(p) && cur.gpsCount) {
      split = haversineKm(p, centroidOf(cur)) > preset.distKm;
    }
    if (split) {
      out.push(cur);
      cur = newCluster(p);
    } else {
      cur.photos.push(p);
      cur.endMs = p.time.sortMs;
      if (hasGps(p)) addGps(cur, p);
    }
    last = p;
  }
  if (cur) out.push(cur);
  return out;
}

function isAway(c, home) {
  const centre = centroidOf(c);
  if (!home || !centre) return false;
  return haversineKm(centre, home) > HOME_RADIUS_KM;
}

function isTripStop(c, home) {
  const centre = centroidOf(c);
  return Boolean(home && centre && haversineKm(centre, home) > TRIP_MIN_DISTANCE_KM);
}

function mergePass(clusters, preset, home) {
  if (!preset.mergeAwayDays && !preset.mergeTrips) return clusters;
  const out = [];
  for (const c of clusters) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = c.startMs - prev.endMs;
      const prevC = centroidOf(prev);
      const curC = centroidOf(c);
      // Without a known home, "away" can't be told apart from home: then same-place consecutive
      // days only merge in the "fewer" preset.
      const awayOk = home ? isAway(prev, home) && isAway(c, home) : preset.mergeTrips;
      const samePlace = prevC && curC && haversineKm(prevC, curC) <= preset.distKm;
      const sameTrip = preset.mergeTrips && home && isTripStop(prev, home) && isTripStop(c, home) && gap <= TRIP_GAP_HOURS * HOUR;
      if ((preset.mergeAwayDays && awayOk && samePlace && gap <= MERGE_GAP_HOURS * HOUR) || sameTrip) {
        mergeInto(prev, c);
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

const countDays = (photos) => new Set(photos.map((p) => dayKey(p.time.wall))).size;

function wallBounds(photos) {
  let first = photos[0];
  let lastP = photos[0];
  for (const p of photos) {
    if (p.time.wallMs < first.time.wallMs) first = p;
    if (p.time.wallMs > lastP.time.wallMs) lastP = p;
  }
  return { startWall: first.time.wall, endWall: lastP.time.wall };
}

const pad2 = (n) => String(n).padStart(2, '0');

function bucketKey(p, level) {
  if (level === 'photo') return `p:${p.id}`;
  const day = dayKey(p.time.wall);
  if (level === 'day') return day;
  return `${day}T${pad2(p.time.wall.hour ?? 12)}`;
}

/** Consecutive photos (in time order) sharing a day / hour bucket, or one cluster per photo. */
function bucketPass(dated, level) {
  const out = [];
  let cur = null;
  let curKey = null;
  for (const p of dated) {
    const key = bucketKey(p, level);
    if (cur && key === curKey) {
      cur.photos.push(p);
      cur.endMs = Math.max(cur.endMs, p.time.sortMs);
      if (hasGps(p)) addGps(cur, p);
      continue;
    }
    if (cur) out.push(cur);
    cur = newCluster(p);
    curKey = key;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Groups photos into draft events.
 *
 * @param {Array<object>} photos  records from buildPhotoMeta
 * @param {{preset?: string, home?: object|null}} [options]  preset: a GROUPING_PRESET_KEYS key;
 *   `home` overrides detection (null = none; still used for trips and "at home" on fixed levels)
 * @returns {{clusters: Array<object>, undatedIds: string[], home: object|null}}
 *   cluster: { id, photoIds, startMs, endMs, startWall, endWall, centroid, gpsCount, days,
 *              atHome (true|false|null = unknown), homeDistanceKm, everyday }
 */
export function clusterPhotos(photos, { preset = 'balanced', home } = {}) {
  const fixed = isFixedGrouping(preset) ? FIXED_GROUPING[preset] : null;
  const cfg = fixed ? null : (GROUPING_PRESETS[preset] || GROUPING_PRESETS.balanced);
  const list = Array.isArray(photos) ? photos : [];
  const dated = list.filter((p) => p?.time).sort((a, b) => (a.time.sortMs - b.time.sortMs) || String(a.name).localeCompare(String(b.name)));
  const undatedIds = list.filter((p) => p && !p.time).map((p) => p.id);
  const resolvedHome = home === undefined ? detectHome(dated) : home;

  const raw = fixed ? bucketPass(dated, fixed) : mergePass(sequentialPass(dated, cfg), cfg, resolvedHome);
  const clusters = raw.map((c) => {
    c.photos.sort((a, b) => a.time.sortMs - b.time.sortMs);
    const centroid = centroidOf(c);
    const homeDistanceKm = resolvedHome && centroid ? haversineKm(centroid, resolvedHome) : null;
    const atHome = homeDistanceKm == null ? null : homeDistanceKm <= HOME_RADIUS_KM;
    const { startWall, endWall } = wallBounds(c.photos);
    const first = c.photos[0];
    return {
      id: `pc-${first.id}`,
      photoIds: c.photos.map((p) => p.id),
      startMs: c.startMs,
      endMs: c.endMs,
      startWall,
      endWall,
      centroid,
      gpsCount: c.gpsCount,
      days: countDays(c.photos),
      atHome,
      homeDistanceKm,
      // Fixed levels never fold small home events into "everyday" months.
      everyday: !fixed && atHome === true && c.photos.length < cfg.minHomePhotos,
    };
  });
  return { clusters, undatedIds, home: resolvedHome };
}

/**
 * Runs of consecutive events far from home (> 80 km, gaps < 3 days) spanning 2+ days:
 * suggested chapters such as "Portugal · May 2023". Needs a detected home.
 *
 * @returns {Array<{id, clusterIds: string[], startWall, endWall}>}
 */
export function suggestTrips(clusters, home) {
  if (!home) return [];
  const trips = [];
  let run = [];
  const flush = () => {
    // Events without GPS only count inside a trip, never at its end.
    while (run.length && !run[run.length - 1].centroid) run.pop();
    if (run.length) {
      const startWall = run[0].startWall;
      const endWall = run[run.length - 1].endWall;
      if (dayKey(startWall) !== dayKey(endWall)) {
        trips.push({ id: `trip-${run[0].id}`, clusterIds: run.map((c) => c.id), startWall, endWall });
      }
    }
    run = [];
  };
  for (const c of clusters || []) {
    const far = c.centroid && haversineKm(c.centroid, home) > TRIP_MIN_DISTANCE_KM;
    // Events without GPS inside a trip (e.g. a screenshot) don't break it.
    const neutral = !c.centroid;
    if (far || (neutral && run.length)) {
      const prev = run[run.length - 1];
      if (prev && c.startMs - prev.endMs > TRIP_GAP_HOURS * HOUR) flush();
      if (far || run.length) run.push(c);
    } else {
      flush();
    }
  }
  flush();
  return trips;
}

/**
 * Picks up to `count` photos spread across the event's time span, skipping burst shots taken
 * within 2 seconds of each other. The first item is the suggested cover (the middle pick).
 *
 * @param {string[]} photoIds  in time order
 * @param {Map<string, object>|object} metasById
 */
export function pickRepresentatives(photoIds, metasById, count = 4) {
  const get = (id) => (metasById instanceof Map ? metasById.get(id) : metasById?.[id]);
  const ids = Array.isArray(photoIds) ? photoIds : [];
  if (!ids.length || count <= 0) return [];
  const distinct = [];
  let lastMs = -Infinity;
  for (const id of ids) {
    const ms = get(id)?.time?.sortMs;
    if (ms != null && ms - lastMs < BURST_MS && distinct.length) continue;
    distinct.push(id);
    if (ms != null) lastMs = ms;
  }
  const pool = distinct.length >= Math.min(count, ids.length) ? distinct : ids;
  const k = Math.min(count, pool.length);
  const picks = [];
  for (let i = 0; i < k; i += 1) picks.push(pool[Math.min(pool.length - 1, Math.floor(((i + 0.5) * pool.length) / k))]);
  const coverIdx = Math.floor((k - 1) / 2);
  return [picks[coverIdx], ...picks.filter((_, i) => i !== coverIdx)];
}

/**
 * How many events each grouping level would make, as {presetKey: count}: what the "how finely
 * to split" scale shows (and prices) before anything is built. Small home groups the coarse
 * presets fold into "everyday" months count once per month. Home is detected once for all levels.
 */
export function countGroupingLevels(photos, { keys = GROUPING_PRESET_KEYS, home } = {}) {
  const dated = (Array.isArray(photos) ? photos : []).filter((p) => p?.time);
  const resolvedHome = home === undefined ? detectHome(dated) : home;
  const out = {};
  for (const key of keys) {
    const { clusters } = clusterPhotos(dated, { preset: key, home: resolvedHome });
    const months = new Set();
    let n = 0;
    for (const c of clusters) {
      if (c.everyday) months.add(`${c.startWall.year}-${c.startWall.month}`);
      else n += 1;
    }
    out[key] = n + months.size;
  }
  return out;
}
