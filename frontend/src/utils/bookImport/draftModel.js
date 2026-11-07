/**
 * Book import draft: the same review operations as backend/services/book_import/draft_ops.py (kept in
 * lockstep by backend/tests/fixtures/book_import/draft_ops_vectors.json), plus pure selectors for the
 * review workspace. The UI applies ops locally for instant feedback and sends the same ops to the
 * server, which re-applies them to its copy.
 */

export const MAX_OPS = 500;
const EVENT_PATCH_KEYS = new Set([
  'title', 'summary', 'narrative', 'from', 'to', 'isToPresent', 'circa', 'people', 'unresolvedPeople',
  'place', 'placeId', 'category', 'lane', 'rank', 'dateText',
]);
const DATE_FLAGS = ['undated', 'date_inferred', 'hebrew_mismatch'];

export class OpError extends Error {}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uniq = (arr) => [...new Set(arr)];

const events = (d) => (d.events ||= []);
const photos = (d) => (d.photos ||= []);

function findEvent(d, id) {
  const e = events(d).find((x) => x.id === id);
  if (!e) throw new OpError(`unknown event ${JSON.stringify(id)}`);
  return e;
}

function findPhoto(d, id) {
  const p = photos(d).find((x) => x.id === id);
  if (!p) throw new OpError(`unknown photo ${JSON.stringify(id)}`);
  return p;
}

function setFlags(e, flags) {
  e.flags = uniq(flags).sort();
  e.needsReview = e.flags.length > 0;
}

function removeFlags(e, ...names) {
  setFlags(e, (e.flags || []).filter((f) => !names.includes(f)));
}

function fixCover(e) {
  (e.photos || []).forEach((p, i) => { p.role = i === 0 ? 'cover' : 'gallery'; });
}

function detachPhoto(d, pid) {
  for (const e of events(d)) {
    const before = e.photos || [];
    const after = before.filter((p) => p.photoId !== pid);
    if (after.length !== before.length) {
      e.photos = after;
      fixCover(e);
    }
  }
}

function validDate(d) {
  if (d === null || d === undefined) return null;
  if (typeof d !== 'object' || !Number.isInteger(d.year)) throw new OpError('dates need an integer year');
  const precision = d.precision || (d.day ? 'day' : d.month ? 'month' : 'year');
  if (!['day', 'month', 'year', 'decade', 'century'].includes(precision)) throw new OpError(`bad precision ${precision}`);
  const out = { year: d.year, month: d.month ?? null, day: d.day ?? null, precision };
  if (out.month !== null && !(Number.isInteger(out.month) && out.month >= 1 && out.month <= 12)) throw new OpError('bad month');
  if (out.day !== null && !(Number.isInteger(out.day) && out.day >= 1 && out.day <= 31)) throw new OpError('bad day');
  return out;
}

