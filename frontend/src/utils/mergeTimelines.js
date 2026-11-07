// Deterministic, zero-AI-cost engine for layering / merging 2-4 ChroniX timelines
// side-by-side onto a shared chronological canvas and synchronized geographic map.

export const MAX_MERGED_SOURCES = 4;
export const MAX_EXPANDED_LANES = 6;

// Harmonious museum accents aligned with ChroniX's palette in `data/laneColors.js`
export const LAYER_ACCENT_COLORS = [
  '#2563a2', // Prussian Blue
  '#2e6b56', // Deep Sage
  '#b87326', // Burnished Ochre
  '#6e395e', // Imperial Plum
];

function stripLayerPrefix(rawId) {
  return String(rawId ?? '').replace(/^(?:L\d+__)+/, '');
}

function sanitizeSafeIdSegment(rawId, fallback = 'item', maxLen = 100) {
  const cleaned = stripLayerPrefix(rawId)
    .replace(/[<>"'\\\x00-\x1f\x7f]/g, '_')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `merged-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function computeArticlesYearBounds(articles = []) {
  let minYear = null;
  let maxYear = null;
  const nowYear = new Date().getUTCFullYear();

  for (const art of articles) {
    if (!art || typeof art !== 'object') continue;
    const fy = art.from?.year;
    if (typeof fy === 'number' && Number.isFinite(fy)) {
      minYear = minYear === null ? fy : Math.min(minYear, fy);
      maxYear = maxYear === null ? fy : Math.max(maxYear, fy);
    }
    const ty = art.to?.year;
    if (typeof ty === 'number' && Number.isFinite(ty)) {
      minYear = minYear === null ? ty : Math.min(minYear, ty);
      maxYear = maxYear === null ? ty : Math.max(maxYear, ty);
    }
    if (art.isToPresent) {
      maxYear = maxYear === null ? nowYear : Math.max(maxYear, nowYear);
    }
  }
  return { minYear, maxYear };
}

/**
 * Reconstructs clean individual source timelines from a timeline that may ALREADY be
 * a merged timeline, so users can add/remove/reorder layers or toggle sub-lanes at any time
 * (even after saving and reloading from storage).
 */
export function extractSourceTimelines(timeline) {
  if (!timeline || typeof timeline !== 'object') return [];
  const sourcesMeta = Array.isArray(timeline.mergedSources) ? timeline.mergedSources : null;
  if (!sourcesMeta || sourcesMeta.length < 2) {
    return [timeline];
  }

  const allArticles = Array.isArray(timeline.articles) ? timeline.articles : [];
  const allBands = Array.isArray(timeline.timeBands) ? timeline.timeBands : [];

  const matchesSource = (art, meta, idx) => {
    if (!art) return false;
    const layerId = meta.laneId || `layer-${idx + 1}`;
    if (art.sourceLayerId) return art.sourceLayerId === layerId;
    if (meta.id && art.sourceTimelineId) return String(art.sourceTimelineId) === String(meta.id);
    const laneStr = String(art.lane || '');
    return laneStr === layerId || laneStr.startsWith(`${layerId}__`);
  };

  // Preserve events added via AI chat / manual editor on a merged timeline by assigning
  // any unmatched article to the primary (first) layer instead of dropping it on rebuild.
  const unclaimedArticles = allArticles.filter(
    (art) => art && !sourcesMeta.some((meta, idx) => matchesSource(art, meta, idx))
  );

  return sourcesMeta.map((meta, idx) => {
    const layerId = meta.laneId || `layer-${idx + 1}`;
    const prefix = `L${idx + 1}__`;

    const matchedForLayer = allArticles.filter((art) => matchesSource(art, meta, idx));
    const rawLayerArticles = idx === 0 && unclaimedArticles.length > 0
      ? [...matchedForLayer, ...unclaimedArticles]
      : matchedForLayer;

    const layerArticles = rawLayerArticles
      .map((art) => {
        const cleanId = stripLayerPrefix(art.id);
        const restoredCategory =
          art._origCategory !== undefined ? (art._origCategory || undefined) : art.category;
        const restoredLane = art._origSubLaneId || undefined;
        const copy = {
          ...art,
          id: cleanId || art.id,
          lane: restoredLane,
          category: restoredCategory,
        };
        delete copy.sourceLayerId;
        delete copy.sourceTimelineId;
        delete copy.sourceTimelineTitle;
        delete copy._origCategory;
        delete copy._origSubLaneId;
        delete copy._origSubLaneTitle;
        return copy;
      });

    const layerBands = allBands
      .filter((tb) => tb && (tb.sourceLayerId === layerId || String(tb.id || '').startsWith(prefix)))
      .map((tb) => {
        const copy = { ...tb, id: stripLayerPrefix(tb.id) || tb.id };
        delete copy.sourceLayerId;
        return copy;
      });

    return {
      id: meta.id || `source-${idx + 1}`,
      title: meta.title || `Layer ${idx + 1}`,
      description: meta.description || '',
      overview: meta.overview || '',
      timeScale: meta.timeScale || timeline.timeScale || 'calendar',
      contentMode: meta.contentMode || timeline.contentMode || 'classic',
      detectedLanguage: meta.detectedLanguage || timeline.detectedLanguage || 'en',
      isPersonal: Boolean(meta.isPersonal),
      isFictional: Boolean(meta.isFictional),
      lanes: Array.isArray(meta.subLanes) && meta.subLanes.length > 0 ? meta.subLanes : [],
      timeBands: layerBands,
      articles: layerArticles,
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      tags: Array.isArray(meta.tags) ? meta.tags : [],
    };
  }).filter((src) => src.articles.length > 0);
}

/**
 * Returns true if at least one source timeline contains 2+ internal sub-lanes
 * that can be expanded within `MAX_EXPANDED_LANES`.
 */
export function canExpandSourceSubLanes(sources = []) {
  if (!Array.isArray(sources)) return false;
  return sources.some((src) => {
    const subLanes = Array.isArray(src?.lanes) ? src.lanes : (Array.isArray(src?.subLanes) ? src.subLanes : []);
    return subLanes.length > 1;
  });
}

/**
 * Merges 2..4 timelines deterministically into a single multi-lane `TimelineData` object.
 *
 * @param {Array<object>} rawSources - Array of 2..4 timeline objects.
 * @param {object} [options]
 * @param {boolean} [options.expandSubLanes=false] - Keep internal sub-lanes when total lanes <= MAX_EXPANDED_LANES.
 * @param {string} [options.customTitle] - Explicit title override.
 * @param {string} [options.existingId] - Preserve timeline ID when updating an existing merged timeline.
 */
export function mergeTimelines(rawSources = [], options = {}) {
  const flattened = [];
  for (const item of rawSources) {
    if (!item || typeof item !== 'object') continue;
    const extracted = extractSourceTimelines(item);
    for (const src of extracted) {
      if (Array.isArray(src.articles) && src.articles.length > 0) {
        flattened.push(src);
      }
    }
  }

  // Deduplicate accidental selection of the exact same non-empty timeline ID twice
  const seenSourceKeys = new Set();
  const sources = [];
  for (const src of flattened) {
    const dedupKey = src.id ? `id:${src.id}` : `title:${src.title}:${src.articles.length}`;
    if (seenSourceKeys.has(dedupKey)) continue;
    seenSourceKeys.add(dedupKey);
    sources.push(src);
    if (sources.length >= MAX_MERGED_SOURCES) break;
  }

  if (sources.length === 0) {
    throw new Error('At least one valid timeline with events is required to merge.');
  }
  if (sources.length === 1) {
    return { ...sources[0] };
  }

  const expandSubLanes = Boolean(options.expandSubLanes);
  const lanes = [];
  const mergedArticles = [];
  const mergedTimeBands = [];
  const mergedSources = [];
  const allCategories = [];
  const allTags = [];
  const groundingSources = [];
  const seenGroundingUrls = new Set();
  const relatedPrompts = [];
  const chatQuestions = [];

  // Pre-calculate lane budget for sub-lane expansion so total lanes never exceed MAX_EXPANDED_LANES
  let remainingExtraLaneBudget = Math.max(0, MAX_EXPANDED_LANES - sources.length);

  sources.forEach((src, idx) => {
    const layerNum = idx + 1;
    const layerId = `layer-${layerNum}`;
    const prefix = `L${layerNum}__`;
    const layerColor = LAYER_ACCENT_COLORS[idx % LAYER_ACCENT_COLORS.length];
    const srcTitle = String(src.title || `Timeline ${layerNum}`).trim();
    const rawSubLanes = Array.isArray(src.lanes) ? src.lanes.filter((l) => l && l.id && l.title) : [];
    const subLaneMap = new Map(rawSubLanes.map((l) => [String(l.id), l]));

    const extraNeeded = rawSubLanes.length > 1 ? rawSubLanes.length - 1 : 0;
    const shouldExpandThisSource = expandSubLanes && extraNeeded > 0 && extraNeeded <= remainingExtraLaneBudget;
    if (shouldExpandThisSource) {
      remainingExtraLaneBudget -= extraNeeded;
    }

    const assignedLaneIds = [];
    if (shouldExpandThisSource) {
      rawSubLanes.forEach((sub, subIdx) => {
        const safeSubId = sanitizeSafeIdSegment(sub.id, `sub-${subIdx + 1}`, 96);
        const compoundLaneId = `${layerId}__${safeSubId}`;
        assignedLaneIds.push(compoundLaneId);
        lanes.push({
          id: compoundLaneId,
          title: `${srcTitle} · ${sub.title}`,
          color: sub.color || layerColor,
          order: lanes.length,
        });
      });
    } else {
      assignedLaneIds.push(layerId);
      lanes.push({
        id: layerId,
        title: srcTitle,
        color: layerColor,
        order: lanes.length,
      });
    }

    const usedArticleIdsInLayer = new Set();
    const srcArticles = Array.isArray(src.articles) ? src.articles : [];
    for (let aIdx = 0; aIdx < srcArticles.length; aIdx++) {
      const art = srcArticles[aIdx];
      if (!art || typeof art !== 'object' || !art.from) continue;

      const baseId = sanitizeSafeIdSegment(art.id || `evt-${aIdx + 1}`, `evt-${aIdx + 1}`, 105);
      let namespacedId = `${prefix}${baseId}`;
      let suffix = 2;
      while (usedArticleIdsInLayer.has(namespacedId)) {
        namespacedId = `${prefix}${baseId}-${suffix++}`;
      }
      usedArticleIdsInLayer.add(namespacedId);

      const origLaneId = art.lane ? String(art.lane) : null;
      const origSubLane = origLaneId ? subLaneMap.get(origLaneId) : null;

      let targetLaneId = layerId;
      if (shouldExpandThisSource) {
        if (origSubLane) {
          const safeOrigSubId = sanitizeSafeIdSegment(origSubLane.id, 'sub-1', 96);
          targetLaneId = `${layerId}__${safeOrigSubId}`;
        } else {
          targetLaneId = assignedLaneIds[0];
        }
      }

      const origCategory = art.category || null;
      // In clean 1-lane-per-source mode, preserve sub-lane meaning in `category` if the event had no category
      const effectiveCategory =
        !shouldExpandThisSource && !origCategory && origSubLane?.title
          ? origSubLane.title
          : origCategory || undefined;

      mergedArticles.push({
        ...art,
        id: namespacedId,
        lane: targetLaneId,
        category: effectiveCategory,
        sourceLayerId: layerId,
        sourceTimelineId: src.id || null,
        sourceTimelineTitle: srcTitle,
        _origCategory: origCategory,
        _origSubLaneId: origLaneId,
        _origSubLaneTitle: origSubLane?.title || null,
      });
    }

    const srcBands = Array.isArray(src.timeBands) ? src.timeBands : [];
    srcBands.forEach((tb, bIdx) => {
      if (!tb || typeof tb !== 'object' || !tb.from || !tb.to) return;
      const baseBandId = sanitizeSafeIdSegment(tb.id || `tb-${bIdx + 1}`, `tb-${bIdx + 1}`, 105);
      mergedTimeBands.push({
        ...tb,
        id: `${prefix}${baseBandId}`,
        title: sources.length > 1 && tb.title ? `${srcTitle}: ${tb.title}` : tb.title,
        sourceLayerId: layerId,
      });
    });

    const { minYear, maxYear } = computeArticlesYearBounds(srcArticles);
    mergedSources.push({
      id: src.id || null,
      title: srcTitle,
      description: src.description || '',
      overview: src.overview || '',
      color: layerColor,
      articleCount: srcArticles.length,
      laneId: layerId,
      laneIds: assignedLaneIds,
      minYear,
      maxYear,
      timeScale: src.timeScale || 'calendar',
      contentMode: src.contentMode || 'classic',
      detectedLanguage: src.detectedLanguage || undefined,
      isPersonal: Boolean(src.isPersonal),
      isFictional: Boolean(src.isFictional),
      subLanes: rawSubLanes,
      categories: Array.isArray(src.categories) ? src.categories : [],
      tags: Array.isArray(src.tags) ? src.tags : [],
    });

    for (const c of src.categories || []) {
      if (c && !allCategories.includes(c)) allCategories.push(c);
    }
    for (const t of src.tags || []) {
      if (t && !allTags.includes(t)) allTags.push(t);
    }
    for (const gs of src.grounding?.sources || []) {
      if (gs?.url && !seenGroundingUrls.has(gs.url)) {
        seenGroundingUrls.add(gs.url);
        groundingSources.push({ title: gs.title || gs.url, url: gs.url });
      }
    }
    for (const rp of src.relatedPrompts || []) {
      if (rp && !relatedPrompts.includes(rp) && relatedPrompts.length < 6) relatedPrompts.push(rp);
    }
    for (const cq of src.chatQuestions || []) {
      if (cq && !chatQuestions.includes(cq) && chatQuestions.length < 6) chatQuestions.push(cq);
    }
  });

  const scales = new Set(mergedSources.map((s) => s.timeScale));
  const { minYear: overallMin, maxYear: overallMax } = computeArticlesYearBounds(mergedArticles);
  const overallSpan =
    overallMin !== null && overallMax !== null ? overallMax - overallMin : 0;

  const hasPrehistoric =
    scales.has('prehistoric') || (overallMin !== null && overallMin <= -1_000_000);
  const hasCalendarModern =
    mergedSources.some((s) => s.timeScale !== 'prehistoric' && (s.minYear === null || s.minYear > -10_000));
  const hasMixedTimeScales = Boolean(hasPrehistoric && hasCalendarModern);

  const mergedTimeScale =
    scales.size === 1 && scales.has('prehistoric')
      ? 'prehistoric'
      : overallSpan >= 10_000_000
        ? 'prehistoric'
        : 'calendar';

  const autoTitle = sources.map((s) => s.title).filter(Boolean).join(' × ');
  const finalTitle = (options.customTitle || autoTitle || 'Merged Timeline').slice(0, 220);

  const overviewSections = mergedSources
    .map((s) => {
      const body = (s.overview || s.description || '').trim();
      if (!body) return null;
      return `### ${s.title}\n\n${body}`;
    })
    .filter(Boolean);
  const combinedOverview = overviewSections.join('\n\n---\n\n');

  const combinedDescription = mergedSources
    .map((s) => s.title)
    .filter(Boolean)
    .join(' • ');

  // Detect Hebrew/RTL dominance for `detectedLanguage`
  const sampleText = `${finalTitle} ${combinedDescription}`;
  const detectedLanguage = /[\u0590-\u05FF]/.test(sampleText)
    ? 'he'
    : (sources[0]?.detectedLanguage || 'en');

  // If any source is kids, keep Kids audience mode; otherwise General ('classic')
  const resolvedContentMode = mergedSources.some((s) => s.contentMode === 'kids')
    ? 'kids'
    : 'classic';

  return {
    id: options.existingId || makeUuid(),
    title: finalTitle,
    description: combinedDescription,
    overview: combinedOverview,
    timeScale: mergedTimeScale,
    lanes,
    timeBands: mergedTimeBands,
    articles: mergedArticles,
    categories: allCategories.slice(0, 4),
    tags: allTags.slice(0, 8),
    relatedPrompts,
    chatQuestions,
    grounding:
      groundingSources.length > 0
        ? {
            is_grounded: true,
            search_queries: [],
            sources: groundingSources.slice(0, 20),
            citations: [],
          }
        : null,
    detectedLanguage,
    contentMode: resolvedContentMode,
    creationSource: 'merged',
    mergedSources,
    subLanesExpanded: expandSubLanes,
    hasMixedTimeScales,
    isPersonal: mergedSources.some((s) => Boolean(s.isPersonal)),
    isFictional: mergedSources.some((s) => Boolean(s.isFictional)),
    isManual: false,
    isLibrary: false,
    isFeatured: false,
  };
}

/**
 * Non-destructively filters a merged timeline's lanes, articles, and timeBands
 * according to the set of temporarily hidden `layerId`s (`'layer-1'`, `'layer-2'`, ...).
 */
export function applyHiddenLayersToTimeline(timeline, hiddenLayerIds) {
  if (!timeline || !hiddenLayerIds) return timeline;
  const hiddenSet =
    hiddenLayerIds instanceof Set
      ? hiddenLayerIds
      : new Set(Array.isArray(hiddenLayerIds) ? hiddenLayerIds : []);
  if (hiddenSet.size === 0) return timeline;

  const isLaneHidden = (laneId) => {
    const s = String(laneId || '');
    if (hiddenSet.has(s)) return true;
    const rootLayer = s.split('__')[0];
    return hiddenSet.has(rootLayer);
  };

  return {
    ...timeline,
    lanes: (timeline.lanes || []).filter((l) => !isLaneHidden(l?.id)),
    articles: (timeline.articles || []).filter(
      (a) => !hiddenSet.has(a?.sourceLayerId) && !isLaneHidden(a?.lane),
    ),
    timeBands: (timeline.timeBands || []).filter(
      (tb) => !hiddenSet.has(tb?.sourceLayerId),
    ),
  };
}
