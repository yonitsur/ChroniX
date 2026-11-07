// B-10 (b): switching the voice gender of a premium episode goes through the premium confirm flow
// whenever that gender isn't paid for yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { genderSwitchNeedsPremiumUnlock, isGeminiGenderUnlocked } from '../src/utils/podcastPlayback.js';

const ep = (gemini, voice_gender = 'male') => ({ voice_gender, audio: { gemini } });

test('per-gender unlock flags from the server decide', () => {
  const episode = ep({ unlocked: true, unlocked_genders: { male: true, female: false } });
  assert.equal(isGeminiGenderUnlocked(episode, 'male'), true);
  assert.equal(isGeminiGenderUnlocked(episode, 'female'), false);
  assert.equal(genderSwitchNeedsPremiumUnlock(episode, 'gemini', 'female'), true);
  assert.equal(genderSwitchNeedsPremiumUnlock(episode, 'gemini', 'male'), false);
});

test('free engines never need an unlock', () => {
  const episode = ep({ unlocked_genders: { male: false, female: false } });
  assert.equal(genderSwitchNeedsPremiumUnlock(episode, 'edge', 'female'), false);
  assert.equal(genderSwitchNeedsPremiumUnlock(episode, 'gcloud', 'female'), false);
});

test('older responses: only the episode\'s own gender counts as unlocked', () => {
  const episode = ep({ unlocked: true }, 'female');
  assert.equal(isGeminiGenderUnlocked(episode, 'female'), true);
  assert.equal(isGeminiGenderUnlocked(episode, 'male'), false);
  assert.equal(genderSwitchNeedsPremiumUnlock({ audio: {} }, 'gemini', 'male'), true);
});
