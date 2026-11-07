// Pure lifetime rules for Google Photos picks (no browser or API imports, unit-tested in node).
//
// The access token and the picked photos' `baseUrl`s both expire about 60 minutes after they were
// issued. A pick keeps its Picker session open until Apply or Cancel, so stale `baseUrl`s can be
// re-listed from the session with a valid token; a stale token needs the user to connect again
// (Google's popup only opens from a click, e.g. Apply).

export const GOOGLE_PICK_MAX_AGE_MS = 55 * 60 * 1000;
export const GOOGLE_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class GooglePickExpiredError extends Error {
  constructor() {
    super('google-expired');
    this.code = 'google-expired';
  }
}

/** One pick: its Picker session, when its `baseUrl`s were (last) listed, and refreshed URLs by item id. */
export function createPickState(sessionId, now = Date.now()) {
  return { sessionId, listedAt: now, baseUrls: new Map(), refreshing: null, released: false };
}

export const isGooglePickExpired = (pick, now = Date.now(), maxAgeMs = GOOGLE_PICK_MAX_AGE_MS) =>
  !pick || now - pick.listedAt >= maxAgeMs;

export const googleTokenNeedsRefresh = (token, now = Date.now(), marginMs = GOOGLE_TOKEN_REFRESH_MARGIN_MS) =>
  !token || !token.accessToken || token.expiresAt - now <= marginMs;

/** The freshest known `baseUrl` of a picked item. */
export const pickBaseUrl = (pick, item) => pick?.baseUrls?.get(item.id) || item.baseUrl;

/**
 * Makes sure `pick`'s `baseUrl`s are usable before a fetch: re-lists the session (`relist(token,
 * sessionId) -> [{ id, baseUrl }]`) when they are about to expire. Concurrent callers share one
 * re-list. Throws GooglePickExpiredError when that isn't possible (no valid token, session gone).
 */
export async function ensureFreshPick(pick, { token, relist, now = Date.now() }) {
  if (!isGooglePickExpired(pick, now)) return pick;
  if (!pick || pick.released || googleTokenNeedsRefresh(token, now, 0) || typeof relist !== 'function') {
    throw new GooglePickExpiredError();
  }
  if (!pick.refreshing) {
    pick.refreshing = (async () => {
      try {
        const items = await relist(token.accessToken, pick.sessionId);
        for (const it of items || []) if (it?.id && it.baseUrl) pick.baseUrls.set(it.id, it.baseUrl);
        pick.listedAt = Date.now();
      } catch {
        throw new GooglePickExpiredError();
      } finally {
        pick.refreshing = null;
      }
    })();
  }
  await pick.refreshing;
  return pick;
}

/** Runs `fn` over `items` with at most `limit` in flight; failures are ignored (best-effort prefetch). */
export async function forEachLimit(items, limit, fn) {
  const queue = [...(items || [])];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch {
        // best effort
      }
    }
  });
  await Promise.all(workers);
}
