// Duplicate photos across sources (pure). Google Takeout exports a photo once per album it is in
// AND in its year folder ("Photos from 2023"); mixing an album download with a Takeout or a
// Google Photos pick repeats photos too. A duplicate has the same capture second and either the
// same file name (ignoring "(1)", "-edited" and the extension) or the same byte size.
// Burst shots share the second but differ in name and size, so they are kept.

/** "IMG_1234(1)-edited.JPG" -> "img_1234" */
export function normalizePhotoName(name) {
  return String(name || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\(\d+\)$/, '')
    .replace(/-(edited|bearbeitet|modifié|editado|modificato|bewerkt|編集済み)$/i, '')
    .replace(/\(\d+\)$/, '')
    .trim()
    .toLowerCase();
}

function keysOf(meta) {
  const keys = [];
  const name = normalizePhotoName(meta?.name);
  const size = Number(meta?.size) || 0;
  const sec = meta?.time ? Math.floor(meta.time.wallMs / 1000) : null;
  if (sec != null) {
    if (name) keys.push(`t${sec}|n${name}`);
    if (size > 0) keys.push(`t${sec}|s${size}`);
  } else if (name && size > 0) {
    // Undated: only an exact name + size match is safe.
    keys.push(`n${name}|s${size}`);
  }
  return keys;
}

/**
 * Splits new photos into those to keep and duplicates (of existing photos or of each other).
 * @param {Iterable<object>} existing  metas already in the import
 * @param {object[]} incoming
 * @returns {{keep: object[], duplicateIds: string[]}}
 */
export function dropDuplicatePhotos(existing, incoming) {
  const seen = new Set();
  for (const m of existing || []) for (const k of keysOf(m)) seen.add(k);
  const keep = [];
  const duplicateIds = [];
  for (const m of incoming || []) {
    const keys = keysOf(m);
    if (keys.some((k) => seen.has(k))) {
      duplicateIds.push(m.id);
      continue;
    }
    keys.forEach((k) => seen.add(k));
    keep.push(m);
  }
  return { keep, duplicateIds };
}
