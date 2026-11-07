import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeTimelines,
  extractSourceTimelines,
  applyHiddenLayersToTimeline,
  canExpandSourceSubLanes,
  MAX_EXPANDED_LANES,
} from '../src/utils/mergeTimelines.js';

function makeTimelineA() {
  return {
    id: 'tl-israel',
    title: 'תולדות מדינת ישראל',
    description: 'ציוני דרך בתולדות המדינה',
    overview: 'סקירה היסטורית מקיפה.',
    timeScale: 'calendar',
    contentMode: 'classic',
    lanes: [
      { id: 'politics', title: 'מדינאות', order: 0 },
      { id: 'tech', title: 'חדשנות', order: 1 },
    ],
    articles: [
      {
        id: 'evt-1',
        title: 'הכרזת העצמאות',
        from: { year: 1948, month: 5, day: 14, precision: 'day' },
        lane: 'politics',
        lat: 32.063,
        lng: 34.771,
      },
      {
        id: 'evt-2',
        title: 'שיגור אופק 1',
        from: { year: 1988, month: 9, day: 19, precision: 'day' },
        lane: 'tech',
        category: 'חלל',
      },
    ],
    grounding: {
      is_grounded: true,
      sources: [{ title: 'Source 1', url: 'https://example.org/israel' }],
    },
  };
}

function makeTimelineB() {
  return {
    id: 'tl-space',
    title: 'המרוץ לחלל',
    description: 'חקר החלל המודרני',
    overview: 'מספוטניק ועד ג׳יימס ווב.',
    timeScale: 'calendar',
    contentMode: 'kids',
    lanes: [],
    articles: [
      {
        id: 'evt-1', // Same raw ID as Timeline A!
        title: 'ספוטניק 1',
        from: { year: 1957, month: 10, day: 4, precision: 'day' },
      },
      {
        id: 'evt-2',
        title: 'אפולו 11',
        from: { year: 1969, month: 7, day: 20, precision: 'day' },
      },
    ],
    grounding: {
      is_grounded: true,
      sources: [
        { title: 'Source 1 dup', url: 'https://example.org/israel' },
        { title: 'NASA', url: 'https://nasa.gov' },
      ],
    },
  };
}

test('mergeTimelines creates 1 lane per source by default and namespaces colliding IDs', () => {
  const tlA = makeTimelineA();
  const tlB = makeTimelineB();
  assert.equal(canExpandSourceSubLanes([tlA, tlB]), true);

  const merged = mergeTimelines([tlA, tlB]);

  assert.equal(merged.creationSource, 'merged');
  assert.equal(merged.detectedLanguage, 'he');
  assert.equal(merged.contentMode, 'kids');
  assert.equal(merged.lanes.length, 2);
  assert.deepEqual(
    merged.lanes.map((l) => l.title),
    ['תולדות מדינת ישראל', 'המרוץ לחלל'],
  );

  // Zero ID collisions despite both sources having `evt-1` and `evt-2`
  const ids = merged.articles.map((a) => a.id);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(ids, ['L1__evt-1', 'L1__evt-2', 'L2__evt-1', 'L2__evt-2']);

  // Original sub-lane title preserved in `category` when event had no category
  assert.equal(merged.articles[0].category, 'מדינאות');
  // Explicit category preserved when event already had one
  assert.equal(merged.articles[1].category, 'חלל');

  // Grounding sources deduplicated by URL
  assert.equal(merged.grounding.sources.length, 2);
});

test('mergeTimelines supports expanding sub-lanes within MAX_EXPANDED_LANES and round-trip adding a 3rd layer', () => {
  const tlA = makeTimelineA();
  const tlB = makeTimelineB();
  const expanded = mergeTimelines([tlA, tlB], { expandSubLanes: true });

  assert.equal(expanded.lanes.length, 3); // 2 sub-lanes from A + 1 lane from B <= MAX_EXPANDED_LANES (6)
  assert.ok(expanded.lanes.length <= MAX_EXPANDED_LANES);

  // Add a 3rd timeline onto the already-merged timeline without double-prefixing IDs
  const tlC = {
    id: 'tl-family',
    title: 'הסיפור המשפחתי',
    articles: [{ id: 'evt-1', title: 'עלייה לארץ', from: { year: 1950, precision: 'year' } }],
  };

  const threeLayers = mergeTimelines([expanded, tlC], { expandSubLanes: false });
  assert.equal(threeLayers.mergedSources.length, 3);
  assert.equal(threeLayers.lanes.length, 3);
  assert.ok(!threeLayers.articles.some((a) => a.id.includes('L1__L1__')));

  const extracted = extractSourceTimelines(threeLayers);
  assert.equal(extracted.length, 3);
  assert.equal(extracted[0].articles[0].id, 'evt-1');
});

test('applyHiddenLayersToTimeline hides layers non-destructively and mixed scales flag is set', () => {
  const prehistoric = {
    id: 'tl-cosmos',
    title: 'Big Bang & Early Earth',
    timeScale: 'prehistoric',
    articles: [{ id: 'p1', title: 'Big Bang', from: { year: -13800000000, precision: 'million-years' } }],
  };
  const modern = makeTimelineB();

  const merged = mergeTimelines([prehistoric, modern]);
  assert.equal(merged.hasMixedTimeScales, true);
  assert.equal(merged.timeScale, 'prehistoric');

  const filtered = applyHiddenLayersToTimeline(merged, new Set(['layer-1']));
  assert.equal(filtered.lanes.length, 1);
  assert.equal(filtered.lanes[0].id, 'layer-2');
  assert.equal(filtered.articles.length, 2);
  // Underlying merged timeline stays intact
  assert.equal(merged.articles.length, 3);
});
