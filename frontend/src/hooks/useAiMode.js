import { useMemo, useSyncExternalStore } from 'react';
import { getApiKey } from '../api';
import { getAiModeInfo } from '../utils/aiMode';

// App.jsx owns the server quota; it publishes every update here so deeply nested components
// (chat panel, loaders, error banners) can ask "are we in basic mode?" without prop drilling.
let currentQuota = null;
const listeners = new Set();

export function publishQuota(quota) {
  if (quota === currentQuota) return;
  currentQuota = quota;
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  const onKeyChange = () => listener();
  window.addEventListener('chronix-api-key-change', onKeyChange);
  window.addEventListener('storage', onKeyChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('chronix-api-key-change', onKeyChange);
    window.removeEventListener('storage', onKeyChange);
  };
}

const getQuotaSnapshot = () => currentQuota;
const getKeySnapshot = () => Boolean(getApiKey());

/**
 * Current fast-AI / basic-mode state. Pass `quota` to override the published one (App does).
 * @returns {{isBasic: boolean, reason: 'credits'|'pool'|'site'|null, resetsAt: Date|null, isGuest: boolean}}
 */
export default function useAiMode(quotaOverride) {
  const published = useSyncExternalStore(subscribe, getQuotaSnapshot, getQuotaSnapshot);
  const hasCustomKey = useSyncExternalStore(subscribe, getKeySnapshot, () => false);
  const quota = quotaOverride === undefined ? published : quotaOverride;
  return useMemo(() => getAiModeInfo(quota, { hasCustomKey }), [quota, hasCustomKey]);
}
