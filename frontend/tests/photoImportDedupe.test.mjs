import test from 'node:test';
import assert from 'node:assert/strict';
import { dropDuplicatePhotos, normalizePhotoName } from '../src/utils/photoImport/dedupe.js';
import { buildPhotoMeta } from '../src/utils/photoImport/photoMeta.js';

const NOW = Date.UTC(2026, 10, 5);
const m = (id, name, when, size = 0) => buildPhotoMeta({ id, name, size, tags: when ? { DateTimeOriginal: when } : null }, { now: NOW });

test('normalizePhotoName', () => {
  assert.equal(normalizePhotoName('Takeout/Photos from 2023/IMG_1234(1)-edited.JPG'), 'img_1234');
  assert.equal(normalizePhotoName('IMG_1234-edited(2).jpg'), 'img_1234');
  assert.equal(normalizePhotoName('IMG_1234.HEIC'), 'img_1234');
});

test('the same photo from Takeout album + year folder, an album download, or Google Photos is kept once', () => {
  const existing = [m('a', 'IMG_1.jpg', '2023:05:14 10:00:00', 2_000_000)];
  const incoming = [
    m('b', 'IMG_1.jpg', '2023:05:14 10:00:00', 2_000_000),      // Takeout: same photo, other folder
    m('c', 'IMG_1(1).jpg', '2023:05:14 10:00:00', 2_000_000),   // "(1)" copy
    m('d', 'IMG_1.JPG', '2023:05:14 10:00:00', 0),              // Google Photos pick (no size)
    m('e', 'renamed.jpg', '2023:05:14 10:00:00', 2_000_000),    // same bytes, different name
    m('f', 'IMG_2.jpg', '2023:05:14 10:00:00', 1_500_000),      // burst shot, same second: kept
    m('g', 'IMG_2.jpg', '2023:05:14 10:00:00', 1_500_000),      // duplicate within the batch
    m('h', 'IMG_1.jpg', '2023:05:15 10:00:00', 2_000_000),      // another day: kept
  ];
  const { keep, duplicateIds } = dropDuplicatePhotos(existing, incoming);
  assert.deepEqual(keep.map((x) => x.id), ['f', 'h']);
  assert.deepEqual(duplicateIds, ['b', 'c', 'd', 'e', 'g']);
});

test('undated photos are duplicates only on exact name + size', () => {
  const { keep } = dropDuplicatePhotos([m('a', 'scan.jpg', null, 500)], [m('b', 'scan.jpg', null, 500), m('c', 'scan.jpg', null, 600), m('d', 'scan.jpg', null, 0)]);
  assert.deepEqual(keep.map((x) => x.id), ['c', 'd']);
});
