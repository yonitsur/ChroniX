import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCoverCandidates, hasAdminCoverCandidates, pickActiveCover } from '../src/utils/libraryCover.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('non-admin card (no coverImageCandidates) falls back to [coverImageUrl]', () => {
  const item = { id: 'a', coverImageUrl: 'https://img/1.jpg' };
  const candidates = getCoverCandidates(item);
  assert.deepEqual(candidates, ['https://img/1.jpg']);
  assert.equal(pickActiveCover(item, candidates), 'https://img/1.jpg');
});

test('card without any cover shows the placeholder (null)', () => {
  for (const item of [{ id: 'a' }, { id: 'b', coverImageUrl: null }, { id: 'c', coverImageUrl: '  ' }]) {
    const candidates = getCoverCandidates(item);
    assert.deepEqual(candidates, []);
    assert.equal(pickActiveCover(item, candidates), null);
  }
});

test('a failed cover is hidden instead of retried', () => {
  const item = { id: 'a', coverImageUrl: 'https://img/broken.jpg' };
  const failed = new Set(['https://img/broken.jpg']);
  const candidates = getCoverCandidates(item, failed);
  assert.deepEqual(candidates, []);
  assert.equal(pickActiveCover(item, candidates, failed), null);
});

test('admin card keeps the full candidate list for cover cycling', () => {
  const item = {
    id: 'a',
    coverImageUrl: 'https://img/2.jpg',
    coverImageCandidates: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg', null, ''],
  };
  const candidates = getCoverCandidates(item);
  assert.deepEqual(candidates, ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg']);
  assert.equal(pickActiveCover(item, candidates), 'https://img/2.jpg');
  // The chosen cover failed: fall through to the next working candidate.
  const failed = new Set(['https://img/2.jpg', 'https://img/1.jpg']);
  const remaining = getCoverCandidates(item, failed);
  assert.equal(pickActiveCover(item, remaining, failed), 'https://img/3.jpg');
});

test('empty admin candidate list still falls back to coverImageUrl', () => {
  const item = { id: 'a', coverImageUrl: 'https://img/1.jpg', coverImageCandidates: [] };
  assert.deepEqual(getCoverCandidates(item), ['https://img/1.jpg']);
});

test('hasAdminCoverCandidates detects admin-shaped lists', () => {
  assert.equal(hasAdminCoverCandidates([{ coverImageUrl: 'x' }]), false);
  assert.equal(hasAdminCoverCandidates([{ coverImageUrl: 'x', coverImageCandidates: [] }]), true);
  assert.equal(hasAdminCoverCandidates(null), false);
});

test('fetchPublicLibrary attaches an existing account token without creating a guest session', () => {
  const apiSrc = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');
  const helperStart = apiSrc.indexOf('const getExistingAccountAuthHeaders = async () => {');
  assert.ok(helperStart >= 0);
  const helper = apiSrc.slice(helperStart, apiSrc.indexOf('export async function fetchHealth', helperStart));
  assert.ok(!helper.includes('signInAnonymously'), 'public library reads must not mint guest sessions');
  assert.match(helper, /is_anonymous/);
  assert.match(apiSrc, /fetch\(`\$\{API_BASE\}\/library\$\{suffix\}`, \{ headers: await getExistingAccountAuthHeaders\(\) \}\)/);

  const homeSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  assert.match(homeSrc, /getCoverCandidates\(item, failedUrls\)/);
  assert.match(homeSrc, /hasAdminCoverCandidates\(items\)/);
});
