import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers } from '../src/data/storyBlueprints.js';
import { timelineToStoryAnswers, applyStoryToTimeline, sameStoryDate, articlesNeedingGeocode } from '../src/data/storyStudioSync.js';

const NOW = new Date(2026, 10, 5);
const opts = { lang: 'en', now: NOW };

function createdCouple() {
  const bp = getStoryBlueprint('couple');
  const answers = {
    ...emptyStoryAnswers(bp),
    people: { p1: 'Claire', p2: 'Ethan' },
    anchors: {
      p1born: { date: 'April 1995', place: 'Burlington' },
      met: { date: 'October 18, 2019', place: 'Cambridge' },
      wedding: { date: 'around 2025' },
    },
    moments: [{ id: 'x', title: 'Adopted Maple', date: '2022', lane: 'together' }],
    chapters: [{ id: 'c1', title: 'Student years', from: '2013', to: '2017' }],
  };
  const { timeline } = buildStoryTimeline(bp, answers, { ...opts, id: 'tl-1' });
  // Pretend the places were geocoded on create.
  timeline.articles = timeline.articles.map((a) => (a.locationName ? { ...a, lat: 1, lng: 2 } : a));
  return timeline;
}

test('re-opening and saving without changes is a no-op', () => {
  const tl = createdCouple();
  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  assert.equal(blueprint.key, 'couple');
  assert.equal(answers.people.p1, 'Claire');
  assert.equal(answers.anchors.met.date, 'October 18, 2019');
  assert.equal(answers.anchors.met.place, 'Cambridge');
  assert.equal(answers.anchors.wedding.date, 'c. 2025');
  assert.deepEqual(answers.moments.map((m) => m.title), ['Adopted Maple']);
  assert.deepEqual(answers.chapters.map((c) => c.title), ['Student years']);
  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.equal(res.changed, false);
  assert.deepEqual(res.removedEventIds, []);
});

test('edits made outside the Studio are read back and survive a Studio save', () => {
  const tl = createdCouple();
  tl.articles = tl.articles.map((a) => (a.id === 'ss-met'
    ? { ...a, imageUrl: 'https://x/photo.jpg', subtitle: 'A rainy bookshop evening.', rank: 10, to: { year: 2019, month: 10, day: 19, precision: 'day' }, lane: 'p1' }
    : a));
  tl.articles.push({ id: 'canvas-1', title: 'Patagonia trek', lane: 'p2', from: { year: 2017, month: 1, day: 6, hour: 9, precision: 'hour' }, extract: 'Long story' });
  tl.lanes = tl.lanes.map((l) => (l.id === 'together' ? { ...l, title: 'Our life together' } : l));
  tl.lanes.push({ id: 'friends', title: 'Friends', color: '#000', order: 4 });
  tl.timeBands = tl.timeBands.filter((b) => b.id !== 'auto-beforeMet');

  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  assert.ok(answers.moments.some((m) => m.title === 'Patagonia trek' && m.date === 'January 6, 2017'));
  assert.equal(answers.laneTitles.together, 'Our life together');
  assert.deepEqual(answers.extraLanes.map((l) => l.id), ['friends']);
  assert.ok(answers.hiddenAutoChapters.includes('auto-beforeMet'));
  assert.equal(answers.anchors.met.lane, 'p1');

  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.equal(res.changed, false);
  const met = res.timeline.articles.find((a) => a.id === 'ss-met');
  assert.equal(met.imageUrl, 'https://x/photo.jpg');
  assert.equal(met.subtitle, 'A rainy bookshop evening.');
  assert.equal(met.lane, 'p1');
  assert.equal(met.to.day, 19);
  const trek = res.timeline.articles.find((a) => a.id === 'canvas-1');
  assert.equal(trek.from.hour, 9); // finer precision kept when the date didn't change
  assert.equal(trek.extract, 'Long story');
  assert.ok(res.timeline.lanes.some((l) => l.id === 'friends'));
  assert.ok(!res.timeline.timeBands.some((b) => b.id === 'auto-beforeMet'));
});

