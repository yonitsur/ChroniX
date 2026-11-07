// The AI-first photo import ("Build my timeline"): after the free local steps (read, group,
// name places, set screenshots aside) the AI drafts every event from its photos ("look"), then
// shapes the whole import into a story ("story": title, type, chapters, merges, tidier titles,
// highlights), then writes the timeline's overview. Everything lands as an editable draft that
// the user reviews on one screen before the timeline is created.
//
// Pure module (no DOM / React): the API calls and photo encoding are injected, so the whole
// pipeline runs under node --test.

import { pickRepresentatives } from './clusterPhotos.js';
import { dayKey, isLikelyScreenshot } from './photoMeta.js';
import {
  eventsNeedingDrafts, planDraftBatches, draftCreditCost, applyDrafts,
} from './aiDrafts.js';
import {
  formatDateRange, formatTimeRange, eventTimeDates, eventPlaceLabel, eventPeople, eventCaptions,
  eventTitle, mergeEventsById, wallToDateText, MOMENT_STORY_MAX,
} from './importModel.js';

const DAY_MS = 24 * 3600 * 1000;
// Without a detected home, an import spanning at most this many days reads as one journey.
export const SINGLE_TRIP_MAX_DAYS = 60;
// The overview endpoint's limits (StoryOverviewRequest): moments per request and request size.
export const OVERVIEW_MAX_MOMENTS = 200;
export const OVERVIEW_MAX_CHARS = 55_000;
// Above this many characters of facts the overview costs 2 credits (STORY_OVERVIEW_LONG_CHARS).
export const OVERVIEW_LONG_CHARS = 6000;
// The story pass's per-event story excerpt (PhotoStoryEvent.story).
export const STORY_PASS_STORY_CHARS = 600;

export const AUTO_STAGES = ['places', 'moments', 'story', 'overview'];

// ---- Local curation (free) --------------------------------------------------------------------

/** Ids of photos that are very probably screenshots (set aside before grouping). */
export function screenshotIds(metas) {
  const out = [];
  for (const m of metas || []) if (isLikelyScreenshot(m)) out.push(m.id);
  return out;
}

// ---- Look: one vision call per batch of events -------------------------------------------------

const dayIndex = (wall) => Math.round(Date.UTC(wall.year, wall.month - 1, wall.day) / DAY_MS);

/**
 * Where each event sits in its journey, for the AI's continuity: {eventId: "day 3 of 12 of a trip"}.
 * Events of a detected trip count from the trip's first day; an import without a home that spans
 * at most SINGLE_TRIP_MAX_DAYS reads as one journey. Other events get no sequence.
 */
export function sequenceTexts(events, trips = [], { home = null } = {}) {
  const out = {};
  const list = (events || []).filter((e) => e.startWall);
  const spans = [];
  for (const trip of trips || []) {
    spans.push({ ids: new Set(trip.clusterIds), start: dayIndex(trip.startWall), end: dayIndex(trip.endWall) });
  }
  if (!home && list.length) {
    const start = Math.min(...list.map((e) => dayIndex(e.startWall)));
    const end = Math.max(...list.map((e) => dayIndex(e.endWall || e.startWall)));
    if (end - start + 1 <= SINGLE_TRIP_MAX_DAYS && end > start) spans.push({ ids: new Set(list.map((e) => e.id)), start, end });
  }
  for (const e of list) {
    const span = spans.find((s) => s.ids.has(e.id));
    if (!span) continue;
    const total = span.end - span.start + 1;
    const n = dayIndex(e.startWall) - span.start + 1;
    if (n === 1) out[e.id] = `first day of a ${total}-day trip`;
    else if (n === total) out[e.id] = `last day of a ${total}-day trip`;
    else out[e.id] = `day ${n} of a ${total}-day trip`;
  }
  return out;
}

/** "09:10–18:40" from the photos' real times (none for photos dated by day only). */
export function eventTimeText(event, metasById) {
  if (event?.everydayMonth) return '';
  const t = eventTimeDates(event, metasById);
  if (!t) return '';
  const wall = (d) => ({ year: d.year, month: d.month, day: d.day, hour: d.hour, minute: d.minute });
  return formatTimeRange(wall(t.from), wall(t.to || t.from));
}

