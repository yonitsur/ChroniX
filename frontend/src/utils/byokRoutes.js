// The personal Gemini key (BYOK) is sent only to API routes that use it (S-08): AI calls that run on
// the key, plus the routes whose limits or rate limiter depend on it. Polls, timeline reads/saves,
// the Library and podcast listings never carry it. Paths are relative to the API base ("/api").
// Keep in sync with the backend routes that read `X-Gemini-Api-Key` (see DEPLOYMENT_STEPS.md, Batch 3C).
const SEG = '[^/]+';

export const BYOK_ROUTES = Object.freeze([
  ['POST', /^\/timeline\/generate(\/start)?$/],
  ['POST', /^\/timeline\/generate-from-files(\/start)?$/],
  ['POST', /^\/timeline\/refine(\/start)?$/],
  ['POST', /^\/timeline\/chat(\/start)?$/],
  ['POST', /^\/timeline\/chat\/attach-files(\/start)?$/],
  ['POST', /^\/timeline\/quiz(\/start)?$/],
  ['POST', /^\/timeline\/whoami(\/start)?$/],
  ['POST', /^\/timeline\/suggest-event$/],
  ['POST', /^\/timeline\/generate-event-image$/],
  ['POST', /^\/timeline\/reverse-geocode$/],
  ['POST', /^\/text\/polish$/],
  ['POST', /^\/story\/overview$/],
  ['POST', /^\/story\/photo-drafts$/],
  ['GET', /^\/story\/photo-import\/limits$/],
  ['POST', /^\/google-photos\/sessions$/],
  ['GET', /^\/podcast\/voice-preview$/],
  ['POST', new RegExp(`^/timelines/${SEG}/podcasts/start$`)],
  ['POST', new RegExp(`^/timelines/${SEG}/podcasts/${SEG}/audio$`)],
  ['GET', new RegExp(`^/timelines/${SEG}/podcasts/${SEG}/segments/${SEG}/clip$`)],
  ['GET', new RegExp(`^/timelines/${SEG}/podcasts/${SEG}/download$`)],
  // Book import: the key decides entitlement (limits / create) and runs the pipeline (start / resume).
  // Polls, draft reads and edits, uploads and finalize never carry it.
  ['GET', /^\/book-imports\/limits$/],
  ['POST', /^\/book-imports$/],
  ['POST', new RegExp(`^/book-imports/${SEG}/(start|resume)$`)],
]);

/** The API-relative path ("/timeline/quiz/start") of a request URL, or null if it isn't an API call. */
export function apiRelativePath(url, apiBase = '/api') {
  if (typeof url !== 'string' || !url) return null;
  let pathname;
  let basePath;
  try {
    pathname = new URL(url, 'http://local.invalid').pathname;
    basePath = new URL(apiBase || '/api', 'http://local.invalid').pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  return pathname.slice(basePath.length) || '/';
}

export function isByokRoute(method, url, apiBase = '/api') {
  const path = apiRelativePath(url, apiBase);
  if (!path) return false;
  const m = String(method || 'GET').toUpperCase();
  return BYOK_ROUTES.some(([routeMethod, re]) => routeMethod === m && re.test(path));
}
