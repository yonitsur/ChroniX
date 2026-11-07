// Google Photos Picker on the web (browser-only).
//
// 1. Sign in with Google Identity Services (token client, scope photospicker.mediaitems.readonly).
//    The token lives in memory + sessionStorage; Google shows its own consent screen.
// 2. Create a picking session (through our backend) and open Google's picker page.
// 3. Poll until the user is done, list the picked photos, and turn each into a "remote source":
//    a lazy loader that fetches the photo at the size a step needs (via the backend proxy).
// Picked photos carry their capture time but never their location (Google strips it).

import {
  createGooglePhotosSession, getGooglePhotosSession, listGooglePhotosItems, deleteGooglePhotosSession,
  fetchGooglePhotosMedia,
} from '../../api';
import { buildPhotoMeta } from './photoMeta.js';
import { pickedItemToTags } from './takeout.js';
import { createPickState, ensureFreshPick, forEachLimit, pickBaseUrl } from './googlePhotosPick.js';

export const GOOGLE_PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const REMOTE_SIZES = [256, 320, 384, 512, 640, 768, 800, 1024, 1600];
const PICKER_WINDOW = 'chronix-google-photos';
const PICKER_FEATURES = 'width=1040,height=780';
// How long our page may have focus back (picker closed or left) before the wait ends.
export const PICKER_CLOSED_GRACE_MS = 1800;
export const PICKER_MIN_TIMEOUT_SEC = 45 * 60;
const MAX_TRANSIENT_POLL_ERRORS = 6;
const TOKEN_MIN_LIFE_MS = 5 * 60 * 1000;
export const PICK_TOKEN_MIN_LIFE_MS = 15 * 60 * 1000;
const TOKEN_STORAGE_KEY = 'chronix:google-photos-token';

// The Google Photos access token of this tab session, kept in memory + sessionStorage, so one
// sign-in covers every later import (including after page reloads) until it nears expiry.
let cachedToken = null;

function readStoredToken() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage?.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accessToken === 'string' && Number.isFinite(parsed.expiresAt)) {
      return parsed;
    }
  } catch {
    // sessionStorage may be unavailable in restricted contexts
  }
  return null;
}

function writeStoredToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token && token.accessToken && Number.isFinite(token.expiresAt)) {
      window.sessionStorage?.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
      }));
    } else {
      window.sessionStorage?.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

/** The session's token while it still has enough time left, else null. */
export function getCachedGooglePhotosToken(now = Date.now(), minLifeMs = TOKEN_MIN_LIFE_MS) {
  if (!cachedToken) cachedToken = readStoredToken();
  if (cachedToken && cachedToken.expiresAt - now > minLifeMs) return cachedToken;
  if (cachedToken && cachedToken.expiresAt <= now) {
    cachedToken = null;
    writeStoredToken(null);
  }
  return null;
}
export function setCachedGooglePhotosToken(token) {
  cachedToken = token || null;
  writeStoredToken(cachedToken);
}

/** Opens (or reuses) the picker window. Only works inside a click, else the browser blocks it. */
export function openPickerWindow(url = 'about:blank') {
  try {
    return window.open(url, PICKER_WINDOW, PICKER_FEATURES) || null;
  } catch {
    return null;
  }
}

/** The OAuth client used for Google Photos (a dedicated one, else the app's Google sign-in client). */
export function getGooglePhotosClientId() {
  const env = import.meta.env || {};
  const id = String(env.VITE_GOOGLE_PHOTOS_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || '').trim();
  return id && !id.startsWith('your-') ? id : '';
}

let gisPromise = null;
/** Loads Google Identity Services once (shared with One Tap's script tag when present). */
export function loadGoogleIdentity() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const done = () => (window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error('gis-unavailable')));
    const existing = document.getElementById('google-gsi-client');
    if (existing) {
      if (window.google?.accounts) done();
      else {
        existing.addEventListener('load', done, { once: true });
        existing.addEventListener('error', () => reject(new Error('gis-failed')), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-client';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error('gis-failed'));
    document.head.appendChild(script);
  }).catch((err) => {
    gisPromise = null;
    throw err;
  });
  return gisPromise;
}