/** The photos sent to the AI for an event, cover first, in the order the AI will number them. */
export function lookPhotoIds(event, metasById, count) {
  const n = Math.max(0, count || 0);
  if (!n) return [];
  const reps = pickRepresentatives(event.photoIds, metasById, n);
  const ordered = event.coverId && event.photoIds.includes(event.coverId)
    ? [event.coverId, ...reps.filter((x) => x !== event.coverId)]
    : reps;
  return ordered.slice(0, n);
}

/** The text part of one event in a 'full' drafting request (images are added by the caller). */
export function lookPayloadEvent(event, { metasById, homeCountry = null, lang = 'en', sequence = '' } = {}) {
  const userNote = event.noteSource === 'user' ? (event.note || '') : '';
  return {
    id: event.id,
    place: eventPlaceLabel(event, homeCountry),
    date_text: formatDateRange(event.startWall, event.endWall, lang),
    time_text: eventTimeText(event, metasById).slice(0, 40),
    sequence: (sequence || '').slice(0, 80),
    photo_count: Math.max(1, event.photoIds.length),
    at_home: event.atHome === true,
    hint: (userNote || eventCaptions(event, metasById).join(' · ')).slice(0, 300),
    people_tagged: eventPeople(event, metasById, 10),
    needs_place: !event.centroid && !eventPlaceLabel(event, homeCountry),
    current_title: event.titleSource === 'user' ? (event.title || '').slice(0, 200) : '',
  };
}

/** Events the look step drafts: every included new event (user titles are kept, not skipped). */
export function lookTargets(events) {
  return eventsNeedingDrafts(events, { includeNamed: true });
}

// ---- Story: one text-only call over the whole import --------------------------------------------

const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** The events the story pass sees: included, new, in time order. */
export function storyEvents(events) {
  return (events || []).filter((e) => e.include && !e.attachTo).slice().sort((a, b) => a.startMs - b.startMs);
}

/** The story pass request's events. */
export function storyPayloadEvents(events, { trips = [], metasById = null, homeCountry = null, lang = 'en' } = {}) {
  const tripOf = new Map();
  for (const trip of trips || []) for (const id of trip.clusterIds) tripOf.set(id, trip.id);
  return storyEvents(events).map((e) => ({
    id: e.id,
    date_text: formatDateRange(e.startWall, e.endWall, lang),
    place: eventPlaceLabel(e, homeCountry).slice(0, 200),
    title: eventTitle(e, lang, homeCountry).slice(0, 200),
    caption: clip(e.note, 400),
    story: clip(e.story, STORY_PASS_STORY_CHARS),
    photo_count: Math.max(1, e.photoIds.length),
    at_home: e.atHome === true ? true : null,
    trip: (tripOf.get(e.id) || '').slice(0, 64),
    people_tagged: metasById ? eventPeople(e, metasById, 10) : [],
    occasion: clip(e.occasion, 60),
    user_titled: e.titleSource === 'user',
  }));
}

/**
 * Applies a story-pass result to the events: merges (into the earliest event of each group),
 * better titles (never over a user's title) and highlights. Returns { events, mergedInto, merged }
 * where mergedInto maps every merged-away id to the id that absorbed it.
 */
export function applyStoryPass(events, result, metasById) {
  let next = events || [];
  const mergedInto = {};
  let merged = 0;
  for (const m of result?.merges || []) {
    const ids = (m.event_ids || []).filter((id) => next.some((e) => e.id === id));
    if (ids.length < 2) continue;
    const before = next;
    next = mergeEventsById(next, ids, metasById, { title: m.title || '', caption: m.caption || '' });
    if (next === before) continue;
    const keeper = before.filter((e) => ids.includes(e.id)).sort((a, b) => a.startMs - b.startMs)[0].id;
    for (const id of ids) if (id !== keeper) mergedInto[id] = keeper;
    merged += 1;
  }
  const titles = new Map((result?.titles || []).map((t) => [String(mergedInto[t.id] || t.id), t.title]));
  const highlights = new Set((result?.highlights || []).map((id) => String(mergedInto[id] || id)));
  next = next.map((e) => {
    const title = titles.get(String(e.id));
    const out = { ...e };
    let changed = false;
    if (title && e.titleSource !== 'user') {
      out.title = title;
      out.titleSource = 'ai';
      changed = true;
    }
    if (highlights.has(String(e.id)) && !e.highlight) {
      out.highlight = true;
      changed = true;
    }
    return changed ? out : e;
  });
  return { events: next, mergedInto, merged };
}

