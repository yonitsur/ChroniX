// Photo import grouping levels (one event per day / hour / photo), the per-level counts the
// "how finely to split" scale shows, the chunked story pass, and the user's AI instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoMeta } from '../src/utils/photoImport/photoMeta.js';
import {
  clusterPhotos, countGroupingLevels, isFixedGrouping, GROUPING_PRESET_KEYS,
} from '../src/utils/photoImport/clusterPhotos.js';
import { createImportEvents } from '../src/utils/photoImport/importModel.js';
import {
  runAutoBuild, storyCreditCost, storyChunks, combineStoryResults, estimateAutoBuildCredits,
} from '../src/utils/photoImport/autoBuild.js';

const NOW = Date.UTC(2026, 10, 5);
const LISBON = { lat: 38.72, lng: -9.14 };
const HOME = { lat: 32.08, lng: 34.78 };

let seq = 0;
function photo(iso, place = null) {
  seq += 1;
  const [d, t = '12:00'] = iso.split('T');
  const tags = { DateTimeOriginal: `${d.replace(/-/g, ':')} ${t}:00`, Make: 'Google', Model: 'Pixel 8' };
  if (place) Object.assign(tags, { latitude: place.lat, longitude: place.lng });
  return buildPhotoMeta({ id: `g${seq}`, name: `IMG_${seq}.jpg`, tags }, { now: NOW });
}
const byId = (list) => new Map(list.map((p) => [p.id, p]));

/** Two days in Lisbon: day 1 has photos at 10:00, 10:20, 10:40, 11:10; day 2 at 09:00, 09:05. */
function twoDays() {
  return [
    photo('2023-05-12T10:00', LISBON), photo('2023-05-12T10:20', LISBON), photo('2023-05-12T10:40', LISBON),
    photo('2023-05-12T11:10', LISBON), photo('2023-05-13T09:00', LISBON), photo('2023-05-13T09:05', LISBON),
  ];
}

test('the grouping scale runs coarsest to finest and knows its fixed levels', () => {
  assert.deepEqual(GROUPING_PRESET_KEYS, ['fewer', 'balanced', 'more', 'day', 'hour', 'photo']);
  assert.equal(isFixedGrouping('day'), true);
  assert.equal(isFixedGrouping('photo'), true);
  assert.equal(isFixedGrouping('balanced'), false);
  assert.equal(isFixedGrouping('toString'), false);
});

test('fixed levels split by calendar day, clock hour, or photo', () => {
  const photos = twoDays();
  assert.equal(clusterPhotos(photos, { preset: 'day' }).clusters.length, 2);
  // Day 1: 10:xx and 11:10 -> two hours; day 2: one hour.
  assert.equal(clusterPhotos(photos, { preset: 'hour' }).clusters.length, 3);
  assert.equal(clusterPhotos(photos, { preset: 'photo' }).clusters.length, photos.length);
  // Coarser presets merge the whole stay ('fewer' keeps the two days together).
  assert.equal(clusterPhotos(photos, { preset: 'fewer' }).clusters.length, 1);
});

test('fixed levels never fold small home events into "everyday" months', () => {
  // 60+ days at home with a few photos a day: coarse presets mark small home events "everyday".
  const photos = [];
  for (let i = 0; i < 70; i += 3) {
    const d = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
    photos.push(photo(`${d}T09:00`, HOME));
  }
  const coarse = clusterPhotos(photos, { preset: 'balanced' }).clusters;
  assert.ok(coarse.some((c) => c.everyday));
  const daily = clusterPhotos(photos, { preset: 'day' }).clusters;
  assert.equal(daily.length, photos.length);
  assert.ok(daily.every((c) => !c.everyday));
  // And the events created from them are all included, one per day.
  const events = createImportEvents(daily, byId(photos));
  assert.equal(events.filter((e) => e.include).length, photos.length);
});

test('countGroupingLevels gives the event count of every level (everyday months count once)', () => {
  const photos = twoDays();
  const counts = countGroupingLevels(photos);
  assert.equal(counts.day, 2);
  assert.equal(counts.hour, 3);
  assert.equal(counts.photo, 6);
  assert.equal(counts.fewer, 1);
  for (const key of GROUPING_PRESET_KEYS) assert.equal(typeof counts[key], 'number');
  // Matches what the events would actually be.
  for (const key of GROUPING_PRESET_KEYS) {
    const events = createImportEvents(clusterPhotos(photos, { preset: key }).clusters, byId(photos));
    assert.equal(counts[key], events.length, key);
  }
  assert.deepEqual(countGroupingLevels([]), Object.fromEntries(GROUPING_PRESET_KEYS.map((k) => [k, 0])));
});

const LIMITS = { draft_events_per_call: 4, draft_images_per_event: 1, draft_image_max_px: 384, draft_parallel_calls: 1, full_events_per_credit: 8, story_events_per_credit: 120, story_max_events: 3 };

