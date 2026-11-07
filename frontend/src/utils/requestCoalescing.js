// Small request-deduplication helpers (P-08). Pure: no React, Supabase or DOM dependencies, so
// they run under `node --test`.

/**
 * Wraps an async function so concurrent calls share ONE in-flight promise. A call made after it
 * settles starts a new run. Used for anonymous sign-in: two simultaneous first-visit callers
 * must not mint two guest users (the second would orphan whatever the first one saved).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {() => Promise<T>}
 */
export function createSingleFlight(fn) {
  let inFlight = null;
  return () => {
    if (inFlight) return inFlight;
    let run;
    try {
      run = Promise.resolve(fn());
    } catch (err) {
      run = Promise.reject(err);
    }
    const shared = run.finally(() => {
      if (inFlight === shared) inFlight = null;
    });
    inFlight = shared;
    return shared;
  };
}

/**
 * Coalesces bursts of triggers into at most one `fn()` call per `intervalMs`. The first trigger
 * after a quiet period runs immediately; triggers inside the window collapse into one trailing
 * call at the end of it, so the last change is never lost.
 *
 * @param {() => void} fn
 * @param {number} intervalMs
 * @param {{now?: () => number, setTimer?: Function, clearTimer?: Function}} [clock] injectable for tests
 * @returns {{trigger: () => void, cancel: () => void}}
 */
export function createCoalescer(fn, intervalMs, clock = {}) {
  const now = clock.now || (() => Date.now());
  const setTimer = clock.setTimer || ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = clock.clearTimer || ((id) => clearTimeout(id));
  let lastRunAt = -Infinity;
  let timer = null;

  const run = () => {
    timer = null;
    lastRunAt = now();
    fn();
  };

  return {
    trigger() {
      if (timer !== null) return;
      const wait = lastRunAt + intervalMs - now();
      if (wait <= 0) {
        run();
      } else {
        timer = setTimer(run, wait);
      }
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