/**
 * Story chapters ({title, first_event_id, last_event_id}) as Studio chapter rows ({key, title,
 * from, to}) against the CURRENT events: ids merged away are followed to their keeper; chapters
 * whose events are gone (excluded, split...) are dropped.
 */
export function storyChaptersToRows(chapters, events, lang = 'en', mergedInto = {}) {
  const byId = new Map(storyEvents(events).map((e) => [String(e.id), e]));
  const resolve = (id) => byId.get(String(mergedInto[id] || id));
  const out = [];
  for (const [i, ch] of (chapters || []).entries()) {
    const a = resolve(ch.first_event_id);
    const b = resolve(ch.last_event_id);
    const title = (ch.title || '').trim();
    if (!a || !b || !title) continue;
    const [first, last] = a.startMs <= b.startMs ? [a, b] : [b, a];
    out.push({
      key: `story-${i}`,
      title,
      from: wallToDateText(first.startWall, lang),
      to: wallToDateText(last.endWall || last.startWall, lang),
    });
  }
  return out;
}

// ---- Overview ----------------------------------------------------------------------------------

/**
 * Facts for the overview endpoint (StoryOverviewRequest) from the reviewed events: at most
 * OVERVIEW_MAX_MOMENTS moments (the most important when there are more), stories shortened
 * until the request fits OVERVIEW_MAX_CHARS.
 */
export function overviewFacts({ title, kind = '', people = [], events, chapters = [], lang = 'en', homeCountry = null }) {
  let list = storyEvents(events);
  if (list.length > OVERVIEW_MAX_MOMENTS) {
    const rankOf = (e) => (e.highlight ? 20 : 0) + (e.importance || 5);
    list = list.slice().sort((a, b) => rankOf(b) - rankOf(a)).slice(0, OVERVIEW_MAX_MOMENTS).sort((a, b) => a.startMs - b.startMs);
  }
  const moment = (e, storyMax, noteMax = 1500) => {
    const end = e.endWall && dayKey(e.endWall) !== dayKey(e.startWall) ? wallToDateText(e.endWall, lang) : '';
    return {
      title: clip(eventTitle(e, lang, homeCountry), 160) || formatDateRange(e.startWall, e.endWall, lang),
      date: wallToDateText(e.startWall, lang),
      to: end,
      place: clip(eventPlaceLabel(e, homeCountry), 160),
      lane: '',
      note: clip(e.note, noteMax),
      story: storyMax > 0 ? clip(e.story, storyMax) : '',
    };
  };
  const base = {
    title: clip(title, 160) || (lang === 'he' ? 'הסיפור שלנו' : 'Our story'),
    kind: clip(kind, 80),
    people: (people || []).map((p) => clip(p, 60)).filter(Boolean).slice(0, 12),
    lanes: [],
    chapters: (chapters || []).slice(0, 40).map((c) => ({ title: clip(c.title, 120), from: c.from || '', to: c.to || '' })),
  };
  for (let storyMax = 1200; ; storyMax = Math.floor(storyMax / 2)) {
    const facts = { ...base, moments: list.map((e) => moment(e, storyMax)) };
    if (JSON.stringify(facts).length <= OVERVIEW_MAX_CHARS) return facts;
    if (storyMax === 0) {
      // Still too long without stories: shorter notes as a last resort.
      return { ...base, moments: list.map((e) => moment(e, 0, 160)) };
    }
    if (storyMax < 40) storyMax = 1; // the next halving reaches 0 (no stories at all)
  }
}

// ---- Cost --------------------------------------------------------------------------------------

/** Credits for the story pass over `eventCount` events (calculate_photo_story_credit_cost). */
/** The story pass's per-request event ceiling for the caller's plan. */
export const storyMaxEvents = (limits) => Math.max(1, Number(limits?.story_max_events) || 250);

/** Consecutive slices of at most `max` events: one story-pass request each. */
export function storyChunks(list, max) {
  const out = [];
  for (let i = 0; i < (list || []).length; i += Math.max(1, max)) out.push(list.slice(i, i + Math.max(1, max)));
  return out;
}

/** Credits for the story pass: one request per storyMaxEvents chunk, each priced on its own. */
export function storyCreditCost(eventCount, limits) {
  if (limits?.unlimited) return 0;
  const per = Math.max(1, Number(limits?.story_events_per_credit) || 120);
  const max = storyMaxEvents(limits);
  let left = Math.max(1, eventCount);
  let total = 0;
  while (left > 0) {
    const n = Math.min(left, max);
    total += Math.max(1, Math.ceil(n / per));
    left -= n;
  }
  return total;
}

