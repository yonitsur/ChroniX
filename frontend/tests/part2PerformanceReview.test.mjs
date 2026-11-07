import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHoveredArticleId,
  setHoveredArticleId,
  clearHoveredArticleId,
  subscribeHoveredArticleId,
} from '../src/utils/hoverSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');

test('hoverSync pub/sub notifies subscribers, deduplicates equivalent IDs, and unsubscribes cleanly', () => {
  clearHoveredArticleId();
  assert.equal(getHoveredArticleId(), null);

  const events = [];
  const unsubscribe = subscribeHoveredArticleId((id) => {
    events.push(id);
  });

  setHoveredArticleId('event-1');
  assert.equal(getHoveredArticleId(), 'event-1');
  assert.deepEqual(events, ['event-1']);

  // Duplicate hover IDs (including numeric/string equivalence) do not re-broadcast
  setHoveredArticleId('event-1');
  assert.deepEqual(events, ['event-1']);

  setHoveredArticleId(42);
  setHoveredArticleId('42');
  assert.deepEqual(events, ['event-1', 42]);

  // Faulty listener does not break healthy listeners
  const unsubBroken = subscribeHoveredArticleId(() => {
    throw new Error('listener boom');
  });
  setHoveredArticleId('event-2');
  assert.deepEqual(events, ['event-1', 42, 'event-2']);
  unsubBroken();

  clearHoveredArticleId();
  assert.equal(getHoveredArticleId(), null);
  assert.deepEqual(events, ['event-1', 42, 'event-2', null]);

  unsubscribe();
  setHoveredArticleId('event-3');
  assert.deepEqual(events, ['event-1', 42, 'event-2', null]);
  clearHoveredArticleId();
});

test('App.jsx delegates cross-hover state to hoverSync instead of root useState', () => {
  const appSource = fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'App.jsx'), 'utf8');
  assert.ok(
    !appSource.includes('const [hoveredArticleId, setHoveredArticleId] = useState'),
    'App.jsx must not keep hoveredArticleId in root useState'
  );
  assert.ok(
    appSource.includes("from './utils/hoverSync'"),
    'App.jsx should clear hover state via hoverSync on timeline reset'
  );

  const timelineSource = fs.readFileSync(
    path.join(FRONTEND_DIR, 'src', 'components', 'TimelineView.jsx'),
    'utf8'
  );
  const mapSource = fs.readFileSync(
    path.join(FRONTEND_DIR, 'src', 'components', 'GeoMapView.jsx'),
    'utf8'
  );
  assert.ok(timelineSource.includes('subscribeHoveredArticleId'));
  assert.ok(mapSource.includes('subscribeHoveredArticleId'));
});

test('public/ removes orphaned background assets and ships valid 1200x630 Open Graph preview under 300 KB', () => {
  const publicDir = path.join(FRONTEND_DIR, 'public');
  assert.equal(fs.existsSync(path.join(publicDir, 'mountains_bg.png')), false);
  assert.equal(fs.existsSync(path.join(publicDir, 'stars-bg.jpg')), false);

  const ogPath = path.join(publicDir, 'chronix_logo_full.png');
  assert.equal(fs.existsSync(ogPath), true, 'Expected frontend/public/chronix_logo_full.png to exist');

  const buf = fs.readFileSync(ogPath);
  // WhatsApp drops Open Graph preview images larger than 300 KB
  assert.ok(buf.byteLength > 1024 && buf.byteLength < 300 * 1024, `Unexpected OG image size: ${buf.byteLength}`);

  // Verify PNG magic signature + IHDR 1200x630 dimensions
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buf.subarray(0, 8), pngSig);
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(width, 1200);
  assert.equal(height, 630);
});