export function applyOp(d, op) {
  const kind = op?.op;
  switch (kind) {
    case 'event.update': {
      const e = findEvent(d, op.id);
      const patch = op.patch || {};
      const unknown = Object.keys(patch).filter((k) => !EVENT_PATCH_KEYS.has(k));
      if (unknown.length) throw new OpError(`cannot edit ${unknown.sort().join(',')}`);
      for (const [k, raw] of Object.entries(patch)) {
        let v = raw;
        if (k === 'from' || k === 'to') v = validDate(v);
        if (k === 'rank') v = Math.max(1, Math.min(10, parseInt(v, 10)));
        e[k] = clone(v);
      }
      if ('from' in patch || 'to' in patch || 'dateText' in patch) {
        removeFlags(e, ...DATE_FLAGS);
        if (e.from === null || e.from === undefined) setFlags(e, [...(e.flags || []), 'undated']);
      }
      if ('place' in patch || 'placeId' in patch) removeFlags(e, 'place_uncertain');
      if ('people' in patch || 'unresolvedPeople' in patch) removeFlags(e, 'unresolved_people');
      break;
    }
    case 'event.markReviewed':
      for (const id of op.ids || []) setFlags(findEvent(d, id), []);
      break;
    case 'event.setStatus': {
      if (!['accepted', 'rejected'].includes(op.status)) throw new OpError('status must be accepted or rejected');
      for (const id of op.ids || []) findEvent(d, id).status = op.status;
      break;
    }
    case 'event.merge': {
      const target = findEvent(d, op.targetId);
      const sources = (op.sourceIds || []).filter((id) => id !== target.id).map((id) => findEvent(d, id));
      for (const s of sources) {
        const have = new Set((target.photos || []).map((p) => p.photoId));
        target.photos = [...(target.photos || []), ...(s.photos || []).filter((p) => !have.has(p.photoId))];
        const refs = new Set((target.sourceRefs || []).map((r) => `${r.unit}\u0000${r.snippet}`));
        target.sourceRefs = [...(target.sourceRefs || []), ...(s.sourceRefs || []).filter((r) => !refs.has(`${r.unit}\u0000${r.snippet}`))];
        target.people = uniq([...(target.people || []), ...(s.people || [])]);
        target.mergedFrom = uniq([...(target.mergedFrom || []), s.id, ...(s.mergedFrom || [])]);
        for (const p of photos(d)) {
          if (p.eventId === s.id) p.eventId = target.id;
          if (p.suggestedEventId === s.id) p.suggestedEventId = target.id;
        }
      }
      fixCover(target);
      removeFlags(target, 'possible_duplicate');
      const drop = new Set(sources.map((s) => s.id));
      d.events = events(d).filter((e) => !drop.has(e.id));
      break;
    }
    case 'event.create': {
      const ev = clone(op.event || {});
      if (!ev.id || !ev.title) throw new OpError('a new event needs an id and a title');
      if (events(d).some((e) => e.id === ev.id)) throw new OpError('duplicate event id');
      ev.from = validDate(ev.from);
      ev.to = validDate(ev.to);
      ev.status ??= 'accepted';
      ev.photos ??= [];
      ev.sourceRefs ??= [];
      ev.people ??= [];
      setFlags(ev, ev.from ? [] : ['undated']);
      events(d).push(ev);
      break;
    }
    case 'photo.assign': {
      const p = findPhoto(d, op.photoId);
      const e = findEvent(d, op.eventId);
      detachPhoto(d, p.id);
      const entry = { photoId: p.id, role: 'gallery', confidence: 'high' };
      e.photos ||= [];
      if (op.role === 'cover') e.photos.unshift(entry); else e.photos.push(entry);
      fixCover(e);
      Object.assign(p, { status: 'linked', eventId: e.id, confidence: 'high', suggestedEventId: null });
      break;
    }
    case 'photo.unassign':
      for (const pid of op.photoIds || []) {
        const p = findPhoto(d, pid);
        detachPhoto(d, pid);
        Object.assign(p, { status: 'tray', eventId: null });
      }
      break;
    case 'photo.exclude': {
      const excluded = op.excluded === undefined ? true : Boolean(op.excluded);
      for (const pid of op.photoIds || []) {
        const p = findPhoto(d, pid);
        if (excluded) {
          detachPhoto(d, pid);
          Object.assign(p, { status: 'excluded', eventId: null });
        } else if (p.status === 'excluded') {
          p.status = 'tray';
        }
      }
      break;
    }
    case 'photo.reorder': {
      const e = findEvent(d, op.eventId);
      const order = [...(op.photoIds || [])];
      const current = new Map((e.photos || []).map((p) => [p.photoId, p]));
      if (order.length !== current.size || !order.every((id) => current.has(id)) || new Set(order).size !== order.length) {
        throw new OpError("reorder must list exactly the event's photos");
      }
      e.photos = order.map((id) => current.get(id));
      fixCover(e);
      break;
    }
    case 'person.rename': {
      const name = String(op.name || '').trim();
      if (!name) throw new OpError('a name is required');
      const c = (d.cast ||= []).find((x) => x.id === op.id);
      if (!c) throw new OpError(`unknown person ${JSON.stringify(op.id)}`);
      c.name = name.slice(0, 200);
      break;
    }
    case 'person.merge': {
      const cast = (d.cast ||= []);
      const target = cast.find((c) => c.id === op.targetId);
      if (!target) throw new OpError(`unknown person ${JSON.stringify(op.targetId)}`);
      const sources = (op.sourceIds || []).filter((id) => id !== op.targetId);
      for (const c of cast) {
        if (sources.includes(c.id)) target.aliases = uniq([...(target.aliases || []), c.name, ...(c.aliases || [])]);
      }
      d.cast = cast.filter((c) => !sources.includes(c.id));
      for (const e of events(d)) {
        if ((e.people || []).some((id) => sources.includes(id))) {
          e.people = uniq(e.people.map((id) => (sources.includes(id) ? op.targetId : id)));
        }
      }
      break;
    }
    case 'person.resolveAlias': {
      if (!(d.cast || []).some((c) => c.id === op.personId)) throw new OpError(`unknown person ${JSON.stringify(op.personId)}`);
      for (const id of op.eventIds || []) {
        const e = findEvent(d, id);
        e.unresolvedPeople = (e.unresolvedPeople || []).filter((n) => n !== op.alias);
        if (!(e.people || []).includes(op.personId)) (e.people ||= []).push(op.personId);
        removeFlags(e, 'unresolved_people');
      }
      break;
    }
    case 'lane.upsert': {
      const lane = op.lane || {};
      if (!lane.id || !String(lane.title || '').trim()) throw new OpError('a lane needs an id and a title');
      const lanes = (d.lanes ||= []);
      const existing = lanes.find((l) => l.id === lane.id);
      if (existing) {
        for (const k of ['title', 'color']) if (k in lane) existing[k] = lane[k];
      } else {
        if (lanes.length >= 12) throw new OpError('too many lanes');
        lanes.push({ id: lane.id, title: lane.title, color: lane.color ?? null });
      }
      break;
    }
    case 'lane.delete': {
      const lanes = (d.lanes ||= []);
      if (!lanes.some((l) => l.id === op.id)) throw new OpError(`unknown lane ${JSON.stringify(op.id)}`);
      if (lanes.length <= 1) throw new OpError("the last lane can't be deleted");
      if (!lanes.some((l) => l.id === op.reassignTo && l.id !== op.id)) throw new OpError('reassignTo must be another lane');
      d.lanes = lanes.filter((l) => l.id !== op.id);
      for (const e of events(d)) if (e.lane === op.id) e.lane = op.reassignTo;
      break;
    }
    case 'chapter.rename': {
      const ch = (d.chapters ||= []).find((c) => c.id === op.id);
      if (!ch) throw new OpError(`unknown chapter ${JSON.stringify(op.id)}`);
      ch.title = String(op.title || ch.title).slice(0, 300);
      break;
    }
    case 'chapter.setStatus': {
      if (!['accepted', 'rejected'].includes(op.status)) throw new OpError('status must be accepted or rejected');
      const ch = (d.chapters ||= []).find((c) => c.id === op.chapterId);
      if (!ch) throw new OpError(`unknown chapter ${JSON.stringify(op.chapterId)}`);
      ch.status = op.status;
      for (const e of events(d)) if (e.chapterId === op.chapterId) e.status = op.status;
      break;
    }
    case 'timeline.update':
      for (const k of ['title', 'description', 'overview']) {
        if (k in op) d[k] = String(op[k] || '').slice(0, k === 'title' ? 600 : 80000);
      }
      break;
    default:
      throw new OpError(`unknown op ${JSON.stringify(kind)}`);
  }
}

