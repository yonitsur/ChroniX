// B-25: Takeout sidecar matching (exact, then extension-less exact, then the longest truncated prefix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { matchTakeoutSidecars, isSidecarName, looksLikeImage } from '../src/utils/photoImport/takeout.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = 'Takeout/Google Photos/Weekend in Porto';
const D = 'Takeout/Google Photos/Trip';
const p = (name, dir = D) => ({ path: `${dir}/${name}` });

test('the e2e Takeout fixture folder matches every photo to its own sidecar', () => {
  const names = readdirSync(path.join(here, 'e2e', 'fixtures', 'takeout', ...FIXTURE_DIR.split('/')));
  const images = names.filter(looksLikeImage).map((n) => p(n, FIXTURE_DIR));
  const sidecars = names.filter(isSidecarName).map((n) => p(n, FIXTURE_DIR));
  const m = matchTakeoutSidecars(images, sidecars);
  const at = (n) => m.get(`${FIXTURE_DIR}/${n}`);
  assert.equal(at('DSC_0101.jpg'), `${FIXTURE_DIR}/DSC_0101.jpg.json`);
  assert.equal(at('DSC_0101(1).jpg'), `${FIXTURE_DIR}/DSC_0101.jpg(1).json`);
  assert.equal(at('DSC_0102.jpg'), `${FIXTURE_DIR}/DSC_0102.jpg.supplemental-metadata.json`);
  assert.equal(
    at('DSC_0103_a_rather_long_file_name_from_an_app.jpg'),
    `${FIXTURE_DIR}/DSC_0103_a_rather_long_file_name_from_an_app.jpg.supplemen.json`,
  );
  assert.equal([...m.values()].includes(`${FIXTURE_DIR}/metadata.json`), false);
});

test('IMG_12345.jpg never takes IMG_1234.json (extension-less exact beats prefix)', () => {
  const m = matchTakeoutSidecars(
    [p('IMG_1234.jpg'), p('IMG_12345.jpg')],
    [p('IMG_1234.json'), p('IMG_12345.json')],
  );
  assert.equal(m.get(`${D}/IMG_1234.jpg`), `${D}/IMG_1234.json`);
  assert.equal(m.get(`${D}/IMG_12345.jpg`), `${D}/IMG_12345.json`);
});

test('a short sidecar that is only a prefix of another photo name is not a match', () => {
  const m = matchTakeoutSidecars([p('IMG_12345.jpg')], [p('IMG_1234.json'), p('IMG_1234.jpg.json')]);
  assert.equal(m.has(`${D}/IMG_12345.jpg`), false);
});

test('the edited copy of a duplicate uses the duplicate\'s sidecar', () => {
  const sidecars = [p('IMG_1234.jpg.json'), p('IMG_1234.jpg(1).json')];
  const m = matchTakeoutSidecars([p('IMG_1234(1)-edited.jpg'), p('IMG_1234-edited.jpg')], sidecars);
  assert.equal(m.get(`${D}/IMG_1234(1)-edited.jpg`), `${D}/IMG_1234.jpg(1).json`);
  assert.equal(m.get(`${D}/IMG_1234-edited.jpg`), `${D}/IMG_1234.jpg.json`);
});

test('the longest truncated prefix wins', () => {
  const long = 'PXL_20230812_101112345_a_rather_long_camera_name';
  const m = matchTakeoutSidecars(
    [p(`${long}.jpg`)],
    [p(`${long.slice(0, 30)}.supplemental-metadata.json`), p(`${long}.jp.supplemental-meta.json`)],
  );
  assert.equal(m.get(`${D}/${long}.jpg`), `${D}/${long}.jp.supplemental-meta.json`);
});

test('matching thousands of photos stays fast', () => {
  const images = [];
  const sidecars = [];
  for (let i = 0; i < 5000; i += 1) {
    images.push(p(`IMG_${i}.jpg`));
    sidecars.push(p(`IMG_${i}.jpg.supplemental-metadata.json`));
  }
  const t0 = Date.now();
  const m = matchTakeoutSidecars(images, sidecars);
  assert.equal(m.size, 5000);
  assert.ok(Date.now() - t0 < 1000);
});
