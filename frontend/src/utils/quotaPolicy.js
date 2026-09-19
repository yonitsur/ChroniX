// Shared quota-policy copy resolver.
// Every surface that describes the API_KEY_MODE / GUEST_API_KEY_MODE policy must branch
// on the mode ENUM ('free' | 'limited' | 'unlimited'), never on numeric quota values —
// -1 is a "no limit" sentinel and must never be rendered directly.
export const NO_LIMIT = -1;

export function isUnlimitedValue(value) {
  return value === NO_LIMIT || value == null;
}

/**
 * Reads fallback policy modes and limits from environment variables (Vite build-time or runtime defaults).
 */
export function getDefaultQuotaPolicy() {
  const regMode = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY_MODE || 'unlimited').trim().toLowerCase();
  const regLimitRaw = typeof import.meta !== 'undefined' && import.meta.env?.VITE_DAILY_PAID_PROMPTS;
  const regLimit = regLimitRaw ? parseInt(regLimitRaw, 10) : 10;

  let guestMode = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GUEST_API_KEY_MODE || 'limited').trim().toLowerCase();
  if (regMode === 'free') {
    guestMode = 'free';
  }
  const guestLimitRaw = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GUEST_DAILY_PAID_PROMPTS;
  const guestLimit = guestLimitRaw ? parseInt(guestLimitRaw, 10) : 5;

  return {
    guestMode: ['limited', 'unlimited', 'free'].includes(guestMode) ? guestMode : 'limited',
    guestLimit: isNaN(guestLimit) || guestLimit <= 0 ? 5 : guestLimit,
    registeredMode: ['limited', 'unlimited', 'free'].includes(regMode) ? regMode : 'unlimited',
    registeredLimit: isNaN(regLimit) || regLimit <= 0 ? 10 : regLimit,
  };
}

/**
 * Resolves the guest caption text explaining what guest gets and what registration offers,
 * dynamically adapting to both guest and registered user modes and quotas.
 * @param {(key: string, params?: object) => string} t - translation function
 * @param {object} options
 */
export function getGuestCaptionText(t, options = {}) {
  const defaults = getDefaultQuotaPolicy();
  const guestMode = options.guestMode || options.mode || defaults.guestMode;
  const rawGuestLimit = options.guestLimit ?? options.limit ?? defaults.guestLimit;
  const guestLimit = (rawGuestLimit == null || rawGuestLimit === NO_LIMIT) ? defaults.guestLimit : rawGuestLimit;

  const registeredMode = options.registeredMode || defaults.registeredMode;
  const rawRegLimit = options.registeredLimit ?? defaults.registeredLimit;
  const registeredLimit = (rawRegLimit == null || rawRegLimit === NO_LIMIT) ? defaults.registeredLimit : rawRegLimit;

  // Case 1: Guest has unlimited fast AI
  if (guestMode === 'unlimited') {
    return t('auth.guestCaptionUnlimited');
  }

  // Case 2: Guest runs strictly on free tier
  if (guestMode === 'free') {
    if (registeredMode === 'unlimited') {
      return t('auth.guestCaptionFreeWithUnlimitedReg');
    }
    if (registeredMode === 'limited') {
      return t('auth.guestCaptionFreeWithLimitedReg', { registeredLimit });
    }
    return t('auth.guestCaptionFree');
  }

  // Case 3: Guest is limited (guestMode === 'limited')
  if (registeredMode === 'limited') {
    // If registered quota is strictly higher than guest quota, highlight the increased fast AI quota + cloud saving
    if (registeredLimit > guestLimit) {
      return t('auth.guestCaptionLimited', {
        limit: guestLimit,
        registeredLimit,
      });
    }
    // If registered quota is equal to or lower than guest quota, do NOT make misleading promises about fast AI!
    // The true benefit of registration is saving and syncing timelines in the cloud.
    return t('auth.guestCaptionFreeReg', {
      limit: guestLimit,
    });
  }
  if (registeredMode === 'free') {
    return t('auth.guestCaptionFreeReg', {
      limit: guestLimit,
    });
  }
  // registeredMode === 'unlimited'
  return t('auth.guestCaption', {
    limit: guestLimit,
  });
}

/**
 * Resolves the localized quota-policy sentence for a given role/mode.
 * @param {(key: string, params?: object) => string} t - translation function
 * @param {'registered'|'guest'} role
 * @param {'free'|'limited'|'unlimited'} mode
 * @param {{total?: number, admin?: boolean, registeredMode?: string, registeredLimit?: number}} [opts] - total only applies to 'limited';
 *   pass admin:true when describing the policy in the abstract (no personal usage to show).
 */
export function getQuotaPolicyText(t, role, mode, opts = {}) {
  const { total, admin = false, registeredMode, registeredLimit } = opts;
  const isGuest = role === 'guest';

  // For guests viewing their own policy, delegate to the dynamic guest caption
  if (isGuest && !admin) {
    return getGuestCaptionText(t, {
      guestMode: mode,
      guestLimit: total,
      registeredMode,
      registeredLimit,
    });
  }

  if (mode === 'free') {
    return t(isGuest ? 'quota.policyFreeGuest' : 'quota.policyFreeUser');
  }
  if (mode === 'unlimited') {
    return t(isGuest ? 'quota.policyUnlimitedGuest' : 'quota.policyUnlimitedUser');
  }
  // limited
  if (admin || total == null || isUnlimitedValue(total)) {
    return t(isGuest ? 'quota.policyLimitedGuestAdmin' : 'quota.policyLimitedUserAdmin', { total: total ?? '—' });
  }
  return t('quota.policyLimitedUser', { total });
}
