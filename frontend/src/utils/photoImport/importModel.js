// Review-state model for the Story Studio photo import: turns clusters into editable draft
// events, applies the user's edits (merge, split, move photos, cover), names places, and finally
// converts the result into ordinary Studio "moments" plus a media plan applied after building.
// Pure module (no DOM / React) so it runs under node --test.

import { pickRepresentatives, haversineKm, suggestTrips } from './clusterPhotos.js';
import { dayKey } from './photoMeta.js';
import { formatFuzzyDate } from '../fuzzyDate.js';

export const PHOTOS_PER_EVENT_DEFAULT = 4;
export const PHOTOS_PER_EVENT_MAX = 12;
// Photos are stored inline in the timeline JSON (the server caps JSON bodies at 16 MB), so an
// import keeps a few photos per event within this budget. The same for every tier: it protects
// saving, not AI cost.
export const STORAGE_BUDGET_CHARS = 9_000_000;
export const EST_COVER_CHARS = 120_000;
export const EST_GALLERY_CHARS = 80_000;
const ATTACH_DISTANCE_KM = 30;

const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const getMeta = (metasById, id) => (metasById instanceof Map ? metasById.get(id) : metasById?.[id]);

/** "14 May 2023", "12–15 May 2023", "28 May – 2 Jun 2023", "30 Dec 2022 – 2 Jan 2023". */
export function formatDateRange(startWall, endWall, lang = 'en') {
  if (!startWall) return '';
  const he = lang === 'he';
  const mName = (m) => (he ? HE_MONTHS[m - 1] : EN_MONTHS_SHORT[m - 1]);
  const one = (w, withYear = true) => `${w.day} ${he ? 'ב' : ''}${mName(w.month)}${withYear ? ` ${w.year}` : ''}`;
  const end = endWall || startWall;
  if (dayKey(startWall) === dayKey(end)) return one(startWall);
  if (startWall.year === end.year && startWall.month === end.month) {
    return `${startWall.day}–${end.day} ${he ? 'ב' : ''}${mName(end.month)} ${end.year}`;
  }
  if (startWall.year === end.year) return `${one(startWall, false)} – ${one(end)}`;
  return `${one(startWall)} – ${one(end)}`;
}

/** "May 2023" / "מאי 2023" */
export function formatMonthYear(wall, lang = 'en') {
  if (!wall) return '';
  return lang === 'he' ? `${HE_MONTHS[wall.month - 1]} ${wall.year}` : `${EN_MONTHS_SHORT[wall.month - 1]} ${wall.year}`;
}

/** How precisely photo events are dated on the timeline. */
export const DATE_DETAILS = ['day', 'time', 'month', 'year'];

const pad2 = (n) => String(n).padStart(2, '0');

/** "09:10" or "09:10–11:40" (same day), from the photos' wall clock. */
export function formatTimeRange(startWall, endWall) {
  if (!startWall || startWall.hour == null) return '';
  const a = `${pad2(startWall.hour)}:${pad2(startWall.minute || 0)}`;
  const end = endWall || startWall;
  if (dayKey(end) !== dayKey(startWall)) return a;
  const b = `${pad2(end.hour)}:${pad2(end.minute || 0)}`;
  return a === b ? a : `${a}–${b}`;
}

/** Studio moment date text at the chosen detail ('time' uses day text; times are applied later). */
export function wallToDetailText(wall, detail, lang = 'en') {
  if (detail === 'year') return String(wall.year);
  if (detail === 'month') return formatFuzzyDate({ year: wall.year, month: wall.month, precision: 'month' }, lang);
  return wallToDateText(wall, lang);
}

/** Exact times for 'time' detail: { from, to? } TimelineDates, or null if the photos have no real time. */
export function eventTimeDates(event, metasById) {
  // Photos dated only by day (file names, dates typed by hand) have a placeholder noon.
  const timed = (event.photoIds || []).map((id) => getMeta(metasById, id)).filter((m) => m?.time && !m.time.dateOnly);
  if (!timed.length) return null;
  timed.sort((a, b) => a.time.sortMs - b.time.sortMs);
  const at = (w) => ({ year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute, precision: 'minute' });
  const first = timed[0].time.wall;
  const last = timed[timed.length - 1].time.wall;
  const out = { from: at(first) };
  if (first.year !== last.year || first.month !== last.month || first.day !== last.day || first.hour !== last.hour || first.minute !== last.minute) {
    out.to = at(last);
  }
  return out;
}

