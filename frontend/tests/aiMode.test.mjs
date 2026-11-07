import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAiModeInfo,
  basicNoticeStorageKey,
  isCapacityErrorMessage,
  formatResetTime,
} from '../src/utils/aiMode.js';

const RESET = '2026-11-06T00:00:00Z';
const limited = (over = {}) => ({
  is_admin: false, mode: 'limited', tier: 'paid', daily_paid_limit: 25, remaining_paid: 10, resets_at: RESET, ...over,
});

test('fast credits remaining -> not basic', () => {
  assert.equal(getAiModeInfo(limited()).isBasic, false);
});

test('credits used up -> basic, reason credits, with reset time', () => {
  const info = getAiModeInfo(limited({ remaining_paid: 0, tier: 'free' }));
  assert.equal(info.isBasic, true);
  assert.equal(info.reason, 'credits');
  assert.equal(info.resetsAt.toISOString(), '2026-11-06T00:00:00.000Z');
});

test('own key or admin is never basic', () => {
  const q = limited({ remaining_paid: 0, tier: 'free' });
  assert.equal(getAiModeInfo(q, { hasCustomKey: true }).isBasic, false);
  assert.equal(getAiModeInfo({ ...q, is_admin: true }).isBasic, false);
});

test('community pool exhausted with credits left -> reason pool', () => {
  const info = getAiModeInfo(limited({ tier: 'free', community_pool_exhausted: true, remaining_paid: 0, daily_paid_limit: -1 }));
  assert.equal(info.reason, 'pool');
});

test('hidden spend cap is presented as credits', () => {
  const info = getAiModeInfo(limited({ tier: 'free', daily_spend_capped: true, remaining_paid: 0 }));
  assert.equal(info.reason, 'credits');
});

test('site-wide basic mode has no reset time', () => {
  const info = getAiModeInfo({ is_admin: false, mode: 'free', tier: 'free', resets_at: RESET });
  assert.equal(info.reason, 'site');
  assert.equal(info.resetsAt, null);
});

test('missing quota is not basic (no flash while loading)', () => {
  assert.equal(getAiModeInfo(null).isBasic, false);
});

test('notice storage key is per credit day', () => {
  const info = getAiModeInfo(limited({ remaining_paid: 0, tier: 'free' }));
  assert.equal(basicNoticeStorageKey(info), 'chronix_basic_notice_seen_2026-11-06');
});

test('capacity error detection', () => {
  assert.ok(isCapacityErrorMessage('The shared AI service is temporarily at capacity (high demand)'));
  assert.ok(isCapacityErrorMessage('429 RESOURCE_EXHAUSTED'));
  assert.ok(!isCapacityErrorMessage('Timeline not found'));
});

test('formatResetTime handles bad input', () => {
  assert.equal(formatResetTime(null, 'en'), '');
  assert.ok(formatResetTime(new Date(RESET), 'en').length > 0);
});
