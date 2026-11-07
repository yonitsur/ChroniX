// Pure polling core for background AI jobs (no Supabase / Vite imports, so node tests can drive it).
// api.js wires in the real fetch, auth headers, cancel call and visibility-aware delay.

export const AI_JOB_MAX_VISIBLE_WAIT_MS = 5 * 60 * 1000;
export const AI_JOB_TIMEOUT_MESSAGE = 'Request timed out. Please try again.';
// Transient failures (network, 5xx, 401/403/429, malformed body) tolerated once the budget is spent,
// so a radio still reconnecting on resume doesn't turn a finished job into a timeout.
const FINAL_POLL_ATTEMPTS = 3;

// Long poll (SC-02): the server holds a status request up to this long until something changes.
export const AI_JOB_LONG_POLL_SECONDS = 20;
// A held request needs a fetch timeout comfortably above the hold.
const LONG_POLL_TIMEOUT_SLACK_MS = 10000;
// After this many failed long polls in a row (a proxy cutting idle requests, say) the job is
// polled the short way for the rest of its life.
const LONG_POLL_FAILURES_BEFORE_SHORT_POLLING = 2;
// The server reports how long it held the answer; anything shorter means it did not long-poll.
const LONG_POLL_MIN_HELD_MS = 1000;
// Short polling (old backend, or long polling given up) backs off 1 -> 2 -> 4 -> 5 s.
const SHORT_POLL_DELAYS_MS = [1000, 2000, 4000];
const SHORT_POLL_MAX_DELAY_MS = 5000;
const SHORT_POLL_JITTER = 0.2;
// A queued / pending answer that brought news is followed up quickly.
const NEWS_FOLLOW_UP_MS = 250;

/** Error code of a job the server stopped itself (queue or run-time deadline, SC-19): not a user cancel. */
export const AI_JOB_SERVER_TIMEOUT_CODE = 'server_timeout';

// Place-in-line updates of every polled job (SC-07), for the loading UI. `info` is
// { jobId, position, ahead } while queued, and { jobId, position: 0, ahead: 0 } once started or finished.
const queueListeners = new Set();

export function subscribeAiJobQueue(listener) {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

export function publishAiJobQueue(jobId, info) {
  const payload = { jobId, position: info?.position || 0, ahead: info?.ahead || 0 };
  queueListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch { /* a UI listener must never break polling */ }
  });
}

/** Query string of a job status poll: preview revision seen, long-poll hold (SC-02), queue place seen. */
export function jobStatusQuery({ partialRev = 0, wait = 0, position = 0 } = {}) {
  const params = new URLSearchParams();
  if (partialRev) params.set('partial_rev', String(partialRev));
  if (wait) params.set('wait', String(wait));
  if (position) params.set('position', String(position));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Short-poll delay for the `attempt`-th quiet poll in a row (0-based), with +/-20 % jitter. */
export function shortPollDelayMs(attempt, random = Math.random) {
  const base = attempt < SHORT_POLL_DELAYS_MS.length ? SHORT_POLL_DELAYS_MS[attempt] : SHORT_POLL_MAX_DELAY_MS;
  const jittered = base * (1 - SHORT_POLL_JITTER + 2 * SHORT_POLL_JITTER * random());
  return Math.round(Math.min(SHORT_POLL_MAX_DELAY_MS, jittered));
}

const makeAbortError = () => {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

/**
 * Turns a FastAPI `detail` (string, 422 validation array, or object) into a readable message.
 * Never returns "[object Object]".
 */
export function formatApiError(detail, fallback = 'Request failed') {
  if (typeof detail === 'string') return detail.trim() || fallback;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const msg = typeof item.msg === 'string' ? item.msg : (typeof item.message === 'string' ? item.message : '');
        const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
        return msg && loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join('; ') : fallback;
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message.trim()) return detail.message.trim();
    if (typeof detail.msg === 'string' && detail.msg.trim()) return detail.msg.trim();
    if (typeof detail.detail === 'string' && detail.detail.trim()) return detail.detail.trim();
  }
  return fallback;
}

// Keep in sync with the PromptBar `maxLength` and GenerateTimelineRequest.prompt (3,000 characters).
export const PROMPT_MAX_LENGTH = 3000;

