// Per-timeline save queue with optimistic concurrency (B-04). Pure: api.js injects the network
// calls and the merge, so node tests drive it with fakes.
//
// - At most one save per timeline id is in flight; saves queued meanwhile coalesce to the latest
//   state (every caller's promise settles with the result of the save that carried its state).
// - Each save sends `baseUpdatedAt`: the version the server last acknowledged for that id.
// - On 409 `stale_write` the server's latest copy is fetched, three-way merged by event id with
//   what we tried to save (base = the last acknowledged copy), and saved once more. If that fails
//   too, the latest server copy is reported as `reloaded` so the UI can show it with a notice.
// - On 410 the timeline was deleted: the id is marked gone and later saves are refused.
//
// Events (onEvent): { type: 'saved' | 'merged' | 'reloaded' | 'gone', id, ... }

export const STALE_WRITE_CODE = 'stale_write';
const MAX_KNOWN_VERSIONS = 50;

export function isStaleWriteError(err) {
  return Boolean(err) && err.status === 409 && (err.code === STALE_WRITE_CODE || err.body?.code === STALE_WRITE_CODE);
}

export function isTimelineGoneError(err) {
  return Boolean(err) && err.status === 410;
}

// A save with no events is answered 422 { code: 'empty_timeline' } and nothing is stored (B-18).
export const EMPTY_TIMELINE_CODE = 'empty_timeline';

export function isEmptyTimelineError(err) {
  return Boolean(err) && err.status === 422 && (err.code === EMPTY_TIMELINE_CODE || err.body?.code === EMPTY_TIMELINE_CODE);
}

// A generation's preview (titles and dates before images and links are added, P-03) is shown
// read-only while the job finishes and must never be stored: the finished result replaces it.
export const PARTIAL_TIMELINE_CODE = 'partial_timeline';

export function isPartialTimeline(timeline) {
  return Boolean(timeline && typeof timeline === 'object' && timeline.isPartial === true);
}

const makePartialError = () => {
  const err = new Error('This timeline is still being created and cannot be saved yet.');
  err.code = PARTIAL_TIMELINE_CODE;
  return err;
};

const makeGoneError = () => {
  const err = new Error('This timeline was deleted.');
  err.status = 410;
  err.code = 'timeline_deleted';
  return err;
};

/**
 * deps:
 *  - send(timeline, { baseUpdatedAt }) -> Promise<savedTimeline>   (rejects with err.status / err.code)
 *  - fetchLatest(id) -> Promise<timeline>
 *  - merge(base, local, remote) -> timeline
 *  - onEvent(event)                                                 optional
 */
