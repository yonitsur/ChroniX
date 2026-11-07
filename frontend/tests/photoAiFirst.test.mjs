// The AI-first photo import: screenshots set aside, full drafts merged into events, the story
// pass (merges, titles, highlights, chapters), overview facts, cost, and the whole pipeline with
// fake API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoMeta, isLikelyScreenshot } from '../src/utils/photoImport/photoMeta.js';
import { clusterPhotos } from '../src/utils/photoImport/clusterPhotos.js';
import { createImportEvents, eventsToMoments, mergeEventsById, regroupEvents, splitEventAt, eventRank, unmergeEvents } from '../src/utils/photoImport/importModel.js';
import { applyDrafts, draftCreditCost } from '../src/utils/photoImport/aiDrafts.js';
import {
  screenshotIds, sequenceTexts, eventTimeText, lookPhotoIds, lookPayloadEvent, storyPayloadEvents,
  applyStoryPass, storyChaptersToRows, overviewFacts, estimateAutoBuildCredits, runAutoBuild,
  OVERVIEW_MAX_MOMENTS, OVERVIEW_MAX_CHARS, photoImportBlueprint, photoStoryAnswers,
} from '../src/utils/photoImport/autoBuild.js';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers } from '../src/data/storyBlueprints.js';
import { applyStoryToTimeline, timelineToStoryAnswers } from '../src/data/storyStudioSync.js';

const NOW = Date.UTC(2026, 10, 5);
const LISBON = { lat: 38.72, lng: -9.14 };
const PORTO = { lat: 41.15, lng: -8.61 };

let seq = 0;
function photo(iso, place = null, extra = {}, name = null) {
  seq += 1;
  const [d, t = '12:00'] = iso.split('T');
  const tags = { DateTimeOriginal: `${d.replace(/-/g, ':')} ${t}:00`, Make: 'Google', Model: 'Pixel 8' };
  if (place) Object.assign(tags, { latitude: place.lat + (seq % 7) * 0.001, longitude: place.lng });
  return buildPhotoMeta({ id: `p${seq}`, name: name || `IMG_${seq}.jpg`, tags: { ...tags, ...extra } }, { now: NOW });
}
const byId = (list) => new Map(list.map((p) => [p.id, p]));

/** A 5-day Portugal trip: Lisbon x2 days, Porto x2 days, 3 photos each, plus a last morning. */
function tripFixture() {
  const photos = [
    photo('2023-05-12T10:00', LISBON), photo('2023-05-12T11:00', LISBON), photo('2023-05-12T12:30', LISBON),
    photo('2023-05-13T10:00', LISBON), photo('2023-05-13T11:00', LISBON), photo('2023-05-13T12:00', LISBON),
    photo('2023-05-14T18:00', PORTO), photo('2023-05-14T19:00', PORTO), photo('2023-05-14T20:00', PORTO),
    photo('2023-05-15T10:00', PORTO), photo('2023-05-15T11:00', PORTO), photo('2023-05-15T12:00', PORTO),
    photo('2023-05-16T09:00', PORTO), photo('2023-05-16T09:30', PORTO),
  ];
  const metas = byId(photos);
  const { clusters } = clusterPhotos(photos, { preset: 'more' });
  const events = createImportEvents(clusters, metas).map((e) => ({ ...e, attachTo: '' }));
  return { photos, metas, events };
}

// ---- Curation ----------------------------------------------------------------------------------

test('screenshots are recognised by name, or as a PNG without camera or location', () => {
  const shot = buildPhotoMeta({ id: 's1', name: 'Screenshot_20230512-101500.png' }, { now: NOW });
  const heb = buildPhotoMeta({ id: 's2', name: 'צילום מסך 2023-05-12.jpg' }, { now: NOW });
  const png = buildPhotoMeta({ id: 's3', name: 'image.png', type: 'image/png' }, { now: NOW });
  const cameraPng = buildPhotoMeta({ id: 's4', name: 'pano.png', tags: { Make: 'Apple' } }, { now: NOW });
  const whatsapp = buildPhotoMeta({ id: 's5', name: 'IMG-20230514-WA0001.jpg' }, { now: NOW });
  assert.equal(isLikelyScreenshot(shot), true);
  assert.equal(isLikelyScreenshot(heb), true);
  assert.equal(isLikelyScreenshot(png), true);
  assert.equal(isLikelyScreenshot(cameraPng), false);
  assert.equal(isLikelyScreenshot(whatsapp), false);
  assert.deepEqual(screenshotIds([shot, png, whatsapp]), ['s1', 's3']);
  assert.equal(cameraPng.camera, 'Apple');
});

