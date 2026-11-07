import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFuzzyDate, formatFuzzyDate } from '../src/utils/fuzzyDate.js';
import {
  STORY_BLUEPRINTS, getStoryBlueprint, buildStoryTimeline, computeAutoChapters, emptyStoryAnswers,
} from '../src/data/storyBlueprints.js';

const NOW = new Date(2026, 10, 5);
const p = (s, lang = 'en') => parseFuzzyDate(s, { lang, now: NOW });

test('parseFuzzyDate reads plain, partial and full dates', () => {
  assert.deepEqual(p('1952'), { year: 1952, precision: 'year', circa: false });
  assert.deepEqual(p('June 1952'), { year: 1952, month: 6, precision: 'month', circa: false });
  assert.deepEqual(p('June 12, 1952'), { year: 1952, month: 6, day: 12, precision: 'day', circa: false });
  assert.deepEqual(p('12 June 1952'), { year: 1952, month: 6, day: 12, precision: 'day', circa: false });
  assert.deepEqual(p('1952-06-12'), { year: 1952, month: 6, day: 12, precision: 'day', circa: false });
  assert.deepEqual(p('6/1952'), { year: 1952, month: 6, precision: 'month', circa: false });
});

test('parseFuzzyDate resolves numeric day/month order by language', () => {
  assert.equal(p('3/4/1990', 'en').month, 3);
  assert.equal(p('3/4/1990', 'he').month, 4);
  assert.equal(p('25/4/1990', 'en').day, 25); // >12 forces day-first
});

test('parseFuzzyDate understands approximate dates', () => {
  assert.equal(p('around 1950').circa, true);
  assert.equal(p('c. 1950').year, 1950);
  assert.equal(p('1950?').circa, true);
  assert.deepEqual(p('summer \'82'), { year: 1982, month: 7, precision: 'month', circa: true });
  assert.deepEqual(p('1960s'), { year: 1960, precision: 'decade', circa: false });
  assert.equal(p('late 1970').circa, true);
});

test('parseFuzzyDate handles Hebrew input', () => {
  assert.deepEqual(p('12 ביוני 1952', 'he'), { year: 1952, month: 6, day: 12, precision: 'day', circa: false });
  assert.deepEqual(p('מאי 1948', 'he'), { year: 1948, month: 5, precision: 'month', circa: false });
  assert.equal(p('בערך 1950', 'he').circa, true);
  assert.deepEqual(p('שנות ה-50', 'he'), { year: 1950, precision: 'decade', circa: false });
  assert.equal(p('קיץ 1982', 'he').month, 7);
});

test('parseFuzzyDate rejects nonsense and impossible dates', () => {
  for (const bad of ['', 'someday', '31/2/1990', '13/13/1990', 'June', '99999']) {
    assert.equal(p(bad), null, bad);
  }
});

test('formatFuzzyDate renders readable labels', () => {
  assert.equal(formatFuzzyDate(p('June 12, 1952')), 'June 12, 1952');
  assert.equal(formatFuzzyDate(p('around 1950')), 'c. 1950');
  assert.equal(formatFuzzyDate(p('1960s')), '1960s');
  assert.equal(formatFuzzyDate(p('12/6/1952', 'he'), 'he'), '12 ביוני 1952');
});

test('every blueprint builds a valid empty timeline', () => {
  for (const bp of STORY_BLUEPRINTS) {
    const { timeline, stats } = buildStoryTimeline(bp, emptyStoryAnswers(bp), { lang: 'en', now: NOW });
    assert.ok(timeline.lanes.length >= 1, bp.key);
    assert.equal(timeline.isPersonal, true);
    assert.equal(stats.events, 0);
    for (const lang of ['en', 'he']) {
      for (const field of ['name', 'tagline']) assert.ok(bp[field][lang], `${bp.key}.${field}.${lang}`);
      for (const a of bp.anchors) assert.ok(a.label[lang] && a.eventTitle[lang], `${bp.key}.${a.id}.${lang}`);
    }
  }
});

test('couple blueprint turns answers into lanes, events and chapters', () => {
  const bp = getStoryBlueprint('couple');
  const answers = {
    ...emptyStoryAnswers(bp),
    people: { p1: 'Claire', p2: 'Ethan' },
    anchors: {
      p1born: { date: 'April 1995', place: 'Burlington, Vermont' },
      p2born: { date: '1994' },
      met: { date: 'October 18, 2019', place: 'Cambridge' },
      wedding: { date: 'around 2025' },
    },
    moments: [{ id: 'x', title: 'Adopted Maple the dog', date: '2022', lane: 'together' }, { id: 'y', title: 'No date' }],
  };
  const { timeline, stats } = buildStoryTimeline(bp, answers, { lang: 'en', now: NOW });
  assert.equal(timeline.title, 'Claire & Ethan');
  assert.deepEqual(timeline.lanes.map((l) => l.title), ["Claire's path", "Ethan's path", 'Together']);
  assert.equal(stats.events, 5);
  const met = timeline.articles.find((a) => a.id === 'ss-met');
  assert.equal(met.title, 'Claire & Ethan meet');
  assert.equal(met.locationName, 'Cambridge');
  assert.deepEqual(met.from, { year: 2019, month: 10, day: 18, precision: 'day' });
  assert.equal(timeline.articles.find((a) => a.id === 'ss-wedding').circa, true);
  assert.deepEqual(timeline.timeBands.map((b) => b.title), ['Before we met', 'Together', 'Married']);
});

test('hidden auto chapters and user chapters are respected', () => {
  const bp = getStoryBlueprint('couple');
  const answers = {
    ...emptyStoryAnswers(bp),
    anchors: { p1born: { date: '1990' }, met: { date: '2015' } },
    hiddenAutoChapters: ['auto-beforeMet'],
    chapters: [{ id: 'c1', title: 'Student years', from: '2008', to: '2012' }, { id: 'c2', title: 'Backwards', from: '2012', to: '2008' }],
  };
  const titles = buildStoryTimeline(bp, answers, { now: NOW }).timeline.timeBands.map((b) => b.title);
  assert.deepEqual(titles, ['Together', 'Student years']);
});

test('child blueprint derives age chapters only up to today', () => {
  const bp = getStoryBlueprint('child');
  const answers = { ...emptyStoryAnswers(bp), anchors: { born: { date: 'March 2022' } } };
  const chapters = computeAutoChapters(bp, answers, { now: NOW });
  assert.deepEqual(chapters.map((c) => c.id), ['auto-baby', 'auto-toddler', 'auto-preschool']);
  assert.ok(chapters[2].toDec <= 2026 + 11 / 12);
});

test('Hebrew build uses Hebrew templates and fallbacks', () => {
  const bp = getStoryBlueprint('lifeStory');
  const answers = { ...emptyStoryAnswers(bp, { initialName: 'אברהם' }), anchors: { born: { date: 'בערך 1946', place: 'חיפה' } } };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'he', now: NOW });
  assert.equal(timeline.title, 'סיפור החיים של אברהם');
  assert.equal(timeline.articles[0].title, 'אברהם נולד/ה');
});

test('custom blueprint uses user-defined lanes', () => {
  const bp = getStoryBlueprint('custom');
  const answers = { ...emptyStoryAnswers(bp), title: 'Our House', customLanes: [{ id: 'a', title: 'Renovations' }, { id: 'b', title: '  ' }] };
  const { timeline } = buildStoryTimeline(bp, answers, { now: NOW });
  assert.deepEqual(timeline.lanes.map((l) => l.title), ['Renovations']);
  assert.equal(timeline.title, 'Our House');
});
