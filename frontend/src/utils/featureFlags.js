/**
 * Feature Flags System
 *
 * Allows toggling features via:
 * 1. URL Query Parameter (highest priority, e.g. ?ff_interactive_guide=true / 1 / false / 0)
 * 2. LocalStorage override (e.g. localStorage.setItem('chronix_ff_INTERACTIVE_GUIDE', 'true'))
 * 3. Environment Variable (Vite env, e.g. VITE_ENABLE_INTERACTIVE_GUIDE=false)
 * 4. Default flag definition
 */

export const FEATURE_FLAGS = {
  // Master flag for the interactive coach-mark guide / walkthrough
  INTERACTIVE_GUIDE: 'INTERACTIVE_GUIDE',
  // Specific screen-level flags (fallback to INTERACTIVE_GUIDE if not explicitly set)
  HOME_SCREEN_GUIDE: 'HOME_SCREEN_GUIDE',
  TIMELINE_SCREEN_GUIDE: 'TIMELINE_SCREEN_GUIDE',
  // AI Image Generation flags (each scenario controlled independently)
  AI_IMAGE_EDIT_MODAL: 'AI_IMAGE_EDIT_MODAL',
  AI_IMAGE_EVENT_DRAWER: 'AI_IMAGE_EVENT_DRAWER',
  AI_IMAGE_AUTO_FALLBACK: 'AI_IMAGE_AUTO_FALLBACK',
  // Design picker (settings menu + top bar) and the extra "Comic" / "Journal" styles
  EXTRA_VISUAL_THEMES: 'EXTRA_VISUAL_THEMES',
};

// Safe default values - guide is turned OFF by default as requested;
// UI on-demand AI image buttons are ON by default, while automatic fallback is OFF by default.
export const DEFAULT_FEATURE_FLAGS = {
  [FEATURE_FLAGS.INTERACTIVE_GUIDE]: false,
  [FEATURE_FLAGS.HOME_SCREEN_GUIDE]: false,
  [FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE]: false,
  [FEATURE_FLAGS.AI_IMAGE_EDIT_MODAL]: true,
  [FEATURE_FLAGS.AI_IMAGE_EVENT_DRAWER]: true,
  [FEATURE_FLAGS.AI_IMAGE_AUTO_FALLBACK]: false,
  [FEATURE_FLAGS.EXTRA_VISUAL_THEMES]: false,
};

// Mapping flag names to environment variable names
const ENV_KEY_MAP = {
  [FEATURE_FLAGS.INTERACTIVE_GUIDE]: [
    'VITE_ENABLE_INTERACTIVE_GUIDE',
    'VITE_FEATURE_INTERACTIVE_GUIDE',
    'VITE_ENABLE_GUIDE',
  ],
  [FEATURE_FLAGS.HOME_SCREEN_GUIDE]: [
    'VITE_ENABLE_HOME_SCREEN_GUIDE',
    'VITE_ENABLE_HOME_GUIDE',
  ],
  [FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE]: [
    'VITE_ENABLE_TIMELINE_SCREEN_GUIDE',
    'VITE_ENABLE_TIMELINE_GUIDE',
  ],
  [FEATURE_FLAGS.AI_IMAGE_EDIT_MODAL]: [
    'VITE_ENABLE_AI_IMAGE_EDIT_MODAL',
    'VITE_FEATURE_AI_IMAGE_EDIT_MODAL',
  ],
  [FEATURE_FLAGS.AI_IMAGE_EVENT_DRAWER]: [
    'VITE_ENABLE_AI_IMAGE_EVENT_DRAWER',
    'VITE_FEATURE_AI_IMAGE_EVENT_DRAWER',
  ],
  [FEATURE_FLAGS.AI_IMAGE_AUTO_FALLBACK]: [
    'VITE_ENABLE_AI_IMAGE_AUTO_FALLBACK',
    'VITE_FEATURE_AI_IMAGE_AUTO_FALLBACK',
  ],
  [FEATURE_FLAGS.EXTRA_VISUAL_THEMES]: [
    'VITE_ENABLE_EXTRA_VISUAL_THEMES',
    'VITE_FEATURE_EXTRA_VISUAL_THEMES',
  ],
};

