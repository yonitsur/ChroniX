import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExifDateTime, parseUtcOffset, dateFromFilename, gpsToDecimal, buildPhotoMeta, summarizePhotoMeta,
} from '../src/utils/photoImport/photoMeta.js';
import {
  clusterPhotos, detectHome, suggestTrips, pickRepresentatives, haversineKm,
} from '../src/utils/photoImport/clusterPhotos.js';
import {
  createImportEvents, regroupEvents, mergeWithNext, splitEventAt, movePhotos, datePhoto,
  formatDateRange, placeLabel, defaultEventTitle, placesToLookup, applyPlaces, findExistingMatch,
  estimateStorageChars, fitPhotosPerEvent, suggestBlueprintForImport, tripChapters, eventsToMoments,
  applyPhotoMedia, homeCountryOf, wallToDateText,
} from '../src/utils/photoImport/importModel.js';
import { parseFuzzyDate } from '../src/utils/fuzzyDate.js';
import { getStoryBlueprint, buildStoryTimeline, emptyStoryAnswers } from '../src/data/storyBlueprints.js';

const NOW = Date.UTC(2026, 10, 5);
const HOME = { lat: 32.08, lng: 34.78 }; // Tel Aviv
const LISBON = { lat: 38.72, lng: -9.14 };
const PORTO = { lat: 41.15, lng: -8.61 };

let seq = 0;
/** A photo meta at local wall time `iso` ("2023-05-14T10:22"), optional place. */
function photo(iso, place = null, extra = {}) {
  seq += 1;
  const [d, t = '12:00'] = iso.split('T');
  const tags = { DateTimeOriginal: `${d.replace(/-/g, ':')} ${t}:00` };
  if (place) Object.assign(tags, { latitude: place.lat + (seq % 7) * 0.001, longitude: place.lng });
  return buildPhotoMeta({ id: `p${seq}`, name: `IMG_${seq}.jpg`, tags: { ...tags, ...extra } }, { now: NOW });
}
const byId = (list) => new Map(list.map((p) => [p.id, p]));

// ---- photoMeta -------------------------------------------------------------------------------

test('parseExifDateTime keeps the wall clock and derives UTC from the offset', () => {
  const t = parseExifDateTime('2023:05:14 10:22:31', '+02:00', { now: NOW });
  assert.deepEqual(t.wall, { year: 2023, month: 5, day: 14, hour: 10, minute: 22, second: 31 });
  assert.equal(t.wallMs, Date.UTC(2023, 4, 14, 10, 22, 31));
  assert.equal(t.utcMs, Date.UTC(2023, 4, 14, 8, 22, 31));
  assert.equal(t.sortMs, t.utcMs);
  const noOffset = parseExifDateTime('2023:05:14 10:22:31', null, { now: NOW });
  assert.equal(noOffset.utcMs, null);
  assert.equal(noOffset.sortMs, noOffset.wallMs);
});

test('parseExifDateTime rejects junk, impossible and future dates', () => {
  assert.equal(parseExifDateTime('0000:00:00 00:00:00', null, { now: NOW }), null);
  assert.equal(parseExifDateTime('2023:02:30 10:00:00', null, { now: NOW }), null);
  assert.equal(parseExifDateTime('2099:01:01 10:00:00', null, { now: NOW }), null);
  assert.equal(parseExifDateTime('', null, { now: NOW }), null);
  assert.equal(parseExifDateTime('hello', null, { now: NOW }), null);
});

test('parseUtcOffset', () => {
  assert.equal(parseUtcOffset('+02:00'), 120);
  assert.equal(parseUtcOffset('-0530'), -330);
  assert.equal(parseUtcOffset('Z'), 0);
  assert.equal(parseUtcOffset('+25:00'), null);
  assert.equal(parseUtcOffset('nope'), null);
});

test('dateFromFilename reads common phone and app names', () => {
  const w = (name) => dateFromFilename(name, { now: NOW })?.wall;
  assert.deepEqual(w('IMG_20230514_102231.jpg'), { year: 2023, month: 5, day: 14, hour: 10, minute: 22, second: 31 });
  assert.deepEqual(w('PXL_20230514_102231123.jpg'), { year: 2023, month: 5, day: 14, hour: 10, minute: 22, second: 31 });
  assert.deepEqual(w('Screenshot_20230514-102231.png'), { year: 2023, month: 5, day: 14, hour: 10, minute: 22, second: 31 });
  assert.deepEqual(w('Photo 2023-05-14 at 10.22.31.jpeg'), { year: 2023, month: 5, day: 14, hour: 10, minute: 22, second: 31 });
  const wa = dateFromFilename('IMG-20230514-WA0001.jpg', { now: NOW });
  assert.equal(wa.dateOnly, true);
  assert.deepEqual([wa.wall.year, wa.wall.month, wa.wall.day], [2023, 5, 14]);
  assert.equal(dateFromFilename('DSC_0042.JPG', { now: NOW }), null);
  assert.equal(dateFromFilename('holiday.jpg', { now: NOW }), null);
});

