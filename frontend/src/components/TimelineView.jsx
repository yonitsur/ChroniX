import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { Timeline, Article } from 'histropediajs';
import { getLaneBodyBg, getLaneBodyBorder, isColorLight, getDistinctCategories, getCategoryColor, CATEGORY_PALETTE } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import {
  compareEventDates,
  getTimelineAnchorArticleIds,
  isRtlText,
  isSameArticleId,
} from '../utils/timelineArticles';
import {
  AUTO_COMPACT_MAX_HEIGHT,
  AUTO_LANDSCAPE_MAX_HEIGHT,
  SINGLE_LANDSCAPE_CARD_MIN_HEIGHT,
  SINGLE_LARGE_CARD_MIN_HEIGHT,
  VISUAL_CARD_LAYOUT_BREAKPOINTS,
} from './timeline/timelineCanvasLayout';
import {
  CARD_LAYOUT_TIERS,
  allocateLaneHeights,
  measureLayoutDemand,
  planSlot,
  resolveRowSpacing,
} from './timeline/cardLayoutPlanner';

export { compareEventDates, getTimelineAnchorArticleIds, isRtlText, isSameArticleId } from '../utils/timelineArticles';

// Order-insensitive equality for filter id lists. Used to bail out of state
// updates when the incoming selection matches the current one, which prevents
// the two-way sync between `activeFilterIds` and the parent's `activeFilter`
// prop from ping-ponging into an infinite render loop.
function sameIdSet(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(a.map(String));
  for (const id of b) {
    if (!set.has(String(id))) return false;
  }
  return true;
}

// Standardized compact card geometry:
// 168px width with dynamic multi-line wrapping shows full event titles cleanly without truncation.
// Connector offset aligns with Histropedia's default (18px) for perfectly vertical connector lines.
export const COMPACT_CARD_WIDTH = 168;
export const COMPACT_CARD_HEIGHT = 36;
export const COMPACT_CONNECTOR_OFFSET_X = 18;

// Compact cards with an image carry a small thumbnail on their leading edge. The card
// grows by the thumbnail's footprint so the title keeps the same wrapping width.
export const COMPACT_THUMB_SIZE = 26;
export const COMPACT_THUMB_INSET = 5;
const COMPACT_THUMB_RESERVE = 30;
const COMPACT_PADDING_X = 8;

// Standardized landscape card geometry:
// 240px width with dynamic multi-line wrapping shows full event titles cleanly without truncation.
export const LANDSCAPE_CARD_WIDTH = 240;
export const LANDSCAPE_THUMB_SIZE = 54;
export const LANDSCAPE_THUMB_MARGIN = 6;
export const LANDSCAPE_STAR_SIZE = 16;
export const LANDSCAPE_STAR_MARGIN = 6;
export const LANDSCAPE_PADDING_X = 8;
export const LANDSCAPE_PADDING_Y = 8;

// Canvas text must mirror the UI font stack (Inter; Heebo covers Hebrew).
const CANVAS_FONT = "Inter, Heebo, system-ui, sans-serif";
const COMPACT_STAR_SIZE = 16;
const COMPACT_STAR_MARGIN = 6;
const COMPACT_TEXT_WIDTH = COMPACT_CARD_WIDTH - COMPACT_PADDING_X * 2 - (COMPACT_STAR_SIZE + COMPACT_STAR_MARGIN);

// Decided from the image URL (known up front) rather than the load state, so the card
// width - and therefore the stacking - does not change when the image arrives.
function hasArticleImageSource(article) {
  return Boolean(article?.data?.imageUrl || article?.imageUrl || (article?.imageLoaded && article?.image));
}

export function getCompactWidthForArticle(article) {
  return hasArticleImageSource(article) ? COMPACT_CARD_WIDTH + COMPACT_THUMB_RESERVE : COMPACT_CARD_WIDTH;
}

// Shared canvas context for measuring text lines accurately without DOM reflows
let _measureCanvas = null;
let _measureCtx = null;
function getMeasureCtx() {
  if (!_measureCtx && typeof document !== 'undefined') {
    _measureCanvas = document.createElement('canvas');
    _measureCtx = _measureCanvas.getContext('2d');
  }
  return _measureCtx;
}

// Complete word wrapping helper that NEVER truncates text, breaks overly long words if needed,
// and guarantees 100% of the event title is preserved across lines.
export function wrapCompactTitle(text, ctx, maxWidth) {
  if (!text) return [''];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        if (ctx.measureText(word).width <= maxWidth) {
          currentLine = word;
        } else {
          // If a single word is wider than maxWidth, split characters across lines so it NEVER gets cut
          let partial = '';
          for (let c = 0; c < word.length; c++) {
            const testChar = partial + word[c];
            if (ctx.measureText(testChar).width <= maxWidth) {
              partial = testChar;
            } else {
              if (partial) lines.push(partial);
              partial = word[c];
            }
          }
          currentLine = partial;
        }
      } else {
        // First word itself is wider than maxWidth on a new line
        let partial = '';
        for (let c = 0; c < word.length; c++) {
          const testChar = partial + word[c];
          if (ctx.measureText(testChar).width <= maxWidth) {
            partial = testChar;
          } else {
            if (partial) lines.push(partial);
            partial = word[c];
          }
        }
        currentLine = partial;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

// Fast cache for wrapped title lines to avoid repeated measurement during render loops
const _titleLinesCache = new Map();
function getCachedWrappedLines(text, maxWidth, font) {
  if (!text) return [''];
  const cacheKey = `${text}|${maxWidth}|${font}`;
  if (_titleLinesCache.has(cacheKey)) {
    return _titleLinesCache.get(cacheKey);
  }
  const ctx = getMeasureCtx();
  if (!ctx) return [text];
  ctx.font = font;
  const lines = wrapCompactTitle(text, ctx, maxWidth);
  if (_titleLinesCache.size > 3000) {
    _titleLinesCache.clear();
  }
  _titleLinesCache.set(cacheKey, lines);
  return lines;
}

// Accurately calculate the compact pill height needed to display all lines of the title
export function getCompactHeightForArticle(article) {
  const title = article?.title || article?.data?.title || '';
  if (!title) return 36;
  const font = `600 11px ${CANVAS_FONT}`;
  const lines = getCachedWrappedLines(title, COMPACT_TEXT_WIDTH, font);
  const count = Math.max(1, lines.length);
  if (count <= 1) return 36;
  if (count === 2) return 44;
  if (count === 3) return 56;
  return 44 + (count - 2) * 14;
}

// Accurately calculate the landscape card height needed to display all lines of title + subtitle
export function getLandscapeHeightForArticle(article) {
  if (!article) return 68;
  const titleText = article?.title || article?.data?.title || '';
  const subtitleText = (article?.subtitle || article?.data?.subtitle || '').trim();
  const hasImage = Boolean((article?.imageLoaded && article?.image) || article?.data?.imageUrl || article?.data?.image);

  const maxTextWidth = hasImage ? 148 : 198;
  const titleFont = `600 11.5px ${CANVAS_FONT}`;
  const titleLines = getCachedWrappedLines(titleText, maxTextWidth, titleFont);
  const titleLineCount = Math.max(1, titleLines.length);
  const titleLineHeight = titleLineCount >= 4 ? 14.5 : 15.5;
  const titleBlockH = titleLineCount * titleLineHeight;

  let subtitleBlockH = 0;
  if (subtitleText) {
    const subFont = `500 10px ${CANVAS_FONT}`;
    const subLines = getCachedWrappedLines(subtitleText, maxTextWidth, subFont);
    const subLineCount = Math.min(2, subLines.length);
    subtitleBlockH = subLineCount * 13 + 3;
  }

  const contentH = titleBlockH + subtitleBlockH;
  const verticalPadding = 16;
  const minH = hasImage ? 68 : 50;

  return Math.max(minH, Math.round(contentH + verticalPadding));
}

// Helper to resolve card height accurately across compact, landscape, and portrait layouts
export function getArticleRenderHeight(article) {
  if (!article) return 36;
  const layoutName = typeof article._getCurrentCardLayoutName === 'function'
    ? article._getCurrentCardLayoutName()
    : (article._resolvedCardLayoutName || article.cardLayout);
  if (layoutName === 'compact') return getCompactHeightForArticle(article);
  if (layoutName === 'landscape') return getLandscapeHeightForArticle(article);

  if (typeof article.getHeight === 'function') {
    try {
      const h = article.getHeight();
      if (typeof h === 'number' && h > 0) {
        // If a portrait card has an image that is not yet loaded, getHeight() only returns header height (~50-70px).
        // Guarantee at least 270px for portrait cards with images to prevent them from dropping into the numbers axis before load.
        const hasImage = Boolean(article.image || article.data?.image || article.options?.image);
        if (hasImage && !article.imageLoaded) {
          return Math.max(h, 270);
        }
        return h;
      }
    } catch (e) { }
  }
  if (typeof article._cachedHeight === 'number' && article._cachedHeight > 0) {
    return article._cachedHeight;
  }
  return 250;
}

// Portrait header grows with the wrapped title so it is never truncated.
function getPortraitHeaderHeight(lineCount, lineHeight = 18) {
  if (lineCount <= 1) return 44;
  if (lineCount === 2) return 54;
  if (lineCount === 3) return 72;
  if (lineCount === 4) return 90;
  return 54 + (lineCount - 2) * lineHeight;
}

// Portrait geometry (Histropedia default width + natural image capped at 200px, plus the
// ChroniX header/subheader styling). Needed to plan a portrait layout for cards that are
// currently drawn in another layout.
const PORTRAIT_CARD_WIDTH = 150;
const PORTRAIT_IMAGE_MAX_HEIGHT = 200;
const PORTRAIT_SUBHEADER_HEIGHT = 26;
const PORTRAIT_SUBTITLE_MAX_LINES = 4;
const PORTRAIT_SUBTITLE_LINE_HEIGHT = 14;
const PORTRAIT_SUBTITLE_FONT = `500 11px ${CANVAS_FONT}`;
const CARD_CONNECTOR_OFFSET_X = 18;

// Fixed inset (widest active border) so selection never re-wraps the description.
function getPortraitSubtitleTextWidth(cardWidth = PORTRAIT_CARD_WIDTH, margin = 10) {
  return Math.max(60, cardWidth - 3 - margin * 2);
}

function getPortraitSubtitleLines(article, textWidth, font = PORTRAIT_SUBTITLE_FONT) {
  const text = (article?.subtitle || article?.data?.subtitle || '').trim();
  if (!text) return [];
  const cacheKey = `portraitSub|${text}|${textWidth}|${font}`;
  if (_titleLinesCache.has(cacheKey)) return _titleLinesCache.get(cacheKey);
  const lines = getCachedWrappedLines(text, textWidth, font);
  let result = lines;
  if (lines.length > PORTRAIT_SUBTITLE_MAX_LINES) {
    result = lines.slice(0, PORTRAIT_SUBTITLE_MAX_LINES);
    const ctx = getMeasureCtx();
    let last = result[result.length - 1];
    if (ctx) {
      ctx.font = font;
      while (last && ctx.measureText(`${last}…`).width > textWidth) last = last.slice(0, -1);
    }
    result[result.length - 1] = `${last.trimEnd()}…`;
  }
  _titleLinesCache.set(cacheKey, result);
  return result;
}

function getPortraitSubheaderHeight(lineCount) {
  return PORTRAIT_SUBHEADER_HEIGHT + Math.max(0, lineCount - 1) * PORTRAIT_SUBTITLE_LINE_HEIGHT;
}

// The engine truncates portrait subtitles to one line; multi-line ones are drawn here instead.
function drawPortraitSubtitleLines(ctx, article) {
  if (!article.isDataLoaded || isNaN(article.position?.left)) return;
  const style = article._getCurrentStyle();
  const subText = style?.subheader?.text;
  if (!subText?.chronixColor) return;
  const margin = subText.margin ?? 10;
  const lines = getPortraitSubtitleLines(
    article,
    getPortraitSubtitleTextWidth(style.width ?? PORTRAIT_CARD_WIDTH, margin),
    subText.font || PORTRAIT_SUBTITLE_FONT
  );
  if (lines.length < 2) return;
  const borderWidth = style.border?.width ?? 1;
  const width = typeof article._getWidth === 'function' ? article._getWidth() : (style.width ?? PORTRAIT_CARD_WIDTH);
  const bandTop = article.position.top + borderWidth / 2 + (style.header?.height ?? 0);
  const bandHeight = style.subheader.height;
  const align = subText.align || 'left';
  const innerLeft = article.position.left + borderWidth / 2;
  const innerWidth = width - borderWidth;
  const x = align === 'right' ? innerLeft + innerWidth - margin : innerLeft + margin;
  const firstY = bandTop + bandHeight / 2 - ((lines.length - 1) * PORTRAIT_SUBTITLE_LINE_HEIGHT) / 2;

  ctx.font = subText.font || PORTRAIT_SUBTITLE_FONT;
  ctx.fillStyle = subText.chronixColor;
  ctx.textAlign = align;
  ctx.textBaseline = subText.baseline || 'alphabetic';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, Math.round(firstY + i * PORTRAIT_SUBTITLE_LINE_HEIGHT), innerWidth - margin * 2);
  }
}
// Cards never rise above this line in a single timeline (header / floating controls).
const SINGLE_TIMELINE_TOP_GAP = 44;
const LANE_TOP_GAP = 6;
// Cards just outside the viewport are planned too, so a layout is already right when
// they scroll in.
const PLAN_WINDOW_MARGIN = 0.15;

// Natural image aspect ratios (height / width) by URL. Landscape cards load their image
// square-cropped, so the loaded bitmap alone cannot tell how tall a portrait card would be.
const imageAspectByUrl = new Map();

// Records every image's natural size as Histropedia's loader decodes it, before any
// layout-specific crop. The loader class is private, so patch it through an instance.
function trackNaturalImageAspects(timeline) {
  const proto = timeline?.imageLoader ? Object.getPrototypeOf(timeline.imageLoader) : null;
  if (!proto || typeof proto._computeTransform !== 'function') return;
  // Re-pointed on every mount so a hot-reloaded module keeps receiving the sizes.
  proto._chronixAspectMap = imageAspectByUrl;
  if (proto._chronixAspectTracked) return;
  const originalComputeTransform = proto._computeTransform;
  proto._computeTransform = function (options, width, height) {
    const url = options?.article?.data?.imageUrl;
    if (url && width > 0 && height > 0) proto._chronixAspectMap?.set(url, height / width);
    return originalComputeTransform.call(this, options, width, height);
  };
  proto._chronixAspectTracked = true;
}

function getNaturalImageAspect(article) {
  const url = article?.data?.imageUrl;
  if (url && imageAspectByUrl.has(url)) return imageAspectByUrl.get(url);
  const img = article?.imageLoaded ? article.image : null;
  if (img && img.width > 0 && img.height > 0 && !String(article._loadedImageKey || '').includes(':square:')) {
    return img.height / img.width;
  }
  return null;
}

function estimatePortraitCardHeight(article) {
  const title = article?.title || article?.data?.title || '';
  const lines = getCachedWrappedLines(title, PORTRAIT_CARD_WIDTH - 20, `600 13px ${CANVAS_FONT}`);
  const header = getPortraitHeaderHeight(Math.max(1, lines.length));
  let imageHeight = 0;
  if (hasArticleImageSource(article)) {
    const aspect = getNaturalImageAspect(article);
    imageHeight = aspect
      ? Math.min(PORTRAIT_IMAGE_MAX_HEIGHT, aspect * (PORTRAIT_CARD_WIDTH - 0.5))
      : PORTRAIT_IMAGE_MAX_HEIGHT;
  }
  const subLines = getPortraitSubtitleLines(article, getPortraitSubtitleTextWidth());
  return Math.round(header + getPortraitSubheaderHeight(subLines.length) + imageHeight + 1);
}

function getPlannedCardSize(article, layout) {
  if (layout === 'compact') {
    return { width: getCompactWidthForArticle(article), height: getCompactHeightForArticle(article) };
  }
  if (layout === 'landscape') {
    return { width: LANDSCAPE_CARD_WIDTH, height: getLandscapeHeightForArticle(article) };
  }
  return { width: PORTRAIT_CARD_WIDTH, height: estimatePortraitCardHeight(article) };
}

function getPlanWindow(tl) {
  const width = typeof tl.getWidth === 'function' ? tl.getWidth() : (tl.options?.width || 0);
  return { lo: -width * PLAN_WINDOW_MARGIN, hi: width * (1 + PLAN_WINDOW_MARGIN) };
}

// Same priority as Histropedia's stack(): selected, then starred, then by rank.
function compareStackPriority(selectedId) {
  return (a, b) => {
    const aSelected = Boolean(selectedId) && isSameArticleId(a.id, selectedId);
    const bSelected = Boolean(selectedId) && isSameArticleId(b.id, selectedId);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    if (Boolean(a.isStarred) !== Boolean(b.isStarred)) return a.isStarred ? -1 : 1;
    const rankDiff = (b.rank || 0) - (a.rank || 0);
    if (rankDiff !== 0) return rankDiff;
    return String(b.id).localeCompare(String(a.id));
  };
}

// Plans every slot (each lane body, or the whole canvas for a single timeline): which
// card layout it uses, how far above the axis its first row sits and how its rows are
// spaced. Runs at the start of every Histropedia redraw (see the
// `_refreshAdaptiveArticleRuntimeOptions` patch), so the layout resolver, the distance to
// the baseline and the row spacing all read the same plan. In Automatic mode it weighs
// portrait, landscape and compact against the cards actually in view (their overlap,
// sizes, images and the period-line band); fixed modes plan only their own layout.
function planCardLayouts(tl) {
  if (!tl || !Array.isArray(tl.articles)) return;
  const mode = tl._chronixCardMode || 'auto';
  const candidates = mode === 'auto' ? CARD_LAYOUT_TIERS : [getCardLayoutForMode(null, null, mode)];
  const isLaneLayout = typeof tl._isLaneLayoutActive === 'function' && tl._isLaneLayoutActive();
  const { lo, hi } = getPlanWindow(tl);
  const periodLine = tl.options?.article?.periodLine || {};
  const bandStep = (periodLine.thickness || 0) + (periodLine.spacing || 0);
  const selectedId = tl._selectedArticleId;
  const byPriority = compareStackPriority(selectedId);

  const buckets = new Map();
  for (let i = 0; i < tl.articles.length; i++) {
    const art = tl.articles[i];
    if (!art || !art.isDataLoaded || art.hiddenByFilter || !art.period?.from) continue;
    let left;
    try {
      left = tl.getPixel(art.period.from) - CARD_CONNECTOR_OFFSET_X;
    } catch (e) {
      continue;
    }
    if (!Number.isFinite(left) || left + LANDSCAPE_CARD_WIDTH < lo || left > hi) continue;
    const key = isLaneLayout ? String(art.laneId) : '';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { entries: [], grouped: false, band: 0 };
      buckets.set(key, bucket);
    }
    if (art.isVisibleInGroup) bucket.grouped = true;
    bucket.entries.push({ art, left });
    if (!art.hidePeriodLine && Number.isFinite(art.stacking) && art.stacking >= 0) {
      bucket.band = Math.max(bucket.band, (art.stacking + 1) * bandStep);
    }
  }

  const planBucket = (bucket, availableHeight, topGap, previous) => {
    let entries = bucket ? bucket.entries : [];
    // Histropedia only stacks density-group members; before its first grouping pass
    // nothing is flagged yet, so fall back to every candidate.
    if (bucket?.grouped) {
      entries = entries.filter(({ art }) => art.isVisibleInGroup || (selectedId && isSameArticleId(art.id, selectedId)));
    }
    entries.sort((a, b) => byPriority(a.art, b.art));
    const demands = {};
    for (let c = 0; c < candidates.length; c++) {
      const layout = candidates[c];
      const cards = entries.map(({ art, left }) => {
        const size = getPlannedCardSize(art, layout);
        return { left, width: size.width, height: size.height };
      });
      demands[layout] = measureLayoutDemand({ cards, layout, periodBandHeight: bucket ? bucket.band : 0, topGap });
    }
    return planSlot({ availableHeight, demands, candidates, previous });
  };

  if (isLaneLayout) {
    tl._chronixTimelinePlan = null;
    (tl.lanes || []).forEach((lane) => {
      if (!lane) return;
      if (!lane.geometry || typeof tl._getLaneArticleAvailableHeight !== 'function') {
        lane._chronixPlan = null;
        return;
      }
      lane._chronixPlan = planBucket(
        buckets.get(String(lane.id)),
        tl._getLaneArticleAvailableHeight(lane),
        LANE_TOP_GAP,
        lane._chronixPlan?.layout || null,
      );
    });
  } else {
    (tl.lanes || []).forEach((lane) => { if (lane) lane._chronixPlan = null; });
    tl._chronixTimelinePlan = planBucket(buckets.get(''), tl.top || 0, SINGLE_TIMELINE_TOP_GAP, tl._chronixTimelinePlan?.layout || null);
  }
}

function getCardLayoutPlanFor(tl, articleOrData) {
  if (typeof tl._isLaneLayoutActive === 'function' && tl._isLaneLayoutActive()) {
    if (!articleOrData) return null;
    const laneId = articleOrData.laneId != null
      ? articleOrData.laneId
      : (typeof tl._resolveLaneIdFromArticleData === 'function' ? tl._resolveLaneIdFromArticleData(articleOrData) : null);
    const lane = laneId != null && typeof tl.getLaneById === 'function' ? tl.getLaneById(laneId) : null;
    return lane?._chronixPlan || null;
  }
  return tl._chronixTimelinePlan || null;
}

// Rows actually on (or just beside) the screen. Cards far off-screen may sit in higher
// rows; counting them would squeeze the rows the user can see.
function countVisibleStackRows(tl, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const { lo, hi } = getPlanWindow(tl);
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r] || [];
    for (let i = 0; i < row.length; i++) {
      const art = row[i];
      const left = art?.registeredPosition?.left;
      if (!Number.isFinite(left)) continue;
      if (left + art.getWidth() >= lo && left <= hi) return r + 1;
    }
  }
  return 1;
}

