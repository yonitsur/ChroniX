import test from 'node:test';
import assert from 'node:assert/strict';

import { createShareHandler } from '../api/share.js';

const INDEX_HTML = `<!doctype html><html><head>
    <title>ChroniX – Interactive Visual Timelines</title>
    <meta name="description" content="Default description" />
    <meta property="og:title" content="ChroniX – Interactive Visual Timelines" />
  </head><body><div id="root"></div></body></html>`;

function mockResponse() {
  const res = { statusCode: null, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
}

const request = (id = 'tl-123') => ({
  query: { id },
  headers: { host: 'chronix.example', 'x-forwarded-proto': 'https' },
});

const withApiUrl = async (fn) => {
  const prev = process.env.VITE_API_URL;
  process.env.VITE_API_URL = 'https://backend.example';
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.VITE_API_URL;
    else process.env.VITE_API_URL = prev;
  }
};

const okText = (text) => ({ ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) });

test('backend that never answers: app shell with default tags arrives within the timeout, not cached', async () => {
  const seenSignals = [];
  const fetchImpl = (url, init) => {
    if (url.endsWith('/index.html')) return Promise.resolve(okText(INDEX_HTML));
    seenSignals.push(init?.signal);
    return new Promise(() => {}); // asleep backend: never resolves, ignores abort
  };
  const handler = createShareHandler({ fetchImpl, timeoutMs: 50 });
  const res = mockResponse();
  const started = Date.now();
  await withApiUrl(() => handler(request(), res));
  const took = Date.now() - started;

  assert.ok(took < 1000, `responded in ${took}ms`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, INDEX_HTML, 'default OG tags from the app shell');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(seenSignals.length, 1);
  assert.equal(seenSignals[0].aborted, true, 'the hung backend request is aborted');
});

test('nothing answers at all: redirect fallback still carries default OG tags', async () => {
  const handler = createShareHandler({ fetchImpl: () => new Promise(() => {}), timeoutMs: 30 });
  const res = mockResponse();
  await withApiUrl(() => handler(request(), res));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<meta property="og:title" content="ChroniX – Interactive Visual Timelines" \/>/);
  assert.match(res.body, /og:image" content="https:\/\/chronix\.example\/chronix_logo_full\.png"/);
  // The CSP blocks inline scripts (S-08), so the redirect is the meta refresh (plus a plain link).
  assert.match(res.body, /<meta http-equiv="refresh" content="0;url=\/\?timeline=tl-123" \/>/);
  assert.ok(!res.body.includes('<script'));
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('backend answers in time: timeline tags are injected and edge-cached', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/index.html')) return okText(INDEX_HTML);
    // P-07: link previews read the light meta endpoint, not the whole timeline.
    assert.equal(url, 'https://backend.example/api/timelines/tl-123/meta');
    return okText(JSON.stringify({ title: 'Roman Empire', description: 'Rise and fall', articles: [] }));
  };
  const handler = createShareHandler({ fetchImpl, timeoutMs: 1000 });
  const res = mockResponse();
  await withApiUrl(() => handler(request(), res));
  assert.match(res.body, /Roman Empire \| ChroniX/);
  assert.ok(!res.body.includes('Default description'));
  assert.match(res.headers['cache-control'], /s-maxage=300/);
});

test('timeline not found: app shell, not cached (unchanged behaviour)', async () => {
  const fetchImpl = async (url) => (url.endsWith('/index.html')
    ? okText(INDEX_HTML)
    : { ok: false, status: 404, json: async () => ({ detail: 'Timeline not found' }) });
  const handler = createShareHandler({ fetchImpl, timeoutMs: 1000 });
  const res = mockResponse();
  await withApiUrl(() => handler(request(), res));
  assert.equal(res.body, INDEX_HTML);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('invalid id is still a 404', async () => {
  const handler = createShareHandler({ fetchImpl: () => { throw new Error('must not fetch'); } });
  const res = mockResponse();
  await handler(request('bad/id'), res);
  assert.equal(res.statusCode, 404);
});