/** Applies ops to a copy (all or nothing), like the server. */
export function applyOps(draft, ops) {
  if (ops.length > MAX_OPS) throw new OpError(`at most ${MAX_OPS} operations per request`);
  const out = clone(draft);
  for (const op of ops) {
    if (!op || typeof op !== 'object') throw new OpError('each operation must be an object');
    applyOp(out, op);
  }
  out.stats ||= {};
  out.stats.events = (out.events || []).length;
  out.stats.needsReview = (out.events || []).filter((e) => e.needsReview && e.status === 'accepted').length;
  return out;
}

// ---------------------------------------------------------------------------- selectors

export const FILTERS = ['all', 'needsReview', 'inferred', 'hebrew', 'undated', 'duplicates', 'lowPhoto', 'albums', 'rejected'];

const FILTER_TESTS = {
  all: (e) => e.status !== 'rejected',
  needsReview: (e) => e.status !== 'rejected' && e.needsReview,
  inferred: (e) => e.status !== 'rejected' && (e.flags || []).includes('date_inferred'),
  hebrew: (e) => e.status !== 'rejected' && (e.dateBasis === 'hebrew' || (e.flags || []).includes('hebrew_mismatch')),
  undated: (e) => e.status !== 'rejected' && !e.from,
  duplicates: (e) => e.status !== 'rejected' && (e.flags || []).includes('possible_duplicate'),
  lowPhoto: (e) => e.status !== 'rejected' && (e.flags || []).includes('low_photo_confidence'),
  albums: (e) => e.status !== 'rejected' && (e.flags || []).includes('photo_album'),
  rejected: (e) => e.status === 'rejected',
};

