import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchTakeoutSidecars, parseTakeoutSidecar, mergeSidecarIntoTags, utcToExifWall, offsetToExif, isSidecarName,
} from '../src/utils/photoImport/takeout.js';
import { buildPhotoMeta } from '../src/utils/photoImport/photoMeta.js';
import { eventPeople, eventCaptions, eventPlaceLabel, eventsToMoments, createImportEvents } from '../src/utils/photoImport/importModel.js';
import { clusterPhotos } from '../src/utils/photoImport/clusterPhotos.js';

const A = 'Takeout/Google Photos/Trip';
const p = (name, dir = A) => ({ path: `${dir}/${name}` });

test('sidecars match every Takeout naming variant, only within the same folder', () => {
  const images = [
    p('IMG_1.jpg'), p('IMG_2.jpg'), p('IMG_3_with_a_very_long_name_from_some_app.jpg'),
    p('IMG_1(1).jpg'), p('IMG_4-edited.jpg'), p('IMG_5.jpg'), p('IMG_6.HEIC'),
    p('IMG_7.jpg', 'Takeout/Google Photos/Other'),
  ];
  const sidecars = [
    p('IMG_1.jpg.json'), p('IMG_2.jpg.supplemental-metadata.json'),
    p('IMG_3_with_a_very_long_name_from_some_app.jpg.suppl.json'),
    p('IMG_1.jpg(1).json'), p('IMG_4.jpg.supplemental-metadata.json'),
    p('IMG_6.HEIC.supplemental-metadata(0).json'),
    p('IMG_7.jpg.json'), // in Trip, so it must not match Other/IMG_7.jpg
    p('metadata.json'),
  ];
  const m = matchTakeoutSidecars(images, sidecars);
  assert.equal(m.get(`${A}/IMG_1.jpg`), `${A}/IMG_1.jpg.json`);
  assert.equal(m.get(`${A}/IMG_2.jpg`), `${A}/IMG_2.jpg.supplemental-metadata.json`);
  assert.equal(m.get(`${A}/IMG_3_with_a_very_long_name_from_some_app.jpg`), `${A}/IMG_3_with_a_very_long_name_from_some_app.jpg.suppl.json`);
  assert.equal(m.get(`${A}/IMG_1(1).jpg`), `${A}/IMG_1.jpg(1).json`);
  assert.equal(m.get(`${A}/IMG_4-edited.jpg`), `${A}/IMG_4.jpg.supplemental-metadata.json`);
  assert.equal(m.has(`${A}/IMG_5.jpg`), false);
  assert.equal(m.has('Takeout/Google Photos/Other/IMG_7.jpg'), false);
  assert.ok(isSidecarName('x.JSON') && !isSidecarName('x.jpg'));
});

test('parseTakeoutSidecar reads time, place (geoData first, 0,0 ignored), people and caption', () => {
  const sc = parseTakeoutSidecar({
    title: 'IMG_1.jpg',
    description: ' At the river ',
    photoTakenTime: { timestamp: '1631959200' },
    geoData: { latitude: 0, longitude: 0 },
    geoDataExif: { latitude: 41.14, longitude: -8.61 },
    people: [{ name: 'Dana' }, { name: '' }, { name: 'Avi' }],
  });
  assert.equal(sc.utcMs, 1631959200000);
  assert.deepEqual([sc.lat, sc.lng], [41.14, -8.61]);
  assert.deepEqual(sc.people, ['Dana', 'Avi']);
  assert.equal(sc.description, 'At the river');
  assert.equal(parseTakeoutSidecar(null), null);
  assert.equal(parseTakeoutSidecar({}).utcMs, null);
});

test('sidecars fill gaps only: EXIF time and GPS win when present', () => {
  const sc = { utcMs: Date.UTC(2021, 8, 18, 10, 0), lat: 41.14, lng: -8.61, people: [], description: '' };
  const fixedOffset = () => 60;
  const filled = mergeSidecarIntoTags(null, sc, { offsetAt: fixedOffset });
  assert.equal(filled.DateTimeOriginal, '2021:09:18 11:00:00');
  assert.equal(filled.OffsetTimeOriginal, '+01:00');
  assert.deepEqual([filled.latitude, filled.longitude], [41.14, -8.61]);

  const exif = { DateTimeOriginal: '2021:09:18 09:00:00', latitude: 38.7, longitude: -9.1 };
  const kept = mergeSidecarIntoTags(exif, sc, { offsetAt: fixedOffset });
  assert.equal(kept.DateTimeOriginal, '2021:09:18 09:00:00');
  assert.equal(kept.latitude, 38.7);

  // Broken EXIF GPS (0,0) doesn't block the sidecar's place.
  const broken = mergeSidecarIntoTags({ latitude: 0, longitude: 0 }, sc, { offsetAt: fixedOffset });
  assert.equal(broken.latitude, 41.14);

  assert.equal(utcToExifWall(Date.UTC(2021, 0, 1, 23, 30), 120), '2021:01:02 01:30:00');
  assert.equal(offsetToExif(-330), '-05:30');
});

test('Takeout people and captions reach events and moments; typed places win', () => {
  const now = Date.UTC(2026, 10, 5);
  const mk = (id, h, people, description = '') => buildPhotoMeta({
    id, name: `${id}.jpg`, tags: { DateTimeOriginal: `2021:09:18 ${h}:00:00` }, timeSource: 'takeout', people, description,
  }, { now });
  const metas = [mk('a', 10, ['Dana', 'Avi'], 'Ribeira at last!'), mk('b', 11, ['Dana']), mk('c', 12, null)];
  assert.equal(metas[0].time.source, 'takeout');
  const byId = new Map(metas.map((m) => [m.id, m]));
  const [ev] = createImportEvents(clusterPhotos(metas).clusters, byId);
  assert.deepEqual(eventPeople(ev, byId), ['Dana', 'Avi']);
  assert.deepEqual(eventCaptions(ev, byId), ['Ribeira at last!']);

  const typed = { ...ev, placeText: 'Porto riverside', place: { city: 'Porto', country: 'Portugal' } };
  assert.equal(eventPlaceLabel(typed), 'Porto riverside');
  const { rows } = eventsToMoments([typed], { lang: 'en', newRowId: () => 'r1' });
  assert.equal(rows[0].place, 'Porto riverside');
  assert.equal(rows[0].title, 'Porto riverside');
});

// ---- Google Photos picks & phones -------------------------------------------------------------
import { pickedItemToTags } from '../src/utils/photoImport/takeout.js';
import { detectPhonePlatform } from '../src/utils/photoImport/photoFiles.js';

test('picked Google Photos items keep their capture time (UTC -> local wall clock)', () => {
  const tags = pickedItemToTags({ createTime: '2023-05-14T17:20:00Z' }, { offsetAt: () => 60 });
  assert.deepEqual(tags, { DateTimeOriginal: '2023:05:14 18:20:00', OffsetTimeOriginal: '+01:00' });
  const meta = buildPhotoMeta({ id: 'g', name: 'IMG_0001.JPG', tags, timeSource: 'google' }, { now: Date.UTC(2026, 0, 1) });
  assert.equal(meta.time.source, 'google');
  assert.equal(meta.lat, null);
  assert.equal(pickedItemToTags({ createTime: 'nope' }), null);
});

test('detectPhonePlatform', () => {
  assert.equal(detectPhonePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'ios');
  assert.equal(detectPhonePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios'); // iPadOS
  assert.equal(detectPhonePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), null);
  assert.equal(detectPhonePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), 'android');
  assert.equal(detectPhonePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0), null);
});
