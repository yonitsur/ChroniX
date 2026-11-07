/**
 * Grounding & Timeline Creation Mode Configuration
 *
 * Timeline creation and chat always default to 'fast' mode (no web search)
 * with no cross-timeline or cross-session persistence, so web search only runs
 * when explicitly enabled for the current action.
 */

export const GROUNDING_STORAGE_KEY = 'chronix_enable_grounding_v3';

export const DEFAULT_TIMELINE_MODE = 'fast';
export const IS_DEFAULT_GROUNDING_ENABLED = false;

export function getDefaultTimelineMode() {
  return DEFAULT_TIMELINE_MODE;
}

export function isDefaultGroundingEnabled() {
  return IS_DEFAULT_GROUNDING_ENABLED;
}

/**
 * Returns the stateless default grounding setting (always false / 'fast').
 */
export function readGroundingPref() {
  return IS_DEFAULT_GROUNDING_ENABLED;
}

/**
 * Intentionally stateless no-op (cleans up any legacy persisted key if present).
 */
export function writeGroundingPref() {
  try {
    localStorage.removeItem(GROUNDING_STORAGE_KEY);
  } catch {}
}
