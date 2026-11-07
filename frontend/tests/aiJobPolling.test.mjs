import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AI_JOB_MAX_VISIBLE_WAIT_MS,
  AI_JOB_TIMEOUT_MESSAGE,
  createVisibleElapsedClock,
  formatApiError,
  parseRetryAfterSeconds,
  pollAiJobCore,
} from '../src/utils/aiJobPolling.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Scripted status endpoint: returns the queued responses in order (the last one repeats).
function scriptedStatus(responses) {
  const calls = [];
  return {
    calls,
    fetchStatus: async (jobId) => {
      calls.push(jobId);
      const next = responses.length > 1 ? responses.shift() : responses[0];
      return typeof next === 'function' ? next() : next;
    },
  };
}

// Manually driven clock: `elapsed` is whatever the test says.
function fakeClock(startElapsed = 0) {
  const clock = { t: startElapsed, elapsed: () => clock.t, dispose() {} };
  return clock;
}

function harness({ responses, clock = fakeClock(), recoverResult = null, onDelay = null, knownTimeline = null }) {
  const status = scriptedStatus(responses);
  const cancelled = [];
  const recovered = [];
  const timelineInfo = [];
  const run = () => pollAiJobCore('job-1', {
    errorFallback: 'Failed to generate timeline',
    fetchStatus: status.fetchStatus,
    cancelJob: (id) => cancelled.push(id),
    delay: async (ms) => { onDelay?.(ms, clock); },
    clock,
    recoverResult: recoverResult
      ? async (id) => { recovered.push(id); return recoverResult(id); }
      : null,
    onTimelineInfo: (info) => timelineInfo.push(info),
    knownTimeline,
  });
  return { run, status, cancelled, recovered, timelineInfo, clock };
}

test('budget spent but the job is done: the final poll returns the result instead of timing out', async () => {
  const h = harness({
    clock: fakeClock(AI_JOB_MAX_VISIBLE_WAIT_MS + 1),
    responses: [reply(200, { status: 'done', result: { id: 't1', articles: [{ id: 'a' }] }, timeline_id: 't1', persisted: true })],
  });
  const result = await h.run();
  assert.equal(result.id, 't1');
  assert.deepEqual(h.cancelled, [], 'a finished job must never be cancelled');
  assert.equal(h.status.calls.length, 1);
});

test('budget spent while still pending: cancels the job and throws the timeout', async () => {
  const h = harness({
    clock: fakeClock(AI_JOB_MAX_VISIBLE_WAIT_MS + 1),
    responses: [reply(200, { status: 'pending' })],
  });
  await assert.rejects(h.run(), (err) => err.message === AI_JOB_TIMEOUT_MESSAGE);
  assert.deepEqual(h.cancelled, ['job-1']);
});

test('budget spent while pending but the timeline is already saved: opens it, no cancel', async () => {
  const h = harness({
    clock: fakeClock(AI_JOB_MAX_VISIBLE_WAIT_MS + 1),
    responses: [reply(200, { status: 'pending', timeline_id: 't9', persisted: true })],
    recoverResult: async (id) => ({ id, articles: [{ id: 'x' }] }),
  });
  const result = await h.run();
  assert.equal(result.id, 't9');
  assert.deepEqual(h.recovered, ['t9']);
  assert.deepEqual(h.cancelled, []);
});

test('final poll tolerates a transient network failure before deciding', async () => {
  let n = 0;
  const h = harness({
    clock: fakeClock(AI_JOB_MAX_VISIBLE_WAIT_MS + 1),
    responses: [() => {
      n += 1;
      if (n === 1) throw new TypeError('Failed to fetch');
      return reply(200, { status: 'done', result: { ok: true } });
    }],
  });
  assert.deepEqual(await h.run(), { ok: true });
  assert.deepEqual(h.cancelled, []);
});

