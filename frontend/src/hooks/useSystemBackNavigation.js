import { useEffect, useRef, useState } from 'react';

const GUARD_KEY = 'chronixPanelGuard';

const isGuardEntry = () => Boolean(window.history.state?.[GUARD_KEY]);

// While `active`, keeps one same-URL guard entry on top of the browser history so the
// system Back action (Android back gesture/button, browser Back, mouse back button, Alt+←)
// calls `onBack` instead of leaving the page. The guard is re-armed after each in-app
// step and removed again once `active` turns false.
export default function useSystemBackNavigation(active, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const armedRef = useRef(false);
  const ignoreNextPopRef = useRef(false);
  const [rearmToken, setRearmToken] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (!armedRef.current || isGuardEntry()) return;
      armedRef.current = false;
      onBackRef.current?.();
      setRearmToken((n) => n + 1);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (active && !armedRef.current) {
      if (!isGuardEntry()) {
        window.history.pushState({ ...(window.history.state || {}), [GUARD_KEY]: true }, '', window.location.href);
      }
      armedRef.current = true;
    } else if (!active && armedRef.current) {
      armedRef.current = false;
      if (isGuardEntry()) {
        ignoreNextPopRef.current = true;
        window.history.back();
      }
    }
  }, [active, rearmToken]);
}
