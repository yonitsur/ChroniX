// Three-way merge of timeline copies by article id (B-04). Pure: no React / browser imports.
//
// Used in two places:
//  - the save queue, after a 409 `stale_write`: base = the last copy the server acknowledged,
//    local = what we tried to save, remote = the server's latest. Local wins real conflicts.
//  - applying an AI result (refine / chat edit / attach files) to the *latest* client state:
//    base = the snapshot sent at job start, local = the latest state, remote = the AI result.
//    The AI wins real conflicts, but edits made while the job ran are kept.

// UI-only flags that always follow the local copy; job bookkeeping that is never merged in.
const LOCAL_ONLY_KEYS = new Set(['isOwner', 'isShared', '_unsavedMerged', '_mergedIdForeign']);
const DROPPED_KEYS = new Set(['persisted', 'conflict', 'timeline_id', 'baseUpdatedAt']);

/** Deep equality where null, undefined and a missing key are all the same "no value". */
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!valuesEqual(a[key], b[key])) return false;
  }
  return true;
}

// One field: whichever side changed it relative to the base; `prefer` breaks real conflicts.
function pickValue(baseVal, localVal, remoteVal, hasBase, prefer) {
  if (valuesEqual(localVal, remoteVal)) return localVal;
  if (hasBase) {
    if (valuesEqual(localVal, baseVal)) return remoteVal;
    if (valuesEqual(remoteVal, baseVal)) return localVal;
  }
  return prefer === 'remote' ? remoteVal : localVal;
}

function mergeObjects(base, local, remote, prefer, skip = null) {
  const hasBase = base != null;
  const out = {};
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(base || {})]);
  for (const key of keys) {
    if (skip && skip(key)) continue;
    const value = pickValue(base?.[key], local?.[key], remote?.[key], hasBase, prefer);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const articleKey = (art) => (art && art.id != null ? String(art.id) : null);

function indexArticles(list) {
  const map = new Map();
  for (const art of Array.isArray(list) ? list : []) {
    const key = articleKey(art);
    if (key !== null && !map.has(key)) map.set(key, art);
  }
  return map;
}

function mergeArticle(baseArt, localArt, remoteArt, prefer) {
  if (localArt === remoteArt || valuesEqual(localArt, remoteArt)) return localArt;
  if (baseArt && valuesEqual(localArt, baseArt)) return remoteArt;
  if (baseArt && valuesEqual(remoteArt, baseArt)) return localArt;
  return mergeObjects(baseArt || {}, localArt, remoteArt, prefer);
}

/**
 * Merges `local` and `remote`, both derived from `base` (which may be null: then nothing counts as
 * deleted and `prefer` decides every difference).
 *
 * options:
 *  - prefer: 'local' | 'remote'  which side wins when both changed the same field (default 'local')
 *  - localDeleteWins: a local delete beats a remote edit of that event (default false: an edit
 *    beats a delete on either side, so nobody's work is silently dropped)
 *  - compare(a, b): optional article sort (e.g. chronological), applied to the merged list
 * `updatedAt` always comes from `remote` when it has one (it is the server-side version).
 */
export function mergeTimelineThreeWay(base, local, remote, { prefer = 'local', localDeleteWins = false, compare = null } = {}) {
  if (!remote) return local;
  if (!local) return remote;

  const merged = mergeObjects(base, local, remote, prefer, (key) => (
    key === 'articles' || key === 'updatedAt' || LOCAL_ONLY_KEYS.has(key) || DROPPED_KEYS.has(key)
  ));
  for (const key of LOCAL_ONLY_KEYS) {
    if (local[key] !== undefined) merged[key] = local[key];
  }
  const updatedAt = remote.updatedAt ?? local.updatedAt;
  if (updatedAt !== undefined) merged.updatedAt = updatedAt;

  const baseById = indexArticles(base?.articles);
  const localById = indexArticles(local.articles);
  const remoteById = indexArticles(remote.articles);
  const localList = Array.isArray(local.articles) ? local.articles : [];
  const remoteList = Array.isArray(remote.articles) ? remote.articles : [];
  const primary = prefer === 'remote' ? remoteList : localList;
  const secondary = prefer === 'remote' ? localList : remoteList;

  const seen = new Set();
  const articles = [];
  const visit = (art, fromLocal) => {
    const key = articleKey(art);
    if (key === null) {
      // Id-less entries can't be matched: keep the local ones only.
      if (fromLocal) articles.push(art);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const inBase = baseById.has(key);
    const l = localById.get(key);
    const r = remoteById.get(key);
    const b = baseById.get(key);
    if (l && r) {
      articles.push(mergeArticle(b, l, r, prefer));
    } else if (l) {
      // Gone remotely: a remote delete of an event local didn't touch; otherwise keep local's edit.
      if (!(inBase && valuesEqual(l, b))) articles.push(l);
    } else if (r) {
      if (!inBase) articles.push(r);
      else if (!localDeleteWins && !valuesEqual(r, b)) articles.push(r);
    }
  };
  primary.forEach((art) => visit(art, primary === localList));
  secondary.forEach((art) => visit(art, secondary === localList));

  merged.articles = typeof compare === 'function' ? [...articles].sort(compare) : articles;
  return merged;
}

/**
 * Applies an AI result (computed from `snapshot`, the copy sent at job start) to `latest` as a diff:
 * events the AI changed / added / removed relative to the snapshot are applied; edits made while
 * the job ran are kept. Returns `latest` itself when the AI changed nothing.
 */
export function applyAiResultToLatest(snapshot, latest, aiResult, { compare = null } = {}) {
  if (!aiResult) return latest;
  if (!latest || latest === snapshot) {
    // Nothing changed locally during the job: the result is the new state as-is.
    return stripJobFields(aiResult, latest);
  }
  return mergeTimelineThreeWay(snapshot, latest, stripJobFields(aiResult, null), {
    prefer: 'remote',
    localDeleteWins: true,
    compare,
  });
}

function stripJobFields(result, localForFlags) {
  if (!result || typeof result !== 'object') return result;
  const out = {};
  for (const [key, value] of Object.entries(result)) {
    if (!DROPPED_KEYS.has(key)) out[key] = value;
  }
  if (localForFlags) {
    for (const key of LOCAL_ONLY_KEYS) {
      if (localForFlags[key] !== undefined && out[key] === undefined) out[key] = localForFlags[key];
    }
  }
  return out;
}

/**
 * Applies an edit built from `base` (the copy an editor computed it from: the Edit panel, Story
 * Studio) to `latest` as a diff (B-04): the editor's changes win real conflicts, while changes that
 * landed meanwhile (an AI image, a merged save) are kept. `removedIds` are events the user deleted
 * in the editor; they stay deleted even when something touched them meanwhile.
 * Returns `edited` as-is when nothing changed since `base`.
 */
export function applyEditToLatest(base, latest, edited, { removedIds = null, compare = null } = {}) {
  if (!edited) return latest;
  if (!latest || !base || latest === base || String(latest.id) !== String(base.id) || String(edited.id) !== String(latest.id)) {
    return edited;
  }
  const merged = mergeTimelineThreeWay(base, latest, edited, { prefer: 'remote', compare });
  // The latest copy carries the newest version the server acknowledged.
  if (latest.updatedAt !== undefined) merged.updatedAt = latest.updatedAt;
  const removed = new Set((removedIds || []).map(String));
  if (removed.size > 0 && Array.isArray(merged.articles)) {
    merged.articles = merged.articles.filter((art) => !(art && art.id != null && removed.has(String(art.id))));
  }
  return merged;
}