function countVisibleTimelineRows(tl) {
  const { lo, hi } = getPlanWindow(tl);
  let topRow = -1;
  for (let i = 0; i < tl.articles.length; i++) {
    const art = tl.articles[i];
    if (!art || !art.isDataLoaded || !art.isVisibleInRows || !art.isVisibleInGroup || art.isHiddenByFilter) continue;
    if (!Number.isFinite(art.row) || art.row <= topRow) continue;
    const left = art.registeredPosition?.left;
    if (!Number.isFinite(left)) continue;
    if (left + art.getWidth() >= lo && left <= hi) topRow = art.row;
  }
  return topRow + 1;
}

function getPlannedRowSpacing(plan, rows) {
  return resolveRowSpacing({
    availableHeight: plan.availableHeight,
    distance: plan.distance,
    topGap: plan.topGap,
    rows,
    layout: plan.layout,
    tallest: plan.tallest,
  });
}

// Automatic mode sizes the lanes of a split timeline by what their cards need: lanes stay
// equal unless moving height from one lane to another lets the timeline show richer
// cards (or stops a crowded lane from piling up). Fixed modes keep equal lanes. Only
// called on load, resize and filter changes - never while zooming - so lanes do not
// jump around under the user. Returns true when any lane weight changed.
function rebalanceLaneHeights(tl) {
  if (!tl || !Array.isArray(tl.lanes) || typeof tl._isLaneLayoutActive !== 'function' || !tl._isLaneLayoutActive()) return false;
  const collapsed = tl._chronixCollapsedLaneIds || new Set();
  const activeLanes = typeof tl._getActiveLanesForLayout === 'function' ? tl._getActiveLanesForLayout() : tl.lanes;
  const expanded = activeLanes.filter((lane) => lane && !collapsed.has(String(lane.id)));
  const headerOf = (lane) => (lane.layout?.header?.visible === false ? 0 : (lane.layout?.header?.height || 0));

  // Heights the user dragged in take precedence over automatic sizing in every mode.
  const manual = tl._chronixManualLaneWeights;
  if (manual && manual.size > 0 && expanded.length >= 2) {
    const known = expanded.map((lane) => manual.get(String(lane.id))).filter((w) => Number.isFinite(w) && w > 0);
    const fallback = known.length ? known.reduce((sum, w) => sum + w, 0) / known.length : 1;
    let changed = false;
    expanded.forEach((lane) => {
      const stored = manual.get(String(lane.id));
      const weight = Number.isFinite(stored) && stored > 0 ? stored : fallback;
      if (lane.layout?.heightWeight !== weight) {
        lane.setOption('layout.heightWeight', weight);
        changed = true;
      }
    });
    return changed;
  }

  let allocation = null;
  if ((tl._chronixCardMode || 'auto') === 'auto' && expanded.length >= 2) {
    planCardLayouts(tl);
    const laneOptions = tl.options?.lane || {};
    const layoutBottom = (tl.top || 0) - (tl.options?.style?.mainLine?.size || 0) / 2 - (laneOptions.axisGap || 0);
    let totalHeight = layoutBottom - (laneOptions.topGap || 0) - (laneOptions.gap || 0) * Math.max(activeLanes.length - 1, 0);
    activeLanes.forEach((lane) => {
      if (!lane) return;
      totalHeight -= collapsed.has(String(lane.id)) ? (Number(lane.layout?.height) || headerOf(lane)) : headerOf(lane);
    });
    allocation = allocateLaneHeights({
      totalHeight,
      lanes: expanded.map((lane) => ({ id: lane.id, demands: lane._chronixPlan?.demands })),
    });
  }

  let changed = false;
  expanded.forEach((lane, index) => {
    const weight = allocation ? Math.max(1, allocation.heights[index] + headerOf(lane)) : 1;
    if (lane.layout?.heightWeight !== weight) {
      lane.setOption('layout.heightWeight', weight);
      changed = true;
    }
  });
  // Each lane was sized for a specific layout; make it the hysteresis anchor (after the
  // redraws triggered above) so the next plan does not keep a richer layout that no
  // longer fits the new height.
  if (allocation) {
    expanded.forEach((lane, index) => {
      if (!lane._chronixPlan || lane._chronixPlan.layout === allocation.layouts[index]) return;
      lane._chronixPlan.layout = allocation.layouts[index];
      changed = true;
    });
  }
  return changed;
}

// Vertical space a card has to live in, measured EXACTLY the way the Histropedia engine
// measures it for its own `cardLayoutBreakpoints` resolution (lane body height, or
// timeline height minus the stacking top gap). Deriving this any other way is what made
// the app and the engine disagree about a card's layout: the card would render as
// landscape while the lane reserved portrait-sized space for it, leaving the cards
// pinned high above the axis behind an invisible ceiling.
export function getArticleAvailableHeight(tl, article) {
  if (!tl) return 0;
  try {
    const isLaneLayout = typeof tl._isLaneLayoutActive === 'function' && tl._isLaneLayoutActive();
    if (isLaneLayout && !article) {
      // No specific article (e.g. resolving a default for the whole timeline): use the
      // roomiest lane so a collapsed neighbour lane never drags the answer down.
      if (!Array.isArray(tl.lanes) || typeof tl._getLaneArticleAvailableHeight !== 'function') return 0;
      return tl.lanes.reduce((max, lane) => Math.max(max, tl._getLaneArticleAvailableHeight(lane) || 0), 0);
    }
    if (typeof tl._getAvailableHeightForArticle === 'function') {
      return tl._getAvailableHeightForArticle(article || undefined) || 0;
    }
  } catch (e) {
    return 0;
  }
  return 0;
}

function hasRoomForCardWidth(tl, article) {
  try {
    const isLaneLayout = typeof tl._isLaneLayoutActive === 'function' && tl._isLaneLayoutActive();
    let width = 0;
    if (isLaneLayout) {
      const laneId = article && article.laneId != null
        ? article.laneId
        : (typeof tl._resolveLaneIdFromArticleData === 'function' ? tl._resolveLaneIdFromArticleData(article) : null);
      const lane = laneId != null && typeof tl.getLaneById === 'function' ? tl.getLaneById(laneId) : null;
      const geo = lane?.geometry;
      if (geo && typeof geo.bodyContentRight === 'number' && typeof geo.bodyContentLeft === 'number') {
        width = geo.bodyContentRight - geo.bodyContentLeft;
      }
    }
    if (!width) {
      width = tl.canvas?.clientWidth || tl.canvas?.width || (typeof tl.getWidth === 'function' ? tl.getWidth() : 0);
    }
    return width <= 0 || width >= 240;
  } catch (e) {
    return true;
  }
}

// Helper to determine if an article's container/lane has enough clearance to display a
// full large (portrait) card without overflowing boundaries.
// forStacking (default: true): the card is one of many stacked rows, so it must clear the
// same breakpoint the engine uses (> AUTO_LANDSCAPE_MAX_HEIGHT).
// When false: checks only whether a single isolated card can physically fit.
export function canFitLargeCard(tl, article, forStacking = true) {
  if (!tl) return false;
  const availableH = getArticleAvailableHeight(tl, article);
  if (availableH <= 0) return false;
  if (forStacking) {
    if (availableH <= AUTO_LANDSCAPE_MAX_HEIGHT) return false;
  } else if (availableH < SINGLE_LARGE_CARD_MIN_HEIGHT) {
    return false;
  }
  return hasRoomForCardWidth(tl, article);
}

export function canFitSingleLargeCard(tl, article) {
  return canFitLargeCard(tl, article, false);
}

// Helper to determine if an article's container/lane has enough height for small
// (landscape) cards (~72px) plus connectors and margins without clipping the time ruler.
export function canFitLandscapeCard(tl, article, forStacking = true) {
  if (!tl) return false;
  const availableH = getArticleAvailableHeight(tl, article);
  if (availableH <= 0) return false;
  if (forStacking) return availableH > AUTO_COMPACT_MAX_HEIGHT;
  return availableH >= SINGLE_LANDSCAPE_CARD_MIN_HEIGHT;
}

export function canFitSingleLandscapeCard(tl, article) {
  return canFitLandscapeCard(tl, article, false);
}

// Which layout an article should use in automatic mode. The patched engine resolver reads
// the slot plan (see planCardLayouts) that also drives the distance to the baseline and
// the row spacing, so defer to it and only fall back to static thresholds before a plan
// exists. Deciding it any other way makes cards render in one layout while the lane
// reserves space for another.
export function getExpandedCardLayout(tl, article) {
  if (!tl) return 'portrait';
  const isLaneLayout = typeof tl._isLaneLayoutActive === 'function' && tl._isLaneLayoutActive();
  if ((article || !isLaneLayout) && typeof tl._resolveDefaultCardLayoutName === 'function') {
    try {
      const resolved = tl._resolveDefaultCardLayoutName(article || undefined);
      if (typeof resolved === 'string' && resolved) return resolved;
    } catch (e) {
      // fall through to the local thresholds
    }
  }
  if (canFitLargeCard(tl, article, true)) return 'portrait';
  if (canFitLandscapeCard(tl, article, true)) return 'landscape';
  return 'compact';
}

export function getSelectedCardLayoutForMode(tl, article, mode) {
  if (mode === 'compact' || mode === 'small') {
    if (canFitSingleLargeCard(tl, article)) {
      return 'portrait';
    }
    if (mode === 'compact' && canFitSingleLandscapeCard(tl, article)) {
      return 'landscape';
    }
    return mode === 'small' ? 'landscape' : 'compact';
  }
  if (mode === 'large') return 'portrait';
  return getExpandedCardLayout(tl, article);
}

function getCardLayoutForMode(tl, article, mode) {
  if (mode === 'large') return 'portrait';
  if (mode === 'small') return 'landscape';
  if (mode === 'compact') return 'compact';
  return getExpandedCardLayout(tl, article);
}

// Automatic mode is plan-driven: every redraw re-plans each slot and Histropedia
// re-resolves every card's layout from that plan. Calling `setCardLayout()` here would pin
// an explicit layout on the article forever, so a card could never grow back when space is
// freed. Instead drop the pin and re-plan against the freshly committed geometry.
function syncAutoCardLayouts(tl) {
  if (!tl || !Array.isArray(tl.articles)) return false;
  if (typeof tl._updateLaneLayout === 'function') tl._updateLaneLayout();
  planCardLayouts(tl);
  let changed = false;
  tl.articles.forEach((art) => {
    if (!art) return;
    if (art.cardLayout) {
      delete art.cardLayout;
      changed = true;
    }
    const target = getExpandedCardLayout(tl, art);
    if (art._resolvedCardLayoutName === target) return;
    if (typeof art.initialiseStyles === 'function') art.initialiseStyles();
    art._resolvedCardLayoutName = target;
    art._resolvedDefaultCardLayout = target;
    if (typeof art.invalidateCaches === 'function') art.invalidateCaches();
    changed = true;
  });
  return changed;
}

// Calculate an elevated, comfortable top coordinate for an expanded card in compact or small mode.
// Ensures that when expanding in parallel timelines (or single timeline), the card expands
// into the available space above it and maintains a generous, elegant connector line (~60-75px),
// matching the natural elevation seen in rich mode rather than sinking to the floor.
export function getExpandedArticleTop(article, axisY) {
  const owner = article.owner;
  if (!owner) return article.position?.top;

  const isLaneLayout = typeof owner._isLaneLayoutActive === 'function' && owner._isLaneLayoutActive();
  const lane = isLaneLayout && article.laneId ? owner.getLaneById(article.laneId) : null;
  const baseline = (isLaneLayout && lane?.geometry) ? lane.geometry.bodyContentBottom : (typeof axisY === 'number' ? axisY : owner.top);
  const minTop = (isLaneLayout && lane?.geometry) ? (lane.geometry.bodyContentTop + 8) : 54;
  const cardH = getArticleRenderHeight(article);

  const availableH = Math.max(cardH + 20, baseline - minTop);

  // Clearance from baseline to the bottom of the card in row 0:
  // In rich mode, landscape cards have a 65-80px connector clearance.
  // We provide that exact same generous clearance, scaled nicely if the lane is shallow.
  const baseClearance = isLaneLayout
    ? Math.min(80, Math.max(50, Math.round(availableH * 0.28)))
    : 65;

  const row = Number.isFinite(article.row) ? Math.max(0, article.row) : 0;
  const rowSpacing = isLaneLayout ? 42 : 44;

  // Make sure row lift doesn't push the card above minTop or below baseline
  const maxRowLift = Math.max(0, baseline - baseClearance - cardH - minTop);
  const rowLift = Math.min(row * rowSpacing, maxRowLift);

  const targetBottom = baseline - baseClearance - rowLift;
  const targetTop = targetBottom - cardH;

  const maxTop = baseline - cardH - 24;
  return Math.max(minTop, Math.min(maxTop, targetTop));
}

// Start a smooth, elegant glide animation for an expanded card in compact or small mode
export function triggerCardExpandAnimation(tl, article, targetLayout) {
  if (!tl || !article) return;
  const originalSaved = typeof article._unexpandedTop === 'number' ? article._unexpandedTop : article._compactTop;
  const startTop = typeof article.position?.top === 'number'
    ? article.position.top
    : (typeof originalSaved === 'number' ? originalSaved : 100);

  if (typeof originalSaved !== 'number') {
    article._unexpandedTop = startTop;
    article._compactTop = startTop;
  }

  // Switch card layout and invalidate cached sizes
  if (typeof article.setCardLayout === 'function') {
    article.setCardLayout(targetLayout);
  }
  if (typeof article.invalidateCaches === 'function') {
    article.invalidateCaches();
  }

  // Target Y position computed with generous clearance
  const targetTop = getExpandedArticleTop(article);

  // If distance is noticeable, run a 550ms graceful easeInOutCubic glide
  if (Math.abs(startTop - targetTop) >= 3) {
    article._expandAnim = {
      startTop,
      targetTop,
      startTime: performance.now(),
      duration: 550,
    };
  } else {
    article.position.top = targetTop;
    delete article._expandAnim;
  }
}

// Synchronize and ease the Y position of an expanded card during render
export function updateArticleExpandedPosition(article, axisY) {
  const isCompactOwner = article.owner?.options?.article?.cardLayout === 'compact' || article.owner?.options?.article?.defaultCardLayout === 'compact';
  const isSmallOwner = article.owner?.options?.article?.cardLayout === 'landscape' || article.owner?.options?.article?.defaultCardLayout === 'landscape';
  const isExpandableOwner = isCompactOwner || isSmallOwner;
  const currentLayout = typeof article._getCurrentCardLayoutName === 'function' ? article._getCurrentCardLayoutName() : article._resolvedCardLayoutName;
  const isExpanded = article.isActive && isExpandableOwner && (
    (isCompactOwner && currentLayout !== 'compact') ||
    (isSmallOwner && currentLayout === 'portrait')
  );

  const originalTop = typeof article._unexpandedTop === 'number' ? article._unexpandedTop : article._compactTop;

  if (isExpanded && article.position && typeof article.position.top === 'number' && !article.isDragging && article.owner) {
    if (typeof originalTop !== 'number') {
      article._unexpandedTop = article.position.top;
      article._compactTop = article.position.top;
    }
    if (article._expandAnim) {
      const anim = article._expandAnim;
      const elapsed = performance.now() - anim.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / anim.duration));
      // Graceful easeInOutCubic for a smooth start, calm glide, and soft landing
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      article.position.top = anim.startTop + (anim.targetTop - anim.startTop) * ease;
      if (progress < 1) {
        if (!article._expandRafRequested) {
          article._expandRafRequested = true;
          requestAnimationFrame(() => {
            article._expandRafRequested = false;
            if (article.owner) {
              if (typeof article.owner.defaultRedraw === 'function') article.owner.defaultRedraw();
              else if (typeof article.owner.redraw === 'function') article.owner.redraw();
            }
          });
        }
      } else {
        article.position.top = anim.targetTop;
        delete article._expandAnim;
      }
    } else {
      article.position.top = getExpandedArticleTop(article, axisY);
    }
  } else if (!isExpanded && typeof originalTop === 'number') {
    if (article.position) {
      article.position.top = originalTop;
    }
    delete article._unexpandedTop;
    delete article._compactTop;
    delete article._expandAnim;
  }
}