/** Merges two story-pass results (consecutive chunks): the first chunk names the timeline. */
export function combineStoryResults(a, b) {
  if (!a) return b;
  if (!b) return a;
  const pick = (k) => a[k] || b[k];
  return {
    ...a,
    timeline_title: pick('timeline_title'),
    story_type: pick('story_type'),
    subject_names: (a.subject_names || []).length ? a.subject_names : (b.subject_names || []),
    lane_title: pick('lane_title'),
    chapters: [...(a.chapters || []), ...(b.chapters || [])],
    merges: [...(a.merges || []), ...(b.merges || [])],
    titles: [...(a.titles || []), ...(b.titles || [])],
    highlights: [...(a.highlights || []), ...(b.highlights || [])],
    credits: (Number(a.credits) || 0) + (Number(b.credits) || 0),
  };
}

/**
 * What "Build my timeline" will cost: {look, story, overview, total} credits (all 0 on the
 * unlimited plan). The overview estimate assumes notes and stories (2 credits past ~6 events).
 */
export function estimateAutoBuildCredits(eventCount, limits, { overview = true } = {}) {
  if (limits?.unlimited || eventCount <= 0) return { look: 0, story: 0, overview: 0, total: 0 };
  const look = draftCreditCost(eventCount, limits, 'full');
  const story = storyCreditCost(eventCount, limits);
  const ov = overview ? (eventCount > 6 ? 2 : 1) : 0;
  return { look, story, overview: ov, total: look + story + ov };
}

// ---- The pipeline ------------------------------------------------------------------------------

const isAbort = (err) => err?.name === 'AbortError';
// Errors that stop every remaining AI call (no point trying the next batch).
const isFatal = (err) => err?.status === 401 || err?.status === 402 || err?.status === 403;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  }, { once: true });
});

