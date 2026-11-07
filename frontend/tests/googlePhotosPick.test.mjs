// B-28: Google Photos picks keep working past the ~1 hour URL / token lifetime, or fail clearly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPickState, ensureFreshPick, forEachLimit, googleTokenNeedsRefresh, isGooglePickExpired, pickBaseUrl,
  GOOGLE_PICK_MAX_AGE_MS,
} from '../src/utils/photoImport/googlePhotosPick.js';

const HOUR = 60 * 60 * 1000;

test('a pick expires about 55 minutes after its URLs were listed', () => {
  const pick = createPickState('s1', 0);
  assert.equal(isGooglePickExpired(pick, GOOGLE_PICK_MAX_AGE_MS - 1), false);
  assert.equal(isGooglePickExpired(pick, GOOGLE_PICK_MAX_AGE_MS), true);
  assert.equal(isGooglePickExpired(null, 0), true);
});

test('token refresh is needed within the safety margin or when missing', () => {
  assert.equal(googleTokenNeedsRefresh(null, 0), true);
  assert.equal(googleTokenNeedsRefresh({ accessToken: 't', expiresAt: HOUR }, 0), false);
  assert.equal(googleTokenNeedsRefresh({ accessToken: 't', expiresAt: HOUR }, HOUR - 60_000), true);
});

test('a fresh pick needs no re-list', async () => {
  const pick = createPickState('s1', Date.now());
  let calls = 0;
  await ensureFreshPick(pick, { token: { accessToken: 't', expiresAt: Date.now() + HOUR }, relist: async () => { calls += 1; return []; } });
  assert.equal(calls, 0);
});

test('a stale pick is re-listed once (shared by concurrent loads) and serves the new URLs', async () => {
  const pick = createPickState('s1', Date.now() - HOUR);
  let calls = 0;
  const relist = async (token, sessionId) => {
    calls += 1;
    assert.equal(token, 'tok');
    assert.equal(sessionId, 's1');
    return [{ id: 'a', baseUrl: 'https://fresh/a' }];
  };
  const token = { accessToken: 'tok', expiresAt: Date.now() + HOUR };
  await Promise.all([ensureFreshPick(pick, { token, relist }), ensureFreshPick(pick, { token, relist })]);
  assert.equal(calls, 1);
  assert.equal(pickBaseUrl(pick, { id: 'a', baseUrl: 'https://old/a' }), 'https://fresh/a');
  assert.equal(pickBaseUrl(pick, { id: 'b', baseUrl: 'https://old/b' }), 'https://old/b');
  assert.equal(isGooglePickExpired(pick), false);
});

test('an expired token or a closed session fails with a clear code', async () => {
  const stale = createPickState('s1', Date.now() - HOUR);
  await assert.rejects(
    ensureFreshPick(stale, { token: { accessToken: 't', expiresAt: Date.now() - 1 }, relist: async () => [] }),
    (err) => err.code === 'google-expired',
  );
  const released = { ...createPickState('s2', Date.now() - HOUR), released: true };
  await assert.rejects(
    ensureFreshPick(released, { token: { accessToken: 't', expiresAt: Date.now() + HOUR }, relist: async () => [] }),
    (err) => err.code === 'google-expired',
  );
  const failing = createPickState('s3', Date.now() - HOUR);
  await assert.rejects(
    ensureFreshPick(failing, { token: { accessToken: 't', expiresAt: Date.now() + HOUR }, relist: async () => { throw new Error('404'); } }),
    (err) => err.code === 'google-expired',
  );
  assert.equal(failing.refreshing, null);
});

test('prefetch runs with bounded concurrency and ignores failures', async () => {
  let active = 0;
  let peak = 0;
  const done = [];
  await forEachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    if (n === 4) throw new Error('boom');
    done.push(n);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 5, 6, 7]);
});