// ---- Look ----------------------------------------------------------------------------------------

test('sequence texts give each day its place in the trip (no home: the import is one journey)', () => {
  const { events } = tripFixture();
  const seqs = sequenceTexts(events, [], { home: null });
  assert.equal(seqs[events[0].id], 'first day of a 5-day trip');
  assert.equal(seqs[events[events.length - 1].id], 'last day of a 5-day trip');
  assert.match(seqs[events[2].id], /^day 3 of a 5-day trip$/);
  // A detected home with no trips: nothing.
  assert.deepEqual(sequenceTexts(events, [], { home: { lat: 32, lng: 34 } }), {});
});

test('the look payload: time of day, sequence, place, user note - never coordinates', () => {
  const { events, metas } = tripFixture();
  const ev = { ...events[0], note: 'Our first day!', noteSource: 'user', place: { city: 'Lisbon', country: 'Portugal' } };
  const p = lookPayloadEvent(ev, { metasById: metas, homeCountry: null, lang: 'en', sequence: 'first day of a 5-day trip' });
  assert.equal(p.time_text, '10:00–12:30');
  assert.equal(p.place, 'Lisbon, Portugal');
  assert.equal(p.hint, 'Our first day!');
  assert.equal(p.sequence, 'first day of a 5-day trip');
  assert.equal(p.needs_place, false);
  assert.ok(!('lat' in p) && !('centroid' in p));
  // The cover goes first, then spread representatives.
  const ids = lookPhotoIds({ ...ev, coverId: ev.photoIds[2] }, metas, 2);
  assert.equal(ids[0], ev.photoIds[2]);
  assert.equal(ids.length, 2);
  assert.equal(eventTimeText({ ...ev, everydayMonth: true }, metas), '');
});

test('full drafts fill caption, story, cover, kind, category, rank - never over the user', () => {
  const { events } = tripFixture();
  const [a, b, c] = events;
  const userEdited = { ...b, title: 'My title', titleSource: 'user', story: 'I wrote this', storySource: 'user', coverId: b.photoIds[0], coverSource: 'user' };
  const included = { ...c, includeSource: 'user' };
  const next = applyDrafts([a, userEdited, included], [
    { id: a.id, title: 'Tiles of Alfama', description: 'Blue tiles.', caption: 'Blue tiles.', story: 'We climbed.', cover_index: 1, kind: 'moment', category: 'Travel', importance: 7, occasion: '' },
    { id: b.id, title: 'AI title', caption: 'AI caption', story: 'AI story', cover_index: 2, kind: 'moment', importance: 3 },
    { id: c.id, title: 'Receipt', caption: 'A receipt.', story: '', cover_index: 0, kind: 'document', importance: 1 },
  ], { sentImages: { [a.id]: [a.photoIds[2], a.photoIds[0]], [b.id]: b.photoIds } });
  assert.equal(next[0].title, 'Tiles of Alfama');
  assert.equal(next[0].note, 'Blue tiles.');
  assert.equal(next[0].story, 'We climbed.');
  assert.equal(next[0].storySource, 'ai');
  assert.equal(next[0].coverId, a.photoIds[0]); // index 1 of what was sent
  assert.equal(next[0].category, 'Travel');
  assert.equal(next[0].importance, 7);
  assert.equal(next[0].aiDrafted, true);
  assert.equal(next[1].title, 'My title');
  assert.equal(next[1].story, 'I wrote this');
  assert.equal(next[1].coverId, b.photoIds[0]);
  assert.equal(next[1].note, 'AI caption');
  // A document the user explicitly included stays included; otherwise it is set aside.
  assert.equal(next[2].include, true);
  const auto = applyDrafts([c], [{ id: c.id, title: 'Receipt', kind: 'screenshot' }]);
  assert.equal(auto[0].include, false);
  assert.equal(auto[0].setAside, 'screenshot');
});

