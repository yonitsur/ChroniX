/**
 * Feature Flags Configuration
 *
 * Centralized feature toggles for ChroniX.
 * Flags default to predefined values but can be overridden by:
 * 1. Vite environment variables (e.g. VITE_ENABLE_MOBILE_SCRUBBER="true")
 * 2. Window localStorage in the browser for testing/debugging:
 *    localStorage.setItem('ENABLE_MOBILE_SCRUBBER', 'true')
 */

const getFlag = (key, defaultValue) => {
  // 1. Check localStorage override if available in browser
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {
      // Ignore storage access restrictions
    }
  }

  // 2. Check Vite environment variable (prefixed with VITE_)
  const envKey = `VITE_${key}`;
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[envKey] !== undefined) {
    return import.meta.env[envKey] === 'true';
  }

  return defaultValue;
};

export const FEATURE_FLAGS = {
  /**
   * Mobile scrubber bar and zoom (+/-) controls below the timeline.
   * Currently disabled (false) by default.
   */
  ENABLE_MOBILE_SCRUBBER: getFlag('ENABLE_MOBILE_SCRUBBER', false),
};
