/**
 * Polls a book import's status until it needs the user (review) or ends. No 5-minute cap like the
 * AI-job poller: a book may take many minutes, and the server keeps the work even if the tab closes.
 * Every 3 s while the tab is visible, 15 s while hidden, backing off on errors.
 */

export const STOP_STATUSES = new Set(['review', 'completed', 'failed', 'cancelled', 'expired']);

export function createProgressPoller({
  fetchStatus, onUpdate, onError,
  isVisible = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  visibleMs = 3000, hiddenMs = 15000, maxBackoffMs = 60000,
} = {}) {
  let timer = null;
  let stopped = false;
  let failures = 0;
  let inFlight = false;

  const schedule = (ms) => {
    if (stopped) return;
    clearTimer(timer);
    timer = setTimer(tick, ms);
  };

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const status = await fetchStatus();
      failures = 0;
      if (stopped) return;
      onUpdate?.(status);
      if (STOP_STATUSES.has(status?.status)) {
        stopped = true;
        return;
      }
      schedule(isVisible() ? visibleMs : hiddenMs);
    } catch (err) {
      failures += 1;
      onError?.(err, failures);
      if (err?.status === 404 || err?.status === 403) {
        stopped = true;
        return;
      }
      schedule(Math.min(maxBackoffMs, visibleMs * 2 ** Math.min(6, failures)));
    } finally {
      inFlight = false;
    }
  }

  return {
    start() { stopped = false; schedule(0); },
    poke() { if (!stopped) schedule(0); },
    stop() { stopped = true; clearTimer(timer); },
    get stopped() { return stopped; },
  };
}