const norm = (s) => String(s || '')
  .normalize('NFKD')
  .replace(/[֑-ׇ]/g, '') // Hebrew niqqud / cantillation
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

export function matchesSearch(e, query, castById) {
  const q = norm(query).trim();
  if (!q) return true;
  const hay = [e.title, e.summary, e.dateText, e.place?.name, ...(e.people || []).map((id) => castById?.[id]?.name), ...(e.unresolvedPeople || [])]
    .map(norm).join(' \u0001 ');
  return q.split(/\s+/).every((part) => hay.includes(part));
}

export function filterCounts(draft) {
  const out = {};
  for (const f of FILTERS) out[f] = (draft?.events || []).filter(FILTER_TESTS[f]).length;
  return out;
}

/** Events grouped by chapter, in chapter order (events outside any chapter go last). */
export function groupedEvents(draft, { filter = 'all', query = '', laneId = null } = {}) {
  const castById = Object.fromEntries((draft?.cast || []).map((c) => [c.id, c]));
  const test = FILTER_TESTS[filter] || FILTER_TESTS.all;
  const chapters = draft?.chapters || [];
  const groups = new Map(chapters.map((c) => [c.id, { chapter: c, events: [] }]));
  const loose = { chapter: null, events: [] };
  for (const e of draft?.events || []) {
    if (!test(e) || (laneId && e.lane !== laneId) || !matchesSearch(e, query, castById)) continue;
    (groups.get(e.chapterId) || loose).events.push(e);
  }
  const out = [...groups.values()].filter((g) => g.events.length);
  if (loose.events.length) out.push(loose);
  return out;
}

export function trayPhotos(draft) {
  return (draft?.photos || []).filter((p) => p.status === 'tray');
}

export function photoById(draft) {
  return Object.fromEntries((draft?.photos || []).map((p) => [p.id, p]));
}

export function eventById(draft) {
  return Object.fromEntries((draft?.events || []).map((e) => [e.id, e]));
}

/** What Create will produce: accepted, dated events (in accepted chapters) and their photos. */
export function finalizeSummary(draft) {
  const rejectedChapters = new Set((draft?.chapters || []).filter((c) => c.status === 'rejected').map((c) => c.id));
  const kept = (draft?.events || []).filter((e) => e.status === 'accepted' && e.from && !rejectedChapters.has(e.chapterId));
  const excluded = new Set((draft?.photos || []).filter((p) => p.status === 'excluded').map((p) => p.id));
  const photoIds = new Set();
  for (const e of kept) for (const p of e.photos || []) if (!excluded.has(p.photoId)) photoIds.add(p.photoId);
  return {
    events: kept.length,
    flagged: kept.filter((e) => e.needsReview).length,
    undatedSkipped: (draft?.events || []).filter((e) => e.status === 'accepted' && !e.from).length,
    photos: photoIds.size,
    trayLeft: (draft?.photos || []).filter((p) => p.status === 'tray').length,
  };
}

export function formatDraftDate(d, lang = 'en') {
  if (!d) return '';
  const { year, month, day, precision } = d;
  if (precision === 'century') return lang === 'he' ? `המאה ה-${Math.floor(year / 100) + 1}` : `${Math.floor(year / 100) + 1}th century`;
  if (precision === 'decade') return lang === 'he' ? `שנות ה-${year % 100 === 0 ? year : String(year).slice(-2)}` : `${year}s`;
  if (precision === 'day' && month && day) return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
  if ((precision === 'day' || precision === 'month') && month) return `${String(month).padStart(2, '0')}.${year}`;
  return String(year);
}

let tempCounter = 0;
export function newEventId() {
  tempCounter += 1;
  return `bk-u${Date.now().toString(36)}${tempCounter}`;
}
