// Story Studio: per-moment summary line and story text, the AI overview's facts, and editing
// events from the preview's details drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers } from '../src/data/storyBlueprints.js';
import {
  timelineToStoryAnswers, applyStoryToTimeline, storyOverviewFacts, applyEventEditToAnswers,
  removeStoryRow, applyEventExtras, findStoryRow,
} from '../src/data/storyStudioSync.js';

const NOW = new Date(2026, 10, 5);
const opts = { lang: 'en', now: NOW };
const couple = getStoryBlueprint('couple');
const baseAnswers = (extra = {}) => ({
  ...emptyStoryAnswers(couple),
  people: { p1: 'Claire', p2: 'Ethan' },
  ...extra,
});

test('summary line, story text and overview are built, read back and merged', () => {
  const answers = baseAnswers({
    anchors: { met: { date: '2019', note: "At a friend's wedding", story: 'We danced all night.' } },
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2022', lane: 'together', story: 'A rescue pup.' }],
    overview: '## Our story\n\nIt began in 2019.',
  });
  const { timeline } = buildStoryTimeline(couple, answers, { ...opts, id: 'tl-2' });
  const met = timeline.articles.find((a) => a.storyAnchor === 'met');
  assert.equal(met.subtitle, "At a friend's wedding");
  assert.equal(met.extract, 'We danced all night.');
  assert.equal(met.extractIsCustom, true);
  assert.equal(timeline.overview, '## Our story\n\nIt began in 2019.');

  const back = timelineToStoryAnswers(timeline, opts);
  assert.equal(back.answers.anchors.met.story, 'We danced all night.');
  assert.equal(back.answers.moments[0].story, 'A rescue pup.');
  assert.equal(back.answers.overview, '## Our story\n\nIt began in 2019.');
  assert.equal(applyStoryToTimeline(timeline, back.blueprint, back.answers, opts).changed, false);

  const edited = {
    ...back.answers,
    moments: back.answers.moments.map((m) => ({ ...m, story: 'A rescue pup from the shelter.' })),
    overview: 'Rewritten.',
  };
  const res = applyStoryToTimeline(timeline, back.blueprint, edited, opts);
  assert.equal(res.changed, true);
  assert.equal(res.timeline.overview, 'Rewritten.');
  assert.equal(res.timeline.articles.find((a) => a.title === 'Adopted Maple').extract, 'A rescue pup from the shelter.');
});

test('a description written elsewhere is kept as-is when the Studio saves without changes', () => {
  const { timeline } = buildStoryTimeline(couple, baseAnswers({
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2022', lane: 'together' }],
  }), { ...opts, id: 'tl-3' });
  timeline.articles = timeline.articles.map((a) => ({ ...a, extract: 'Written in the editor\n', subtitle: 'From the editor' }));
  const { blueprint, answers } = timelineToStoryAnswers(timeline, opts);
  const res = applyStoryToTimeline(timeline, blueprint, answers, opts);
  assert.equal(res.changed, false);
  assert.equal(res.timeline.articles[0].extract, 'Written in the editor\n');
  assert.equal(res.timeline.articles[0].subtitle, 'From the editor');
});

test('overview facts list the moments in date order with their notes', () => {
  const { timeline } = buildStoryTimeline(couple, baseAnswers({
    anchors: { met: { date: 'around 2019', place: 'Lisbon', story: 'Danced all night.' } },
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2017', lane: 'together' }],
  }), opts);
  const facts = storyOverviewFacts(timeline, { kind: 'Couple', people: ['Claire', 'Ethan', ''], lang: 'en' });
  assert.equal(facts.title, timeline.title);
  assert.deepEqual(facts.people, ['Claire', 'Ethan']);
  const metTitle = timeline.articles.find((a) => a.storyAnchor === 'met').title;
  assert.deepEqual(facts.moments.map((m) => m.title), ['Adopted Maple', metTitle]);
  const met = facts.moments[1];
  assert.equal(met.date, 'c. 2019');
  assert.equal(met.place, 'Lisbon');
  assert.equal(met.story, 'Danced all night.');
  assert.ok(met.lane);
});

