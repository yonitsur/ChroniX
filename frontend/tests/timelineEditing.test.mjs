import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateTimelineMeta, addLane, renameLane, setLaneColor, moveLane, deleteLane,
  countEventsInLane, listTopics, renameTopic, deleteTopic,
  deleteEvents, setTopicForEvents, setLaneForEvents, makeLaneId,
} from '../src/utils/timelineEditing.js';

const base = () => ({
  id: 't', title: 'Family', overview: '',
  lanes: [{ id: 'mom', title: 'Mom side', order: 1 }, { id: 'dad', title: 'Dad side', order: 2 }, { id: 'kids', title: 'Kids', order: 3 }],
  articles: [
    { id: 1, title: 'a', lane: 'mom', category: 'Weddings' },
    { id: 2, title: 'b', lane: 'dad', category: 'weddings' },
    { id: 3, title: 'c', lane: 'dad', category: 'Births' },
    { id: 4, title: 'd' },
  ],
});

test('updateTimelineMeta only touches whitelisted string fields', () => {
  const next = updateTimelineMeta(base(), { title: 'New', overview: 'Hi', id: 'hack', description: 5 });
  assert.equal(next.title, 'New');
  assert.equal(next.overview, 'Hi');
  assert.equal(next.id, 't');
  assert.equal(next.description, undefined);
});

test('addLane generates unique ids and ignores blank names', () => {
  assert.equal(addLane(base(), '  ').lanes.length, 3);
  const once = addLane(base(), 'Kids');
  assert.equal(once.lanes.at(-1).id, 'kids-2');
  assert.equal(once.lanes.at(-1).order, 4);
  assert.equal(makeLaneId('סבא', []), 'סבא');
});

test('renameLane and setLaneColor change only the target lane', () => {
  const r = setLaneColor(renameLane(base(), 'dad', 'Father'), 'dad', '#fff');
  assert.equal(r.lanes[1].title, 'Father');
  assert.equal(r.lanes[1].color, '#fff');
  assert.equal(r.lanes[0].title, 'Mom side');
});

test('moveLane reorders, renumbers and respects bounds', () => {
  const up = moveLane(base(), 'kids', -1);
  assert.deepEqual(up.lanes.map((l) => l.id), ['mom', 'kids', 'dad']);
  assert.deepEqual(up.lanes.map((l) => l.order), [1, 2, 3]);
  assert.equal(moveLane(base(), 'mom', -1).lanes[0].id, 'mom');
});

test('deleteLane relocates or un-lanes events; merge into another lane', () => {
  const merged = deleteLane(base(), 'dad', 'mom');
  assert.equal(merged.lanes.length, 2);
  assert.equal(countEventsInLane(merged, 'mom'), 3);
  const orphaned = deleteLane(base(), 'dad', null);
  assert.equal(orphaned.articles[1].lane, undefined);
  assert.equal(deleteLane(base(), 'dad', 'dad').lanes.length, 3);
});

test('topics: list case-insensitively, rename/merge, delete', () => {
  assert.deepEqual(listTopics(base()), [{ name: 'Weddings', count: 2 }, { name: 'Births', count: 1 }]);
  const merged = renameTopic(base(), 'Births', 'weddings');
  assert.equal(listTopics(merged).length, 1);
  const removed = deleteTopic(base(), 'WEDDINGS');
  assert.equal(listTopics(removed).length, 1);
});

test('bulk event edits', () => {
  assert.equal(deleteEvents(base(), [1, '2']).articles.length, 2);
  assert.equal(setTopicForEvents(base(), [4], 'Trips').articles[3].category, 'Trips');
  assert.equal(setTopicForEvents(base(), [1], '').articles[0].category, undefined);
  assert.equal(setLaneForEvents(base(), [4], 'kids').articles[3].lane, 'kids');
  assert.equal(setLaneForEvents(base(), [1], null).articles[0].lane, undefined);
});
