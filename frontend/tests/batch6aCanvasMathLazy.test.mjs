import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureCanvasMathReady,
  getCanvasMathLayout,
  getCanvasMathVersion,
  isCanvasMathReady,
  subscribeCanvasMath,
} from '../src/utils/canvasMath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('canvasMath.js does not import KaTeX statically', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'canvasMath.js'), 'utf8');
  assert.ok(!/^\s*import\s+katex\b/m.test(source), 'KaTeX must be loaded with import()');
  assert.ok(source.includes("import('katex')"));
});

test('KaTeX loads on demand, then subscribers are told to redraw', async () => {
  assert.equal(isCanvasMathReady(), false);
  // Without a DOM there is nothing to typeset into: plain-text fallback, no load needed.
  assert.equal(getCanvasMathLayout('x^2', 13), null);

  const versionBefore = getCanvasMathVersion();
  let notified = 0;
  const unsubscribe = subscribeCanvasMath(() => { notified += 1; });
  const first = ensureCanvasMathReady();
  const second = ensureCanvasMathReady();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(isCanvasMathReady(), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(notified, 1, 'one redraw notification once KaTeX arrived');
  assert.equal(getCanvasMathVersion(), versionBefore + 1);
  unsubscribe();
  assert.equal(await ensureCanvasMathReady(), true);
});