/**
 * Asks the user for Google Photos access. Must run inside a click handler (it opens Google's
 * popup), with Google Identity Services already loaded. Resolves { accessToken, expiresAt }.
 */
export function requestGooglePhotosToken(clientId) {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('gis-unavailable'));
      return;
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_PHOTOS_SCOPE,
      callback: (resp) => {
        if (resp?.access_token && oauth2.hasGrantedAllScopes?.(resp, GOOGLE_PHOTOS_SCOPE) !== false) {
          resolve({ accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        } else {
          reject(new Error(resp?.error || 'access-denied'));
        }
      },
      error_callback: (err) => reject(new Error(err?.type || 'popup-closed')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

const parseSeconds = (value, fallback) => {
  const n = parseFloat(String(value || '').replace(/s$/, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const sleep = (ms, signal, watch = null) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Aborted', 'AbortError'));
    return;
  }
  let settled = false;
  let timer = null;
  let unsubWatch = null;
  const cleanup = () => {
    if (timer != null) clearTimeout(timer);
    unsubWatch?.();
    signal?.removeEventListener('abort', onAbort);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(new DOMException('Aborted', 'AbortError'));
  };
  timer = setTimeout(finish, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (watch?.onChange) {
    unsubWatch = watch.onChange(() => {
      if (settled || watch.returnedFor() <= 0) return;
      // Wake up quickly when the user returns to our window so Done / X is noticed right away.
      clearTimeout(timer);
      timer = setTimeout(finish, 250);
    });
  }
});

/**
 * Tracks whether the user went to the picker window and came back. Google's pages hide whether
 * their window is still open (Cross-Origin-Opener-Policy), so "our page has had focus again for
 * a brief moment and nothing was picked" is how a closed picker (its X) is noticed.
 */
export function createReturnWatch(
  win = typeof window !== 'undefined' ? window : null,
  doc = typeof document !== 'undefined' ? document : null,
) {
  if (!win || !doc) {
    return {
      returnedFor: () => 0,
      pause() {},
      markOpened() {},
      onChange: () => () => {},
      stop() {},
    };
  }
  let active = true;
  let openedAt = Date.now();
  let lastHasFocus = typeof doc.hasFocus === 'function' ? Boolean(doc.hasFocus()) : true;
  let left = !lastHasFocus;
  let returnedAt = null;
  const listeners = new Set();
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    }
  };
  const leave = () => {
    if (!active) return;
    left = true;
    returnedAt = null;
  };
  const back = () => {
    if (!active) return;
    if (!left && Date.now() - openedAt > 250) left = true;
    if (left && returnedAt == null) {
      returnedAt = Date.now();
      notify();
    }
  };
  const onVisibility = () => (doc.visibilityState === 'hidden' ? leave() : back());
  const syncFocus = () => {
    if (!active || typeof doc.hasFocus !== 'function') return;
    const focused = Boolean(doc.hasFocus());
    if (focused === lastHasFocus) return;
    lastHasFocus = focused;
    if (!focused) {
      left = true;
      returnedAt = null;
    } else if (left && returnedAt == null) {
      returnedAt = Date.now();
      notify();
    }
  };
  const onUserActivity = () => {
    if (!active || Date.now() - openedAt <= 400) return;
    if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return;
    left = true;
    if (returnedAt == null) {
      returnedAt = Date.now();
      notify();
    }
  };
  win.addEventListener('blur', leave);
  win.addEventListener('focus', back);
  win.addEventListener('pointerdown', onUserActivity, true);
  win.addEventListener('keydown', onUserActivity, true);
  doc.addEventListener('visibilitychange', onVisibility);
  const focusTimer = setInterval(syncFocus, 200);
  return {
    returnedFor: (now = Date.now()) => {
      if (!active) return 0;
      syncFocus();
      return left && returnedAt != null ? Math.max(0, now - returnedAt) : 0;
    },
    pause() {
      active = false;
      left = false;
      returnedAt = null;
    },
    markOpened() {
      active = true;
      openedAt = Date.now();
      lastHasFocus = typeof doc.hasFocus === 'function' ? Boolean(doc.hasFocus()) : true;
      left = !lastHasFocus;
      returnedAt = null;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      clearInterval(focusTimer);
      listeners.clear();
      win.removeEventListener('blur', leave);
      win.removeEventListener('focus', back);
      win.removeEventListener('pointerdown', onUserActivity, true);
      win.removeEventListener('keydown', onUserActivity, true);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

const isTransientError = (err) => {
  const status = Number(err?.status) || 0;
  if (status === 401 || status === 403 || status === 404) return false;
  return true;
};

/**
 * Runs one picking session: opens Google's picker in `popup` (a window the caller opened
 * synchronously on click, so it isn't blocked) or, without one, tries to open it now. Waits for
 * the selection and returns the picked photo items plus the pick's state.
 * `onState('waiting' | 'loading', info)` reports progress; `info.blocked` means the browser
 * blocked the window, so the caller should offer `info.pickerUrl` / `info.openPicker` to click.
 * Fails with code 'picker-closed' when the user closes the picker without picking.
 * The session stays open after a successful pick (its items can be re-listed when their URLs
 * expire); release it with `releaseGooglePick` on Apply or Cancel.
 */
export async function pickFromGooglePhotos(token, { popup = null, signal, onState, returnWatch = null } = {}) {
  const watch = returnWatch || createReturnWatch();
  let picked = false;
  let session = null;
  try {
    session = await createGooglePhotosSession(token);
    const pickerUrl = `${session.pickerUri}/autoclose`;
    let win = popup && !popup.closed ? popup : null;
    let winOpenedAt = 0;
    let unseveredPopup = false;
    const attachWindow = (w) => {
      win = w || null;
      winOpenedAt = win ? Date.now() : 0;
      unseveredPopup = false;
      if (!returnWatch) {
        if (win) watch.markOpened?.();
        else watch.pause?.();
      }
    };
    if (win) {
      win.location.href = pickerUrl;
      attachWindow(win);
    } else {
      attachWindow(openPickerWindow(pickerUrl));
    }
    const openPicker = () => {
      const w = openPickerWindow(pickerUrl);
      if (w) {
        attachWindow(w);
        onState?.('waiting', { pickerUrl, blocked: false, openPicker });
      }
      return w;
    };
    onState?.('waiting', { pickerUrl, blocked: !win, openPicker });
    let interval = parseSeconds(session.pollInterval, 3);
    const sessionTimeoutSec = Math.max(parseSeconds(session.timeoutIn, PICKER_MIN_TIMEOUT_SEC), PICKER_MIN_TIMEOUT_SEC);
    const expireMs = session.expireTime ? Date.parse(session.expireTime) : NaN;
    const deadline = Number.isFinite(expireMs) && expireMs > Date.now() + 60_000
      ? Math.max(expireMs, Date.now() + sessionTimeoutSec * 1000)
      : Date.now() + sessionTimeoutSec * 1000;
    let transientErrors = 0;
    let checkedAfterReturn = false;
    for (;;) {
      const returnedMs = watch.returnedFor();
      let waitMs = Math.max(1, interval) * 1000;
      if (returnedMs > 0) {
        waitMs = !checkedAfterReturn
          ? 250
          : Math.max(250, Math.min(waitMs, PICKER_CLOSED_GRACE_MS - returnedMs + 50));
      }
      await sleep(waitMs, signal, watch);
      if (watch.returnedFor() > 0) checkedAfterReturn = true;
      else checkedAfterReturn = false;

      let state;
      try {
        state = await getGooglePhotosSession(token, session.id, signal);
        transientErrors = 0;
      } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError' || !isTransientError(err)) throw err;
        transientErrors += 1;
        if (transientErrors >= MAX_TRANSIENT_POLL_ERRORS) throw err;
        interval = Math.min(Math.max(interval, 3) * 1.5, 10);
        continue;
      }
      if (state.mediaItemsSet) break;
      interval = parseSeconds(state.pollInterval, interval);

      // While the popup was blocked and hasn't been opened yet, keep waiting for the user's click.
      if (!win && !returnWatch) {
        if (Date.now() > deadline) throw new Error('picker-timeout');
        continue;
      }

      // If the browser has not severed `win.closed` via COOP after 2s, `win.closed === false`
      // proves the popup is still open, and `win.closed === true` proves the user closed it.
      if (win && !win.closed && Date.now() - winOpenedAt >= 2000) {
        unseveredPopup = true;
      }
      if (unseveredPopup && win && win.closed) {
        await sleep(350, signal);
        const finalState = await getGooglePhotosSession(token, session.id, signal).catch(() => state);
        if (finalState?.mediaItemsSet) break;
        throw new Error('picker-closed');
      }

      const popupKnownOpen = Boolean(win && !win.closed && unseveredPopup);
      if (!popupKnownOpen && watch.returnedFor() >= PICKER_CLOSED_GRACE_MS) {
        throw new Error('picker-closed');
      }
      if (Date.now() > deadline) throw new Error('picker-timeout');
    }
    onState?.('loading', {});
    const { items, skipped } = await listAllPickedItems(token, session.id, signal);
    picked = true;
    return { items, skipped, pick: createPickState(session.id) };
  } finally {
    watch.stop();
    if (!picked && session) deleteGooglePhotosSession(token, session.id);
  }
}

async function listAllPickedItems(token, sessionId, signal) {
  const items = [];
  let skipped = 0;
  let pageToken = null;
  do {
    let page;
    try {
      page = await listGooglePhotosItems(token, sessionId, pageToken, signal);
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError' || !isTransientError(err)) throw err;
      await sleep(800, signal);
      page = await listGooglePhotosItems(token, sessionId, pageToken, signal);
    }
    items.push(...(page.items || []));
    skipped += Number(page.skipped) || 0;
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  return { items, skipped };
}

/** Re-lists a still-open session (fresh `baseUrl`s for the same picked items). */
export async function relistGooglePick(token, sessionId) {
  return (await listAllPickedItems(token, sessionId)).items;
}

/** Closes a pick's Picker session (after Apply or Cancel). Safe to call more than once. */
export function releaseGooglePick(token, pick) {
  if (!pick || pick.released) return;
  pick.released = true;
  if (token) deleteGooglePhotosSession(token, pick.sessionId);
}

/** Fetches every picked photo's review thumbnail right away, while its URL is fresh (bounded). */
export function prefetchRemoteSources(sources, maxDim, concurrency = 4) {
  return forEachLimit(sources, concurrency, (source) => source.load(maxDim));
}

/** Smallest size the proxy serves that is at least `maxDim`. */
export function remoteSizeFor(maxDim) {
  return REMOTE_SIZES.find((s) => s >= maxDim) || REMOTE_SIZES[REMOTE_SIZES.length - 1];
}

/**
 * A lazy, cached loader standing in for a File (see photoFiles.encodePhoto). `getToken()` returns
 * the current { accessToken, expiresAt }; with a `pick`, stale URLs are re-listed before a fetch,
 * and an expired pick fails with code 'google-expired'.
 */
export function createRemoteSource(item, getToken, pick = null) {
  const cache = new Map();
  const fetchSized = async (size) => {
    const token = getToken();
    if (pick) await ensureFreshPick(pick, { token, relist: relistGooglePick });
    return fetchGooglePhotosMedia(token?.accessToken, pickBaseUrl(pick, item), size);
  };
  return {
    remote: true,
    name: item.filename || `${item.id}.jpg`,
    type: 'image/jpeg', // sized Google Photos URLs serve JPEG (also for HEIC originals)
    size: 0,
    load(maxDim) {
      const size = remoteSizeFor(maxDim);
      if (!cache.has(size)) {
        const p = fetchSized(size).catch((err) => {
          cache.delete(size);
          throw err;
        });
        cache.set(size, p);
      }
      return cache.get(size);
    },
  };
}

let seq = 0;
/** Picked items -> { metas, files } in the same shape readPhotoFiles returns. */
export function pickedItemsToPhotos(items, getToken, { maxPhotos = null, already = 0, pick = null } = {}) {
  const metas = [];
  const files = new Map();
  let limited = 0;
  for (const item of items || []) {
    if (maxPhotos != null && already + metas.length >= maxPhotos) {
      limited += 1;
      continue;
    }
    seq += 1;
    const id = `gp${Date.now().toString(36)}${seq.toString(36)}`;
    const source = createRemoteSource(item, getToken, pick);
    metas.push(buildPhotoMeta({ id, name: source.name, type: item.mimeType, tags: pickedItemToTags(item), timeSource: 'google' }));
    files.set(id, source);
  }
  return { metas, files, limited };
}
