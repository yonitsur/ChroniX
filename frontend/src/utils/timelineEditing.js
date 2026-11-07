/**
 * Pure, immutable helpers behind the "Edit Timeline" panel (lanes, topics, bulk event edits,
 * timeline details). Each takes a timeline object and returns a new one; nothing here touches
 * React or the network. Events reference lanes by lane id (`article.lane`) and topics by their
 * `category` text (case-insensitive).
 */

const DEFAULT_LANE_COLOR = '#2563a2';

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const topicKey = (name) => String(name ?? '').trim().toLowerCase();

export function makeLaneId(title, existingIds = []) {
  const base =
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u0590-\u05ff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || `lane-${Date.now().toString(36)}`;
  const taken = new Set(existingIds.map(String));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Only these top-level fields can be changed through the Details / Overview tabs. */
export function updateTimelineMeta(tl, patch = {}) {
  const next = { ...tl };
  for (const key of ['title', 'description', 'overview']) {
    if (typeof patch[key] === 'string') next[key] = patch[key];
  }
  return next;
}

// ---------- Lanes ----------

export function addLane(tl, title, color) {
  const name = String(title || '').trim();
  if (!name) return tl;
  const lanes = tl.lanes || [];
  const id = makeLaneId(name, lanes.map((l) => l.id));
  return {
    ...tl,
    lanes: [...lanes, { id, title: name, color: color || DEFAULT_LANE_COLOR, order: lanes.length + 1 }],
  };
}

export function renameLane(tl, laneId, title) {
  const name = String(title || '').trim();
  if (!name) return tl;
  return { ...tl, lanes: (tl.lanes || []).map((l) => (sameId(l.id, laneId) ? { ...l, title: name } : l)) };
}

export function setLaneColor(tl, laneId, color) {
  return { ...tl, lanes: (tl.lanes || []).map((l) => (sameId(l.id, laneId) ? { ...l, color } : l)) };
}

/** Moves a lane up (-1) or down (+1) and renumbers `order`. */
export function moveLane(tl, laneId, delta) {
  const lanes = [...(tl.lanes || [])];
  const from = lanes.findIndex((l) => sameId(l.id, laneId));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= lanes.length) return tl;
  const [item] = lanes.splice(from, 1);
  lanes.splice(to, 0, item);
  return { ...tl, lanes: lanes.map((l, i) => ({ ...l, order: i + 1 })) };
}

/**
 * Removes a lane. Its events move to `moveToLaneId`, or become lane-less when it is null.
 * Also used to merge one lane into another.
 */
export function deleteLane(tl, laneId, moveToLaneId = null) {
  if (moveToLaneId != null && sameId(moveToLaneId, laneId)) return tl;
  const lanes = (tl.lanes || []).filter((l) => !sameId(l.id, laneId)).map((l, i) => ({ ...l, order: i + 1 }));
  const target = moveToLaneId != null && lanes.some((l) => sameId(l.id, moveToLaneId)) ? moveToLaneId : undefined;
  const articles = (tl.articles || []).map((a) => (sameId(a.lane, laneId) ? { ...a, lane: target } : a));
  return { ...tl, lanes, articles };
}

export function countEventsInLane(tl, laneId) {
  return (tl.articles || []).filter((a) => sameId(a.lane, laneId)).length;
}

// ---------- Topics (event categories) ----------

/** Distinct topics with event counts, most used first. */
export function listTopics(tl) {
  const map = new Map();
  for (const a of tl.articles || []) {
    const name = String(a.category ?? '').trim();
    if (!name) continue;
    const key = topicKey(name);
    const entry = map.get(key) || { name, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

/** Renames a topic. Renaming onto an existing topic merges the two. */
export function renameTopic(tl, oldName, newName) {
  const name = String(newName || '').trim();
  const oldKey = topicKey(oldName);
  if (!name || !oldKey) return tl;
  return {
    ...tl,
    articles: (tl.articles || []).map((a) => (topicKey(a.category) === oldKey ? { ...a, category: name } : a)),
  };
}

export function deleteTopic(tl, name) {
  const key = topicKey(name);
  return {
    ...tl,
    articles: (tl.articles || []).map((a) => (topicKey(a.category) === key ? { ...a, category: undefined } : a)),
  };
}

// ---------- Bulk event edits ----------

const idSet = (ids) => new Set([...ids].map(String));

export function deleteEvents(tl, ids) {
  const set = idSet(ids);
  return { ...tl, articles: (tl.articles || []).filter((a) => !set.has(String(a.id))) };
}

/** Sets (or clears, with null/'') the topic of the given events. */
export function setTopicForEvents(tl, ids, topic) {
  const set = idSet(ids);
  const value = String(topic ?? '').trim() || undefined;
  return { ...tl, articles: (tl.articles || []).map((a) => (set.has(String(a.id)) ? { ...a, category: value } : a)) };
}

/** Sets (or clears, with null) the lane of the given events. */
export function setLaneForEvents(tl, ids, laneId) {
  const set = idSet(ids);
  const value = laneId == null || laneId === '' ? undefined : laneId;
  return { ...tl, articles: (tl.articles || []).map((a) => (set.has(String(a.id)) ? { ...a, lane: value } : a)) };
}

/** True when removing `ids` would leave the timeline with no events (the server refuses that, B-18). */
export function wouldLeaveTimelineEmpty(tl, ids) {
  const articles = Array.isArray(tl?.articles) ? tl.articles : [];
  if (articles.length === 0) return false;
  const remove = new Set((ids || []).map(String));
  return articles.every((a) => a && a.id != null && remove.has(String(a.id)));
}
