import { useEffect, useMemo, useState } from 'react';
import { computeFocalPoint, loadInterestMap } from '../utils/autoFocalPoint';

// Suggested object-position for a photo cover-cropped inside `frameRef`'s element, or null
// until it is known (or when `enabled` is false, e.g. the event has a saved position).
export default function useAutoFocalPoint(url, frameRef, enabled) {
  const [analysis, setAnalysis] = useState({ url: null, map: null });
  const [frameRatio, setFrameRatio] = useState(0);
  const active = Boolean(enabled && url);

  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    loadInterestMap(url).then((map) => {
      if (current) setAnalysis({ url, map });
    });
    return () => {
      current = false;
    };
  }, [url, active]);

  useEffect(() => {
    const el = frameRef.current;
    if (!active || !el) return undefined;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setFrameRatio(Math.round((width / height) * 100) / 100);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, frameRef]);

  return useMemo(() => {
    if (!active || analysis.url !== url || !analysis.map || !frameRatio) return null;
    return computeFocalPoint(analysis.map, frameRatio);
  }, [active, analysis, url, frameRatio]);
}
