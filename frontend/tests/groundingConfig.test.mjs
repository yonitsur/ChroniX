import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUNDING_STORAGE_KEY,
  DEFAULT_TIMELINE_MODE,
  IS_DEFAULT_GROUNDING_ENABLED,
  getDefaultTimelineMode,
  isDefaultGroundingEnabled,
  readGroundingPref,
  writeGroundingPref,
} from '../src/utils/groundingConfig.js';

test('timeline creation mode always defaults to fast with grounding disabled', () => {
  assert.equal(DEFAULT_TIMELINE_MODE, 'fast');
  assert.equal(IS_DEFAULT_GROUNDING_ENABLED, false);
  assert.equal(getDefaultTimelineMode(), 'fast');
  assert.equal(isDefaultGroundingEnabled(), false);
});

test('grounding preference is stateless and never sticks in localStorage', () => {
  const store = new Map([[GROUNDING_STORAGE_KEY, 'true']]);
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    assert.equal(readGroundingPref(), false);
    writeGroundingPref(true);
    assert.equal(store.has(GROUNDING_STORAGE_KEY), false);
    assert.equal(readGroundingPref(), false);
  } finally {
    if (prevStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = prevStorage;
    }
  }
});