// URL query parameter aliases for quick QA & developer testing
const URL_PARAM_MAP = {
  [FEATURE_FLAGS.INTERACTIVE_GUIDE]: ['ff_interactive_guide', 'ff_guide'],
  [FEATURE_FLAGS.HOME_SCREEN_GUIDE]: ['ff_home_guide', 'ff_home_screen_guide'],
  [FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE]: ['ff_timeline_guide', 'ff_timeline_screen_guide'],
  [FEATURE_FLAGS.AI_IMAGE_EDIT_MODAL]: ['ff_ai_image_edit', 'ff_ai_image_edit_modal'],
  [FEATURE_FLAGS.AI_IMAGE_EVENT_DRAWER]: ['ff_ai_image_drawer', 'ff_ai_image_event_drawer'],
  [FEATURE_FLAGS.AI_IMAGE_AUTO_FALLBACK]: ['ff_ai_image_fallback', 'ff_ai_image_auto_fallback'],
  [FEATURE_FLAGS.EXTRA_VISUAL_THEMES]: ['ff_extra_themes', 'ff_extra_visual_themes'],
};

/**
 * Safely parse a value into a boolean, returning undefined if invalid or non-boolean
 */
export function parseBooleanFlag(val) {
  if (val === true || val === 1) return true;
  if (val === false || val === 0) return false;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (['true', '1', 'on', 'yes', 'enabled'].includes(s)) return true;
    if (['false', '0', 'off', 'no', 'disabled'].includes(s)) return false;
  }
  return undefined;
}

/**
 * Read environment variable safely across browser and Node test environments
 */
function getEnvValue(key) {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key] !== undefined) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Check if a URL parameter overrides the feature flag
 */
function getUrlOverride(flagKey) {
  if (typeof window === 'undefined' || !window.location || !window.location.search) {
    return undefined;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const aliases = URL_PARAM_MAP[flagKey] || [`ff_${flagKey.toLowerCase()}`];
    for (const alias of aliases) {
      if (params.has(alias)) {
        const parsed = parseBooleanFlag(params.get(alias));
        if (parsed !== undefined) return parsed;
      }
    }
  } catch {
    // Ignore URL search parsing errors
  }
  return undefined;
}

/**
 * Check if localStorage has an override for this flag
 */
function getLocalStorageOverride(flagKey) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }
  try {
    const raw =
      window.localStorage.getItem(`chronix_ff_${flagKey}`) ||
      window.localStorage.getItem(`chronix_ff_${flagKey.toLowerCase()}`);
    if (raw !== null) {
      return parseBooleanFlag(raw);
    }
  } catch {
    // LocalStorage might be inaccessible (sandboxed iframe / private mode)
  }
  return undefined;
}

/**
 * Check if environment variables configure this flag
 */