test('gpsToDecimal handles DMS arrays and hemisphere refs', () => {
  assert.ok(Math.abs(gpsToDecimal([38, 43, 12], 'N') - 38.72) < 1e-9);
  assert.ok(Math.abs(gpsToDecimal([9, 8, 24], 'W') + 9.14) < 1e-9);
  assert.equal(gpsToDecimal(12.5, 'S'), -12.5);
  assert.equal(gpsToDecimal(['x'], 'N'), null);
});

test('buildPhotoMeta prefers EXIF, falls back to filename, drops broken GPS', () => {
  const a = buildPhotoMeta({ id: 'a', name: 'IMG_20200101_000000.jpg', tags: { DateTimeOriginal: '2023:05:14 10:00:00', GPSLatitude: [38, 43, 12], GPSLatitudeRef: 'N', GPSLongitude: [9, 8, 24], GPSLongitudeRef: 'W' } }, { now: NOW });
  assert.equal(a.timeSource, 'exif');
  assert.equal(a.time.wall.year, 2023);
  assert.ok(Math.abs(a.lat - 38.72) < 1e-6 && Math.abs(a.lng + 9.14) < 1e-6);

  const b = buildPhotoMeta({ id: 'b', name: 'IMG_20200101_090000.jpg', tags: null }, { now: NOW });
  assert.equal(b.timeSource, 'filename');
  assert.equal(b.lat, null);

  const c = buildPhotoMeta({ id: 'c', name: 'x.jpg', tags: { DateTimeOriginal: '2023:05:14 10:00:00', latitude: 0, longitude: 0 } }, { now: NOW });
  assert.equal(c.lat, null);

  const d = buildPhotoMeta({ id: 'd', name: 'x.jpg' }, { now: NOW });
  assert.equal(d.time, null);
  const s = summarizePhotoMeta([a, b, c, d]);
  assert.deepEqual([s.total, s.dated, s.undated, s.fromFilename, s.withGps], [4, 3, 1, 1, 1]);
});

// ---- clustering -------------------------------------------------------------------------------

test('a day trip splits into events by time gaps and distance', () => {
  const photos = [
    photo('2023-05-14T09:00', LISBON), photo('2023-05-14T09:30', LISBON), photo('2023-05-14T11:00', LISBON),
    photo('2023-05-14T19:00', PORTO), photo('2023-05-14T19:20', PORTO),
  ];
  const { clusters, undatedIds, home } = clusterPhotos(photos, { preset: 'balanced' });
  assert.equal(home, null);
  assert.deepEqual(undatedIds, []);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].photoIds.length, 3);
  assert.ok(haversineKm(clusters[1].centroid, PORTO) < 2);
});

test('overnight pauses split days; balanced merges same-place days away from home, more keeps them', () => {
  const photos = [];
  for (const d of ['2023-05-12', '2023-05-13', '2023-05-14']) {
    photos.push(photo(`${d}T10:00`, LISBON), photo(`${d}T14:00`, LISBON), photo(`${d}T20:00`, LISBON));
  }
  // Without a known home, balanced does not merge (it can't tell home from away)...
  assert.equal(clusterPhotos(photos, { preset: 'balanced' }).clusters.length, 3);
  // ...with a home far away it merges the three Lisbon days into one event.
  const merged = clusterPhotos(photos, { preset: 'balanced', home: HOME }).clusters;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].days, 3);
  assert.deepEqual([merged[0].startWall.day, merged[0].endWall.day], [12, 14]);
  assert.equal(merged[0].atHome, false);
  assert.equal(clusterPhotos(photos, { preset: 'more', home: HOME }).clusters.length >= 3, true);
  // "fewer" merges same-place days even without a home.
  assert.equal(clusterPhotos(photos, { preset: 'fewer' }).clusters.length, 1);
});

test('photos without GPS join the event they were taken in; undated photos are set aside', () => {
  const photos = [photo('2023-05-14T10:00', LISBON), photo('2023-05-14T10:30'), photo('2023-05-14T11:00', LISBON)];
  const undated = buildPhotoMeta({ id: 'u1', name: 'scan.jpg' }, { now: NOW });
  const { clusters, undatedIds } = clusterPhotos([...photos, undated]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].photoIds.length, 3);
  assert.equal(clusters[0].gpsCount, 2);
  assert.deepEqual(undatedIds, ['u1']);
});