/** A prompt from outside the PromptBar (e.g. the `?prompt=` link) cut to what the bar accepts (B-21). */
export function clampPromptText(text, max = PROMPT_MAX_LENGTH) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * What a Stop left behind (B-16): a job cancelled after the model answered may still have saved its
 * timeline (the server lets a save that already started finish). Returns { timelineId } when the
 * cancel response says this timeline was saved, else null.
 */
export function savedTimelineFromCancel(cancelResponse, expectedTimelineId = null) {
  if (!cancelResponse || typeof cancelResponse !== 'object') return null;
  const timelineId = typeof cancelResponse.timeline_id === 'string' ? cancelResponse.timeline_id : null;
  if (!timelineId || cancelResponse.persisted !== true) return null;
  if (expectedTimelineId != null && String(expectedTimelineId) !== timelineId) return null;
  return { timelineId };
}

/** Parses a Retry-After header (seconds or HTTP date) into whole seconds, or null. */
export function parseRetryAfterSeconds(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Elapsed time that only counts while the document is visible. Mobile browsers freeze a
 * backgrounded tab's timers, so wall-clock time would make a phone that was away for six
 * minutes time out the instant it comes back.
 */
export function createVisibleElapsedClock({ now = Date.now, doc = globalThis.document } = {}) {
  const startedAt = now();
  let hiddenMs = 0;
  let hiddenSince = doc?.visibilityState === 'hidden' ? startedAt : null;
  const onChange = () => {
    const t = now();
    if (doc.visibilityState === 'hidden') {
      if (hiddenSince === null) hiddenSince = t;
    } else if (hiddenSince !== null) {
      hiddenMs += Math.max(0, t - hiddenSince);
      hiddenSince = null;
    }
  };
  doc?.addEventListener?.('visibilitychange', onChange);
  return {
    elapsed() {
      const t = now();
      const hiddenNow = hiddenSince !== null ? Math.max(0, t - hiddenSince) : 0;
      return Math.max(0, t - startedAt - hiddenMs - hiddenNow);
    },
    dispose() {
      doc?.removeEventListener?.('visibilitychange', onChange);
    },
  };
}

/**
 * Poll a background AI job until it finishes.
 *
 * deps:
 *  - fetchStatus(jobId, fetchSignal) -> Response
 *  - cancelJob(jobId)               (fire-and-forget)
 *  - delay(ms, signal)              (rejects with AbortError when `signal` aborts)
 *  - clock                          ({ elapsed(), dispose() }, defaults to a visible-time clock)
 *  - recoverResult(timelineId)      optional: turns a saved timeline into this job kind's result
 *  - onTimelineInfo({ timelineId, persisted }) optional: called when the job's timeline id/state changes
 *  - knownTimeline                  optional { timelineId, persisted } remembered from an earlier poll
 *  - onPartial(partialTimeline)     optional: a pending generation's timeline before images and links
 *                                   are added (P-03). Called once per new revision, never after the
 *                                   job finished. A preview only: never save it.
 *  - onQueued({ position, ahead })  optional: the job waits for server capacity (SC-07); called on
 *                                   every place-in-line change, and with null once it has started.
 *  - longPollSeconds                how long the server may hold each status request (0: short polls)
 *
 * fetchStatus also receives { partialRev, wait, position }: the newest preview revision seen (so
 * the server can leave out a preview the client already has), the long-poll hold in seconds, and
 * the last queue position seen (so a held request returns as soon as it changes).
 *
 * Time spent waiting in the server's queue does not count against maxWaitMs (the server bounds it).
 * A job the server stopped (code 'server_timeout') rejects with err.code === 'server_timeout' and
 * err.serverTimeout === true; it is never reported as the user's cancel.
 */
export async function pollAiJobCore(jobId, {
  signal = null,
  errorFallback = 'Request failed',
  fetchStatus,
  cancelJob = () => {},
  delay,
  clock = null,
  maxWaitMs = AI_JOB_MAX_VISIBLE_WAIT_MS,
  pollTimeoutMs = 10000,
  recoverResult = null,
  onTimelineInfo = null,
  knownTimeline = null,
  onPartial = null,
  onQueued = null,
  longPollSeconds = AI_JOB_LONG_POLL_SECONDS,
  random = Math.random,
} = {}) {
  const ownClock = clock || createVisibleElapsedClock();
  let timelineId = knownTimeline?.timelineId || null;
  let persisted = Boolean(timelineId && knownTimeline?.persisted);
  let consecutive401Count = 0;
  let consecutive404Count = 0;
  let consecutive403Count = 0;
  let finalAttemptsLeft = FINAL_POLL_ATTEMPTS;
  let partialRev = 0;
  let queuePosition = 0;
  // Visible time spent waiting in the server's queue does not count against maxWaitMs.
  let queuedVisibleMs = 0;
  let queuedSince = null;
  let longPollFailures = 0;
  let longPollEnabled = longPollSeconds > 0;
  let quietPolls = 0;

  // Returns true when the place in line changed (or the job left the queue).
  const noteQueue = (data) => {
    const queued = data?.status === 'queued';
    const now = ownClock.elapsed();
    if (queued && queuedSince === null) queuedSince = now;
    if (!queued && queuedSince !== null) {
      queuedVisibleMs += Math.max(0, now - queuedSince);
      queuedSince = null;
    }
    const position = queued ? Math.max(1, Number(data.position) || 1) : 0;
    if (position === queuePosition) return false;
    queuePosition = position;
    try {
      onQueued?.(queued ? { position, ahead: Math.max(0, Number(data.ahead ?? position - 1) || 0) } : null);
    } catch { /* bookkeeping must never break polling */ }
    return true;
  };

  const runningElapsed = () => {
    const now = ownClock.elapsed();
    const queuedNow = queuedSince !== null ? Math.max(0, now - queuedSince) : 0;
    return now - queuedVisibleMs - queuedNow;
  };

  // Returns true when a new preview revision arrived.
  const notePartial = (data) => {
    if (!data || data.status !== 'pending') return false;
    const rev = Number(data.partial_rev) || 0;
    const partial = data.partial;
    if (!rev || rev <= partialRev || !partial || typeof partial !== 'object' || !Array.isArray(partial.articles)) return false;
    partialRev = rev;
    if (typeof onPartial !== 'function') return true;
    try {
      onPartial(partial);
    } catch (err) {
      console.warn('Partial AI result callback failed:', err?.message || err);
    }
    return true;
  };

  const noteTimeline = (data) => {
    if (!data || typeof data.timeline_id !== 'string' || !data.timeline_id) return;
    const nextPersisted = Boolean(data.persisted);
    if (data.timeline_id === timelineId && nextPersisted === persisted) return;
    timelineId = data.timeline_id;
    persisted = nextPersisted;
    try {
      onTimelineInfo?.({ timelineId, persisted });
    } catch { /* bookkeeping must never break polling */ }
  };

  const tagWithTimeline = (err) => {
    if (timelineId) {
      err.timelineId = timelineId;
      err.persisted = persisted;
    }
    return err;
  };

  // The job's own result is gone (expired / errored after saving), but its timeline is already
  // saved server-side: hand the caller the saved copy instead of an error. Otherwise throw `err`,
  // tagged with the timeline id so the UI can still point at it.
  const recoverOrThrow = async (err) => {
    tagWithTimeline(err);
    if (!persisted || !timelineId || typeof recoverResult !== 'function') throw err;
    let recovered;
    try {
      recovered = await recoverResult(timelineId);
    } catch (recoverErr) {
      console.warn('Could not load the saved timeline for an AI job:', recoverErr?.message || recoverErr);
      throw err;
    }
    if (recovered === null || recovered === undefined) throw err;
    return recovered;
  };

  const timeoutError = () => {
    // Never cancel a job whose timeline is already saved: there is nothing left to refund.
    if (!persisted) cancelJob(jobId);
    return tagWithTimeline(new Error(AI_JOB_TIMEOUT_MESSAGE));
  };

  const abort = () => {
    cancelJob(jobId);
    return makeAbortError();
  };

  const waitMs = async (ms) => {
    try {
      await delay(ms, signal);
    } catch (err) {
      if (signal?.aborted) throw abort();
      throw err;
    }
  };

  // Returns true to keep polling (after waiting), false if the final-attempt allowance is used up.
  const retryAfter = async (ms, finalAttempt) => {
    if (finalAttempt && --finalAttemptsLeft <= 0) return false;
    await waitMs(ms);
    return true;
  };

  try {
    while (true) {
      if (signal?.aborted) throw abort();

      const finalAttempt = runningElapsed() > maxWaitMs;
      // The last allowed poll answers at once: the visible-time budget is already spent.
      const wait = longPollEnabled && !finalAttempt ? longPollSeconds : 0;

      // Individual poll timeout: a half-open mobile socket aborts this fetch instead of hanging.
      const pollController = new AbortController();
      const pollTimeoutId = setTimeout(
        () => pollController.abort(),
        wait > 0 ? Math.max(pollTimeoutMs, wait * 1000 + LONG_POLL_TIMEOUT_SLACK_MS) : pollTimeoutMs,
      );
      const onParentAbort = () => pollController.abort();
      signal?.addEventListener?.('abort', onParentAbort, { once: true });

      let res;
      try {
        res = await fetchStatus(jobId, pollController.signal, { partialRev, wait, position: queuePosition });
        if (wait > 0) longPollFailures = 0;
      } catch (fetchErr) {
        if (signal?.aborted) throw abort();
        if (wait > 0 && ++longPollFailures >= LONG_POLL_FAILURES_BEFORE_SHORT_POLLING) {
          // Something between us and the server drops held requests: poll the short way instead.
          longPollEnabled = false;
        }
        console.warn('Transient poll network glitch, retrying...', fetchErr?.message || fetchErr);
        if (!(await retryAfter(2000, finalAttempt))) {
          return await recoverOrThrow(timeoutError());
        }
        continue;
      } finally {
        clearTimeout(pollTimeoutId);
        signal?.removeEventListener?.('abort', onParentAbort);
      }

      if (!res.ok) {
        const status = res.status;
        if (status === 404 && (finalAttempt || ++consecutive404Count > 5)) {
          const body = await res.json().catch(() => ({}));
          return await recoverOrThrow(new Error(formatApiError(body?.detail, errorFallback)));
        }
        let waitMs = null;
        if (status >= 500) waitMs = 2000;
        // Supabase may take 1-3 s to refresh the session token when a mobile tab wakes up.
        else if (status === 401 && ++consecutive401Count <= 7) waitMs = 2000;
        // Slight job registration / replication delay.
        else if (status === 404) waitMs = 2000;
        // A guest who signs in mid-job switches user ids; the guest-claim request hands the job over.
        else if (status === 403 && ++consecutive403Count <= 4) waitMs = 2000;
        else if (status === 429) waitMs = 3000;

        if (waitMs !== null) {
          if (status === 401) console.warn(`Transient 401 during poll (attempt ${consecutive401Count}), retrying...`);
          if (status === 403) console.warn(`Transient 403 during poll (attempt ${consecutive403Count}), waiting for guest claim...`);
          if (status === 404) console.warn(`Transient 404 during poll (attempt ${consecutive404Count}), retrying...`);
          if (await retryAfter(waitMs, finalAttempt)) continue;
          return await recoverOrThrow(timeoutError());
        }

        const body = await res.json().catch(() => ({}));
        throw tagWithTimeline(new Error(formatApiError(body?.detail, errorFallback)));
      }

      consecutive401Count = 0;
      consecutive404Count = 0;
      consecutive403Count = 0;

      let data;
      try {
        data = await res.json();
      } catch {
        // Malformed or empty response on a broken connection
        if (await retryAfter(1500, finalAttempt)) continue;
        return await recoverOrThrow(timeoutError());
      }

      noteTimeline(data);
      const queueNews = noteQueue(data);

      if (data?.status === 'done') return data.result;
      if (data?.status === 'cancelled') throw makeAbortError();
      if (data?.status === 'error') {
        const jobErr = new Error(formatApiError(data.detail, errorFallback));
        if (data.code) {
          jobErr.code = data.code;
          jobErr.subject = data.subject;
        }
        if (data.code === AI_JOB_SERVER_TIMEOUT_CODE) jobErr.serverTimeout = true;
        return await recoverOrThrow(jobErr);
      }

      // Still pending (running, or waiting in the server's queue).
      const partialNews = notePartial(data);
      if (finalAttempt) {
        return await recoverOrThrow(timeoutError());
      }
      if (partialNews || queueNews) {
        quietPolls = 0;
        await waitMs(NEWS_FOLLOW_UP_MS);
      } else if (Number(data?.waited_ms) >= LONG_POLL_MIN_HELD_MS) {
        // The server held the request until its timeout: ask again right away.
        quietPolls = 0;
      } else {
        // Old backend (no long poll), or an early answer with nothing new: back off.
        await waitMs(shortPollDelayMs(quietPolls, random));
        quietPolls += 1;
      }
    }
  } finally {
    if (!clock) ownClock.dispose();
  }
}
