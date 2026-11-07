// P-03: a generation's preview (timeline before images and links) is shown read-only while the
// job finishes, replaced by the final result, removed if the job fails, and never saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pollAiJobCore } from '../src/utils/aiJobPolling.js';
import { createTimelineSaveQueue, isPartialTimeline, PARTIAL_TIMELINE_CODE } from '../src/utils/saveQueue.js';
import { createPartialPreviewTracker, toPartialPreview } from '../src/utils/partialTimeline.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const reply = (body) => ({ ok: true, status: 200, json: async () => body });
const clock = { elapsed: () => 0, dispose() {} };

function poll(responses, { onPartial } = {}) {
  const seenRevs = [];
  const run = pollAiJobCore('job-1', {
    fetchStatus: async (_id, _signal, opts) => {
      seenRevs.push(opts?.partialRev ?? null);
      const next = responses.length > 1 ? responses.shift() : responses[0];
      return reply(next);
    },
    delay: async () => {},
    clock,
    onPartial,
  });
  return { run, seenRevs };
}

const partial = { id: 'tl-1', title: 'Apollo', isPartial: true, articles: [{ id: 'a1', title: 'Apollo 8' }] };
const final = { id: 'tl-1', title: 'Apollo', articles: [{ id: 'a1', title: 'Apollo 8', imageUrl: 'https://x/a.jpg' }] };

test('onPartial fires once per revision, then the done result is returned', async () => {
  const got = [];
  const { run, seenRevs } = poll([
    { status: 'pending' },
    { status: 'pending', partial_rev: 1, partial },
    { status: 'pending', partial_rev: 1 }, // server left the preview out: the client has it
    { status: 'pending', partial_rev: 1, partial }, // a repeated revision is ignored
    { status: 'done', result: final },
  ], { onPartial: (p) => got.push(p) });
  const result = await run;
  assert.deepEqual(result, final);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'tl-1');
  // The newest revision seen is sent back so the server can skip the payload.
  assert.deepEqual(seenRevs, [0, 0, 1, 1, 1]);
});

test('a final result that arrives first means no preview at all', async () => {
  const got = [];
  const { run } = poll([{ status: 'done', result: final }], { onPartial: (p) => got.push(p) });
  assert.deepEqual(await run, final);
  assert.equal(got.length, 0);
});

test('a job that fails after its preview still rejects (the caller drops the preview)', async () => {
  const got = [];
  const { run } = poll([
    { status: 'pending', partial_rev: 1, partial },
    { status: 'error', detail: 'Enrichment failed' },
  ], { onPartial: (p) => got.push(p) });
  await assert.rejects(run, /Enrichment failed/);
  assert.equal(got.length, 1);
});

test('a throwing onPartial callback never breaks polling; malformed previews are ignored', async () => {
  let calls = 0;
  const { run } = poll([
    { status: 'pending', partial_rev: 1, partial: { id: 'x' } }, // no articles array
    { status: 'pending', partial_rev: 2, partial },
    { status: 'done', result: final },
  ], { onPartial: () => { calls += 1; throw new Error('boom'); } });
  assert.deepEqual(await run, final);
  assert.equal(calls, 1);
});

test('the save queue never saves a preview', async () => {
  const sent = [];
  const queue = createTimelineSaveQueue({
    send: async (t) => { sent.push(t); return { ...t, updatedAt: 'v1' }; },
    fetchLatest: async () => null,
    merge: (_b, local) => local,
  });
  await assert.rejects(queue.enqueue({ ...final, isPartial: true }), (err) => err.code === PARTIAL_TIMELINE_CODE);
  await assert.rejects(queue.enqueue({ ...partial, id: undefined }), (err) => err.code === PARTIAL_TIMELINE_CODE);
  assert.equal(sent.length, 0);
  await queue.enqueue(final);
  assert.equal(sent.length, 1);
  assert.equal(isPartialTimeline(final), false);
});

function harness(initial = null, active = () => true) {
  const state = { current: initial, sets: [] };
  const tracker = createPartialPreviewTracker({
    getCurrent: () => state.current,
    setCurrent: (next, opts) => { state.current = next; state.sets.push({ next, opts }); },
    isActive: active,
  });
  return { state, tracker };
}

test('preview tracker: shows read-only preview, then the final result settles it', () => {
  const { state, tracker } = harness();
  const shown = tracker.show(partial);
  assert.equal(shown.isPartial, true);
  assert.equal(state.current.isPartial, true);
  assert.equal(tracker.isShowing(), true);
  assert.equal(tracker.shownId(), 'tl-1');
  tracker.show({ ...partial, title: 'Apollo (rev 2)' });
  assert.equal(state.sets.at(-1).opts.replacingOwnPreview, true); // same preview: keep the view
  tracker.finish();
  state.current = final; // App swaps in the final result
  assert.equal(tracker.show(partial), null, 'a late preview never replaces the final result');
  assert.equal(state.current, final);
  assert.equal(tracker.discard(), false, 'nothing to remove once the final result is open');
  assert.equal(state.current, final);
});

test('preview tracker: a failed or stopped job removes the preview and restores what was open', () => {
  const previous = { id: 'older', articles: [{ id: 'z' }] };
  const { state, tracker } = harness(previous);
  tracker.show(partial);
  assert.equal(tracker.discard(), true);
  assert.equal(state.current, previous);

  const second = harness(null);
  second.tracker.show(partial);
  second.tracker.discard();
  assert.equal(second.state.current, null);
});

test('preview tracker: ignores previews of a superseded generation and empty previews', () => {
  const { state, tracker } = harness(null, () => false);
  assert.equal(tracker.show(partial), null);
  assert.equal(state.current, null);
  assert.equal(toPartialPreview({ id: 'x', articles: [] }), null);
});

test('App wires previews into generation and keeps them read-only and unsaved', () => {
  const app = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');
  assert.match(app, /createPartialPreviewTracker/);
  assert.ok((app.match(/preview\.show,?\n/g) || []).length >= 2, 'generateTimeline / prompt-files get onPartial');
  // Documents go back to the Story Studio for review, so their generation shows no canvas preview.
  const docs = app.slice(app.indexOf('const handleGenerateFromDocuments = async'), app.indexOf('// Example cards only fill the search bar'));
  assert.ok(docs && !docs.includes('preview.show'), 'document generation returns to the Studio');
  assert.match(app, /isPartialTimeline\(prev\) \|\| targetId == null/, 'commitTimelineChange refuses a preview');
  assert.match(app, /isReadOnlyView = Boolean\(currentTimeline && \(currentTimeline\.isOwner === false \|\| isPartialPreview\)\)/);
  assert.match(app, /preview\.discard\(\)/);
  const api = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');
  // The poll URL is built by jobStatusQuery (partial_rev plus the long-poll params, SC-02).
  assert.match(api, /jobStatusQuery\(\{ partialRev, wait, position \}\)/);
  assert.match(api, /\n\s+onPartial,\n/);
});