test('time-zone offsets order photos correctly across zones', () => {
  // Taken in Lisbon at 10:00 (+01:00) and in Tel Aviv at 11:30 (+03:00) the same day:
  // Tel Aviv one is earlier in real time (08:30Z vs 09:00Z).
  const a = buildPhotoMeta({ id: 'a', name: 'a.jpg', tags: { DateTimeOriginal: '2023:05:14 10:00:00', OffsetTimeOriginal: '+01:00' } }, { now: NOW });
  const b = buildPhotoMeta({ id: 'b', name: 'b.jpg', tags: { DateTimeOriginal: '2023:05:14 11:30:00', OffsetTimeOriginal: '+03:00' } }, { now: NOW });
  const { clusters } = clusterPhotos([a, b], { preset: 'balanced' });
  assert.deepEqual(clusters[0].photoIds, ['b', 'a']);
});

function lifeAtHomeWithTrip() {
  const photos = [];
  // 10 home days over ~5 months, a few photos each; one big party.
  for (let m = 1; m <= 5; m += 1) {
    photos.push(photo(`2022-0${m}-03T10:00`, HOME), photo(`2022-0${m}-17T18:00`, HOME));
  }
  for (let i = 0; i < 6; i += 1) photos.push(photo(`2022-03-20T1${i}:00`, HOME));
  // A Portugal trip in June.
  photos.push(photo('2022-06-10T10:00', LISBON), photo('2022-06-10T15:00', LISBON), photo('2022-06-11T10:00', LISBON));
  photos.push(photo('2022-06-13T10:00', PORTO), photo('2022-06-13T12:00', PORTO));
  return photos;
}

test('detectHome needs a long span and repeated days', () => {
  const photos = lifeAtHomeWithTrip();
  const home = detectHome(photos);
  assert.ok(home);
  assert.ok(haversineKm(home, HOME) < 5);
  // A two-week trip alone never claims a home.
  const trip = [];
  for (let d = 10; d <= 24; d += 1) trip.push(photo(`2023-05-${d}T10:00`, LISBON));
  assert.equal(detectHome(trip), null);
});

test('small events at home are "everyday" and hidden by default; trips are detected', () => {
  const photos = lifeAtHomeWithTrip();
  const { clusters, home } = clusterPhotos(photos, { preset: 'balanced' });
  const everyday = clusters.filter((c) => c.everyday);
  const party = clusters.find((c) => c.photoIds.length === 6);
  assert.ok(everyday.length >= 8);
  assert.equal(party.everyday, false);
  assert.equal(party.atHome, true);
  const lisbon = clusters.find((c) => c.centroid && haversineKm(c.centroid, LISBON) < 5);
  assert.equal(lisbon.days, 2);

  const trips = suggestTrips(clusters, home);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].clusterIds.length, 2);
  assert.deepEqual([trips[0].startWall.day, trips[0].endWall.day], [10, 13]);

  // Everyday groups aren't dropped: they become one included event per month.
  const events = createImportEvents(clusters, byId(photos));
  assert.equal(events.filter((e) => !e.include).length, 0);
  const monthly = events.filter((e) => e.everydayMonth);
  assert.equal(monthly.length, 5); // Jan..May 2022
  assert.equal(monthly.reduce((n, e) => n + e.photoIds.length, 0), everyday.reduce((n, c) => n + c.photoIds.length, 0));
  assert.equal(defaultEventTitle(monthly[0], 'en'), 'Everyday moments · Jan 2022');
  assert.equal(eventsToMoments([monthly[0]], { lang: 'en', newRowId: () => 'r' }).rows[0].date, 'January 2022');

  // "fewer" turns the whole trip into one event.
  const fewer = clusterPhotos(photos, { preset: 'fewer' }).clusters;
  assert.equal(fewer.filter((c) => c.atHome === false).length, 1);
});

test('pickRepresentatives spreads picks, skips bursts and puts the cover first', () => {
  const photos = [];
  for (let i = 0; i < 10; i += 1) photos.push(photo(`2023-05-14T1${i % 10}:00`));
  const ids = photos.map((p) => p.id);
  const picks = pickRepresentatives(ids, byId(photos), 4);
  assert.equal(picks.length, 4);
  assert.equal(new Set(picks).size, 4);
  assert.deepEqual(pickRepresentatives(ids.slice(0, 2), byId(photos), 4).length, 2);

  // Burst: 5 shots within one second -> treated as one moment.
  const burst = [0, 1, 2, 3, 4].map(() => photo('2023-05-14T10:00'));
  const later = photo('2023-05-14T12:00');
  const picks2 = pickRepresentatives([...burst, later].map((p) => p.id), byId([...burst, later]), 2);
  assert.ok(picks2.includes(later.id));
});