test('full drafts are priced per full_events_per_credit', () => {
  const limits = { events_per_credit: 12, full_events_per_credit: 8, draft_events_per_call: 12, draft_images_per_event: 3, draft_image_max_px: 384 };
  assert.equal(draftCreditCost(12, limits), 1);
  // Full batches are cut to whole credits: 12 per call at 8 per credit -> batches of 8.
  assert.equal(draftCreditCost(12, limits, 'full'), 2); // 8 + 4
  assert.equal(draftCreditCost(24, limits, 'full'), 3); // 8 + 8 + 8
  assert.equal(draftCreditCost(25, limits, 'full'), 4);
  assert.equal(draftCreditCost(24, { ...limits, unlimited: true }, 'full'), 0);
});

test('AI fields survive regrouping, a split resets the new half', () => {
  const { photos, metas, events } = tripFixture();
  const drafted = events.map((e) => ({ ...e, story: `Story ${e.id}`, storySource: 'ai', aiDrafted: true, importance: 6, category: 'Travel' }));
  const { clusters } = clusterPhotos(photos, { preset: 'more' });
  const again = regroupEvents(drafted, clusters, metas);
  assert.equal(again[0].story, `Story ${events[0].id}`);
  assert.equal(again[0].aiDrafted, true);
  assert.equal(again[0].importance, 6);
  const split = splitEventAt(drafted, drafted[0].id, drafted[0].photoIds[1], metas);
  assert.equal(split[1].story, '');
  assert.equal(split[1].aiDrafted, false);
});

test('moments carry the story, category, rank and the AI mark into the built timeline', () => {
  const { events } = tripFixture();
  const ev = { ...events[0], include: true, title: 'Tiles of Alfama', titleSource: 'ai', note: 'Blue tiles.', story: 'We climbed the hills.', category: 'Travel', importance: 6, highlight: true, aiDrafted: true };
  let n = 0;
  const { rows } = eventsToMoments([ev], { lang: 'en', lane: 'journey', newRowId: () => `r${(n += 1)}` });
  assert.equal(rows[0].story, 'We climbed the hills.');
  assert.equal(rows[0].rank, 8); // a highlight is at least 8
  assert.equal(rows[0].ai, true);
  assert.equal(eventRank({ importance: 9 }), 9);
  assert.equal(eventRank({}), null);
  const bp = getStoryBlueprint('trip');
  const answers = { ...emptyStoryAnswers(bp), people: { p1: 'Portugal' }, moments: rows, aiAssisted: true };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'en' });
  const art = timeline.articles.find((a) => a.title === 'Tiles of Alfama');
  assert.equal(art.extract, 'We climbed the hills.');
  assert.equal(art.category, 'Travel');
  assert.equal(art.rank, 8);
  assert.equal(art.aiWritten, true);
  assert.equal(timeline.isManual, false);
  assert.equal(timeline.storyStudio.aiAssisted, true);
  // Hand-built stories stay "manual".
  assert.equal(buildStoryTimeline(bp, { ...answers, aiAssisted: false }, { lang: 'en' }).timeline.isManual, true);
  // Re-opened and saved, the timeline stays AI-assisted.
  const back = timelineToStoryAnswers({ ...timeline, isManual: true }, { lang: 'en' });
  assert.equal(back.answers.aiAssisted, true);
  const saved = applyStoryToTimeline({ ...timeline, isManual: true }, bp, back.answers, { lang: 'en' });
  assert.equal(saved.timeline.isManual, false);
});

// ---- Story pass --------------------------------------------------------------------------------------

