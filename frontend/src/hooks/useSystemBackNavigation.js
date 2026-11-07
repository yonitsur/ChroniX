import { useEffect, useRef, useState } from 'react';

const GUARD_KEY = 'chronixPanelGuard';

const isGuardEntry = () => Boolean(window.history.state?.[GUARD_KEY]);

const forceDocumentTitleSync = (title) => {
  if (typeof document === 'undefined' || !title) return;
  if (document.title === title) {
    // Force Blink/Chromium to emit a fresh LocalFrameHost::UpdateTitle IPC to the
    // browser process when same-document history traversal restores a stale
    // NavigationEntry title in the tab bar while DOM document.title is unchanged.
    document.title = `${title}\u200B`;
  }
  document.title = title;
};

// While `active`, keeps one same-URL guard entry on top of the browser history so the
// system Back action (Android back gesture/button, browser Back, mouse back button, Alt+←)
// calls `onBack` instead of leaving the page. The guard is re-armed after each in-app
// step and removed again once `active` turns false.
export default function useSystemBackNavigation(active, onBack, baseTitle = null) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const baseTitleRef = useRef(baseTitle);
  baseTitleRef.current = baseTitle;
  const armedRef = useRef(false);
  const ignoreNextPopRef = useRef(false);
  const disarmTitleRef = useRef(null);
  const [rearmToken, setRearmToken] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        const restoreTitle = disarmTitleRef.current || baseTitleRef.current;
        disarmTitleRef.current = null;
        if (restoreTitle) {
          forceDocumentTitleSync(restoreTitle);
          setTimeout(() => forceDocumentTitleSync(restoreTitle), 0);
        }
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
        const activeTitle = typeof document !== 'undefined' ? document.title : null;
        if (baseTitleRef.current && activeTitle && activeTitle !== baseTitleRef.current) {
          // Ensure the underlying Home NavigationEntry retains the base title before pushing the guard entry.
          forceDocumentTitleSync(baseTitleRef.current);
        }
        window.history.pushState({ ...(window.history.state || {}), [GUARD_KEY]: true }, '', window.location.href);
        if (activeTitle && activeTitle !== baseTitleRef.current) {
          forceDocumentTitleSync(activeTitle);
        }
      }
      armedRef.current = true;
    } else if (!active && armedRef.current) {
      armedRef.current = false;
      if (isGuardEntry()) {
        const currentTitle = baseTitleRef.current || (typeof document !== 'undefined' ? document.title : null);
        disarmTitleRef.current = currentTitle;
        ignoreNextPopRef.current = true;
        window.history.back();
        if (currentTitle !== null) {
          setTimeout(() => {
            forceDocumentTitleSync(currentTitle);
          }, 0);
        }
      }
    }
  }, [active, rearmToken]);
}