test('clustering 10k photos stays fast', () => {
  const photos = [];
  const base = Date.UTC(2015, 0, 1);
  for (let i = 0; i < 10000; i += 1) {
    const ms = base + i * 37 * 60 * 1000;
    const d = new Date(ms);
    const tags = { DateTimeOriginal: `${d.getUTCFullYear()}:${String(d.getUTCMonth() + 1).padStart(2, '0')}:${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`, latitude: HOME.lat + (i % 50) * 0.01, longitude: HOME.lng };
    photos.push(buildPhotoMeta({ id: `big${i}`, name: 'x.jpg', tags }, { now: NOW }));
  }
  const t0 = Date.now();
  const { clusters } = clusterPhotos(photos, { preset: 'balanced' });
  assert.ok(clusters.length > 10);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
});

// ---- import model -----------------------------------------------------------------------------

test('formatDateRange in English and Hebrew', () => {
  const w = (y, m, d) => ({ year: y, month: m, day: d });
  assert.equal(formatDateRange(w(2023, 5, 14), w(2023, 5, 14)), '14 May 2023');
  assert.equal(formatDateRange(w(2023, 5, 12), w(2023, 5, 15)), '12–15 May 2023');
  assert.equal(formatDateRange(w(2023, 5, 28), w(2023, 6, 2)), '28 May – 2 Jun 2023');
  assert.equal(formatDateRange(w(2022, 12, 30), w(2023, 1, 2)), '30 Dec 2022 – 2 Jan 2023');
  assert.equal(formatDateRange(w(2023, 5, 14), w(2023, 5, 14), 'he'), '14 במאי 2023');
});

test('wallToDateText round-trips through parseFuzzyDate at day precision', () => {
  for (const lang of ['en', 'he']) {
    const text = wallToDateText({ year: 2023, month: 5, day: 14 }, lang);
    const parsed = parseFuzzyDate(text, { lang, now: new Date(NOW) });
    assert.deepEqual([parsed.year, parsed.month, parsed.day, parsed.precision], [2023, 5, 14, 'day'], `${lang}: ${text}`);
  }
});

test('placeLabel adds the country only abroad', () => {
  const lisbon = { city: 'Lisbon', country: 'Portugal' };
  assert.equal(placeLabel(lisbon, 'Israel'), 'Lisbon, Portugal');
  assert.equal(placeLabel(lisbon, 'Portugal'), 'Lisbon');
  assert.equal(placeLabel({ area: 'Alfama', country: 'Portugal' }, 'Portugal'), 'Alfama');
  assert.equal(placeLabel(null), '');
});

test('merge, split and move photos between events', () => {
  const photos = [photo('2023-05-14T09:00', LISBON), photo('2023-05-14T09:30', LISBON), photo('2023-05-14T19:00', PORTO), photo('2023-05-14T19:30', PORTO)];
  const metas = byId(photos);
  const events = createImportEvents(clusterPhotos(photos).clusters, metas);
  assert.equal(events.length, 2);

  const merged = mergeWithNext(events, events[0].id, metas);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].photoIds.length, 4);

  const split = splitEventAt(merged, merged[0].id, photos[2].id, metas);
  assert.equal(split.length, 2);
  assert.deepEqual(split[1].photoIds, [photos[2].id, photos[3].id]);
  assert.equal(split[1].id, `pc-${photos[2].id}`);

  // Move one photo to the unassigned tray, then into the other event.
  const out = movePhotos(split, [], [photos[3].id], null, metas);
  assert.deepEqual(out.unassignedIds, [photos[3].id]);
  assert.equal(out.events[1].photoIds.length, 1);
  const back = movePhotos(out.events, out.unassignedIds, [photos[3].id], out.events[0].id, metas);
  assert.equal(back.events[0].photoIds.length, 3);
  assert.deepEqual(back.unassignedIds, []);

  // Moving the last photo out removes the event.
  const emptied = movePhotos(out.events, out.unassignedIds, [photos[2].id], null, metas);
  assert.equal(emptied.events.length, 1);
});

test('an undated photo can be given a date and then join an event', () => {
  const p = buildPhotoMeta({ id: 'scan', name: 'scan.jpg' }, { now: NOW });
  const dated = datePhoto(p, { year: 1998, month: 7, day: 2 });
  assert.equal(dated.time.wall.year, 1998);
  const { clusters } = clusterPhotos([dated]);
  assert.equal(clusters.length, 1);
});

test('regroupEvents keeps the user\'s titles and covers', () => {
  const photos = [photo('2023-05-14T09:00', LISBON), photo('2023-05-14T09:30', LISBON), photo('2023-05-14T19:00', PORTO)];
  const metas = byId(photos);
  const events = createImportEvents(clusterPhotos(photos, { preset: 'more' }).clusters, metas);
  events[0] = { ...events[0], title: 'Breakfast by the river', titleSource: 'user', coverId: photos[1].id };
  const regrouped = regroupEvents(events, clusterPhotos(photos, { preset: 'balanced' }).clusters, metas);
  assert.equal(regrouped[0].title, 'Breakfast by the river');
  assert.equal(regrouped[0].coverId, photos[1].id);
});

