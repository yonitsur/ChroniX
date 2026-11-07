// Small LRU maps keyed by image URL, for module-level canvas caches.
//
// Image URLs can be data URLs of 100 KB or more (AI images, uploads). Used directly as Map
// keys they keep those strings alive for the whole session, even after the timeline that
// used them is gone. Long URLs are therefore keyed by a short fingerprint (length plus a
// hash of the head, the tail and a sparse sample of the body), and every map is capped.
// The fingerprint reads a few hundred characters at most, so it is cheap enough for
// per-frame lookups. A collision only means one image's cached aspect / retry state is
// used for another, which is cosmetic and self-corrects on the next load.

const SHORT_URL_MAX = 512;
const HEAD = 96;
const TAIL = 160;
const SAMPLES = 64;

function fnv1a(hash, str, from, to) {
  let h = hash;
  for (let i = from; i < to; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/** Short, stable key for `url` (the URL itself when it is already short). */
export function getUrlCacheKey(url) {
  if (typeof url !== 'string') return url;
  const len = url.length;
  if (len <= SHORT_URL_MAX) return url;
  let h1 = fnv1a(0x811c9dc5, url, 0, HEAD);
  h1 = fnv1a(h1, url, len - TAIL, len);
  let h2 = 0x9e3779b9;
  const step = Math.max(1, Math.floor((len - HEAD - TAIL) / SAMPLES));
  for (let i = HEAD; i < len - TAIL; i += step) {
    h2 ^= url.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `#${len}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/** Map-like LRU keyed by URL (through getUrlCacheKey), holding at most `limit` entries. */
export function createUrlKeyedLru(limit) {
  const map = new Map();
  let max = Math.max(1, limit);
  const touch = (key, value) => {
    map.delete(key);
    map.set(key, value);
  };
  return {
    get(url) {
      const key = getUrlCacheKey(url);
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      touch(key, value);
      return value;
    },
    has(url) {
      return map.has(getUrlCacheKey(url));
    },
    set(url, value) {
      const key = getUrlCacheKey(url);
      touch(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
      return this;
    },
    delete(url) {
      return map.delete(getUrlCacheKey(url));
    },
    clear() {
      map.clear();
    },
    forEach(callback) {
      map.forEach((value) => callback(value));
    },
    setLimit(nextLimit) {
      max = Math.max(1, nextLimit);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() {
      return map.size;
    },
  };
}
