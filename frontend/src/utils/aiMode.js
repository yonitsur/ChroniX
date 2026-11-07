// Fast AI vs Basic mode — one place that decides whether the caller is currently being served by
// the shared backup keys ("basic mode"), why, and when fast AI comes back.
//
// Wording convention (see locales `quota.*`): the premium tier is "fast AI" and the fallback is
// "basic mode". Avoid "free" for either: the whole site is free of charge, so "free mode" reads as
// a payment tier. "Free" is still fine where it genuinely means Google's free API tier.

/** Response header set by the backend on every AI request (custom/admin_paid/paid/unlimited/free). */
export const AI_TIER_HEADER = 'X-ChroniX-AI-Tier';

/**
 * @typedef {'credits'|'pool'|'site'} BasicModeReason
 *  credits — this person's daily fast credits ran out (or their hidden daily budget did)
 *  pool    — the shared community fast-AI pool is used up for today
 *  site    — the site is configured to run basic mode for this role, so there is no "switch"
 */

/**
 * @param {object|null|undefined} quota - `/api/user/quota` payload
 * @param {{hasCustomKey?: boolean}} [opts]
 * @returns {{isBasic: boolean, reason: BasicModeReason|null, resetsAt: Date|null, isGuest: boolean}}
 */
export function getAiModeInfo(quota, { hasCustomKey = false } = {}) {
  const off = { isBasic: false, reason: null, resetsAt: null, isGuest: Boolean(quota?.is_guest) };
  if (!quota || typeof quota !== 'object' || hasCustomKey || quota.is_admin === true) return off;

  const isGuest = quota.is_guest === true;
  const resetsAt = parseResetsAt(quota.resets_at);

  if (quota.mode === 'free') {
    return { isBasic: true, reason: 'site', resetsAt: null, isGuest };
  }
  const poolOut = quota.community_pool_exhausted === true || quota.community_pool?.exhausted === true;
  const remaining = Number(quota.remaining_paid);
  const limit = Number(quota.daily_paid_limit);
  const creditsOut = Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining) && remaining <= 0;

  if (quota.tier === 'free' || poolOut || creditsOut) {
    // Prefer "your credits" when both apply: it's the one the person can reason about.
    const reason = poolOut && !creditsOut && !quota.daily_spend_capped ? 'pool' : 'credits';
    return { isBasic: true, reason, resetsAt, isGuest };
  }
  return { ...off, isGuest };
}

function parseResetsAt(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local clock time for the reset ("03:00", "3:00 AM"), or '' when unknown. */
export function formatResetTime(resetsAt, locale) {
  if (!(resetsAt instanceof Date) || Number.isNaN(resetsAt.getTime())) return '';
  try {
    return resetsAt.toLocaleTimeString(locale || undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return resetsAt.toLocaleTimeString();
  }
}

/**
 * Key for "the user already saw the basic-mode notice for this credit day". Keyed by the reset
 * instant (one credit day) so the notice comes back once per day, never on every page load.
 */
export function basicNoticeStorageKey(info, now = new Date()) {
  const day = info?.resetsAt instanceof Date ? info.resetsAt.toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
  return `chronix_basic_notice_seen_${day}`;
}

/** Heuristic: is this (backend, English) error message about shared-key capacity / rate limits? */
export function isCapacityErrorMessage(message) {
  if (!message || typeof message !== 'string') return false;
  return /at capacity|rate.?limit|quota|resource.?exhausted|429|too many requests|Gemini API key in Settings/i.test(message);
}