test('Studio edits update only managed fields and drop stale coordinates', () => {
  const tl = createdCouple();
  tl.articles = tl.articles.map((a) => (a.id === 'ss-met' ? { ...a, imageUrl: 'p.jpg' } : a));
  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  answers.anchors.met = { ...answers.anchors.met, date: 'November 2019', place: 'Boston' };
  answers.people.p2 = 'Ethan V.';
  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.equal(res.changed, true);
  const met = res.timeline.articles.find((a) => a.id === 'ss-met');
  assert.deepEqual(met.from, { year: 2019, month: 11, precision: 'month' });
  assert.equal(met.locationName, 'Boston');
  assert.equal(met.lat, undefined);
  assert.equal(met.imageUrl, 'p.jpg');
  assert.equal(met.title, 'Claire & Ethan V. meet');
  assert.deepEqual(articlesNeedingGeocode(res.timeline.articles).map((a) => a.id), ['ss-met']);
  assert.equal(res.timeline.lanes.find((l) => l.id === 'p2').title, "Ethan V.'s path");
});

test('removing rows or clearing a moment deletes those events', () => {
  const tl = createdCouple();
  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  answers.moments = [];
  answers.anchors.wedding = { ...answers.anchors.wedding, date: '' };
  answers.chapters = [];
  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.deepEqual(res.removedEventIds.sort(), ['ss-m-x', 'ss-wedding']);
  assert.ok(!res.timeline.timeBands.some((b) => b.id === 'ch-c1'));
});

test('events the Studio cannot read are left untouched', () => {
  const tl = createdCouple();
  tl.articles.push({ id: 'old', title: 'Ancestors in Rome', from: { year: -50, precision: 'year' } });
  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  const row = answers.moments.find((m) => m.articleId === 'old');
  assert.equal(row.date, '-50');
  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.ok(res.timeline.articles.some((a) => a.id === 'old'));
  assert.ok(!res.removedEventIds.includes('old'));
});

test('a personal timeline not made in the Studio opens as "Something else"', () => {
  const tl = {
    id: 'm1', title: 'Our House', isPersonal: true, timeScale: 'calendar',
    lanes: [{ id: 'main', title: 'Renovations', color: '#123', order: 1 }],
    timeBands: [{ id: 'b1', title: 'Building', from: { year: 2001, precision: 'year' }, to: { year: 2003, precision: 'year' } }],
    articles: [{ id: 'e1', title: 'Bought the house', lane: 'main', from: { year: 2001, month: 5, precision: 'month' }, imageUrl: 'h.jpg' }],
  };
  const { blueprint, answers } = timelineToStoryAnswers(tl, opts);
  assert.equal(blueprint.key, 'custom');
  assert.deepEqual(answers.customLanes, [{ id: 'main', title: 'Renovations' }]);
  assert.equal(answers.title, 'Our House');
  const res = applyStoryToTimeline(tl, blueprint, answers, opts);
  assert.equal(res.changed, false);
  assert.equal(res.timeline.articles[0].imageUrl, 'h.jpg');
  assert.equal(res.timeline.lanes[0].color, '#123');
});

test('Hebrew timelines round-trip without changes', () => {
  const bp = getStoryBlueprint('lifeStory');
  const answers = {
    ...emptyStoryAnswers(bp, { initialName: 'אברהם' }),
    anchors: { born: { date: '12 ביוני 1946', place: 'חיפה' }, married: { date: 'בערך 1970' }, school: { date: 'שנות ה-50', to: '1964' } },
    chapters: [{ id: 'c', title: 'שנות העשרים', from: 'שנות ה-1920', to: '1930' }],
  };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'he', now: NOW, id: 'h' });
  const back = timelineToStoryAnswers(timeline, { lang: 'he' });
  const res = applyStoryToTimeline(timeline, back.blueprint, back.answers, { lang: 'he', now: NOW });
  assert.equal(res.changed, false);
});

test('sameStoryDate ignores time of day but not month', () => {
  assert.ok(sameStoryDate({ year: 2000, month: 1, day: 2, hour: 5, precision: 'hour' }, { year: 2000, month: 1, day: 2, precision: 'day' }));
  assert.ok(!sameStoryDate({ year: 2000, month: 1, precision: 'month' }, { year: 2000, month: 2, precision: 'month' }));
});
