// Critically damped spring used to animate card positions on the timeline canvas.
//
// Unlike a fixed-duration tween, a spring keeps its velocity when its target changes
// mid-flight. Cards are re-targeted constantly while the user zooms or pans (rows get
// re-assigned, the stack is lifted or lowered), so with a spring they bend smoothly
// towards the new target instead of stopping dead and restarting from zero speed.

// ~0.7s to visually settle (95% of the way after ~0.68s, at rest after ~0.9s). The
// engine's own default move animation is a 1.5s `swing` ease; at the previous 0.35s a
// card dropping a few rows travelled 30+px per frame, which read as cards snapping into
// place rather than gliding. A critically damped spring never overshoots, so a calmer
// value costs no wobble.
export const LAYOUT_SPRING_OMEGA = 7;
// Longest step taken in one go (s): a stalled frame never teleports a card.
export const LAYOUT_SPRING_MAX_DT = 1 / 30;
export const LAYOUT_SPRING_REST_DISTANCE = 0.25;
export const LAYOUT_SPRING_REST_VELOCITY = 4;

// Exact (frame-rate independent) critically damped step: advances `state`
// ({ value, velocity }, velocity in units per second) towards `target` by `dt` seconds.
// Returns true once the spring is at rest on its target (and snaps it there).
export function stepCriticalSpring(state, target, dt, omega = LAYOUT_SPRING_OMEGA) {
  if (dt > 0) {
    const x = state.value - target;
    const v = state.velocity;
    const decay = Math.exp(-omega * dt);
    const k = (v + omega * x) * dt;
    state.value = target + (x + k) * decay;
    state.velocity = (v - omega * k) * decay;
  }
  if (Math.abs(state.value - target) < LAYOUT_SPRING_REST_DISTANCE && Math.abs(state.velocity) < LAYOUT_SPRING_REST_VELOCITY) {
    state.value = target;
    state.velocity = 0;
    return true;
  }
  return false;
}

export function clampSpringStep(dt) {
  if (!Number.isFinite(dt)) return 0;
  return Math.min(Math.max(dt, 0), LAYOUT_SPRING_MAX_DT);
}
