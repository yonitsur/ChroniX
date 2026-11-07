import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureKidsFonts, KIDS_FONTS_ID } from '../src/utils/kidsFonts.js';

function fakeDocument() {
  const nodes = [];
  return {
    nodes,
    head: { appendChild: (n) => nodes.push(n) },
    createElement: (tag) => ({ tag }),
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
  };
}

test('ensureKidsFonts adds the Kids-mode stylesheet once', () => {
  const doc = fakeDocument();
  assert.equal(ensureKidsFonts(doc), true);
  assert.equal(ensureKidsFonts(doc), false);
  assert.equal(doc.nodes.length, 1);
  assert.equal(doc.nodes[0].id, KIDS_FONTS_ID);
  assert.equal(doc.nodes[0].rel, 'stylesheet');
  assert.match(doc.nodes[0].href, /Fredoka/);
  assert.match(doc.nodes[0].href, /Rubik/);
});

test('ensureKidsFonts is a no-op without a document', () => {
  assert.equal(ensureKidsFonts(null), false);
});