/** Studio moment date text that parseFuzzyDate reads back at day precision. */
export function wallToDateText(wall, lang = 'en') {
  return formatFuzzyDate({ year: wall.year, month: wall.month, day: wall.day, precision: 'day' }, lang);
}

function summarize(photoIds, metasById) {
  const metas = photoIds.map((id) => getMeta(metasById, id)).filter((m) => m?.time);
  metas.sort((a, b) => a.time.sortMs - b.time.sortMs);
  let latSum = 0;
  let lngSum = 0;
  let gps = 0;
  for (const m of metas) {
    if (m.lat != null && m.lng != null) {
      latSum += m.lat;
      lngSum += m.lng;
      gps += 1;
    }
  }
  if (!metas.length) return null;
  let startWall = metas[0].time.wall;
  let endWall = metas[0].time.wall;
  for (const m of metas) {
    if (dayKey(m.time.wall) < dayKey(startWall)) startWall = m.time.wall;
    if (dayKey(m.time.wall) > dayKey(endWall)) endWall = m.time.wall;
  }
  return {
    photoIds: metas.map((m) => m.id),
    startMs: metas[0].time.sortMs,
    endMs: metas[metas.length - 1].time.sortMs,
    startWall,
    endWall,
    centroid: gps ? { lat: latSum / gps, lng: lngSum / gps } : null,
    gpsCount: gps,
  };
}

function eventFromCluster(c, metasById, photosPerEvent) {
  const picks = pickRepresentatives(c.photoIds, metasById, photosPerEvent);
  return {
    id: c.id,
    photoIds: [...c.photoIds],
    startMs: c.startMs,
    endMs: c.endMs,
    startWall: c.startWall,
    endWall: c.endWall,
    centroid: c.centroid,
    gpsCount: c.gpsCount,
    atHome: c.atHome,
    everyday: Boolean(c.everyday),
    include: !c.everyday,
    title: '',
    titleSource: 'auto',
    note: '',
    noteSource: 'auto',
    // The event's longer "what happened" text (the AI-first import writes it; the user edits it).
    story: '',
    storySource: 'auto',
    coverId: picks[0] || c.photoIds[0] || null,
    place: null,
    // What the user typed in "Where?" - wins over the detected place (and is the only place
    // when the photos carry no location, e.g. from Google Photos or a phone that removed it).
    placeText: '',
    attachTo: null,
  };
}

/** Fresh draft events from clusters; small "everyday" groups are combined per month. */
export function createImportEvents(clusters, metasById, { photosPerEvent = PHOTOS_PER_EVENT_DEFAULT, everydayByMonth = true } = {}) {
  const events = (clusters || []).map((c) => eventFromCluster(c, metasById, photosPerEvent));
  // eslint-disable-next-line no-use-before-define
  return everydayByMonth ? groupEverydayByMonth(events, metasById) : events;
}

/**
 * Re-grouping with another preset keeps what the user already did to events that survive with
 * the same id (ids are derived from the first photo): titles, notes, cover, include, place.
 */
export function regroupEvents(prevEvents, clusters, metasById, options = {}) {
  const prev = new Map((prevEvents || []).map((e) => [e.id, e]));
  return createImportEvents(clusters, metasById, options).map((e) => {
    const old = prev.get(e.id);
    if (!old) return e;
    const keepCover = old.coverId && e.photoIds.includes(old.coverId);
    return {
      ...e,
      title: old.titleSource === 'auto' ? e.title : old.title,
      titleSource: old.titleSource,
      note: old.note,
      noteSource: old.noteSource,
      story: old.story || '',
      storySource: old.storySource || 'auto',
      coverId: keepCover ? old.coverId : e.coverId,
      coverSource: keepCover ? old.coverSource : undefined,
      include: old.include,
      includeSource: old.includeSource,
      ...carryAiFields(old),
      place: old.place && e.centroid && old.centroid && haversineKm(old.centroid, e.centroid) < 5 ? old.place : null,
      placeText: old.placeText || '',
      placeSource: old.placeSource || '',
      placeSuggestion: old.placeSuggestion || '',
      attachTo: old.attachTo,
    };
  });
}