test('the story payload: included new events in time order, user titles flagged', () => {
  const { events, metas } = tripFixture();
  const evs = events.map((e, i) => ({ ...e, title: i === 1 ? 'Mine' : `T${i}`, titleSource: i === 1 ? 'user' : 'ai', note: 'c', story: 'x'.repeat(2000) }));
  evs[2] = { ...evs[2], include: false };
  evs[3] = { ...evs[3], attachTo: 'existing' };
  const out = storyPayloadEvents(evs, { metasById: metas, trips: [{ id: 'trip-1', clusterIds: [evs[0].id] }] });
  assert.equal(out.length, events.length - 2);
  assert.equal(out[1].user_titled, true);
  assert.equal(out[0].trip, 'trip-1');
  assert.ok(out[0].story.length <= 600);
});

test('the story pass merges neighbours, tidies titles (not the user\'s) and marks highlights', () => {
  const { events, metas } = tripFixture();
  const evs = events.map((e, i) => ({ ...e, title: `T${i}`, titleSource: i === 2 ? 'user' : 'ai', note: `caption ${i}`, noteSource: 'ai', story: `story ${i}`, storySource: 'ai', importance: 5 }));
  const result = {
    merges: [{ event_ids: [evs[0].id, evs[1].id], title: 'Two days in Lisbon', caption: 'Lisbon, start to finish.' }],
    titles: [{ id: evs[2].id, title: 'Not allowed' }, { id: evs[3].id, title: 'Port wine cellars' }, { id: evs[1].id, title: 'Merged away' }],
    highlights: [evs[1].id, evs[3].id],
  };
  const { events: out, mergedInto, merged } = applyStoryPass(evs, result, metas);
  assert.equal(merged, 1);
  assert.equal(out.length, evs.length - 1);
  assert.equal(mergedInto[evs[1].id], evs[0].id);
  const lisbon = out.find((e) => e.id === evs[0].id);
  assert.equal(lisbon.photoIds.length, evs[0].photoIds.length + evs[1].photoIds.length);
  assert.equal(lisbon.note, 'Lisbon, start to finish.');
  assert.equal(lisbon.story, 'story 0\n\nstory 1');
  // The title of an event merged away follows it to its keeper; a highlight too.
  assert.equal(lisbon.title, 'Merged away');
  assert.equal(lisbon.highlight, true);
  assert.equal(out.find((e) => e.id === evs[2].id).title, 'T2');
  assert.equal(out.find((e) => e.id === evs[3].id).title, 'Port wine cellars');
  // Idempotent: applying it again changes nothing more.
  assert.equal(applyStoryPass(out, result, metas).events.length, out.length);
});

test('merging keeps what the user typed', () => {
  const { events, metas } = tripFixture();
  const a = { ...events[0], title: 'User title', titleSource: 'user', note: 'My note', noteSource: 'user' };
  const out = mergeEventsById([a, events[1], events[2]], [a.id, events[1].id], metas, { title: 'AI', caption: 'AI caption' });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'User title');
  assert.equal(out[0].note, 'My note');
  assert.equal(mergeEventsById(events, [events[0].id], metas), events);
});

test('story chapters become Studio chapter rows against the current events', () => {
  const { events } = tripFixture();
  const chapters = [
    { title: 'Lisbon', first_event_id: events[0].id, last_event_id: events[1].id },
    { title: 'Porto', first_event_id: events[2].id, last_event_id: events[events.length - 1].id },
    { title: 'Gone', first_event_id: 'nope', last_event_id: 'nope' },
  ];
  const rows = storyChaptersToRows(chapters, events, 'en');
  assert.deepEqual(rows.map((r) => r.title), ['Lisbon', 'Porto']);
  assert.equal(rows[0].from, 'May 12, 2023');
  assert.equal(rows[0].to, 'May 13, 2023');
  assert.equal(rows[1].to, 'May 16, 2023');
  // A chapter edge merged away follows its keeper.
  const merged = events.filter((e) => e.id !== events[1].id);
  const followed = storyChaptersToRows(chapters.slice(0, 1), merged, 'en', { [events[1].id]: events[0].id });
  assert.equal(followed.length, 1);
});

// ---- Overview & cost ---------------------------------------------------------------------------------