// Reimplement Article.prototype.drawPeriodLinesAndConnectors so the period line and connector line
// are semi-transparent in the normal state (100% solid when hovered/selected/active), while the arrow
// triangle at the card is always filled opaquely - otherwise the connector line shows through it.
if (typeof window !== 'undefined' && Article) {

  if (!Article.prototype._originalChroniXDrawPeriodLinesAndConnectors) {
    Article.prototype._originalChroniXDrawPeriodLinesAndConnectors = Article.prototype.drawPeriodLinesAndConnectors;
  }
  Article.prototype.drawPeriodLinesAndConnectors = function (ctx, axisY) {
    // Histropedia keeps filtered articles visible while their cards fade out, and an active
    // article can remain visible longer. Suppress its axis marks immediately so connector
    // triangles cannot linger after a lane is collapsed.
    if (this.hiddenByFilter || this.isHiddenByFilter || this.isVisibleInLane === false) return;

    updateArticleExpandedPosition(this, axisY);
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
    const isHigh = Boolean(this.isMouseover || this.isDragging || isSelected);
    const baseAlpha = typeof this.opacity === 'number' ? this.opacity : 1;
    const lineAlpha = isHigh ? baseAlpha : baseAlpha * 0.45;

    const style = this._getCurrentStyle();
    // The period/connector lines carry the timeline (lane) color, kept independent from the
    // card header background so the title itself can render on the plain card background.
    const lineColor = style.connectorLine?.color || style.color;
    const geometry = this._getPeriodLineRenderGeometry(axisY);
    const y = geometry.y;

    ctx.globalAlpha = lineAlpha;
    if (!this.hidePeriodLine) {
      const fromX = this.indicator.fromX, toX = this.indicator.toX;
      ctx.beginPath();
      ctx.lineWidth = geometry.thickness;
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      if (this.period.isToPresent) {
        const periodLength = toX - fromX, maxFadeLength = 15;
        const fadeStartColorStop = Math.max(1 - maxFadeLength / periodLength, 0.7);
        const grad = ctx.createLinearGradient(fromX, y, toX, y);
        grad.addColorStop(0, lineColor);
        grad.addColorStop(fadeStartColorStop, lineColor);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = lineColor;
      }
      ctx.stroke();
    }

    if (!style.connectorLine.visible) {
      ctx.globalAlpha = 1;
      return;
    }

    const cardLayout = this._getCurrentCardLayout();
    const connectorEnd = typeof cardLayout.getConnectorEnd === 'function'
      ? cardLayout.getConnectorEnd.call(this)
      : {
        left: this.position.left + style.connectorLine.offsetX,
        top: this.position.top + this.getHeight() + style.connectorLine.offsetY,
      };
    const x1 = Math.max(0, this.indicator.fromX);
    const y1 = y;
    const x2 = connectorEnd.left;
    const y2 = connectorEnd.top;

    // Connector line: semi-transparent in the normal state.
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = style.connectorLine.thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow triangle: always fully opaque so the connector line never shows through it.
    const dx = x2 - x1;
    const dy = y2 - y1;
    let radians;
    if (Math.abs(dx) < 0.001) {
      radians = dy <= 0 ? Math.PI : 0;
    } else {
      radians = Math.atan(dy / dx) + (x2 >= x1 ? -90 : 90) * Math.PI / 180;
    }

    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = lineColor;
    ctx.save();
    ctx.beginPath();
    ctx.translate(x2, y2);
    ctx.rotate(radians);

    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');
    const isCompact = layoutName === 'compact';

    // In compact mode, scale the triangle down so its visible footprint matches
    // the subtle, elegant triangle of the rich portrait mode (~17-20px visible height).
    const arrowWidth = isCompact
      ? (this.isActive ? 9.5 : this.isMouseover ? 8.5 : 7.5)
      : (style.connectorLine?.arrow?.width ?? 16);
    const arrowHeight = isCompact
      ? (this.isActive ? 26 : this.isMouseover ? 24 : 22)
      : (style.connectorLine?.arrow?.height ?? 45);

    ctx.moveTo(-arrowWidth, 0);
    ctx.lineTo(arrowWidth, 0);
    ctx.lineTo(0, -arrowHeight);
    ctx.closePath();
    ctx.restore();
    ctx.fill();

    ctx.globalAlpha = 1;
  };

  // Ensure Histropedia's auto-stacking, collision detection, and layout algorithms
  // use the exact compact card width so compact cards never overlap or distort the timeline.
  if (!Article.prototype._originalChroniXGetWidth) {
    Article.prototype._originalChroniXGetWidth = Article.prototype.getWidth;
  }
  Article.prototype.getWidth = function () {
    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');
    if (layoutName === 'compact') {
      return getCompactWidthForArticle(this);
    }
    if (layoutName === 'landscape') {
      return LANDSCAPE_CARD_WIDTH;
    }
    return Article.prototype._originalChroniXGetWidth.call(this);
  };

  if (!Article.prototype._originalChroniX_GetWidth) {
    Article.prototype._originalChroniX_GetWidth = Article.prototype._getWidth;
  }
  Article.prototype._getWidth = function () {
    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');
    if (layoutName === 'compact') {
      return getCompactWidthForArticle(this);
    }
    if (layoutName === 'landscape') {
      return LANDSCAPE_CARD_WIDTH;
    }
    return Article.prototype._originalChroniX_GetWidth.call(this);
  };

  // Patch Article.prototype.getHeight so that compact & landscape cards return dynamic height matching the title lines
  if (!Article.prototype._originalChroniXGetHeight) {
    Article.prototype._originalChroniXGetHeight = Article.prototype.getHeight;
  }
  Article.prototype.getHeight = function () {
    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');
    if (layoutName === 'compact') {
      return getCompactHeightForArticle(this);
    }
    if (layoutName === 'landscape') {
      return getLandscapeHeightForArticle(this);
    }
    return Article.prototype._originalChroniXGetHeight.call(this);
  };

  // Patch _getSizeCacheKey so any change in article title invalidates the cached card dimensions
  if (!Article.prototype._originalChroniXGetSizeCacheKey) {
    Article.prototype._originalChroniXGetSizeCacheKey = Article.prototype._getSizeCacheKey;
  }
  Article.prototype._getSizeCacheKey = function () {
    const baseKey = this._originalChroniXGetSizeCacheKey ? this._originalChroniXGetSizeCacheKey.call(this) : '';
    const title = this.title || this.data?.title || '';
    const subtitle = this.subtitle || this.data?.subtitle || '';
    const hasImage = Boolean((this.imageLoaded && this.image) || this.data?.imageUrl || this.data?.image);
    return `${baseKey}|title:${title}|subtitle:${subtitle}|img:${hasImage}`;
  };

  // Patch Article.prototype._getCurrentStyle so that:
  // 1. In landscape layout, event titles always contrast against the card background
  // 2. In portrait layout, style.header.height dynamically expands so the FULL title is always visible
  // 3. In landscape layout, style.height dynamically expands so the FULL title is always visible
  // 4. numberOfLines is never clamped to 2, ensuring Histropedia never truncates event titles
  if (!Article.prototype._originalChroniXGetCurrentStyle) {
    Article.prototype._originalChroniXGetCurrentStyle = Article.prototype._getCurrentStyle;
  }
  const originalGetCurrentStyle = Article.prototype._originalChroniXGetCurrentStyle;
  Article.prototype._getCurrentStyle = function () {
    // While we temporarily force isActive to reveal the star on hover, keep the card
    // rendered with its hover style rather than the "selected"/active style.
    let restoreActive = false;
    if (this._chronixFakeActive && this.isActive) {
      this.isActive = false;
      restoreActive = true;
    }
    const style = originalGetCurrentStyle.call(this);
    if (restoreActive) this.isActive = true;
    if (!style) return style;

    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');

    const title = this.title || this.data?.title || '';
    const subtitle = this.subtitle || this.data?.subtitle || '';
    const isRtl = isRtlText(title) || isRtlText(subtitle) || Boolean(window.__chronixIsRtl);
    const textAlign = isRtl ? 'right' : 'left';

    const headerText = {
      ...style.header?.text,
      align: textAlign,
    };
    const subheaderText = {
      ...style.subheader?.text,
      align: textAlign,
    };

    if (layoutName === 'landscape') {
      const bg = style.backgroundColor || (this.owner?._isDarkTheme ? '#18181b' : '#ffffff');
      const isBgLight = isColorLight(bg);
      const landscapeTextColor = isBgLight ? '#18181b' : '#f4f4f5';
      headerText.color = landscapeTextColor;
      const landscapeSubtextColor = isBgLight ? '#71717a' : '#a1a1aa';
      if (!subheaderText.color || subheaderText.color === '#777' || subheaderText.color === '#71717a') {
        subheaderText.color = landscapeSubtextColor;
      }
    }

    // Dynamic un-truncated header & card height calculation for portrait & landscape
    let dynamicHeaderHeight = style.header?.height;
    let dynamicCardHeight = style.height;
    let dynamicSubheaderHeight = null;

    if (layoutName === 'portrait') {
      const textMargin = headerText.margin ?? 10;
      const cardWidth = style.width ?? 200;
      const textWidth = Math.max(100, cardWidth - textMargin * 2);
      const font = headerText.font || `600 13px ${CANVAS_FONT}`;
      const lines = getCachedWrappedLines(title, textWidth, font);
      const lineCount = Math.max(1, lines.length);
      const lineHeight = headerText.lineHeight || 18;

      dynamicHeaderHeight = getPortraitHeaderHeight(lineCount, lineHeight);
      headerText.numberOfLines = Math.max(lineCount, 8);
      headerText.lineHeight = lineHeight;

      const subLines = getPortraitSubtitleLines(
        this,
        getPortraitSubtitleTextWidth(style.width ?? PORTRAIT_CARD_WIDTH, subheaderText.margin ?? 10),
        subheaderText.font || PORTRAIT_SUBTITLE_FONT
      );
      if (subLines.length > 1) {
        dynamicSubheaderHeight = getPortraitSubheaderHeight(subLines.length);
        subheaderText.chronixColor = subheaderText.color;
        subheaderText.color = 'rgba(0, 0, 0, 0)';
      }
    } else if (layoutName === 'landscape') {
      dynamicCardHeight = getLandscapeHeightForArticle(this);
      headerText.numberOfLines = 10;
      headerText.lineHeight = 15;
    }

    return {
      ...style,
      ...(layoutName === 'landscape' ? { height: dynamicCardHeight, width: LANDSCAPE_CARD_WIDTH } : {}),
      header: {
        ...style.header,
        ...(layoutName === 'portrait' && dynamicHeaderHeight ? { height: dynamicHeaderHeight } : {}),
        text: headerText,
      },
      subheader: {
        ...style.subheader,
        ...(dynamicSubheaderHeight ? { height: dynamicSubheaderHeight } : {}),
        text: subheaderText,
      }
    };
  };

  if (!Article.prototype._originalChroniXUpdateIsMouseOverStar) {
    Article.prototype._originalChroniXUpdateIsMouseOverStar = Article.prototype.updateIsMouseOverStar;
  }
  Article.prototype.updateIsMouseOverStar = function (pos) {
    if (!this.getIconBox()) {
      this.isMouseOverStar = false;
      return false;
    }
    return Article.prototype._originalChroniXUpdateIsMouseOverStar.call(this, pos);
  };

  // Reveal the (unstarred) star icon whenever an article is hovered, or persistently on
  // narrow viewports where hover is unavailable, so users can star with one direct tap.
  // Compact cards draw their own persistent star and must not be fake-activated here.
  // The library only draws the built-in star when an article is active or already starred,
  // so we briefly force isActive during the card draw (kept visually unselected via
  // _getCurrentStyle above).
  // Also sets ctx.direction to 'rtl' or 'ltr' to guarantee correct BiDi text shaping.
  if (!Article.prototype._originalChroniXDraw) {
    Article.prototype._originalChroniXDraw = Article.prototype.draw;
  }
  Article.prototype.draw = function (ctx) {
    updateArticleExpandedPosition(this);
    const isRtl = isRtlText(this.title) || isRtlText(this.subtitle) || Boolean(window.__chronixIsRtl);
    const prevDirection = ctx.direction;
    if (isRtl) {
      ctx.direction = 'rtl';
    } else {
      ctx.direction = 'ltr';
    }
    const starVisible = this.owner?.options?.article?.star?.visible !== false;
    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : this._resolvedCardLayoutName;
    const showStarForDirectAction = starVisible
      && !this.isActive
      && !this.isStarred
      && (this.isMouseover || this.owner?._isNarrowViewport)
      && layoutName === 'portrait';
    if (showStarForDirectAction) {
      this._chronixFakeActive = true;
      this.isActive = true;
    }

    const isLane = Boolean(this.laneId && typeof this.owner?._isLaneLayoutActive === 'function' && this.owner._isLaneLayoutActive());
    const lane = isLane ? this.owner.getLaneById(this.laneId) : null;
    const hasLaneClip = Boolean(lane?.geometry && typeof lane.geometry.top === 'number' && typeof lane.geometry.bottom === 'number');

    if (hasLaneClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, lane.geometry.top, ctx.canvas?.width || 2000, lane.geometry.bottom - lane.geometry.top);
      ctx.clip();
    }

    try {
      this._originalChroniXDraw.call(this, ctx);
      if (layoutName === 'portrait') drawPortraitSubtitleLines(ctx, this);
      drawCardEditedBadge(ctx, this);
    } finally {
      if (hasLaneClip) {
        ctx.restore();
      }
      if (showStarForDirectAction) {
        this.isActive = false;
        this._chronixFakeActive = false;
      }
      ctx.direction = prevDirection;
    }
  };

  if (!Article.prototype._originalChroniXUpdateVisibility) {
    Article.prototype._originalChroniXUpdateVisibility = Article.prototype.updateVisibility;
  }
  Article.prototype.updateVisibility = function () {
    Article.prototype._originalChroniXUpdateVisibility.call(this);
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
    if ((this.isActive || isSelected) && !this.isHiddenByFilter && this.isVisibleInLane !== false) {
      this.isVisible = true;
      this.isVisibleAfterFade = true;
      this.opacity = 1;
    }
  };

  Article.prototype._hasChroniXAlphaPatch = true;
}

// Patch CanvasRenderingContext2D so Histropedia's hardcoded harsh fluorescent yellow (#fff800)
// star fill is replaced with ChroniX's rich Byzantine Gold / Archival Amber (#b87326 in light, #e5a83b in dark).
if (typeof window !== 'undefined' && window.CanvasRenderingContext2D) {
  const proto = window.CanvasRenderingContext2D.prototype;
  const fillDescriptor = Object.getOwnPropertyDescriptor(proto, 'fillStyle');
  const strokeDescriptor = Object.getOwnPropertyDescriptor(proto, 'strokeStyle');

  if (fillDescriptor && fillDescriptor.set && !proto._chronixStarPatched) {
    const origFillSet = fillDescriptor.set;
    const origStrokeSet = strokeDescriptor ? strokeDescriptor.set : null;

    Object.defineProperty(proto, 'fillStyle', {
      set(val) {
        if (typeof val === 'string' && val.toLowerCase() === '#fff800') {
          const isDark = Boolean(window.__chronixDarkTheme);
          val = isDark ? '#e5a83b' : '#b87326';
          this._chronixInStarDraw = true;
        }
        return origFillSet.call(this, val);
      },
      get: fillDescriptor.get,
      configurable: true,
      enumerable: true,
    });

    if (origStrokeSet) {
      Object.defineProperty(proto, 'strokeStyle', {
        set(val) {
          if (this._chronixInStarDraw && typeof val === 'string' && (val.toLowerCase() === '#8a8a8a' || val.toLowerCase() === '#a5a5a5')) {
            const isDark = Boolean(window.__chronixDarkTheme);
            val = isDark ? '#f2b955' : '#8c591b';
            this._chronixInStarDraw = false;
          }
          return origStrokeSet.call(this, val);
        },
        get: strokeDescriptor.get,
        configurable: true,
        enumerable: true,
      });
    }

    proto._chronixStarPatched = true;
  }
}

// Helper to draw a capsule/pill shape on canvas across all browsers
function drawPillPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, h / 2, w / 2);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function drawCardStar(ctx, box, isStarred, isHovered) {
  const spikes = 5;
  const angle = Math.PI / spikes;

  ctx.save();
  ctx.beginPath();
  for (let index = 0; index < spikes * 2; index += 1) {
    const radius = index % 2 === 0 ? box.outerRadius : box.innerRadius;
    const x = box.centreX + Math.cos(1 + index * angle) * radius;
    const y = box.centreY + Math.sin(1 + index * angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isHovered ? '#8a8a8a' : '#a5a5a5';
  ctx.fillStyle = isStarred
    ? (window.__chronixDarkTheme ? '#e5a83b' : '#b87326')
    : (isHovered ? '#dfdfdf' : '#ebebeb');
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawCanvasPencil(ctx, x, y, size = 9, color = '#6366f1') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);

  const w = size * 0.36;
  const h = size * 0.85;
  const halfW = w / 2;
  const halfH = h / 2;

  ctx.fillStyle = color;
  // Pencil body
  ctx.beginPath();
  ctx.rect(-halfW, -halfH, w, h * 0.65);
  ctx.fill();

  // Pencil tip
  ctx.beginPath();
  ctx.moveTo(-halfW, -halfH + h * 0.65);
  ctx.lineTo(halfW, -halfH + h * 0.65);
  ctx.lineTo(0, halfH);
  ctx.closePath();
  ctx.fill();

  // Eraser top
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.rect(-halfW, -halfH - size * 0.15, w, size * 0.15);
  ctx.fill();

  ctx.restore();
}

function drawCardEditedBadge(ctx, article) {
  if (!article || !article.position || isNaN(article.position.left) || isNaN(article.position.top)) return;

  const isEdited = Boolean(article.isEdited || article.data?.isEdited);
  if (!isEdited) return;

  const layoutName = typeof article._getCurrentCardLayoutName === 'function'
    ? article._getCurrentCardLayoutName()
    : (article._resolvedCardLayoutName || 'portrait');

  const left = Math.round(article.position.left);
  const top = Math.round(article.position.top);
  const width = typeof article.getWidth === 'function' ? article.getWidth() : (layoutName === 'compact' ? COMPACT_CARD_WIDTH : 200);
  const height = typeof article.getHeight === 'function' ? article.getHeight() : (layoutName === 'compact' ? COMPACT_CARD_HEIGHT : 80);

  const isDark = Boolean(window.__chronixDarkTheme);
  const isRtl = isArticleRtl(article);
  const isHovered = Boolean(article.isMouseover);

  const label = isRtl ? 'נערך' : 'Edited';

  ctx.save();

  if (layoutName === 'compact') {
    // In compact layout, place a minimal subtle badge at the edge opposite to the star
    const badgeH = 14;
    const badgeW = isHovered ? 44 : 14;
    const badgeR = 7;
    // With a thumbnail the badge sits on the thumbnail's outer top corner instead.
    const hasThumb = hasArticleImageSource(article);
    const badgeX = hasThumb
      ? (isRtl ? (left + width - badgeW - 2) : (left + 2))
      : (isRtl ? (left + width - badgeW - 6) : (left + 6));
    const badgeY = hasThumb ? top + 2 : top + (height - badgeH) / 2;

    ctx.beginPath();
    drawPillPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
    ctx.fillStyle = isDark ? 'rgba(39, 39, 42, 0.88)' : 'rgba(244, 244, 245, 0.92)';
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const iconX = isRtl ? (badgeX + badgeW - 7) : (badgeX + 7);
    const iconY = badgeY + badgeH / 2;
    drawCanvasPencil(ctx, iconX, iconY, 7.5, isDark ? '#a1a1aa' : '#71717a');

    if (isHovered) {
      ctx.font = `600 8.5px ${CANVAS_FONT}`;
      ctx.fillStyle = isDark ? '#e4e4e7' : '#27272a';
      ctx.textAlign = isRtl ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const textX = isRtl ? (iconX - 6) : (iconX + 6);
      ctx.fillText(label, textX, badgeY + badgeH / 2);
    }
  } else {
    // Portrait or Landscape card
    const badgeH = 18;
    const badgeW = isHovered ? (isRtl ? 52 : 54) : 18;
    const badgeR = 9;

    // Position at top corner opposite to star
    const margin = 8;
    const badgeX = isRtl
      ? (left + width - badgeW - margin)
      : (left + margin);
    const badgeY = top + margin;

    // Elevation shadow
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    drawPillPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
    ctx.fillStyle = isDark ? 'rgba(24, 24, 27, 0.85)' : 'rgba(255, 255, 255, 0.92)';
    ctx.fill();

    // Reset shadow for border and content
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const iconX = isRtl ? (badgeX + badgeW - 9) : (badgeX + 9);
    const iconY = badgeY + badgeH / 2;
    drawCanvasPencil(ctx, iconX, iconY, 9, isDark ? '#e4e4e7' : '#52525b');

    if (isHovered) {
      ctx.font = `600 9.5px ${CANVAS_FONT}`;
      ctx.fillStyle = isDark ? '#f4f4f5' : '#18181b';
      ctx.textAlign = isRtl ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const textX = isRtl ? (iconX - 7) : (iconX + 7);
      ctx.fillText(label, textX, badgeY + badgeH / 2);
    }
  }

  ctx.restore();
}

function isArticleRtl(article) {
  return isRtlText(article?.title) || isRtlText(article?.subtitle) || Boolean(window.__chronixIsRtl);
}

function getCompactStarBox(article) {
  if (article.owner?.options?.article?.star?.visible === false) return false;
  const cardHeight = typeof article.getHeight === 'function' ? article.getHeight() : getCompactHeightForArticle(article);
  const cardWidth = typeof article.getWidth === 'function' ? article.getWidth() : COMPACT_CARD_WIDTH;
  const left = Math.round(article.position.left) + (
    isArticleRtl(article)
      ? COMPACT_STAR_MARGIN
      : cardWidth - COMPACT_STAR_SIZE - COMPACT_STAR_MARGIN
  );
  const top = Math.round(article.position.top) + (cardHeight - COMPACT_STAR_SIZE) / 2;
  return {
    left,
    top,
    width: COMPACT_STAR_SIZE,
    height: COMPACT_STAR_SIZE,
    centreX: left + COMPACT_STAR_SIZE / 2,
    centreY: top + COMPACT_STAR_SIZE / 2,
    outerRadius: COMPACT_STAR_SIZE / 2,
    innerRadius: COMPACT_STAR_SIZE / 4,
  };
}

// Square thumbnail for compact cards, cropped around the event's saved focal point
// (imagePositionX/Y, the same crop the event drawer uses). Until the image arrives - or
// if it never does - a tinted tile keeps the card's shape stable.
function drawCompactThumbnail(ctx, article, x, y, accentColor) {
  const size = COMPACT_THUMB_SIZE;
  const img = article.imageLoaded ? article.image : null;
  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, x, y, size, size, 4);
  ctx.clip();
  if (img && img.width > 0 && img.height > 0) {
    const side = Math.min(img.width, img.height);
    const focus = (value) => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 50)) / 100;
    const sx = (img.width - side) * focus(article.data?.imagePositionX);
    const sy = (img.height - side) * focus(article.data?.imagePositionY);
    ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

