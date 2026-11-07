// Batch 4A-2: AI edge cases on the client.
// B-04 (edit panel / Story Studio diffs, generation versions), B-09 (job-based file routes),
// B-16 (Stop during a save), B-18 (empty timelines), B-21 (error text, ?prompt= length), B-23 (Library Stage 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyEditToLatest } from '../src/utils/timelineMerge.js';
import { wouldLeaveTimelineEmpty, deleteEvents, updateTimelineMeta } from '../src/utils/timelineEditing.js';
import { createTimelineSaveQueue, isEmptyTimelineError, EMPTY_TIMELINE_CODE } from '../src/utils/saveQueue.js';
import {
  clampPromptText,
  formatApiError,
  PROMPT_MAX_LENGTH,
  savedTimelineFromCancel,
  pollAiJobCore,
} from '../src/utils/aiJobPolling.js';
import { shouldIgnoreEmptyLibraryStage2 } from '../src/utils/libraryStages.js';
import { isByokRoute } from '../src/utils/byokRoutes.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

const art = (id, title, extra = {}) => ({ id, title, from: { year: 2000 }, ...extra });
const tl = (articles, extra = {}) => ({ id: 'tl-1', title: 'T', updatedAt: 'v1', articles, ...extra });

// ---- B-04 follow-up (b): editor results are applied as a diff ------------------------------

test('edit panel result keeps an AI image that landed while the panel was open', () => {
  const base = tl([art('a', 'A'), art('b', 'B')]);
  const latest = { ...tl([art('a', 'A', { imageUrl: 'https://img/ai.png', imageSource: 'ai' }), art('b', 'B')]), updatedAt: 'v2' };
  const edited = updateTimelineMeta(base, { title: 'Renamed' });

  const next = applyEditToLatest(base, latest, edited);

  assert.equal(next.title, 'Renamed');
  assert.equal(next.articles.find((a) => a.id === 'a').imageUrl, 'https://img/ai.png');
  assert.equal(next.updatedAt, 'v2');
});

test('edit panel wins a real conflict, and its deletes stay deleted even if touched meanwhile', () => {
  const base = tl([art('a', 'A'), art('b', 'B'), art('c', 'C')]);
  const latest = tl([art('a', 'A', { imageUrl: 'https://img/new.png' }), art('b', 'B (remote)'), art('c', 'C'), art('d', 'Added elsewhere')]);
  const edited = { ...deleteEvents(base, ['a']), articles: deleteEvents(base, ['a']).articles.map((x) => (x.id === 'b' ? { ...x, title: 'B (panel)' } : x)) };

  const next = applyEditToLatest(base, latest, edited, { removedIds: ['a'] });

  const ids = next.articles.map((x) => x.id);
  assert.deepEqual(ids.sort(), ['b', 'c', 'd']);
  assert.equal(next.articles.find((x) => x.id === 'b').title, 'B (panel)');
});

test('with nothing changed since the editor opened, its result is used as-is', () => {
  const base = tl([art('a', 'A')]);
  const edited = updateTimelineMeta(base, { title: 'X' });
  assert.equal(applyEditToLatest(base, base, edited), edited);
  assert.equal(applyEditToLatest(null, base, edited), edited);
  // Another timeline is open: never merge across ids.
  assert.equal(applyEditToLatest(base, { ...base, id: 'other' }, edited), edited);
});

