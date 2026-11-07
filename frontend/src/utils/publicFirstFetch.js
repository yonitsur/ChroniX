// Shared links (/t/<id>) opened with no session (P-07): the timeline is read with a plain GET - no
// Authorization header (so no anonymous sign-in just to read a public timeline) and no JSON
// Content-Type (so no CORS preflight), which also makes the response cacheable. A miss may still be
// a private timeline its owner is opening from another tab, so any non-OK answer falls back to the
// usual authenticated read. Pure: api.js injects the session check and both requests.

/**
 * deps:
 *  - hasSession() -> Promise<boolean>
 *  - publicGet(id) -> Promise<Response-like { ok, status, json() }>
 *  - authGet(id) -> Promise<timeline>          (throws like fetchTimeline)
 */
export function createPublicFirstFetcher({ hasSession, publicGet, authGet }) {
  return async function fetchPublicFirst(id) {
    let signedIn = true;
    try {
      signedIn = await hasSession();
    } catch {
      signedIn = true;
    }
    if (!signedIn) {
      let res = null;
      try {
        res = await publicGet(id);
      } catch {
        res = null;
      }
      if (res && res.ok) return res.json();
    }
    return authGet(id);
  };
}
