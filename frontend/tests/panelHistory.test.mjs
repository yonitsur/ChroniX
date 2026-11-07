// Side-panel navigation model: dock sections are siblings (tabs); Back only follows drill-downs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PANEL_HISTORY, pushPanel, openPanelSection, getCurrentPanel, getPreviousPanel, canGoBack, goBackPanel,
} from '../src/utils/panelHistory.js';

test('switching dock sections never creates a Back to the previous section', () => {
  let h = openPanelSection(EMPTY_PANEL_HISTORY, { kind: 'overview' });
  h = openPanelSection(h, { kind: 'list' });
  h = openPanelSection(h, { kind: 'edit' });
  h = openPanelSection(h, { kind: 'games', game: 'hub' });
  assert.equal(getCurrentPanel(h).kind, 'games');
  assert.equal(canGoBack(h), false);
});

test('drilling into an event from a section offers Back to that section', () => {
  let h = openPanelSection(EMPTY_PANEL_HISTORY, { kind: 'list' });
  h = pushPanel(h, { kind: 'event', id: 'a1' });
  assert.equal(getPreviousPanel(h).kind, 'list');
  // Moving to another event swaps in place: Back still leads to the list.
  h = pushPanel(h, { kind: 'event', id: 'a2' });
  assert.equal(getPreviousPanel(h).kind, 'list');
  h = goBackPanel(h);
  assert.equal(getCurrentPanel(h).kind, 'list');
});

test('a dock section opened from an event starts fresh', () => {
  let h = pushPanel(EMPTY_PANEL_HISTORY, { kind: 'event', id: 'a1' });
  h = openPanelSection(h, { kind: 'overview' });
  assert.equal(canGoBack(h), false);
});

test('re-opening the section that is already the root is a no-op (callers toggle it closed)', () => {
  const h = openPanelSection(EMPTY_PANEL_HISTORY, { kind: 'list' });
  assert.equal(openPanelSection(h, { kind: 'list' }), h);
});