test('App applies edit-panel and Story Studio results against their opening copy', () => {
  const app = read('App.jsx');
  assert.match(app, /applyEditToLatest\(meta\.base \|\| null, prev, nextTimeline/);
  assert.match(app, /onApply=\{\(next, meta\) => handleApplyTimelineEdit\(next, \{ \.\.\.meta, base: currentTimeline \}\)\}/);
  assert.match(app, /const base = storyStudioEditTimeline;[\s\S]{0,200}handleApplyTimelineEdit\(next, \{ \.\.\.meta, base \}\)/);
});

// ---- B-18: empty timelines ------------------------------------------------------------------

test('removing the last event is detected before saving', () => {
  const one = tl([art('a', 'A')]);
  assert.equal(wouldLeaveTimelineEmpty(one, ['a']), true);
  assert.equal(wouldLeaveTimelineEmpty(tl([art('a', 'A'), art(2, 'B')]), ['a']), false);
  assert.equal(wouldLeaveTimelineEmpty(tl([art('a', 'A'), art(2, 'B')]), ['a', '2']), true);
  assert.equal(wouldLeaveTimelineEmpty(tl([]), ['a']), false);
});

test('a 422 empty_timeline save is surfaced to the caller, not merged or retried', async () => {
  let fetched = 0;
  const queue = createTimelineSaveQueue({
    send: async () => {
      const err = new Error('A timeline needs at least one event.');
      err.status = 422;
      err.code = EMPTY_TIMELINE_CODE;
      throw err;
    },
    fetchLatest: async () => { fetched += 1; return null; },
    merge: (b, l) => l,
  });
  await assert.rejects(queue.enqueue(tl([])), (err) => isEmptyTimelineError(err));
  assert.equal(fetched, 0);
  assert.equal(isEmptyTimelineError({ status: 422, body: { code: 'empty_timeline' } }), true);
  assert.equal(isEmptyTimelineError({ status: 422, code: 'other' }), false);
});

test('App offers deleting the timeline instead of saving it empty', () => {
  const app = read('App.jsx');
  assert.match(app, /wouldLeaveTimelineEmpty\(currentTimelineStateRef\.current \|\| currentTimeline, \[articleId\]\)/);
  assert.match(app, /nextTimeline\.articles\.length === 0\) \{[\s\S]{0,200}offerDeleteEmptyTimeline\(\)/);
  assert.match(app, /isEmptyTimelineError\(err\)\) setErrorMessage\(t\('app\.emptyTimelineNotSaved'\)\)/);
  for (const locale of ['locales/en.js', 'locales/he.js']) {
    const src = read(locale);
    assert.match(src, /"deleteLastEventConfirm":/);
    assert.match(src, /"emptyTimelineNotSaved":/);
  }
});

// ---- B-21: readable errors and the ?prompt= length --------------------------------------------

test('FastAPI 422 details never render as [object Object]', () => {
  const detail = [{ loc: ['body', 'articles', 3, 'title'], msg: 'String should have at most 600 characters' }];
  assert.equal(formatApiError(detail, 'x'), 'articles.3.title: String should have at most 600 characters');
  assert.equal(formatApiError({ code: 'insufficient_info', message: 'No facts' }, 'x'), 'No facts');
  assert.equal(formatApiError({ code: 'z' }, 'fallback'), 'fallback');
});

test('api.js formats every error detail through formatApiError', () => {
  const api = read('api.js');
  assert.ok(!/\.detail \|\|/.test(api), 'no raw `detail ||` error messages left');
  assert.ok(!/typeof err\.detail === 'string'/.test(api));
  const helper = api.slice(api.indexOf('async function apiErrorFromResponse'), api.indexOf('export async function fetchHealth'));
  assert.match(helper, /formatApiError\(data\?\.detail, fallback\)/);
  assert.match(helper, /err\.status = res\.status/);
  // podcast, photo, story, polish, suggest, saves and fetches all use it
  for (const fallback of [
    'errorFallback', 'Failed to download podcast', 'Photo upload failed', 'Failed to draft the overview',
    'Failed to polish text', 'Failed to suggest event details', 'Failed to save timeline', 'Failed to load timeline',
    'Failed to draft photo events', 'Google Photos request failed', 'Failed to generate AI image for this event',
  ]) {
    assert.ok(api.includes(`apiErrorFromResponse(res, ${fallback === 'errorFallback' ? fallback : `'${fallback}'`})`), fallback);
  }
});

test('a ?prompt= link is cut to the PromptBar limit', () => {
  assert.equal(PROMPT_MAX_LENGTH, 3000);
  assert.equal(clampPromptText('x'.repeat(5000)).length, 3000);
  assert.equal(clampPromptText('short'), 'short');
  assert.equal(clampPromptText(null), '');
  assert.match(read('components/PromptBar.jsx'), /maxLength=\{3000\}/);
  assert.match(read('App.jsx'), /const promptParam = clampPromptText\(params\.get\('prompt'\) \|\| ''\)/);
});

// ---- B-09: file flows are jobs; Stop cancels them ---------------------------------------------

