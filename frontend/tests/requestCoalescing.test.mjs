import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlight, createCoalescer } from '../src/utils/requestCoalescing.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('single flight: concurrent callers share one anonymous sign-in', async () => {
  let calls = 0;
  const gate = deferred();
  const signIn = createSingleFlight(() => {
    calls += 1;
    return gate.promise;
  });
  const a = signIn();
  const b = signIn();
  assert.equal(a, b);
  gate.resolve({ data: { session: { access_token: 'guest-1' } }, error: null });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(ra.data.session.access_token, 'guest-1');
  assert.equal(rb, ra);
});

test('single flight: a call after settling starts a new run', async () => {
  let calls = 0;
  const run = createSingleFlight(async () => {
    calls += 1;
    return calls;
  });
  assert.equal(await run(), 1);
  assert.equal(await run(), 2);
});

test('single flight: a rejection is shared, then cleared so the next call retries', async () => {
  let calls = 0;
  const run = createSingleFlight(async () => {
    calls += 1;
    if (calls === 1) throw new Error('network');
    return 'ok';
  });
  const a = run();
  const b = run();
  await assert.rejects(a, /network/);
  await assert.rejects(b, /network/);
  assert.equal(await run(), 'ok');
  assert.equal(calls, 2);
});

test('single flight: a synchronous throw becomes a rejected promise', async () => {
  const run = createSingleFlight(() => { throw new Error('boom'); });
  await assert.rejects(run(), /boom/);
});

function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    setTimer: (cb, ms) => { const t = { cb, at: now + ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.done = true; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => !t.done && t.at <= end).sort((x, y) => x.at - y.at)[0];
        if (!due) break;
        now = due.at;
        due.done = true;
        due.cb();
      }
      now = end;
    },
  };
}

test('coalescer: first trigger runs at once, a burst collapses into one trailing call', () => {
  const clock = fakeClock();
  let runs = 0;
  const c = createCoalescer(() => { runs += 1; }, 2000, clock);
  c.trigger();
  assert.equal(runs, 1);
  clock.advance(100);
  c.trigger();
  c.trigger();
  c.trigger();
  assert.equal(runs, 1);
  clock.advance(1899);
  assert.equal(runs, 1);
  clock.advance(1);
  assert.equal(runs, 2);
});

test('coalescer: never more than one call per window, and a quiet period resets it', () => {
  const clock = fakeClock();
  let runs = 0;
  const c = createCoalescer(() => { runs += 1; }, 2000, clock);
  for (let i = 0; i < 50; i += 1) {
    c.trigger();
    clock.advance(100);
  }
  // 5 s of continuous triggers: immediate + one trailing call per 2 s window.
  assert.ok(runs <= 4, `ran ${runs} times`);
  clock.advance(5000);
  const before = runs;
  c.trigger();
  assert.equal(runs, before + 1);
});

test('coalescer: cancel drops a pending trailing call', () => {
  const clock = fakeClock();
  let runs = 0;
  const c = createCoalescer(() => { runs += 1; }, 2000, clock);
  c.trigger();
  c.trigger();
  c.cancel();
  clock.advance(5000);
  assert.equal(runs, 1);
});
