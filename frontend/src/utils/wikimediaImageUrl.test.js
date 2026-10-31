import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_THUMB_WIDTH,
  DRAWER_IMAGE_WIDTH,
  LIGHTBOX_IMAGE_WIDTH,
  extractWikimediaThumbFilename,
  getCanvasImageCandidates,
  getCanvasImageUrl,
  getDrawerImageCandidates,
  getDrawerImageUrl,
  getLightboxImageCandidates,
  getLightboxImageUrl,
  getWikimediaOriginalUrl,
  normalizeAnimatedMediaUrl,
} from './wikimediaImageUrl.js';

test('upscales legacy 320px/400px Wikimedia thumbnails for drawer and lightbox', () => {
  const legacyMap =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/330px-Pelop_war_en.png';

  assert.equal(
    getDrawerImageUrl(legacyMap),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/${DRAWER_IMAGE_WIDTH}px-Pelop_war_en.png`
  );
  assert.equal(
    getLightboxImageUrl(legacyMap),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/${LIGHTBOX_IMAGE_WIDTH}px-Pelop_war_en.png`
  );
  // Canvas keeps legacy <=500px URL as-is (never upscales on canvas)
  assert.equal(getCanvasImageUrl(legacyMap), legacyMap);
});

test('downscales 1280px backend thumbnails to 500px for canvas while keeping 1280px for drawer', () => {
  const hiResThumb =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/1280px-Pelop_war_en.png?utm_source=en.wikipedia.org';

  assert.equal(
    getCanvasImageUrl(hiResThumb),
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/${CANVAS_THUMB_WIDTH}px-Pelop_war_en.png?utm_source=en.wikipedia.org`
  );
  assert.equal(getDrawerImageUrl(hiResThumb), hiResThumb);
  assert.equal(
    getLightboxImageUrl(hiResThumb),
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Pelop_war_en.png/${LIGHTBOX_IMAGE_WIDTH}px-Pelop_war_en.png?utm_source=en.wikipedia.org`
  );
});

test('preserves localized SVG and multipage prefixes when resizing thumbnails', () => {
  const localizedSvg =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Map_Peloponnesian_War_431_BC-en.svg/langhe-330px-Map_Peloponnesian_War_431_BC-en.svg.png';
  assert.equal(
    getDrawerImageUrl(localizedSvg),
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Map_Peloponnesian_War_431_BC-en.svg/langhe-${DRAWER_IMAGE_WIDTH}px-Map_Peloponnesian_War_431_BC-en.svg.png`
  );
  assert.equal(extractWikimediaThumbFilename(localizedSvg), 'Map_Peloponnesian_War_431_BC-en.svg');

  const lossyTiff =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-400px-Scan.tif.jpg';
  assert.equal(
    getDrawerImageUrl(lossyTiff),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-${DRAWER_IMAGE_WIDTH}px-Scan.tif.jpg`
  );
  // Raw .tif is not web-safe for direct <img> fallback
  assert.equal(getWikimediaOriginalUrl(lossyTiff), null);
});

test('strips /thumb/ from animated GIFs across all tiers', () => {
  const gifThumb =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Orbit.gif/400px-Orbit.gif?foo=1';
  const expected = 'https://upload.wikimedia.org/wikipedia/commons/1/12/Orbit.gif';
  assert.equal(normalizeAnimatedMediaUrl(gifThumb), expected);
  assert.equal(getCanvasImageUrl(gifThumb), expected);
  assert.equal(getDrawerImageUrl(gifThumb), expected);
  assert.equal(getLightboxImageUrl(gifThumb), expected);
});

test('builds ordered fallback candidates for drawer and lightbox', () => {
  const thumb =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/400px-Photo.jpg';
  assert.deepEqual(getDrawerImageCandidates(thumb), [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/1280px-Photo.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/e/e3/Photo.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/400px-Photo.jpg',
  ]);
  assert.deepEqual(getLightboxImageCandidates(thumb), [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/1920px-Photo.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/e/e3/Photo.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/1280px-Photo.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Photo.jpg/400px-Photo.jpg',
  ]);
});

test('builds ordered fallback candidates for canvas starting at 500px then warm 1280px then original', () => {
  const backendThumb =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Poll_chart.svg/1280px-Poll_chart.svg.png';
  assert.deepEqual(getCanvasImageCandidates(backendThumb), [
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Poll_chart.svg/500px-Poll_chart.svg.png',
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Poll_chart.svg/1280px-Poll_chart.svg.png',
    'https://upload.wikimedia.org/wikipedia/commons/5/57/Poll_chart.svg',
  ]);

  const lossyTiff =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-1280px-Scan.tif.jpg';
  assert.deepEqual(getCanvasImageCandidates(lossyTiff), [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-500px-Scan.tif.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Scan.tif/lossy-page1-1280px-Scan.tif.jpg',
  ]);

  const gifThumb =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Orbit.gif/400px-Orbit.gif';
  assert.deepEqual(getCanvasImageCandidates(gifThumb), [
    'https://upload.wikimedia.org/wikipedia/commons/1/12/Orbit.gif',
  ]);

  assert.deepEqual(getCanvasImageCandidates('https://example.com/photo.png'), [
    'https://example.com/photo.png',
  ]);
  assert.deepEqual(getCanvasImageCandidates(''), []);
});