test('places: lookups are per ~1 km cell, biggest first, capped; results apply back', () => {
  const photos = [photo('2023-05-14T09:00', LISBON), photo('2023-05-14T09:10', LISBON), photo('2023-05-14T19:00', PORTO)];
  const events = createImportEvents(clusterPhotos(photos).clusters, byId(photos));
  const pts = placesToLookup(events);
  assert.equal(pts.length, 2);
  // Rounded to 2 decimals (~1 km) before it is sent anywhere.
  for (const p of pts) {
    assert.equal(p.lat, Number(p.lat.toFixed(2)));
    assert.equal(p.lng, Number(p.lng.toFixed(2)));
  }
  assert.equal(placesToLookup(events, { max: 1 }).length, 1);
  const named = applyPlaces(events, { [pts[0].id]: { city: 'Lisbon', country: 'Portugal' } });
  assert.equal(named[0].place.city, 'Lisbon');
  assert.equal(named[1].place, null);
  assert.equal(defaultEventTitle(named[0], 'en', 'Israel'), 'Lisbon, Portugal');
  assert.equal(defaultEventTitle(named[1], 'en'), '14 May 2023');
  assert.equal(homeCountryOf(named), 'Portugal');
});

test('findExistingMatch attaches to a same-day event nearby, not far away', () => {
  const photos = [photo('2023-05-14T09:00', LISBON), photo('2023-05-14T10:00', LISBON)];
  const [ev] = createImportEvents(clusterPhotos(photos).clusters, byId(photos));
  const articles = [
    { id: 'wedding', from: { year: 2023, month: 5, day: 14, precision: 'day' }, lat: LISBON.lat, lng: LISBON.lng },
    { id: 'far', from: { year: 2023, month: 5, day: 14, precision: 'day' }, lat: PORTO.lat, lng: PORTO.lng },
    { id: 'year-only', from: { year: 2023, precision: 'year' } },
  ];
  assert.equal(findExistingMatch(ev, articles), 'wedding');
  assert.equal(findExistingMatch(ev, articles.slice(1)), null);
  assert.equal(findExistingMatch(ev, [{ id: 'noplace', from: { year: 2023, month: 5, day: 15, precision: 'day' } }]), 'noplace');
});

test('storage budget: estimate and fit photos per event', () => {
  const photos = [];
  for (let i = 0; i < 6; i += 1) photos.push(photo(`2023-05-14T0${i}:00`));
  const events = createImportEvents(clusterPhotos(photos, { preset: 'more' }).clusters, byId(photos));
  const one = events.slice(0, 1);
  assert.ok(estimateStorageChars(one, 4) > estimateStorageChars(one, 1));
  assert.equal(fitPhotosPerEvent(one, 4), 4);
  assert.equal(fitPhotosPerEvent(one, 4, 8_900_000), 1);
});

test('suggestBlueprintForImport: a short trip vs a long life', () => {
  const tripPhotos = [photo('2023-05-12T10:00', LISBON), photo('2023-05-14T10:00', PORTO)];
  const tripEvents = applyPlaces(createImportEvents(clusterPhotos(tripPhotos).clusters, byId(tripPhotos)), {});
  tripEvents.forEach((e) => { e.place = { city: 'Lisbon', country: 'Portugal' }; });
  const s = suggestBlueprintForImport(tripEvents, null);
  assert.equal(s.blueprint, 'trip');
  assert.equal(s.destination, 'Portugal');

  const life = lifeAtHomeWithTrip();
  const { clusters, home } = clusterPhotos(life);
  assert.equal(suggestBlueprintForImport(createImportEvents(clusters, byId(life)), home).blueprint, 'custom');
});

test('trip chapters are named after the country abroad', () => {
  const life = lifeAtHomeWithTrip();
  const { clusters, home } = clusterPhotos(life);
  const events = createImportEvents(clusters, byId(life)).map((e) => ({
    ...e, place: e.atHome ? { city: 'Tel Aviv', country: 'Israel' } : { city: 'Lisbon', country: 'Portugal' },
  }));
  const chapters = tripChapters(suggestTrips(clusters, home), events, 'en', 'Israel');
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, 'Portugal · Jun 2022');
});