async function pool(items, limit, fn, signal) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next;
      next += 1;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function newImportRunId() {
  try {
    if (globalThis.crypto?.randomUUID) return `photo-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Fall through.
  }
  return `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Runs look -> story -> overview. The caller owns the events (React state): `getEvents()` reads
 * the latest, `setEvents(updater)` applies a pure update, so the user can keep editing while it
 * runs and nothing they type is overwritten.
 *
 * @param {object} o
 * @param {object} o.api        { draftPhotoEvents, draftPhotoStory, draftStoryOverview, logPhotoImportCost? } (api.js signatures)
 * @param {Function} o.encodeImages  async (photoId, maxPx) -> base64 JPEG or null
 * @param {Function} o.onProgress    ({stage, done, total, credits}) => void
 * @returns {Promise<{credits, failedIds, story, mergedInto, merged, overview, overviewFailed, storyFailed, stoppedBy}>}
 */
export async function runAutoBuild(o) {
  // One id for every call of this run; when it ends the server logs what the timeline cost.
  const importRunId = newImportRunId();
  try {
    return await runAutoBuildSteps({ ...o, importRunId });
  } finally {
    try {
      o?.api?.logPhotoImportCost?.(importRunId)?.catch?.(() => {});
    } catch {
      // Logging only.
    }
  }
}

async function runAutoBuildSteps({
  importRunId,
  getEvents, setEvents, metasById, limits, lang = 'en', homeCountry = null, trips = [], home = null,
  context = '', instructions = '', people = [], mode = 'new', existingTitle = '', storyKind = '', timelineId = null,
  api, encodeImages, onProgress = () => {}, signal = null, overview = true, storyPass = true, retryDelayMs = 15000,
  allowMerges = true,
}) {
  let credits = 0;
  const failedIds = [];
  let stoppedBy = null;
  const progress = (stage, done, total) => onProgress({ stage, done, total, credits });

  // 1. Look: every event drafted from its photos.
  const targets = lookTargets(getEvents()).map((e) => e.id);
  const batches = planDraftBatches(targets, limits, 'full');
  const perEvent = Math.max(0, Number(limits?.draft_images_per_event) || 0);
  const maxPx = Number(limits?.draft_image_max_px) || 384;
  const sequence = sequenceTexts(getEvents(), trips, { home });
  let done = 0;
  progress('moments', 0, targets.length);
  await pool(batches, Math.max(1, Number(limits?.draft_parallel_calls) || 1), async (batch) => {
    if (stoppedBy || signal?.aborted) return;
    const sentImages = {};
    const payload = [];
    for (const id of batch) {
      const ev = getEvents().find((e) => e.id === id);
      if (!ev) continue;
      const pids = lookPhotoIds(ev, metasById, perEvent);
      const images = [];
      const sent = [];
      for (const pid of pids) {
        if (signal?.aborted) return;
        try {
          const b64 = await encodeImages(pid, maxPx);
          if (b64) {
            images.push(b64);
            sent.push(pid);
          }
        } catch {
          // An unreadable photo is simply left out.
        }
      }
      sentImages[id] = sent;
      payload.push({ ...lookPayloadEvent(ev, { metasById, homeCountry, lang, sequence: sequence[id] }), images });
    }
    if (!payload.length) return;
    const call = () => api.draftPhotoEvents({
      events: payload, detail: 'full', storyContext: context, instructions, storyKind, storyTitle: mode === 'add' ? existingTitle : '',
      people, lang, timelineId, importRunId, signal,
    });
    try {
      let res;
      try {
        res = await call();
      } catch (err) {
        if (err?.status !== 429 || signal?.aborted) throw err;
        await sleep(retryDelayMs, signal); // rate limited: wait once and retry
        res = await call();
      }
      credits += Number(res?.credits) || 0;
      const drafts = res?.drafts || [];
      setEvents((prev) => applyDrafts(prev, drafts, { sentImages }));
      const got = new Set(drafts.map((d) => String(d.id)));
      for (const p of payload) if (!got.has(String(p.id))) failedIds.push(p.id);
    } catch (err) {
      if (isAbort(err)) return;
      failedIds.push(...payload.map((p) => p.id));
      if (isFatal(err)) stoppedBy = err;
    }
    done += batch.length;
    progress('moments', Math.min(done, targets.length), targets.length);
  }, signal);
  if (signal?.aborted) return { credits, failedIds, story: null, mergedInto: {}, merged: 0, overview: '', stoppedBy: 'abort' };

  // 2. Story: title, type, chapters, merges, titles, highlights.
  let story = null;
  let storyFailed = false;
  let mergedInto = {};
  let merged = 0;
  // The events each merge absorbed, as they were just before it (for an exact Undo).
  let mergedOriginals = [];
  const forStory = storyPayloadEvents(getEvents(), { trips, metasById, homeCountry, lang });
  if (storyPass && !stoppedBy && forStory.length) {
    // Big imports (e.g. one event per photo) go in consecutive chunks so every event is covered.
    const chunks = storyChunks(forStory, storyMaxEvents(limits));
    progress('story', 0, chunks.length);
    try {
      let res = null;
      for (const [i, chunk] of chunks.entries()) {
        let part;
        try {
          part = await api.draftPhotoStory({
            events: chunk, storyContext: context, instructions, people,
            home: home && homeCountry ? homeCountry : '', mode, existingTitle, lang, timelineId, importRunId, signal,
          });
        } catch (err) {
          // A later chunk failing keeps what the earlier chunks shaped.
          if (!res || isAbort(err)) throw err;
          storyFailed = true;
          if (isFatal(err)) stoppedBy = err;
          break;
        }
        credits += Number(part?.credits) || 0;
        res = combineStoryResults(res, part);
        progress('story', i + 1, chunks.length);
      }
      // Fixed grouping levels (one event per day / hour / photo): the user chose the split.
      if (!allowMerges && res) res = { ...res, merges: [] };
      story = res;
      // Applied to the latest events; the same pure function tells us what was merged.
      const preStory = getEvents();
      const applied = applyStoryPass(preStory, res, metasById);
      mergedInto = applied.mergedInto;
      merged = applied.merged;
      const touched = new Set([...Object.keys(mergedInto), ...Object.values(mergedInto)]);
      mergedOriginals = preStory.filter((e) => touched.has(String(e.id)));
      setEvents((prev) => applyStoryPass(prev, res, metasById).events);
    } catch (err) {
      if (isAbort(err)) return { credits, failedIds, story: null, mergedInto: {}, merged: 0, overview: '', stoppedBy: 'abort' };
      storyFailed = true;
      if (isFatal(err)) stoppedBy = err;
    }
  }

  // 3. Overview (a new timeline only).
  let overviewText = '';
  let overviewFailed = false;
  if (overview && mode === 'new' && !stoppedBy && forStory.length) {
    progress('overview', 0, 1);
    try {
      const after = applyStoryPass(getEvents(), story || {}, metasById).events;
      const chapters = storyChaptersToRows(story?.chapters || [], after, lang, mergedInto);
      const facts = overviewFacts({
        title: story?.timeline_title || '', kind: storyKind || story?.story_type || '', people, events: after, chapters, lang, homeCountry,
      });
      if (facts.moments.length) {
        const res = await api.draftStoryOverview({ story: facts, language: lang, timelineId, importRunId, signal });
        credits += Number(res?.credits) || 0;
        overviewText = typeof res?.overview === 'string' ? res.overview.trim() : '';
      }
    } catch (err) {
      if (isAbort(err)) return { credits, failedIds, story, mergedInto, merged, overview: '', stoppedBy: 'abort' };
      overviewFailed = true;
    }
    progress('overview', 1, 1);
  }

  return { credits, failedIds, story, storyFailed, mergedInto, merged, mergedOriginals, overview: overviewText, overviewFailed, stoppedBy };
}

/** Clips a story to the Studio's limit (used when the user edits it in the review). */
export const clipStory = (text) => String(text || '').slice(0, MOMENT_STORY_MAX);

// ---- Into the Studio ---------------------------------------------------------------------------

/**
 * The Studio story type for a timeline started from photos: the AI's story type when it named
 * everyone that type needs (names only ever come from the user's words - checked server-side),
 * else the local suggestion (a trip with its destination, or free-form).
 * Returns { key, people: {p1?, p2?}, lane? } (lane: where the photo moments go).
 */
export function photoImportBlueprint(story, suggestion) {
  const names = (story?.subjectNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const type = story?.storyType;
  if (type === 'trip' && names[0]) return { key: 'trip', people: { p1: names[0] } };
  if (type === 'child' && names[0]) return { key: 'child', people: { p1: names[0] } };
  if (type === 'lifeStory' && names[0]) return { key: 'lifeStory', people: { p1: names[0] } };
  if (type === 'couple' && names[0] && names[1]) return { key: 'couple', people: { p1: names[0], p2: names[1] }, lane: 'together' };
  if (suggestion?.blueprint === 'trip' && suggestion.destination) return { key: 'trip', people: { p1: suggestion.destination } };
  return { key: 'custom', people: {} };
}

/**
 * Studio answers for a timeline started from photos: the imported moments and chapters merged
 * into `base` (the blueprint's current answers), plus what the AI shaped - title, overview,
 * people, the lane's name - without overwriting anything the user already typed.
 *
 * @param {object} o
 * @param {object} o.blueprint  the chosen blueprint
 * @param {object} o.base       its current answers
 * @param {Array}  o.rows       moment rows (eventsToMoments)
 * @param {Array}  o.chapters   [{title, from, to}]
 * @param {object|null} o.story { aiAssisted, title, overview, laneTitle } from the panel
 * @param {object} o.choice     photoImportBlueprint(...)
 * @param {Function} o.newId    row id factory
 * @param {{customLane: string, customTitle: string}} o.labels
 */
export function photoStoryAnswers({ blueprint, base, rows, chapters, story = null, choice = {}, newId, labels }) {
  let a = { ...base };
  const laneRows = choice.lane ? rows.map((r) => ({ ...r, lane: r.lane || choice.lane })) : rows;
  const titles = new Set((a.chapters || []).map((c) => (c.title || '').trim()));
  const newChapters = (chapters || [])
    .filter((c) => c.title && !titles.has(c.title))
    .map((c) => ({ id: newId(), title: c.title, from: c.from, to: c.to }));
  a = { ...a, moments: [...(a.moments || []), ...laneRows], chapters: [...(a.chapters || []), ...newChapters] };
  const people = { ...(a.people || {}) };
  for (const [id, name] of Object.entries(choice.people || {})) if (!(people[id] || '').trim() && name) people[id] = name;
  a.people = people;
  if (blueprint.customLanes && !(a.customLanes || []).some((l) => (l.title || '').trim())) {
    a.customLanes = [{ id: 'lane-1', title: (story?.laneTitle || '').trim() || labels.customLane }];
  }
  if (!(a.title || '').trim()) {
    const aiTitle = (story?.title || '').trim();
    if (aiTitle) a.title = aiTitle;
    else if (blueprint.key === 'custom') a.title = labels.customTitle;
  }
  if (!(a.overview || '').trim() && (story?.overview || '').trim()) a.overview = story.overview.trim();
  if (story?.aiAssisted) a.aiAssisted = true;
  return a;
}
