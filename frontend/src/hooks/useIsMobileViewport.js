import { useState, useEffect } from 'react';

// Mobile mode applies only to narrow portrait viewports (< 768px). Rotating a phone to
// landscape (>= 500px wide and landscape orientation) exits mobile mode completely so the
// app renders the standard desktop layout and regular desktop timeline. (Keeping the 500px
// width floor prevents Android portrait soft-keyboard height shrinkage from flipping modes.)
export const WIDE_OR_LANDSCAPE_MEDIA_QUERY =
  '(min-width: 768px), (min-width: 500px) and (orientation: landscape)';

export function checkIsMobileViewport() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return !window.matchMedia(WIDE_OR_LANDSCAPE_MEDIA_QUERY).matches;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isWideOrLandscape = w >= 768 || (w >= 500 && w > h);
  return !isWideOrLandscape;
}

export default function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => checkIsMobileViewport());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = typeof window.matchMedia === 'function'
      ? window.matchMedia(WIDE_OR_LANDSCAPE_MEDIA_QUERY)
      : null;

    const update = () => {
      const next = checkIsMobileViewport();
      setIsMobile((prev) => (prev !== next ? next : prev));
    };

    update();
    if (mql) {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', update);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(update);
      }
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', update);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(update);
        }
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return isMobile;
}
