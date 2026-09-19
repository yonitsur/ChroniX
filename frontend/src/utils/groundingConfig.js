/**
 * Grounding & Timeline Creation Mode Configuration
 *
 * Configures the default creation mode ('fast' vs 'verified' / web search)
 * driven by environment variables, and manages user preference persistence in localStorage.
 *
 * Environment variable:
 * - VITE_DEFAULT_TIMELINE_MODE: 'fast' (default) | 'verified'
 */

export const GROUNDING_STORAGE_KEY = 'chronix_enable_grounding_v3';

function resolveDefaultMode() {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const mode = import.meta.env.VITE_DEFAULT_TIMELINE_MODE;
    if (typeof mode === 'string' && mode.trim()) {
      const norm = mode.trim().toLowerCase();
      if (norm === 'verified' || norm === 'search' || norm === 'grounded' || norm === 'true') {
        return 'verified';
      }
      if (norm === 'fast' || norm === 'false') {
        return 'fast';
      }
    }
  }

  // System default is 'fast' (no web search)
  return 'fast';
}

export const DEFAULT_TIMELINE_MODE = resolveDefaultMode();
export const IS_DEFAULT_GROUNDING_ENABLED = DEFAULT_TIMELINE_MODE === 'verified';

export function getDefaultTimelineMode() {
  return DEFAULT_TIMELINE_MODE;
}

export function isDefaultGroundingEnabled() {
  return IS_DEFAULT_GROUNDING_ENABLED;
}

/**
 * Read the active user preference from localStorage.
 * If unset, returns the system default defined by the environment variable.
 */
export function readGroundingPref() {
  try {
    const v = localStorage.getItem(GROUNDING_STORAGE_KEY);
    if (v === null) {
      return isDefaultGroundingEnabled();
    }
    return v === 'true';
  } catch {
    return isDefaultGroundingEnabled();
  }
}

/**
 * Save user preference to localStorage.
 */
export function writeGroundingPref(next) {
  try {
    localStorage.setItem(GROUNDING_STORAGE_KEY, String(Boolean(next)));
  } catch {}
}
