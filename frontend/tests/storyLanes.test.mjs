// Empty built-in lanes are left out of the timeline that is shown and saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers, withoutEmptyStoryLanes } from '../src/data/storyBlueprints.js';

const NOW = new Date(2026, 10, 5);

test('built-in lanes with no events are dropped, the rest keep their order and colour', () => {
  const bp = getStoryBlueprint('couple');
  const answers = {
    ...emptyStoryAnswers(bp),
    people: { p1: 'Claire', p2: 'Ethan' },
    anchors: { p1born: { date: '1995' }, met: { date: '2019' } },
  };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'en', now: NOW });
  assert.equal(timeline.lanes.length, 3);
  const shown = withoutEmptyStoryLanes(timeline, bp);
  const usedLanes = new Set(timeline.articles.map((a) => a.lane));
  assert.ok(shown.lanes.length < 3);
  assert.ok(shown.lanes.every((l) => usedLanes.has(l.id)));
  assert.deepEqual(shown.lanes.map((l) => l.order), shown.lanes.map((_, i) => i + 1));
  for (const l of shown.lanes) assert.equal(l.color, timeline.lanes.find((x) => x.id === l.id).color);
  assert.equal(shown.articles, timeline.articles);
});

test('lanes the person added themselves are kept even when empty', () => {
  const bp = getStoryBlueprint('couple');
  const answers = {
    ...emptyStoryAnswers(bp),
    people: { p1: 'Claire', p2: 'Ethan' },
    anchors: { met: { date: '2019' } },
    extraLanes: [{ id: 'friends', title: 'Friends' }],
  };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'en', now: NOW });
  const shown = withoutEmptyStoryLanes(timeline, bp);
  assert.ok(shown.lanes.some((l) => l.id === 'friends'));
});

test('free-form lanes are never dropped, and a timeline always keeps a lane', () => {
  const custom = getStoryBlueprint('custom');
  const { timeline } = buildStoryTimeline(custom, { ...emptyStoryAnswers(custom), customLanes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }, { lang: 'en', now: NOW });
  assert.equal(withoutEmptyStoryLanes(timeline, custom), timeline);
  const bp = getStoryBlueprint('lifeStory');
  const empty = buildStoryTimeline(bp, emptyStoryAnswers(bp), { lang: 'en', now: NOW }).timeline;
  assert.equal(withoutEmptyStoryLanes(empty, bp), empty);
});