test('story credits are priced per chunk of story_max_events', () => {
  assert.deepEqual(storyChunks([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.equal(storyCreditCost(7, LIMITS), 3);
  assert.equal(storyCreditCost(7, { ...LIMITS, story_max_events: 250 }), 1);
  assert.equal(storyCreditCost(300, { story_events_per_credit: 120, story_max_events: 250 }), 3 + 1);
  assert.equal(storyCreditCost(700, { unlimited: true }), 0);
  // The build estimate prices a finer level higher - what the credit gate compares.
  const coarse = estimateAutoBuildCredits(6, { ...LIMITS, story_max_events: 250 });
  const fine = estimateAutoBuildCredits(700, { ...LIMITS, story_max_events: 250 });
  assert.ok(fine.total > coarse.total * 10);
});

test('combineStoryResults keeps the first title and concatenates the rest', () => {
  const a = { timeline_title: 'Lisbon', story_type: 'trip', subject_names: ['Portugal'], chapters: [{ title: 'A' }], merges: [], titles: [{ id: '1', title: 'x' }], highlights: ['1'], credits: 1 };
  const b = { timeline_title: 'Other', story_type: 'custom', subject_names: [], chapters: [{ title: 'B' }], merges: [{ event_ids: ['5', '6'] }], titles: [], highlights: ['6'], credits: 1 };
  const c = combineStoryResults(a, b);
  assert.equal(c.timeline_title, 'Lisbon');
  assert.equal(c.story_type, 'trip');
  assert.deepEqual(c.subject_names, ['Portugal']);
  assert.deepEqual(c.chapters.map((x) => x.title), ['A', 'B']);
  assert.equal(c.merges.length, 1);
  assert.deepEqual(c.highlights, ['1', '6']);
  assert.equal(c.credits, 2);
  assert.equal(combineStoryResults(null, b), b);
});

function store(initial) {
  let events = initial;
  return { getEvents: () => events, setEvents: (fn) => { events = fn(events); } };
}

function perPhotoImport() {
  const photos = twoDays();
  const metas = byId(photos);
  const events = createImportEvents(clusterPhotos(photos, { preset: 'photo' }).clusters, metas).map((e) => ({ ...e, attachTo: '' }));
  return { metas, events };
}

test('runAutoBuild: the story pass covers every event in chunks; instructions reach every call', async () => {
  const { metas, events } = perPhotoImport();
  const s = store(events);
  const calls = { look: [], story: [] };
  const api = {
    draftPhotoEvents: async (req) => {
      calls.look.push(req);
      return { credits: 1, drafts: req.events.map((e) => ({ id: e.id, title: `T ${e.id}`, caption: 'c', story: 's', kind: 'moment' })) };
    },
    draftPhotoStory: async (req) => {
      calls.story.push(req);
      const ids = req.events.map((e) => e.id);
      return {
        credits: 1,
        timeline_title: calls.story.length === 1 ? 'First chunk' : 'Later chunk',
        chapters: [{ title: `Ch ${calls.story.length}`, first_event_id: ids[0], last_event_id: ids[ids.length - 1] }],
        merges: [{ event_ids: ids.slice(0, 2), title: 'Merged' }],
        titles: [], highlights: [ids[0]],
      };
    },
    draftStoryOverview: async () => ({ overview: 'O', credits: 1 }),
  };
  const res = await runAutoBuild({
    ...s, metasById: metas, limits: LIMITS, api, encodeImages: async () => null,
    instructions: 'Write in the first person.', allowMerges: false,
  });
  assert.equal(calls.story.length, 2); // 6 events, 3 per story request
  assert.deepEqual(calls.story.flatMap((r) => r.events.map((e) => e.id)), events.map((e) => e.id));
  assert.ok(calls.look.every((r) => r.instructions === 'Write in the first person.'));
  assert.ok(calls.story.every((r) => r.instructions === 'Write in the first person.'));
  assert.equal(res.story.timeline_title, 'First chunk');
  assert.equal(res.story.chapters.length, 2);
  // allowMerges: false (one event per photo) - the story pass's merges are dropped.
  assert.equal(res.merged, 0);
  assert.equal(s.getEvents().length, events.length);
});

test('runAutoBuild: merges still apply on the coarse presets (allowMerges default)', async () => {
  const { metas, events } = perPhotoImport();
  const s = store(events);
  const api = {
    draftPhotoEvents: async (req) => ({ drafts: req.events.map((e) => ({ id: e.id, title: 'T' })) }),
    draftPhotoStory: async (req) => ({ timeline_title: 'X', chapters: [], merges: [{ event_ids: req.events.slice(0, 2).map((e) => e.id), title: 'M' }], titles: [], highlights: [] }),
    draftStoryOverview: async () => ({ overview: '' }),
  };
  const res = await runAutoBuild({ ...s, metasById: metas, limits: { ...LIMITS, story_max_events: 250 }, api, encodeImages: async () => null });
  assert.equal(res.merged, 1);
  assert.equal(s.getEvents().length, events.length - 1);
});

test('runAutoBuild: a later story chunk failing keeps what the earlier chunks shaped', async () => {
  const { metas, events } = perPhotoImport();
  const s = store(events);
  let n = 0;
  const api = {
    draftPhotoEvents: async (req) => ({ drafts: req.events.map((e) => ({ id: e.id, title: 'T' })) }),
    draftPhotoStory: async (req) => {
      n += 1;
      if (n === 2) throw new Error('model busy');
      return { credits: 1, timeline_title: 'Kept', chapters: [], merges: [], titles: [{ id: req.events[0].id, title: 'Better' }], highlights: [] };
    },
    draftStoryOverview: async () => ({ overview: 'O' }),
  };
  const res = await runAutoBuild({ ...s, metasById: metas, limits: LIMITS, api, encodeImages: async () => null });
  assert.equal(res.storyFailed, true);
  assert.equal(res.story.timeline_title, 'Kept');
  assert.equal(s.getEvents()[0].title, 'Better');
  assert.equal(res.overview, 'O');
});