function getEnvOverride(flagKey) {
  const envKeys = ENV_KEY_MAP[flagKey] || [`VITE_ENABLE_${flagKey}`];
  for (const envKey of envKeys) {
    const val = getEnvValue(envKey);
    if (val !== undefined) {
      const parsed = parseBooleanFlag(val);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

/**
 * Query the effective status of a feature flag.
 * Resolution precedence:
 * 1. URL Query Parameter
 * 2. LocalStorage override
 * 3. Environment Variable
 * 4. Default value
 */
export function isFeatureEnabled(flagKey) {
  // 1. URL Parameter
  const urlVal = getUrlOverride(flagKey);
  if (urlVal !== undefined) return urlVal;

  // 2. LocalStorage override
  const lsVal = getLocalStorageOverride(flagKey);
  if (lsVal !== undefined) return lsVal;

  // 3. Environment variable
  const envVal = getEnvOverride(flagKey);
  if (envVal !== undefined) return envVal;

  // 4. Default value
  return DEFAULT_FEATURE_FLAGS[flagKey] ?? false;
}

/**
 * Helper to check whether the interactive guide feature is enabled overall.
 */
export function isInteractiveGuideEnabled() {
  return isFeatureEnabled(FEATURE_FLAGS.INTERACTIVE_GUIDE);
}

/**
 * Check whether the home screen guide is enabled.
 * If HOME_SCREEN_GUIDE has an explicit override, use it.
 * Otherwise, fall back to master INTERACTIVE_GUIDE status.
 */
export function isHomeGuideEnabled() {
  const homeOverride =
    getUrlOverride(FEATURE_FLAGS.HOME_SCREEN_GUIDE) ??
    getLocalStorageOverride(FEATURE_FLAGS.HOME_SCREEN_GUIDE) ??
    getEnvOverride(FEATURE_FLAGS.HOME_SCREEN_GUIDE);

  if (homeOverride !== undefined) {
    return homeOverride;
  }

  return isInteractiveGuideEnabled();
}

/**
 * Check whether the timeline screen guide is enabled.
 * If TIMELINE_SCREEN_GUIDE has an explicit override, use it.
 * Otherwise, fall back to master INTERACTIVE_GUIDE status.
 */
export function isTimelineGuideEnabled() {
  const timelineOverride =
    getUrlOverride(FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE) ??
    getLocalStorageOverride(FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE) ??
    getEnvOverride(FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE);

  if (timelineOverride !== undefined) {
    return timelineOverride;
  }

  return isInteractiveGuideEnabled();
}

/**
 * Check whether on-demand AI image generation inside EventEditModal is enabled.
 */
export function isAiImageEditModalEnabled() {
  return isFeatureEnabled(FEATURE_FLAGS.AI_IMAGE_EDIT_MODAL);
}

/**
 * Check whether quick AI image generation inside EventDrawer is enabled.
 */
export function isAiImageEventDrawerEnabled() {
  return isFeatureEnabled(FEATURE_FLAGS.AI_IMAGE_EVENT_DRAWER);
}

/**
 * Check whether automatic AI image fallback during timeline generation is enabled.
 */
export function isAiImageAutoFallbackEnabled() {
  return isFeatureEnabled(FEATURE_FLAGS.AI_IMAGE_AUTO_FALLBACK);
}

/**
 * Check whether the "Comic" and "Journal" visual styles are available.
 */
export function isExtraVisualThemesEnabled() {
  return isFeatureEnabled(FEATURE_FLAGS.EXTRA_VISUAL_THEMES);
}

/**
 * Override a feature flag in localStorage (useful in dev tools or testing)
 */
export function setFeatureFlagOverride(flagKey, value) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(`chronix_ff_${flagKey}`);
      window.localStorage.removeItem(`chronix_ff_${flagKey.toLowerCase()}`);
    } else {
      window.localStorage.setItem(`chronix_ff_${flagKey}`, String(Boolean(value)));
    }
  } catch {}
}

/**
 * Clear all feature flag overrides from localStorage
 */
export function clearFeatureFlagOverrides() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    for (const key of Object.keys(FEATURE_FLAGS)) {
      window.localStorage.removeItem(`chronix_ff_${key}`);
      window.localStorage.removeItem(`chronix_ff_${key.toLowerCase()}`);
    }
  } catch {}
}

/**
 * Expose helper in browser console for fast manual toggling in dev/staging
 */
if (typeof window !== 'undefined') {
  window.__CHRONIX_FEATURE_FLAGS__ = {
    flags: FEATURE_FLAGS,
    isFeatureEnabled,
    isInteractiveGuideEnabled,
    isHomeGuideEnabled,
    isTimelineGuideEnabled,
    isAiImageEditModalEnabled,
    isAiImageEventDrawerEnabled,
    isAiImageAutoFallbackEnabled,
    isExtraVisualThemesEnabled,
    setOverride: setFeatureFlagOverride,
    clearOverrides: clearFeatureFlagOverrides,
  };
}

