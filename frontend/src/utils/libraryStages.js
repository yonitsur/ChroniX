// Home Library two-stage load (B-23). Pure, so node tests can drive it.

/**
 * True when the Stage-2 (full catalog) response is empty although Stage 1 already showed cards:
 * that is a transient server error answered as 200 [], not an empty Library, so the cards stay.
 */
export function shouldIgnoreEmptyLibraryStage2(stage2Items, stage1Count) {
  return Array.isArray(stage2Items) && stage2Items.length === 0 && Number(stage1Count) > 0;
}

// --- Category facets (complete category row while the catalog loads) ---------------------------
// A facet group is { language, contentMode, total, categories: { [key]: count } } for one
// (language, contentMode) slice of the whole Library. The server sends them with the fast first page
// when its catalog cache is warm; the client also keeps the last full catalog's facets in localStorage.

const LIBRARY_FACETS_STORAGE_KEY = 'chronix.libraryFacets.v1';
const LIBRARY_FACETS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Server languages fold into the client's he/en filter the way a card's title would (RTL → he). */
export function normalizeFacetLanguage(language) {
  const lang = String(language || '').toLowerCase();
  return lang === 'he' || lang === 'ar' ? 'he' : 'en';
}

/** Validates untrusted facet groups (server payload or localStorage); null when unusable. */
export function sanitizeLibraryFacets(raw) {
  if (!Array.isArray(raw)) return null;
  const groups = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object' || !g.categories || typeof g.categories !== 'object') continue;
    const total = Number(g.total);
    if (!Number.isFinite(total) || total <= 0) continue;
    const categories = {};
    for (const [key, count] of Object.entries(g.categories)) {
      const n = Number(count);
      if (typeof key === 'string' && key && Number.isFinite(n) && n > 0) categories[key] = Math.floor(n);
    }
    groups.push({
      language: normalizeFacetLanguage(g.language),
      contentMode: g.contentMode === 'kids' ? 'kids' : 'classic',
      total: Math.floor(total),
      categories,
    });
  }
  return groups.length > 0 ? groups : null;
}

/** Facet groups of a loaded catalog, using the same language/category rules as the cards. */
export function buildLibraryFacets(items, resolveLanguage, getCategories) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const language = resolveLanguage(item);
    const contentMode = item.contentMode === 'kids' ? 'kids' : 'classic';
    const id = `${language}:${contentMode}`;
    let group = groups.get(id);
    if (!group) {
      group = { language, contentMode, total: 0, categories: {} };
      groups.set(id, group);
    }
    group.total += 1;
    for (const key of new Set(getCategories(item))) {
      group.categories[key] = (group.categories[key] || 0) + 1;
    }
  }
  return [...groups.values()];
}

/**
 * Counts for the active filters: `total` and `counts` honour the language/mode filter (like the
 * category pills do); `present` lists every category in the safe pool (kids-only when `kidsOnly`).
 */
export function summarizeLibraryFacets(groups, { lang = 'all', mode = 'all', kidsOnly = false } = {}) {
  const counts = new Map();
  const present = new Set();
  let total = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    if (kidsOnly && g.contentMode !== 'kids') continue;
    Object.keys(g.categories).forEach((key) => present.add(key));
    if (lang !== 'all' && g.language !== lang) continue;
    if (mode !== 'all' && g.contentMode !== mode) continue;
    total += g.total;
    for (const [key, n] of Object.entries(g.categories)) counts.set(key, (counts.get(key) || 0) + n);
  }
  return { total, counts, present };
}

export function readStoredLibraryFacets(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem(LIBRARY_FACETS_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > LIBRARY_FACETS_MAX_AGE_MS) {
      return null;
    }
    return sanitizeLibraryFacets(parsed.groups);
  } catch {
    return null;
  }
}

export function writeStoredLibraryFacets(groups, storage = globalThis.localStorage, now = Date.now()) {
  try {
    if (!Array.isArray(groups) || groups.length === 0) {
      storage?.removeItem(LIBRARY_FACETS_STORAGE_KEY);
      return;
    }
    storage?.setItem(LIBRARY_FACETS_STORAGE_KEY, JSON.stringify({ savedAt: now, groups }));
  } catch {
    // Private mode / quota: the row just falls back to the loaded cards.
  }
}
