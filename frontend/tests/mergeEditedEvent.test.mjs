// Saving an event from the editor keeps the fields the form doesn't show (people, sources,
// provenance, place links...), and drops the ones that describe a field the user just changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeEditedEvent } from '../src/components/eventEditor/mergeEditedEvent.js';

const PINSK = { kind: 'place', name: 'Pinsk', title: 'Pinsk', url: 'https://en.wikipedia.org/wiki/Pinsk' };
const stored = {
  id: 'bk-0001',
  title: 'Born in Pinsk',
  from: { year: 1901, precision: 'year' },
  locationName: 'Pinsk',
  imageUrl: 'https://cdn.example/1.webp',
  imageCaption: 'Grandpa, 1901',
  wikiUrl: 'https://en.wikipedia.org/wiki/Pinsk',
  wikiTitleEn: 'Pinsk',
  people: [{ id: 'p1', name: 'Grandpa' }],
  peopleMentioned: ['his uncle'],
  sourceRefs: [{ sourceId: 's1', unit: 3, snippet: 'born in Pinsk' }],
  provenance: 'document:s1#u3',
  dateText: 'around 1901',
  dateBasis: 'inferred',
  circa: true,
  photoSource: { count: 4 },
  ai: true,
  storyAnchor: 'birth',
  contextLinks: [PINSK],
  imageModel: 'old-model',
};
// What the form writes when the user only fixes a typo in the title.
const form = (over = {}) => ({
  id: 'bk-0001', title: 'Born in Pinsk!', from: { year: 1901, precision: 'year' }, to: undefined, isToPresent: false,
  locationName: 'Pinsk', imageUrl: 'https://cdn.example/1.webp', imageModel: undefined,
  wikiUrl: 'https://en.wikipedia.org/wiki/Pinsk', sourceUrl: 'https://en.wikipedia.org/wiki/Pinsk', isEdited: true, ...over,
});

test('fields the form does not show survive a save', () => {
  const out = mergeEditedEvent(stored, form());
  assert.equal(out.title, 'Born in Pinsk!');
  for (const key of ['people', 'peopleMentioned', 'sourceRefs', 'provenance', 'photoSource', 'ai', 'storyAnchor',
    'contextLinks', 'dateText', 'dateBasis', 'circa', 'imageCaption', 'wikiTitleEn']) {
    assert.deepEqual(out[key], stored[key], key);
  }
  assert.equal(out.imageModel, undefined); // a field the form clears stays cleared
});

test('a changed date drops its wording, basis and "circa"', () => {
  const out = mergeEditedEvent(stored, form({ from: { year: 1902, month: 3, day: 4, precision: 'day' } }));
  assert.equal('dateText' in out || 'dateBasis' in out || 'circa' in out, false);
  assert.deepEqual(out.people, stored.people);
  // Re-normalizing the same date (precision only) is not a change.
  assert.equal(mergeEditedEvent({ ...stored, from: { year: 1901 } }, form()).circa, true);
  assert.equal('circa' in mergeEditedEvent(stored, form({ isToPresent: true })), false);
});

test('a new cover drops the old caption; a new Wikipedia page drops its English title', () => {
  assert.equal('imageCaption' in mergeEditedEvent(stored, form({ imageUrl: 'https://cdn.example/2.webp' })), false);
  const other = 'https://en.wikipedia.org/wiki/Brest';
  assert.equal('wikiTitleEn' in mergeEditedEvent(stored, form({ wikiUrl: other, sourceUrl: other })), false);
});

test('a new place drops the place link', () => {
  const out = mergeEditedEvent(stored, form({ locationName: 'Haifa' }));
  assert.equal('contextLinks' in out, false);
  assert.equal(mergeEditedEvent(stored, form({ locationName: ' Pinsk ' })).contextLinks.length, 1);
});

test('a new event is just the form', () => {
  const f = form();
  assert.equal(mergeEditedEvent(null, f), f);
});

test('the editor saves through the merge', () => {
  const src = readFileSync(new URL('../src/components/eventEditor/useEventEditor.js', import.meta.url), 'utf8');
  assert.match(src, /return mergeEditedEvent\(initialEvent, saved\);/);
});