test('overview facts fit the endpoint: at most 200 moments, the most important kept, stories shortened', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({
    id: `e${i}`, include: true, attachTo: '', startMs: i, startWall: { year: 2023, month: 1 + (i % 12), day: 1 + (i % 28) },
    endWall: { year: 2023, month: 1 + (i % 12), day: 1 + (i % 28) }, photoIds: ['x'], title: `Moment ${i}`, note: 'A caption here.',
    story: 'word '.repeat(200), importance: i === 250 ? 10 : 4,
  }));
  const facts = overviewFacts({ title: 'Our year', events: many, lang: 'en' });
  assert.equal(facts.moments.length, OVERVIEW_MAX_MOMENTS);
  assert.ok(facts.moments.some((m) => m.title === 'Moment 250'));
  assert.ok(JSON.stringify(facts).length <= OVERVIEW_MAX_CHARS);
  const few = overviewFacts({ title: 'T', events: many.slice(0, 3), lang: 'en' });
  assert.equal(few.moments[0].story.length > 900, true);
});

test('the build estimate adds look, story and overview credits', () => {
  const limits = { events_per_credit: 12, full_events_per_credit: 8, story_events_per_credit: 120, draft_events_per_call: 12, draft_images_per_event: 3, draft_image_max_px: 384 };
  // 25 events = batches of 8 + 8 + 8 + 1 -> 4 look credits.
  assert.deepEqual(estimateAutoBuildCredits(25, limits), { look: 4, story: 1, overview: 2, total: 7 });
  assert.deepEqual(estimateAutoBuildCredits(4, limits), { look: 1, story: 1, overview: 1, total: 3 });
  assert.deepEqual(estimateAutoBuildCredits(25, limits, { overview: false }).total, 5);
  assert.equal(estimateAutoBuildCredits(500, { ...limits, unlimited: true }).total, 0);
});

// ---- The pipeline -------------------------------------------------------------------------------------

function store(initial) {
  let events = initial;
  return { getEvents: () => events, setEvents: (fn) => { events = fn(events); } };
}

const LIMITS = { draft_events_per_call: 2, draft_images_per_event: 2, draft_image_max_px: 384, draft_parallel_calls: 2, events_per_credit: 12, full_events_per_credit: 8, story_events_per_credit: 120, story_max_events: 250 };

test('runAutoBuild: look in batches, then story, then overview - progress and credits reported', async () => {
  const { events, metas } = tripFixture();
  const s = store(events);
  const calls = { look: [], story: [], overview: [] };
  const api = {
    draftPhotoEvents: async (req) => {
      calls.look.push(req);
      return { credits: 1, drafts: req.events.map((e) => ({ id: e.id, title: `Title ${e.id}`, caption: 'Cap', description: 'Cap', story: 'Story', cover_index: 0, kind: 'moment', importance: 5 })) };
    },
    draftPhotoStory: async (req) => {
      calls.story.push(req);
      return { credits: 1, timeline_title: 'Five days in Portugal', story_type: 'trip', subject_names: ['Portugal'], chapters: [], merges: [{ event_ids: [req.events[0].id, req.events[1].id], title: 'Lisbon days' }], titles: [], highlights: [] };
    },
    draftStoryOverview: async (req) => {
      calls.overview.push(req);
      return { overview: '# Portugal\n\nFive days.', credits: 2 };
    },
  };
  const stages = [];
  const res = await runAutoBuild({
    ...s, metasById: metas, limits: LIMITS, lang: 'en', context: 'Our honeymoon', people: ['Dana'],
    api, encodeImages: async (pid) => `data:image/jpeg;base64,${pid}`, onProgress: (p) => stages.push(p.stage),
  });
  assert.equal(calls.look.length, Math.ceil(events.length / 2));
  assert.equal(calls.look[0].detail, 'full');
  assert.equal(calls.look[0].storyContext, 'Our honeymoon');
  assert.equal(calls.look[0].events[0].images.length, 2);
  assert.equal(calls.look[0].events[0].sequence, 'first day of a 5-day trip');
  assert.equal(calls.story.length, 1);
  assert.equal(calls.story[0].events[0].title, `Title ${events[0].id}`);
  assert.equal(calls.overview.length, 1);
  assert.equal(calls.overview[0].story.title, 'Five days in Portugal');
  assert.equal(res.overview, '# Portugal\n\nFive days.');
  assert.equal(res.credits, calls.look.length + 1 + 2);
  assert.equal(res.merged, 1);
  assert.deepEqual(res.failedIds, []);
  assert.equal(s.getEvents().length, events.length - 1);
  assert.equal(s.getEvents()[0].title, 'Lisbon days');
  assert.deepEqual([...new Set(stages)], ['moments', 'story', 'overview']);
  // Undo brings back exactly the two drafted moments; the rest (and later edits) stay.
  assert.equal(res.mergedOriginals.length, 2);
  assert.ok(res.mergedOriginals.every((e) => e.title.startsWith('Title ')));
  const edited = s.getEvents().map((e, i) => (i === 1 ? { ...e, title: 'Edited later' } : e));
  const undone = unmergeEvents(edited, res.mergedOriginals, Object.values(res.mergedInto));
  assert.equal(undone.length, events.length);
  assert.equal(undone[0].title, `Title ${events[0].id}`);
  assert.equal(undone[1].title, `Title ${events[1].id}`);
  assert.equal(undone[2].title, 'Edited later');
});

