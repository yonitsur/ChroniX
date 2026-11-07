// Who a story is for: saved with the story, read back by the Studio, and part of "changed".
import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers, storyOccasion } from '../src/data/storyBlueprints.js';
import { timelineToStoryAnswers, applyStoryToTimeline } from '../src/data/storyStudioSync.js';

const NOW = new Date(2026, 10, 5);
const couple = getStoryBlueprint('couple');
const base = { ...emptyStoryAnswers(couple), people: { p1: 'Claire', p2: 'Ethan' }, anchors: { met: { date: '2019' } } };

test('the chosen occasion is saved with the story and read back', () => {
  const { timeline } = buildStoryTimeline(couple, { ...base, occasion: 'gift' }, { lang: 'en', now: NOW });
  assert.equal(timeline.storyStudio.occasion, 'gift');
  const { answers } = timelineToStoryAnswers(timeline, { lang: 'en' });
  assert.equal(answers.occasion, 'gift');
});

test('no occasion, or an unknown one, is not saved', () => {
  assert.equal('occasion' in buildStoryTimeline(couple, base, { lang: 'en', now: NOW }).timeline.storyStudio, false);
  assert.equal('occasion' in buildStoryTimeline(couple, { ...base, occasion: 'roast' }, { lang: 'en', now: NOW }).timeline.storyStudio, false);
});

test('the memorial story type defaults to "in memory" until something else is chosen', () => {
  const memorial = getStoryBlueprint('memorial');
  assert.equal(storyOccasion(memorial, {}), 'memorial');
  assert.equal(storyOccasion(memorial, { occasion: '' }), '');
  assert.equal(storyOccasion(memorial, { occasion: 'family' }), 'family');
  assert.equal(storyOccasion(couple, {}), '');
});

test('changing only the occasion counts as a change when editing', () => {
  const { timeline } = buildStoryTimeline(couple, base, { lang: 'en', now: NOW });
  const same = applyStoryToTimeline(timeline, couple, base, { lang: 'en', now: NOW });
  assert.equal(same.changed, false);
  const changed = applyStoryToTimeline(timeline, couple, { ...base, occasion: 'family' }, { lang: 'en', now: NOW });
  assert.equal(changed.changed, true);
  assert.equal(changed.timeline.storyStudio.occasion, 'family');
});
