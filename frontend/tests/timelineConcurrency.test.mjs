// Batch 4A-1: save queue (B-04), three-way merge / AI diffs (B-04), chat undo (B-08), merged ids (B-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimelineSaveQueue,
  isStaleWriteError,
} from '../src/utils/saveQueue.js';
import { mergeTimelineThreeWay, applyAiResultToLatest, valuesEqual } from '../src/utils/timelineMerge.js';
import {
  createChatUndoEntry,
  undoableChatMessageId,
  restoreSnapshotMedia,
  isTimelineUnchangedSince,
  MEDIA_FROM_CURRENT,
} from '../src/utils/chatUndo.js';
import { resolveMergedLayerId, resolveMergedSaveId } from '../src/utils/mergedTimelineId.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const art = (id, title, extra = {}) => ({ id, title, from: { year: 2000 }, ...extra });
const tl = (articles, extra = {}) => ({ id: 'tl-1', title: 'T', updatedAt: 'v1', articles, ...extra });

const staleError = () => {
  const err = new Error('stale');
  err.status = 409;
  err.code = 'stale_write';
  return err;
};

// ---- save queue ------------------------------------------------------------------------------

test('save queue: one save in flight per timeline, queued saves coalesce to the latest state', async () => {
  const sends = [];
  const gates = [];
  const queue = createTimelineSaveQueue({
    send: (timeline, { baseUpdatedAt }) => {
      sends.push({ title: timeline.title, base: baseUpdatedAt });
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
    fetchLatest: async () => { throw new Error('unused'); },
    merge: (b, l) => l,
  });

  const p1 = queue.enqueue(tl([art('a', 'A')], { title: 'one' }));
  const p2 = queue.enqueue(tl([art('a', 'A')], { title: 'two' }));
  const p3 = queue.enqueue(tl([art('a', 'A')], { title: 'three' }));
  await flush();
  assert.equal(sends.length, 1, 'second save waits for the first');
  assert.equal(queue.isBusy('tl-1'), true);

  gates[0].resolve({ id: 'tl-1', title: 'one', updatedAt: 'v2' });
  assert.equal((await p1).updatedAt, 'v2');
  await flush();
  assert.deepEqual(sends.map((s) => s.title), ['one', 'three'], 'two was coalesced into three');
  assert.equal(sends[1].base, 'v2', 'the next save is based on the acknowledged version');

  gates[1].resolve({ id: 'tl-1', title: 'three', updatedAt: 'v3' });
  assert.equal((await p2).updatedAt, 'v3');
  assert.equal((await p3).updatedAt, 'v3');
  await flush();
  assert.equal(queue.isBusy('tl-1'), false);
});

test('save queue: different timelines save independently', async () => {
  const gates = new Map();
  const queue = createTimelineSaveQueue({
    send: (timeline) => {
      const gate = deferred();
      gates.set(timeline.id, gate);
      return gate.promise;
    },
    fetchLatest: async () => null,
    merge: (b, l) => l,
  });
  queue.enqueue({ id: 'a', updatedAt: 'x', articles: [] });
  queue.enqueue({ id: 'b', updatedAt: 'y', articles: [] });
  await flush();
  assert.deepEqual([...gates.keys()], ['a', 'b']);
});

test('save queue: a freshly loaded copy uses its own version, a known one the latest ack', async () => {
  const bases = [];
  let n = 0;
  const queue = createTimelineSaveQueue({
    send: async (timeline, { baseUpdatedAt }) => {
      bases.push(baseUpdatedAt);
      n += 1;
      return { ...timeline, updatedAt: `s${n}` };
    },
    fetchLatest: async () => null,
    merge: (b, l) => l,
  });
  await queue.enqueue(tl([], { updatedAt: 'loaded-1' }));
  await queue.enqueue(tl([], { updatedAt: 'loaded-1' })); // state object still carries the load version
  await queue.enqueue(tl([], { updatedAt: 'reloaded-9' })); // opened again elsewhere: a version never seen
  assert.deepEqual(bases, ['loaded-1', 's1', 'reloaded-9']);
  assert.equal(queue.baseVersionFor(tl([], { updatedAt: 'loaded-1' })), 's3');
});

test('save queue: 409 stale_write -> fetch latest -> three-way merge -> retry once', async () => {
  const base = tl([art('a', 'A'), art('b', 'B')], { updatedAt: 'v1' });
  const sends = [];
  const events = [];
  let first = true;
  const queue = createTimelineSaveQueue({
    send: async (timeline, { baseUpdatedAt }) => {
      sends.push({ timeline, base: baseUpdatedAt });
      if (first) {
        first = false;
        throw staleError();
      }
      return { ...timeline, updatedAt: 'v3' };
    },
    // Another tab renamed event b and saved v2.
    fetchLatest: async () => tl([art('a', 'A'), art('b', 'B (theirs)')], { updatedAt: 'v2' }),
    merge: (b, l, r) => mergeTimelineThreeWay(b, l, r),
    onEvent: (e) => events.push(e),
  });
  queue.noteServerState(base);

  const local = { ...base, articles: [art('a', 'A (mine)'), base.articles[1]] };
  const saved = await queue.enqueue(local);

  assert.equal(sends.length, 2);
  assert.equal(sends[0].base, 'v1');
  assert.equal(sends[1].base, 'v2');
  assert.deepEqual(sends[1].timeline.articles.map((a) => a.title), ['A (mine)', 'B (theirs)']);
  assert.equal(saved.updatedAt, 'v3');
  const merged = events.find((e) => e.type === 'merged');
  assert.ok(merged && merged.sent === local);
  assert.deepEqual(merged.merged.articles.map((a) => a.title), ['A (mine)', 'B (theirs)']);
  assert.equal(queue.baseVersionFor(merged.merged), 'v3');
});

test('save queue: a second failure reloads the latest server copy with a notice event', async () => {
  const events = [];
  const queue = createTimelineSaveQueue({
    send: async () => { throw staleError(); },
    fetchLatest: async () => tl([art('a', 'Server')], { updatedAt: 'v9' }),
    merge: (b, l) => l,
    onEvent: (e) => events.push(e),
  });
  await assert.rejects(queue.enqueue(tl([art('a', 'Mine')])), (err) => isStaleWriteError(err));
  const reloaded = events.find((e) => e.type === 'reloaded');
  assert.ok(reloaded);
  assert.equal(reloaded.latest.updatedAt, 'v9');
  assert.equal(queue.baseVersionFor(tl([])), 'v9');
});

test('save queue: 410 marks the timeline gone and refuses later saves', async () => {
  const events = [];
  let sends = 0;
  const queue = createTimelineSaveQueue({
    send: async () => {
      sends += 1;
      const err = new Error('gone');
      err.status = 410;
      throw err;
    },
    fetchLatest: async () => null,
    merge: (b, l) => l,
    onEvent: (e) => events.push(e),
  });
  await assert.rejects(queue.enqueue(tl([art('a', 'A')])));
  await assert.rejects(queue.enqueue(tl([art('a', 'A')])), (err) => err.status === 410);
  assert.equal(sends, 1);
  assert.ok(queue.isGone('tl-1'));
  assert.deepEqual(events.map((e) => e.type), ['gone']);
});

test('save queue: markDeleted refuses saves for a timeline deleted elsewhere', async () => {
  const queue = createTimelineSaveQueue({ send: async (t) => t, fetchLatest: async () => null, merge: (b, l) => l });
  queue.markDeleted('tl-1');
  await assert.rejects(queue.enqueue(tl([])), (err) => err.status === 410);
});

// ---- three-way merge -------------------------------------------------------------------------

test('merge: both sides edited different events -> both edits kept', () => {
  const base = tl([art('a', 'A'), art('b', 'B')]);
  const local = { ...base, articles: [art('a', 'A local'), base.articles[1]] };
  const remote = { ...base, updatedAt: 'v2', articles: [art('a', 'A'), art('b', 'B remote')] };
  const merged = mergeTimelineThreeWay(base, local, remote);
  assert.deepEqual(merged.articles.map((a) => a.title), ['A local', 'B remote']);
  assert.equal(merged.updatedAt, 'v2');
});

test('merge: same event edited on both sides -> field-level merge, conflicts go to `prefer`', () => {
  const base = tl([art('a', 'A', { subtitle: 's' })]);
  const local = { ...base, articles: [art('a', 'A local', { subtitle: 's' })] };
  const remote = { ...base, articles: [art('a', 'A remote', { subtitle: 's remote' })] };
  const localWins = mergeTimelineThreeWay(base, local, remote);
  assert.equal(localWins.articles[0].title, 'A local');
  assert.equal(localWins.articles[0].subtitle, 's remote', 'non-conflicting remote field change kept');
  const remoteWins = mergeTimelineThreeWay(base, local, remote, { prefer: 'remote' });
  assert.equal(remoteWins.articles[0].title, 'A remote');
});

test('merge: adds and removes on either side', () => {
  const base = tl([art('a', 'A'), art('b', 'B'), art('c', 'C')]);
  const local = { ...base, articles: [base.articles[0], base.articles[2], art('l', 'Local add')] }; // removed b
  const remote = { ...base, articles: [base.articles[0], base.articles[1], art('r', 'Remote add')] }; // removed c
  const merged = mergeTimelineThreeWay(base, local, remote);
  assert.deepEqual(merged.articles.map((a) => a.id).sort(), ['a', 'l', 'r']);
});

test('merge: an edit beats a delete on the other side (nothing silently dropped)', () => {
  const base = tl([art('a', 'A'), art('b', 'B')]);
  const local = { ...base, articles: [base.articles[0]] }; // deleted b
  const remote = { ...base, articles: [base.articles[0], art('b', 'B edited')] };
  assert.deepEqual(mergeTimelineThreeWay(base, local, remote).articles.map((a) => a.title), ['A', 'B edited']);
  assert.deepEqual(
    mergeTimelineThreeWay(base, local, remote, { localDeleteWins: true }).articles.map((a) => a.title),
    ['A'],
  );
});

test('merge: top-level fields and UI-only flags', () => {
  const base = tl([art('a', 'A')], { description: 'd' });
  const local = { ...base, title: 'Local title', isOwner: true };
  const remote = { ...base, description: 'Remote desc', updatedAt: 'v5', isOwner: false, persisted: true };
  const merged = mergeTimelineThreeWay(base, local, remote);
  assert.equal(merged.title, 'Local title');
  assert.equal(merged.description, 'Remote desc');
  assert.equal(merged.isOwner, true);
  assert.equal(merged.updatedAt, 'v5');
  assert.equal('persisted' in merged, false);
});

test('valuesEqual treats null, undefined and missing keys alike', () => {
  assert.ok(valuesEqual({ a: 1, b: null }, { a: 1 }));
  assert.ok(valuesEqual([{ x: undefined }], [{}]));
  assert.ok(!valuesEqual({ a: 1 }, { a: 2 }));
});

// ---- AI results as diffs ---------------------------------------------------------------------

test('AI diff: edits made while the job ran survive; AI changes / adds / removes are applied', () => {
  const snapshot = tl([art('a', 'A'), art('b', 'B'), art('c', 'C')]);
  // During the job the user edited c and set an image on a.
  const latest = {
    ...snapshot,
    articles: [art('a', 'A', { imageUrl: 'data:image/png;base64,xx' }), snapshot.articles[1], art('c', 'C (user)')],
  };
  // The AI renamed b and added d.
  const ai = {
    ...snapshot,
    updatedAt: 'v-ai',
    persisted: false,
    conflict: true,
    articles: [art('a', 'A'), art('b', 'B (ai)'), art('c', 'C'), art('d', 'D (ai)')],
  };
  const applied = applyAiResultToLatest(snapshot, latest, ai);
  assert.deepEqual(applied.articles.map((a) => a.title), ['A', 'B (ai)', 'C (user)', 'D (ai)']);
  assert.equal(applied.articles[0].imageUrl, 'data:image/png;base64,xx');
  assert.equal('conflict' in applied, false);
});

test('AI diff: AI deletes apply; a user delete during the job is not resurrected by the AI', () => {
  const snapshot = tl([art('a', 'A'), art('b', 'B'), art('c', 'C')]);
  const latest = { ...snapshot, articles: [snapshot.articles[0], snapshot.articles[1]] }; // user deleted c
  const ai = { ...snapshot, articles: [art('b', 'B'), art('c', 'C (ai touched)')] }; // AI deleted a
  const applied = applyAiResultToLatest(snapshot, latest, ai);
  assert.deepEqual(applied.articles.map((a) => a.id), ['b']);
});

test('AI diff: unchanged latest state takes the AI result as is', () => {
  const snapshot = tl([art('a', 'A')], { isOwner: true });
  const ai = { ...snapshot, isOwner: undefined, articles: [art('a', 'A2')], persisted: true };
  const applied = applyAiResultToLatest(snapshot, snapshot, ai);
  assert.equal(applied.articles[0].title, 'A2');
  assert.equal(applied.isOwner, true);
  assert.equal('persisted' in applied, false);
});

// ---- chat undo -------------------------------------------------------------------------------

test('chat undo: only the latest edit, and only while the timeline is unchanged since it', () => {
  const before = tl([art('a', 'A'), art('b', 'B')]);
  const after = { ...before, articles: [art('a', 'A'), art('b', 'B'), art('x', 'X')] };
  const entry = createChatUndoEntry({ messageId: 'a-2', timelineId: 'tl-1', before, after });

  assert.equal(undoableChatMessageId(entry, after), 'a-2');
  assert.equal(undoableChatMessageId(null, after), null, 'older edits have no entry once a newer one exists');

  // A cosmetic change (videos cached) doesn't block undo; a content change does.
  const withVideos = { ...after, articles: after.articles.map((a) => (a.id === 'b' ? { ...a, videos: [{ id: 'v' }], videosQuery: 'q' } : a)) };
  assert.equal(undoableChatMessageId(entry, withVideos), 'a-2');
  const edited = { ...after, title: 'Renamed' };
  assert.equal(undoableChatMessageId(entry, edited), null);
  const eventEdited = { ...after, articles: after.articles.map((a) => (a.id === 'a' ? { ...a, title: 'A!' } : a)) };
  assert.equal(isTimelineUnchangedSince(eventEdited, after), false);
  assert.equal(undoableChatMessageId(entry, { ...after, id: 'other' }), null);
});

test('chat undo: snapshots are stored without inline data: media and restored by event id', () => {
  const big = `data:image/jpeg;base64,${'A'.repeat(5000)}`;
  const gone = `data:image/jpeg;base64,${'B'.repeat(50)}`;
  const before = tl([
    art('a', 'A', { imageUrl: big, additionalImages: [{ url: big, caption: 'c' }] }),
    art('b', 'B', { imageUrl: 'https://example.com/b.jpg' }),
    art('c', 'C', { imageUrl: gone }),
  ], { quiz: [{ q: 1 }] });
  const after = { ...before, articles: [{ ...before.articles[0], title: 'A (ai)' }, before.articles[1]] }; // AI removed c
  const entry = createChatUndoEntry({ messageId: 'm', timelineId: 'tl-1', before, after });

  const serialized = JSON.stringify(entry.snapshot);
  assert.ok(!serialized.includes(big), 'kept media is not duplicated into the snapshot');
  assert.equal(entry.snapshot.articles[0].imageUrl, MEDIA_FROM_CURRENT);
  assert.equal(entry.snapshot.articles[1].imageUrl, 'https://example.com/b.jpg');
  assert.equal(entry.snapshot.articles[2].imageUrl, gone, 'media of an event the edit removed is kept');
  assert.equal('quiz' in entry.snapshot, false);
  assert.notEqual(entry.snapshot.articles[1], before.articles[1], 'events are copied, not shared');

  const restored = restoreSnapshotMedia(entry.snapshot, after);
  assert.deepEqual(restored.articles.map((a) => a.title), ['A', 'B', 'C']);
  assert.equal(restored.articles[0].imageUrl, big);
  assert.deepEqual(restored.articles[0].additionalImages, [{ url: big, caption: 'c' }]);
  assert.deepEqual(restored.quiz, [{ q: 1 }]);
  assert.equal('_keptFromCurrent' in restored, false);
});

// ---- merged timeline ids ---------------------------------------------------------------------

test('merged ids: re-layering keeps the id only for an unsaved merge or the user\'s own merged timeline', () => {
  assert.equal(resolveMergedLayerId({ id: 'u1', _unsavedMerged: true }), 'u1');
  assert.equal(resolveMergedLayerId({ id: 'own', creationSource: 'merged', isOwner: true }), 'own');
  assert.equal(resolveMergedLayerId({ id: 'theirs', creationSource: 'merged', isOwner: false }), undefined);
  assert.equal(resolveMergedLayerId({ id: 'single', creationSource: 'prompt', isOwner: true }), undefined);
  assert.equal(resolveMergedLayerId({ id: 'lib', creationSource: 'merged', isOwner: true, isLibrary: true }), undefined);
  assert.equal(resolveMergedLayerId({ id: 'lib', creationSource: 'merged', isOwner: true, isLibrary: true }, { allowLibrary: true }), 'lib');
  assert.equal(resolveMergedLayerId({ id: 'kept', _unsavedMerged: true, _mergedIdForeign: true }), undefined);
});

test('merged ids: Save mints a new id for someone else\'s merged timeline', () => {
  const mint = () => 'fresh';
  assert.equal(resolveMergedSaveId({ id: 'u1', _unsavedMerged: true }, mint), 'u1');
  assert.equal(resolveMergedSaveId({ id: 'theirs', _unsavedMerged: true, _mergedIdForeign: true }, mint), 'fresh');
  assert.equal(resolveMergedSaveId({ id: 'theirs', isOwner: false }, mint), 'fresh');
  assert.equal(resolveMergedSaveId({ id: 'own', isOwner: true }, mint), 'own');
  assert.match(resolveMergedSaveId({ id: 'theirs', isOwner: false }), /^[0-9a-f]{32}$/);
});