// Compact Card Layout for mobile and minimal clutter mode:
// 168px bounded width with dynamic multi-line word wrapping shows full event titles cleanly without truncation.
// Connector pin offset (18px) keeps the vertical connector lines strictly perpendicular to the axis.
const compactCardLayout = {
  name: 'compact',
  draw(ctx) {
    if (!this.isDataLoaded || isNaN(this.position?.left)) return;

    const style = this._getCurrentStyle();
    const left = Math.round(this.position.left);
    const top = Math.round(this.position.top);
    const width = typeof this.getWidth === 'function' ? this.getWidth() : COMPACT_CARD_WIDTH;
    const height = typeof this.getHeight === 'function' ? this.getHeight() : getCompactHeightForArticle(this);

    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
    const isActive = Boolean(this.isActive || isSelected);
    const isHigh = Boolean(this.isMouseover || this.isDragging || isActive);

    const isDark = Boolean(window.__chronixDarkTheme);
    const radius = 6;

    // Subtle elevation shadow on hover / active
    if (isHigh) {
      ctx.save();
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = isActive ? 12 : 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isActive ? 4 : 2;
    }

    // Card background fill
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    if (isActive) {
      ctx.fillStyle = isDark ? '#27272b' : '#ffffff';
    } else if (this.isMouseover) {
      ctx.fillStyle = isDark ? '#1f1f23' : '#f7f7f8';
    } else {
      ctx.fillStyle = isDark ? '#18181b' : '#ffffff';
    }
    ctx.fill();

    if (isHigh) {
      ctx.restore();
    }

    // Category / lane accent color
    const categoryColor = style.connectorLine?.color || style.color || (isDark ? '#818cf8' : '#4f46e5');

    // Card outline border: colored with categoryColor to provide immediate category recognition
    // and full visual consistency with rich mode.
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    if (isActive) {
      ctx.strokeStyle = categoryColor;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else if (this.isMouseover) {
      ctx.strokeStyle = categoryColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else {
      ctx.strokeStyle = categoryColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Event title text with complete word wrapping without any truncation
    const titleText = this.title || this.data?.title || '';
    // Same direction test as the star box, so star, thumbnail and title never collide.
    const isRtl = isArticleRtl(this);

    const hasThumb = hasArticleImageSource(this);
    if (hasThumb) {
      const thumbLeft = isRtl ? left + width - COMPACT_THUMB_INSET - COMPACT_THUMB_SIZE : left + COMPACT_THUMB_INSET;
      const thumbTop = top + Math.round((height - COMPACT_THUMB_SIZE) / 2);
      drawCompactThumbnail(ctx, this, thumbLeft, thumbTop, categoryColor);
    }

    const paddingX = COMPACT_PADDING_X;
    const leadingInset = paddingX + (hasThumb ? COMPACT_THUMB_RESERVE : 0);
    const showStar = this.owner?.options?.article?.star?.visible !== false;
    const starReservedWidth = showStar ? COMPACT_STAR_SIZE + COMPACT_STAR_MARGIN : 0;
    const textStart = isRtl ? (left + width - leadingInset) : (left + leadingInset);
    const maxTextWidth = width - leadingInset - paddingX - starReservedWidth;
    const textColor = isActive
      ? (isDark ? '#ffffff' : '#09090b')
      : (isDark ? '#e4e4e7' : '#18181b');

    ctx.font = `600 11px ${CANVAS_FONT}`;
    ctx.fillStyle = textColor;
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.textAlign = isRtl ? 'right' : 'left';
    ctx.textBaseline = 'middle';

    const lines = wrapCompactTitle(titleText, ctx, maxTextWidth);
    const lineCount = lines.length;
    const lineHeight = lineCount >= 3 ? 12 : 13;
    const totalTextHeight = (lineCount - 1) * lineHeight;
    const startY = top + (height - totalTextHeight) / 2;

    for (let i = 0; i < lineCount; i++) {
      ctx.fillText(lines[i], textStart, startY + i * lineHeight);
    }

    if (showStar) {
      drawCardStar(ctx, getCompactStarBox(this), this.isStarred, this.isMouseOverStar);
    }
  },
  getWidth() {
    return getCompactWidthForArticle(this);
  },
  getHeight() {
    return getCompactHeightForArticle(this);
  },
  getConnectorEnd() {
    const style = this._getCurrentStyle();
    const offsetY = typeof style?.connectorLine?.offsetY === 'number' ? style.connectorLine.offsetY : -5;
    return {
      left: Math.round(this.position.left) + COMPACT_CONNECTOR_OFFSET_X,
      top: Math.round(this.position.top) + this.getHeight() + offsetY,
    };
  },
  getIconBox() {
    return getCompactStarBox(this);
  },
  defaultStyle: {
    width: COMPACT_CARD_WIDTH,
    height: COMPACT_CARD_HEIGHT,
    connectorLine: {
      offsetX: COMPACT_CONNECTOR_OFFSET_X,
      offsetY: -5,
      arrow: {
        width: 7.5,
        height: 22,
      },
    },
  },
  defaultHoverStyle: {
    width: COMPACT_CARD_WIDTH,
    height: COMPACT_CARD_HEIGHT,
    connectorLine: {
      offsetX: COMPACT_CONNECTOR_OFFSET_X,
      offsetY: -5,
      arrow: {
        width: 8.5,
        height: 24,
      },
    },
  },
  defaultActiveStyle: {
    width: COMPACT_CARD_WIDTH,
    height: COMPACT_CARD_HEIGHT,
    connectorLine: {
      offsetX: COMPACT_CONNECTOR_OFFSET_X,
      offsetY: -5,
      arrow: {
        width: 9.5,
        height: 26,
      },
    },
  },
};

if (typeof window !== 'undefined' && Timeline) {
  try {
    const existing = typeof Timeline.getCardLayout === 'function' ? Timeline.getCardLayout('compact') : null;
    if (existing) {
      Object.assign(existing, compactCardLayout);
    } else if (typeof Timeline.registerCardLayout === 'function') {
      Timeline.registerCardLayout(compactCardLayout);
    }
  } catch (e) {
    console.warn('Could not register compact card layout:', e);
  }
}

// Patch Histropedia's built-in landscape card layout:
// Provides custom dynamic height, un-truncated multi-line title wrapping,
// rock-solid text stability on hover (never reflows or jumps), and full BiDi (RTL/LTR) support.
function patchLandscapeCardLayout(layout) {
  if (!layout || layout._chronixLandscapeOverhauled) return;

  layout.getWidth = function () {
    return LANDSCAPE_CARD_WIDTH;
  };

  layout.getHeight = function () {
    return getLandscapeHeightForArticle(this);
  };

  layout.getConnectorEnd = function () {
    const style = this._getCurrentStyle();
    const isRtl = isArticleRtl(this);
    const offsetX = typeof style?.connectorLine?.offsetX === 'number'
      ? style.connectorLine.offsetX
      : (isRtl ? LANDSCAPE_CARD_WIDTH - 18 : 18);
    const offsetY = typeof style?.connectorLine?.offsetY === 'number' ? style.connectorLine.offsetY : -5;
    return {
      left: Math.round(this.position.left) + offsetX,
      top: Math.round(this.position.top) + this.getHeight() + offsetY,
    };
  };

  layout.getIconBox = function () {
    if (this.owner?.options?.article?.star?.visible === false) return false;
    const isRtl = isArticleRtl(this);
    const left = Math.round(this.position.left) + (
      isRtl
        ? LANDSCAPE_STAR_MARGIN
        : LANDSCAPE_CARD_WIDTH - LANDSCAPE_STAR_SIZE - LANDSCAPE_STAR_MARGIN
    );
    const top = Math.round(this.position.top) + LANDSCAPE_STAR_MARGIN;
    return {
      left,
      top,
      width: LANDSCAPE_STAR_SIZE,
      height: LANDSCAPE_STAR_SIZE,
      centreX: left + LANDSCAPE_STAR_SIZE / 2,
      centreY: top + LANDSCAPE_STAR_SIZE / 2,
      outerRadius: LANDSCAPE_STAR_SIZE / 2,
      innerRadius: LANDSCAPE_STAR_SIZE / 4,
    };
  };

  layout.draw = function (ctx) {
    if (!this.isDataLoaded || isNaN(this.position?.left)) return;

    const left = Math.round(this.position.left);
    const top = Math.round(this.position.top);
    const width = LANDSCAPE_CARD_WIDTH;
    const height = getLandscapeHeightForArticle(this);
    const style = this._getCurrentStyle();

    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? isSameArticleId(this.id, selectedId) : false;
    const isActive = Boolean(this.isActive || isSelected);
    const isHigh = Boolean(this.isMouseover || this.isDragging || isActive);

    const isDark = Boolean(window.__chronixDarkTheme);
    const borderRadius = 6;

    // Elevation shadow on hover / active
    if (isHigh) {
      ctx.save();
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = isActive ? 14 : 9;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isActive ? 4 : 2;
    }

    // Card background fill
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, borderRadius);
    if (isActive) {
      ctx.fillStyle = isDark ? '#27272b' : '#ffffff';
    } else if (this.isMouseover) {
      ctx.fillStyle = isDark ? '#1f1f23' : '#fcfcfd';
    } else {
      ctx.fillStyle = isDark ? '#18181b' : '#ffffff';
    }
    ctx.fill();

    if (isHigh) ctx.restore();

    // Category accent outline border
    const categoryColor = style.connectorLine?.color || style.color || (isDark ? '#818cf8' : '#4f46e5');
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, borderRadius);
    ctx.strokeStyle = categoryColor;
    if (isActive) {
      ctx.lineWidth = 2.4;
    } else if (this.isMouseover) {
      ctx.lineWidth = 1.8;
    } else {
      ctx.lineWidth = 1.2;
    }
    ctx.stroke();

    const hasImage = Boolean(this.imageLoaded && this.image);
    const isRtl = isArticleRtl(this);

    // Draw thumbnail if image is present
    if (hasImage) {
      const thumbSize = LANDSCAPE_THUMB_SIZE;
      const thumbMargin = LANDSCAPE_THUMB_MARGIN;
      const thumbTop = top + Math.max(thumbMargin, Math.round((height - thumbSize) / 2));
      const thumbLeft = isRtl
        ? (left + width - thumbMargin - thumbSize)
        : (left + thumbMargin);

      let sx = 0, sy = 0, sWidth = this.image.width, sHeight = this.image.height;
      if (this.image.width > this.image.height) {
        sx = Math.round((this.image.width - this.image.height) / 2);
        sWidth = sHeight = this.image.height;
      } else if (this.image.height > this.image.width) {
        sy = Math.round((this.image.height - this.image.width) / 2);
        sWidth = sHeight = this.image.width;
      }

      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, thumbLeft, thumbTop, thumbSize, thumbSize, 4);
      ctx.clip();
      ctx.drawImage(this.image, sx, sy, sWidth, sHeight, thumbLeft, thumbTop, thumbSize, thumbSize);
      ctx.restore();
    }

    // Text placement with 100% constant maxTextWidth (never shifts on hover!)
    const maxTextWidth = hasImage ? 148 : 198;
    let textX;
    if (isRtl) {
      const rightMargin = hasImage ? (LANDSCAPE_THUMB_SIZE + LANDSCAPE_THUMB_MARGIN * 2) : LANDSCAPE_PADDING_X;
      textX = left + width - rightMargin;
    } else {
      const leftMargin = hasImage ? (LANDSCAPE_THUMB_SIZE + LANDSCAPE_THUMB_MARGIN * 2) : LANDSCAPE_PADDING_X;
      textX = left + leftMargin;
    }

    const titleText = this.title || this.data?.title || '';
    const subtitleText = (this.subtitle || this.data?.subtitle || '').trim();

    const titleFont = `600 11.5px ${CANVAS_FONT}`;
    ctx.font = titleFont;
    const titleLines = wrapCompactTitle(titleText, ctx, maxTextWidth);
    const titleLineCount = titleLines.length;
    const titleLineHeight = titleLineCount >= 4 ? 14.5 : 15.5;
    const titleBlockH = titleLineCount * titleLineHeight;

    let subLines = [];
    let subtitleBlockH = 0;
    if (subtitleText) {
      ctx.font = `500 10px ${CANVAS_FONT}`;
      subLines = wrapCompactTitle(subtitleText, ctx, maxTextWidth).slice(0, 2);
      subtitleBlockH = subLines.length * 13 + 3;
    }

    const totalContentH = titleBlockH + subtitleBlockH;
    const startY = top + Math.max(LANDSCAPE_PADDING_Y, Math.round((height - totalContentH) / 2));

    // Render title lines
    ctx.font = titleFont;
    ctx.fillStyle = isActive
      ? (isDark ? '#ffffff' : '#09090b')
      : (isDark ? '#f4f4f5' : '#18181b');
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.textAlign = isRtl ? 'right' : 'left';
    ctx.textBaseline = 'top';

    let currentY = startY;
    for (let i = 0; i < titleLineCount; i++) {
      ctx.fillText(titleLines[i], textX, currentY);
      currentY += titleLineHeight;
    }

    // Render subtitle
    if (subLines.length > 0) {
      currentY += 2;
      ctx.font = `500 10px ${CANVAS_FONT}`;
      ctx.fillStyle = isDark ? '#a1a1aa' : '#71717a';
      for (let i = 0; i < subLines.length; i++) {
        ctx.fillText(subLines[i], textX, currentY);
        currentY += 13;
      }
    }

    // Render star
    const starVisible = this.owner?.options?.article?.star?.visible !== false;
    const showStar = starVisible && (this.isActive || this.isStarred || this.isMouseover);
    if (showStar) {
      const iconBox = layout.getIconBox.call(this);
      if (iconBox) {
        drawCardStar(ctx, iconBox, this.isStarred, this.isMouseOverStar);
      }
    }
  };

  layout._chronixLandscapeOverhauled = true;
}

function patchRtlStarPlacement(layout) {
  if (!layout || layout._chronixRtlStarPatched) return;
  const originalDraw = layout.draw;
  const originalGetIconBox = layout.getIconBox;
  if (typeof originalDraw !== 'function' || typeof originalGetIconBox !== 'function') return;

  layout.getIconBox = function () {
    const box = originalGetIconBox.call(this);
    if (!box || !isArticleRtl(this)) return box;

    const style = this._getCurrentStyle();
    const cornerRadius = style.topRadius || style.borderRadius || 0;
    box.left = Math.round(this.position.left + cornerRadius / 4 + style.star.margin);
    box.centreX = box.left + box.width / 2;
    box.centreY = box.top + box.height / 2;
    box.outerRadius = box.width / 2;
    box.innerRadius = box.outerRadius / 2;
    return box;
  };

  layout.draw = function (ctx) {
    if (!isArticleRtl(this)) return originalDraw.call(this, ctx);

    const starOptions = this.owner?.options?.article?.star;
    const showStar = starOptions?.visible !== false && (this.isActive || this.isStarred);
    if (!showStar || !starOptions) return originalDraw.call(this, ctx);

    const previousVisibility = starOptions.visible;
    starOptions.visible = false;
    try {
      originalDraw.call(this, ctx);
    } finally {
      starOptions.visible = previousVisibility;
    }
    drawCardStar(ctx, layout.getIconBox.call(this), this.isStarred, this.isMouseOverStar);
  };

  layout._chronixRtlStarPatched = true;
}

if (typeof window !== 'undefined' && Timeline) {
  try {
    const landscapeLayout = typeof Timeline.getCardLayout === 'function' ? Timeline.getCardLayout('landscape') : null;
    if (landscapeLayout) {
      patchLandscapeCardLayout(landscapeLayout);
    }
    const portraitLayout = typeof Timeline.getCardLayout === 'function' ? Timeline.getCardLayout('portrait') : null;
    if (portraitLayout) patchRtlStarPlacement(portraitLayout);
  } catch (e) {
    console.warn('Could not patch card layouts for RTL:', e);
  }
}

// Patch Timeline methods so that any selected article (_selectedArticleId) is guaranteed
// to be marked active, kept visible, and positioned at the top of the render stack (bringFront)
// even across automatic stacking, row sorting, and frame renders.
if (typeof window !== 'undefined' && Timeline) {
  if (!Timeline.prototype._originalChroniXGetArticleById) {
    Timeline.prototype._originalChroniXGetArticleById = Timeline.prototype.getArticleById;
  }
  Timeline.prototype.getArticleById = function (id) {
    if (id == null) return undefined;
    if (Array.isArray(this.articles)) {
      const found = this.articles.find((a) => a && isSameArticleId(a.id, id));
      if (found) return found;
    }
    return Timeline.prototype._originalChroniXGetArticleById.call(this, id);
  };

  if (!Timeline.prototype._originalChroniXHasArticle) {
    Timeline.prototype._originalChroniXHasArticle = Timeline.prototype.hasArticle;
  }
  Timeline.prototype.hasArticle = function (id) {
    if (id == null) return false;
    return Boolean(this.getArticleById(id));
  };

  if (!Timeline.prototype._originalChroniXBringFront) {
    Timeline.prototype._originalChroniXBringFront = Timeline.prototype.bringFront;
  }
  Timeline.prototype.bringFront = function (articleId) {
    if (articleId != null && Array.isArray(this.articles)) {
      const index = this.articles.findIndex((item) => item && isSameArticleId(item.id, articleId));
      if (index >= 0) {
        const item = this.articles.splice(index, 1)[0];
        this.articles.push(item);
        return;
      }
    }
    Timeline.prototype._originalChroniXBringFront.call(this, articleId);
  };

  if (!Timeline.prototype._originalChroniXSelect) {
    Timeline.prototype._originalChroniXSelect = Timeline.prototype.select;
  }
  Timeline.prototype.select = function (articleId) {
    this._selectedArticleId = articleId;
    if (Array.isArray(this.articles)) {
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) a.isActive = isSameArticleId(a.id, articleId);
      }
      this.bringFront(articleId);
    }
    const previousActive = this.getActiveArticle();
    this.updateIsActiveStatus();
    const newActive = this.getActiveArticle();
    if (newActive !== previousActive && newActive) {
      this.trigger("article-select", newActive);
    }
    this._emitTimelineStateChange();
  };

  if (!Timeline.prototype._originalChroniXGetActiveArticle) {
    Timeline.prototype._originalChroniXGetActiveArticle = Timeline.prototype.getActiveArticle;
  }
  Timeline.prototype.getActiveArticle = function () {
    if (this._selectedArticleId) {
      const art = this.getArticleById(this._selectedArticleId);
      if (art && art.isDataLoaded) {
        return art;
      }
    }
    return Timeline.prototype._originalChroniXGetActiveArticle.call(this);
  };

  if (!Timeline.prototype._originalChroniXUpdateIsActiveStatus) {
    Timeline.prototype._originalChroniXUpdateIsActiveStatus = Timeline.prototype.updateIsActiveStatus;
  }
  Timeline.prototype.updateIsActiveStatus = function () {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      let found = false;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        const isTarget = a && isSameArticleId(a.id, this._selectedArticleId);
        if (a) a.isActive = isTarget;
        if (isTarget) found = true;
      }
      if (found) {
        this.bringFront(this._selectedArticleId);
        return;
      }
    }
    Timeline.prototype._originalChroniXUpdateIsActiveStatus.call(this);
  };

  if (!Timeline.prototype._originalChroniXStack) {
    Timeline.prototype._originalChroniXStack = Timeline.prototype.stack;
  }
  Timeline.prototype.stack = function (drawCycleContext) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            a.isVisibleInGroup = true;
            a.isVisibleInRows = true;
            a.isVisible = true;
            a.isVisibleAfterFade = true;
          }
        }
      }
    }
    Timeline.prototype._originalChroniXStack.call(this, drawCycleContext);
    if (this._selectedArticleId) {
      this.bringFront(this._selectedArticleId);
    }

    // Single timeline: Histropedia stacks with a static `autoStacking.rowSpacing`. Keep it
    // equal to the planned spacing for the rows in view and re-stack when it changes.
    if (!this._isLaneLayoutActive() && Array.isArray(this.articles) && this._chronixTimelinePlan) {
      const autoStacking = this.options?.article?.autoStacking;
      const spacing = getPlannedRowSpacing(this._chronixTimelinePlan, countVisibleTimelineRows(this));
      if (autoStacking && Math.abs((autoStacking.rowSpacing || 0) - spacing) >= 1) {
        autoStacking.rowSpacing = spacing;
        this.articles.forEach((art) => {
          if (!art.isDataLoaded || !art.isVisibleInRows || !Number.isFinite(art.row) || !art.finalOffset) return;
          // A new object, like stack() creates: the move animation may hold the old one.
          art.finalOffset = { left: art.finalOffset.left || 0, top: art.row * -spacing };
          this.reposition(art, drawCycleContext);
        });
      }
    }
  };

  if (!Timeline.prototype._originalChroniXGetFitToHeightRowSpacing) {
    Timeline.prototype._originalChroniXGetFitToHeightRowSpacing = Timeline.prototype.getFitToHeightRowSpacing;
  }
  Timeline.prototype.getFitToHeightRowSpacing = function () {
    if (!this._isLaneLayoutActive() && this._chronixTimelinePlan) {
      return getPlannedRowSpacing(this._chronixTimelinePlan, countVisibleTimelineRows(this));
    }
    return Timeline.prototype._originalChroniXGetFitToHeightRowSpacing.call(this);
  };

  if (!Timeline.prototype._originalChroniXRedraw) {
    Timeline.prototype._originalChroniXRedraw = Timeline.prototype.redraw;
  }
  Timeline.prototype.redraw = function (callbacks) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            a.isVisibleInGroup = true;
            a.isVisibleInRows = true;
            if (!a.isHiddenByFilter && a.isVisibleInLane !== false) {
              a.isVisible = true;
              a.isVisibleAfterFade = true;
              a.opacity = 1;
              if (a.fadeAnimation?.dummyElement?.stop) {
                a.fadeAnimation.dummyElement.stop();
                a.isFading = false;
              }
            }
          }
        }
      }
    }
    Timeline.prototype._originalChroniXRedraw.call(this, callbacks);
  };

  if (!Timeline.prototype._originalChroniXRender) {
    Timeline.prototype._originalChroniXRender = Timeline.prototype.render;
  }
  Timeline.prototype.render = function (ctx, top, width, markers, drawCycleContext) {
    if (this._selectedArticleId && Array.isArray(this.articles)) {
      const selId = this._selectedArticleId;
      let found = false;
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a) {
          const isTarget = isSameArticleId(a.id, selId);
          a.isActive = isTarget;
          if (isTarget) {
            if (!a.isHiddenByFilter && a.isVisibleInLane !== false) {
              a.isVisible = true;
              a.isVisibleAfterFade = true;
              a.opacity = 1;
            }
            found = true;
          }
        }
      }
      if (found) {
        this.bringFront(this._selectedArticleId);
      }
    }
    Timeline.prototype._originalChroniXRender.call(this, ctx, top, width, markers, drawCycleContext);

    // Hard guarantee: active article is always drawn on the topmost layer of canvas
    if (this._selectedArticleId) {
      const active = this.getActiveArticle();
      if (active && active.isDataLoaded && !active.isHiddenByFilter && active.isVisibleInLane !== false) {
        active.isVisible = true;
        active.drawPeriodLinesAndConnectors(ctx, top);
        active.draw(ctx);
      }
    }
  };

  // Disable Histropedia's dragging highlight on the bottom axis/ruler area
  // which by default draws a light-blue overlay (rgba(237, 247, 255, 0.5))
  // over the years and tick marks whenever the timeline is clicked, tapped, or dragged.
  Timeline.prototype.drawDraggingHighlight = function () { };

  // Card layout, distance to the baseline and row spacing all come from one plan per slot
  // (see planCardLayouts), recomputed at the start of every redraw right after the lane
  // geometry is committed. The Histropedia originals remain the fallback before the first
  // plan exists.
  if (!Timeline.prototype._originalChroniXRefreshAdaptiveArticleRuntimeOptions) {
    Timeline.prototype._originalChroniXRefreshAdaptiveArticleRuntimeOptions = Timeline.prototype._refreshAdaptiveArticleRuntimeOptions;
  }
  Timeline.prototype._refreshAdaptiveArticleRuntimeOptions = function () {
    planCardLayouts(this);
    return Timeline.prototype._originalChroniXRefreshAdaptiveArticleRuntimeOptions.call(this);
  };

  if (!Timeline.prototype._originalChroniXResolveDefaultCardLayoutName) {
    Timeline.prototype._originalChroniXResolveDefaultCardLayoutName = Timeline.prototype._resolveDefaultCardLayoutName;
  }
  Timeline.prototype._resolveDefaultCardLayoutName = function (articleOrData) {
    const plan = getCardLayoutPlanFor(this, articleOrData);
    if (plan?.layout) return plan.layout;
    return Timeline.prototype._originalChroniXResolveDefaultCardLayoutName.call(this, articleOrData);
  };

  if (!Timeline.prototype._originalChroniXGetLaneDistanceToBaseline) {
    Timeline.prototype._originalChroniXGetLaneDistanceToBaseline = Timeline.prototype._getLaneDistanceToBaseline;
  }
  Timeline.prototype._getLaneDistanceToBaseline = function (lane) {
    if (!this._isLaneLayoutActive()) return this._getTimelineDistanceToBaseline();
    const plan = lane?._chronixPlan;
    if (plan && lane.geometry) return plan.distance;
    return Timeline.prototype._originalChroniXGetLaneDistanceToBaseline.call(this, lane);
  };

  if (!Timeline.prototype._originalChroniXGetTimelineDistanceToBaseline) {
    Timeline.prototype._originalChroniXGetTimelineDistanceToBaseline = Timeline.prototype._getTimelineDistanceToBaseline;
  }
  Timeline.prototype._getTimelineDistanceToBaseline = function () {
    const plan = this._chronixTimelinePlan;
    if (plan && !this._isLaneLayoutActive()) return plan.distance;
    return Timeline.prototype._originalChroniXGetTimelineDistanceToBaseline.call(this);
  };

  if (!Timeline.prototype._originalChroniXGetLaneRowSpacing) {
    Timeline.prototype._originalChroniXGetLaneRowSpacing = Timeline.prototype._getLaneRowSpacing;
  }
  Timeline.prototype._getLaneRowSpacing = function (lane, rows) {
    const plan = lane?._chronixPlan;
    if (plan && lane.geometry) return getPlannedRowSpacing(plan, countVisibleStackRows(this, rows));
    return Timeline.prototype._originalChroniXGetLaneRowSpacing.call(this, lane, rows);
  };


  // Strict Ceiling & Floor Clamping: guarantees that no card can EVER cross above its lane boundary
  // or bleed below its lane baseline / bottom ruler
  if (!Timeline.prototype._originalChroniXReposition) {
    Timeline.prototype._originalChroniXReposition = Timeline.prototype.reposition;
  }
  Timeline.prototype.reposition = function (article, drawCycleContext) {
    const isLane = typeof this._isLaneLayoutActive === 'function' && this._isLaneLayoutActive();
    const layoutName = typeof article._getCurrentCardLayoutName === 'function'
      ? article._getCurrentCardLayoutName()
      : (article._resolvedCardLayoutName || article.cardLayout);
    const isPortrait = layoutName === 'portrait';

    // Strict clearance above the baseline/ruler numbers:
    // Portrait cards need at least 52px clearance so card bottoms and connector triangles never collide with axis numbers.
    // Landscape cards need 28px, compact cards 18px.
    const axisClearance = isPortrait ? 52 : (layoutName === 'landscape' ? 28 : 18);

    let minAllowedTop = 44; // Safe margin below header/controls in single timeline
    let maxAllowedBottom = (this.top || 600) - axisClearance;

    if (isLane && article.laneId) {
      const lane = this.getLaneById(article.laneId);
      if (lane?.geometry) {
        minAllowedTop = lane.geometry.bodyContentTop + 4;
        maxAllowedBottom = lane.geometry.bodyContentBottom - axisClearance;
      }
    }

    const cardH = getArticleRenderHeight(article);
    const maxAllowedTop = Math.max(minAllowedTop, maxAllowedBottom - cardH);

    const pos = typeof this.getOriginalPosition === 'function' ? this.getOriginalPosition(article, drawCycleContext) : null;
    if (pos && typeof pos.top === 'number') {
      if (article.finalOffset && typeof article.finalOffset.top === 'number') {
        const curTop = pos.top + article.finalOffset.top;
        if (curTop < minAllowedTop) {
          article.finalOffset.top = minAllowedTop - pos.top;
        } else if (curTop > maxAllowedTop) {
          article.finalOffset.top = maxAllowedTop - pos.top;
        }
      }
      if (article.moveAnimation?.finalOffset && typeof article.moveAnimation.finalOffset.top === 'number') {
        const curAnimTop = pos.top + article.moveAnimation.finalOffset.top;
        if (curAnimTop < minAllowedTop) {
          article.moveAnimation.finalOffset.top = minAllowedTop - pos.top;
        } else if (curAnimTop > maxAllowedTop) {
          article.moveAnimation.finalOffset.top = maxAllowedTop - pos.top;
        }
      }
    }

    Timeline.prototype._originalChroniXReposition.call(this, article, drawCycleContext);

    if (article.position && typeof article.position.top === 'number') {
      if (article.position.top < minAllowedTop) {
        article.position.top = minAllowedTop;
      } else if (article.position.top > maxAllowedTop) {
        article.position.top = maxAllowedTop;
      }
    }
  };

  // Override Timeline.prototype.drawTimeBands to prevent overlapping text smudges on the bottom ruler.
  // When timebands have identical dates or overlap in pixel space, Histropedia draws each text label
  // on top of each other at the same Y coordinate.
  // This override draws all backgrounds, but performs strict collision detection on text labels,
  // ensuring no two labels overlap on the axis and skipping labels if a band is too narrow to be legible.
  Timeline.prototype.drawTimeBands = function (ctx, top, width, drawCycleContext) {
    const cfg = this.options.timeBand || {};
    if (!cfg.visible) return;
    if (!this.timeBands || this.timeBands.length === 0) return;

    const resolvedDrawCycleContext = drawCycleContext || {
      tokens: this.getTokensAndMarkers(width).tokens
    };
    const bands = this._getVisibleTimeBands(resolvedDrawCycleContext);
    if (!bands || bands.length === 0) return;

    const anchorTop = this.top;
    const canvasHeight = this.options?.height || (anchorTop + 42);
    // Span flush to the bottom of the canvas so there is no dead space beneath the timeline bar
    const bandHeight = Math.max(28, canvasHeight - anchorTop);
    const bandTop = anchorTop;

    ctx.save();

    // Base ruler track background across full width so the timeline bar is unified, solid, and flush
    const isDarkActive = Boolean(this._isDarkTheme ?? window.__chronixDarkTheme);
    ctx.fillStyle = isDarkActive ? 'rgba(18, 18, 20, 0.45)' : 'rgba(235, 236, 240, 0.5)';
    ctx.fillRect(0, bandTop, width, bandHeight);

    // 1. Calculate screen coordinates for all visible bands
    const preparedBands = [];
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      let left = Math.round(this.getPixel(band.period.from, resolvedDrawCycleContext));
      let right = Math.round(this.getPixel(band.period.to, resolvedDrawCycleContext));
      if (right < 0 || left > width) continue;
      left = Math.max(0, left);
      right = Math.min(width, right);
      const bandW = right - left;
      if (bandW <= 0) continue;
      preparedBands.push({ band, left, right, width: bandW });
    }

    // 2. Draw backgrounds and borders for all visible bands
    for (let i = 0; i < preparedBands.length; i++) {
      const { band, left, width: bandW } = preparedBands[i];
      const style = band.style || {};
      ctx.globalAlpha = 1;
      ctx.fillStyle = style.backgroundColor || style.background || 'rgba(200, 200, 200, 0.25)';
      ctx.fillRect(left, bandTop, bandW, bandHeight);
      const border = style.border;
      if (border && border.width) {
        ctx.lineWidth = border.width;
        ctx.strokeStyle = border.color || 'rgba(120, 120, 120, 0.6)';
        ctx.strokeRect(left + 0.5, bandTop + 0.5, bandW - 1, bandHeight - 1);
      }
    }

    // 3. Draw text labels with smart collision prevention
    const occupiedRanges = [];
    for (let i = 0; i < preparedBands.length; i++) {
      const { band, left, right, width: bandW } = preparedBands[i];
      const style = band.style || {};
      const textStyle = style.text || {};
      const margin = textStyle.margin || 5;
      const maxTextWidth = Math.max(0, bandW - margin * 2);

      // If band is too narrow on screen to display text legibly, skip text
      if (maxTextWidth < 20 || bandW < 36) continue;

      const text = band.title || '';
      if (!text.trim()) continue;

      ctx.font = textStyle.font || `600 10px ${CANVAS_FONT}`;
      ctx.textAlign = textStyle.align || 'center';
      ctx.textBaseline = textStyle.baseline || 'middle';
      const isDarkActive = Boolean(this._isDarkTheme ?? window.__chronixDarkTheme);
      ctx.fillStyle = textStyle.color || (isDarkActive ? '#f4f4f5' : '#3f3f46');

      let label = text;
      const measured = ctx.measureText(text).width;
      if (measured > maxTextWidth) {
        let leftIdx = 0, rightIdx = text.length, best = 0;
        const suffix = '…';
        const suffixWidth = ctx.measureText(suffix).width;
        const available = Math.max(0, maxTextWidth - suffixWidth);
        if (available <= 6) continue;
        while (leftIdx <= rightIdx) {
          const mid = Math.floor((leftIdx + rightIdx) / 2);
          const slice = text.substring(0, mid);
          if (ctx.measureText(slice).width <= available) {
            best = mid;
            leftIdx = mid + 1;
          } else {
            rightIdx = mid - 1;
          }
        }
        label = best > 0 ? `${text.substring(0, best)}…` : '';
      }

      if (!label) continue;

      const labelWidth = ctx.measureText(label).width;
      const textX = textStyle.align === 'left' ? left + margin
        : textStyle.align === 'right' ? right - margin
          : Math.floor((left + right) / 2);

      let textStart, textEnd;
      if (textStyle.align === 'left') {
        textStart = textX;
        textEnd = textX + labelWidth;
      } else if (textStyle.align === 'right') {
        textStart = textX - labelWidth;
        textEnd = textX;
      } else {
        textStart = textX - labelWidth / 2;
        textEnd = textX + labelWidth / 2;
      }

      // Buffer between adjacent labels to prevent cramped text
      const buffer = 10;
      const collides = occupiedRanges.some(
        r => !(textEnd + buffer < r.start || textStart - buffer > r.end)
      );

      if (collides) {
        // Skip drawing this label because another label already occupies this space
        continue;
      }

      // Smart two-tier positioning: default to bottom tier of the axis bar
      // so era titles never overlap with year numbers and tick marks in the upper tier.
      let textY = bandTop + bandHeight - margin - 2;
      if (textStyle.verticalAlign === 'top') {
        textY = bandTop + margin + 3;
      } else if (textStyle.verticalAlign === 'center') {
        textY = bandTop + Math.floor(bandHeight / 2);
      } else if (textStyle.verticalAlign === 'bottom') {
        textY = bandTop + bandHeight - margin - 2;
      }
      textY += textStyle.offsetY || 0;

      ctx.fillText(label, textX, textY);
      occupiedRanges.push({ start: textStart, end: textEnd });
    }

    ctx.restore();
  };
}