test('404 after a persisted timeline_id was seen: fetches the saved timeline', async () => {
  const h = harness({
    responses: [
      reply(200, { status: 'pending', timeline_id: 'saved-1', persisted: true }),
      reply(404, { detail: 'Job not found or expired.' }),
    ],
    recoverResult: async (id) => ({ id, title: 'Saved', articles: [{ id: 'a' }] }),
  });
  const result = await h.run();
  assert.equal(result.id, 'saved-1');
  assert.deepEqual(h.recovered, ['saved-1']);
  assert.deepEqual(h.timelineInfo, [{ timelineId: 'saved-1', persisted: true }]);
  assert.deepEqual(h.cancelled, []);
  // 1 pending + the transient-404 retries + the final 404
  assert.equal(h.status.calls.length, 7);
});

test('404 when the timeline id is known but not yet saved: error carries the id, nothing fetched', async () => {
  const h = harness({
    responses: [
      reply(200, { status: 'pending', timeline_id: 'tl-refine', persisted: false }),
      reply(404, { detail: 'Job not found or expired.' }),
    ],
    recoverResult: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(h.run(), (err) => {
    assert.equal(err.message, 'Job not found or expired.');
    assert.equal(err.timelineId, 'tl-refine');
    assert.equal(err.persisted, false);
    return true;
  });
  assert.deepEqual(h.recovered, []);
});

test('404 on resume uses the timeline id remembered in the active-job record', async () => {
  const h = harness({
    responses: [reply(404, { detail: 'Job not found or expired.' })],
    knownTimeline: { timelineId: 'from-session', persisted: true },
    recoverResult: async (id) => ({ id, articles: [{ id: 'a' }] }),
  });
  const result = await h.run();
  assert.equal(result.id, 'from-session');
});

test('error with persisted:true: fetches the saved timeline instead of failing', async () => {
  const h = harness({
    responses: [reply(200, { status: 'error', detail: 'Post-processing failed', timeline_id: 'tl-2', persisted: true })],
    recoverResult: async (id) => ({ id, articles: [{ id: 'a' }] }),
  });
  const result = await h.run();
  assert.equal(result.id, 'tl-2');
  assert.deepEqual(h.recovered, ['tl-2']);
});

test('error with persisted:true but the saved timeline cannot be loaded: original error, tagged with the id', async () => {
  const h = harness({
    responses: [reply(200, { status: 'error', detail: 'Post-processing failed', timeline_id: 'tl-3', persisted: true })],
    recoverResult: async () => { throw new Error('Failed to load timeline'); },
  });
  await assert.rejects(h.run(), (err) => err.message === 'Post-processing failed' && err.timelineId === 'tl-3');
});

test('plain job error keeps code/subject (insufficient_info) and is not recovered', async () => {
  const h = harness({
    responses: [reply(200, { status: 'error', detail: 'No reliable info', code: 'insufficient_info', subject: 'Jane Doe' })],
    recoverResult: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(h.run(), (err) => err.code === 'insufficient_info' && err.subject === 'Jane Doe');
  assert.deepEqual(h.recovered, []);
});

test('time spent hidden is not counted against the budget', async () => {
  let now = 1_000_000;
  const listeners = new Set();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn); },
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  const setVisibility = (state) => {
    doc.visibilityState = state;
    listeners.forEach((fn) => fn());
  };
  const clock = createVisibleElapsedClock({ now: () => now, doc });

  let delays = 0;
  const h = harness({
    clock,
    responses: [
      reply(200, { status: 'pending' }),
      reply(200, { status: 'pending' }),
      reply(200, { status: 'done', result: { id: 'after-resume' } }),
    ],
    onDelay: () => {
      delays += 1;
      if (delays === 1) {
        // Phone backgrounded for 6 minutes (timers frozen), then the user returns.
        now += 1000;
        setVisibility('hidden');
        now += 6 * 60 * 1000;
        setVisibility('visible');
        now += 500;
      } else {
        now += 800;
      }
    },
  });
  const result = await h.run();
  assert.equal(result.id, 'after-resume');
  assert.deepEqual(h.cancelled, []);
  assert.ok(clock.elapsed() < 10_000, `visible elapsed should be a few seconds, got ${clock.elapsed()}`);
  assert.equal(listeners.size, 1, 'an injected clock is owned (and disposed) by the caller');
  clock.dispose();
  assert.equal(listeners.size, 0);
});

test('visible clock: a tab that starts hidden only counts time after it becomes visible', () => {
  let now = 0;
  const doc = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
  const clock = createVisibleElapsedClock({ now: () => now, doc });
  now = 60_000;
  assert.equal(clock.elapsed(), 0);
});

test('transient 401s while the session refreshes are still retried', async () => {
  const h = harness({
    responses: [
      reply(401, { detail: 'Authentication required' }),
      reply(401, { detail: 'Authentication required' }),
      reply(200, { status: 'done', result: { ok: 1 } }),
    ],
  });
  assert.deepEqual(await h.run(), { ok: 1 });
});

test('aborting cancels the job and throws AbortError', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = [];
  await assert.rejects(
    pollAiJobCore('job-x', {
      signal: controller.signal,
      fetchStatus: async () => reply(200, { status: 'pending' }),
      cancelJob: (id) => cancelled.push(id),
      delay: async () => {},
      clock: fakeClock(),
    }),
    (err) => err.name === 'AbortError',
  );
  assert.deepEqual(cancelled, ['job-x']);
});

test('422 validation detail is formatted, never "[object Object]"', async () => {
  const detail = [
    { loc: ['body', 'prompt'], msg: 'Field required', type: 'missing' },
    { loc: ['body', 'content_mode'], msg: 'Input should be classic or kids', type: 'enum' },
  ];
  assert.equal(formatApiError(detail, 'Failed'), 'prompt: Field required; content_mode: Input should be classic or kids');
  assert.equal(formatApiError({ message: 'Bad thing' }, 'Failed'), 'Bad thing');
  assert.equal(formatApiError({ weird: true }, 'Failed'), 'Failed');
  assert.equal(formatApiError('  ', 'Failed'), 'Failed');
  assert.equal(formatApiError('Plain message', 'Failed'), 'Plain message');
  assert.equal(formatApiError(undefined, 'Failed'), 'Failed');

  const h = harness({ responses: [reply(422, { detail })] });
  await assert.rejects(h.run(), (err) => {
    assert.ok(!err.message.includes('[object Object]'));
    assert.match(err.message, /prompt: Field required/);
    return true;
  });

  const h2 = harness({ responses: [reply(200, { status: 'error', detail: { message: 'Structured failure' } })] });
  await assert.rejects(h2.run(), (err) => err.message === 'Structured failure');
});

test('Retry-After parsing: seconds, HTTP date, junk', () => {
  assert.equal(parseRetryAfterSeconds('15'), 15);
  assert.equal(parseRetryAfterSeconds(null), null);
  assert.equal(parseRetryAfterSeconds('soon'), null);
  const now = Date.parse('2026-11-05T10:00:00Z');
  assert.equal(parseRetryAfterSeconds('Thu, 05 Nov 2026 10:00:10 GMT', now), 10);
});

test('api.js wires recovery per job kind and remembers the timeline id for reloads', () => {
  const apiSrc = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');
  // generate, photo/file prompt, files (B-09) and refine resolve with the saved timeline; chat and
  // chat file attach (B-09) as a recovered edit.
  assert.equal((apiSrc.match(/recoverResult: recoverAsTimeline/g) || []).length, 4);
  assert.equal((apiSrc.match(/recoverResult: recoverAsChatEdit/g) || []).length, 2);
  assert.match(apiSrc, /setActiveAiJob\(\{ \.\.\.active, timelineId, persisted/);
  // Both job-start paths share the Retry-After / formatted-error handling.
  assert.equal((apiSrc.match(/await startAiJob\(/g) || []).length, 2);
  // The reload/resume path recovers from the remembered id too.
  assert.match(appSrc, /knownTimeline: \{ timelineId: pendingJob\.timelineId/);
  assert.match(appSrc, /res\.recovered \? t\('chat\.updated'\)/);
});