test('eventsToMoments -> buildStoryTimeline -> applyPhotoMedia produces dated, mapped photo events', () => {
  const photos = [photo('2023-05-12T10:00', LISBON), photo('2023-05-12T12:00', LISBON), photo('2023-05-14T19:00', PORTO)];
  const metas = byId(photos);
  let events = createImportEvents(clusterPhotos(photos, { preset: 'more' }).clusters, metas);
  events = events.map((e, i) => ({ ...e, place: i === 0 ? { city: 'Lisbon', country: 'Portugal' } : { city: 'Porto', country: 'Portugal' } }));
  events[0].note = 'Tiles everywhere.';
  events[1].attachTo = 'existing-1';

  let n = 0;
  const { rows, plan } = eventsToMoments(events, { lang: 'en', lane: 'journey', homeCountry: 'Israel', newRowId: () => `r${++n}` });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Lisbon, Portugal');
  assert.deepEqual(plan.map((p) => p.kind), ['new', 'attach']);

  const bp = getStoryBlueprint('trip');
  const answers = { ...emptyStoryAnswers(bp), people: { p1: 'Portugal' }, moments: rows };
  const { timeline } = buildStoryTimeline(bp, answers, { lang: 'en', now: new Date(NOW) });
  const art = timeline.articles.find((a) => a.id === plan[0].articleId);
  assert.ok(art);
  assert.deepEqual(art.from, { year: 2023, month: 5, day: 12, precision: 'day' });
  assert.equal(art.locationName, 'Lisbon, Portugal');
  assert.equal(art.subtitle, 'Tiles everywhere.');

  const existing = { id: 'existing-1', title: 'Wedding', from: { year: 2023, month: 5, day: 14, precision: 'day' }, imageUrl: 'data:image/jpeg;base64,OLD' };
  const media = {
    [plan[0].articleId]: { kind: 'new', cover: 'data:image/jpeg;base64,C', gallery: ['data:image/jpeg;base64,G1'], centroid: LISBON, photoCount: 2 },
    'existing-1': { kind: 'attach', cover: 'data:image/jpeg;base64,X', gallery: [], centroid: PORTO, photoCount: 1 },
  };
  const out = applyPhotoMedia([...timeline.articles, existing], media);
  const newArt = out.find((a) => a.id === plan[0].articleId);
  assert.equal(newArt.imageUrl, 'data:image/jpeg;base64,C');
  assert.deepEqual(newArt.additionalImages, [{ url: 'data:image/jpeg;base64,G1', caption: '' }]);
  assert.equal(newArt.provenance, 'photo');
  assert.equal(newArt.lat, 38.72);
  const att = out.find((a) => a.id === 'existing-1');
  assert.equal(att.imageUrl, 'data:image/jpeg;base64,OLD');
  assert.deepEqual(att.additionalImages, [{ url: 'data:image/jpeg;base64,X', caption: '' }]);
  assert.equal(att.lat, 41.15);
});

// ---- AI draft planning ------------------------------------------------------------------------
import {
  eventsNeedingDrafts, eventsPerRequest, planDraftBatches, draftCreditCost, applyDrafts,
} from '../src/utils/photoImport/aiDrafts.js';

const REGISTERED = { unlimited: false, draft_events_per_call: 12, draft_images_per_event: 3, draft_image_max_px: 384, events_per_credit: 12 };
const GUEST = { ...REGISTERED, draft_events_per_call: 8, draft_images_per_event: 2 };
const UNLIMITED = { unlimited: true, draft_events_per_call: 40, draft_images_per_event: 6, draft_image_max_px: 768, events_per_credit: 12 };

test('draft batches follow the plan and the payload cap', () => {
  assert.equal(eventsPerRequest(REGISTERED), 12);
  assert.equal(eventsPerRequest(GUEST), 8);
  // 6 sharp photos per event: the 10 MB payload cap, not the 40-event plan, sets the batch.
  const unlimitedSize = eventsPerRequest(UNLIMITED);
  assert.ok(unlimitedSize >= 10 && unlimitedSize < 40);
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  assert.deepEqual(planDraftBatches(ids, REGISTERED).map((b) => b.length), [12, 12, 6]);
});

test('draft credit cost: per batch for limited plans, zero when unlimited', () => {
  assert.equal(draftCreditCost(1, REGISTERED), 1);
  assert.equal(draftCreditCost(12, REGISTERED), 1);
  assert.equal(draftCreditCost(30, REGISTERED), 3);
  assert.equal(draftCreditCost(9, GUEST), 2);
  assert.equal(draftCreditCost(500, UNLIMITED), 0);
  assert.equal(draftCreditCost(0, REGISTERED), 0);
});