// Convert a hex color (#rgb or #rrggbb) to an rgba string with the given alpha.
function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Helper to tone down timeband background in dark mode
function formatBandBg(color, isDark) {
  if (!color) return isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
  if (typeof color === 'string' && color.startsWith('rgba')) {
    return isDark ? color.replace(/[\d\.]+\)$/, '0.12)') : color;
  }
  if (typeof color === 'string' && color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.12 : 0.09})`;
    }
  }
  return color;
}

function resolveArticleDisplayColor(art, artIdx, isDark, timelineData, themeCategories = []) {
  let cat = art?.category ?? art?.data?.category;
  if (typeof cat === 'object' && cat !== null) {
    cat = cat.en || cat.he || Object.values(cat)[0] || '';
  }
  if (!cat) {
    cat = art?.categoryKey ?? art?.data?.categoryKey ?? art?.theme ?? '';
  }

  // Topic/category is the sole driver of event color, independent of lane/track placement.
  // Topic colors stay the same across light/dark mode (no separate dark palette).
  if (cat) {
    return getCategoryColor(cat, themeCategories);
  }
  return CATEGORY_PALETTE[artIdx % CATEGORY_PALETTE.length];
}

function getTimelineArticleStyle(isDark, isRtl = false) {
  return {
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    color: isDark ? '#18181b' : '#f4f4f5',
    topRadius: 6,
    borderRadius: 6,
    border: {
      color: isDark ? '#3f3f46' : '#d4d4d8',
      width: 1,
    },
    header: {
      height: 54,
      text: {
        font: `600 13px ${CANVAS_FONT}`,
        color: isDark ? '#f4f4f5' : '#09090b',
        align: isRtl ? 'right' : 'left',
        margin: 10,
        lineHeight: 18,
        numberOfLines: 8,
      }
    },
    subheader: {
      height: 26,
      color: isDark ? '#1f1f23' : '#e4e4e7',
      text: {
        font: `500 11px ${CANVAS_FONT}`,
        color: isDark ? '#a1a1aa' : '#71717a',
        align: isRtl ? 'right' : 'left',
        margin: 10,
        lineHeight: 14,
      }
    },
    shadow: {
      x: 0,
      y: 3,
      amount: isDark ? 8 : 4,
      color: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.08)',
    },
    connectorLine: {
      visible: true,
      thickness: 1,
      color: isDark ? '#3f3f46' : '#a1a1aa',
    }
  };
}

function getTimelineArticleNormalStyle(laneColor, isDark, articleStyle) {
  return {
    ...articleStyle,
    color: isDark ? '#141417' : '#ffffff',
    border: {
      color: laneColor,
      width: 1,
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: 1,
    }
  };
}

function getTimelineArticleHoverStyle(laneColor, isDark, articleStyle) {
  return {
    ...articleStyle,
    color: isDark ? '#1c1c20' : '#ffffff',
    backgroundColor: isDark ? '#1c1c20' : '#ffffff',
    border: {
      color: laneColor,
      width: 1.8,
    },
    shadow: {
      x: 0,
      y: 6,
      amount: 14,
      color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: 1.8,
    }
  };
}

function getTimelineArticleActiveStyle(laneColor, isDark, articleStyle) {
  return {
    ...articleStyle,
    color: isDark ? '#27272a' : '#f4f4f5',
    backgroundColor: isDark ? '#27272a' : '#f4f4f5',
    border: {
      color: laneColor,
      width: 2.5,
    },
    shadow: {
      x: 0,
      y: 8,
      amount: 18,
      color: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.22)',
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: 2.5,
    }
  };
}

// Clears any temporary lane highlight indication
export function clearLaneHighlight(timeline) {
  if (!timeline) return;
  timeline._chronixTappedLaneId = null;
  timeline._laneDomNodes?.forEach((laneRefs) => {
    laneRefs?.root?.classList.remove('is-lane-hovered');
  });
}

// ── Manual lane resizing ─────────────────────────────────────────────────────
// Weights are stored as lane pixel heights, so the ratio survives window resizes.
const LANE_RESIZE_MIN_BODY = 56;
const LANE_RESIZE_KEY_STEP = 24;

function readManualLaneWeights(storageKey) {
  if (!storageKey) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const weights = new Map();
    Object.entries(parsed).forEach(([id, w]) => {
      if (Number.isFinite(w) && w > 0) weights.set(String(id), w);
    });
    return weights.size > 0 ? weights : null;
  } catch (e) {
    return null;
  }
}

function persistManualLaneWeights(timeline) {
  const key = timeline?._chronixLaneWeightsKey;
  if (!key) return;
  try {
    const weights = timeline._chronixManualLaneWeights;
    if (weights && weights.size > 0) localStorage.setItem(key, JSON.stringify(Object.fromEntries(weights)));
    else localStorage.removeItem(key);
  } catch (e) { /* storage unavailable */ }
}

// The divider sits on top of `lowerId`'s header; it trades height with the nearest
// expanded lane above it (collapsed lanes in between keep their header height).
function getLaneResizeContext(timeline, lowerId) {
  if (!timeline || typeof timeline._isLaneLayoutActive !== 'function' || !timeline._isLaneLayoutActive()) return null;
  const collapsed = timeline._chronixCollapsedLaneIds || new Set();
  if (collapsed.has(String(lowerId))) return null;
  const active = (timeline.lanes || []).filter((lane) => lane && lane.currentVisibility !== 'hidden' && lane.geometry);
  const lowerIndex = active.findIndex((lane) => String(lane.id) === String(lowerId));
  if (lowerIndex < 0) return null;
  const upper = active.slice(lowerIndex + 1).find((lane) => !collapsed.has(String(lane.id)));
  if (!upper) return null;
  const expanded = active.filter((lane) => !collapsed.has(String(lane.id)));
  const base = new Map(expanded.map((lane) => [String(lane.id), lane.geometry.height]));
  return { lower: active[lowerIndex], upper, expanded, base };
}

function applyLanePairSplit(timeline, ctx, delta) {
  const upperId = String(ctx.upper.id);
  const lowerId = String(ctx.lower.id);
  const startUpper = ctx.base.get(upperId);
  const pair = startUpper + ctx.base.get(lowerId);
  const headerH = Math.max(ctx.upper.geometry.headerHeight || 0, ctx.lower.geometry.headerHeight || 0);
  const minH = Math.min(pair / 2, headerH + LANE_RESIZE_MIN_BODY);
  const nextUpper = Math.min(pair - minH, Math.max(minH, startUpper + delta));
  const weights = new Map(ctx.base);
  weights.set(upperId, nextUpper);
  weights.set(lowerId, pair - nextUpper);
  timeline._chronixManualLaneWeights = weights;
  ctx.expanded.forEach((lane) => {
    lane.setOption('layout.heightWeight', Math.max(1, weights.get(String(lane.id))));
  });
  if (typeof timeline.defaultRedraw === 'function') timeline.defaultRedraw();
  else timeline.redraw();
}

function commitLaneResize(timeline) {
  persistManualLaneWeights(timeline);
  if ((timeline._chronixCardMode || 'auto') === 'auto') syncAutoCardLayouts(timeline);
  if (typeof timeline.defaultRedraw === 'function') timeline.defaultRedraw();
  else timeline.redraw();
}

function resetManualLaneWeights(timeline) {
  if (!timeline?._chronixManualLaneWeights) return;
  timeline._chronixManualLaneWeights = null;
  rebalanceLaneHeights(timeline);
  commitLaneResize(timeline);
}

function beginLaneResize(timeline, lowerId, event) {
  if (event.button != null && event.button !== 0) return;
  const ctx = getLaneResizeContext(timeline, lowerId);
  if (!ctx) return;
  event.preventDefault();
  event.stopPropagation();
  clearLaneHighlight(timeline);
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const startY = event.clientY;
  let pendingY = startY;
  let frame = 0;
  try { handle.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
  handle.classList.add('is-resizing');
  const prevBodyCursor = document.body.style.cursor;
  document.body.style.cursor = 'row-resize';

  const flush = () => {
    frame = 0;
    applyLanePairSplit(timeline, ctx, pendingY - startY);
  };
  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    pendingY = e.clientY;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const onEnd = (e) => {
    if (e.pointerId !== pointerId) return;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    try { handle.releasePointerCapture(pointerId); } catch (err) { /* ignore */ }
    handle.classList.remove('is-resizing');
    document.body.style.cursor = prevBodyCursor;
    if (frame) {
      cancelAnimationFrame(frame);
      flush();
    }
    if (pendingY !== startY) commitLaneResize(timeline);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
}

function ensureLaneResizer(timeline, lane, refs) {
  if (!refs.resizer) {
    const resizer = document.createElement('div');
    resizer.className = 'chronix-lane-resizer';
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'horizontal');
    resizer.tabIndex = 0;
    const grip = document.createElement('span');
    grip.className = 'chronix-lane-resizer-grip';
    resizer.appendChild(grip);
    resizer.addEventListener('pointerdown', (e) => beginLaneResize(timeline, lane.id, e));
    resizer.addEventListener('click', (e) => e.stopPropagation());
    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetManualLaneWeights(timeline);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const ctx = getLaneResizeContext(timeline, lane.id);
      if (!ctx) return;
      e.preventDefault();
      applyLanePairSplit(timeline, ctx, e.key === 'ArrowDown' ? LANE_RESIZE_KEY_STEP : -LANE_RESIZE_KEY_STEP);
      commitLaneResize(timeline);
    });
    refs.root.appendChild(resizer);
    refs.resizer = resizer;
  }
  const resizable = Boolean(getLaneResizeContext(timeline, lane.id));
  refs.resizer.dataset.resizable = resizable ? 'true' : 'false';
  refs.resizer.tabIndex = resizable ? 0 : -1;
  const label = timeline._chronixLaneResizeLabel || '';
  if (refs.resizer.title !== label) {
    refs.resizer.title = label;
    refs.resizer.setAttribute('aria-label', label);
  }
}

// Synchronizes CSS custom variables (--lane-color, --lane-bg, --lane-border) onto lane DOM elements
// and binds interactions so the header can highlight and toggle its lane.
// All lanes share a single cohesive architectural styling (no rainbow lane split).
export function syncLaneDomVariables(timeline, lanesList = [], isDark = false, onLaneHeaderToggle) {
  if (!timeline || !Array.isArray(timeline.lanes)) return;
  if (typeof onLaneHeaderToggle === 'function') {
    timeline._chronixLaneHeaderToggle = onLaneHeaderToggle;
  }
  const unifiedLaneColor = '#71717a';
  const bodyBg = getLaneBodyBg(unifiedLaneColor, isDark);
  const bodyBorder = getLaneBodyBorder(unifiedLaneColor, isDark);

  const totalLanes = timeline.lanes.length;
  timeline.lanes.forEach((lane, laneIndex) => {
    const refs = timeline._laneDomNodes?.get?.(String(lane.id));
    if (refs?.root) {
      // In Histropedia's indexing, laneIndex === totalLanes - 1 is the topmost track on canvas;
      // laneIndex === 0 is the bottommost track on canvas meeting the ruler.
      const isTopLane = laneIndex === totalLanes - 1;
      const isBottomLane = laneIndex === 0;
      refs.root.dataset.isFirstLane = isTopLane ? 'true' : 'false';
      refs.root.dataset.isLastLane = isBottomLane ? 'true' : 'false';

      refs.root.style.setProperty('--lane-color', unifiedLaneColor);
      refs.root.style.setProperty('--lane-bg', bodyBg);
      refs.root.style.setProperty('--lane-border', bodyBorder);
      refs.root.classList.toggle('is-lane-hovered', String(timeline._chronixTappedLaneId) === String(lane.id));

      if (refs.header) {
        const isCollapsed = timeline._chronixCollapsedLaneIds?.has(String(lane.id)) || false;
        refs.root.classList.toggle('is-lane-collapsed', isCollapsed);
        ensureLaneResizer(timeline, lane, refs);

        if (refs.header._chronixInteractionsBound) return;
        refs.header._chronixInteractionsBound = true;
        const hasFinePointer = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
        if (hasFinePointer) {
          refs.header.addEventListener('mouseenter', () => {
            refs.root.classList.add('is-lane-hovered');
          });
          refs.header.addEventListener('mouseleave', () => {
            if (String(timeline._chronixTappedLaneId) !== String(lane.id)) {
              refs.root.classList.remove('is-lane-hovered');
            }
          });
        }
        const toggleLane = (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearLaneHighlight(timeline);
          timeline._chronixLaneHeaderToggle?.(lane.id);
        };
        refs.header.addEventListener('click', toggleLane);
      }
    }
  });
}

function updateTimelineTheme(timeline, isDark, timelineData, isRtl = false) {
  if (!timeline) return;

  window.__chronixDarkTheme = isDark;
  window.__chronixIsRtl = Boolean(isRtl);
  timeline._isDarkTheme = isDark;
  const articleStyle = getTimelineArticleStyle(isDark, isRtl);

  // 1. Timescale markers and date labels
  try {
    timeline.setOption('style.dateLabel.minor.color', isDark ? '#a1a1aa' : '#71717a');
    timeline.setOption('style.dateLabel.major.color', isDark ? '#f4f4f5' : '#09090b');
    timeline.setOption('style.marker.minor.color', isDark ? '#71717a' : '#a1a1aa');
    timeline.setOption('style.marker.major.color', isDark ? '#a1a1aa' : '#52525b');
    timeline.setOption('style.draggingHighlight.visible', false);
    if (timeline.options?.style?.draggingHighlight) {
      timeline.options.style.draggingHighlight.visible = false;
    }

    // 2. Lane default styles
    timeline.setOption('lane.gap', 0);
    timeline.setOption('lane.topGap', 0);
    timeline.setOption('lane.defaultStyle.header.backgroundColor', isDark ? '#161619' : '#f7f7f8');
    timeline.setOption('lane.defaultStyle.body.backgroundColor', 'transparent');
    timeline.setOption('lane.defaultStyle.title.color', isDark ? '#f4f4f6' : '#27272a');

    // 3. Article default styles
    timeline.setOption('article.defaultStyle', articleStyle);
    timeline.setOption('article.defaultHoverStyle', {
      backgroundColor: isDark ? '#1c1c20' : '#ffffff',
      border: { width: 1.8 },
      shadow: {
        x: 0,
        y: 6,
        amount: 14,
        color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
      }
    });
    timeline.setOption('article.defaultActiveStyle', {
      backgroundColor: isDark ? '#27272a' : '#f4f4f5',
      border: { width: 2.5 }
    });
    timeline.setOption('article.layoutStyles.landscape.style.header.text.color', isDark ? '#f4f4f5' : '#09090b');
    timeline.setOption('article.layoutStyles.landscape.style.subheader.text.color', isDark ? '#a1a1aa' : '#71717a');
    timeline.setOption('article.layoutStyles.landscape.hoverStyle.header.text.color', isDark ? '#f4f4f5' : '#09090b');
    timeline.setOption('article.layoutStyles.landscape.activeStyle.header.text.color', isDark ? '#f4f4f5' : '#09090b');
  } catch (e) {
    console.warn('Error updating timeline theme options:', e);
  }

  // 4. Update active lanes with crisp transparent background (100% sharp canvas)
  if (Array.isArray(timeline.lanes)) {
    const lanesList = timelineData?.lanes || [];
    timeline.lanes.forEach((lane) => {
      if (lane.style?.body) {
        lane.style.body.backgroundColor = 'transparent';
      }
      if (lane.data?.style?.body) {
        lane.data.style.body.backgroundColor = 'transparent';
      }
      if (lane.style?.header) {
        lane.style.header.backgroundColor = isDark ? '#161619' : '#f7f7f8';
      }
      if (lane.data?.style?.header) {
        lane.data.style.header.backgroundColor = isDark ? '#161619' : '#f7f7f8';
      }
    });
    if (typeof timeline._syncLaneDom === 'function') {
      try {
        timeline._syncLaneDom();
      } catch (e) { }
    }
    syncLaneDomVariables(timeline, lanesList, isDark);
  }

  // 5. Update time bands
  if (Array.isArray(timeline.timeBands)) {
    timeline.timeBands.forEach((tb) => {
      const rawColor = tb.data?.color || tb.color;
      const bg = formatBandBg(rawColor, isDark);
      const textColor = isDark ? '#f4f4f5' : '#3f3f46';
      if (tb.style) {
        tb.style.background = bg;
        if (tb.style.text) {
          tb.style.text.color = textColor;
          tb.style.text.verticalAlign = 'bottom';
        }
      }
      if (tb.data?.style) {
        tb.data.style.background = bg;
        if (tb.data.style.text) {
          tb.data.style.text.color = textColor;
          tb.data.style.text.verticalAlign = 'bottom';
        }
      }
    });
  }

  // 6. Update articles
  if (Array.isArray(timeline.articles) && timelineData) {
    // Coloring is driven by topic/category whenever the timeline has 2+ distinct themes,
    // independent of how many parallel timelines (lanes) it's split into - lane only
    // controls vertical placement, category alone controls color.
    const themeCategories = getDistinctCategories(timelineData.articles || []);
    const colorByTheme = themeCategories.length >= 2;

    timeline.articles.forEach((art, artIdx) => {
      const laneColor = resolveArticleDisplayColor(art, artIdx, isDark, timelineData, themeCategories, colorByTheme);
      const normalStyle = getTimelineArticleNormalStyle(laneColor, isDark, articleStyle);
      const hoverStyle = getTimelineArticleHoverStyle(laneColor, isDark, articleStyle);
      const activeStyle = getTimelineArticleActiveStyle(laneColor, isDark, articleStyle);

      art.style = normalStyle;
      art.hoverStyle = hoverStyle;
      art.activeStyle = activeStyle;
      const rawArt = timelineData.articles?.find((a) => isSameArticleId(a.id, art.id));
      if (rawArt) {
        const isEd = Boolean(rawArt.isEdited || rawArt.is_edited || rawArt.isManuallyEdited || rawArt.is_manually_edited);
        art.isEdited = isEd;
        if (art.data) art.data.isEdited = isEd;
        art.editedAt = rawArt.editedAt || rawArt.edited_at;
      }
      if (art.data) {
        art.data.style = normalStyle;
        art.data.hoverStyle = hoverStyle;
        art.data.activeStyle = activeStyle;
      }
      if (typeof art.initialiseStyles === 'function') {
        try {
          art.initialiseStyles(art.data);
        } catch (e) { }
      }
      if (typeof art.invalidateCaches === 'function') {
        art.invalidateCaches();
      }
    });
  }

  // 7. Redraw canvas in-place without altering zoom or camera position
  try {
    timeline.redraw();
  } catch (e) {
    console.warn('Error redrawing timeline after theme change:', e);
  }
}

// Horizontal camera state; unchanged since the last fit means the user hasn't panned/zoomed.
function getViewSignature(tl) {
  const v = tl?.timescaleManager?.startToken?.value;
  if (!v) return null;
  return `${tl.getZoom()}|${v.year}|${v.month}|${v.day}|${Math.round((tl.repositionWindow || 0) * 100)}`;
}

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  onFocusArticle,
  selectedArticleId,
  starredArticleIds,
  filterStarredOnly = false,
  activeFilter = null,
  onToggleStar,
  theme = 'light',
  // Exploration mode (desktop): entry button + floating HUD are rendered only when these are provided
  isExploring = false,
  exploreProgress = null,
  onStartExplore,
  onExploreNext,
  onExplorePrev,
  onExitExplore,
  // Notified with (items, mode) whenever lane/theme filters change, so the geo map
  // and guided exploration stay in sync with the timeline's visible subset.
  onFilterChange,
  // Indicates if a right-side drawer (EventDrawer or CardsListDrawer) is currently open.
  hasRightDrawer = false,
  isNarrowViewport = false,
  hoveredArticleId = null,
  onHoverArticle,
  densityMode = 'auto',
}, ref) => {
  const { t, isRtl } = useLanguage();
  const containerRef = useRef(null);
  const timelineInstanceRef = useRef(null);
  // { signature, padding } of the last fit-to-all; cleared implicitly once the view moves.
  const lastFitRef = useRef(null);
  const fitAllArticles = (tl, padding) => {
    tl.fitArticles({ padding });
    lastFitRef.current = { signature: getViewSignature(tl), padding };
  };
  const themeRef = useRef(theme);
  const prevThemeRef = useRef(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  const densityModeRef = useRef(densityMode);
  useEffect(() => {
    densityModeRef.current = densityMode;
  }, [densityMode]);
  const isNarrowViewportRef = useRef(isNarrowViewport);
  useEffect(() => {
    isNarrowViewportRef.current = isNarrowViewport;
  }, [isNarrowViewport]);
  const onFocusArticleRef = useRef(onFocusArticle);
  useEffect(() => {
    onFocusArticleRef.current = onFocusArticle;
  }, [onFocusArticle]);
  const onHoverArticleRef = useRef(onHoverArticle);
  useEffect(() => {
    onHoverArticleRef.current = onHoverArticle;
  }, [onHoverArticle]);
  const isExploringRef = useRef(isExploring);
  useEffect(() => {
    isExploringRef.current = isExploring;
  }, [isExploring]);
  // Mobile two-tap-to-open: id of the event brought to the foreground by the first tap.
  // A second tap on that same event opens its details drawer.
  const mobileFocusedArticleIdRef = useRef(null);
  // Set when a long press has already opened the drawer, so the click fired on
  // release (if any) is ignored instead of being treated as a normal tap.
  const longPressConsumedRef = useRef(false);
  // Pending long-press timer for the current touch gesture.
  const longPressTimerRef = useRef(null);
  const starredArticleIdsRef = useRef(starredArticleIds);
  const savedViewportRef = useRef(null);

  // Active lane AND category filters (each empty = show all for that dimension).
  // The two dimensions are independent and always combined with AND semantics.
  // State drives the filter UI; refs let imperative + load handlers read the
  // latest values without stale closures.
  const [activeLaneFilterIds, setActiveLaneFilterIds] = useState(
    () => activeFilter?.laneItems?.map((item) => item.id) || []
  );
  const [activeCategoryFilterIds, setActiveCategoryFilterIds] = useState(
    () => activeFilter?.categoryItems?.map((item) => item.id) || []
  );
  const activeLaneFiltersRef = useRef(activeFilter?.laneItems || []);
  const activeCategoryFiltersRef = useRef(activeFilter?.categoryItems || []);
  const filterStarredOnlyRef = useRef(filterStarredOnly);

  useEffect(() => {
    starredArticleIdsRef.current = starredArticleIds;
  }, [starredArticleIds]);


  // Filter items for the two independent filter dimensions: `lane` (which parallel
  // timeline/track an event sits in) and `category` (topic - drives its color). Both are
  // computed unconditionally so the side menu can offer simultaneous filtering by either
  // or both at once. Computed here (rather than near the render) so the imperative
  // `setLegendFilter` handle below can look items up by id for external controls.
  // NOTE: these are used only for internal matching/sync (never rendered by TimelineView
  // itself - LeftDockMenu computes its own cross-filtered counts for display), so they must
  // stay stable across renders. They MUST NOT depend on activeLaneFilterIds/
  // activeCategoryFilterIds: doing so previously created a feedback loop with the
  // sync-from-parent effect below (whose deps include these lists), causing an infinite
  // re-render/redraw flicker every time a filter was toggled.
  const lanesArr = useMemo(() => timelineData?.lanes || [], [timelineData]);
  const legendCategories = useMemo(
    () => getDistinctCategories(timelineData?.articles || []),
    [timelineData]
  );

  const categoryFilterItems = useMemo(() => {
    const articles = timelineData?.articles || [];
    if (legendCategories.length < 1) return [];
    return legendCategories.map((name) => {
      const key = name.toLowerCase();
      const count = articles.filter(
        (a) => (a?.category ?? '').toString().trim().toLowerCase() === key
      ).length;
      return {
        id: name,
        name,
        color: getCategoryColor(name, legendCategories),
        matchKeys: [name],
        count,
      };
    });
  }, [legendCategories, timelineData]);

  const laneFilterItems = useMemo(() => {
    const articles = timelineData?.articles || [];
    if (lanesArr.length < 2) return [];
    return lanesArr.map((lane, idx) => {
      const matchKeys = [];
      if (lane.id !== undefined && lane.id !== null) matchKeys.push(lane.id);
      if (lane.title) matchKeys.push(lane.title);
      const normalizedKeys = matchKeys.map((k) => String(k).toLowerCase().trim());
      const count = articles.filter((a) =>
        normalizedKeys.includes(String(a?.lane ?? '').toLowerCase().trim())
      ).length;
      return {
        id: String(lane.id ?? lane.title ?? idx),
        name: lane.title || lane.name || `Lane ${idx + 1}`,
        color: null,
        matchKeys,
        count,
      };
    });
  }, [lanesArr, timelineData]);

  const handleLaneHeaderToggle = useCallback((laneId) => {
    const item = laneFilterItems.find((candidate) =>
      String(candidate.id) === String(laneId) ||
      candidate.matchKeys.some((key) => String(key) === String(laneId))
    );
    if (!item) return;

    const selectedItems = activeLaneFiltersRef.current;
    const isVisible = selectedItems.length === 0 || selectedItems.some(
      (selected) => String(selected.id) === String(item.id)
    );
    let nextItems;

    if (isVisible) {
      const visibleItems = selectedItems.length > 0 ? selectedItems : laneFilterItems;
      nextItems = visibleItems.filter((selected) => String(selected.id) !== String(item.id));
      if (nextItems.length === 0) nextItems = [];
    } else {
      nextItems = [...selectedItems, item];
      if (nextItems.length === laneFilterItems.length) nextItems = [];
    }

    activeLaneFiltersRef.current = nextItems;
    setActiveLaneFilterIds(nextItems.map((selected) => String(selected.id)));
  }, [laneFilterItems]);

  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (!tl) return;
    tl._chronixLaneResizeLabel = t('legend.resizeLanes');
    if (typeof tl._syncLaneDom === 'function') tl._syncLaneDom();
  }, [t]);

  // Applies the starred-only filter AND both lane+category filters (all combined with
  // AND semantics) to the canvas via each article's `hiddenByFilter` option, then refits.
  const applyVisibilityFilters = useCallback(() => {
    const tl = timelineInstanceRef.current;
    if (!tl || !tl.articles) return;
    const starredOnly = filterStarredOnlyRef.current;
    const ids = starredArticleIdsRef.current || new Set();
    const selectedLaneItems = activeLaneFiltersRef.current;
    const selectedCategoryItems = activeCategoryFiltersRef.current;

    tl.articles.forEach((art) => {
      let hidden = false;
      if (starredOnly && !ids.has(art.id)) hidden = true;
      if (!hidden && selectedLaneItems.length > 0) {
        const laneValue = art.data?.lane ?? art.lane;
        if (!selectedLaneItems.some((item) => item.matchKeys.includes(laneValue))) hidden = true;
      }
      if (!hidden && selectedCategoryItems.length > 0) {
        const categoryValue = art.data?.category ?? art.category ?? '';
        if (!selectedCategoryItems.some((item) => item.matchKeys.includes(categoryValue))) hidden = true;
      }
      art.setOption('hiddenByFilter', hidden);
    });

    // In split timelines, collapse the body of filtered-out lanes down to their
    // colored header stripe (fixed height) so the selected lane(s) - left on auto
    // height - expand to absorb the freed space.
    if (Array.isArray(tl.lanes)) {
      const collapsedLaneIds = new Set();
      tl.lanes.forEach((lane) => {
        const isSelected = selectedLaneItems.length === 0 || selectedLaneItems.some((item) =>
          item.matchKeys.includes(lane.id) ||
          item.matchKeys.includes(lane.title) ||
          String(item.id) === String(lane.id)
        );
        if (isSelected) {
          lane.setOption('layout.height', null);
        } else {
          collapsedLaneIds.add(String(lane.id));
          const headerH = lane.layout?.header?.height ?? 28;
          lane.setOption('layout.height', headerH);
        }
      });
      tl._chronixCollapsedLaneIds = collapsedLaneIds;
    }

    // A full redraw also refreshes the density groups of the newly shown events, so the
    // lane plans below see exactly the cards that will be stacked.
    if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
    else tl.redraw();
    if (rebalanceLaneHeights(tl)) tl.redraw();

    // Lane collapse/restore changes vertical space without resizing the container, so the
    // ResizeObserver does not run. Re-evaluate portrait vs landscape against the newly
    // committed lane geometry instead of waiting for a side panel or event drawer resize.
    const currentDensity = densityModeRef.current;
    if (currentDensity === 'auto') {
      if (syncAutoCardLayouts(tl)) {
        if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
        else tl.redraw();
      }
    } else if ((currentDensity === 'compact' || currentDensity === 'small') && tl._selectedArticleId && Array.isArray(tl.articles)) {
      const activeArt = tl.articles.find((a) => a && isSameArticleId(a.id, tl._selectedArticleId));
      if (activeArt && typeof activeArt.setCardLayout === 'function') {
        const targetLayout = getSelectedCardLayoutForMode(tl, activeArt, currentDensity);
        const currentLayout = typeof activeArt._getCurrentCardLayoutName === 'function' ? activeArt._getCurrentCardLayoutName() : activeArt._resolvedCardLayoutName;
        if (currentLayout !== targetLayout) {
          activeArt.setCardLayout(targetLayout);
          if (typeof activeArt.invalidateCaches === 'function') activeArt.invalidateCaches();
          if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
          else tl.redraw();
        }
      }
    }
  }, []);

  // Restore selections supplied by App after a canvas/layout remount (such as the
  // split view entered for an interactive tour).
  useEffect(() => {
    const selectedLaneIds = activeFilter?.laneItems?.map((item) => String(typeof item === 'object' ? item.id : item)) || [];
    const selectedLaneItems = laneFilterItems.filter((item) => selectedLaneIds.includes(String(item.id)));
    activeLaneFiltersRef.current = selectedLaneItems;
    // `activeFilter` is derived from `activeLaneFilterIds`/`activeCategoryFilterIds` (pushed out
    // via onFilterChange), so only sync back when the selection genuinely differs - otherwise
    // returning the previous reference lets React bail out and breaks the feedback loop.
    setActiveLaneFilterIds((prev) => (sameIdSet(prev, selectedLaneIds) ? prev : selectedLaneIds));

    const selectedCategoryIds = activeFilter?.categoryItems?.map((item) => String(typeof item === 'object' ? item.id : item)) || [];
    const selectedCategoryItems = categoryFilterItems.filter((item) => selectedCategoryIds.includes(String(item.id)));
    activeCategoryFiltersRef.current = selectedCategoryItems;
    setActiveCategoryFilterIds((prev) => (sameIdSet(prev, selectedCategoryIds) ? prev : selectedCategoryIds));

    applyVisibilityFilters();
  }, [activeFilter, laneFilterItems, categoryFilterItems, applyVisibilityFilters]);

  useEffect(() => {
    if (filterStarredOnlyRef.current === filterStarredOnly) return;
    filterStarredOnlyRef.current = filterStarredOnly;
    applyVisibilityFilters();
  }, [filterStarredOnly, applyVisibilityFilters]);

  // Toggles a single item within one filter dimension ('lane' | 'category'); null clears that dimension.
  const handleFilterSelect = (dimension, item) => {
    const ref = dimension === 'category' ? activeCategoryFiltersRef : activeLaneFiltersRef;
    const setIds = dimension === 'category' ? setActiveCategoryFilterIds : setActiveLaneFilterIds;
    const nextItems = item
      ? ref.current.some((selected) => String(selected.id) === String(item.id))
        ? ref.current.filter((selected) => String(selected.id) !== String(item.id))
        : [...ref.current, item]
      : [];
    ref.current = nextItems;
    setIds(nextItems.map((selected) => String(selected.id)));
  };

  // Re-apply whenever either active filter selection changes.
  useEffect(() => {
    applyVisibilityFilters();
  }, [activeLaneFilterIds, activeCategoryFilterIds, applyVisibilityFilters]);


  // Synchronize external selection with Histropedia canvas instance
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (tl) {
      tl._selectedArticleId = selectedArticleId || null;
      const currentDensity = densityModeRef.current;
      const isCompact = currentDensity === 'compact';
      const isSmall = currentDensity === 'small';
      const isExpandableMode = isCompact || isSmall;
      const baseLayout = isSmall ? 'landscape' : 'compact';

      if (selectedArticleId) {
        try {
          if (tl.articles) {
            tl.articles.forEach((a) => {
              const isMatch = isSameArticleId(a.id, selectedArticleId);
              a.isActive = isMatch;
              if (isExpandableMode && typeof a.setCardLayout === 'function') {
                if (isMatch) {
                  const targetLayout = getSelectedCardLayoutForMode(tl, a, currentDensity);
                  triggerCardExpandAnimation(tl, a, targetLayout);
                } else {
                  a.setCardLayout(baseLayout);
                  delete a._expandAnim;
                  delete a._compactTop;
                  delete a._unexpandedTop;
                }
                if (typeof a.invalidateCaches === 'function') {
                  a.invalidateCaches();
                }
              }
            });
          }
          tl.select(selectedArticleId);
          tl.bringFront(selectedArticleId);
        } catch (e) {
          // ignore
        }
      } else {
        if (tl.articles) {
          tl.articles.forEach((a) => {
            a.isActive = false;
            if (isExpandableMode && typeof a.setCardLayout === 'function') {
              a.setCardLayout(baseLayout);
              delete a._expandAnim;
              delete a._compactTop;
              delete a._unexpandedTop;
              if (typeof a.invalidateCaches === 'function') {
                a.invalidateCaches();
              }
            }
          });
        }
        mobileFocusedArticleIdRef.current = null;
      }
      tl.redraw();
    }
  }, [selectedArticleId]);

  // Synchronize incoming hoveredArticleId from map or external component with canvas
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (tl && tl.articles) {
      let changed = false;
      tl.articles.forEach((a) => {
        const isHovered = hoveredArticleId ? isSameArticleId(a.id, hoveredArticleId) : false;
        if (a.isMouseover !== isHovered) {
          a.isMouseover = isHovered;
          changed = true;
        }
      });
      if (changed) {
        tl.redraw();
      }
    }
  }, [hoveredArticleId]);

  useImperativeHandle(ref, () => ({
    clearMobileFocus: () => {
      mobileFocusedArticleIdRef.current = null;
      const tl = timelineInstanceRef.current;
      if (tl) {
        tl._selectedArticleId = null;
        const currentDensity = densityModeRef.current;
        const isCompact = currentDensity === 'compact';
        const isSmall = currentDensity === 'small';
        const isExpandableMode = isCompact || isSmall;
        const baseLayout = isSmall ? 'landscape' : 'compact';
        if (isExpandableMode && Array.isArray(tl.articles)) {
          tl.articles.forEach((a) => {
            a.isActive = false;
            if (typeof a.setCardLayout === 'function') {
              a.setCardLayout(baseLayout);
              delete a._expandAnim;
              delete a._compactTop;
              delete a._unexpandedTop;
            }
            if (typeof a.invalidateCaches === 'function') {
              a.invalidateCaches();
            }
          });
          tl.redraw();
        }
      }
    },
    zoomIn: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(Math.max(0, currentZoom - 4));
      }
    },
    zoomOut: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(currentZoom + 4);
      }
    },
    fitAll: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        fitAllArticles(tl, 60);
      }
    },
    focusArticle: (articleId, opts = {}) => {
      mobileFocusedArticleIdRef.current = articleId;
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        tl._selectedArticleId = articleId;
        const currentDensity = densityModeRef.current;
        const isCompact = currentDensity === 'compact';
        const isSmall = currentDensity === 'small';
        const isExpandableMode = isCompact || isSmall;
        const keepAllCompact = isCompact && (isExploringRef.current || opts.keepCompact);
        tl.bringFront(articleId);
        if (isExpandableMode && Array.isArray(tl.articles)) {
          const baseLayout = isSmall ? 'landscape' : 'compact';
          tl.articles.forEach((a) => {
            const isMatch = isSameArticleId(a.id, articleId);
            a.isActive = isMatch;
            if (typeof a.setCardLayout === 'function') {
              if (keepAllCompact) {
                a.setCardLayout('compact');
                delete a._expandAnim;
                delete a._compactTop;
                delete a._unexpandedTop;
              } else if (isMatch) {
                const targetLayout = getSelectedCardLayoutForMode(tl, a, currentDensity);
                triggerCardExpandAnimation(tl, a, targetLayout);
              } else {
                a.setCardLayout(baseLayout);
                delete a._expandAnim;
                delete a._compactTop;
                delete a._unexpandedTop;
              }
            }
            if (typeof a.invalidateCaches === 'function') {
              a.invalidateCaches();
            }
          });
        }
        const art = tl.getArticleById(articleId);
        if (art) {
          const canvasW = containerRef.current?.clientWidth || tl.getWidth() || 0;
          const isWide = canvasW > 760;
          const minVisibleX = isWide ? 60 : 30;
          const maxVisibleX = isWide ? canvasW - 450 : canvasW - 30;

          // Check if article's card or indicator is already comfortably in the visible region
          let indicatorX = typeof art.indicator?.fromX === 'number' ? art.indicator.fromX : null;
          if (indicatorX === null && art.period?.from) {
            try {
              indicatorX = tl.getPixel(art.period.from);
            } catch (e) { }
          }
          const cardLeft = typeof art.position?.left === 'number' ? art.position.left : indicatorX;
          const cardWidth = typeof art.getWidth === 'function' ? art.getWidth() : 200;
          const cardRight = typeof cardLeft === 'number' ? cardLeft + cardWidth : null;

          const isCardInView = typeof cardLeft === 'number' && cardLeft >= minVisibleX && cardRight <= maxVisibleX;
          const isIndicatorInView = indicatorX === null || (indicatorX >= minVisibleX && indicatorX <= maxVisibleX);
          const isAlreadyVisible = art.isInView && isCardInView && isIndicatorInView;

          // If not already comfortably visible in the canvas viewport, smoothly pan to center it.
          // Maintain user's existing zoom level and layout - never call fitDateRange which resets zoom.
          if (!isAlreadyVisible || opts.forceCenter) {
            const date = art.period?.from || art.data?.from || art.from;
            if (date) {
              const targetPad = isWide ? Math.max(100, (canvasW - 420) / 2) : canvasW / 2;
              const useAnimation = opts.animate !== false;
              try {
                tl.setStartDate(date, {
                  padding: targetPad,
                  ...(useAnimation ? { animation: { active: true, duration: 420, easing: 'swing' } } : {})
                });
              } catch (e) {
                try {
                  tl.setCentreDate(date);
                } catch (err) { }
              }
            }
          }

          try {
            if (tl.articles) {
              tl.articles.forEach((a) => {
                a.isActive = isSameArticleId(a.id, articleId);
              });
            }
            tl.select(articleId);
            tl.bringFront(articleId);
          } catch (e) {
            // ignore
          }
          tl.redraw();

          setTimeout(() => {
            const currentTl = timelineInstanceRef.current;
            if (currentTl && isSameArticleId(currentTl._selectedArticleId, articleId)) {
              try {
                currentTl.bringFront(articleId);
                const a = currentTl.getArticleById(articleId);
                if (a) a.isActive = true;
                currentTl.redraw();
              } catch (e) { }
            }
          }, 450);
        }
      }
    },
    // Ids of articles currently passing the lane/theme + starred filters, for exploration ordering.
    getVisibleArticleIds: () => {
      const tl = timelineInstanceRef.current;
      if (!tl?.articles) return null;
      return tl.articles.filter((a) => !a.isHiddenByFilter).map((a) => a.id);
    },
    setArticleStarred: (articleId, isStarred) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        const art = tl.getArticleById(articleId);
        if (art) {
          art.setOption('starred', isStarred);
          tl.redraw();
        }
      }
    },
    setFilterStarredOnly: (onlyStarred, currentStarredIds) => {
      filterStarredOnlyRef.current = onlyStarred;
      if (currentStarredIds) starredArticleIdsRef.current = currentStarredIds;
      applyVisibilityFilters();
    },
    // Toggles a filter item within one dimension ('lane' | 'category') from an external control.
    setLegendFilter: (dimension, itemId) => {
      const items = dimension === 'category' ? categoryFilterItems : laneFilterItems;
      const item = itemId != null ? (items.find((f) => String(f.id) === String(itemId)) || null) : null;
      handleFilterSelect(dimension, item);
    },
    getCanvas: () => {
      return timelineInstanceRef.current?.canvas || null;
    },
    redraw: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        if (containerRef.current) {
          const w = containerRef.current.clientWidth;
          const h = containerRef.current.clientHeight;
          if (w > 0 && h > 0) {
            try {
              tl.setSize(w, h);
              if (typeof tl._updateLaneLayout === 'function') {
                tl._updateLaneLayout();
              }
            } catch (e) {}
          }
        }
        tl.redraw();
      }
    },
    clearFocus: () => {
      mobileFocusedArticleIdRef.current = null;
      if (timelineInstanceRef.current) {
        timelineInstanceRef.current._selectedArticleId = null;
        if (Array.isArray(timelineInstanceRef.current.articles)) {
          timelineInstanceRef.current.articles.forEach((a) => {
            if (a) a.isActive = false;
          });
        }
        timelineInstanceRef.current.redraw();
      }
    }
  }));

  // Reset mobile focused article ref whenever selection is cleared from parent
  useEffect(() => {
    if (!selectedArticleId) {
      mobileFocusedArticleIdRef.current = null;
    }
  }, [selectedArticleId]);

  useEffect(() => {
    if (!containerRef.current || !timelineData) return;

    const container = containerRef.current;
    container.innerHTML = '';
    lastFitRef.current = null;

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 600;

    const isDark = themeRef.current === 'dark';
    prevThemeRef.current = themeRef.current;

    // Find a reasonable initial date, or restore saved viewport for the same timeline
    let initialDate = { year: 1950, month: 1, day: 1 };
    const savedViewport = savedViewportRef.current;
    if (savedViewport && savedViewport.timelineId === timelineData?.id && savedViewport.date) {
      initialDate = savedViewport.date;
    } else if (timelineData.articles && timelineData.articles.length > 0) {
      let earliest = timelineData.articles[0];
      for (let i = 1; i < timelineData.articles.length; i++) {
        const art = timelineData.articles[i];
        if (compareEventDates(art, earliest, false, false) < 0) {
          earliest = art;
        }
      }
      if (earliest && earliest.from) {
        initialDate = {
          year: earliest.from.year,
          month: earliest.from.month || 1,
          day: earliest.from.day || 1,
        };
      }
    }

    const articleStyle = getTimelineArticleStyle(isDark, isRtl);

    try {
      const options = {
        width,
        height,
        initialDate,
        disableBranding: true,
        enableUserControl: true,
        enableCursor: true,
        verticalOffset: 42,
        style: {
          mainLine: {
            visible: true,
            size: 5,
          },
          draggingHighlight: {
            visible: false,
          },
          dateLabel: {
            minor: {
              color: isDark ? '#a1a1aa' : '#71717a',
              font: `500 10px ${CANVAS_FONT}`,
            },
            major: {
              color: isDark ? '#f4f4f5' : '#09090b',
              font: `600 12px ${CANVAS_FONT}`,
            }
          },
          marker: {
            minor: {
              height: 7,
              color: isDark ? '#71717a' : '#a1a1aa',
            },
            major: {
              height: 14,
              color: isDark ? '#a1a1aa' : '#52525b',
            }
          }
        },
        lane: {
          visible: true,
          gap: 0,
          topGap: 0,
          axisGap: 0,
          defaultStyle: {
            header: {
              backgroundColor: isDark ? 'rgba(22, 22, 25, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            },
            body: {
              backgroundColor: isDark ? 'rgba(22, 22, 25, 0.45)' : 'rgba(240, 240, 242, 0.45)',
              borderColor: isDark ? 'rgba(42, 42, 47, 0.6)' : 'rgba(228, 228, 231, 0.8)',
            },
            title: {
              color: isDark ? '#f4f4f5' : '#18181b',
              font: `600 11px ${CANVAS_FONT}`,
            }
          }
        },
        timeBand: {
          visible: true,
          reserveSpace: false,
          reserveSpacePixels: 0,
        },
        article: {
          ...(densityMode === 'auto' ? {
            defaultCardLayout: 'portrait',
            cardLayoutBreakpoints: VISUAL_CARD_LAYOUT_BREAKPOINTS,
          } : {
            cardLayout: getCardLayoutForMode(null, null, densityMode),
            defaultCardLayout: getCardLayoutForMode(null, null, densityMode),
          }),
          draggable: true,
          distanceToBaseline: {
            value: densityMode === 'compact' ? 70 : (densityMode === 'small' ? 120 : 350),
            responsive: {
              active: true,
              lanesOnly: true,
              byCardLayout: {
                portrait: { ratio: 0.62, min: 340, max: 380 },
                landscape: { ratio: 0.58, min: 102, max: 170 },
                compact: { ratio: 0.28, min: 60, max: 88 }
              }
            }
          },
          autoStacking: {
            active: true,
            fitToHeight: densityMode !== 'compact',
            rowSpacing: densityMode === 'compact' ? 58 : 40,
            topGap: densityMode === 'compact' ? 20 : 10,
          },
          periodLine: {
            thickness: 8,
            spacing: 4,
          },
          defaultStyle: articleStyle,
          defaultHoverStyle: {
            backgroundColor: isDark ? '#1f1f23' : '#ffffff',
            border: {
              width: 1.8,
            },
            shadow: {
              x: 0,
              y: 6,
              amount: 14,
              color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
            }
          },
          defaultActiveStyle: {
            backgroundColor: isDark ? '#27272a' : '#f4f4f5',
            border: {
              width: 2.5,
            }
          },
          layoutStyles: {
            landscape: {
              style: {
                width: LANDSCAPE_CARD_WIDTH,
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
                    font: `600 11.5px ${CANVAS_FONT}`,
                    margin: 6,
                    lineHeight: 15,
                    numberOfLines: 10,
                  }
                },
                subheader: {
                  text: {
                    color: isDark ? '#a1a1aa' : '#71717a',
                    font: `500 10px ${CANVAS_FONT}`,
                    margin: 6,
                    lineHeight: 13,
                  }
                }
              },
              hoverStyle: {
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
                    font: `600 11.5px ${CANVAS_FONT}`,
                  }
                }
              },
              activeStyle: {
                header: {
                  text: {
                    color: isDark ? '#f4f4f5' : '#09090b',
                    font: `600 11.5px ${CANVAS_FONT}`,
                  }
                },
                subheader: {
                  text: {
                    color: isDark ? '#a1a1aa' : '#71717a',
                    font: `500 10px ${CANVAS_FONT}`,
                  }
                }
              }
            }
          }
        }
      };

      const timeline = new Timeline(container, options);
      timelineInstanceRef.current = timeline;
      window.__timeline = timeline;
      timeline._chronixCardMode = densityMode;
      timeline._chronixLaneResizeLabel = t('legend.resizeLanes');
      timeline._chronixLaneWeightsKey = timelineData?.id ? `chronix_lane_weights_${timelineData.id}` : null;
      timeline._chronixManualLaneWeights = readManualLaneWeights(timeline._chronixLaneWeightsKey);
      trackNaturalImageAspects(timeline);

      if (savedViewport && savedViewport.timelineId === timelineData?.id && savedViewport.zoom != null && typeof timeline.setZoom === 'function') {
        try {
          timeline.setZoom(savedViewport.zoom);
        } catch (e) { }
      }

      // Ensure narrative anchors (chronologically earliest & latest events) remain visible
      // in density-bucketed viewports so the timeline never feels like it starts in the middle.
      const originalUpdateVisibleArticlesOfGroups = timeline.updateVisibleArticlesOfGroups;
      if (typeof originalUpdateVisibleArticlesOfGroups === 'function') {
        timeline.updateVisibleArticlesOfGroups = function (drawCycleContext) {
          originalUpdateVisibleArticlesOfGroups.call(this, drawCycleContext);
          if (Array.isArray(this.articles)) {
            for (let i = 0; i < this.articles.length; i++) {
              const art = this.articles[i];
              if (art && (art.isAnchor || art.data?.isAnchor) && !art.isHiddenByFilter) {
                art.isVisibleInGroup = true;
              }
            }
          }
        };
      }

      window.__chronixDarkTheme = isDark;
      window.__chronixIsRtl = Boolean(isRtl);
      timeline._isDarkTheme = isDark;
      timeline._isNarrowViewport = isNarrowViewportRef.current;
      const instanceLandscape = typeof timeline.getCardLayout === 'function' ? timeline.getCardLayout('landscape') : null;
      if (instanceLandscape) {
        patchLandscapeCardLayout(instanceLandscape);
      }

      // 1. Load lanes if any
      if (timelineData.lanes && timelineData.lanes.length > 0) {
        timeline.loadLanes(
          timelineData.lanes.map((l) => {
            return {
              id: l.id,
              title: l.title,
              layout: {
                header: {
                  height: 28,
                  padding: { left: 16, right: 16 }
                }
              },
              style: {
                header: {
                  backgroundColor: isDark ? '#161619' : '#f7f7f8',
                },
                body: {
                  backgroundColor: 'transparent',
                },
                title: {
                  color: isDark ? '#f4f4f6' : '#27272a',
                  font: `600 11px ${CANVAS_FONT}`,
                }
              }
            };
          })
        );

        // Hook _syncLaneDom so all subsequent redraws / zooms / pans keep CSS variables & hover listeners
        if (typeof timeline._syncLaneDom === 'function') {
          const origSyncLaneDom = timeline._syncLaneDom.bind(timeline);
          timeline._syncLaneDom = function () {
            origSyncLaneDom();
            syncLaneDomVariables(timeline, timelineData.lanes, timeline._isDarkTheme ?? isDark, handleLaneHeaderToggle);
          };
          timeline._syncLaneDom();
        } else {
          syncLaneDomVariables(timeline, timelineData.lanes, isDark, handleLaneHeaderToggle);
        }
      }

      // 2. Load time bands if any
      if (timelineData.timeBands && timelineData.timeBands.length > 0) {
        timeline.loadTimeBands(
          timelineData.timeBands.map((tb) => {
            const fromObj = {
              year: tb.from?.year ?? tb.from_year,
              precision: tb.from?.precision || tb.precision || 'year',
            };
            if (tb.from?.month != null) fromObj.month = tb.from.month;
            if (tb.from?.day != null) fromObj.day = tb.from.day;

            const toObj = {
              year: tb.to?.year ?? tb.to_year ?? fromObj.year,
              precision: tb.to?.precision || tb.precision || fromObj.precision,
            };
            if (tb.to?.month != null) toObj.month = tb.to.month;
            if (tb.to?.day != null) toObj.day = tb.to.day;

            return {
              id: tb.id,
              title: tb.title,
              from: fromObj,
              to: toObj,
              style: {
                background: formatBandBg(tb.color, isDark),
                text: {
                  color: isDark ? '#f4f4f5' : '#3f3f46',
                  font: `600 10px ${CANVAS_FONT}`,
                  verticalAlign: 'bottom',
                  offsetY: -1,
                },
              }
            };
          })
        );
      }

      // 3. Load articles
      if (timelineData.articles && timelineData.articles.length > 0) {
        // Color events by their topic/theme (`category`) whenever 2+ distinct themes exist,
        // independent of the lane/timeline split - lane decides placement, category decides color.
        const themeCategories = getDistinctCategories(timelineData.articles);
        const colorByTheme = themeCategories.length >= 2;
        const anchorArticleIds = getTimelineAnchorArticleIds(timelineData.articles);

        const formattedArticles = timelineData.articles.map((art, artIdx) => {
          const laneColor = resolveArticleDisplayColor(art, artIdx, isDark, timelineData, themeCategories, colorByTheme);
          const isAnchor = anchorArticleIds.has(String(art.id));

          return {
            ...art,
            id: art.id,
            title: art.title,
            subtitle: art.subtitle || '',
            lane: art.lane,
            from: art.from,
            to: art.to || undefined,
            isToPresent: art.isToPresent || false,
            imageUrl: art.imageUrl || undefined,
            mediaType: art.mediaType || (
              typeof art.imageUrl === 'string' && (
                art.imageUrl.toLowerCase().endsWith('.gif') ||
                art.imageUrl.toLowerCase().includes('.gif?')
              )
                ? 'gif'
                : 'image'
            ),
            rank: isAnchor ? Math.max(art.rank || 5, 10) : (art.rank || 5),
            isAnchor,
            starred: starredArticleIdsRef.current?.has(art.id) || !!art.starred,
            style: getTimelineArticleNormalStyle(laneColor, isDark, articleStyle),
            hoverStyle: getTimelineArticleHoverStyle(laneColor, isDark, articleStyle),
            activeStyle: getTimelineArticleActiveStyle(laneColor, isDark, articleStyle),
            // Attach custom rich data into article object for drawer
            sourceName: art.sourceName,
            sourceUrl: art.sourceUrl || art.wikiUrl,
            wikiUrl: art.wikiUrl || art.sourceUrl,
            extract: art.extract,
            wikiTitle: art.wikiTitle,
            locationName: art.locationName,
            lat: art.lat,
            lng: art.lng,
            googleMapsUrl: art.googleMapsUrl,
            imagePositionX: art.imagePositionX,
            imagePositionY: art.imagePositionY,
            additionalImages: art.additionalImages,
            isEdited: Boolean(art.isEdited || art.is_edited || art.isManuallyEdited || art.is_manually_edited),
            editedAt: art.editedAt || art.edited_at,
          };
        });

        timeline.load(formattedArticles);
        if (timeline.articles) {
          let layoutChanged = false;
          timeline.articles.forEach((artInstance, idx) => {
            const src = formattedArticles[idx];
            if (src) {
              if (src.mediaType) artInstance.mediaType = src.mediaType;
              if (src.imageUrl) artInstance.imageUrl = src.imageUrl;
              if (src.isAnchor) artInstance.isAnchor = true;
              if (src.isEdited) {
                artInstance.isEdited = true;
                artInstance.editedAt = src.editedAt;
              }
            }
            if (densityMode === 'auto') return;
            const desiredLayout = getCardLayoutForMode(timeline, artInstance, densityMode);
            if (artInstance._resolvedCardLayoutName !== desiredLayout && typeof artInstance.setCardLayout === 'function') {
              artInstance.setCardLayout(desiredLayout);
              layoutChanged = true;
            }
          });
          if (densityMode === 'auto') {
            layoutChanged = syncAutoCardLayouts(timeline) || layoutChanged;
          }
          if (layoutChanged) {
            timeline.redraw();
          }
        }

        // Filters are controlled by App and must survive canvas/layout remounts.
        applyVisibilityFilters();

        // Sync initial selection state so unselected articles start with semi-transparent lines
        timeline._selectedArticleId = selectedArticleId || null;
        if (selectedArticleId) {
          try {
            timeline.select(selectedArticleId);
          } catch (e) {
            // ignore
          }
        } else if (timeline.articles) {
          timeline.articles.forEach((a) => {
            a.isActive = false;
          });
          timeline.redraw();
        }

        // Fit articles in view
        setTimeout(() => {
          try {
            fitAllArticles(timeline, 70);
            // Lane shares depend on how crowded each lane is at the fitted zoom.
            if (rebalanceLaneHeights(timeline)) {
              if (densityModeRef.current === 'auto') syncAutoCardLayouts(timeline);
              timeline.defaultRedraw();
            }
          } catch (e) {
            console.warn('fitArticles fallback:', e);
          }
        }, 100);
      }

      // Event listener for article clicks
      timeline.on('article-click', (article, evt) => {
        clearLaneHighlight(timeline);
        // A long press already opened the drawer for this gesture; ignore the
        // click that fires on release so we don't reprocess it as a tap.
        if (longPressConsumedRef.current) {
          longPressConsumedRef.current = false;
          return;
        }

        const clickedId = article?.id || article?.data?.id;
        if (!clickedId) return;

        // If the user clicked specifically on the star icon on canvas
        if (article.isMouseOverStar) {
          onToggleStar?.(clickedId, article.isStarred);
          return;
        }

        const tl = timelineInstanceRef.current;
        const currentDensity = densityModeRef.current;
        const isCompact = currentDensity === 'compact';
        const isSmall = currentDensity === 'small';
        const isExpandableMode = isCompact || isSmall;
        const alreadyFocused = isSameArticleId(mobileFocusedArticleIdRef.current, clickedId);
        mobileFocusedArticleIdRef.current = clickedId;

        if (tl) {
          tl._selectedArticleId = clickedId;
          try {
            tl.bringFront(clickedId);
            if (tl.articles) {
              const keepAllCompact = isCompact && isExploringRef.current;
              const baseLayout = isSmall ? 'landscape' : 'compact';
              tl.articles.forEach((a) => {
                const isMatch = isSameArticleId(a.id, clickedId);
                a.isActive = isMatch;
                if (isExpandableMode && typeof a.setCardLayout === 'function') {
                  if (keepAllCompact) {
                    a.setCardLayout('compact');
                    delete a._expandAnim;
                    delete a._compactTop;
                    delete a._unexpandedTop;
                  } else if (isMatch) {
                    const targetLayout = getSelectedCardLayoutForMode(tl, a, currentDensity);
                    triggerCardExpandAnimation(tl, a, targetLayout);
                  } else {
                    a.setCardLayout(baseLayout);
                    delete a._expandAnim;
                    delete a._compactTop;
                    delete a._unexpandedTop;
                  }
                }
                if (typeof a.invalidateCaches === 'function') {
                  a.invalidateCaches();
                }
              });
            }
          } catch (e) { }
          if (typeof tl.defaultRedraw === 'function') {
            tl.defaultRedraw();
          } else {
            tl.redraw();
          }
        }

        // Tap 1: On mobile (or in compact/small mode on any viewport):
        // First tap brings the event to the foreground, expands it to rich portrait on the timeline,
        // and focuses the map on its pin.
        // Second tap on that same event opens the details drawer.
        // A long press (handled separately) opens it directly.
        if (isNarrowViewportRef.current || isExpandableMode) {
          if (!alreadyFocused) {
            const original = timelineData?.articles?.find((a) => isSameArticleId(a.id, clickedId));
            onFocusArticleRef.current?.(original || article.data || article);
            return;
          }
        }

        if (onSelectArticle) {
          const original = timelineData.articles?.find((a) => isSameArticleId(a.id, clickedId));
          onSelectArticle(original || article.data || article, { fromUserClick: true });
        }
      });

      // Cross-highlighting: notify on pointerenter and pointerleave
      timeline.on('article-pointerenter', (art) => {
        const id = art?.id || art?.data?.id;
        if (id) {
          onHoverArticleRef.current?.(id);
        }
      });

      timeline.on('article-pointerleave', () => {
        onHoverArticleRef.current?.(null);
      });

      // Timeline canvas background clicks and deselection are handled uniformly
      // by the onCanvasPointerUp listener for both mobile and desktop.
      timeline.on('timeline-click', () => {
        return;
      });

      // Clear temporary lane highlight on actual viewport drag, pan, or zoom
      timeline.on('viewport-drag', () => {
        clearLaneHighlight(timeline);
      });
      timeline.on('zoom', () => {
        clearLaneHighlight(timeline);
      });
      timeline.on('zoom-pinch-start', () => {
        clearLaneHighlight(timeline);
      });

    } catch (err) {
      console.error('Histropedia initialization failed:', err);
    }

    // Long-press to open the event drawer directly on touch devices. This runs
    // alongside the two-tap-to-focus behavior: a sustained press on an event
    // skips the "bring to foreground first" step and opens its details at once.
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE = 12;
    const canvasEl = timelineInstanceRef.current?.canvas || null;
    let longPressStart = null;
    let backgroundTapStart = null;

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const findArticleAtPoint = (clientX, clientY) => {
      const tl = timelineInstanceRef.current;
      if (!tl || !tl.canvas || !Array.isArray(tl.articles)) return null;
      const rect = tl.canvas.getBoundingClientRect();
      const pos = { left: clientX - rect.left, top: clientY - rect.top };
      for (let i = tl.articles.length - 1; i >= 0; i--) {
        const a = tl.articles[i];
        if (a && a.isVisible && typeof a.isInside === 'function' && a.isInside(pos)) {
          return a;
        }
      }
      return null;
    };

    const onCanvasPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      clearLongPressTimer();
      longPressConsumedRef.current = false;
      const { clientX, clientY } = e;
      backgroundTapStart = { x: clientX, y: clientY };

      if (isNarrowViewportRef.current) {
        longPressStart = { x: clientX, y: clientY };
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          const hit = findArticleAtPoint(clientX, clientY);
          if (!hit) return;
          const id = hit.id;
          longPressConsumedRef.current = true;
          mobileFocusedArticleIdRef.current = id;
          const tl = timelineInstanceRef.current;
          if (tl) {
            tl._selectedArticleId = id;
            try {
              if (tl.articles) {
                const currentDensity = densityModeRef.current;
                const isCompact = currentDensity === 'compact';
                const isSmall = currentDensity === 'small';
                const isExpandableMode = isCompact || isSmall;
                const baseLayout = isSmall ? 'landscape' : 'compact';
                tl.articles.forEach((a) => {
                  const isMatch = isSameArticleId(a.id, id);
                  a.isActive = isMatch;
                  if (isExpandableMode && typeof a.setCardLayout === 'function') {
                    if (isMatch) {
                      const targetLayout = getSelectedCardLayoutForMode(tl, a, currentDensity);
                      triggerCardExpandAnimation(tl, a, targetLayout);
                    } else {
                      a.setCardLayout(baseLayout);
                      delete a._expandAnim;
                      delete a._compactTop;
                      delete a._unexpandedTop;
                    }
                  }
                  if (typeof a.invalidateCaches === 'function') {
                    a.invalidateCaches();
                  }
                });
              }
              tl.bringFront(id);
            } catch (err2) { }
            tl.redraw();
          }
          if (onSelectArticle) {
            const original = timelineData.articles?.find((a) => isSameArticleId(a.id, id));
            onSelectArticle(original || hit.data || hit, { fromUserClick: true });
          }
        }, LONG_PRESS_MS);
      }
    };

    const onCanvasPointerMove = (e) => {
      if (!longPressStart && !backgroundTapStart) return;
      const tapMoveTolerance = isNarrowViewportRef.current ? 28 : 14;
      const movedTooMuch = (pt, tol) => (
        Math.abs(e.clientX - pt.x) > tol ||
        Math.abs(e.clientY - pt.y) > tol
      );
      if (longPressStart && movedTooMuch(longPressStart, LONG_PRESS_MOVE_TOLERANCE)) {
        clearLongPressTimer();
        longPressStart = null;
      }
      if (backgroundTapStart && movedTooMuch(backgroundTapStart, tapMoveTolerance)) {
        backgroundTapStart = null;
        clearLaneHighlight(timelineInstanceRef.current);
      }
    };

    const onCanvasPointerUp = (e) => {
      clearLongPressTimer();
      longPressStart = null;
      const tapStart = backgroundTapStart;
      backgroundTapStart = null;
      if (!tapStart || longPressConsumedRef.current) return;
      const tapTolerance = isNarrowViewportRef.current ? 28 : 14;
      if (
        Math.abs(e.clientX - tapStart.x) > tapTolerance ||
        Math.abs(e.clientY - tapStart.y) > tapTolerance
      ) return;

      const tl = timelineInstanceRef.current;
      if (!tl) return;

      // 1. If clicked/tapped on an article: clear any lane highlight
      if (findArticleAtPoint(e.clientX, e.clientY)) {
        clearLaneHighlight(tl);
        return;
      }

      // 2. If a card is currently active or focused (open card):
      // Tapping the background deselects and closes the card without triggering lane highlight
      const hasActiveOrFocused = Boolean(
        mobileFocusedArticleIdRef.current ||
        tl._selectedArticleId ||
        (Array.isArray(tl.articles) && tl.articles.some((a) => a && a.isActive))
      );
      if (hasActiveOrFocused) {
        mobileFocusedArticleIdRef.current = null;
        tl._selectedArticleId = null;
        const currentDensity = densityModeRef.current;
        const isCompact = currentDensity === 'compact';
        const isSmall = currentDensity === 'small';
        const isExpandableMode = isCompact || isSmall;
        const baseLayout = isSmall ? 'landscape' : 'compact';
        if (Array.isArray(tl.articles)) {
          tl.articles.forEach((a) => {
            a.isActive = false;
            if (isExpandableMode && typeof a.setCardLayout === 'function') {
              a.setCardLayout(baseLayout);
              delete a._expandAnim;
              delete a._compactTop;
              delete a._unexpandedTop;
            }
            if (typeof a.invalidateCaches === 'function') {
              a.invalidateCaches();
            }
          });
        }
        if (typeof tl.defaultRedraw === 'function') {
          tl.defaultRedraw();
        } else {
          tl.redraw();
        }
        clearLaneHighlight(tl);
        onSelectArticle?.(null);
        return;
      }

      // 3. If ANY lane is currently highlighted:
      // Tapping anywhere on the canvas background (the same lane, another lane, or empty background)
      // clears the highlight (toggle off)!
      const hasLaneHighlight = Boolean(
        tl._chronixTappedLaneId ||
        Array.from(tl._laneDomNodes?.values?.() || []).some((r) => r?.root?.classList.contains('is-lane-hovered'))
      );
      if (hasLaneHighlight) {
        clearLaneHighlight(tl);
        return;
      }

      // 4. When no cards are open and no lane is highlighted:
      // Find which lane was tapped and HIGHLIGHT IT!
      let tappedLaneId = null;

      // Strategy A: Check DOM lane roots
      const tappedEntry = Array.from(tl._laneDomNodes?.entries?.() || []).find(([, refs]) => {
        const rect = refs?.root?.getBoundingClientRect?.();
        return rect && e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
      });
      if (tappedEntry) {
        tappedLaneId = String(tappedEntry[0]);
      }

      // Strategy B (fallback): Use canvas bounding rect & Histropedia lane geometry
      if (!tappedLaneId && tl.canvas && Array.isArray(tl.lanes)) {
        const canvasRect = tl.canvas.getBoundingClientRect();
        const yOnCanvas = e.clientY - canvasRect.top;
        const matchedLane = tl.lanes.find((l) => {
          const g = l?.geometry;
          return g && yOnCanvas >= g.top && yOnCanvas <= (g.top + g.height);
        });
        if (matchedLane) {
          tappedLaneId = String(matchedLane.id);
        }
      }

      if (!tappedLaneId) return;

      tl._chronixTappedLaneId = tappedLaneId;
      tl._laneDomNodes?.forEach((refs, laneId) => {
        refs?.root?.classList.toggle('is-lane-hovered', String(laneId) === tappedLaneId);
      });
    };

    const onCanvasPointerCancel = () => {
      clearLongPressTimer();
      longPressStart = null;
      backgroundTapStart = null;
    };

    const onCanvasWheel = () => {
      clearLaneHighlight(timelineInstanceRef.current);
    };

    const handleGlobalPointerDown = (e) => {
      const tl = timelineInstanceRef.current;
      if (!tl) return;
      const hasLaneHighlight = Boolean(
        tl._chronixTappedLaneId ||
        Array.from(tl._laneDomNodes?.values?.() || []).some((r) => r?.root?.classList.contains('is-lane-hovered'))
      );
      if (!hasLaneHighlight) return;

      // If the interaction is inside the timeline container (canvas, lanes, ruler),
      // the timeline's own tap/click listeners handle it.
      if (container && (e.target === container || container.contains(e.target))) {
        return;
      }
      clearLaneHighlight(tl);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        clearLaneHighlight(timelineInstanceRef.current);
      }
    };

    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    if (canvasEl) {
      canvasEl.addEventListener('wheel', onCanvasWheel, { passive: true });
      canvasEl.addEventListener('pointerdown', onCanvasPointerDown);
      canvasEl.addEventListener('pointermove', onCanvasPointerMove);
      canvasEl.addEventListener('pointerup', onCanvasPointerUp);
      canvasEl.addEventListener('pointercancel', onCanvasPointerCancel);
    }

    // Resize observer to keep canvas full size
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0 && timelineInstanceRef.current) {
          try {
            const tl = timelineInstanceRef.current;
            const lastFit = lastFitRef.current;
            const stayFitted = Boolean(
              lastFit && Math.round(newWidth) !== Math.round(tl.width || 0) &&
              getViewSignature(tl) === lastFit.signature
            );
            tl.setSize(newWidth, newHeight);
            // setSize schedules a redraw, but its lane geometry is still from the previous
            // size until that redraw runs. Resolve geometry now so the layout chooser sees
            // the new available height in this same ResizeObserver turn.
            if (typeof tl._updateLaneLayout === 'function') {
              tl._updateLaneLayout();
            }
            if (stayFitted) fitAllArticles(tl, lastFit.padding);
            rebalanceLaneHeights(tl);
            const currentDensity = densityModeRef.current;
            if (currentDensity === 'auto' && Array.isArray(tl.articles)) {
              if (syncAutoCardLayouts(tl)) {
                if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
                else tl.redraw();
              }
            } else if ((currentDensity === 'compact' || currentDensity === 'small') && tl._selectedArticleId && Array.isArray(tl.articles)) {
              const activeArt = tl.articles.find((a) => a && isSameArticleId(a.id, tl._selectedArticleId));
              if (activeArt && typeof activeArt.setCardLayout === 'function') {
                const targetLayout = getSelectedCardLayoutForMode(tl, activeArt, currentDensity);
                const currentLayout = typeof activeArt._getCurrentCardLayoutName === 'function' ? activeArt._getCurrentCardLayoutName() : activeArt._resolvedCardLayoutName;
                if (currentLayout !== targetLayout) {
                  activeArt.setCardLayout(targetLayout);
                  if (typeof activeArt.invalidateCaches === 'function') activeArt.invalidateCaches();
                  if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
                  else tl.redraw();
                }
              }
            }
          } catch (e) {
            // ignore during unmount
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      clearLongPressTimer();
      if (timelineInstanceRef.current) {
        const tl = timelineInstanceRef.current;
        const startVal = tl.timescaleManager?.startToken?.value;
        const zoomVal = typeof tl.getZoom === 'function' ? tl.getZoom() : null;
        if (startVal) {
          savedViewportRef.current = {
            timelineId: timelineData?.id,
            date: { year: startVal.year, month: startVal.month || 1, day: startVal.day || 1 },
            zoom: zoomVal
          };
        }
      }
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      window.removeEventListener('touchstart', handleGlobalPointerDown, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
      if (canvasEl) {
        canvasEl.removeEventListener('wheel', onCanvasWheel);
        canvasEl.removeEventListener('pointerdown', onCanvasPointerDown);
        canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
        canvasEl.removeEventListener('pointerup', onCanvasPointerUp);
        canvasEl.removeEventListener('pointercancel', onCanvasPointerCancel);
      }
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData]);

  // Dismiss any temporary lane highlight indication whenever drawers, modals, exploration, or filters change
  useEffect(() => {
    clearLaneHighlight(timelineInstanceRef.current);
  }, [hasRightDrawer, selectedArticleId, activeFilter, isExploring]);

  // Handle theme changes in-place without tearing down the canvas or resetting the viewport
  useEffect(() => {
    if (prevThemeRef.current === theme) return;
    prevThemeRef.current = theme;

    const timeline = timelineInstanceRef.current;
    if (!timeline || !timelineData) return;

    updateTimelineTheme(timeline, theme === 'dark', timelineData, isRtl);
  }, [theme, timelineData, isRtl]);

  // Handle language direction (RTL / LTR) changes in-place without tearing down canvas or resetting viewport
  useEffect(() => {
    window.__chronixIsRtl = Boolean(isRtl);
    const timeline = timelineInstanceRef.current;
    if (!timeline || !timelineData) return;

    updateTimelineTheme(timeline, themeRef.current === 'dark', timelineData, isRtl);
  }, [isRtl, timelineData]);

  useEffect(() => {
    const timeline = timelineInstanceRef.current;
    if (!timeline) return;
    timeline._isNarrowViewport = isNarrowViewport;
    timeline.redraw();
  }, [isNarrowViewport]);

  // Handle density mode changes in-place without tearing down canvas or resetting viewport
  useEffect(() => {
    const timeline = timelineInstanceRef.current;
    if (!timeline || !timelineData) return;

    const isCompact = densityMode === 'compact';
    const isAuto = densityMode === 'auto';
    const fixedLayout = getCardLayoutForMode(timeline, null, densityMode);
    densityModeRef.current = densityMode;
    timeline._chronixCardMode = densityMode;

    if (timeline.options?.article) {
      if (isAuto) {
        delete timeline.options.article.cardLayout;
        timeline.options.article.defaultCardLayout = 'portrait';
        timeline.options.article.cardLayoutBreakpoints = VISUAL_CARD_LAYOUT_BREAKPOINTS;
      } else {
        timeline.options.article.cardLayout = fixedLayout;
        timeline.options.article.defaultCardLayout = fixedLayout;
        delete timeline.options.article.cardLayoutBreakpoints;
      }
      if (timeline.options.article.distanceToBaseline) {
        timeline.options.article.distanceToBaseline.value = isCompact ? 70 : (densityMode === 'small' ? 120 : 350);
        if (timeline.options.article.distanceToBaseline.responsive) {
          timeline.options.article.distanceToBaseline.responsive.lanesOnly = true;
          timeline.options.article.distanceToBaseline.responsive.byCardLayout = {
            portrait: { ratio: 0.62, min: 340, max: 380 },
            landscape: { ratio: 0.58, min: 102, max: 170 },
            compact: { ratio: 0.28, min: 60, max: 88 }
          };
        }
      }
      if (timeline.options.article.autoStacking) {
        timeline.options.article.autoStacking.fitToHeight = !isCompact;
        timeline.options.article.autoStacking.rowSpacing = isCompact ? 58 : 40;
        timeline.options.article.autoStacking.topGap = isCompact ? 20 : 10;
      }
    }

    // Crucial for lanes: update lane.resolvedArticleOptions so lane articles are not stuck in compact
    if (Array.isArray(timeline.lanes)) {
      timeline.lanes.forEach((lane) => {
        if (!lane) return;
        if (lane.resolvedArticleOptions) {
          if (isAuto) {
            delete lane.resolvedArticleOptions.cardLayout;
            lane.resolvedArticleOptions.defaultCardLayout = 'portrait';
            lane.resolvedArticleOptions.cardLayoutBreakpoints = VISUAL_CARD_LAYOUT_BREAKPOINTS;
          } else {
            lane.resolvedArticleOptions.cardLayout = fixedLayout;
            lane.resolvedArticleOptions.defaultCardLayout = fixedLayout;
            delete lane.resolvedArticleOptions.cardLayoutBreakpoints;
          }
        }
        if (typeof lane._resolveFromData === 'function') {
          lane._resolveFromData();
        }
      });
    }

    if (Array.isArray(timeline.articles)) {
      timeline.articles.forEach((art) => {
        if (!art) return;
        delete art._compactTop;
        delete art._expandAnim;
        if (isAuto) {
          // Handled by syncAutoCardLayouts below; pinning here would freeze the card size.
          return;
        }
        const targetLayout = getCardLayoutForMode(timeline, art, densityMode);
        if (typeof art.setCardLayout === 'function') {
          art.setCardLayout(targetLayout);
        } else {
          delete art.cardLayout;
          delete art._resolvedCardLayoutName;
          delete art._resolvedDefaultCardLayout;
          if (typeof art.initialiseStyles === 'function') {
            art.initialiseStyles();
          }
        }
        if (typeof art.invalidateCaches === 'function') {
          art.invalidateCaches();
        }
      });
      if (isAuto) {
        syncAutoCardLayouts(timeline);
      }
    }

    if (rebalanceLaneHeights(timeline) && isAuto) {
      syncAutoCardLayouts(timeline);
    }

    if (typeof timeline._refreshAdaptiveArticleRuntimeOptions === 'function') {
      timeline._refreshAdaptiveArticleRuntimeOptions();
    }

    if (typeof timeline.defaultRedraw === 'function') {
      timeline.defaultRedraw();
    } else {
      timeline.redraw();
    }
  }, [densityMode, timelineData]);

  // When interactive exploration tour starts or stops, ensure compact and small modes keep cards in their base layout
  useEffect(() => {
    isExploringRef.current = isExploring;
    const tl = timelineInstanceRef.current;
    const currentDensity = densityModeRef.current;
    if (tl && isExploring && (currentDensity === 'compact' || currentDensity === 'small') && Array.isArray(tl.articles)) {
      const baseLayout = currentDensity === 'small' ? 'landscape' : 'compact';
      tl.articles.forEach((a) => {
        if (typeof a.setCardLayout === 'function') {
          a.setCardLayout(baseLayout);
        }
        delete a._expandAnim;
        delete a._compactTop;
        delete a._unexpandedTop;
        if (typeof a.invalidateCaches === 'function') {
          a.invalidateCaches();
        }
      });
      if (typeof tl.defaultRedraw === 'function') {
        tl.defaultRedraw();
      } else {
        tl.redraw();
      }
    }
  }, [isExploring]);

  // Keep the geo map's pin filters synchronized with the timeline selection (both dimensions).
  useEffect(() => {
    const laneItems = laneFilterItems.filter((item) => activeLaneFilterIds.some((id) => String(id) === String(item.id)));
    const categoryItems = categoryFilterItems.filter((item) => activeCategoryFilterIds.some((id) => String(id) === String(item.id)));
    onFilterChange?.(laneItems, categoryItems);
  }, [activeLaneFilterIds, activeCategoryFilterIds, laneFilterItems, categoryFilterItems, onFilterChange]);

  return (
    <div
      dir="ltr"
      className="w-full h-full relative overflow-hidden bg-surface-sunken select-none transition-colors duration-200 histropedia-timeline-wrapper"
    >
      <div
        ref={containerRef}
        id="histropedia-container"
        dir="ltr"
        className="absolute inset-0"
        style={{
          touchAction: 'none',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
      />
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;
