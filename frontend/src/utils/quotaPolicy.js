// Shared quota-policy copy resolver.
// Every surface that describes the API_KEY_MODE / GUEST_API_KEY_MODE policy must branch
// on the mode ENUM ('free' | 'limited' | 'unlimited'), never on numeric quota values —
// -1 is a "no limit" sentinel and must never be rendered directly.
export const NO_LIMIT = -1;

export function isUnlimitedValue(value) {
  return value === NO_LIMIT || value == null;
}

/**
 * Resolves the localized quota-policy sentence for a given role/mode.
 * @param {(key: string, params?: object) => string} t - translation function
 * @param {'registered'|'guest'} role
 * @param {'free'|'limited'|'unlimited'} mode
 * @param {{used?: number, total?: number, admin?: boolean}} [opts] - used/total only apply to 'limited';
 *   pass admin:true when describing the policy in the abstract (no personal usage to show).
 */
export function getQuotaPolicyText(t, role, mode, opts = {}) {
  const { used, total, admin = false } = opts;
  const isGuest = role === 'guest';

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
  return t(isGuest ? 'quota.policyLimitedGuest' : 'quota.policyLimitedUser', { used: used ?? 0, total });
}