test('only included, new, unnamed events are drafted; drafts never overwrite the user', () => {
  const events = [
    { id: 'a', include: true, attachTo: '', titleSource: 'auto', title: '', note: '', noteSource: 'auto' },
    { id: 'b', include: true, attachTo: '', titleSource: 'user', title: 'Mine', note: 'my note', noteSource: 'user' },
    { id: 'c', include: false, attachTo: '', titleSource: 'auto' },
    { id: 'd', include: true, attachTo: 'wedding', titleSource: 'auto' },
  ];
  assert.deepEqual(eventsNeedingDrafts(events).map((e) => e.id), ['a']);
  assert.deepEqual(eventsNeedingDrafts(events, { includeNamed: true }).map((e) => e.id), ['a', 'b']);
  const out = applyDrafts(events, [
    { id: 'a', title: 'Sunset in Lisbon', description: 'Rooftops at dusk.' },
    { id: 'b', title: 'AI title', description: 'AI note' },
  ]);
  assert.equal(out[0].title, 'Sunset in Lisbon');
  assert.equal(out[0].titleSource, 'ai');
  assert.equal(out[0].note, 'Rooftops at dusk.');
  assert.equal(out[1].title, 'Mine');
  assert.equal(out[1].note, 'my note');
});

// ---- Real EXIF through the same exifr build + options the browser uses ------------------------
import { readFileSync } from 'node:fs';
import { EXIF_PARSE_OPTIONS } from '../src/utils/photoImport/photoFiles.js';

test('exifr lite + EXIF_PARSE_OPTIONS read date, offset and GPS from the fixture photos', async () => {
  const { default: exifr } = await import('exifr/dist/lite.esm.mjs');
  const read = async (name) => {
    const buf = readFileSync(new URL(`./e2e/fixtures/photos/${name}`, import.meta.url));
    const tags = await exifr.parse(buf, EXIF_PARSE_OPTIONS);
    return buildPhotoMeta({ id: name, name, tags }, { now: NOW });
  };
  const lisbon = await read('lisbon-1.jpg');
  assert.equal(lisbon.timeSource, 'exif');
  assert.deepEqual(lisbon.time.wall, { year: 2023, month: 5, day: 12, hour: 9, minute: 10, second: 0 });
  assert.equal(lisbon.time.offsetMin, 60);
  assert.ok(Math.abs(lisbon.lat - 38.7139) < 1e-3 && Math.abs(lisbon.lng + 9.1394) < 1e-3);
  const scan = await read('scan-no-date.jpg');
  assert.equal(scan.time, null);
  assert.equal(scan.lat, null);
});

// ---- Date detail --------------------------------------------------------------------------------
import { eventTimeDates, formatTimeRange, wallToDetailText } from '../src/utils/photoImport/importModel.js';

test('date detail: day / month / year rows, and exact times for "Day & time"', () => {
  const photos = [photo('2023-05-12T09:10', LISBON), photo('2023-05-12T11:40', LISBON)];
  const metas = byId(photos);
  const [ev] = createImportEvents(clusterPhotos(photos).clusters, metas);
  const rowsFor = (dateDetail) => eventsToMoments([ev], { lang: 'en', newRowId: () => 'r', dateDetail, metasById: metas });
  assert.equal(rowsFor('day').rows[0].date, 'May 12, 2023');
  assert.equal(rowsFor('month').rows[0].date, 'May 2023');
  assert.equal(rowsFor('year').rows[0].date, '2023');
  assert.equal(parseFuzzyDate(rowsFor('month').rows[0].date, { now: new Date(NOW) }).precision, 'month');
  const timed = rowsFor('time');
  assert.equal(timed.rows[0].date, 'May 12, 2023');
  assert.deepEqual(timed.plan[0].dates, {
    from: { year: 2023, month: 5, day: 12, hour: 9, minute: 10, precision: 'minute' },
    to: { year: 2023, month: 5, day: 12, hour: 11, minute: 40, precision: 'minute' },
  });
  assert.equal(formatTimeRange(ev.startWall, ev.endWall), '09:10–11:40');
  assert.equal(wallToDetailText(ev.startWall, 'year'), '2023');

  // Built + media applied: the article carries the times.
  const bp = getStoryBlueprint('custom');
  const { timeline } = buildStoryTimeline(bp, { ...emptyStoryAnswers(bp), title: 'x', moments: timed.rows }, { lang: 'en', now: new Date(NOW) });
  const [art] = applyPhotoMedia(timeline.articles, { [timed.plan[0].articleId]: { kind: 'new', cover: null, gallery: [], centroid: null, photoCount: 2, dates: timed.plan[0].dates } });
  assert.equal(art.from.hour, 9);
  assert.equal(art.to.minute, 40);
});

test('"Day & time" skips photos that only have a day (file names, typed dates)', () => {
  const onlyDay = buildPhotoMeta({ id: 'w', name: 'IMG-20230514-WA0001.jpg' }, { now: NOW });
  assert.equal(onlyDay.time.dateOnly, true);
  const [ev] = createImportEvents(clusterPhotos([onlyDay]).clusters, byId([onlyDay]));
  assert.equal(eventTimeDates(ev, byId([onlyDay])), null);
});

