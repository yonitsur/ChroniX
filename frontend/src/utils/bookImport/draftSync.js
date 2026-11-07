/**
 * Sends review edits to the server in small batches. Edits are applied locally right away (by the
 * caller); this queue ships the same ops after a short pause, tagged with the draft revision they were
 * made on. If the server's draft moved on (another tab), it reloads the server draft, re-applies the
 * pending ops on top and sends them again, so no edit is lost and nothing is silently overwritten.
 */

export function createDraftSync({
  rev, send, reload, applyOps, onChange,
  debounceMs = 1500,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
}) {
  let baseRev = rev;
  let pending = [];
  let inFlight = null;
  let timer = null;
  let state = 'saved'; // saved | pending | saving | error
  let lastError = null;

  const setState = (s, err = null) => {
    state = s;
    lastError = err;
    onChange?.({ state, rev: baseRev, error: lastError, pending: pending.length });
  };

  async function flushNow() {
    if (inFlight) {
      await inFlight.catch(() => {});
      if (!pending.length) return baseRev;
    }
    if (!pending.length) return baseRev;
    const batch = pending.slice(0, 400);
    setState('saving');
    inFlight = (async () => {
      try {
        const res = await send(baseRev, batch);
        baseRev = res.rev;
        pending = pending.slice(batch.length);
      } catch (err) {
        if (err?.code === 'stale_draft' || err?.status === 409) {
          const server = await reload();
          baseRev = server.rev;
          // The caller rebuilds its view from the server draft plus the ops still pending.
          applyOps?.(server.draft, pending);
          throw Object.assign(new Error('retry'), { retry: true });
        }
        throw err;
      }
    })();
    try {
      await inFlight;
      inFlight = null;
      if (pending.length) return flushNow();
      setState('saved');
      return baseRev;
    } catch (err) {
      inFlight = null;
      if (err?.retry) return flushNow();
      setState('error', err);
      throw err;
    }
  }

  return {
    push(ops) {
      if (!ops?.length) return;
      pending.push(...ops);
      setState('pending');
      clearTimer(timer);
      timer = setTimer(() => { flushNow().catch(() => {}); }, debounceMs);
    },
    /** Sends everything now; resolves with the server revision (used before Create). */
    async flush() {
      clearTimer(timer);
      return flushNow();
    },
    get rev() { return baseRev; },
    get state() { return state; },
    get pendingCount() { return pending.length; },
    dispose() { clearTimer(timer); },
  };
}
