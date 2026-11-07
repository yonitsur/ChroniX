// Decides whether a timeline data change needs a full canvas rebuild or can be applied to
// the live Histropedia articles in place (see applyCanvasArticleEdits in TimelineView).
//
// Rebuild: articles added or removed, an article moved to another lane, lanes or time
// bands changed, a different timeline, or a different time scale / zoom floor.
// In place: titles, descriptions, dates, rank, category and detail fields of existing
// articles. Image fields are excluded from diffCanvasArticle: explicit edits are pushed through
// setArticleImage, and images arriving with new data are found by canvasArticleImageChanged.

const dateKey = (d) => {
  if (!d || typeof d !== 'object') return d == null ? '' : String(d);
  return Object.keys(d)
    .filter((key) => d[key] !== undefined)
    .sort()
    .map((key) => `${key}:${d[key]}`)
    .join(',');
};

export const canvasDateKey = dateKey;

const laneKey = (lane) => `${lane?.id ?? ''}\u0002${lane?.title ?? ''}`;
const bandKey = (band) => [
  band?.id ?? '',
  band?.title ?? '',
  dateKey(band?.from),
  dateKey(band?.to),
  band?.from_year ?? '',
  band?.to_year ?? '',
  band?.precision ?? '',
  band?.color ?? '',
].join('\u0002');

/**
 * Structural identity of a timeline as the canvas sees it. Equal keys mean the existing
 * canvas can take the new data in place. Article order is not part of it (order only
 * breaks ties between equal dates and is updated in place).
 */
export function computeCanvasStructureKey(timelineData) {
  if (!timelineData) return '';
  const articles = Array.isArray(timelineData.articles) ? timelineData.articles : [];
  const articleKeys = articles.map((art) => `${art?.id ?? ''}\u0002${art?.lane ?? ''}`).sort();
  return [
    String(timelineData.id ?? ''),
    String(timelineData.timeScale ?? ''),
    (timelineData.lanes || []).map(laneKey).join('\u0001'),
    (timelineData.timeBands || []).map(bandKey).join('\u0001'),
    articleKeys.join('\u0001'),
  ].join('\u0003');
}

/** Fields shown by the canvas (lens card, drawer handoff) that need no relayout. */
export const CANVAS_DETAIL_FIELDS = [
  'sourceName',
  'sourceUrl',
  'wikiUrl',
  'extract',
  'extractIsCustom',
  'wikiTitle',
  'locationName',
  'lat',
  'lng',
  'googleMapsUrl',
  'isEdited',
  'editedAt',
  'richTitle',
  'richSubtitle',
  'isAnchor',
  '_chronixOrder',
];

/**
 * What differs between a live Histropedia article and its freshly formatted source.
 * Returns null when nothing the canvas uses changed. `options` is an Article.setOption
 * payload (title / subtitle / rank); dates are reported separately because removing an
 * end date cannot go through setOption.
 */
export function diffCanvasArticle(art, next) {
  if (!art || !next) return null;
  const data = art.data || {};
  const options = {};
  if ((art.title || '') !== (next.title || '')) options.title = next.title || '';
  if ((art.subtitle || '') !== (next.subtitle || '')) options.subtitle = next.subtitle || '';
  if ((art.rank || 0) !== (next.rank || 0)) options.rank = next.rank;

  const datesChanged = dateKey(data.from) !== dateKey(next.from)
    || dateKey(data.to) !== dateKey(next.to)
    || Boolean(data.isToPresent) !== Boolean(next.isToPresent);

  const categoryChanged = (data.category ?? '') !== (next.category ?? '')
    && JSON.stringify(data.category ?? '') !== JSON.stringify(next.category ?? '');

  const details = {};
  for (const field of CANVAS_DETAIL_FIELDS) {
    const before = data[field];
    const after = next[field];
    if (before === after) continue;
    if (before && after && typeof before === 'object' && JSON.stringify(before) === JSON.stringify(after)) continue;
    details[field] = after;
  }

  const hasOptions = Object.keys(options).length > 0;
  const hasDetails = Object.keys(details).length > 0;
  if (!hasOptions && !datesChanged && !categoryChanged && !hasDetails) return null;
  return {
    options,
    details,
    datesChanged,
    categoryChanged,
    // Text, dates and rank move or resize the card; detail fields only repaint.
    affectsLayout: hasOptions || datesChanged,
  };
}

const normalizedImageUrl = (url) => (typeof url === 'string' && url.trim() ? url.trim() : '');

/**
 * Whether the live canvas article shows a different image than its freshly formatted source.
 * diffCanvasArticle ignores images; edits made through setArticleImage update art.data first,
 * so this only fires for images that arrive with new data (e.g. the enriched result replacing
 * a media-less preview, or a refine/merge result) and are then loaded in place.
 */
export function canvasArticleImageChanged(art, next) {
  if (!art || !next) return false;
  return normalizedImageUrl(art.data?.rawImageUrl) !== normalizedImageUrl(next.rawImageUrl);
}