test('file generation and chat attach start a job and poll it', () => {
  const api = read('api.js');
  const files = api.slice(api.indexOf('export async function generateTimelineFromFiles'), api.indexOf('export async function generateTimelineFromPromptFiles'));
  assert.match(files, /'\/timeline\/generate-from-files\/start'/);
  assert.ok(!files.includes('`${API_BASE}/timeline/generate-from-files`'));
  const attach = api.slice(api.indexOf('export async function chatAttachFilesToTimeline'), api.indexOf('export async function fetchTimelines'));
  assert.match(attach, /'\/timeline\/chat\/attach-files\/start'/);
  assert.match(attach, /recoverResult: recoverAsChatEdit/);
  assert.match(attach, /onJobStarted/);
  // The BYOK key still reaches the new route (and the legacy one).
  assert.equal(isByokRoute('POST', '/api/timeline/chat/attach-files/start', '/api'), true);
  assert.equal(isByokRoute('POST', '/api/timeline/chat/attach-files', '/api'), true);
});

test('App wires the attach job into the chat Stop button and aborts file generation on unmount', () => {
  const app = read('App.jsx');
  const send = app.slice(app.indexOf('const handleChatSendFiles = async'), app.indexOf('// Only the latest edit is undoable'));
  assert.match(send, /chatAttachFilesToTimeline\([\s\S]*\(jobId\) => \{\s*activeChatJobIdRef\.current = jobId;/);
  const stop = app.slice(app.indexOf('const handleChatStop = useCallback'), app.indexOf('const handleChatSend = async'));
  assert.match(stop, /await cancelAiJob\(jobId\)/);
  assert.match(stop, /applyResultSavedDespiteStop\(snapshot, cancelResponse\)/);
  const files = app.slice(app.indexOf('const handleGenerateFromDocuments = async'), app.indexOf('// Example cards only fill the search bar'));
  assert.match(files, /generateTimelineFromFiles\(files, contextText, rawText, controller\.signal, contentMode, \(\) =>/);
  assert.match(app, /filesAbortControllerRef\.current\?\.abort\(\);\n    \};\n  \}, \[\]\);/);
});

// ---- B-16: a Stop that lands mid-save reports the saved timeline ------------------------------

test('a cancel response for a saved timeline is recognised', () => {
  assert.deepEqual(savedTimelineFromCancel({ status: 'done', timeline_id: 'tl-1', persisted: true }, 'tl-1'), { timelineId: 'tl-1' });
  assert.equal(savedTimelineFromCancel({ status: 'cancelled', timeline_id: 'tl-1', persisted: false }, 'tl-1'), null);
  assert.equal(savedTimelineFromCancel({ status: 'done', timeline_id: 'tl-2', persisted: true }, 'tl-1'), null);
  assert.equal(savedTimelineFromCancel(null), null);
});

// ---- B-04 follow-up (a): a generation result's version becomes the first save's base --------

test('the first save after a generation sends the version the job returned', async () => {
  const sent = [];
  const queue = createTimelineSaveQueue({
    send: async (timeline, { baseUpdatedAt }) => { sent.push(baseUpdatedAt); return { ...timeline, updatedAt: 'v-next' }; },
    fetchLatest: async () => null,
    merge: (b, l) => l,
  });
  const generated = { id: 'tl-gen', title: 'G', articles: [art('a', 'A')], updatedAt: '2026-11-05T10:00:00Z' };
  await queue.enqueue({ ...generated, title: 'Edited right away' });
  assert.deepEqual(sent, ['2026-11-05T10:00:00Z']);
});

test('a job error code (e.g. an empty refine) reaches the caller', async () => {
  const responses = [{ status: 'error', detail: 'The AI edit would have removed every event.', code: 'empty_refine_result' }];
  const err = await pollAiJobCore('job-1', {
    fetchStatus: async () => ({ ok: true, status: 200, json: async () => responses[0] }),
    delay: async () => {},
    clock: { elapsed: () => 0, dispose: () => {} },
  }).catch((e) => e);
  assert.equal(err.code, 'empty_refine_result');
  assert.match(err.message, /removed every event/);
});

// ---- B-23: an empty Stage 2 never wipes the cards Stage 1 showed ------------------------------

test('Library Stage 2: an empty response is ignored only when Stage 1 had cards', () => {
  assert.equal(shouldIgnoreEmptyLibraryStage2([], 6), true);
  assert.equal(shouldIgnoreEmptyLibraryStage2([], 0), false);
  assert.equal(shouldIgnoreEmptyLibraryStage2([{ id: 'x' }], 6), false);
  const section = read('components/HomeLibrarySection.jsx');
  assert.match(section, /stage1Count = firstList\.length;/);
  assert.match(section, /shouldIgnoreEmptyLibraryStage2\(list, stage1Count\)/);
});
