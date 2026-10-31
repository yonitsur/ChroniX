import { useEffect, useState } from 'react';

/**
 * Tiny shared "bring to front" manager for the desktop floating overlays
 * (map widget / PiP + split map pane, cards button, edit menu, filter legend,
 * exploration dock). Only one overlay is "focused" at a time; whichever the
 * user last pointer-pressed rises above the rest.
 *
 * Bounds are kept below the modal layer (z-50) so dialogs always win:
 *   - BASE          : idle floating buttons / legends (above the map)
 *   - MAP_BASE      : the map at rest (below the buttons by default)
 *   - FOCUSED       : the currently focused overlay (above everything else here)
 *   - DRAWER        : the Event Detail Drawer - above the map/every floating
 *                     overlay (even focused ones) but below the toolbar's own
 *                     open dropdowns
 *   - DRAG_ICON     : small draggable icon capsules (e.g. the collapsed map icon) that
 *                     must be draggable over the drawers
 *   - PODCAST_MOBILE: the podcast player on mobile - below the drawer backdrops (z-40) so every
 *                     menu-opened panel/popup covers it
 *   - ALWAYS_ON_TOP : overlays that must never be covered by any of the above,
 *                     even while another overlay holds focus (e.g. the toolbar's
 *                     open dropdowns, the cards-list edge button) - still below modals
 */
export const FLOATING_Z = {
  PODCAST_MOBILE: 39,
  MAP_BASE: 30,
  BASE: 40,
  FOCUSED: 48,
  DRAWER: 49,
  DRAG_ICON: 50,
  CHAT: 55,
  ALWAYS_ON_TOP: 60,
  MODAL: 100,
};

let currentFocus = null;
const listeners = new Set();

export function focusFloating(id) {
  if (currentFocus === id) return;
  currentFocus = id;
  listeners.forEach((fn) => fn(currentFocus));
}

/**
 * @param {string} id stable id for this overlay
 * @param {number} base resting z-index when another overlay holds focus
 * @returns {{ zIndex:number, isFocused:boolean, raise:()=>void }}
 */
export function useFloatingFocus(id, base = FLOATING_Z.BASE) {
  const [focusId, setFocusId] = useState(currentFocus);
  useEffect(() => {
    listeners.add(setFocusId);
    return () => { listeners.delete(setFocusId); };
  }, []);
  const isFocused = focusId === id;
  return {
    zIndex: isFocused ? FLOATING_Z.FOCUSED : base,
    isFocused,
    raise: () => focusFloating(id),
  };
}
