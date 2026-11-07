// Pure helpers for the PromptExamples auto-scrolling reel (content is rendered three times so the
// middle third can wrap seamlessly).

// ~45 px per second, independent of display refresh rate.
export const MARQUEE_SPEED_PX_PER_SECOND = 45;
export const MARQUEE_MAX_STEP_SECONDS = 0.1;

/** Width of one copy of the content, from the track's full scroll width. */
export function marqueeSegmentWidth(scrollWidth) {
  return scrollWidth > 0 ? scrollWidth / 3 : 0;
}

/** Keep a scroll position inside the middle copy (between 10% of a segment and two segments). */
export function wrapMarqueePosition(position, segmentWidth) {
  if (!(segmentWidth > 0)) return position;
  if (position >= segmentWidth * 2) return position - segmentWidth;
  if (position <= segmentWidth * 0.1) return position + segmentWidth;
  return position;
}

/**
 * Advance the reel by real elapsed time. A position of exactly 0 means "not initialised yet" and
 * starts at the middle copy, matching the original behaviour.
 */
export function advanceMarquee(position, segmentWidth, deltaSeconds, speed = MARQUEE_SPEED_PX_PER_SECOND) {
  if (!(segmentWidth > 0)) return position;
  const start = position === 0 ? segmentWidth : position;
  const step = Math.min(Math.max(0, deltaSeconds), MARQUEE_MAX_STEP_SECONDS) * speed;
  return wrapMarqueePosition(start + step, segmentWidth);
}