function withPhotos(event, photoIds, metasById) {
  const s = summarize(photoIds, metasById);
  if (!s) return null;
  const coverId = event.coverId && s.photoIds.includes(event.coverId) ? event.coverId : pickRepresentatives(s.photoIds, metasById, 1)[0];
  const movedFar = event.centroid && s.centroid ? haversineKm(event.centroid, s.centroid) > 5 : event.centroid !== s.centroid;
  return { ...event, ...s, coverId, place: movedFar ? null : event.place };
}

// What the AI-first import adds to an event (kept through regrouping and merging).
const AI_FIELDS = ['aiDrafted', 'aiKind', 'setAside', 'category', 'importance', 'occasion', 'highlight'];
function carryAiFields(old) {
  const out = {};
  for (const k of AI_FIELDS) if (old[k] !== undefined) out[k] = old[k];
  return out;
}

const joinTexts = (list) => list.map((x) => (x || '').trim()).filter((x, i, arr) => x && arr.indexOf(x) === i).join('\n\n');

/**
 * Merges several events (any order, need not be adjacent in `events`) into the earliest one.
 * Titles and notes the user typed win; stories are joined; `patch` (title/caption from the AI
 * story pass) fills the rest. Returns the events, or the same array when fewer than 2 match.
 */
export function mergeEventsById(events, ids, metasById, patch = {}) {
  const want = new Set((ids || []).map(String));
  const group = (events || []).filter((e) => want.has(String(e.id)));
  if (group.length < 2) return events;
  group.sort((a, b) => a.startMs - b.startMs);
  const [first] = group;
  const userTitled = group.find((e) => e.titleSource === 'user');
  const userNoted = group.filter((e) => e.noteSource === 'user' && (e.note || '').trim());
  const base = {
    ...first,
    include: group.some((e) => e.include),
    everyday: group.every((e) => e.everyday),
    title: userTitled ? userTitled.title : (patch.title || first.title),
    titleSource: userTitled ? 'user' : (patch.title ? 'ai' : first.titleSource),
    note: userNoted.length ? joinTexts(userNoted.map((e) => e.note)) : (patch.caption || first.note),
    noteSource: userNoted.length ? 'user' : (patch.caption ? 'ai' : first.noteSource),
    story: joinTexts(group.map((e) => e.story)),
    storySource: group.some((e) => e.storySource === 'user') ? 'user' : first.storySource,
    importance: Math.max(...group.map((e) => e.importance || 0)) || first.importance,
    occasion: group.map((e) => e.occasion).find(Boolean) || first.occasion || '',
    highlight: group.some((e) => e.highlight) || undefined,
  };
  const merged = withPhotos(base, group.flatMap((e) => e.photoIds), metasById);
  if (!merged) return events;
  const out = [];
  for (const e of events) {
    if (!want.has(String(e.id))) out.push(e);
    else if (e.id === first.id) out.push(merged);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Undoes merges: the merged events (`keeperIds`) are replaced by the `originals` they were made
 * from; everything else stays as it is now (including edits made since).
 */
export function unmergeEvents(events, originals, keeperIds) {
  const keepers = new Set((keeperIds || []).map(String));
  if (!keepers.size || !originals?.length) return events;
  const out = (events || []).filter((e) => !keepers.has(String(e.id)));
  return [...out, ...originals].sort((a, b) => a.startMs - b.startMs);
}

/** Merges an event into the one after it (time order). */
export function mergeWithNext(events, id, metasById) {
  const i = events.findIndex((e) => e.id === id);
  if (i < 0 || i >= events.length - 1) return events;
  const a = events[i];
  const b = events[i + 1];
  const merged = withPhotos({ ...a, include: a.include || b.include, everyday: a.everyday && b.everyday }, [...a.photoIds, ...b.photoIds], metasById);
  if (!merged) return events;
  return [...events.slice(0, i), merged, ...events.slice(i + 2)];
}

/** Splits an event so that `photoId` and every later photo become a new event. */
export function splitEventAt(events, id, photoId, metasById) {
  const i = events.findIndex((e) => e.id === id);
  if (i < 0) return events;
  const ev = events[i];
  const at = ev.photoIds.indexOf(photoId);
  if (at <= 0) return events;
  const first = withPhotos(ev, ev.photoIds.slice(0, at), metasById);
  const restIds = ev.photoIds.slice(at);
  const second = withPhotos(
    {
      ...ev,
      id: `pc-${restIds[0]}`,
      title: '',
      titleSource: 'auto',
      note: '',
      noteSource: 'auto',
      story: '',
      storySource: 'auto',
      coverId: null,
      coverSource: undefined,
      attachTo: null,
      aiDrafted: false,
      highlight: undefined,
      occasion: '',
    },
    restIds,
    metasById,
  );
  if (!first || !second) return events;
  return [...events.slice(0, i), first, second, ...events.slice(i + 1)];
}

/**
 * Moves photos out of their events into `targetId` (or, when null, into the unassigned tray).
 * Events left without photos are removed. Returns { events, unassignedIds }.
 */
export function movePhotos(events, unassignedIds, photoIds, targetId, metasById) {
  const moving = new Set(photoIds);
  let nextUnassigned = (unassignedIds || []).filter((id) => !moving.has(id));
  const out = [];
  for (const ev of events) {
    const keep = ev.photoIds.filter((pid) => !moving.has(pid));
    let ids = keep;
    if (ev.id === targetId) ids = [...keep, ...photoIds];
    if (ids.length === ev.photoIds.length && ids.every((pid, k) => pid === ev.photoIds[k])) {
      out.push(ev);
      continue;
    }
    const next = ids.length ? withPhotos(ev, ids, metasById) : null;
    if (next) out.push(next);
  }
  if (!targetId) nextUnassigned = [...nextUnassigned, ...photoIds];
  // Photos with no date can't sit in an event (it would have no date to show): keep them unassigned.
  const datedOnly = (id) => Boolean(getMeta(metasById, id)?.time);
  if (targetId) {
    const stranded = photoIds.filter((pid) => !datedOnly(pid));
    if (stranded.length) nextUnassigned = [...nextUnassigned, ...stranded.filter((pid) => !nextUnassigned.includes(pid))];
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return { events: out, unassignedIds: nextUnassigned };
}

/** Gives an undated photo a date (local noon) so it can join events. Returns a new meta. */
export function datePhoto(meta, { year, month, day }) {
  const wallMs = Date.UTC(year, month - 1, day, 12, 0, 0);
  return {
    ...meta,
    time: { wall: { year, month, day, hour: 12, minute: 0, second: 0 }, wallMs, utcMs: null, offsetMin: null, sortMs: wallMs, source: 'user', dateOnly: true },
    timeSource: 'user',
  };
}

// ---- Places -----------------------------------------------------------------------------------

/** Most common country among events at home (else among all events). */
export function homeCountryOf(events) {
  const tally = (list) => {
    const counts = new Map();
    for (const e of list) {
      const c = e.place?.country;
      if (c) counts.set(c, (counts.get(c) || 0) + e.photoIds.length);
    }
    let best = null;
    for (const [c, n] of counts) if (!best || n > best[1]) best = [c, n];
    return best ? best[0] : null;
  };
  return tally((events || []).filter((e) => e.atHome)) || tally(events || []);
}

/** "Lisbon" at home or in the home country, "Lisbon, Portugal" abroad. */
export function placeLabel(place, homeCountry = null) {
  if (!place) return '';
  const main = place.city || place.area || place.name || place.region || place.country || '';
  if (!main) return '';
  if (place.country && place.country !== main && place.country !== homeCountry) return `${main}, ${place.country}`;
  return main;
}

/** The event's place as shown and saved: typed by the user, else detected. */
export function eventPlaceLabel(event, homeCountry = null) {
  return (event?.placeText || '').trim() || placeLabel(event?.place, homeCountry);
}

/** Title shown when neither the user nor the AI has named the event. */
export function defaultEventTitle(event, lang = 'en', homeCountry = null) {
  if (event?.everydayMonth) return everydayTitle(event, lang);
  const label = eventPlaceLabel(event, homeCountry);
  if (label) return label;
  return formatDateRange(event.startWall, event.endWall, lang);
}

export const eventTitle = (event, lang, homeCountry) => (event.title || '').trim() || defaultEventTitle(event, lang, homeCountry);

/** Distinct ~1 km cells that still need a place name, as reverse-geocoding points. */
export function placesToLookup(events, { max = null } = {}) {
  const seen = new Map();
  for (const e of events || []) {
    if (!e.centroid || e.place) continue;
    const key = `${e.centroid.lat.toFixed(2)},${e.centroid.lng.toFixed(2)}`;
    // Only the ~1 km cell leaves the device, never the exact spot.
    if (!seen.has(key)) seen.set(key, { id: key, lat: Number(e.centroid.lat.toFixed(2)), lng: Number(e.centroid.lng.toFixed(2)), weight: 0 });
    seen.get(key).weight += e.photoIds.length;
  }
  // Biggest events first, so a capped plan names the places that matter most.
  const list = [...seen.values()].sort((a, b) => b.weight - a.weight);
  return (max != null ? list.slice(0, max) : list).map(({ id, lat, lng }) => ({ id, lat, lng }));
}

/** Applies reverse-geocoding results ({cellId: place}) to events. */
export function applyPlaces(events, placesByCell) {
  return (events || []).map((e) => {
    if (!e.centroid || e.place) return e;
    const key = `${e.centroid.lat.toFixed(2)},${e.centroid.lng.toFixed(2)}`;
    const place = placesByCell?.[key];
    return place ? { ...e, place } : e;
  });
}

// ---- People & captions (Google Takeout sidecars) ---------------------------------------------

/** People tagged in an event's photos, most frequent first. */
export function eventPeople(event, metasById, max = 6) {
  const counts = new Map();
  for (const id of event?.photoIds || []) {
    for (const name of getMeta(metasById, id)?.people || []) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name);
}

/** Distinct captions the user wrote on the event's photos (in Google Photos). */
export function eventCaptions(event, metasById, max = 3) {
  const out = [];
  for (const id of event?.photoIds || []) {
    const d = (getMeta(metasById, id)?.description || '').trim();
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

// ---- Existing events ---------------------------------------------------------------------------

const articleDayRange = (a) => {
  const f = a?.from;
  if (!f || !Number.isInteger(f.year) || !f.month || !f.day) return null;
  const t = a.to && a.to.month && a.to.day ? a.to : f;
  return [Date.UTC(f.year, f.month - 1, f.day), Date.UTC(t.year, t.month - 1, t.day)];
};

/**
 * An existing day-precise event the photos probably belong to: overlapping days (±1) and, when
 * both have coordinates, within 30 km. Closest in time wins. Returns the article id or null.
 */
export function findExistingMatch(event, articles) {
  const evStart = Date.UTC(event.startWall.year, event.startWall.month - 1, event.startWall.day);
  const evEnd = Date.UTC(event.endWall.year, event.endWall.month - 1, event.endWall.day);
  const slack = 24 * 3600 * 1000;
  let best = null;
  for (const a of articles || []) {
    const r = articleDayRange(a);
    if (!r) continue;
    if (r[0] > evEnd + slack || r[1] < evStart - slack) continue;
    if (event.centroid && Number.isFinite(a.lat) && Number.isFinite(a.lng)) {
      if (haversineKm(event.centroid, { lat: a.lat, lng: a.lng }) > ATTACH_DISTANCE_KM) continue;
    }
    const dist = Math.abs(r[0] - evStart);
    if (!best || dist < best.dist) best = { id: a.id, dist };
  }
  return best ? best.id : null;
}

/** Suggests "add these photos to <existing event>" for events that match one. */
export function suggestAttachments(events, articles) {
  return (events || []).map((e) => {
    if (e.attachTo !== null && e.attachTo !== undefined) return e;
    if (e.everydayMonth) return { ...e, attachTo: '' };
    const match = findExistingMatch(e, articles);
    return match ? { ...e, attachTo: String(match) } : { ...e, attachTo: '' };
  });
}

// ---- Storage budget ----------------------------------------------------------------------------

export function keptPhotoCount(event, photosPerEvent) {
  return Math.min(Math.max(1, photosPerEvent), event.photoIds.length);
}

/** Estimated inline-image characters the included events will add to the timeline. */
export function estimateStorageChars(events, photosPerEvent) {
  let chars = 0;
  for (const e of events || []) {
    if (!e.include) continue;
    const n = keptPhotoCount(e, photosPerEvent);
    // Photos attached to an event that already has a cover all go to its gallery.
    chars += e.attachTo ? n * EST_GALLERY_CHARS : EST_COVER_CHARS + (n - 1) * EST_GALLERY_CHARS;
  }
  return chars;
}

/** Largest photos-per-event that fits the budget (>= 1), given what the timeline already holds. */
export function fitPhotosPerEvent(events, wanted, existingChars = 0, budget = STORAGE_BUDGET_CHARS) {
  for (let n = Math.max(1, wanted); n >= 1; n -= 1) {
    if (existingChars + estimateStorageChars(events, n) <= budget) return n;
  }
  return 1;
}

// ---- Story suggestions ------------------------------------------------------------------------

function topBy(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (k) counts.set(k, (counts.get(k) || 0) + item.photoIds.length);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > best[1]) best = [k, n];
  return best ? best[0] : null;
}

/**
 * Which story type to start from when the user begins with photos: a short span without a
 * detected home reads as one trip; anything longer as a free-form "Something else" timeline.
 *
 * @returns {{blueprint: 'trip'|'custom', destination: string, spanDays: number}}
 */
export function suggestBlueprintForImport(events, home, homeCountry = null) {
  const kept = (events || []).filter((e) => e.include);
  if (!kept.length) return { blueprint: 'custom', destination: '', spanDays: 0 };
  const first = Math.min(...kept.map((e) => e.startMs));
  const last = Math.max(...kept.map((e) => e.endMs));
  const spanDays = Math.round((last - first) / (24 * 3600 * 1000)) + 1;
  const away = kept.filter((e) => e.atHome !== true);
  // Without a detected home the "home country" guess is just the most photographed country -
  // i.e. the destination itself - so it must not be excluded.
  const homeC = home ? homeCountry : null;
  const destination = topBy(away, (e) => (e.place?.country && e.place.country !== homeC ? e.place.country : null))
    || topBy(away, (e) => (e.placeText || '').trim() || e.place?.city || e.place?.region || null)
    || '';
  // A trip story needs a destination ("Where did you go?" is required), so without any place
  // the free-form story is the better start.
  const blueprint = !home && spanDays <= 60 && destination ? 'trip' : 'custom';
  return { blueprint, destination, spanDays };
}

/** Trips (see suggestTrips) as Studio chapter rows: "Portugal · May 2023". */
export function tripChapters(clusterTrips, events, lang = 'en', homeCountry = null) {
  const byId = new Map((events || []).map((e) => [e.id, e]));
  const out = [];
  for (const trip of clusterTrips || []) {
    const evs = trip.clusterIds.map((id) => byId.get(id)).filter((e) => e && e.include);
    if (!evs.length) continue;
    const name = topBy(evs, (e) => (e.place?.country && e.place.country !== homeCountry ? e.place.country : null))
      || topBy(evs, (e) => e.place?.city || e.place?.region || null);
    const when = formatMonthYear(trip.startWall, lang);
    out.push({
      key: trip.id,
      title: name ? `${name} · ${when}` : (lang === 'he' ? `טיול · ${when}` : `Trip · ${when}`),
      from: wallToDateText(trip.startWall, lang),
      to: wallToDateText(trip.endWall, lang),
    });
  }
  return out;
}

/** Trips recomputed from the current (edited) events. */
export function tripsFromEvents(events, home) {
  return suggestTrips((events || []).map((e) => ({ ...e })), home);
}

// ---- Output -----------------------------------------------------------------------------------

// The Studio's limit for a moment's story text.
export const MOMENT_STORY_MAX = 6000;

/** Timeline rank (1-10) from the AI's importance; highlights get at least 8. null = default. */
export function eventRank(e) {
  if (!e) return null;
  const base = Number.isFinite(e.importance) ? e.importance : null;
  if (e.highlight) return Math.max(8, base || 0);
  return base;
}

/**
 * Converts reviewed events into Studio moment rows + a media plan.
 * New events become moments (their article id will be `ss-m-<rowId>`); events attached to an
 * existing event only add media to it.
 *
 * @returns {{rows: Array<object>, plan: Array<{eventId, articleId, kind: 'new'|'attach'}>}}
 */
export function eventsToMoments(events, { lang = 'en', lane = '', homeCountry = null, newRowId, dateDetail = 'day', metasById = null }) {
  const rows = [];
  const plan = [];
  for (const e of events || []) {
    if (!e.include) continue;
    if (e.attachTo) {
      plan.push({ eventId: e.id, articleId: String(e.attachTo), kind: 'attach' });
      continue;
    }
    const rowId = newRowId();
    // A month of everyday photos is dated by its month, whatever the chosen detail.
    const detail = e.everydayMonth && (dateDetail === 'day' || dateDetail === 'time') ? 'month' : dateDetail;
    const startText = wallToDetailText(e.startWall, detail, lang);
    const endText = wallToDetailText(e.endWall, detail, lang);
    rows.push({
      id: rowId,
      title: eventTitle(e, lang, homeCountry).slice(0, 120),
      date: startText,
      to: endText !== startText ? endText : '',
      place: eventPlaceLabel(e, homeCountry).slice(0, 120),
      lane,
      note: (e.note || '').trim().slice(0, 1500),
      ...((e.story || '').trim() ? { story: e.story.trim().slice(0, MOMENT_STORY_MAX) } : {}),
      ...(e.category ? { category: String(e.category).slice(0, 60) } : {}),
      ...(eventRank(e) != null ? { rank: eventRank(e) } : {}),
      // Written (partly) by AI: shown with an AI badge, and the timeline isn't "hand-authored".
      ...(e.aiDrafted ? { ai: true } : {}),
    });
    const times = detail === 'time' && metasById ? eventTimeDates(e, metasById) : null;
    plan.push({ eventId: e.id, articleId: `ss-m-${rowId}`, kind: 'new', ...(times ? { dates: times } : {}) });
  }
  return { rows, plan };
}

/**
 * Applies encoded photos to built articles.
 * mediaByArticleId: { [articleId]: { kind, cover, gallery: string[], centroid, photoCount } }
 */
export function applyPhotoMedia(articles, mediaByArticleId) {
  if (!mediaByArticleId) return articles;
  return (articles || []).map((a) => {
    const m = mediaByArticleId[String(a.id)];
    if (!m) return a;
    const next = { ...a };
    const existingGallery = Array.isArray(a.additionalImages) ? a.additionalImages : [];
    const existingUrls = new Set([a.imageUrl, ...existingGallery.map((g) => (typeof g === 'string' ? g : g?.url))].filter(Boolean));
    const images = [m.cover, ...(m.gallery || [])].filter((u) => u && !existingUrls.has(u));
    const hasCover = typeof a.imageUrl === 'string' && a.imageUrl.trim();
    let gallery = images;
    if (!hasCover && images.length) {
      next.imageUrl = images[0];
      next.imageSource = 'upload';
      next.mediaType = 'image';
      gallery = images.slice(1);
    }
    if (gallery.length) next.additionalImages = [...existingGallery, ...gallery.map((url) => ({ url, caption: '' }))];
    if (m.centroid && (a.lat == null || a.lng == null)) {
      const lat = Math.round(m.centroid.lat * 1e4) / 1e4;
      const lng = Math.round(m.centroid.lng * 1e4) / 1e4;
      next.lat = lat;
      next.lng = lng;
      next.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    if (m.kind === 'new') next.provenance = 'photo';
    // 'Day & time' detail: the photos' exact times (the Studio keeps them on later edits).
    if (m.kind === 'new' && m.dates?.from) {
      next.from = m.dates.from;
      if (m.dates.to) next.to = m.dates.to;
      else delete next.to;
    }
    next.photoSource = { count: (a.photoSource?.count || 0) + (m.photoCount || 0) };
    return next;
  });
}

// ---- Photo allocation (which photos each event keeps) ------------------------------------------

// Parallel encode-and-upload workers when applying an import (P-14). Hosted uploads are mostly
// network wait (the server re-encodes while it reserves the slot), so 5 keep the link busy; inline
// photos are all main-thread canvas work, where more parallelism only adds jank.
export const HOSTED_PHOTO_UPLOAD_CONCURRENCY = 5;
export const INLINE_PHOTO_ENCODE_CONCURRENCY = 2;

/**
 * Stored photo sizes, largest first. `chars` is the hard cap per encoded photo (the encoder
 * lowers quality until it fits), so estimates built from them are upper bounds.
 */
export const PHOTO_SIZES = {
  normal: { cover: { dim: 800, chars: 110_000 }, gallery: { dim: 640, chars: 70_000 } },
  compact: { cover: { dim: 560, chars: 55_000 }, gallery: { dim: 480, chars: 38_000 } },
  tiny: { cover: { dim: 400, chars: 30_000 }, gallery: { dim: 360, chars: 22_000 } },
};
// Hosted photos (Supabase Storage) aren't limited by the timeline's size: keep them sharp.
export const HOSTED_PHOTO_SIZE = { cover: { dim: 1280, chars: 400_000 }, gallery: { dim: 1280, chars: 400_000 } };
const SIZE_ORDER = ['normal', 'compact', 'tiny'];

/**
 * Decides how many photos each included event keeps so that NO event is left out:
 * every event gets a cover (shrinking all photos to "compact"/"tiny" if needed; with a truly
 * huge import the smallest events keep no photo rather than being dropped), then the remaining
 * budget is shared out one gallery photo at a time, biggest events first, up to `maxPerEvent`
 * (Infinity = all photos). `budgetChars` Infinity = hosted storage (no inline budget).
 *
 * @returns {{size: string, counts: Map<string, number>, photos: number, chars: number, coverless: number}}
 */
export function planPhotoAllocation(events, { maxPerEvent = PHOTOS_PER_EVENT_DEFAULT, budgetChars = STORAGE_BUDGET_CHARS, existingChars = 0, maxPhotos = Infinity } = {}) {
  const list = (events || []).filter((e) => e.include && e.photoIds?.length);
  const counts = new Map(list.map((e) => [e.id, 0]));
  const max = Math.max(1, maxPerEvent);
  const room = budgetChars === Infinity ? Infinity : Math.max(0, budgetChars - existingChars);
  const firstCost = (e, sz) => (e.attachTo ? sz.gallery.chars : sz.cover.chars);

  let sizeKey = 'tiny';
  if (room === Infinity) sizeKey = 'normal';
  else {
    for (const key of SIZE_ORDER) {
      const base = list.reduce((n, e) => n + firstCost(e, PHOTO_SIZES[key]), 0);
      if (base <= room) {
        sizeKey = key;
        break;
      }
    }
  }
  const sz = PHOTO_SIZES[sizeKey];
  // Biggest events first: they have the most photos to show (and lose most if left bare).
  const bySize = [...list].sort((a, b) => b.photoIds.length - a.photoIds.length);
  let left = room;
  // Hosted storage counts photos (the user's quota) instead of characters.
  let slots = Math.max(0, maxPhotos);
  let coverless = 0;
  for (const e of bySize) {
    const c = firstCost(e, sz);
    if (left >= c && slots >= 1) {
      counts.set(e.id, 1);
      left -= c;
      slots -= 1;
    } else {
      coverless += 1;
    }
  }
  const limitFor = (e) => Math.min(max, e.photoIds.length);
  const topLevel = Math.max(1, ...bySize.map(limitFor));
  for (let level = 2; level <= topLevel && left >= sz.gallery.chars && slots >= 1; level += 1) {
    for (const e of bySize) {
      if (counts.get(e.id) !== level - 1 || limitFor(e) < level) continue;
      if (left < sz.gallery.chars || slots < 1) break;
      counts.set(e.id, level);
      left -= sz.gallery.chars;
      slots -= 1;
    }
  }
  let photos = 0;
  let chars = 0;
  for (const e of list) {
    const n = counts.get(e.id);
    photos += n;
    if (n) chars += firstCost(e, sz) + (n - 1) * sz.gallery.chars;
  }
  return { size: sizeKey, counts, photos, chars, coverless };
}

// ---- Everyday moments ---------------------------------------------------------------------------

const EVERYDAY_LABEL = { en: 'Everyday moments', he: 'רגעים יומיומיים' };

/**
 * Small groups of photos taken around home ("everyday") become one event per month instead of
 * being left out: "Everyday moments · May 2023". They're included by default.
 */
export function groupEverydayByMonth(events, metasById) {
  const out = [];
  const buckets = new Map();
  for (const e of events || []) {
    if (!e.everyday) {
      out.push(e);
      continue;
    }
    const key = `${e.startWall.year}-${pad2(e.startWall.month)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  for (const [key, group] of buckets) {
    const ids = group.flatMap((e) => e.photoIds);
    const base = {
      ...group[0],
      id: `everyday-${key}`,
      include: true,
      everyday: true,
      everydayMonth: true,
      title: '',
      titleSource: 'auto',
      note: '',
      noteSource: 'auto',
      coverId: null,
      place: null,
      attachTo: '',
    };
    const merged = withPhotos(base, ids, metasById);
    if (merged) out.push({ ...merged, place: group.find((e) => e.place)?.place || null });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Title for a monthly everyday event. */
export function everydayTitle(event, lang = 'en') {
  return `${EVERYDAY_LABEL[lang] || EVERYDAY_LABEL.en} · ${formatMonthYear(event.startWall, lang)}`;
}