export function createTimelineSaveQueue({ send, fetchLatest, merge, onEvent = () => {} }) {
  const states = new Map();

  const stateFor = (id) => {
    let s = states.get(id);
    if (!s) {
      s = { ackVersion: null, ackSnapshot: null, known: new Set(), inFlight: false, pending: null, gone: false };
      states.set(id, s);
    }
    return s;
  };

  const remember = (s, version) => {
    if (!version) return;
    s.known.delete(version);
    s.known.add(version);
    while (s.known.size > MAX_KNOWN_VERSIONS) s.known.delete(s.known.values().next().value);
  };

  const setAck = (s, timeline, version) => {
    s.ackVersion = version || null;
    s.ackSnapshot = timeline ? { ...timeline, updatedAt: version || timeline.updatedAt } : null;
    remember(s, version);
  };

  const emit = (event) => {
    try {
      onEvent(event);
    } catch (err) {
      console.warn('Save queue listener failed:', err);
    }
  };

  // A copy whose `updatedAt` the queue has never seen was loaded from the server independently
  // (opened, refreshed, AI result): its own version is the right base. Otherwise use the last ack.
  const baseFor = (s, timeline) => {
    const own = timeline?.updatedAt || null;
    if (own && !s.known.has(own)) {
      setAck(s, timeline, own);
      return own;
    }
    return s.ackVersion || own;
  };

  const savedVersion = (saved, fallback) => (saved && typeof saved === 'object' && saved.updatedAt) || fallback || null;

  const markGone = (id, s) => {
    s.gone = true;
    const pending = s.pending;
    s.pending = null;
    pending?.waiters.forEach((w) => w.reject(makeGoneError()));
    emit({ type: 'gone', id });
  };

  async function saveWithMerge(id, s, local) {
    const base = baseFor(s, local);
    const baseSnapshot = s.ackSnapshot;
    let staleErr;
    try {
      const saved = await send(local, { baseUpdatedAt: base });
      setAck(s, local, savedVersion(saved, base));
      emit({ type: 'saved', id, saved, sent: local });
      return saved;
    } catch (err) {
      if (isTimelineGoneError(err)) {
        markGone(id, s);
        throw err;
      }
      if (!isStaleWriteError(err)) throw err;
      staleErr = err;
    }

    // Someone else saved this timeline since our base: merge their copy with ours, try once more.
    let latest;
    try {
      latest = await fetchLatest(id);
    } catch {
      throw staleErr;
    }
    if (!latest) throw staleErr;
    const mergedLocal = { ...merge(baseSnapshot, local, latest), updatedAt: latest?.updatedAt ?? null };
    try {
      const saved = await send(mergedLocal, { baseUpdatedAt: latest?.updatedAt ?? null });
      const version = savedVersion(saved, latest?.updatedAt);
      const merged = { ...mergedLocal, updatedAt: version };
      setAck(s, merged, version);
      if (s.pending) {
        // A newer local state queued meanwhile was built on `local`: carry the other writer's changes into it.
        s.pending.timeline = { ...merge(local, s.pending.timeline, merged), updatedAt: version };
      }
      emit({ type: 'merged', id, saved, sent: local, merged });
      return saved;
    } catch (err) {
      if (isTimelineGoneError(err)) {
        markGone(id, s);
        throw err;
      }
      // Still conflicting (or failing): show the server's copy rather than silently dropping a side.
      let fresh = latest;
      try {
        fresh = (await fetchLatest(id)) || latest;
      } catch { /* keep the copy we already have */ }
      setAck(s, fresh, fresh?.updatedAt);
      const pending = s.pending;
      s.pending = null;
      pending?.waiters.forEach((w) => w.reject(err));
      emit({ type: 'reloaded', id, latest: fresh, error: err });
      throw err;
    }
  }

  async function pump(id, s) {
    s.inFlight = true;
    try {
      while (s.pending) {
        const job = s.pending;
        s.pending = null;
        try {
          const saved = await saveWithMerge(id, s, job.timeline);
          job.waiters.forEach((w) => w.resolve(saved));
        } catch (err) {
          job.waiters.forEach((w) => w.reject(err));
        }
      }
    } finally {
      s.inFlight = false;
    }
  }

  return {
    /** Queue a save of this full timeline state; resolves with the server's saved copy. */
    enqueue(timeline) {
      if (isPartialTimeline(timeline)) return Promise.reject(makePartialError());
      const id = timeline?.id;
      if (!id) return send(timeline, { baseUpdatedAt: null });
      const s = stateFor(String(id));
      if (s.gone) return Promise.reject(makeGoneError());
      return new Promise((resolve, reject) => {
        if (s.pending) {
          s.pending.timeline = timeline;
          s.pending.waiters.push({ resolve, reject });
        } else {
          s.pending = { timeline, waiters: [{ resolve, reject }] };
        }
        if (!s.inFlight) pump(String(id), s);
      });
    },

    /** Record a copy fresh from the server (a load or a server-side AI save) as the new base. */
    noteServerState(timeline) {
      if (!timeline?.id || !timeline.updatedAt) return;
      const s = stateFor(String(timeline.id));
      s.gone = false; // the server just served it, so it exists
      setAck(s, timeline, timeline.updatedAt);
    },

    /** The version a save of `timeline` would send as its base right now. */
    baseVersionFor(timeline) {
      if (!timeline?.id) return timeline?.updatedAt || null;
      const s = states.get(String(timeline.id));
      if (!s) return timeline.updatedAt || null;
      const own = timeline.updatedAt || null;
      return own && !s.known.has(own) ? own : (s.ackVersion || own);
    },

    /** The timeline was deleted (e.g. from the Saved list): refuse further saves for it. */
    markDeleted(id) {
      if (!id) return;
      markGone(String(id), stateFor(String(id)));
    },

    isGone(id) {
      return Boolean(id && states.get(String(id))?.gone);
    },

    /** True while a save for this id is in flight or queued. */
    isBusy(id) {
      const s = id ? states.get(String(id)) : null;
      return Boolean(s && (s.inFlight || s.pending));
    },
  };
}

// P-09: saves ask for `?return=minimal`, so the server answers with only its own fields (new
// `updatedAt`, `createdAt`, the Library flags it decided) instead of echoing the whole document.
// The saved copy is what we sent plus those fields. An older backend ignores the parameter and
// still returns the full timeline, which is used as is.
export const MINIMAL_SAVE_QUERY = 'return=minimal';

export function mergeMinimalSaveResponse(sent, response) {
  if (!response || typeof response !== 'object' || response.minimal !== true) return response;
  const { minimal: _minimal, ...fields } = response;
  return { ...(sent || {}), ...fields };
}
