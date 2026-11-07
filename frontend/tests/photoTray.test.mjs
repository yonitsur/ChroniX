import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTrayFile,
  filterEventsByQuery,
  filenameToLabel,
  suggestEventsForPhoto,
  dateMatchScore,
  snapshotImageFields,
} from '../src/utils/photoTray.js';

const events = [
  { id: 1, title: "Grandma Rosa's Wedding", subtitle: 'Tel Aviv', from: { year: 1962 } },
  { id: 2, title: 'סבא יוסף עלה לארץ', from: { year: 1948 } },
  { id: 3, title: 'First house', from: { year: 1975 } },
];

test('classifyTrayFile accepts images and rejects other types and oversize files', () => {
  assert.equal(classifyTrayFile({ type: 'image/jpeg', size: 10 }), 'ok');
  assert.equal(classifyTrayFile({ type: 'application/pdf', size: 10 }), 'type');
  assert.equal(classifyTrayFile({ type: 'image/png', size: 50 * 1024 * 1024 }), 'size');
});

test('filterEventsByQuery matches title, subtitle, year and Hebrew; empty returns all', () => {
  assert.equal(filterEventsByQuery(events, '').length, 3);
  assert.deepEqual(filterEventsByQuery(events, 'wedding').map((e) => e.id), [1]);
  assert.deepEqual(filterEventsByQuery(events, 'tel aviv').map((e) => e.id), [1]);
  assert.deepEqual(filterEventsByQuery(events, '1975').map((e) => e.id), [3]);
  assert.deepEqual(filterEventsByQuery(events, 'יוסף').map((e) => e.id), [2]);
  assert.equal(filterEventsByQuery(events, 'zzz').length, 0);
});

test('filenameToLabel and suggestEventsForPhoto match filenames to titles', () => {
  assert.equal(filenameToLabel('grandma_rosa-wedding.JPG'), 'grandma rosa wedding');
  assert.deepEqual(suggestEventsForPhoto('rosa_wedding_1962.jpg', events).map((e) => e.id), [1]);
  assert.deepEqual(suggestEventsForPhoto('IMG_0001.jpg', events), []);
});

test('snapshotImageFields captures only image fields', () => {
  const snap = snapshotImageFields({ id: 1, title: 'x', imageUrl: 'u', imageSource: 'ai' });
  assert.equal(snap.imageUrl, 'u');
  assert.equal(snap.imageSource, 'ai');
  assert.ok(!('title' in snap));
});


test('suggestEventsForPhoto uses the photo\'s capture day', () => {
  const evs = [
    { id: 'wed', title: 'The wedding', from: { year: 2019, month: 6, day: 14, precision: 'day' } },
    { id: 'trip', title: 'Road trip', from: { year: 2019, month: 6, day: 1, precision: 'day' }, to: { year: 2019, month: 6, day: 10, precision: 'day' } },
    { id: 'june', title: 'Moved house', from: { year: 2019, month: 6, precision: 'month' } },
    { id: 'yr', title: 'New job', from: { year: 2019, precision: 'year' } },
  ];
  assert.equal(dateMatchScore(evs[0], { year: 2019, month: 6, day: 14 }), 6);
  assert.equal(dateMatchScore(evs[0], { year: 2019, month: 6, day: 15 }), 4);
  assert.equal(dateMatchScore(evs[1], { year: 2019, month: 6, day: 5 }), 6);
  assert.equal(dateMatchScore(evs[2], { year: 2019, month: 6, day: 5 }), 2);
  assert.equal(dateMatchScore(evs[3], { year: 2019, month: 6, day: 5 }), 1);
  // Generic camera filename: only the date can help.
  assert.deepEqual(suggestEventsForPhoto('DSC_0042.JPG', evs, 3, { year: 2019, month: 6, day: 14 }).map((e) => e.id), ['wed', 'trip', 'june']);
  assert.deepEqual(suggestEventsForPhoto('DSC_0042.JPG', evs, 3, { year: 2019, month: 6, day: 5 }).map((e) => e.id), ['trip', 'wed', 'june']);
  // A matching filename word still wins over a date-only match.
  assert.equal(suggestEventsForPhoto('road_trip.jpg', evs, 3, { year: 2019, month: 6, day: 14 })[0].id, 'trip');
  // No date and no useful words: nothing.
  assert.deepEqual(suggestEventsForPhoto('DSC_0042.JPG', evs), []);
});
