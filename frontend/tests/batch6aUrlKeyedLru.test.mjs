import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrlKeyedLru, getUrlCacheKey } from '../src/components/timeline/urlKeyedLru.js';

const dataUrl = (seed, length = 120_000) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let body = '';
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    body += chars[x % 64];
  }
  return `data:image/png;base64,${body}`;
};

test('short URLs are their own key; long data URLs get a short fingerprint', () => {
  const http = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/500px-x.jpg';
  assert.equal(getUrlCacheKey(http), http);
  const long = dataUrl(1);
  const key = getUrlCacheKey(long);
  assert.ok(key.length < 40, key);
  assert.equal(getUrlCacheKey(long), key, 'stable');
  // A copy of the same string (different object) maps to the same key.
  assert.equal(getUrlCacheKey(`${long.slice(0, 10)}${long.slice(10)}`), key);
  assert.notEqual(getUrlCacheKey(dataUrl(2)), key);
});

test('the LRU never retains the long URL and evicts the least recently used entry', () => {
  const lru = createUrlKeyedLru(3);
  const urls = [dataUrl(11, 5000), dataUrl(12, 5000), dataUrl(13, 5000), dataUrl(14, 5000)];
  lru.set(urls[0], 0.5);
  lru.set(urls[1], 1);
  lru.set(urls[2], 2);
  assert.equal(lru.get(urls[0]), 0.5); // touch 0 -> 1 is now the oldest
  lru.set(urls[3], 3);
  assert.equal(lru.size, 3);
  assert.equal(lru.has(urls[1]), false);
  assert.equal(lru.get(urls[0]), 0.5);
  assert.equal(lru.get(urls[3]), 3);
  lru.setLimit(1);
  assert.equal(lru.size, 1);
  assert.equal(lru.has(urls[3]), true);
  lru.delete(urls[3]);
  assert.equal(lru.size, 0);
});

test('forEach visits values (used to release disposed timeline owners)', () => {
  const lru = createUrlKeyedLru(8);
  const owner = {};
  lru.set('a', { owner });
  lru.set('b', { owner: {} });
  lru.forEach((entry) => { if (entry.owner === owner) entry.owner = null; });
  assert.equal(lru.get('a').owner, null);
  assert.notEqual(lru.get('b').owner, null);
});
