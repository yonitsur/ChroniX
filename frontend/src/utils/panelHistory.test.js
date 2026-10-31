import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PANEL_HISTORY,
  PANEL_HISTORY_LIMIT,
  canGoBack,
  canGoForward,
  getCurrentPanel,
  getNextPanel,
  getPreviousPanel,
  goBackPanel,
  goForwardPanel,
  isSamePanelEntry,
  pushPanel,
  removePanelEntries,
} from './panelHistory.js';

const games = (game = 'hub') => ({ kind: 'games', game });
const event = (id) => ({ kind: 'event', id });
const list = { kind: 'list' };
const overview = { kind: 'overview' };

const kinds = (history) => history.entries.map((e) => (e.kind === 'event' ? `event:${e.id}` : e.kind === 'games' ? `games:${e.game}` : e.kind));

test('starts closed', () => {
  assert.equal(getCurrentPanel(EMPTY_PANEL_HISTORY), null);
  assert.equal(canGoBack(EMPTY_PANEL_HISTORY), false);
  assert.equal(canGoForward(EMPTY_PANEL_HISTORY), false);
});

test('compares entries by kind and identity', () => {
  assert.ok(isSamePanelEntry(event(1), event('1')));
  assert.ok(!isSamePanelEntry(event(1), event(2)));
  assert.ok(isSamePanelEntry(games(), { kind: 'games' }));
  assert.ok(!isSamePanelEntry(games('hub'), games('wordle')));
  assert.ok(isSamePanelEntry(list, { kind: 'list' }));
  assert.ok(!isSamePanelEntry(list, overview));
});

test('game -> event -> back returns to the game, forward returns to the event', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, games('wordle'));
  h = pushPanel(h, event('a'));
  assert.deepEqual(getPreviousPanel(h), games('wordle'));
  h = goBackPanel(h);
  assert.deepEqual(getCurrentPanel(h), games('wordle'));
  assert.deepEqual(getNextPanel(h), event('a'));
  h = goForwardPanel(h);
  assert.deepEqual(getCurrentPanel(h), event('a'));
  assert.equal(canGoForward(h), false);
});

test('switching from one event to another replaces it instead of stacking', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, games('hub'));
  h = pushPanel(h, event('a'));
  h = pushPanel(h, event('b'));
  h = pushPanel(h, event('c'));
  assert.deepEqual(kinds(h), ['games:hub', 'event:c']);
  assert.equal(h.index, 1);
});

test('opening the current destination again is a no-op', () => {
  const h = pushPanel(EMPTY_PANEL_HISTORY, list);
  assert.equal(pushPanel(h, { kind: 'list' }), h);
});

test('revisiting a section via the dock lets Back return to where you were', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, games('wordle'));
  h = pushPanel(h, event('a'));
  h = pushPanel(h, games('wordle'));
  assert.deepEqual(kinds(h), ['event:a', 'games:wordle']);
  assert.deepEqual(getPreviousPanel(h), event('a'));
});

test('a new step after going back discards forward entries', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, list);
  h = pushPanel(h, event('a'));
  h = goBackPanel(h);
  h = pushPanel(h, overview);
  assert.deepEqual(kinds(h), ['list', 'overview']);
  assert.equal(canGoForward(h), false);
});

test('back from an event after going back to it keeps the earlier context', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, list);
  h = pushPanel(h, event('a'));
  h = pushPanel(h, games('hub'));
  h = goBackPanel(h);
  // Stepping to a sibling event replaces it and drops the forward entry.
  h = pushPanel(h, event('b'));
  assert.deepEqual(kinds(h), ['list', 'event:b']);
});

test('caps the trail length', () => {
  let h = EMPTY_PANEL_HISTORY;
  for (let i = 0; i < PANEL_HISTORY_LIMIT + 10; i += 1) {
    h = pushPanel(h, i % 2 ? event(i) : games(`g${i}`));
  }
  assert.equal(h.entries.length, PANEL_HISTORY_LIMIT);
  assert.equal(h.index, PANEL_HISTORY_LIMIT - 1);
});

test('back/forward are no-ops at the ends', () => {
  const h = pushPanel(EMPTY_PANEL_HISTORY, list);
  assert.equal(goBackPanel(h), h);
  assert.equal(goForwardPanel(h), h);
});

test('removing the current entry falls back to the previous one', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, games('hub'));
  h = pushPanel(h, event('a'));
  h = removePanelEntries(h, (e) => e.kind === 'event' && e.id === 'a');
  assert.deepEqual(kinds(h), ['games:hub']);
  assert.deepEqual(getCurrentPanel(h), games('hub'));
});

test('removing an entry collapses the duplicates it leaves behind', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, list);
  h = pushPanel(h, event('a'));
  h = pushPanel(h, overview);
  h = pushPanel(h, event('b'));
  h = removePanelEntries(h, (e) => e.kind === 'overview');
  assert.deepEqual(kinds(h), ['list', 'event:a', 'event:b']);
  assert.deepEqual(getCurrentPanel(h), event('b'));
});

test('removing every entry up to the current one closes the panel', () => {
  const h = pushPanel(EMPTY_PANEL_HISTORY, event('a'));
  assert.equal(getCurrentPanel(removePanelEntries(h, (e) => e.kind === 'event')), null);
});

test('removing a forward entry keeps the current one', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, list);
  h = pushPanel(h, event('a'));
  h = goBackPanel(h);
  h = removePanelEntries(h, (e) => e.kind === 'event');
  assert.deepEqual(kinds(h), ['list']);
  assert.deepEqual(getCurrentPanel(h), list);
});
