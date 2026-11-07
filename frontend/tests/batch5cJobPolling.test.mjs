// Batch 5C: long-poll job status with short-poll backoff (SC-02), queued jobs (SC-07),
// server timeouts (SC-19), and podcast audio served through redirects (SC-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AI_JOB_LONG_POLL_SECONDS,
  AI_JOB_MAX_VISIBLE_WAIT_MS,
  AI_JOB_SERVER_TIMEOUT_CODE,
  jobStatusQuery,
  pollAiJobCore,
  publishAiJobQueue,
  shortPollDelayMs,
  subscribeAiJobQueue,
} from '../src/utils/aiJobPolling.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function run(responses, { clock = { t: 0, elapsed() { return this.t; }, dispose() {} }, onDelay = null, ...opts } = {}) {
  const calls = [];
  const delays = [];
  const cancelled = [];
  const promise = pollAiJobCore('job-1', {
    fetchStatus: async (_id, _signal, params) => {
      calls.push(params);
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : reply(next);
    },
    cancelJob: (id) => cancelled.push(id),
    delay: async (ms) => { delays.push(ms); onDelay?.(ms, clock); },
    clock,
    random: () => 0.5, // no jitter
    ...opts,
  });
  return { promise, calls, delays, cancelled, clock };
}

test('short-poll backoff: 1 -> 2 -> 4 -> 5 s, capped at 5 s, with +/-20 % jitter', () => {
  const mid = () => 0.5;
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((n) => shortPollDelayMs(n, mid)), [1000, 2000, 4000, 5000, 5000, 5000]);
  assert.equal(shortPollDelayMs(0, () => 0), 800);
  assert.equal(shortPollDelayMs(0, () => 1), 1200);
  assert.equal(shortPollDelayMs(3, () => 1), 5000, 'never above the cap');
  assert.equal(shortPollDelayMs(3, () => 0), 4000);
});

test('long poll: asks the server to hold for 20 s and re-polls right away after a held answer', async () => {
  const h = run([
    { status: 'pending', waited_ms: 20000 },
    { status: 'pending', waited_ms: 20000 },
    { status: 'done', result: { id: 't' } },
  ]);
  assert.deepEqual(await h.promise, { id: 't' });
  assert.equal(AI_JOB_LONG_POLL_SECONDS, 20);
  assert.ok(h.calls.every((c) => c.wait === 20), 'every poll is a long poll');
  assert.deepEqual(h.delays, [], 'no client-side waiting between held polls');
});

