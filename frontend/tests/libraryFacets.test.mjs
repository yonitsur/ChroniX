import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeFacetLanguage,
  sanitizeLibraryFacets,
  buildLibraryFacets,
  summarizeLibraryFacets,
  readStoredLibraryFacets,
  writeStoredLibraryFacets,
} from '../src/utils/libraryStages.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

const GROUPS = [
  { language: 'en', contentMode: 'classic', total: 10, categories: { history: 6, space: 4, arts: 1 } },
  { language: 'he', contentMode: 'classic', total: 5, categories: { history: 5, personal: 2 } },
  { language: 'en', contentMode: 'kids', total: 3, categories: { nature: 3 } },
];

test('server languages fold into the he/en filter like card titles do', () => {
  assert.equal(normalizeFacetLanguage('he'), 'he');
  assert.equal(normalizeFacetLanguage('ar'), 'he');
  assert.equal(normalizeFacetLanguage('ru'), 'en');
  assert.equal(normalizeFacetLanguage(undefined), 'en');
});

test('sanitize drops malformed groups and counts, null when nothing usable', () => {
  assert.equal(sanitizeLibraryFacets(null), null);
  assert.equal(sanitizeLibraryFacets([{ total: 0, categories: {} }, 'x']), null);
  const out = sanitizeLibraryFacets([
    { language: 'ar', contentMode: 'weird', total: '4', categories: { history: 2, bad: -1, nan: 'x' } },
  ]);
  assert.deepEqual(out, [{ language: 'he', contentMode: 'classic', total: 4, categories: { history: 2 } }]);
});

test('summary follows the lang/mode filter for counts, the safe pool for presence', () => {
  const en = summarizeLibraryFacets(GROUPS, { lang: 'en', mode: 'classic' });
  assert.equal(en.total, 10);
  assert.equal(en.counts.get('space'), 4);
  assert.equal(en.counts.get('personal'), undefined);
  assert.ok(en.present.has('personal') && en.present.has('nature'));

  const all = summarizeLibraryFacets(GROUPS, { lang: 'all', mode: 'all' });
  assert.equal(all.total, 18);
  assert.equal(all.counts.get('history'), 11);

  const kids = summarizeLibraryFacets(GROUPS, { lang: 'en', mode: 'kids', kidsOnly: true });
  assert.equal(kids.total, 3);
  assert.deepEqual([...kids.present], ['nature']);
});

test('built facets count multi-category cards once per category and once in the total', () => {
  const items = [
    { language: 'en', contentMode: 'classic', categoryKeys: ['history', 'space', 'history'] },
    { language: 'he', contentMode: 'kids', categoryKeys: [] },
  ];
  const groups = buildLibraryFacets(items, (it) => it.language, (it) => (it.categoryKeys.length ? it.categoryKeys : ['history']));
  assert.deepEqual(groups, [
    { language: 'en', contentMode: 'classic', total: 1, categories: { history: 1, space: 1 } },
    { language: 'he', contentMode: 'kids', total: 1, categories: { history: 1 } },
  ]);
});

test('stored facets round-trip, expire, and survive broken storage', () => {
  const storage = memoryStorage();
  writeStoredLibraryFacets(GROUPS, storage, 1000);
  assert.deepEqual(readStoredLibraryFacets(storage, 2000), GROUPS);
  assert.equal(readStoredLibraryFacets(storage, 1000 + 15 * 24 * 3600 * 1000), null);
  storage.setItem('chronix.libraryFacets.v1', '{not json');
  assert.equal(readStoredLibraryFacets(storage), null);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readStoredLibraryFacets(throwing), null);
  assert.doesNotThrow(() => writeStoredLibraryFacets(GROUPS, throwing));
});

test('Home Library uses facets for the category row and gates unloaded categories', () => {
  const src = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  assert.match(src, /sanitizeLibraryFacets\(firstRes\?\.facets\)/);
  assert.match(src, /writeStoredLibraryFacets\(buildLibraryFacets\(list,/);
  assert.match(src, /disabled=\{isCatPending\}/);
  assert.match(src, /isInitialLoading && !facetSummary \?/);
});