test('editing an event in the preview drawer updates its form row and keeps the extras', () => {
  const answers = baseAnswers({
    anchors: { met: { date: 'around 2019', place: 'Lisbon' } },
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2022', lane: 'together' }],
  });
  const { timeline } = buildStoryTimeline(couple, answers, opts);
  const maple = timeline.articles.find((a) => a.title === 'Adopted Maple');
  assert.deepEqual(findStoryRow(couple, answers, maple.id), { kind: 'moment', id: 'x' });

  const saved = {
    ...maple,
    title: 'Maple comes home',
    subtitle: 'Our first dog',
    extract: 'From the shelter in town.',
    from: { year: 2022, month: 3, precision: 'month' },
    locationName: 'Porto', lat: 41.1, lng: -8.6, googleMapsUrl: 'https://maps',
    imageUrl: 'data:image/jpeg;base64,xx', category: 'Pets', isEdited: true,
  };
  const res = applyEventEditToAnswers(couple, answers, saved, maple, opts);
  const row = res.answers.moments[0];
  assert.equal(row.title, 'Maple comes home');
  assert.equal(row.note, 'Our first dog');
  assert.equal(row.story, 'From the shelter in town.');
  assert.equal(row.date, 'March 2022');
  assert.equal(row.place, 'Porto');
  assert.equal(row.lane, 'together');
  assert.equal(res.extras.imageUrl, 'data:image/jpeg;base64,xx');
  assert.equal(res.extras.category, 'Pets');
  assert.equal(res.extras.title, undefined);

  // The extras ride on the rebuilt article; coordinates only while the place is unchanged.
  const rebuilt = buildStoryTimeline(couple, res.answers, opts).timeline.articles;
  const withExtras = applyEventExtras(rebuilt, { [maple.id]: res.extras }).find((a) => a.id === maple.id);
  assert.equal(withExtras.title, 'Maple comes home');
  assert.equal(withExtras.extract, 'From the shelter in town.');
  assert.equal(withExtras.imageUrl, 'data:image/jpeg;base64,xx');
  assert.equal(withExtras.lat, 41.1);
  const moved = { ...res.answers, moments: res.answers.moments.map((m) => ({ ...m, place: 'Braga' })) };
  const movedArticle = applyEventExtras(buildStoryTimeline(couple, moved, opts).timeline.articles, { [maple.id]: res.extras })
    .find((a) => a.id === maple.id);
  assert.equal(movedArticle.lat, undefined);
  assert.equal(movedArticle.imageUrl, 'data:image/jpeg;base64,xx');
});

test('an unchanged date keeps its fuzzy wording; a template title stays a template', () => {
  const answers = baseAnswers({ anchors: { met: { date: 'summer 2019' } } });
  const { timeline } = buildStoryTimeline(couple, answers, opts);
  const met = timeline.articles.find((a) => a.storyAnchor === 'met');
  const res = applyEventEditToAnswers(couple, answers, { ...met, subtitle: 'Hello' }, met, opts);
  assert.equal(res.answers.anchors.met.date, 'summer 2019');
  assert.equal(res.answers.anchors.met.title, '');
  assert.equal(res.answers.anchors.met.note, 'Hello');
});

test('deleting from the preview drawer removes the form row', () => {
  const answers = baseAnswers({
    anchors: { met: { date: '2019' } },
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2022', lane: 'together' }],
  });
  const { timeline } = buildStoryTimeline(couple, answers, opts);
  const met = timeline.articles.find((a) => a.storyAnchor === 'met');
  assert.deepEqual(removeStoryRow(couple, answers, met.id).anchors.met, {});
  assert.deepEqual(removeStoryRow(couple, answers, 'ss-m-x').moments, []);
  assert.equal(removeStoryRow(couple, answers, 'nope'), answers);
});
