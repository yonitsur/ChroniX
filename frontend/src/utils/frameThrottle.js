// Shared frame-pacing helpers for ambient (decorative) canvas animations.
// Mirrors TopographicBackground's approach: rAF keeps ticking, but frames closer together than the
// target interval are skipped, and all motion advances by real elapsed time so a lower frame rate
// never slows the animation down.

export const AMBIENT_IDLE_FPS = 30;

// 0.8 ms of slack so a 60 Hz display renders exactly every other vsync at 30 fps instead of
// occasionally waiting a third frame because of timestamp jitter.
const FRAME_SLACK_MS = 0.8;

export function frameIntervalMs(fps) {
  return fps > 0 && Number.isFinite(fps) ? 1000 / fps : 0;
}

/** True when this rAF tick should be skipped because the previous rendered frame is too recent. */
export function shouldSkipFrame(now, lastFrame, fps) {
  const interval = frameIntervalMs(fps);
  if (!interval || !lastFrame) return false;
  return now - lastFrame < interval - FRAME_SLACK_MS;
}

/**
 * Seconds elapsed since the last rendered frame, clamped so a long stall (tab switch, GC pause)
 * does not make the animation jump. The first frame after a reset advances by `firstFrameSeconds`.
 */
export function frameElapsedSeconds(now, lastFrame, { maxSeconds = 0.1, firstFrameSeconds = 1 / 60 } = {}) {
  if (!lastFrame) return firstFrameSeconds;
  return Math.min(Math.max(0, (now - lastFrame) / 1000), maxSeconds);
}

/**
 * Tracks whether a decorative animation may run: the document must be visible and the element
 * on-screen. `onResume` fires once when the gate goes from paused to running.
 */
export function createAnimationGate({ onPause, onResume } = {}) {
  const state = { hidden: false, offscreen: false };
  const isActive = () => !state.hidden && !state.offscreen;
  const update = partial => {
    const wasActive = isActive();
    Object.assign(state, partial);
    const active = isActive();
    if (wasActive && !active) onPause?.();
    else if (!wasActive && active) onResume?.();
    return active;
  };
  return {
    isActive,
    setHidden: hidden => update({ hidden: Boolean(hidden) }),
    setOffscreen: offscreen => update({ offscreen: Boolean(offscreen) }),
  };
}

/**
 * Wires a gate to `document.visibilitychange` and an IntersectionObserver on `element`.
 * Falls back to "always on-screen" where IntersectionObserver is unavailable. Returns a cleanup.
 */
export function observeAnimationGate(gate, element) {
  const handleVisibility = () => gate.setHidden(document.hidden);
  document.addEventListener('visibilitychange', handleVisibility);
  gate.setHidden(document.hidden);
  let observer = null;
  if (element && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry) gate.setOffscreen(!entry.isIntersecting);
    });
    observer.observe(element);
  }
  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    observer?.disconnect();
  };
}