test('runAutoBuild: a failed batch is reported and the rest goes on; a fatal error stops the story', async () => {
  const { events, metas } = tripFixture();
  const s = store(events);
  let n = 0;
  const api = {
    draftPhotoEvents: async (req) => {
      n += 1;
      if (n === 1) throw Object.assign(new Error('boom'), { status: 500 });
      return { credits: 1, drafts: req.events.map((e) => ({ id: e.id, title: 'T', caption: 'C', story: 'S' })) };
    },
    draftPhotoStory: async () => ({ timeline_title: 'T', chapters: [], merges: [], titles: [], highlights: [] }),
    draftStoryOverview: async () => ({ overview: 'O' }),
  };
  const res = await runAutoBuild({ ...s, metasById: metas, limits: { ...LIMITS, draft_parallel_calls: 1 }, api, encodeImages: async () => null });
  assert.equal(res.failedIds.length, 2);
  assert.equal(res.overview, 'O');

  const s2 = store(events);
  const fatal = {
    ...api,
    draftPhotoEvents: async () => { throw Object.assign(new Error('sign in'), { status: 401 }); },
    draftPhotoStory: async () => { throw new Error('must not run'); },
  };
  const res2 = await runAutoBuild({ ...s2, metasById: metas, limits: { ...LIMITS, draft_parallel_calls: 1 }, api: fatal, encodeImages: async () => null });
  assert.equal(res2.stoppedBy.status, 401);
  assert.equal(res2.story, null);
  assert.equal(res2.overview, '');
});

test('runAutoBuild: rate limited once -> waits and retries; add mode skips the overview', async () => {
  const { events, metas } = tripFixture();
  const s = store(events.slice(0, 2));
  let tries = 0;
  const seen = { overview: 0, story: [] };
  const api = {
    draftPhotoEvents: async (req) => {
      tries += 1;
      if (tries === 1) throw Object.assign(new Error('slow down'), { status: 429 });
      return { drafts: req.events.map((e) => ({ id: e.id, title: 'T' })) };
    },
    draftPhotoStory: async (req) => { seen.story.push(req); return { timeline_title: 'Existing', chapters: [], merges: [], titles: [], highlights: [] }; },
    draftStoryOverview: async () => { seen.overview += 1; return { overview: 'x' }; },
  };
  const res = await runAutoBuild({ ...s, metasById: metas, limits: LIMITS, api, encodeImages: async () => null, mode: 'add', existingTitle: 'Existing', retryDelayMs: 1 });
  assert.equal(tries, 2);
  assert.deepEqual(res.failedIds, []);
  assert.equal(seen.overview, 0);
  assert.equal(seen.story[0].mode, 'add');
  assert.equal(seen.story[0].existingTitle, 'Existing');
});

