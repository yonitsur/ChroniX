import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_FLAGS,
  DEFAULT_FEATURE_FLAGS,
  parseBooleanFlag,
  isFeatureEnabled,
  isInteractiveGuideEnabled,
  isHomeGuideEnabled,
  isTimelineGuideEnabled,
} from './featureFlags.js';

test('parseBooleanFlag correctly parses various truthy and falsy expressions', () => {
  assert.equal(parseBooleanFlag(true), true);
  assert.equal(parseBooleanFlag('true'), true);
  assert.equal(parseBooleanFlag('1'), true);
  assert.equal(parseBooleanFlag('on'), true);
  assert.equal(parseBooleanFlag('yes'), true);
  assert.equal(parseBooleanFlag('enabled'), true);

  assert.equal(parseBooleanFlag(false), false);
  assert.equal(parseBooleanFlag('false'), false);
  assert.equal(parseBooleanFlag('0'), false);
  assert.equal(parseBooleanFlag('off'), false);
  assert.equal(parseBooleanFlag('no'), false);
  assert.equal(parseBooleanFlag('disabled'), false);

  assert.equal(parseBooleanFlag('invalid'), undefined);
  assert.equal(parseBooleanFlag(null), undefined);
  assert.equal(parseBooleanFlag(undefined), undefined);
});

test('Interactive guide feature flag defaults to disabled (false)', () => {
  assert.equal(DEFAULT_FEATURE_FLAGS[FEATURE_FLAGS.INTERACTIVE_GUIDE], false);
  assert.equal(DEFAULT_FEATURE_FLAGS[FEATURE_FLAGS.HOME_SCREEN_GUIDE], false);
  assert.equal(DEFAULT_FEATURE_FLAGS[FEATURE_FLAGS.TIMELINE_SCREEN_GUIDE], false);

  assert.equal(isInteractiveGuideEnabled(), false);
  assert.equal(isHomeGuideEnabled(), false);
  assert.equal(isTimelineGuideEnabled(), false);
});