test('old backend (answers at once, no waited_ms): falls back to the 1/2/4/5 s backoff', async () => {
  const h = run([
    { status: 'pending' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' },
    { status: 'done', result: 1 },
  ]);
  assert.equal(await h.promise, 1);
  assert.deepEqual(h.delays, [1000, 2000, 4000, 5000, 5000]);
});

test('news (a new preview) is followed up quickly and resets the backoff', async () => {
  const partial = { id: 'p', articles: [] };
  const h = run([
    { status: 'pending' },
    { status: 'pending' },
    { status: 'pending', partial_rev: 1, partial },
    { status: 'pending' },
    { status: 'done', result: 2 },
  ], { onPartial: () => {} });
  assert.equal(await h.promise, 2);
  assert.deepEqual(h.delays, [1000, 2000, 250, 1000]);
  assert.equal(h.calls[3].partialRev, 1, 'the server is told which preview the client has');
});

test('failed long polls switch the job to short polling', async () => {
  const h = run([new Error('proxy cut the request'), new Error('again'), { status: 'pending' }, { status: 'done', result: 3 }]);
  assert.equal(await h.promise, 3);
  assert.equal(h.calls[0].wait, 20);
  assert.equal(h.calls[1].wait, 20);
  assert.equal(h.calls[2].wait, 0, 'two failures in a row: no more held requests');
  assert.equal(h.calls[3].wait, 0);
});

test('a long-poll fetch gets a timeout above the hold', async () => {
  const timeouts = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => { timeouts.push(ms); return realSetTimeout(fn, ms, ...rest); };
  try {
    const h = run([() => new Promise((resolve) => realSetTimeout(() => resolve(reply({ status: 'done', result: 4 })), 5))]);
    assert.equal(await h.promise, 4);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.ok(timeouts.some((ms) => ms > AI_JOB_LONG_POLL_SECONDS * 1000), `fetch timeout ${timeouts} must exceed the hold`);
});

test('queued job: reports the place in line, then clears it once the job starts', async () => {
  const seen = [];
  const h = run([
    { status: 'queued', position: 3, ahead: 2 },
    { status: 'queued', position: 1, ahead: 0 },
    { status: 'pending', waited_ms: 20000 },
    { status: 'done', result: 5 },
  ], { onQueued: (info) => seen.push(info) });
  assert.equal(await h.promise, 5);
  assert.deepEqual(seen, [{ position: 3, ahead: 2 }, { position: 1, ahead: 0 }, null]);
  assert.deepEqual(h.calls.map((c) => c.position), [0, 3, 1, 0], 'the server learns the last place seen');
});

test('time spent in the queue does not count against the visible-time budget', async () => {
  const clock = { t: 0, elapsed() { return this.t; }, dispose() {} };
  const at = (t, body) => () => { clock.t = t; return reply(body); };
  const h = run([
    at(0, { status: 'queued', position: 1 }),
    // Still in line well past the whole 5-minute budget...
    at(AI_JOB_MAX_VISIBLE_WAIT_MS + 60_000, { status: 'queued', position: 1, waited_ms: 20000 }),
    // ...then running for one minute.
    at(AI_JOB_MAX_VISIBLE_WAIT_MS + 120_000, { status: 'pending', waited_ms: 20000 }),
    at(AI_JOB_MAX_VISIBLE_WAIT_MS + 180_000, { status: 'pending', waited_ms: 20000 }),
    at(AI_JOB_MAX_VISIBLE_WAIT_MS + 190_000, { status: 'done', result: 6 }),
  ], { clock });
  assert.equal(await h.promise, 6);
  assert.deepEqual(h.cancelled, [], 'a job that waited in line is not timed out for it');
  assert.ok(h.calls.every((c) => c.wait === 20), 'never treated as the final (budget spent) poll');
});

test('server_timeout is an error with a flag, never an abort', async () => {
  const h = run([{ status: 'error', code: AI_JOB_SERVER_TIMEOUT_CODE, detail: 'Server busy' }]);
  await assert.rejects(h.promise, (err) => (
    err.name !== 'AbortError' && err.code === 'server_timeout' && err.serverTimeout === true && err.message === 'Server busy'
  ));
  assert.deepEqual(h.cancelled, [], 'the server already stopped it: no cancel call');
});

test('jobStatusQuery only sends what the client knows', () => {
  assert.equal(jobStatusQuery({}), '');
  assert.equal(jobStatusQuery({ partialRev: 2 }), '?partial_rev=2');
  assert.equal(jobStatusQuery({ partialRev: 0, wait: 20, position: 4 }), '?wait=20&position=4');
});

test('queue updates reach subscribers (the loading UI) and stop after unsubscribe', () => {
  const got = [];
  const off = subscribeAiJobQueue((info) => got.push(info));
  publishAiJobQueue('j1', { position: 2, ahead: 1 });
  publishAiJobQueue('j1', null);
  off();
  publishAiJobQueue('j1', { position: 9, ahead: 8 });
  assert.deepEqual(got, [{ jobId: 'j1', position: 2, ahead: 1 }, { jobId: 'j1', position: 0, ahead: 0 }]);
});

test('wiring: api.js long-polls and publishes the queue; App shows the line and the server timeout', () => {
  const api = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');
  assert.match(api, /publishAiJobQueue\(jobId, info\)/);
  assert.match(api, /format: 'url'/, 'downloads ask for a signed URL');
  assert.match(api, /const file = await fetch\(url\);/, 'the signed URL is fetched without API headers');
  const app = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');
  assert.match(app, /<AiQueueNotice/);
  assert.match(app, /err\.serverTimeout \? t\('app\.serverTimeout'\)/);
  for (const locale of ['en', 'he']) {
    const text = fs.readFileSync(path.join(srcDir, 'locales', `${locale}.js`), 'utf8');
    assert.match(text, /"waitingInLine": ".*\{ahead\}/, `${locale} has waitingInLine`);
    assert.match(text, /"waitingInLineNext":/);
    assert.match(text, /"serverTimeout":/);
  }
});

test('CSP lets the mixdown / prefetch fetch follow redirects to Supabase Storage', () => {
  const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  const csp = /connect-src ([^;]+);/.exec(vercel)?.[1] || '';
  assert.ok(csp.split(/\s+/).includes('https://*.supabase.co'), csp);
  assert.match(vercel, /media-src [^;]*https:/);
});