test('runAutoBuild: stopping keeps what was drafted', async () => {
  const { events, metas } = tripFixture();
  const s = store(events);
  const controller = new AbortController();
  const api = {
    draftPhotoEvents: async (req) => {
      controller.abort();
      return { drafts: req.events.map((e) => ({ id: e.id, title: 'Kept' })) };
    },
    draftPhotoStory: async () => { throw new Error('must not run'); },
    draftStoryOverview: async () => { throw new Error('must not run'); },
  };
  const res = await runAutoBuild({ ...s, metasById: metas, limits: { ...LIMITS, draft_parallel_calls: 1 }, api, encodeImages: async () => null, signal: controller.signal });
  assert.equal(res.stoppedBy, 'abort');
  assert.equal(s.getEvents().filter((e) => e.title === 'Kept').length, 2);
});

// ---- Into the Studio -----------------------------------------------------------------------------

test('the story type comes from the AI only when it has the names it needs', () => {
  assert.deepEqual(photoImportBlueprint({ storyType: 'trip', subjectNames: ['Portugal'] }, null), { key: 'trip', people: { p1: 'Portugal' } });
  assert.deepEqual(photoImportBlueprint({ storyType: 'couple', subjectNames: ['Dana', 'Yoni'] }, null), { key: 'couple', people: { p1: 'Dana', p2: 'Yoni' }, lane: 'together' });
  assert.equal(photoImportBlueprint({ storyType: 'couple', subjectNames: ['Dana'] }, null).key, 'custom');
  assert.equal(photoImportBlueprint({ storyType: 'child', subjectNames: [] }, { blueprint: 'trip', destination: 'Japan' }).key, 'trip');
  assert.equal(photoImportBlueprint(null, { blueprint: 'trip', destination: '' }).key, 'custom');
});

test('photo answers: moments, chapters, AI title, overview and lane - never over what the user typed', () => {
  let n = 0;
  const newId = () => `id${(n += 1)}`;
  const labels = { customLane: 'Moments', customTitle: 'Our photos' };
  const custom = getStoryBlueprint('custom');
  const rows = [{ id: 'r1', title: 'Tiles', date: 'May 12, 2023', note: 'c', story: 's', lane: '' }];
  const a = photoStoryAnswers({
    blueprint: custom, base: emptyStoryAnswers(custom), rows,
    chapters: [{ title: 'Lisbon', from: 'May 12, 2023', to: 'May 13, 2023' }],
    story: { aiAssisted: true, title: 'Five days in Portugal', overview: '# Portugal', laneTitle: 'The journey' },
    choice: { key: 'custom', people: {} }, newId, labels,
  });
  assert.equal(a.title, 'Five days in Portugal');
  assert.equal(a.overview, '# Portugal');
  assert.equal(a.customLanes[0].title, 'The journey');
  assert.equal(a.chapters[0].title, 'Lisbon');
  assert.equal(a.moments.length, 1);
  assert.equal(a.aiAssisted, true);
  // The user's own title, overview and names win.
  const couple = getStoryBlueprint('couple');
  const base = { ...emptyStoryAnswers(couple), title: 'Us', overview: 'Mine', people: { p1: 'Claire', p2: '' } };
  const b = photoStoryAnswers({
    blueprint: couple, base, rows, chapters: [], story: { aiAssisted: true, title: 'AI', overview: 'AI' },
    choice: { key: 'couple', people: { p1: 'Dana', p2: 'Yoni' }, lane: 'together' }, newId, labels,
  });
  assert.equal(b.title, 'Us');
  assert.equal(b.overview, 'Mine');
  assert.deepEqual(b.people, { p1: 'Claire', p2: 'Yoni' });
  assert.equal(b.moments[0].lane, 'together');
  const { timeline } = buildStoryTimeline(couple, b, { lang: 'en' });
  assert.equal(timeline.isManual, false);
  // Without AI: the classic defaults.
  const c = photoStoryAnswers({ blueprint: custom, base: emptyStoryAnswers(custom), rows, chapters: [], story: null, choice: {}, newId, labels });
  assert.equal(c.title, 'Our photos');
  assert.equal(c.customLanes[0].title, 'Moments');
  assert.equal(c.aiAssisted, undefined);
});