test('AI place guesses: confident ones fill "Where?", likely ones are suggested, never over a real place', () => {
  const base = { include: true, attachTo: '', titleSource: 'auto', title: '', note: '', noteSource: 'auto', place: null, placeText: '' };
  const events = [
    { ...base, id: 'a' }, { ...base, id: 'b' }, { ...base, id: 'c' },
    { ...base, id: 'd', place: { city: 'Porto' } }, { ...base, id: 'e', placeText: 'Grandma\'s house', placeSource: 'user' },
  ];
  const out = applyDrafts(events, [
    { id: 'a', title: 'Eiffel Tower', description: '', place_guess: 'Eiffel Tower, Paris, France', place_confidence: 'high' },
    { id: 'b', title: 'Market', description: '', place_guess: 'Mercado da Ribeira, Lisbon', place_confidence: 'medium' },
    { id: 'c', title: 'Beach', description: '', place_guess: 'Some beach', place_confidence: 'low' },
    { id: 'd', title: 'x', description: '', place_guess: 'Lisbon', place_confidence: 'high' },
    { id: 'e', title: 'x', description: '', place_guess: 'Rome', place_confidence: 'high' },
  ]);
  assert.equal(out[0].placeText, 'Eiffel Tower, Paris, France');
  assert.equal(out[0].placeSource, 'ai');
  assert.equal(out[1].placeText, '');
  assert.equal(out[1].placeSuggestion, 'Mercado da Ribeira, Lisbon');
  assert.equal(out[2].placeText, '');
  assert.ok(!out[2].placeSuggestion);
  assert.equal(out[3].placeText, '');
  assert.equal(out[4].placeText, 'Grandma\'s house');
});


// ---- Photo allocation ---------------------------------------------------------------------------
import { planPhotoAllocation, PHOTO_SIZES } from '../src/utils/photoImport/importModel.js';

const fakeEvents = (sizes) => sizes.map((n, i) => ({ id: `e${i}`, include: true, attachTo: '', photoIds: Array.from({ length: n }, (_, k) => `e${i}p${k}`) }));

test('allocation: every event gets a cover; extra photos go to bigger events first; "All" keeps all if room', () => {
  const evs = fakeEvents([30, 5, 1]);
  const roomy = planPhotoAllocation(evs, { maxPerEvent: Infinity, budgetChars: 100_000_000 });
  assert.equal(roomy.size, 'normal');
  assert.deepEqual([...roomy.counts.values()], [30, 5, 1]);
  assert.equal(roomy.coverless, 0);

  const capped = planPhotoAllocation(evs, { maxPerEvent: 4, budgetChars: 100_000_000 });
  assert.deepEqual([...capped.counts.values()], [4, 4, 1]);

  // Tight budget: covers for all, then one extra at a time, biggest first.
  const c = PHOTO_SIZES.normal.cover.chars;
  const g = PHOTO_SIZES.normal.gallery.chars;
  const tight = planPhotoAllocation(evs, { maxPerEvent: Infinity, budgetChars: 3 * c + 3 * g });
  assert.deepEqual([...tight.counts.values()], [3, 2, 1]);
  assert.ok(tight.chars <= 3 * c + 3 * g);
});

test('allocation never leaves an event out: photos shrink first, then the smallest events go bare', () => {
  const many = fakeEvents(Array.from({ length: 300 }, (_, i) => 1 + (i % 7)));
  const plan = planPhotoAllocation(many, { maxPerEvent: Infinity, budgetChars: 9_000_000 });
  assert.notEqual(plan.size, 'normal');
  assert.equal([...plan.counts.values()].filter((n) => n >= 1).length, 300);
  assert.equal(plan.coverless, 0);

  const huge = fakeEvents(Array.from({ length: 1000 }, () => 2));
  const full = planPhotoAllocation(huge, { maxPerEvent: Infinity, budgetChars: 9_000_000, existingChars: 1_000_000 });
  assert.equal(full.size, 'tiny');
  assert.ok(full.coverless > 0);
  assert.equal(full.counts.size, 1000); // still every event (some without a photo)
  assert.ok(full.chars <= 8_000_000);

  // Hosted storage: no budget at all.
  assert.equal(planPhotoAllocation(huge, { maxPerEvent: Infinity, budgetChars: Infinity }).photos, 2000);
});

test('hosted allocation: no size budget, limited by the photo quota', () => {
  const evs = fakeEvents([30, 5, 1]);
  const all = planPhotoAllocation(evs, { maxPerEvent: Infinity, budgetChars: Infinity, maxPhotos: Infinity });
  assert.equal(all.photos, 36);
  const quota = planPhotoAllocation(evs, { maxPerEvent: Infinity, budgetChars: Infinity, maxPhotos: 10 });
  assert.equal(quota.photos, 10);
  assert.deepEqual([...quota.counts.values()].map((n) => n >= 1), [true, true, true]);
});
