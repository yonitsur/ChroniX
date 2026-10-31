import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { Timeline, Article } from 'histropediajs';
import { getLaneBodyBg, getLaneBodyBorder, isColorLight, getDistinctCategories, getCategoryColor, getActiveCategoryPalette, isToyThemeActive, isComicThemeActive, isBentoThemeActive, isJournalThemeActive } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import {
  compareEventDates,
  getTimelineAnchorArticleIds,
  isSameArticleId,
} from '../utils/timelineArticles';
import { areTextsRtl } from '../utils/textDirection';
import { mathToPlainText } from '../utils/mathUtils';
import { buildRichWords, drawRichLine, getCanvasMathVersion, layoutRichLines, splitMathRuns, subscribeCanvasMath } from '../utils/canvasMath';
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
import { getZoomMinimumForTimeline, pickTimeFields, toHistropediaDate, spreadPrehistoricClusterDates, DEFAULT_ZOOM_MINIMUM } from '../utils/dateTime';
import { getCanvasImageCandidates, getCanvasImageUrl, getDrawerImageCandidates, getDrawerImageUrl } from '../utils/wikimediaImageUrl';
import { decodeAnimatedGif, getGifFrameAt, isGifSource } from '../utils/animatedGif';
import { formatTimeSpan } from '../utils/timelineExport';
import { classifyLensSwipe, findAdjacentItem, findNearestItem, pickFocus, planFocusLens } from './timeline/focusLens';

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

// Minimal circular card layout for mobile when the full event card is displayed on the map:
// Shows only the event image in a crisp circular frame without duplicating title/text.
export const CIRCLE_CARD_SIZE = 46;
export const CIRCLE_CARD_RADIUS = 23;
export const CIRCLE_CONNECTOR_OFFSET_X = 23;

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
const TOY_CANVAS_FONT = "'Fredoka', 'Rubik', 'Heebo', system-ui, sans-serif";
const COMIC_CANVAS_FONT = "'Rubik', 'Heebo', system-ui, sans-serif";
const BENTO_CANVAS_FONT = "'Inter Tight', Inter, Heebo, system-ui, sans-serif";
const JOURNAL_CANVAS_FONT = "'Lora', 'Noto Serif Hebrew', Georgia, serif";
function getCanvasFont(isToy = isToyThemeActive()) {
  if (isToy) return TOY_CANVAS_FONT;
  if (isBentoThemeActive()) return BENTO_CANVAS_FONT;
  if (isJournalThemeActive()) return JOURNAL_CANVAS_FONT;
  return isComicThemeActive() ? COMIC_CANVAS_FONT : CANVAS_FONT;
}

// HistropediaJS v1.7+ defaults `connectorLine.color` to the keyword `'article'`
// (resolved inside the engine's own draw routine rather than in `getCurrentStyle()`).
// Filter out non-CSS keywords so custom canvas renderers always receive a valid CSS color.
function resolveConnectorColor(color) {
  return typeof color === 'string' && color && color !== 'article' && color !== 'inherit'
    ? color
    : null;
}

// "Journal" skin: notebook-paper cards, sepia hairline, a strip of washi tape and a
// highlighter fill when selected.
const JOURNAL_FILLS = {
  // Selected cards stay clean paper (the blue ink border marks selection) so the washi tape
  // and teal accents read well and the card lifts off the cream page.
  light: { normal: '#fffdf6', hover: '#fffaea', active: '#fffefb' },
  dark: { normal: '#2a241d', hover: '#322b22', active: '#3d3423' },
};
function withJournalArticleStyle(style, isDark, state = 'normal') {
  if (!isJournalThemeActive()) return style;
  const fills = isDark ? JOURNAL_FILLS.dark : JOURNAL_FILLS.light;
  const fill = fills[state] || fills.normal;
  return {
    ...style,
    backgroundColor: fill,
    color: fill,
    topRadius: 3,
    borderRadius: 3,
    border: {
      ...style.border,
      color: state === 'active' ? '#2f5d9e' : (isDark ? 'rgba(232, 220, 196, 0.22)' : 'rgba(139, 115, 85, 0.45)'),
      width: state === 'active' ? 2 : 1.2,
    },
    header: style.header ? {
      ...style.header,
      text: { ...style.header.text, color: isDark ? '#f3ead8' : '#2b2a33' },
    } : style.header,
    subheader: style.subheader ? {
      ...style.subheader,
      color: isDark ? '#352d24' : '#f6eedb',
      text: { ...style.subheader.text, color: isDark ? '#c9b99a' : '#6b5a43' },
    } : style.subheader,
    shadow: {
      x: 2,
      y: state === 'normal' ? 3 : 6,
      amount: state === 'normal' ? 4 : 12,
      color: isDark ? 'rgba(0, 0, 0, 0.55)' : (state === 'active' ? 'rgba(90, 70, 40, 0.3)' : 'rgba(90, 70, 40, 0.16)'),
    },
  };
}

// overlayOnly: skip the shadow + fill and draw only the decorations and outline. Used on top
// of engine-drawn portrait ("large") cards.
function drawJournalCardFrame(ctx, left, top, width, height, radius, accentColor, { isActive, isMouseover, isDark, overlayOnly = false }) {
  const fills = isDark ? JOURNAL_FILLS.dark : JOURNAL_FILLS.light;
  const isHigh = isActive || isMouseover;

  if (!overlayOnly) {
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : (isActive ? 'rgba(90, 70, 40, 0.3)' : 'rgba(90, 70, 40, 0.16)');
    ctx.shadowBlur = isHigh ? 12 : 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = isHigh ? 6 : 3;
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    ctx.fillStyle = isActive ? fills.active : (isMouseover ? fills.hover : fills.normal);
    ctx.fill();
    ctx.restore();
  }

  // Ink margin line in the topic color, like a notebook page
  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, left, top, width, height, radius);
  ctx.clip();
  ctx.fillStyle = colorWithAlpha(accentColor, isDark ? 0.75 : 0.85);
  ctx.fillRect(left, top, 3, height);
  ctx.restore();

  ctx.beginPath();
  drawPillPath(ctx, left, top, width, height, radius);
  ctx.strokeStyle = isActive ? '#2f5d9e' : (isDark ? 'rgba(232, 220, 196, 0.22)' : 'rgba(139, 115, 85, 0.45)');
  ctx.lineWidth = isActive ? 2 : 1.2;
  ctx.stroke();

  // Washi tape across the top edge, tinted with the topic color
  const tapeW = Math.min(46, width * 0.32);
  const tapeH = 9;
  ctx.save();
  ctx.translate(left + width / 2, top);
  ctx.rotate(-0.05);
  ctx.fillStyle = colorWithAlpha(accentColor, isDark ? 0.5 : 0.42);
  ctx.fillRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH);
  ctx.restore();
}

// Youth "bento" preview skin: soft rounded tiles, hairline edges and a gentle diffuse shadow.
// Classic (no skin) shares the bento card look.
function isBentoCardLook() {
  return !isToyThemeActive() && !isComicThemeActive() && !isJournalThemeActive();
}

function withBentoArticleStyle(style, isDark, state = 'normal') {
  if (!isBentoCardLook()) return style;
  const fills = isDark
    ? { normal: '#15151d', hover: '#1c1c26', active: '#22222e' }
    : { normal: '#ffffff', hover: '#ffffff', active: '#ffffff' };
  const fill = fills[state] || fills.normal;
  const hairline = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 17, 24, 0.07)';
  const isBento = isBentoThemeActive();
  const activeBorderColor = isBento
    ? (resolveConnectorColor(style.connectorLine?.color) || style.color || '#8b5cf6')
    : (style.border?.color || resolveConnectorColor(style.connectorLine?.color) || (isDark ? '#818cf8' : '#4f46e5'));
  return {
    ...style,
    backgroundColor: fill,
    color: fill,
    topRadius: 14,
    borderRadius: 14,
    border: {
      ...style.border,
      color: state === 'active' ? activeBorderColor : hairline,
      width: state === 'active' ? 2 : 1,
    },
    header: style.header ? {
      ...style.header,
      text: { ...style.header.text, color: isDark ? '#f5f5fa' : '#111118' },
    } : style.header,
    subheader: style.subheader ? {
      ...style.subheader,
      color: isDark ? '#1c1c26' : '#f6f6fa',
      text: { ...style.subheader.text, color: isDark ? '#8e8ea3' : '#6e6e80' },
    } : style.subheader,
    shadow: {
      x: 0,
      y: state === 'normal' ? 3 : 8,
      amount: state === 'normal' ? 10 : 22,
      color: isDark ? 'rgba(0, 0, 0, 0.55)' : (state === 'normal' ? 'rgba(17, 17, 24, 0.07)' : 'rgba(17, 17, 24, 0.14)'),
    },
  };
}

// glowTop: top edge of the text area when a photo sits above it; the glow is kept below it.
// skipGlow: draw only the outline (the glow was already painted by the base pass).
function drawBentoCardFrame(ctx, left, top, width, height, radius, accentColor, { isActive, isMouseover, isDark, overlayOnly = false, glowTop = null, skipGlow = false }) {
  const isHigh = isActive || isMouseover;

  if (!overlayOnly) {
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : (isHigh ? 'rgba(17, 17, 24, 0.14)' : 'rgba(17, 17, 24, 0.07)');
    ctx.shadowBlur = isHigh ? 22 : 10;
    ctx.shadowOffsetY = isHigh ? 8 : 3;
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    ctx.fillStyle = isDark ? (isHigh ? '#1c1c26' : '#15151d') : '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  // Soft accent glow in the top corner, like the bento tiles
  if (!skipGlow) {
    const hasGlowTop = Number.isFinite(glowTop) && glowTop > top;
    const areaTop = hasGlowTop ? glowTop : top;
    ctx.save();
    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    ctx.clip();
    if (hasGlowTop) {
      ctx.beginPath();
      ctx.rect(left, areaTop, width, top + height - areaTop);
      ctx.clip();
    }
    const gx = left + width - 10;
    const gy = areaTop + 4;
    // Tall portrait cards keep the glow in the text area instead of tinting the image.
    const glowR = overlayOnly || hasGlowTop ? width * 0.8 : Math.max(width, height) * 0.6;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
    glow.addColorStop(0, colorWithAlpha(accentColor, isDark ? 0.24 : 0.2));
    glow.addColorStop(1, colorWithAlpha(accentColor, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(left, areaTop, width, top + height - areaTop);
    ctx.restore();
  }

  ctx.beginPath();
  drawPillPath(ctx, left, top, width, height, radius);
  if (isActive) {
    ctx.strokeStyle = accentColor || (isBentoThemeActive() ? '#8b5cf6' : (isDark ? '#818cf8' : '#4f46e5'));
    ctx.lineWidth = 2;
  } else {
    ctx.strokeStyle = isMouseover ? colorWithAlpha(accentColor, 0.55) : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 17, 24, 0.07)');
    ctx.lineWidth = 1;
  }
  ctx.stroke();
}

function colorWithAlpha(color, alpha) {
  const str = String(color || '').trim();
  const mRgb = str.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (mRgb) {
    return `rgba(${mRgb[1]}, ${mRgb[2]}, ${mRgb[3]}, ${alpha})`;
  }
  const mHex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!mHex) {
    const isBento = isBentoThemeActive();
    return isBento ? `rgba(139, 92, 246, ${alpha})` : `rgba(79, 70, 229, ${alpha})`;
  }
  let h = mHex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Youth "comic" preview skin: ink-outlined panels with a hard offset shadow and a
// yellow caption strip. Applied on top of the classic card styles.
// Night mirrors the CSS --comic-edge / --comic-shadow tokens: as in day mode, outlines and hard
// shadows share one ink — a graphite tone lighter than the ink-black page so it stays visible.
const COMIC_INK = '#111111';
const COMIC_NIGHT_SHADOW = '#4a4a56';
const COMIC_NIGHT_EDGE = COMIC_NIGHT_SHADOW;
function withComicArticleStyle(style, isDark, state = 'normal') {
  if (!isComicThemeActive()) return style;
  const fills = isDark
    ? { normal: '#222227', hover: '#2c2c33', active: '#3a3a43' }
    : { normal: '#ffffff', hover: '#fffbe6', active: '#fff1a8' };
  const borderWidth = state === 'active' ? 3 : (state === 'hover' ? 2.6 : 2.2);
  const offset = state === 'active' ? 6 : (state === 'hover' ? 5 : 4);
  const fill = fills[state] || fills.normal;
  return {
    ...style,
    backgroundColor: fill,
    color: fill,
    topRadius: 3,
    borderRadius: 3,
    border: { ...style.border, color: isDark ? COMIC_NIGHT_EDGE : COMIC_INK, width: borderWidth },
    header: style.header ? {
      ...style.header,
      text: { ...style.header.text, color: isDark ? '#ffffff' : COMIC_INK },
    } : style.header,
    subheader: style.subheader ? {
      ...style.subheader,
      color: isDark ? '#2c2c33' : '#ffe66d',
      text: { ...style.subheader.text, color: isDark ? '#ffe66d' : COMIC_INK },
    } : style.subheader,
    shadow: { x: offset, y: offset, amount: 0, color: isDark ? COMIC_NIGHT_SHADOW : COMIC_INK },
  };
}

// yellowFill: paint the caption-yellow fill even when the card is not selected (mobile focus card).
function drawComicCardFrame(ctx, left, top, width, height, radius, accentColor, { isActive, isMouseover, isDark, overlayOnly = false, yellowFill = false }) {
  const offset = isActive ? 5 : (isMouseover ? 4.5 : 3.5);
  const ink = isDark ? COMIC_NIGHT_EDGE : COMIC_INK;

  if (!overlayOnly) {
    ctx.save();
    ctx.beginPath();
    drawPillPath(ctx, left + offset, top + offset, width, height, radius);
    ctx.fillStyle = isDark ? COMIC_NIGHT_SHADOW : COMIC_INK;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    drawPillPath(ctx, left, top, width, height, radius);
    if (isActive) ctx.fillStyle = isDark ? '#3a3a43' : '#fff1a8';
    else if (yellowFill && !isDark) ctx.fillStyle = '#fff1a8';
    else if (isMouseover) ctx.fillStyle = isDark ? '#2c2c33' : '#fffbe6';
    else ctx.fillStyle = isDark ? '#222227' : '#ffffff';
    ctx.fill();
  }

  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, left, top, width, height, radius);
  ctx.clip();
  ctx.fillStyle = accentColor;
  ctx.fillRect(left, top, width, 5);
  ctx.restore();

  ctx.beginPath();
  drawPillPath(ctx, left, top, width, height, radius);
  ctx.strokeStyle = ink;
  ctx.lineWidth = isActive ? 2.8 : 2.2;
  ctx.stroke();
}

function getActiveThemeCardFrame() {
  if (isComicThemeActive()) return { draw: drawComicCardFrame, radius: 3 };
  if (isJournalThemeActive()) return { draw: drawJournalCardFrame, radius: 3 };
  if (isBentoCardLook()) return { draw: drawBentoCardFrame, radius: 12 };
  return null;
}
const COMPACT_STAR_SIZE = 16;
const COMPACT_STAR_MARGIN = 6;
const COMPACT_TEXT_WIDTH = COMPACT_CARD_WIDTH - COMPACT_PADDING_X * 2 - (COMPACT_STAR_SIZE + COMPACT_STAR_MARGIN);

export function isArticleImageFailed(article) {
  if (!article || (article.imageLoaded && article.image)) return false;
  const currentUrl = article.data?.imageUrl || article.imageUrl;
  return Boolean(currentUrl && article._chronixFailedImageUrl === currentUrl);
}

// Decided from the image URL (known up front) rather than the load state, so the card
// width - and therefore the stacking - does not change when the image arrives. If loading
// that URL genuinely fails, fall back cleanly to the imageless layout.
export function hasArticleImageSource(article) {
  if (article?.imageLoaded && article?.image) return true;
  if (isArticleImageFailed(article)) return false;
  return Boolean(article?.data?.imageUrl || article?.imageUrl);
}

export function markArticleImageFailed(article, failedUrl) {
  if (!article || (article.imageLoaded && article.image)) return false;
  const currentUrl = article.data?.imageUrl || article.imageUrl || failedUrl;
  if (!currentUrl || article._chronixFailedImageUrl === currentUrl) return false;
  article._chronixFailedImageUrl = currentUrl;
  article._chronixRetryAfter = Date.now() + 30_000;
  article._pendingImageKey = null;
  article._imageCancel = null;
  if (typeof article.invalidateCaches === 'function') {
    article.invalidateCaches();
  }
  if (typeof article.updateCachedSize === 'function') {
    try {
      article.updateCachedSize();
    } catch (e) { }
  }
  const tl = article.owner;
  if (tl && typeof tl.requestRedraw === 'function') {
    tl.requestRedraw(tl.defaultRedraw || tl.redraw);
  }
  return true;
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
  const isToy = isToyThemeActive();
  const font = `${isToy ? 700 : 600} 11px ${getCanvasFont(isToy)}`;
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
  const hasImage = hasArticleImageSource(article) || (!isArticleImageFailed(article) && Boolean(article?.data?.image));
  const isToy = isToyThemeActive();
  const fontFamily = getCanvasFont(isToy);

  const maxTextWidth = hasImage ? 148 : 198;
  const titleFont = `${isToy ? 700 : 600} 11.5px ${fontFamily}`;
  const titleLines = getCachedWrappedLines(titleText, maxTextWidth, titleFont);
  const titleLineCount = Math.max(1, titleLines.length);
  const titleLineHeight = titleLineCount >= 4 ? 14.5 : 15.5;
  const titleBlockH = titleLineCount * titleLineHeight;

  let subtitleBlockH = 0;
  if (subtitleText) {
    const subFont = `${isToy ? 600 : 500} 10px ${fontFamily}`;
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
  if (layoutName === 'circle') return CIRCLE_CARD_SIZE;
  if (layoutName === 'compact') return getCompactHeightForArticle(article);
  if (layoutName === 'landscape') return getLandscapeHeightForArticle(article);

  if (typeof article.getHeight === 'function') {
    try {
      const h = article.getHeight();
      if (typeof h === 'number' && h > 0) {
        // While a valid portrait image is still downloading, getHeight() only returns the text
        // height (~50-140px). Reserve the planned portrait height for floor-clamping and expand
        // animations so the card never drops into the axis right before its image arrives.
        const hasPendingImage = !article.imageLoaded && (
          hasArticleImageSource(article) || (!isArticleImageFailed(article) && Boolean(article.data?.image || article.options?.image))
        );
        if (hasPendingImage) {
          return Math.max(h, estimatePortraitCardHeight(article), 270);
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

function getPortraitTitleTextWidth(cardWidth = PORTRAIT_CARD_WIDTH, margin = 10) {
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
  ctx.textBaseline = subText.baseline || 'middle';
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
const resolvedImageCandidateByUrl = new Map();
const failedImageCandidateUntilByUrl = new Map();
const inflightBlobByUrl = new Map();
const recentBlobByUrl = new Map();
let recentBlobTotalBytes = 0;

const IMAGE_RETRY_BASE_DELAY_MS = 450;
const FAILED_CANDIDATE_COOLDOWN_MS = 60_000;
const RECENT_BLOB_CACHE_MAX_ENTRIES = 24;
const RECENT_BLOB_CACHE_MAX_BYTES = 12 * 1024 * 1024;
const RECENT_BLOB_TTL_MS = 30_000;

function isWikimediaHostUrl(url) {
  return typeof url === 'string' && (url.includes('wikimedia.org') || url.includes('wikipedia.org'));
}

function isRawSvgUrl(url) {
  if (typeof url !== 'string') return false;
  const cleanPath = url.split('?')[0].split('#')[0].toLowerCase();
  return cleanPath.endsWith('.svg');
}

function cacheRecentBlob(url, blob) {
  if (!url || !blob || !(blob.size > 0) || blob.size > 4 * 1024 * 1024) return;
  const prev = recentBlobByUrl.get(url);
  if (prev) {
    recentBlobTotalBytes = Math.max(0, recentBlobTotalBytes - prev.size);
    recentBlobByUrl.delete(url);
  }
  recentBlobByUrl.set(url, { blob, size: blob.size, expiresAt: Date.now() + RECENT_BLOB_TTL_MS });
  recentBlobTotalBytes += blob.size;
  while (
    recentBlobByUrl.size > RECENT_BLOB_CACHE_MAX_ENTRIES ||
    recentBlobTotalBytes > RECENT_BLOB_CACHE_MAX_BYTES
  ) {
    const oldestKey = recentBlobByUrl.keys().next().value;
    if (!oldestKey) break;
    const oldest = recentBlobByUrl.get(oldestKey);
    recentBlobTotalBytes = Math.max(0, recentBlobTotalBytes - (oldest?.size || 0));
    recentBlobByUrl.delete(oldestKey);
  }
}

function getRecentBlob(url) {
  const entry = recentBlobByUrl.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    recentBlobTotalBytes = Math.max(0, recentBlobTotalBytes - entry.size);
    recentBlobByUrl.delete(url);
    return null;
  }
  recentBlobByUrl.delete(url);
  recentBlobByUrl.set(url, entry);
  return entry.blob;
}

// Coalesces concurrent fetches for the same URL across card layout/size recalculations
// (e.g. ResizeObserver or fitAllArticles changing targetH mid-flight) so we never abort
// and immediately re-request the identical Wikimedia thumbnail URL.
function fetchWikimediaBlob(url, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  const cached = getRecentBlob(url);
  if (cached) return Promise.resolve(cached);

  let sharedPromise = inflightBlobByUrl.get(url);
  if (!sharedPromise) {
    sharedPromise = fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) {
          const err = new Error(`image fetch failed (${response.status})`);
          err.status = response.status;
          throw err;
        }
        const blob = await response.blob();
        cacheRecentBlob(url, blob);
        return blob;
      })
      .catch((err) => {
        failedImageCandidateUntilByUrl.set(url, Date.now() + FAILED_CANDIDATE_COOLDOWN_MS);
        throw err;
      })
      .finally(() => {
        inflightBlobByUrl.delete(url);
      });
    inflightBlobByUrl.set(url, sharedPromise);
  }

  if (!signal) return sharedPromise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    sharedPromise.then(
      (blob) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          onAbort();
          return;
        }
        resolve(blob);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function decodeBlobToLoaderEntry(loader, request, blob, signal) {
  const baseBitmap = await createImageBitmap(blob);
  if (signal?.aborted) {
    try { baseBitmap.close(); } catch (e) { }
    throw new DOMException('Aborted', 'AbortError');
  }
  const transform = loader._computeTransform(request.options, baseBitmap.width, baseBitmap.height);
  let bitmap = baseBitmap;
  if (transform.needsCrop || transform.needsResize) {
    const opts = {};
    if (transform.resizeWidth) opts.resizeWidth = transform.resizeWidth;
    if (transform.resizeHeight) opts.resizeHeight = transform.resizeHeight;
    try {
      bitmap = await createImageBitmap(
        baseBitmap,
        transform.sx,
        transform.sy,
        transform.sw,
        transform.sh,
        opts
      );
    } finally {
      try { baseBitmap.close(); } catch (e) { }
    }
  }
  return loader._buildEntryFromBitmap(bitmap, false);
}

function waitForImageRetry(delayMs, signal) {
  if (!delayMs || delayMs <= 0) return Promise.resolve(!signal?.aborted);
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      resolve(!signal?.aborted);
    }, delayMs);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function loadCorsImageElement(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new Image();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort);
      img.onload = null;
      img.onerror = null;
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('image load error'));
    };
    img.src = url;
  });
}

async function loadSingleImageAttempt(loader, request, url, signal, originalLoadResource) {
  const reqForUrl = url === request.url && !request.cancelled
    ? request
    : { ...request, cancelled: false, url };
  if (isWikimediaHostUrl(url)) {
    // Wikimedia Commons/Wikipedia serve `Access-Control-Allow-Origin: *`. Use a single CORS
    // fetch + ImageBitmap decode for raster media instead of Histropedia's 3-step auto-mode
    // cascade (which fires 3 back-to-back requests on 429/404 and risks canvas tainting).
    if (isRawSvgUrl(url) && typeof Image !== 'undefined' && typeof loader._drawToCanvas === 'function') {
      const img = await loadCorsImageElement(url, signal);
      const width = Math.max(1, Math.round(img.naturalWidth || img.width || 500));
      const height = Math.max(1, Math.round(img.naturalHeight || img.height || 500));
      const transform = loader._computeTransform(reqForUrl.options, width, height);
      const canvas = loader._drawToCanvas(img, transform);
      return loader._buildEntryFromCanvas(canvas, false);
    }
    if (typeof createImageBitmap === 'function' && typeof loader._buildEntryFromBitmap === 'function') {
      const blob = await fetchWikimediaBlob(url, signal);
      return await decodeBlobToLoaderEntry(loader, reqForUrl, blob, signal);
    }
  }
  return await originalLoadResource.call(loader, reqForUrl, signal);
}

// Records every image's natural size as Histropedia's loader decodes it (before any
// layout-specific crop), retries across fallback Wikimedia resolutions (500px -> warm 1280px
// -> unscaled original) on transient 429/503 or uncached thumb errors, and marks articles
// whose image URL genuinely fails to load so cards and connectors shrink cleanly.
// The loader class is private, so patch it through an instance.
function trackNaturalImageAspects(timeline) {
  const proto = timeline?.imageLoader ? Object.getPrototypeOf(timeline.imageLoader) : null;
  if (!proto || typeof proto._computeTransform !== 'function') return;
  // Re-pointed on every mount so a hot-reloaded module keeps receiving updates.
  proto._chronixAspectMap = imageAspectByUrl;
  proto._chronixOnImageFailed = markArticleImageFailed;
  if (!proto._chronixAspectTracked) {
    const originalComputeTransform = proto._computeTransform;
    proto._computeTransform = function (options, width, height) {
      const url = options?.article?.data?.imageUrl;
      if (url && width > 0 && height > 0) proto._chronixAspectMap?.set(url, height / width);
      return originalComputeTransform.call(this, options, width, height);
    };
    proto._chronixAspectTracked = true;
  }
  if (!proto._chronixFailureTracked && typeof proto._loadResource === 'function') {
    const originalLoadResource = proto._loadResource;
    proto._loadResource = async function (request, signal) {
      const getConsumers = () => {
        const inflightEntry = request?.key ? this.inflight?.get?.(request.key) : null;
        return inflightEntry?.requests?.length ? inflightEntry.requests : [request];
      };
      const getActiveRequest = () => {
        const consumers = getConsumers();
        for (let i = 0; i < consumers.length; i++) {
          if (consumers[i] && !consumers[i].cancelled) return consumers[i];
        }
        return null;
      };
      const notifyFailure = () => {
        if (signal?.aborted) return;
        const consumers = getConsumers();
        for (let i = 0; i < consumers.length; i++) {
          const req = consumers[i];
          if (!req || req.cancelled) continue;
          const art = req.options?.article;
          if (art) {
            proto._chronixOnImageFailed?.(art, req.url);
          }
        }
      };
      const clearFailure = () => {
        const consumers = getConsumers();
        for (let i = 0; i < consumers.length; i++) {
          const art = consumers[i]?.options?.article;
          if (art && art._chronixFailedImageUrl) {
            art._chronixFailedImageUrl = null;
          }
        }
      };

      const activeSeedReq = getActiveRequest();
      if (!activeSeedReq || signal?.aborted) return null;

      const seedArt = activeSeedReq.options?.article;
      const primaryUrl = activeSeedReq.url;
      const rawSeed = seedArt?.data?.rawImageUrl || seedArt?.rawImageUrl || primaryUrl;
      const uniqueCandidates = [];
      const resolvedPreferred = primaryUrl ? resolvedImageCandidateByUrl.get(primaryUrl) : null;
      if (resolvedPreferred) uniqueCandidates.push(resolvedPreferred);
      if (primaryUrl && !uniqueCandidates.includes(primaryUrl)) uniqueCandidates.push(primaryUrl);
      for (const candidate of getCanvasImageCandidates(rawSeed)) {
        if (candidate && !uniqueCandidates.includes(candidate)) {
          uniqueCandidates.push(candidate);
        }
      }

      const now = Date.now();
      const freshUrls = [];
      const cooledUrls = [];
      for (const candidate of uniqueCandidates) {
        const cooldownUntil = failedImageCandidateUntilByUrl.get(candidate) || 0;
        if (cooldownUntil > now) {
          cooledUrls.push(candidate);
        } else {
          if (cooldownUntil) failedImageCandidateUntilByUrl.delete(candidate);
          freshUrls.push(candidate);
        }
      }
      const orderedUrls = [...freshUrls, ...cooledUrls];
      if (uniqueCandidates.length === 1 && freshUrls.length === 1 && /^https?:\/\//i.test(orderedUrls[0])) {
        orderedUrls.push(orderedUrls[0]);
      }

      let lastError = null;
      for (let attempt = 0; attempt < orderedUrls.length; attempt++) {
        if (signal?.aborted) break;
        const activeReq = getActiveRequest();
        if (!activeReq) return null;

        if (attempt > 0) {
          const canContinue = await waitForImageRetry(IMAGE_RETRY_BASE_DELAY_MS * attempt, signal);
          if (!canContinue || !getActiveRequest()) return null;
        }

        const candidateUrl = orderedUrls[attempt];
        try {
          const entry = await loadSingleImageAttempt(
            this,
            activeReq,
            candidateUrl,
            signal,
            originalLoadResource
          );
          if (entry) {
            failedImageCandidateUntilByUrl.delete(candidateUrl);
            if (primaryUrl && candidateUrl !== primaryUrl) {
              resolvedImageCandidateByUrl.set(primaryUrl, candidateUrl);
            }
            clearFailure();
            return entry;
          }
        } catch (err) {
          lastError = err;
          if (signal?.aborted || err?.name === 'AbortError') {
            break;
          }
          failedImageCandidateUntilByUrl.set(candidateUrl, Date.now() + FAILED_CANDIDATE_COOLDOWN_MS);
        }
      }

      if (signal?.aborted) {
        if (lastError) throw lastError;
        return null;
      }
      notifyFailure();
      if (lastError) throw lastError;
      return null;
    };
    proto._chronixFailureTracked = true;
  }
}

function disposeTimelineResources(tl) {
  if (!tl) return;
  tl._chronixDisposed = true;
  tl._chronixDeferImageEnqueue = true;
  if (tl._chronixInitFrame != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(tl._chronixInitFrame);
    tl._chronixInitFrame = null;
  }
  if (tl._chronixInitFitTimer) {
    clearTimeout(tl._chronixInitFitTimer);
    tl._chronixInitFitTimer = null;
  }
  if (tl._chronixGifTimer) {
    clearTimeout(tl._chronixGifTimer);
    tl._chronixGifTimer = null;
  }
  if (Array.isArray(tl.articles)) {
    for (let i = 0; i < tl.articles.length; i++) {
      const art = tl.articles[i];
      if (!art) continue;
      if (typeof art._imageCancel === 'function') {
        try { art._imageCancel(); } catch (e) { }
        art._imageCancel = null;
      }
      if (typeof art._releaseImageResource === 'function') {
        try { art._releaseImageResource(); } catch (e) { }
      }
    }
  }
  const loader = tl.imageLoader;
  if (loader) {
    if (Array.isArray(loader.queue)) {
      for (let i = 0; i < loader.queue.length; i++) {
        if (loader.queue[i]) loader.queue[i].cancelled = true;
      }
      loader.queue.length = 0;
    }
    if (loader.inflight?.values) {
      for (const entry of loader.inflight.values()) {
        if (Array.isArray(entry?.requests)) {
          for (let i = 0; i < entry.requests.length; i++) {
            if (entry.requests[i]) entry.requests[i].cancelled = true;
          }
        }
        try { entry?.controller?.abort?.(); } catch (e) { }
      }
      loader.inflight.clear?.();
    }
    if (loader.cache?.entries && typeof loader._evictEntry === 'function') {
      for (const [key, entry] of Array.from(loader.cache.entries())) {
        try { loader._evictEntry(key, entry); } catch (e) { }
      }
    }
  }
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
  const isToy = isToyThemeActive();
  const fontFamily = getCanvasFont(isToy);
  const lines = getCachedWrappedLines(title, getPortraitTitleTextWidth(), `${isToy ? 700 : 600} 13px ${fontFamily}`);
  const header = getPortraitHeaderHeight(Math.max(1, lines.length));
  let imageHeight = 0;
  if (hasArticleImageSource(article)) {
    const aspect = getNaturalImageAspect(article);
    imageHeight = aspect
      ? Math.min(PORTRAIT_IMAGE_MAX_HEIGHT, aspect * (PORTRAIT_CARD_WIDTH - 0.5))
      : PORTRAIT_IMAGE_MAX_HEIGHT;
  }
  const subLines = getPortraitSubtitleLines(article, getPortraitSubtitleTextWidth(), `${isToy ? 700 : 500} 11px ${fontFamily}`);
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

function compareChronologicalStackOrder(a, b) {
  if (a?.period?.from && b?.period?.from && typeof a.period.from.compare === 'function') {
    const cmp = a.period.from.compare(b.period.from);
    if (cmp !== 0) return cmp;
  }
  const orderA = typeof a?._chronixOrder === 'number' ? a._chronixOrder : (typeof a?.data?._chronixOrder === 'number' ? a.data._chronixOrder : null);
  const orderB = typeof b?._chronixOrder === 'number' ? b._chronixOrder : (typeof b?.data?._chronixOrder === 'number' ? b.data._chronixOrder : null);
  if (orderA !== null && orderB !== null && orderA !== orderB) {
    return orderA - orderB;
  }
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { numeric: true });
}

function compareArticleRenderRowOrder(articleA, articleB) {
  const laneOrderA = articleA?.laneOrder || 0;
  const laneOrderB = articleB?.laneOrder || 0;
  if (laneOrderA !== laneOrderB) return laneOrderB - laneOrderA;
  const rowA = Number.isFinite(articleA?.row) ? articleA.row : 0;
  const rowB = Number.isFinite(articleB?.row) ? articleB.row : 0;
  if (rowA !== rowB) return rowB - rowA;
  return compareChronologicalStackOrder(articleA, articleB);
}

// Same priority as ChroniX's stack(): selected, then starred, then chronological order.
function compareStackPriority(selectedId) {
  return (a, b) => {
    const aSelected = Boolean(selectedId) && isSameArticleId(a.id, selectedId);
    const bSelected = Boolean(selectedId) && isSameArticleId(b.id, selectedId);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    if (Boolean(a.isStarred) !== Boolean(b.isStarred)) return a.isStarred ? -1 : 1;
    return compareChronologicalStackOrder(a, b);
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
  if (tl?._isMapEventCardVisible) {
    return 'circle';
  }
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
    if (tl._isMapEventCardVisible && isSameArticleId(art.id, tl._selectedArticleId)) {
      if (art.cardLayout !== 'circle') {
        art.cardLayout = 'circle';
        art._resolvedCardLayoutName = 'circle';
        art._resolvedDefaultCardLayout = 'circle';
        if (typeof art.invalidateCaches === 'function') art.invalidateCaches();
        changed = true;
      }
      return;
    }
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

  let _toyConnectorCanvas = null;
  let _toyConnectorCtx = null;
  function getToyConnectorLayer(minPixelW, minPixelH) {
    if (typeof document === 'undefined') return null;
    if (!_toyConnectorCanvas) {
      _toyConnectorCanvas = document.createElement('canvas');
      _toyConnectorCtx = _toyConnectorCanvas.getContext('2d');
    }
    if (!_toyConnectorCtx) return null;
    const w = Math.max(1, Math.ceil(minPixelW));
    const h = Math.max(1, Math.ceil(minPixelH));
    if (_toyConnectorCanvas.width < w || _toyConnectorCanvas.height < h) {
      _toyConnectorCanvas.width = Math.max(_toyConnectorCanvas.width, w);
      _toyConnectorCanvas.height = Math.max(_toyConnectorCanvas.height, h);
    }
    return { canvas: _toyConnectorCanvas, ctx: _toyConnectorCtx };
  }

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
    const isSelected = Boolean(
      (this.isActive && !this._chronixFakeActive) ||
      (selectedId && isSameArticleId(this.id, selectedId))
    );
    const isHigh = Boolean(this.isMouseover || this.isDragging || isSelected);
    const isToy = isToyThemeActive();
    const baseAlpha = typeof this.opacity === 'number' ? this.opacity : 1;
    const lineAlpha = isHigh ? baseAlpha : baseAlpha * 0.45;

    const style = this._getCurrentStyle();
    // The period/connector lines carry the timeline (lane) color, kept independent from the
    // card header background so the title itself can render on the plain card background.
    const lineColor = resolveConnectorColor(style.connectorLine?.color) || style.color;
    const geometry = this._getPeriodLineRenderGeometry(axisY);
    const y = geometry.y;

    if (isToy) {
      // In 3D Toy Blocks mode, render the entire connector assembly (period bar, vertical
      // stem, circular axis peg, and card arrow triangle) in two unified passes: Pass 1 draws
      // all outer borders, and Pass 2 draws all colored inner fills on top.
      // In the idle state (!isHigh), the assembly is slimmer and composited via an offscreen
      // layer at reduced opacity so non-hovered / non-selected lines look light, faded, and
      // semi-transparent without internal seam blobs or dark border bleed-through.
      const isDark = Boolean(window.__chronixDarkTheme);
      const toyAlpha = isHigh ? baseAlpha : baseAlpha * (isDark ? 0.55 : 0.5);
      const outlineColor = isHigh ? '#0f172a' : (isDark ? '#38466a' : '#334155');

      const fromX = this.indicator.fromX;
      const toX = this.indicator.toX;
      const periodFillWidth = isSelected
        ? Math.max(5.5, geometry.thickness || 4)
        : isHigh
          ? Math.max(5, geometry.thickness || 4)
          : Math.max(3.6, (geometry.thickness || 4) * 0.8);
      const periodBorderWidth = periodFillWidth + (isSelected ? 4 : isHigh ? 3.8 : 2.4);

      const hasConnector = Boolean(style.connectorLine.visible);
      let x1 = 0, y1 = y, x2 = 0, y2 = 0, radians = 0, arrowWidth = 16, arrowHeight = 45;
      const stemFillWidth = isSelected ? 4.4 : isHigh ? 3.8 : 2.4;
      const stemBorderWidth = stemFillWidth + (isSelected ? 4 : isHigh ? 3.8 : 2.4);
      const pegFillRadius = isSelected ? 5.8 : isHigh ? 5.2 : 3.4;
      const pegBorderRadius = pegFillRadius + (isSelected ? 2.2 : isHigh ? 2 : 1.4);
      const arrowOutlineWidth = isSelected ? 3.8 : isHigh ? 3.6 : 2.4;

      if (hasConnector) {
        const cardLayout = this._getCurrentCardLayout();
        const connectorEnd = typeof cardLayout.getConnectorEnd === 'function'
          ? cardLayout.getConnectorEnd.call(this)
          : {
            left: this.position.left + style.connectorLine.offsetX,
            top: this.position.top + this.getHeight() + style.connectorLine.offsetY,
          };
        x1 = Math.max(0, this.indicator.fromX);
        y1 = y;
        x2 = connectorEnd.left;
        y2 = connectorEnd.top;

        const dx = x2 - x1;
        const dy = y2 - y1;
        if (Math.abs(dx) < 0.001) {
          radians = dy <= 0 ? Math.PI : 0;
        } else {
          radians = Math.atan(dy / dx) + (x2 >= x1 ? -90 : 90) * Math.PI / 180;
        }

        const layoutName = typeof this._getCurrentCardLayoutName === 'function'
          ? this._getCurrentCardLayoutName()
          : (this._resolvedCardLayoutName || 'portrait');
        const isCompact = layoutName === 'compact' || layoutName === 'circle';
        arrowWidth = isCompact
          ? (isSelected ? 9.8 : isHigh ? 8.8 : 6.5)
          : (isSelected ? 17.5 : isHigh ? 16 : 12);
        arrowHeight = isCompact
          ? (isSelected ? 26 : isHigh ? 24 : 19)
          : (isSelected ? 48 : isHigh ? 45 : 35);
      }

      const drawToyAssembly = (targetCtx) => {
        // --- PASS 1: Unified outer outline silhouette ---
        if (!this.hidePeriodLine) {
          targetCtx.save();
          targetCtx.lineCap = 'round';
          targetCtx.lineWidth = periodBorderWidth;
          targetCtx.beginPath();
          targetCtx.moveTo(fromX, y);
          targetCtx.lineTo(toX, y);
          if (this.period.isToPresent && toX > fromX) {
            const periodLength = toX - fromX, maxFadeLength = 15;
            const fadeStartColorStop = Math.max(1 - maxFadeLength / periodLength, 0.7);
            const borderGrad = targetCtx.createLinearGradient(fromX, y, toX, y);
            borderGrad.addColorStop(0, outlineColor);
            borderGrad.addColorStop(fadeStartColorStop, outlineColor);
            borderGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
            targetCtx.strokeStyle = borderGrad;
          } else {
            targetCtx.strokeStyle = outlineColor;
          }
          targetCtx.stroke();
          targetCtx.restore();
        }

        if (hasConnector) {
          targetCtx.save();
          targetCtx.lineCap = 'round';
          targetCtx.strokeStyle = outlineColor;
          targetCtx.lineWidth = stemBorderWidth;
          targetCtx.beginPath();
          targetCtx.moveTo(x1, y1);
          targetCtx.lineTo(x2, y2);
          targetCtx.stroke();
          targetCtx.restore();

          targetCtx.save();
          targetCtx.beginPath();
          targetCtx.translate(x2, y2);
          targetCtx.rotate(radians);
          targetCtx.moveTo(-arrowWidth, 0);
          targetCtx.lineTo(arrowWidth, 0);
          targetCtx.lineTo(0, -arrowHeight);
          targetCtx.closePath();
          targetCtx.restore();
          targetCtx.save();
          targetCtx.fillStyle = outlineColor;
          targetCtx.strokeStyle = outlineColor;
          targetCtx.lineWidth = arrowOutlineWidth;
          targetCtx.lineJoin = 'round';
          targetCtx.fill();
          targetCtx.stroke();
          targetCtx.restore();

          targetCtx.save();
          targetCtx.beginPath();
          targetCtx.arc(x1, y1, pegBorderRadius, 0, Math.PI * 2);
          targetCtx.fillStyle = outlineColor;
          targetCtx.fill();
          targetCtx.restore();
        }

        // --- PASS 2: Unified colored inner fill on top (seamless junctions) ---
        if (!this.hidePeriodLine) {
          targetCtx.save();
          targetCtx.lineCap = 'round';
          targetCtx.lineWidth = periodFillWidth;
          targetCtx.beginPath();
          targetCtx.moveTo(fromX, y);
          targetCtx.lineTo(toX, y);
          if (this.period.isToPresent && toX > fromX) {
            const periodLength = toX - fromX, maxFadeLength = 15;
            const fadeStartColorStop = Math.max(1 - maxFadeLength / periodLength, 0.7);
            const grad = targetCtx.createLinearGradient(fromX, y, toX, y);
            grad.addColorStop(0, lineColor);
            grad.addColorStop(fadeStartColorStop, lineColor);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            targetCtx.strokeStyle = grad;
          } else {
            targetCtx.strokeStyle = lineColor;
          }
          targetCtx.stroke();
          targetCtx.restore();
        }

        if (hasConnector) {
          targetCtx.save();
          targetCtx.lineCap = 'round';
          targetCtx.strokeStyle = lineColor;
          targetCtx.lineWidth = stemFillWidth;
          targetCtx.beginPath();
          targetCtx.moveTo(x1, y1);
          targetCtx.lineTo(x2, y2);
          targetCtx.stroke();
          targetCtx.restore();

          targetCtx.save();
          targetCtx.beginPath();
          targetCtx.translate(x2, y2);
          targetCtx.rotate(radians);
          targetCtx.moveTo(-arrowWidth, 0);
          targetCtx.lineTo(arrowWidth, 0);
          targetCtx.lineTo(0, -arrowHeight);
          targetCtx.closePath();
          targetCtx.restore();
          targetCtx.fillStyle = lineColor;
          targetCtx.fill();

          targetCtx.save();
          targetCtx.beginPath();
          targetCtx.arc(x1, y1, pegFillRadius, 0, Math.PI * 2);
          targetCtx.fillStyle = lineColor;
          targetCtx.fill();
          if (isHigh) {
            targetCtx.beginPath();
            targetCtx.arc(x1, y1, isSelected ? 2.2 : 1.9, 0, Math.PI * 2);
            targetCtx.fillStyle = '#fef9c3';
            targetCtx.fill();
          }
          targetCtx.restore();
        }
      };

      if (toyAlpha < 0.99) {
        const xs = [];
        const ys = [];
        if (!this.hidePeriodLine && Number.isFinite(fromX) && Number.isFinite(toX) && Number.isFinite(y)) {
          xs.push(fromX, toX);
          ys.push(y);
        }
        if (hasConnector && Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
          xs.push(x1, x2);
          ys.push(y1, y2);
        }
        if (xs.length > 0 && ys.length > 0) {
          const dpr = ctx.canvas?._dpr || this.owner?.getCanvasDpr?.() || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
          const canvasCssW = (ctx.canvas?.width ? ctx.canvas.width / dpr : 0) || this.owner?.getWidth?.() || 2000;
          const canvasCssH = (ctx.canvas?.height ? ctx.canvas.height / dpr : 0) || this.owner?.options?.height || 1200;
          const margin = Math.ceil((hasConnector ? Math.hypot(arrowWidth, arrowHeight) : 0) + Math.max(periodBorderWidth, stemBorderWidth, pegBorderRadius * 2) + 6);
          const boxX = Math.max(0, Math.floor(Math.min(...xs) - margin));
          const boxY = Math.max(0, Math.floor(Math.min(...ys) - margin));
          const boxRight = Math.min(canvasCssW, Math.ceil(Math.max(...xs) + margin));
          const boxBottom = Math.min(canvasCssH, Math.ceil(Math.max(...ys) + margin));
          const boxW = boxRight - boxX;
          const boxH = boxBottom - boxY;
          if (boxW <= 0 || boxH <= 0) {
            ctx.globalAlpha = 1;
            return;
          }
          const srcW = Math.round(boxW * dpr);
          const srcH = Math.round(boxH * dpr);
          const layer = getToyConnectorLayer(srcW + 2, srcH + 2);
          if (layer && srcW > 0 && srcH > 0) {
            const lctx = layer.ctx;
            lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            lctx.clearRect(0, 0, boxW + 2, boxH + 2);
            lctx.save();
            lctx.translate(-boxX, -boxY);
            lctx.globalAlpha = 1;
            drawToyAssembly(lctx);
            lctx.restore();

            ctx.save();
            ctx.globalAlpha = toyAlpha;
            ctx.drawImage(layer.canvas, 0, 0, srcW, srcH, boxX, boxY, boxW, boxH);
            ctx.restore();
            ctx.globalAlpha = 1;
            return;
          }
        }
      }

      ctx.globalAlpha = toyAlpha;
      drawToyAssembly(ctx);
      ctx.globalAlpha = 1;
      return;
    }

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

    // Connector line: semi-transparent in the normal state
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
    const isCompact = layoutName === 'compact' || layoutName === 'circle';

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
    if (layoutName === 'circle') {
      return CIRCLE_CARD_SIZE;
    }
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
    if (layoutName === 'circle') {
      return CIRCLE_CARD_SIZE;
    }
    if (layoutName === 'compact') {
      return getCompactWidthForArticle(this);
    }
    if (layoutName === 'landscape') {
      return LANDSCAPE_CARD_WIDTH;
    }
    return Article.prototype._originalChroniX_GetWidth.call(this);
  };

  // Patch Article.prototype.getHeight so compact & landscape cards return dynamic height matching
  // the title lines, while portrait cards always return `_cachedHeight` (the exact height drawn by
  // `portrait.draw` and hit-tested by `isInside`). Returning a speculative height here detaches
  // `portrait.getConnectorEnd()` (the connector arrow triangle) from the card bottom when an image
  // has not loaded yet or fails to load.
  Article.prototype.getHeight = function () {
    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');
    if (layoutName === 'circle') {
      return CIRCLE_CARD_SIZE;
    }
    if (layoutName === 'compact') {
      return getCompactHeightForArticle(this);
    }
    if (layoutName === 'landscape') {
      return getLandscapeHeightForArticle(this);
    }
    this._ensureSizeCache();
    return this._cachedHeight;
  };

  // Patch _getSizeCacheKey so any change in article title or image availability invalidates the cached card dimensions.
  // HistropediaJS v1.7+ returns an Array of key parts (checked via `cacheKey.some(...)` in `_ensureSizeCache`).
  if (!Article.prototype._originalChroniXGetSizeCacheKey) {
    Article.prototype._originalChroniXGetSizeCacheKey = Article.prototype._getSizeCacheKey;
  }
  Article.prototype._getSizeCacheKey = function () {
    const baseKey = this._originalChroniXGetSizeCacheKey ? this._originalChroniXGetSizeCacheKey.call(this) : [];
    const title = this.title || this.data?.title || '';
    const subtitle = this.subtitle || this.data?.subtitle || '';
    const hasImage = hasArticleImageSource(this) || (!isArticleImageFailed(this) && Boolean(this.data?.image));
    const imageReady = Boolean(this.imageLoaded && this.image);
    const themeKey = `${isToyThemeActive() ? 'toy' : 'classic'}:${getCanvasFont()}`;
    if (Array.isArray(baseKey)) {
      baseKey.push(title, subtitle, hasImage, imageReady, themeKey);
      return baseKey;
    }
    return `${baseKey}|title:${title}|subtitle:${subtitle}|img:${hasImage}:${imageReady}|theme:${themeKey}`;
  };

  // Patch Article.prototype.getCurrentStyle & _getCurrentStyle so that:
  // 1. In landscape layout, event titles always contrast against the card background
  // 2. In portrait layout, style.header.height dynamically expands so the FULL title is always visible
  // 3. In landscape layout, style.height dynamically expands so the FULL title is always visible
  // 4. numberOfLines is never clamped to 2, ensuring Histropedia never truncates event titles
  function getRawArticleStyle(article) {
    if (article.isActive) {
      return article.isMouseover ? (article.activeHoverStyle || article.activeStyle) : (article.activeStyle || article.style);
    }
    return article.isMouseover ? (article.hoverStyle || article.style) : article.style;
  }

  function chronixGetCurrentStyle() {
    // While we temporarily force isActive to reveal the star on hover, keep the card
    // rendered with its hover style rather than the "selected"/active style.
    let restoreActive = false;
    if (this._chronixFakeActive && this.isActive) {
      this.isActive = false;
      restoreActive = true;
    }
    const style = getRawArticleStyle(this);
    if (restoreActive) this.isActive = true;
    if (!style) return style;

    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');

    const title = this.title || this.data?.title || '';
    const subtitle = this.subtitle || this.data?.subtitle || '';
    const isRtl = areTextsRtl([title, subtitle], Boolean(window.__chronixIsRtl));
    const textAlign = isRtl ? 'right' : 'left';
    const isToy = isToyThemeActive();
    const fontFamily = getCanvasFont(isToy);

    const headerText = {
      ...style.header?.text,
      align: textAlign,
    };
    const subheaderText = {
      ...style.subheader?.text,
      align: textAlign,
    };

    if (layoutName === 'landscape') {
      const bg = style.backgroundColor || (this.owner?._isDarkTheme ? (isToy ? '#1a2338' : '#18181b') : '#ffffff');
      const isBgLight = isColorLight(bg);
      const landscapeTextColor = isToy
        ? (isBgLight ? '#0f172a' : '#ffffff')
        : (isBgLight ? '#18181b' : '#f4f4f5');
      headerText.color = landscapeTextColor;
      const landscapeSubtextColor = isToy
        ? (isBgLight ? '#334155' : '#aab6cc')
        : (isBgLight ? '#71717a' : '#a1a1aa');
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
      const cardWidth = style.width ?? PORTRAIT_CARD_WIDTH;
      const textWidth = getPortraitTitleTextWidth(cardWidth, textMargin);
      const font = headerText.font || `${isToy ? 700 : 600} 13px ${fontFamily}`;
      const lines = getCachedWrappedLines(title, textWidth, font);
      const lineCount = Math.max(1, lines.length);
      const lineHeight = headerText.lineHeight || 18;

      dynamicHeaderHeight = getPortraitHeaderHeight(lineCount, lineHeight);
      headerText.numberOfLines = Math.max(lineCount, 8);
      headerText.lineHeight = lineHeight;

      const subLines = getPortraitSubtitleLines(
        this,
        getPortraitSubtitleTextWidth(cardWidth, subheaderText.margin ?? 10),
        subheaderText.font || `${isToy ? 700 : 500} 11px ${fontFamily}`
      );
      if (subLines.length > 1) {
        dynamicSubheaderHeight = getPortraitSubheaderHeight(subLines.length);
        subheaderText.chronixColor = style.subheader?.text?.color || subheaderText.color;
        subheaderText.color = 'rgba(0, 0, 0, 0)';
      }
    } else if (layoutName === 'landscape') {
      dynamicCardHeight = getLandscapeHeightForArticle(this);
      headerText.numberOfLines = 10;
      headerText.lineHeight = 15;
    }

    const hasThemeFrame = layoutName === 'portrait' && !isToy && Boolean(getActiveThemeCardFrame());

    return {
      ...style,
      ...(layoutName === 'landscape' ? { height: dynamicCardHeight, width: LANDSCAPE_CARD_WIDTH } : {}),
      ...(layoutName === 'portrait' && isToy ? { border: { ...style.border, color: 'rgba(0, 0, 0, 0)' } } : {}),
      ...(hasThemeFrame ? {
        border: { ...style.border, color: 'rgba(0, 0, 0, 0)' },
        shadow: { ...style.shadow, amount: 0, x: 0, y: 0, color: 'rgba(0, 0, 0, 0)' },
      } : {}),
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
  }

  Article.prototype.getCurrentStyle = chronixGetCurrentStyle;
  Article.prototype._getCurrentStyle = chronixGetCurrentStyle;

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
    const isRtl = isArticleRtl(this);
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

    const prevDrawImage = ctx.drawImage;
    if (this.imageLoaded && this.image) {
      const articleImage = this.image;
      ctx.drawImage = function (img, ...args) {
        if (img === articleImage) {
          let dx, dy, dw, dh;
          if (args.length >= 8) {
            dx = args[4]; dy = args[5]; dw = args[6]; dh = args[7];
          } else if (args.length >= 4) {
            dx = args[0]; dy = args[1]; dw = args[2]; dh = args[3];
          }
          if (Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dw) && Number.isFinite(dh)) {
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(dx, dy, dw, dh);
            ctx.restore();
          }
        }
        return prevDrawImage.apply(this, [img, ...args]);
      };
    }

    try {
      const isToy = isToyThemeActive();
      const isPortrait = layoutName === 'portrait';
      if (isPortrait && typeof this._ensureSizeCache === 'function') {
        this._ensureSizeCache();
      }
      const hasPos = this.isDataLoaded && !isNaN(this.position?.left);
      const dpr = this.owner?.getCanvasDpr?.() || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
      const snap = (v) => Math.round(v * dpr) / dpr;
      const pLeft = hasPos ? snap(this.position.left) : 0;
      const pTop = hasPos ? snap(this.position.top) : 0;
      const pWidth = hasPos
        ? snap(typeof this._getWidth === 'function' ? this._getWidth() : (typeof this.getWidth === 'function' ? this.getWidth() : 150))
        : 150;
      const pHeight = hasPos
        ? snap((typeof this._cachedHeight === 'number' && this._cachedHeight > 0) ? this._cachedHeight : (typeof this.getHeight === 'function' ? this.getHeight() : 200))
        : 200;

      if (isToy && isPortrait && hasPos) {
        const pStyle = this._getCurrentStyle();
        // 1. 3D Toy Block Bottom Lip Shadow
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, pLeft, pTop + 5, pWidth, pHeight, 10);
        ctx.fillStyle = getToyLipColor();
        ctx.fill();
        ctx.restore();

        // 2. Clip the entire portrait card interior (header, subheader, and bottom image)
        // to the 10px rounded rectangle so Histropedia's sharp 90-degree bottom corners never show.
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, pLeft, pTop, pWidth, pHeight, 10);
        ctx.fillStyle = pStyle?.backgroundColor || (window.__chronixDarkTheme ? '#1a2338' : '#ffffff');
        ctx.fill();
        ctx.clip();
      }

      const themeFrame = !isToy && isPortrait && hasPos ? getActiveThemeCardFrame() : null;
      let themeFrameOpts = null;
      if (themeFrame) {
        // Same shell as the custom landscape/compact cards: themed shadow + fill underneath,
        // the engine's card clipped inside, then the themed decorations and outline on top.
        const pStyle = this._getCurrentStyle();
        themeFrameOpts = {
          accent: resolveConnectorColor(pStyle?.connectorLine?.color) || pStyle?.color || (window.__chronixDarkTheme ? '#818cf8' : '#4f46e5'),
          isActive: Boolean((this.isActive && !this._chronixFakeActive) || isSameArticleId(this.id, this.owner?._selectedArticleId)),
          isMouseover: Boolean(this.isMouseover),
          isDark: Boolean(window.__chronixDarkTheme),
        };
        themeFrame.draw(ctx, pLeft, pTop, pWidth, pHeight, themeFrame.radius, themeFrameOpts.accent, themeFrameOpts);
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, pLeft, pTop, pWidth, pHeight, themeFrame.radius);
        ctx.clip();
      }

      this._originalChroniXDraw.call(this, ctx);
      if (isPortrait) drawPortraitSubtitleLines(ctx, this);

      if (themeFrame) {
        ctx.restore();
        themeFrame.draw(ctx, pLeft, pTop, pWidth, pHeight, themeFrame.radius, themeFrameOpts.accent, { ...themeFrameOpts, overlayOnly: true });
        const starOptions = this.owner?.options?.article?.star;
        if (starOptions?.visible !== false && (this.isActive || this.isStarred)) {
          const iconBox = this.getIconBox();
          if (iconBox) {
            drawCardStar(ctx, iconBox, this.isStarred, this.isMouseOverStar);
          }
        }
      }

      if (isToy && isPortrait && hasPos) {
        ctx.restore();

        const pStyle = this._getCurrentStyle();
        const pCatColor = resolveConnectorColor(pStyle?.connectorLine?.color) || '#22c55e';
        const isSel = Boolean((this.isActive && !this._chronixFakeActive) || isSameArticleId(this.id, this.owner?._selectedArticleId));

        // 3. Colorful 3D toy top accent bar
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, pLeft, pTop, pWidth, pHeight, 10);
        ctx.clip();
        ctx.fillStyle = pCatColor;
        ctx.fillRect(pLeft, pTop, pWidth, 5);
        ctx.restore();

        // 4. Crisp dark 3D toy outline around all 4 rounded corners
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, pLeft, pTop, pWidth, pHeight, 10);
        ctx.strokeStyle = getToyEdgeColor();
        ctx.lineWidth = isSel ? 3.2 : 2.4;
        ctx.stroke();
        ctx.restore();

        // 5. Ensure star sits cleanly above the top accent bar and border
        const starOptions = this.owner?.options?.article?.star;
        if (starOptions?.visible !== false && (this.isActive || this.isStarred)) {
          const iconBox = this.getIconBox();
          if (iconBox) {
            drawCardStar(ctx, iconBox, this.isStarred, this.isMouseOverStar);
          }
        }
      }

      drawCardEditedBadge(ctx, this);
    } finally {
      ctx.drawImage = prevDrawImage;
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
    // Focus Lens: every in-range event is shown (as a dot at least); no stacking rows.
    if (this.owner?._chronixLens?.active) {
      const visible = Boolean(this.isInRange && this.isVisibleInLane !== false && !this.isHiddenByFilter);
      if (visible !== this.isVisible || visible !== this.isVisibleAfterFade) {
        if (visible && !this.isImageInfoLoaded && typeof this.setImage === 'function') this.setImage();
        this.setVisibility(visible);
      }
      return;
    }
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
          if (isToyThemeActive()) {
            val = '#facc15';
          } else {
            const isDark = Boolean(window.__chronixDarkTheme);
            val = isDark ? '#e5a83b' : '#b87326';
          }
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
            if (isToyThemeActive()) {
              val = '#0f172a';
            } else {
              const isDark = Boolean(window.__chronixDarkTheme);
              val = isDark ? '#f2b955' : '#8c591b';
            }
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

// Night Toy palette mirrors the CSS --toy-edge / --toy-lip tokens: dark indigo cards get a
// quiet slate rim and slate 3D lip instead of a near-black edge that melts into the night canvas.
function getToyEdgeColor() {
  return window.__chronixDarkTheme ? '#38466a' : '#0f172a';
}

function getToyLipColor() {
  return window.__chronixDarkTheme ? '#2a3654' : '#0f172a';
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
  const isToy = isToyThemeActive();

  ctx.save();
  if (isToy) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const outerR = box.outerRadius * 1.15;
    const innerR = box.innerRadius * 1.25;

    // 3D Bottom Lip for the star
    ctx.beginPath();
    for (let index = 0; index < spikes * 2; index += 1) {
      const radius = index % 2 === 0 ? outerR : innerR;
      const x = box.centreX + Math.cos(1 + index * angle) * radius;
      const y = box.centreY + 1.5 + Math.sin(1 + index * angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = getToyLipColor();
    ctx.fill();

    // Main Plump Toy Star
    ctx.beginPath();
    for (let index = 0; index < spikes * 2; index += 1) {
      const radius = index % 2 === 0 ? outerR : innerR;
      const x = box.centreX + Math.cos(1 + index * angle) * radius;
      const y = box.centreY + Math.sin(1 + index * angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = isStarred ? '#facc15' : (isHovered ? '#fef08a' : '#e2e8f0');
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

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

  // Badge label follows the interface language; its placement follows the card's text direction.
  const isUiRtl = Boolean(window.__chronixIsRtl);
  const label = isUiRtl ? 'נערך' : 'Edited';

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
    const badgeW = isHovered ? (isUiRtl ? 52 : 54) : 18;
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

// Card direction follows the language of the card's own text (title + subtitle).
// The interface direction is only a fallback for directionally neutral text.
function isArticleRtl(article) {
  const title = article?.title || article?.data?.title || '';
  const subtitle = article?.subtitle || article?.data?.subtitle || '';
  return areTextsRtl([title, subtitle], Boolean(window.__chronixIsRtl));
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
  const isToy = isToyThemeActive();
  const r = isToy ? 7 : 4;
  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, x, y, size, size, r);
  ctx.clip();
  if (img && img.width > 0 && img.height > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    const side = Math.min(img.width, img.height);
    const focus = (value) => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 50)) / 100;
    const sx = (img.width - side) * focus(article.data?.imagePositionX);
    const sy = (img.height - side) * focus(article.data?.imagePositionY);
    ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = isToy ? 0.3 : 0.16;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
  if (isToy) {
    ctx.save();
    ctx.beginPath();
    drawPillPath(ctx, x, y, size, size, r);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
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
    const isToy = isToyThemeActive();
    const radius = isToy ? 11 : 6;

    // Category / lane accent color
    const categoryColor = resolveConnectorColor(style.connectorLine?.color) || style.color || (isDark ? '#818cf8' : '#4f46e5');

    if (isToy) {
      // 3D Toy Block Bottom Lip Shadow
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, left, top + (isActive ? 5 : 4), width, height, radius);
      ctx.fillStyle = getToyLipColor();
      ctx.fill();
      ctx.restore();

      // Card background fill
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, radius);
      if (isActive) {
        ctx.fillStyle = isDark ? '#283552' : '#fef9c3';
      } else if (this.isMouseover) {
        ctx.fillStyle = isDark ? '#212c45' : '#f0f9ff';
      } else {
        ctx.fillStyle = isDark ? '#1a2338' : '#ffffff';
      }
      ctx.fill();

      // Colorful top accent bar
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, radius);
      ctx.clip();
      ctx.fillStyle = categoryColor;
      ctx.fillRect(left, top, width, 4.5);
      ctx.restore();

      // Crisp dark toy outline
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, radius);
      ctx.strokeStyle = getToyEdgeColor();
      ctx.lineWidth = isActive ? 2.8 : 2.2;
      ctx.stroke();
    } else if (isComicThemeActive()) {
      drawComicCardFrame(ctx, left, top, width, height, 3, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else if (isJournalThemeActive()) {
      drawJournalCardFrame(ctx, left, top, width, height, 3, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else if (isBentoCardLook()) {
      drawBentoCardFrame(ctx, left, top, width, height, 12, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else {
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
    const textColor = isToy
      ? (isDark ? '#ffffff' : '#0f172a')
      : (isActive ? (isDark ? '#ffffff' : '#09090b') : (isDark ? '#e4e4e7' : '#18181b'));

    ctx.font = `${isToy ? 700 : 600} 11px ${getCanvasFont(isToy)}`;
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

export const circleCardLayout = {
  name: 'circle',
  getWidth() {
    return CIRCLE_CARD_SIZE;
  },
  getHeight() {
    return CIRCLE_CARD_SIZE;
  },
  getConnectorEnd() {
    const style = this._getCurrentStyle?.() || {};
    const offsetY = typeof style?.connectorLine?.offsetY === 'number' ? style.connectorLine.offsetY : -2;
    return {
      left: Math.round(this.position.left) + CIRCLE_CONNECTOR_OFFSET_X,
      top: Math.round(this.position.top) + CIRCLE_CARD_SIZE + offsetY,
    };
  },
  getIconBox() {
    return false;
  },
  defaultStyle: {
    width: CIRCLE_CARD_SIZE,
    height: CIRCLE_CARD_SIZE,
    connectorLine: {
      offsetX: CIRCLE_CONNECTOR_OFFSET_X,
      offsetY: -3,
      arrow: {
        width: 7,
        height: 18,
      },
    },
  },
  defaultHoverStyle: {
    width: CIRCLE_CARD_SIZE,
    height: CIRCLE_CARD_SIZE,
    connectorLine: {
      offsetX: CIRCLE_CONNECTOR_OFFSET_X,
      offsetY: -3,
      arrow: {
        width: 8,
        height: 20,
      },
    },
  },
  defaultActiveStyle: {
    width: CIRCLE_CARD_SIZE,
    height: CIRCLE_CARD_SIZE,
    connectorLine: {
      offsetX: CIRCLE_CONNECTOR_OFFSET_X,
      offsetY: -3,
      arrow: {
        width: 9,
        height: 22,
      },
    },
  },
  draw(ctx) {
    if (!this.isDataLoaded || isNaN(this.position?.left)) return;

    const size = CIRCLE_CARD_SIZE;
    const radius = CIRCLE_CARD_RADIUS;
    const left = Math.round(this.position.left);
    const top = Math.round(this.position.top);
    const cx = left + radius;
    const cy = top + radius;

    const style = this._getCurrentStyle();
    const isDark = Boolean(window.__chronixDarkTheme);
    const categoryColor = resolveConnectorColor(style.connectorLine?.color) || style.color || (isDark ? '#818cf8' : '#4f46e5');

    // 1. Elevation shadow
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#1e293b' : '#ffffff';
    ctx.fill();
    ctx.restore();

    // 2. Event image clipped to circle
    const img = this.imageLoaded ? this.image : null;
    if (img && img.width > 0 && img.height > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      const side = Math.min(img.width, img.height);
      const focus = (value) => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 50)) / 100;
      const sx = (img.width - side) * focus(this.data?.imagePositionX ?? this.imagePositionX);
      const sy = (img.height - side) * focus(this.data?.imagePositionY ?? this.imagePositionY);
      ctx.drawImage(img, sx, sy, side, side, left, top, size, size);
      ctx.restore();
    } else {
      // Fallback if no image: clean circular category badge with pin/calendar symbol
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = categoryColor;
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Category accent ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = categoryColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // 4. Subtle inner highlight ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
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
  try {
    const existingCircle = typeof Timeline.getCardLayout === 'function' ? Timeline.getCardLayout('circle') : null;
    if (existingCircle) {
      Object.assign(existingCircle, circleCardLayout);
    } else if (typeof Timeline.registerCardLayout === 'function') {
      Timeline.registerCardLayout(circleCardLayout);
    }
  } catch (e) {
    console.warn('Could not register circle card layout:', e);
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
    const isToy = isToyThemeActive();
    const borderRadius = isToy ? 12 : 6;
    const categoryColor = resolveConnectorColor(style.connectorLine?.color) || style.color || (isDark ? '#818cf8' : '#4f46e5');

    if (isToy) {
      // 3D Toy Block Bottom Lip Shadow
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, left, top + (isActive ? 5 : 4.5), width, height, borderRadius);
      ctx.fillStyle = getToyLipColor();
      ctx.fill();
      ctx.restore();

      // Card background fill
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, borderRadius);
      if (isActive) {
        ctx.fillStyle = isDark ? '#283552' : '#fef9c3';
      } else if (this.isMouseover) {
        ctx.fillStyle = isDark ? '#212c45' : '#f0f9ff';
      } else {
        ctx.fillStyle = isDark ? '#1a2338' : '#ffffff';
      }
      ctx.fill();

      // Colorful top accent bar
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, borderRadius);
      ctx.clip();
      ctx.fillStyle = categoryColor;
      ctx.fillRect(left, top, width, 5);
      ctx.restore();

      // Crisp dark toy outline
      ctx.beginPath();
      drawPillPath(ctx, left, top, width, height, borderRadius);
      ctx.strokeStyle = getToyEdgeColor();
      ctx.lineWidth = isActive ? 3 : 2.4;
      ctx.stroke();
    } else if (isComicThemeActive()) {
      drawComicCardFrame(ctx, left, top, width, height, 3, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else if (isJournalThemeActive()) {
      drawJournalCardFrame(ctx, left, top, width, height, 3, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else if (isBentoCardLook()) {
      drawBentoCardFrame(ctx, left, top, width, height, 12, categoryColor, { isActive, isMouseover: this.isMouseover, isDark });
    } else {
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
    }

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

      const thumbRadius = isToy ? 8 : 4;
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, thumbLeft, thumbTop, thumbSize, thumbSize, thumbRadius);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.drawImage(this.image, sx, sy, sWidth, sHeight, thumbLeft, thumbTop, thumbSize, thumbSize);
      ctx.restore();

      if (isToy) {
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, thumbLeft, thumbTop, thumbSize, thumbSize, thumbRadius);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }
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
    const fontFamily = getCanvasFont(isToy);

    const titleFont = `${isToy ? 700 : 600} 11.5px ${fontFamily}`;
    ctx.font = titleFont;
    const titleLines = wrapCompactTitle(titleText, ctx, maxTextWidth);
    const titleLineCount = titleLines.length;
    const titleLineHeight = titleLineCount >= 4 ? 14.5 : 15.5;
    const titleBlockH = titleLineCount * titleLineHeight;

    let subLines = [];
    let subtitleBlockH = 0;
    const subFont = `${isToy ? 600 : 500} 10px ${fontFamily}`;
    if (subtitleText) {
      ctx.font = subFont;
      subLines = wrapCompactTitle(subtitleText, ctx, maxTextWidth).slice(0, 2);
      subtitleBlockH = subLines.length * 13 + 3;
    }

    const totalContentH = titleBlockH + subtitleBlockH;
    const startY = top + Math.max(LANDSCAPE_PADDING_Y, Math.round((height - totalContentH) / 2));

    // Render title lines
    ctx.font = titleFont;
    ctx.fillStyle = isToy
      ? (isDark ? '#ffffff' : '#0f172a')
      : (isActive ? (isDark ? '#ffffff' : '#09090b') : (isDark ? '#f4f4f5' : '#18181b'));
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
      ctx.font = subFont;
      ctx.fillStyle = isToy
        ? (isDark ? '#aab6cc' : '#334155')
        : (isDark ? '#a1a1aa' : '#71717a');
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
    if (!box) return box;

    if (isArticleRtl(this)) {
      const style = this._getCurrentStyle();
      const cornerRadius = style.topRadius || style.borderRadius || 0;
      box.left = Math.round(this.position.left + cornerRadius / 4 + style.star.margin);
    }
    box.centreX = box.left + box.width / 2;
    box.centreY = box.top + box.height / 2;
    box.outerRadius = box.width / 2;
    box.innerRadius = box.outerRadius / 2;
    return box;
  };

  layout.draw = function (ctx) {
    if (!isArticleRtl(this) && !isToyThemeActive()) return originalDraw.call(this, ctx);

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
    // The Focus Lens lays articles out itself at render time.
    if (isLensActive(this)) return;
    if (!Array.isArray(this.articles) || this.articles.length === 0) return;
    if (!this.options?.article?.autoStacking?.active) return;

    if (this._selectedArticleId) {
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

    let selected = null;
    const starred = [];
    const rest = [];
    for (let i = 0; i < this.articles.length; i++) {
      const article = this.articles[i];
      if (article && article.isDataLoaded && article.isInRange && article.isVisibleInGroup && !article.isHiddenByFilter) {
        if (article.isActive) {
          selected = article;
        } else if (article.isStarred) {
          starred.push(article);
        } else {
          rest.push(article);
        }
      }
    }
    starred.sort(compareChronologicalStackOrder);
    rest.sort(compareChronologicalStackOrder);
    const articles = [].concat(selected ? [selected] : [], starred, rest);

    const tryPutInRowsHorizontal = (rowsList, article) => {
      let firstAvailableRow = rowsList.length;
      for (let r = 0; r < rowsList.length; r++) {
        const row = rowsList[r];
        let overlaps = false;
        for (let j = 0; j < row.length; j++) {
          if (article.headerOverlapsWith(row[j])) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          firstAvailableRow = r;
          break;
        }
      }
      if (firstAvailableRow >= rowsList.length) {
        rowsList[firstAvailableRow] = [];
      }
      rowsList[firstAvailableRow].push(article);
      return true;
    };

    if (this._isLaneLayoutActive()) {
      const rowsByLane = new Map();
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const lane = this.getLaneById(article.laneId);
        const laneAutoStacking = this._getLaneAutoStackingOptions(lane);
        const laneKey = String(article.laneId);
        const rowsList = rowsByLane.get(laneKey) || [];
        if (laneAutoStacking.active === false) {
          if (!rowsList[0]) rowsList[0] = [];
          rowsList[0].push(article);
          article.isVisibleInRows = true;
        } else {
          article.isVisibleInRows = tryPutInRowsHorizontal(rowsList, article);
        }
        rowsByLane.set(laneKey, rowsList);
      }
      this.topRow = 0;
      rowsByLane.forEach((rowsList, laneKey) => {
        const lane = this.getLaneById(laneKey);
        const laneAutoStacking = this._getLaneAutoStackingOptions(lane);
        const rowHeight = laneAutoStacking.active === false ? 0 : this._getLaneRowSpacing(lane, rowsList);
        if (lane) lane.topRow = 0;
        const isManualLane = laneAutoStacking.active === false;
        for (let r = 0; r < rowsList.length; r++) {
          for (let i = 0; i < rowsList[r].length; i++) {
            const article = rowsList[r][i];
            if (!isManualLane) {
              article.finalOffset = { left: 0, top: r * -rowHeight };
            }
            article.row = isManualLane ? 0 : r;
            if (lane) lane.topRow = Math.max(lane.topRow, article.row);
            if (article.isInView) this.topRow = Math.max(this.topRow, article.row);
            if (!isManualLane) this.reposition(article, drawCycleContext);
          }
        }
      });
      const currentActiveArticle = this.getActiveArticle();
      this.articles.sort(compareArticleRenderRowOrder);
      if (currentActiveArticle) this.bringFront(currentActiveArticle.id);
      if (this._selectedArticleId) this.bringFront(this._selectedArticleId);
      return;
    }

    const rows = [];
    for (let i = 0; i < articles.length; i++) {
      articles[i].isVisibleInRows = tryPutInRowsHorizontal(rows, articles[i]);
    }
    this.topRow = 0;
    const autoStacking = this.options?.article?.autoStacking;
    let rowHeight = autoStacking?.rowSpacing || 40;
    if (this._chronixTimelinePlan) {
      const visibleRows = Math.max(1, countVisibleStackRows(this, rows));
      const plannedSpacing = getPlannedRowSpacing(this._chronixTimelinePlan, visibleRows);
      if (Number.isFinite(plannedSpacing) && plannedSpacing > 0) {
        rowHeight = plannedSpacing;
        if (autoStacking) autoStacking.rowSpacing = plannedSpacing;
      }
    }
    for (let r = 0; r < rows.length; r++) {
      for (let i = 0; i < rows[r].length; i++) {
        const article = rows[r][i];
        article.finalOffset = { left: 0, top: r * -rowHeight };
        article.row = r;
        if (article.isInView) this.topRow = Math.max(this.topRow, r);
        this.reposition(article, drawCycleContext);
      }
    }
    const currentActiveArticle = this.getActiveArticle();
    this.articles.sort(compareArticleRenderRowOrder);
    if (currentActiveArticle) this.bringFront(currentActiveArticle.id);
    if (this._selectedArticleId) this.bringFront(this._selectedArticleId);
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
    if (!this.redrawInProgress) syncFocusLensState(this);
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
    if (isLensActive(this)) {
      renderFocusLens(this, ctx, top, width, markers, drawCycleContext);
      return;
    }
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

    // Temporarily place hovered/dragged articles after idle articles (and before any active article)
    // so their highlighted connector lines and cards always draw on top of faded idle connectors.
    let savedOrder = null;
    if (Array.isArray(this.articles) && this.articles.some((a) => a && !a.isActive && (a.isMouseover || a.isDragging))) {
      savedOrder = this.articles.slice();
      const idle = [];
      const hovered = [];
      const active = [];
      for (let i = 0; i < this.articles.length; i++) {
        const a = this.articles[i];
        if (a && a.isActive) active.push(a);
        else if (a && (a.isMouseover || a.isDragging)) hovered.push(a);
        else idle.push(a);
      }
      this.articles.length = 0;
      this.articles.push(...idle, ...hovered, ...active);
    }

    try {
      Timeline.prototype._originalChroniXRender.call(this, ctx, top, width, markers, drawCycleContext);
    } finally {
      if (savedOrder) {
        this.articles.length = 0;
        this.articles.push(...savedOrder);
      }
    }

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

  if (!Timeline.prototype._originalChroniXEnqueueImageLoad && typeof Timeline.prototype.enqueueImageLoad === 'function') {
    Timeline.prototype._originalChroniXEnqueueImageLoad = Timeline.prototype.enqueueImageLoad;
    Timeline.prototype.enqueueImageLoad = function (article) {
      if (this._chronixDeferImageEnqueue) return;
      if (isArticleImageFailed(article) && Date.now() < (article._chronixRetryAfter || 0)) {
        return;
      }
      const rawUrl = article?.data?.imageUrl;
      Timeline.prototype._originalChroniXEnqueueImageLoad.call(this, article);
      if (article?.imageLoaded && article?.image && article._chronixFailedImageUrl) {
        article._chronixFailedImageUrl = null;
        article._chronixRetryAfter = 0;
      } else if (rawUrl && article?.isInRange !== false && !(article.imageLoaded && article.image) && !article._pendingImageKey) {
        // Rejected synchronously before queuing (e.g. failed URL sanitization).
        markArticleImageFailed(article, rawUrl);
      }
    };
  }

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
    if (isLensActive(this)) return;
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
    // (with the Focus Lens' raised axis the ruler keeps its own height; the strip sits below it).
    const bandHeight = this._chronixLens?.raised
      ? LENS.rulerHeight
      : Math.max(28, canvasHeight - anchorTop);
    const bandTop = anchorTop;

    ctx.save();

    // Base ruler track background across full width so the timeline bar is unified, solid, and flush
    const isDarkActive = Boolean(this._isDarkTheme ?? window.__chronixDarkTheme);
    const isToy = isToyThemeActive();
    ctx.fillStyle = isToy
      ? (isDarkActive ? 'rgba(19, 27, 46, 0.92)' : 'rgba(254, 249, 195, 0.72)')
      : (isDarkActive ? 'rgba(18, 18, 20, 0.45)' : 'rgba(235, 236, 240, 0.5)');
    ctx.fillRect(0, bandTop, width, bandHeight);
    if (isToy) {
      ctx.save();
      ctx.strokeStyle = getToyEdgeColor();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, bandTop + 1);
      ctx.lineTo(width, bandTop + 1);
      ctx.moveTo(0, bandTop + bandHeight - 1);
      ctx.lineTo(width, bandTop + bandHeight - 1);
      ctx.stroke();
      ctx.restore();
    }

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

    const toyBandBgsLight = ['rgba(254, 240, 138, 0.58)', 'rgba(186, 230, 253, 0.58)', 'rgba(251, 207, 232, 0.58)', 'rgba(187, 247, 208, 0.58)'];
    const toyBandBgsDark = ['rgba(250, 204, 21, 0.12)', 'rgba(56, 189, 248, 0.12)', 'rgba(244, 114, 182, 0.12)', 'rgba(74, 222, 128, 0.12)'];

    // 2. Draw backgrounds and borders for all visible bands
    for (let i = 0; i < preparedBands.length; i++) {
      const { band, left, width: bandW } = preparedBands[i];
      const style = band.style || {};
      ctx.globalAlpha = 1;
      if (isToy) {
        const palette = isDarkActive ? toyBandBgsDark : toyBandBgsLight;
        let bandIndex = Array.isArray(this.timeBands) ? this.timeBands.indexOf(band) : -1;
        if (bandIndex === -1 && Array.isArray(this.timeBands)) {
          bandIndex = this.timeBands.findIndex(b => b === band || (b && band && b.id != null && b.id === band.id));
        }
        if (bandIndex === -1) {
          const key = String(band?.id || band?.title || i);
          let hash = 0;
          for (let c = 0; c < key.length; c++) {
            hash = ((hash << 5) - hash + key.charCodeAt(c)) | 0;
          }
          bandIndex = Math.abs(hash);
        }
        ctx.fillStyle = palette[bandIndex % palette.length];
        ctx.fillRect(left, bandTop + 1, bandW, bandHeight - 2);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = getToyEdgeColor();
        ctx.strokeRect(left + 0.5, bandTop + 1, bandW - 1, bandHeight - 2);
      } else {
        ctx.fillStyle = style.backgroundColor || style.background || 'rgba(200, 200, 200, 0.25)';
        ctx.fillRect(left, bandTop, bandW, bandHeight);
        const border = style.border;
        if (border && border.width) {
          ctx.lineWidth = border.width;
          ctx.strokeStyle = border.color || 'rgba(120, 120, 120, 0.6)';
          ctx.strokeRect(left + 0.5, bandTop + 0.5, bandW - 1, bandHeight - 1);
        }
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

      ctx.font = isToy ? `700 10.5px ${TOY_CANVAS_FONT}` : (textStyle.font || `600 10px ${CANVAS_FONT}`);
      ctx.textAlign = textStyle.align || 'center';
      ctx.textBaseline = textStyle.baseline || 'middle';
      ctx.fillStyle = isToy
        ? (isDarkActive ? '#fde68a' : '#0f172a')
        : (textStyle.color || (isDarkActive ? '#f4f4f5' : '#3f3f46'));

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

// ---------------------------------------------------------------------------------------
// Focus Lens: the narrow-screen (mobile) presentation of the timeline.
//
// Below LENS.maxWidth (or on short touch screens) the auto card mode swaps Histropedia's
// row stacking for a lens: the event nearest the centre becomes one large "focus" card on
// a stage above a raised axis, the other on-screen events become chips / bubbles in a
// strip under the axis, and everything else collapses to dots on the axis. Panning moves
// the lens across the timeline; tapping an event glides it to the centre; tapping the
// focus card opens its details. Fixed density modes (large / small / compact) opt out.
// ---------------------------------------------------------------------------------------
export const LENS = Object.freeze({
  maxWidth: 640,
  shortHeight: 440,
  rulerHeight: 42,
  axisRatio: 0.63,
  // The strip under the axis never needs more than this many rows of (two-line) chips;
  // any extra height goes to the focus card above the axis instead.
  stripRows: 3,
  stripChipHeight: 38,
  stripRowGap: 6,
  stripTopGap: 6,
  stripBottomGap: 8,
  topSafe: 46,
  focusMaxWidth: 360,
  focusFooter: 44,
  focusNavButton: 30,
  focusRowNav: 30,
  focusRowHeight: 76,
  focusRowThumb: 56,
  chipMaxWidth: 150,
  chipThumb: 20,
  bubble: 30,
  dot: 9,
  dotHit: 24,
  starSize: 18,
});

export function shouldUseFocusLens(tl) {
  if (!tl || tl._chronixLensDisabled || !tl._isNarrowViewport) return false;
  if ((tl._chronixCardMode || 'auto') !== 'auto') return false;
  const width = tl.width || tl.options?.width || 0;
  return width > 0;
}

function getLensState(tl) {
  if (!tl._chronixLens) {
    tl._chronixLens = { active: false, raised: false, focusId: null, pendingFocusId: null };
  }
  return tl._chronixLens;
}

// Called at the start of every redraw: toggles the lens with the canvas size / card mode
// and moves the axis up when the stage + strip layout is in use.
function syncFocusLensState(tl) {
  const lens = getLensState(tl);
  const active = shouldUseFocusLens(tl);
  if (active !== lens.active) {
    lens.active = active;
    const articleOptions = tl.options?.article;
    if (active) {
      if (articleOptions) {
        lens.savedDraggable = articleOptions.draggable;
        articleOptions.draggable = false;
      }
      (tl.articles || []).forEach((art) => {
        if (art?.isMoving && art.moveAnimation?.dummyElement?.stop) {
          art.moveAnimation.dummyElement.stop();
          art.isMoving = false;
        }
      });
    } else {
      if (articleOptions && lens.savedDraggable !== undefined) articleOptions.draggable = lens.savedDraggable;
      lens.focusId = null;
      lens.pendingFocusId = null;
      (tl.articles || []).forEach((art) => {
        if (art) {
          art._lens = null;
          art.isVisibleAfterFade = undefined;
        }
      });
      // Restack with the regular cards once this redraw is done.
      setTimeout(() => tl.requestRedraw?.(tl.defaultRedraw), 0);
    }
  }
  lens.raised = active && !isLensLaneMode(tl);
  const height = tl.options?.height;
  if (Number.isFinite(height) && height > 0) {
    tl.top = height - tl._getEffectiveVerticalOffset();
  }
  return lens;
}

function isLensActive(tl) {
  return Boolean(tl?._chronixLens?.active);
}

// Several lanes keep their own bands; a single lane is laid out like a plain timeline.
function isLensLaneMode(tl) {
  if (!tl?._isLaneLayoutActive?.()) return false;
  const lanes = typeof tl._getActiveLanesForLayout === 'function' ? tl._getActiveLanesForLayout() : tl.lanes;
  return Array.isArray(lanes) && lanes.length > 1;
}

function getLensAccentColor(art) {
  let style = null;
  try {
    style = typeof art._getCurrentStyle === 'function' ? art._getCurrentStyle() : null;
  } catch (e) { /* ignore */ }
  return resolveConnectorColor(style?.connectorLine?.color)
    || style?.border?.color
    || resolveConnectorColor(art.data?.style?.connectorLine?.color)
    || (window.__chronixDarkTheme ? '#818cf8' : '#4f46e5');
}

function getLensTitle(art) {
  return String(art.title || art.data?.title || '').trim();
}

// Original (LaTeX-bearing) title / description; the canvas copies are flattened to plain text.
function getLensRichTitle(art) {
  return String(art.data?.richTitle || '').trim();
}

function getLensRichSubtitle(art) {
  return String(art.data?.richSubtitle || '').trim();
}

function getLensDateLabel(art) {
  const data = art.data || {};
  if (!data.from) return '';
  try {
    return formatTimeSpan(data.from, data.to, data.isToPresent, window.__chronixLanguage || 'en');
  } catch (e) {
    return '';
  }
}

// Greedy wrap that may also break after hyphens/dashes/slashes ("Molotov–|Ribbentrop").
function wrapLensWords(ctx, text, maxWidth) {
  const tokens = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[\s\-–—/])/);
  const lines = [];
  let line = '';
  const pushLongToken = (token) => {
    let chunk = '';
    for (const ch of token) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    return chunk;
  };
  tokens.forEach((token) => {
    const candidate = line + token;
    if (!line || ctx.measureText(candidate.trimEnd()).width <= maxWidth) {
      line = candidate;
      if (ctx.measureText(line.trimEnd()).width > maxWidth) line = pushLongToken(line);
      return;
    }
    lines.push(line.trimEnd());
    line = ctx.measureText(token.trimEnd()).width > maxWidth ? pushLongToken(token) : token;
  });
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

// Formula-aware wrap for focus-card text that contains LaTeX (typeset like the map card's KaTeX).
// Returns null when the text has no formula, so callers keep the plain-string lines.
function wrapLensRichText(ctx, rawText, maxWidth, { maxLines = Infinity, fontPx, lineHeight }) {
  const runs = splitMathRuns(rawText);
  if (!runs) return null;
  return layoutRichLines(ctx, buildRichWords(runs), maxWidth, { maxLines, fontPx, lineHeight });
}

// Lens lines are plain strings or rich lines from wrapLensRichText (which may be taller).
function getLensLineHeight(line, lineHeight) {
  return typeof line === 'string' ? lineHeight : line.h;
}

function getLensLinesHeight(lines, lineHeight) {
  return lines.reduce((sum, line) => sum + getLensLineHeight(line, lineHeight), 0);
}

// Draws a lens line in the slot starting at `top` (current font, fill, textAlign and direction).
function drawLensLine(ctx, line, x, top, lineHeight, isRtl) {
  if (typeof line === 'string') {
    ctx.fillText(line, x, top + lineHeight / 2);
    return;
  }
  drawRichLine(ctx, line, x, top + line.padTop + lineHeight / 2, isRtl);
}

function getFontPx(font, fallback) {
  const match = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return match ? Number(match[1]) : fallback;
}

// Word-wraps and clamps to `maxLines`, ending the last line with an ellipsis if cut.
function wrapLensText(ctx, text, maxWidth, maxLines) {
  if (!text) return [];
  const lines = wrapLensWords(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

const LENS_FOCUS_PAD = 12;
// Focus-card title: mirrors the event drawer's <h2> per visual theme (see theme*.css).
function getLensTitleStyle() {
  if (isComicThemeActive()) {
    return { font: "400 21px 'Bangers', 'Suez One', 'Rubik', 'Heebo', system-ui, sans-serif", letterSpacing: '0.7px', shadow: true };
  }
  if (isJournalThemeActive()) {
    return { font: "700 24px 'Caveat', 'Gveret Levin', 'Segoe Print', cursive", letterSpacing: '0px' };
  }
  if (isBentoThemeActive()) {
    return { font: "800 18px 'Inter Tight', 'Heebo', system-ui, sans-serif", letterSpacing: '-0.45px' };
  }
  return { font: "600 18px 'Frank Ruhl Libre', 'Cinzel', Georgia, serif", letterSpacing: '-0.2px' };
}
const LENS_TITLE_FONT = () => getLensTitleStyle().font;
function applyLensTitleStyle(ctx) {
  const style = getLensTitleStyle();
  ctx.font = style.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing;
  return style;
}
const LENS_TITLE_LINE = 21;
const LENS_DATE_FONT = () => `600 12.5px ${getCanvasFont(false)}`;
const LENS_DATE_LINE = 17;
const LENS_EYEBROW_FONT = () => `700 10.5px ${getCanvasFont(false)}`;
const LENS_EYEBROW_LINE = 16;
const LENS_META_FONT = () => `500 12px ${getCanvasFont(false)}`;
const LENS_META_LINE = 16;
const LENS_SUB_FONT = () => `400 13.5px ${getCanvasFont(false)}`;
const LENS_SUB_LINE = 19;
const LENS_COUNTER_FONT = () => `600 12px ${getCanvasFont(false)}`;
const LENS_ROW_TITLE_FONT = () => `700 14px ${getCanvasFont(false)}`;
const LENS_ROW_TITLE_LINE = 17;
const LENS_CHIP_FONT = () => `600 11.5px ${getCanvasFont(false)}`;
const LENS_CHIP_LINE = 13;

// Non-toy card skin active in the lens: 'comic', 'journal' or 'bento' (Classic shares bento).
function getLensSkinName() {
  if (isComicThemeActive()) return 'comic';
  if (isJournalThemeActive()) return 'journal';
  return 'bento';
}

function getLensSkinFill(skin, isDark) {
  if (skin === 'comic') return isDark ? '#222227' : '#ffffff';
  if (skin === 'journal') return isDark ? JOURNAL_FILLS.dark.normal : JOURNAL_FILLS.light.normal;
  return isDark ? '#15151d' : '#ffffff';
}

// Text and divider colors of the non-toy lens cards, matching the active card skin.
function getLensSkinPalette(isDark) {
  if (isComicThemeActive()) {
    return {
      title: isDark ? '#ffffff' : COMIC_INK,
      body: isDark ? '#e4e4e7' : '#27272a',
      muted: isDark ? '#c4c4cc' : '#3f3f46',
      divider: isDark ? COMIC_NIGHT_EDGE : COMIC_INK,
      dividerWidth: 2,
    };
  }
  if (isJournalThemeActive()) {
    return {
      title: isDark ? '#f3ead8' : '#2b2a33',
      body: isDark ? '#e2d6bf' : '#3d3528',
      muted: isDark ? '#c9b99a' : '#6b5a43',
      divider: isDark ? 'rgba(232, 220, 196, 0.22)' : 'rgba(139, 115, 85, 0.45)',
      dividerWidth: 1,
    };
  }
  return {
    title: isDark ? '#f5f5fa' : '#111118',
    body: isDark ? '#d4d4d8' : '#3f3f46',
    muted: isDark ? '#8e8ea3' : '#6e6e80',
    divider: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 17, 24, 0.07)',
    dividerWidth: 1,
  };
}

function pickLocalizedLabel(value) {
  if (value && typeof value === 'object') {
    const lang = window.__chronixLanguage || 'en';
    return String(value[lang] || value.en || Object.values(value)[0] || '').trim();
  }
  return String(value || '').trim();
}

function getLensCategoryLabel(art) {
  return pickLocalizedLabel(art.data?.category ?? art.category).toLocaleUpperCase(window.__chronixLanguage || 'en');
}

function getLensLocationLabel(art) {
  return pickLocalizedLabel(art.data?.locationName ?? art.locationName);
}

const LENS_FOCUS_IMAGE_MAX = 220;
// Room kept for padding, eyebrow, two title lines, date, ~6 description lines and footer:
// the photo only grows past its minimum once the description has this much space.
const LENS_FOCUS_TEXT_RESERVE = 280;

// The photo is always shown whole, and the card adapts to its aspect ratio (width / height):
//  - wide photos (>= LENS_BANNER_MIN_RATIO) become a full-width banner as tall as the photo;
//  - everything else (landscape, square, portrait) becomes a thumbnail beside the header text,
//    so a tall photo costs no extra vertical space and the description keeps its room.
// While the ratio is still unknown (photo not loaded yet) the old cropped 2:1 frame is used.
const LENS_BANNER_MIN_RATIO = 1.8;
const LENS_BANNER_MIN_HEIGHT = 64;
const LENS_THUMB_MAX_HEIGHT = 150;
const LENS_THUMB_MIN_HEIGHT = 96;
const LENS_THUMB_MAX_WIDTH_FRACTION = 0.38;
const LENS_THUMB_GAP = 12;

function getLensImageRatio(art) {
  const entry = getLensPhoto(art, { load: false });
  const img = entry?.img || (art.imageLoaded ? art.image : null);
  const w = img?.naturalWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.height || 0;
  return w > 0 && h > 0 ? Math.round((w / h) * 100) / 100 : 0;
}

// Fills the vertical budget of the stage: the photo (banner or side thumbnail), title +
// date + footer, then as many description lines as fit.
function layoutLensFocusCard(ctx, art, width, budget) {
  const isToy = isToyThemeActive();
  const title = getLensTitle(art);
  const subtitle = String(art.subtitle || art.data?.subtitle || '').trim();
  const hasImage = hasArticleImageSource(art) && !isLensPhotoMissing(art);
  const textWidth = width - LENS_FOCUS_PAD * 2;
  const limit = Number.isFinite(budget) && budget > 0 ? budget : 10000;
  const baseHeight = LENS_FOCUS_PAD * 2 + LENS.focusFooter;

  const ratio = hasImage ? getLensImageRatio(art) : 0;
  const bannerCap = Math.max(LENS_BANNER_MIN_HEIGHT, Math.min(LENS_FOCUS_IMAGE_MAX, Math.round(limit - LENS_FOCUS_TEXT_RESERVE)));
  const bannerNatural = ratio ? Math.round(width / ratio) : 0;
  let imageMode = 'none';
  if (hasImage) {
    if (!ratio) imageMode = 'cover';
    else if (ratio >= LENS_BANNER_MIN_RATIO && bannerNatural <= Math.max(bannerCap, Math.round(width * 0.36))) imageMode = 'banner';
    else imageMode = 'side';
  }
  const isSide = imageMode === 'side';

  const sizeThumb = (targetHeight) => {
    const maxH = Math.max(60, Math.min(targetHeight, limit - baseHeight - 80));
    const w = Math.round(Math.min(width * LENS_THUMB_MAX_WIDTH_FRACTION, maxH * ratio));
    return { w, h: Math.round(w / ratio) };
  };
  let thumb = isSide ? sizeThumb(LENS_THUMB_MAX_HEIGHT) : null;
  let columnWidth = isSide ? textWidth - thumb.w - LENS_THUMB_GAP : textWidth;

  const wrapHeader = (colWidth) => {
    if (isToy) ctx.font = `700 15.5px ${TOY_CANVAS_FONT}`; else applyLensTitleStyle(ctx);
    const titleMaxWidth = colWidth - LENS.starSize - 8;
    const titleMaxLines = isSide ? 4 : 3;
    const headerLines = wrapLensRichText(ctx, getLensRichTitle(art), titleMaxWidth, {
      maxLines: titleMaxLines,
      fontPx: getFontPx(ctx.font, 18),
      lineHeight: LENS_TITLE_LINE,
    }) || wrapLensText(ctx, title, titleMaxWidth, titleMaxLines);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = isToy ? `700 11.5px ${TOY_CANVAS_FONT}` : LENS_DATE_FONT();
    const headerDate = wrapLensText(ctx, getLensDateLabel(art), colWidth, 1)[0] || '';
    ctx.font = isToy ? `700 10.5px ${TOY_CANVAS_FONT}` : LENS_EYEBROW_FONT();
    const headerEyebrow = wrapLensText(ctx, getLensCategoryLabel(art), colWidth - LENS.starSize - 8, 1)[0] || '';
    ctx.font = isToy ? `600 11.5px ${TOY_CANVAS_FONT}` : LENS_META_FONT();
    const headerLocation = wrapLensText(ctx, getLensLocationLabel(art), colWidth - 14, 1)[0] || '';
    return { lines: headerLines, date: headerDate, eyebrow: headerEyebrow, location: headerLocation };
  };
  let { lines, date, eyebrow, location } = wrapHeader(columnWidth);

  const textBlockHeight = () => (eyebrow ? LENS_EYEBROW_LINE : 0)
    + getLensLinesHeight(lines, LENS_TITLE_LINE)
    + (date ? 4 + LENS_DATE_LINE : 0)
    + (location ? 2 + LENS_META_LINE : 0);
  if (isSide) {
    // Short header text: shrink the thumbnail to the text block and give the text the freed width.
    const target = Math.min(LENS_THUMB_MAX_HEIGHT, Math.max(LENS_THUMB_MIN_HEIGHT, textBlockHeight()));
    if (target < thumb.h) {
      thumb = sizeThumb(target);
      columnWidth = textWidth - thumb.w - LENS_THUMB_GAP;
      ({ lines, date, eyebrow, location } = wrapHeader(columnWidth));
    }
  }

  ctx.font = isToy ? `500 12.5px ${TOY_CANVAS_FONT}` : LENS_SUB_FONT();
  const allSub = subtitle
    ? (wrapLensRichText(ctx, getLensRichSubtitle(art), textWidth, {
      fontPx: getFontPx(ctx.font, 13.5),
      lineHeight: LENS_SUB_LINE,
    }) || wrapLensWords(ctx, subtitle, textWidth))
    : [];

  const descHeight = (n) => (n > 0 ? 8 + getLensLinesHeight(allSub.slice(0, n), LENS_SUB_LINE) : 0);
  const fixedHeight = () => LENS_FOCUS_PAD
    + (isSide ? Math.max(thumb.h, textBlockHeight()) : textBlockHeight())
    + LENS_FOCUS_PAD
    + LENS.focusFooter;
  // Dropping a header line only helps when the text, not the thumbnail, sets the header height.
  const headerCanShrink = () => !isSide || textBlockHeight() > thumb.h;
  const imageHeight = imageMode === 'cover'
    ? Math.max(
      Math.round(width * 0.36),
      Math.min(LENS_FOCUS_IMAGE_MAX, Math.round(width * 0.5), Math.round(limit - LENS_FOCUS_TEXT_RESERVE)),
    )
    : imageMode === 'banner' ? Math.max(LENS_BANNER_MIN_HEIGHT, bannerNatural) : 0;
  // Show the whole description when it fits; otherwise the card shows as many lines as fit
  // and the description becomes scrollable (see drawLensFocusCard).
  const maxSub = allSub.length;

  let room = limit - fixedHeight() - imageHeight;
  // Short stage: give up the optional meta lines before the description.
  if (room < descHeight(Math.min(maxSub, 3)) && location && headerCanShrink()) { location = ''; room = limit - fixedHeight() - imageHeight; }
  if (room < descHeight(Math.min(maxSub, 3)) && eyebrow && headerCanShrink()) { eyebrow = ''; room = limit - fixedHeight() - imageHeight; }

  const fitLines = (space, cap) => {
    let n = Math.min(cap, maxSub);
    while (n > 0 && descHeight(n) > space) n -= 1;
    return n;
  };
  const subCount = fitLines(room, maxSub);

  ctx.font = isToy ? `500 12.5px ${TOY_CANVAS_FONT}` : LENS_SUB_FONT();
  const subOverflow = subCount > 0 && allSub.length > subCount;
  const sub = subCount > 0 ? allSub.slice(0, subCount) : [];
  const height = imageHeight + fixedHeight() + descHeight(sub.length);
  return { width, height, lines, date, eyebrow, location, sub, subAll: allSub, subOverflow, imageHeight, imageMode, thumb, columnWidth, textWidth };
}

// Text layout for one article at one tier. Cached per article, tier, canvas width and budget.
function measureLensArticle(art, tier, canvasWidth, budget = 0) {
  const isToy = isToyThemeActive();
  const title = getLensTitle(art);
  const subtitle = String(art.subtitle || art.data?.subtitle || '').trim();
  const hasImage = hasArticleImageSource(art) && !isLensPhotoMissing(art);
  const budgetKey = tier === 'focus' ? Math.round(budget) : '';
  const ratioKey = tier === 'focus' && hasImage ? getLensImageRatio(art) : '';
  const key = `${tier}|${canvasWidth}|${budgetKey}|${ratioKey}|${title}|${subtitle}|${hasImage}|${window.__chronixLanguage || ''}|${getCanvasFont(isToy)}|${getCanvasMathVersion()}`;
  if (art._lensMeasure?.[tier]?.key === key) return art._lensMeasure[tier].value;

  const ctx = getMeasureCtx();
  let value;
  if (tier === 'dot') {
    value = { width: LENS.dot, height: LENS.dot };
  } else if (tier === 'bubble') {
    value = { width: LENS.bubble, height: LENS.bubble };
  } else if (tier === 'chip') {
    const thumb = hasImage ? LENS.chipThumb + 6 : 0;
    ctx.font = isToy ? `700 12px ${TOY_CANVAS_FONT}` : LENS_CHIP_FONT();
    const maxText = LENS.chipMaxWidth - 16 - thumb;
    const lines = wrapLensText(ctx, title, maxText, 2);
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 10);
    const width = Math.ceil(Math.min(LENS.chipMaxWidth, textWidth + 16 + thumb));
    const height = lines.length > 1 ? LENS.stripChipHeight : 26;
    value = { width, height, lines, thumb };
  } else if (tier === 'focusRow') {
    const width = Math.min(canvasWidth - 24, LENS.focusMaxWidth);
    const thumb = hasImage ? LENS.focusRowThumb + 10 : 0;
    // Prev / next zones sit at both ends of the row.
    const textWidth = width - LENS.focusRowNav * 2 - thumb - LENS.starSize - 6;
    ctx.font = isToy ? `700 13.5px ${TOY_CANVAS_FONT}` : LENS_ROW_TITLE_FONT();
    const lines = wrapLensText(ctx, title, textWidth, 2);
    ctx.font = isToy ? `700 11px ${TOY_CANVAS_FONT}` : LENS_DATE_FONT();
    const date = wrapLensText(ctx, getLensDateLabel(art), textWidth, 1)[0] || '';
    value = { width, height: LENS.focusRowHeight, lines, date, thumb, textWidth };
  } else {
    value = layoutLensFocusCard(ctx, art, Math.min(canvasWidth - 24, LENS.focusMaxWidth), budget);
  }
  art._lensMeasure = { ...(art._lensMeasure || {}), [tier]: { key, value } };
  return value;
}

// Positions every visible article for this frame and stores the result on `art._lens`.
function layoutFocusLens(tl, drawCycleContext, width) {
  const lens = getLensState(tl);
  const height = tl.options?.height || 0;
  const isLane = isLensLaneMode(tl);
  const centerX = width / 2;
  const groups = new Map();
  const all = [];
  (tl.articles || []).forEach((art) => {
    art._lens = null;
    if (!art?.isDataLoaded || !art.isVisible || !art.period?.from) return;
    const x = Math.round(tl.getPixel(art.period.from, drawCycleContext));
    if (!Number.isFinite(x)) return;
    const item = {
      id: String(art.id),
      x,
      priority: (art.rank || art.data?.rank || 5) + (art.isStarred ? 3 : 0),
      lane: isLane ? String(art.laneId ?? '') : '',
      art,
    };
    all.push(item);
    const key = isLane ? String(art.laneId ?? '') : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const pending = lens.pendingFocusId != null ? String(lens.pendingFocusId) : null;
  const forcedItem = pending ? all.find((item) => item.id === pending) : null;
  const focusItem = forcedItem || pickFocus(all, {
    width,
    centerX,
    previousFocusId: lens.focusId != null ? String(lens.focusId) : null,
  });

  let placedFocusId = null;
  groups.forEach((items, key) => {
    let axisY = tl.top;
    let sides;
    let clip = null;
    if (isLane) {
      const lane = tl.getLaneById?.(items[0].art.laneId);
      const g = lane?.geometry;
      if (!g) return;
      axisY = g.bodyContentBottom - 8;
      clip = { top: g.top, bottom: g.bottom };
      sides = { above: { minOffset: 12, maxExtent: Math.max(0, axisY - g.bodyContentTop - 6) }, below: null };
    } else {
      sides = {
        above: { minOffset: 16, maxExtent: Math.max(0, axisY - LENS.topSafe) },
        below: { minOffset: LENS.rulerHeight + LENS.stripTopGap, maxExtent: Math.max(0, height - axisY - LENS.stripBottomGap) },
      };
    }
    // The focus card grows to fill the stage above the axis.
    const focusBudget = sides.above.maxExtent - sides.above.minOffset;
    const measure = (item, tier) => measureLensArticle(item.art, tier, width, focusBudget);
    const groupHasFocus = focusItem && items.includes(focusItem);
    const plan = planFocusLens({
      items,
      width,
      centerX,
      sides,
      forcedFocusId: groupHasFocus ? focusItem.id : null,
      measure,
      assignSide: () => 'below',
      // Only the lens-wide focus may become a focus card.
      options: groupHasFocus ? {} : { focusRadiusRatio: -1 },
    });
    if (plan.focusId != null) placedFocusId = plan.focusId;
    items.forEach((item) => {
      const p = plan.placements.get(item.id);
      if (!p) return;
      const art = item.art;
      const top = Math.round(axisY + p.top);
      const left = Math.round(p.left);
      art._lens = {
        tier: p.tier,
        side: p.side,
        left,
        top,
        width: p.width,
        height: p.height,
        axisY,
        x: item.x,
        clip,
        layout: measure(item, p.tier),
        starBox: null,
      };
      art.position = { left, top };
    });
  });
  lens.focusId = placedFocusId ?? (focusItem ? focusItem.id : null);
  if (lens.positioningId != null && lens.positioningId !== String(lens.focusId)) lens.positioningId = null;
  lens.focusLane = focusItem ? focusItem.lane : null;
  lens.items = all;
  if (lens.focusId != null) {
    const seq = getLensSequence(tl);
    const index = seq.findIndex((item) => item.id === String(lens.focusId));
    lens.position = index >= 0 ? { index, total: seq.length } : null;
  } else {
    lens.position = null;
  }
  return all;
}

function getLensStarBox(art) {
  const l = art._lens;
  if (!l || (l.tier !== 'focus' && l.tier !== 'focusRow')) return null;
  if (art.owner?.options?.article?.star?.visible === false) return null;
  const size = LENS.starSize;
  const isRtl = isArticleRtl(art);
  const inset = l.tier === 'focus' ? LENS_FOCUS_PAD : LENS.focusRowNav;
  const top = l.tier === 'focus'
    ? l.top + (l.layout.imageHeight || 0) + LENS_FOCUS_PAD + (l.layout.eyebrow ? LENS_EYEBROW_LINE : 0) + (LENS_TITLE_LINE - size) / 2
    : l.top + LENS_FOCUS_PAD;
  const left = isRtl ? l.left + inset - 2 : l.left + l.width - inset - size + 2;
  return {
    left,
    top,
    width: size,
    height: size,
    centreX: left + size / 2,
    centreY: top + size / 2,
    outerRadius: size / 2,
    innerRadius: size / 4,
  };
}

// Tap zones for the prev / next controls built into the focus card. Time runs left to
// right on the axis in every language, so "previous" is always on the left.
function getLensNavBoxes(art) {
  const l = art._lens;
  if (!l || (l.tier !== 'focus' && l.tier !== 'focusRow')) return null;
  if (l.tier === 'focus') {
    const top = l.top + l.height - LENS.focusFooter;
    const zone = Math.round(l.width * 0.34);
    return {
      prev: { left: l.left, top, width: zone, height: LENS.focusFooter },
      next: { left: l.left + l.width - zone, top, width: zone, height: LENS.focusFooter },
    };
  }
  return {
    prev: { left: l.left, top: l.top, width: LENS.focusRowNav, height: l.height },
    next: { left: l.left + l.width - LENS.focusRowNav, top: l.top, width: LENS.focusRowNav, height: l.height },
  };
}

function getLensNavHit(art, pos) {
  const boxes = getLensNavBoxes(art);
  if (!boxes || !pos) return null;
  const inside = (b) => pos.left >= b.left && pos.left <= b.left + b.width && pos.top >= b.top && pos.top <= b.top + b.height;
  if (inside(boxes.prev)) return 'prev';
  if (inside(boxes.next)) return 'next';
  return null;
}

function drawLensChevron(ctx, cx, cy, dir, size, color, lineWidth = 2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + (size / 3) * dir * -1, cy - size / 2);
  ctx.lineTo(cx + (size / 3) * dir, cy);
  ctx.lineTo(cx + (size / 3) * dir * -1, cy + size / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawLensNavButton(ctx, cx, cy, dir, enabled, hovered, isDark, accent, withDisc) {
  const isToy = isToyThemeActive();
  const r = LENS.focusNavButton / 2;
  if (isToy) {
    const discR = withDisc ? r : r - 2;
    ctx.save();
    if (enabled) {
      ctx.beginPath();
      ctx.arc(cx, cy + (withDisc ? 2.2 : 1.6), discR, 0, Math.PI * 2);
      ctx.fillStyle = getToyLipColor();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fillStyle = enabled
      ? (hovered ? '#fde047' : '#facc15')
      : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)');
    ctx.fill();
    ctx.strokeStyle = enabled ? '#0f172a' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)');
    ctx.lineWidth = withDisc ? 2 : 1.75;
    ctx.stroke();
    ctx.restore();
    const chevronColor = enabled
      ? '#0f172a'
      : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(15,23,42,0.28)');
    drawLensChevron(ctx, cx, cy, dir, withDisc ? 11 : 9.5, chevronColor, 2.3);
    return;
  }
  if (withDisc) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hovered && enabled
      ? hexToRgba(accent, isDark ? 0.32 : 0.18)
      : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.05)');
    ctx.fill();
    ctx.strokeStyle = enabled ? hexToRgba(accent, 0.55) : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  const color = enabled
    ? (isDark ? '#f4f4f5' : '#18181b')
    : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.2)');
  drawLensChevron(ctx, cx, cy, dir, 11, color);
}

// The focus card needs the original-aspect photo: to size its frame from the photo's
// shape, and to crop the loading-state frame around its saved focal point. Histropedia
// hands cards a square-cropped bitmap, so the original is loaded separately. Small LRU cache.
const LENS_PHOTO_CACHE_LIMIT = 40;
const lensPhotoStore = new Map();

function loadLensPhotoSource(entry, urlOrCandidates, quality, attemptIdx = 0) {
  const candidates = Array.isArray(urlOrCandidates)
    ? urlOrCandidates.filter(Boolean)
    : (urlOrCandidates ? [urlOrCandidates] : []);
  const currentUrl = candidates[attemptIdx];
  if (!currentUrl) return;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0) || quality < entry.quality) return;
    entry.img = img;
    entry.loadedUrl = currentUrl;
    entry.quality = quality;
    entry.failed = false;
    entry.owner?.requestRedraw?.(entry.owner.redraw);
  };
  // A broken base photo tries fallback resolutions (warm 1280px / original) before dropping
  // the focus card's image area (see isLensPhotoMissing); a failed hi-res upgrade keeps base.
  img.onerror = () => {
    if (entry.img && quality <= entry.quality) return;
    if (attemptIdx + 1 < candidates.length) {
      setTimeout(() => {
        if (!entry.img || quality > entry.quality) {
          loadLensPhotoSource(entry, candidates, quality, attemptIdx + 1);
        }
      }, IMAGE_RETRY_BASE_DELAY_MS);
      return;
    }
    if (quality !== 0 || entry.img) return;
    entry.failed = true;
    entry.owner?.requestRedraw?.(entry.owner.redraw);
  };
  img.src = currentUrl;
}

function isLensPhotoMissing(art) {
  const entry = getLensPhoto(art, { load: false });
  return Boolean(entry?.failed && !entry.img && !(art.imageLoaded && art.image));
}

// Starts frame decoding once for animated GIFs; until it finishes (or if it fails, e.g.
// no CORS) the static first frame from the <img> is shown.
function ensureLensGifFrames(entry) {
  if (entry.gifState) return;
  entry.gifState = 'loading';
  decodeAnimatedGif(entry.url)
    .then((gif) => {
      entry.gif = gif.duration > 0 ? gif : null;
      entry.gifStart = performance.now();
      entry.gifState = 'ready';
      entry.owner?.requestRedraw?.(entry.owner.redraw);
    })
    .catch(() => {
      entry.gifState = 'failed';
    });
}

// `neededWidth` (device px) upgrades to the sharper drawer-size image when the base
// canvas thumbnail would be upscaled. `load: false` only peeks at what is cached.
function getLensPhoto(art, { load = true, neededWidth = 0 } = {}) {
  const url = art?.data?.imageUrl;
  if (!url) return null;
  const rawUrl = art?.data?.rawImageUrl || art?.rawImageUrl || url;
  let entry = lensPhotoStore.get(url);
  if (entry) {
    lensPhotoStore.delete(url);
    lensPhotoStore.set(url, entry);
  } else {
    if (!load) return null;
    const baseCandidates = [url];
    for (const candidate of getCanvasImageCandidates(rawUrl)) {
      if (candidate && !baseCandidates.includes(candidate)) {
        baseCandidates.push(candidate);
      }
    }
    if (baseCandidates.length === 1 && /^https?:\/\//i.test(baseCandidates[0])) {
      baseCandidates.push(baseCandidates[0]);
    }
    entry = {
      url,
      rawUrl,
      loadedUrl: null,
      img: null,
      quality: -1,
      hiResRequested: false,
      owner: art.owner || null,
      isGif: isGifSource(url, art.data?.mediaType),
      gif: null,
      gifState: null,
      gifStart: 0,
    };
    lensPhotoStore.set(url, entry);
    while (lensPhotoStore.size > LENS_PHOTO_CACHE_LIMIT) {
      lensPhotoStore.delete(lensPhotoStore.keys().next().value);
    }
    loadLensPhotoSource(entry, baseCandidates, 0);
  }
  if (art.owner) entry.owner = art.owner;
  if (load && entry.isGif) ensureLensGifFrames(entry);
  if (load && !entry.isGif && entry.img && !entry.hiResRequested && neededWidth > entry.img.naturalWidth * 1.1) {
    entry.hiResRequested = true;
    const hiResCandidates = getDrawerImageCandidates(entry.rawUrl || rawUrl).filter(
      (candidate) => candidate && candidate !== entry.loadedUrl && candidate !== url
    );
    if (hiResCandidates.length > 0) {
      loadLensPhotoSource(entry, hiResCandidates, 1);
    } else {
      const hiResUrl = getDrawerImageUrl(entry.rawUrl || rawUrl);
      if (hiResUrl && hiResUrl !== entry.loadedUrl && hiResUrl !== url) {
        loadLensPhotoSource(entry, [hiResUrl], 1);
      }
    }
  }
  return entry;
}

// Current frame of a decoded GIF; also schedules the redraw that shows the next one.
// Scheduling only happens while the GIF is actually being drawn, so playback stops by
// itself once the event leaves the focus card.
function getLensGifFrame(entry) {
  const tl = entry?.owner;
  if (!entry?.gif) return null;
  const current = getGifFrameAt(entry.gif, performance.now() - entry.gifStart);
  if (!current) return null;
  if (tl && Number.isFinite(current.nextIn) && !tl._chronixGifTimer) {
    tl._chronixGifTimer = setTimeout(() => {
      tl._chronixGifTimer = null;
      if (tl.canvas?.isConnected) tl.requestRedraw?.(tl.redraw);
    }, current.nextIn);
  }
  return current.frame.canvas;
}

function drawLensPhoto(ctx, art, x, y, w, h) {
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  getLensPhoto(art, { neededWidth: w * dpr });
  return drawLensCoverImage(ctx, art, x, y, w, h);
}

// Draws the whole photo scaled to fit the box. Any leftover space shows a dimmed cover
// version of the same photo instead of bare bars.
function drawLensContainImage(ctx, art, x, y, w, h, radius = 0) {
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  getLensPhoto(art, { neededWidth: w * dpr });
  const entry = getLensPhoto(art, { load: false });
  const img = getLensGifFrame(entry) || entry?.img || (art.imageLoaded ? art.image : null);
  if (!img || !(img.width > 0) || !(img.height > 0)) return false;
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, x, y, w, h, radius);
  ctx.clip();
  if (dw < w - 1 || dh < h - 1) {
    drawLensCoverImage(ctx, art, x, y, w, h);
    ctx.fillStyle = window.__chronixDarkTheme ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
  }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}

// Focus-card photo positioning (drag to move the saved focal point of a cropped photo).
const LENS_MOVE_BUTTON = 32;
const LENS_MOVE_INSET = 10;

function getLensImageRect(art) {
  const l = art?._lens;
  // Only the cropped fallback frame has a focal point to adjust; banners and thumbnails show the whole photo.
  if (!l || l.tier !== 'focus' || l.layout?.imageMode !== 'cover' || !l.layout?.imageHeight) return null;
  return { x: l.left, y: l.top, w: l.width, h: l.layout.imageHeight };
}

function getLensMoveButtonBox(art, positioning) {
  const rect = getLensImageRect(art);
  if (!rect) return null;
  const labels = art.owner?._chronixImageLabels || {};
  const ctx = getMeasureCtx();
  let width = LENS_MOVE_BUTTON;
  if (positioning && ctx) {
    ctx.font = LENS_CONFIRM_FONT;
    width = Math.ceil(ctx.measureText(labels.done || 'Done').width) + 12 * 2 + LENS_ICON_SIZE + 6 + 2;
  }
  const isRtl = isArticleRtl(art);
  const left = isRtl ? rect.x + rect.w - LENS_MOVE_INSET - width : rect.x + LENS_MOVE_INSET;
  return { x: left, y: rect.y + LENS_MOVE_INSET, w: width, h: LENS_MOVE_BUTTON };
}

// Exact lucide-react `Move` / `Check` paths (24-unit viewBox), as used by the event drawer.
const LUCIDE_MOVE_PATHS = ['M12 2v20', 'm15 19-3 3-3-3', 'm19 9 3 3-3 3', 'M2 12h20', 'm5 9-3 3 3 3', 'm9 5 3-3 3 3'];
const LUCIDE_CHECK_PATHS = ['M20 6 9 17l-5-5'];
let lucidePath2dCache = null;

function drawLucideIcon(ctx, paths, x, y, size, color) {
  if (typeof Path2D !== 'function') return;
  if (!lucidePath2dCache) lucidePath2dCache = new Map();
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  paths.forEach((d) => {
    let path = lucidePath2dCache.get(d);
    if (!path) {
      path = new Path2D(d);
      lucidePath2dCache.set(d, path);
    }
    ctx.stroke(path);
  });
  ctx.restore();
}

// Matches the drawer button: 14px icon, px-3, gap-1.5, 1px border, text-xs font-medium.
const LENS_CONFIRM_FONT = `500 12px ${CANVAS_FONT}`;
const LENS_ICON_SIZE = 14;

function getUiAccentColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value ? `rgb(${value.split(/\s+/).join(',')})` : fallback;
  };
  return { bg: read('--accent', '#1c1c1f'), fg: read('--accent-fg', '#ffffff') };
}

function drawLensPhotoControls(ctx, art) {
  const tl = art.owner;
  if (!tl?._chronixCanEditImage) return;
  const rect = getLensImageRect(art);
  if (!rect) return;
  const positioning = tl._chronixLens?.positioningId === String(art.id);
  const labels = tl._chronixImageLabels || {};
  const box = getLensMoveButtonBox(art, positioning);
  const ui = positioning ? getUiAccentColors() : null;
  ctx.save();
  if (positioning) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const hint = labels.drag || 'Drag the image to position it';
    ctx.font = `600 12px ${CANVAS_FONT}`;
    const hintWidth = Math.min(rect.w - 24, ctx.measureText(hint).width + 24);
    const hintX = rect.x + (rect.w - hintWidth) / 2;
    const hintY = rect.y + rect.h - 12 - 28;
    ctx.beginPath();
    drawPillPath(ctx, hintX, hintY, hintWidth, 28, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hint, rect.x + rect.w / 2, hintY + 14.5, hintWidth - 16);
  }
  ctx.beginPath();
  drawPillPath(ctx, box.x, box.y, box.w, box.h, box.h / 2);
  if (!positioning) ctx.globalAlpha = 0.9;
  ctx.fillStyle = positioning ? ui.bg : 'rgba(0,0,0,0.65)';
  ctx.fill();
  ctx.strokeStyle = positioning ? ui.bg : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const iconY = box.y + (box.h - LENS_ICON_SIZE) / 2;
  if (positioning) {
    const label = labels.done || 'Done';
    const rtl = isArticleRtl(art);
    const iconX = rtl ? box.x + box.w - 1 - 12 - LENS_ICON_SIZE : box.x + 1 + 12;
    drawLucideIcon(ctx, LUCIDE_CHECK_PATHS, iconX, iconY, LENS_ICON_SIZE, ui.fg);
    ctx.font = LENS_CONFIRM_FONT;
    ctx.fillStyle = ui.fg;
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rtl ? iconX - 6 : iconX + LENS_ICON_SIZE + 6, box.y + box.h / 2 + 0.5);
  } else {
    drawLucideIcon(ctx, LUCIDE_MOVE_PATHS, box.x + (box.w - LENS_ICON_SIZE) / 2, iconY, LENS_ICON_SIZE, '#ffffff');
  }
  ctx.restore();
}

function drawLensCoverImage(ctx, art, x, y, w, h) {
  // Prefer the original-aspect photo when cached: the focal point is relative to it.
  const entry = getLensPhoto(art, { load: false });
  const natural = getLensGifFrame(entry) || entry?.img;
  const img = natural || (art.imageLoaded ? art.image : null);
  if (!img || !(img.width > 0) || !(img.height > 0)) return false;
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const focal = (value) => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 50)) / 100;
  const sx = (img.width - sw) * focal(art.data?.imagePositionX);
  const sy = (img.height - sh) * focal(art.data?.imagePositionY);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  return true;
}

function drawLensImageTile(ctx, art, x, y, w, h, radius, accent) {
  const isToy = isToyThemeActive();
  ctx.save();
  ctx.beginPath();
  drawPillPath(ctx, x, y, w, h, radius);
  ctx.clip();
  if (!drawLensCoverImage(ctx, art, x, y, w, h)) {
    ctx.fillStyle = hexToRgba(accent, isToy ? 0.28 : 0.16);
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  if (isToy) {
    ctx.save();
    ctx.beginPath();
    drawPillPath(ctx, x, y, w, h, radius);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.75;
    ctx.stroke();
    ctx.restore();
  }
}

function drawLensPin(ctx, cx, cy, color) {
  const isToy = isToyThemeActive();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy - 2, isToy ? 4.2 : 3.6, Math.PI * 0.8, Math.PI * 2.2);
  ctx.lineTo(cx, cy + (isToy ? 5.6 : 5));
  ctx.closePath();
  ctx.fillStyle = isToy ? '#fb7185' : color;
  ctx.fill();
  if (isToy) {
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy - 2, isToy ? 1.6 : 1.4, 0, Math.PI * 2);
  ctx.fillStyle = isToy ? '#fef3c7' : (window.__chronixDarkTheme ? '#1c1c20' : '#ffffff');
  ctx.fill();
  ctx.restore();
}

function drawLensFocusCard(ctx, art, isSelected) {
  const l = art._lens;
  const m = l.layout;
  const isDark = Boolean(window.__chronixDarkTheme);
  const isToy = isToyThemeActive();
  const accent = getLensAccentColor(art);
  const isRtl = isArticleRtl(art);
  const themeFrame = isToy ? null : getActiveThemeCardFrame();
  const frameOpts = { isActive: Boolean(isSelected), isMouseover: Boolean(art.isMouseover), isDark };
  if (l.tier === 'focus' && m.imageHeight) frameOpts.glowTop = l.top + m.imageHeight;
  // Comic: the big focus card is always the yellow caption panel, selected or not.
  if (l.tier === 'focus' && isComicThemeActive()) frameOpts.yellowFill = true;
  const skin = isToy ? null : getLensSkinPalette(isDark);
  const radius = isToy ? 16 : (themeFrame ? themeFrame.radius : 12);
  const position = art.owner?._chronixLens?.position || null;
  const hasPrev = Boolean(position && position.index > 0);
  const hasNext = Boolean(position && position.index < position.total - 1);
  const navHover = art.isMouseover ? art._lensNavHover : null;
  const muted = isToy
    ? (isDark ? '#aab6cc' : '#334155')
    : skin.muted;

  ctx.save();
  if (isToy) {
    // 3D Toy Block extruded bottom lip
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top + (isSelected ? 7 : 5.5), l.width, l.height, radius);
    ctx.fillStyle = getToyLipColor();
    ctx.fill();

    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.fillStyle = isDark ? '#1a2338' : '#ffffff';
    ctx.fill();
  } else if (themeFrame) {
    themeFrame.draw(ctx, l.left, l.top, l.width, l.height, radius, accent, frameOpts);
  } else {
    ctx.shadowColor = isDark ? 'rgba(0,0,0,0.65)' : 'rgba(15,23,42,0.18)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.fillStyle = isDark ? '#1c1c20' : '#ffffff';
    ctx.fill();
  }
  ctx.restore();

  const textStart = isRtl ? l.left + l.width - LENS_FOCUS_PAD : l.left + LENS_FOCUS_PAD;
  let y = l.top;

  if (l.tier === 'focus') {
    if (m.imageHeight) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
      ctx.clip();
      if (!(m.imageMode === 'banner'
        ? drawLensContainImage(ctx, art, l.left, l.top, l.width, m.imageHeight)
        : drawLensPhoto(ctx, art, l.left, l.top, l.width, m.imageHeight))) {
        ctx.fillStyle = hexToRgba(accent, isToy ? 0.25 : 0.14);
        ctx.fillRect(l.left, l.top, l.width, m.imageHeight);
      }
      drawLensPhotoControls(ctx, art);
      if (isToy) {
        ctx.fillStyle = accent;
        ctx.fillRect(l.left, l.top, l.width, 5);
        ctx.beginPath();
        ctx.moveTo(l.left, l.top + m.imageHeight);
        ctx.lineTo(l.left + l.width, l.top + m.imageHeight);
        ctx.strokeStyle = getToyEdgeColor();
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.restore();
      y += m.imageHeight;
    } else if (isToy) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(l.left, l.top, l.width, 6);
      ctx.restore();
    }
    const sideThumb = m.imageMode === 'side' ? m.thumb : null;
    if (sideThumb) {
      const thumbX = isRtl ? l.left + l.width - LENS_FOCUS_PAD - sideThumb.w : l.left + LENS_FOCUS_PAD;
      const thumbY = l.top + LENS_FOCUS_PAD;
      ctx.save();
      if (!drawLensContainImage(ctx, art, thumbX, thumbY, sideThumb.w, sideThumb.h, 10)) {
        ctx.beginPath();
        drawPillPath(ctx, thumbX, thumbY, sideThumb.w, sideThumb.h, 10);
        ctx.fillStyle = hexToRgba(accent, isToy ? 0.28 : 0.16);
        ctx.fill();
      }
      ctx.beginPath();
      drawPillPath(ctx, thumbX, thumbY, sideThumb.w, sideThumb.h, 10);
      ctx.strokeStyle = isToy ? '#0f172a' : skin.divider;
      ctx.lineWidth = isToy ? 1.75 : Math.max(1, skin.dividerWidth);
      ctx.stroke();
      ctx.restore();
    }
    y += LENS_FOCUS_PAD;
    const headStart = sideThumb
      ? (isRtl ? l.left + l.width - LENS_FOCUS_PAD - sideThumb.w - LENS_THUMB_GAP : l.left + LENS_FOCUS_PAD + sideThumb.w + LENS_THUMB_GAP)
      : textStart;
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.textAlign = isRtl ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    if (m.eyebrow) {
      ctx.font = isToy ? `700 10.5px ${TOY_CANVAS_FONT}` : LENS_EYEBROW_FONT();
      ctx.fillStyle = accent;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.6px';
      ctx.fillText(m.eyebrow, headStart, y + LENS_EYEBROW_LINE / 2 - 2);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      y += LENS_EYEBROW_LINE;
    }
    const titleStyle = isToy ? null : applyLensTitleStyle(ctx);
    if (isToy) ctx.font = `700 15.5px ${TOY_CANVAS_FONT}`;
    let titleTop = y;
    m.lines.forEach((line) => {
      if (titleStyle?.shadow) {
        // Comic lettering: hard offset shadow like the drawer's text-shadow.
        ctx.fillStyle = isDark ? '#4a4a56' : '#ffd23f';
        drawLensLine(ctx, line, headStart + (isRtl ? -2 : 2), titleTop + 2, LENS_TITLE_LINE, isRtl);
      }
      ctx.fillStyle = isToy ? (isDark ? '#ffffff' : '#0f172a') : (titleStyle.shadow && isDark ? '#ffd23f' : skin.title);
      drawLensLine(ctx, line, headStart, titleTop, LENS_TITLE_LINE, isRtl);
      titleTop += getLensLineHeight(line, LENS_TITLE_LINE);
    });
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y = titleTop;
    if (m.date) {
      y += 4;
      ctx.font = isToy ? `700 11.5px ${TOY_CANVAS_FONT}` : LENS_DATE_FONT();
      ctx.fillStyle = accent;
      ctx.fillText(m.date, headStart, y + LENS_DATE_LINE / 2);
      y += LENS_DATE_LINE;
    }
    if (m.location) {
      y += 2;
      const pinX = isRtl ? headStart - 4 : headStart + 4;
      drawLensPin(ctx, pinX, y + LENS_META_LINE / 2, muted);
      ctx.font = isToy ? `600 11.5px ${TOY_CANVAS_FONT}` : LENS_META_FONT();
      ctx.fillStyle = muted;
      ctx.fillText(m.location, isRtl ? headStart - 14 : headStart + 14, y + LENS_META_LINE / 2);
      y += LENS_META_LINE;
    }
    if (sideThumb) y = Math.max(y, l.top + LENS_FOCUS_PAD + sideThumb.h);
    if (m.sub.length) {
      y += 8;
      ctx.font = isToy ? `500 12.5px ${TOY_CANVAS_FONT}` : LENS_SUB_FONT();
      ctx.fillStyle = isToy ? (isDark ? '#dfe5ef' : '#1e293b') : skin.body;
      if (m.subOverflow) {
        // Scrollable description: clip to the visible lines and offset by the scroll position.
        const viewH = getLensLinesHeight(m.sub, LENS_SUB_LINE);
        const totalH = getLensLinesHeight(m.subAll, LENS_SUB_LINE);
        const maxScroll = totalH - viewH;
        const scroll = Math.min(maxScroll, Math.max(0, art._lensSubScroll || 0));
        art._lensSubScroll = scroll;
        art._lensSubRect = { x: l.left, y, w: l.width, h: viewH, maxScroll };
        ctx.save();
        ctx.beginPath();
        ctx.rect(l.left, y, l.width, viewH);
        ctx.clip();
        let lineTop = y - scroll;
        m.subAll.forEach((line) => {
          const lineH = getLensLineHeight(line, LENS_SUB_LINE);
          if (lineTop + lineH >= y && lineTop <= y + viewH) {
            drawLensLine(ctx, line, textStart, lineTop, LENS_SUB_LINE, isRtl);
          }
          lineTop += lineH;
        });
        ctx.restore();
        // Thin scrollbar on the trailing edge.
        const trackX = isRtl ? l.left + 3 : l.left + l.width - 5;
        const thumbH = Math.max(18, viewH * (viewH / totalH));
        const thumbY = y + (maxScroll > 0 ? (scroll / maxScroll) * (viewH - thumbH) : 0);
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = isToy ? (isDark ? '#dfe5ef' : '#1e293b') : skin.muted;
        ctx.beginPath();
        drawPillPath(ctx, trackX, thumbY, 2.5, thumbH, 1.25);
        ctx.fill();
        ctx.restore();
      } else {
        art._lensSubRect = null;
        let lineTop = y;
        m.sub.forEach((line) => {
          drawLensLine(ctx, line, textStart, lineTop, LENS_SUB_LINE, isRtl);
          lineTop += getLensLineHeight(line, LENS_SUB_LINE);
        });
      }
    } else {
      art._lensSubRect = null;
    }

    // Footer: ‹ prev · n / N · next ›
    const footerTop = l.top + l.height - LENS.focusFooter;
    const footerMid = footerTop + LENS.focusFooter / 2;
    if (isToy) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
      ctx.clip();
      ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.38)' : '#f8fafc';
      ctx.fillRect(l.left, footerTop, l.width, LENS.focusFooter);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(l.left + 1, footerTop + 0.5);
    ctx.lineTo(l.left + l.width - 1, footerTop + 0.5);
    ctx.strokeStyle = isToy
      ? (isDark ? 'rgba(56, 70, 106, 0.9)' : '#0f172a')
      : skin.divider;
    ctx.lineWidth = isToy ? 2 : skin.dividerWidth;
    ctx.stroke();
    const btnInset = LENS_FOCUS_PAD + LENS.focusNavButton / 2 - 2;
    drawLensNavButton(ctx, l.left + btnInset, footerMid, -1, hasPrev, navHover === 'prev', isDark, accent, true);
    drawLensNavButton(ctx, l.left + l.width - btnInset, footerMid, 1, hasNext, navHover === 'next', isDark, accent, true);
    if (position) {
      const counterText = `${position.index + 1} / ${position.total}`;
      ctx.direction = 'ltr';
      ctx.textAlign = 'center';
      ctx.font = isToy ? `700 11.5px ${TOY_CANVAS_FONT}` : LENS_COUNTER_FONT();
      if (isToy) {
        const cw = Math.max(48, ctx.measureText(counterText).width + 18);
        const ch = 22;
        const cx = l.left + l.width / 2 - cw / 2;
        const cy = footerMid - ch / 2;
        ctx.save();
        ctx.beginPath();
        drawPillPath(ctx, cx, cy + 1.5, cw, ch, 11);
        ctx.fillStyle = getToyLipColor();
        ctx.fill();
        ctx.beginPath();
        drawPillPath(ctx, cx, cy, cw, ch, 11);
        ctx.fillStyle = isDark ? '#283552' : '#fef9c3';
        ctx.fill();
        ctx.strokeStyle = getToyEdgeColor();
        ctx.lineWidth = 1.75;
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = isToy ? (isDark ? '#ffffff' : '#0f172a') : muted;
      ctx.fillText(counterText, l.left + l.width / 2, footerMid);
    }
  } else {
    if (isToy) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(l.left, l.top, l.width, 4.5);
      ctx.restore();
    }
    const thumbSize = LENS.focusRowThumb;
    const contentTop = l.top + (l.height - thumbSize) / 2;
    const innerStart = isRtl ? l.left + l.width - LENS.focusRowNav : l.left + LENS.focusRowNav;
    if (m.thumb) {
      const thumbLeft = isRtl ? innerStart - thumbSize : innerStart;
      drawLensImageTile(ctx, art, thumbLeft, contentTop, thumbSize, thumbSize, 8, accent);
    }
    const x = isRtl ? innerStart - m.thumb : innerStart + m.thumb;
    const blockHeight = m.lines.length * LENS_ROW_TITLE_LINE + (m.date ? 2 + LENS_DATE_LINE : 0);
    let ty = l.top + (l.height - blockHeight) / 2;
    ctx.direction = isRtl ? 'rtl' : 'ltr';
    ctx.textAlign = isRtl ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    ctx.font = isToy ? `700 13.5px ${TOY_CANVAS_FONT}` : LENS_ROW_TITLE_FONT();
    ctx.fillStyle = isToy ? (isDark ? '#ffffff' : '#0f172a') : skin.title;
    m.lines.forEach((line, i) => ctx.fillText(line, x, ty + i * LENS_ROW_TITLE_LINE + LENS_ROW_TITLE_LINE / 2));
    ty += m.lines.length * LENS_ROW_TITLE_LINE;
    if (m.date) {
      ctx.font = isToy ? `700 11px ${TOY_CANVAS_FONT}` : LENS_DATE_FONT();
      ctx.fillStyle = accent;
      ctx.fillText(m.date, x, ty + 2 + LENS_DATE_LINE / 2);
    }
    const midY = l.top + l.height / 2;
    drawLensNavButton(ctx, l.left + LENS.focusRowNav / 2 + 1, midY, -1, hasPrev, navHover === 'prev', isDark, accent, false);
    drawLensNavButton(ctx, l.left + l.width - LENS.focusRowNav / 2 - 1, midY, 1, hasNext, navHover === 'next', isDark, accent, false);
  }

  if (isToy) {
    if (isSelected) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left - 2, l.top - 2, l.width + 4, l.height + 4, radius + 2);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.strokeStyle = getToyEdgeColor();
    ctx.lineWidth = 2.8;
    ctx.stroke();
  } else if (themeFrame) {
    // A photo covers the frame's decorations, so redraw them + the outline on top of it,
    // like the desktop portrait cards.
    if (l.tier === 'focus' && m.imageHeight) {
      themeFrame.draw(ctx, l.left, l.top, l.width, l.height, radius, accent, { ...frameOpts, overlayOnly: true, skipGlow: true });
    }
  } else {
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.strokeStyle = accent;
    ctx.lineWidth = isSelected ? 2.6 : 1.6;
    ctx.stroke();
  }

  const star = getLensStarBox(art);
  l.starBox = star;
  if (star) drawCardStar(ctx, star, art.isStarred, art.isMouseOverStar);
}

function drawLensChip(ctx, art, isSelected) {
  const l = art._lens;
  const m = l.layout;
  const isDark = Boolean(window.__chronixDarkTheme);
  const isToy = isToyThemeActive();
  const accent = getLensAccentColor(art);
  const isRtl = isArticleRtl(art);
  const isHigh = Boolean(art.isMouseover || isSelected);
  const themeFrame = isToy ? null : getActiveThemeCardFrame();
  const radius = isToy ? 12 : (themeFrame ? Math.min(themeFrame.radius, 10) : (l.height > 30 ? 10 : 13));

  ctx.save();
  if (isToy) {
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top + (isHigh ? 4.5 : 3.5), l.width, l.height, radius);
    ctx.fillStyle = getToyLipColor();
    ctx.fill();

    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.fillStyle = isSelected
      ? (isDark ? '#283552' : '#fef9c3')
      : (isDark ? '#1a2338' : '#ffffff');
    ctx.fill();

    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(l.left, l.top, l.width, 3.5);
  } else if (themeFrame) {
    themeFrame.draw(ctx, l.left, l.top, l.width, l.height, radius, accent, {
      isActive: Boolean(isSelected),
      isMouseover: Boolean(art.isMouseover),
      isDark,
    });
  } else {
    if (isHigh) {
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.16)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    }
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.fillStyle = isDark ? '#18181b' : '#ffffff';
    ctx.fill();
  }
  ctx.restore();

  if (isToy) {
    if (isSelected) {
      ctx.save();
      ctx.beginPath();
      drawPillPath(ctx, l.left - 1.5, l.top - 1.5, l.width + 3, l.height + 3, radius + 1.5);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.strokeStyle = getToyEdgeColor();
    ctx.lineWidth = 2.2;
    ctx.stroke();
  } else if (!themeFrame) {
    ctx.beginPath();
    drawPillPath(ctx, l.left, l.top, l.width, l.height, radius);
    ctx.strokeStyle = accent;
    ctx.lineWidth = isSelected ? 2.2 : 1.2;
    ctx.stroke();
  }

  if (m.thumb) {
    const size = LENS.chipThumb;
    const tx = isRtl ? l.left + l.width - 5 - size : l.left + 5;
    const ty = l.top + (l.height - size) / 2;
    drawLensImageTile(ctx, art, tx, ty, size, size, size / 2, accent);
  }
  const textStart = isRtl ? l.left + l.width - 8 - m.thumb : l.left + 8 + m.thumb;
  ctx.direction = isRtl ? 'rtl' : 'ltr';
  ctx.textAlign = isRtl ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.font = isToy ? `700 12px ${TOY_CANVAS_FONT}` : LENS_CHIP_FONT();
  ctx.fillStyle = isToy ? (isDark ? '#ffffff' : '#0f172a') : getLensSkinPalette(isDark).title;
  const startY = l.top + l.height / 2 - ((m.lines.length - 1) * LENS_CHIP_LINE) / 2;
  m.lines.forEach((line, i) => ctx.fillText(line, textStart, startY + i * LENS_CHIP_LINE));
}

function drawLensBubble(ctx, art, isSelected) {
  const l = art._lens;
  const isDark = Boolean(window.__chronixDarkTheme);
  const isToy = isToyThemeActive();
  const accent = getLensAccentColor(art);
  const r = l.width / 2;
  const cx = l.left + r;
  const cy = l.top + r;
  const skin = isToy ? null : getLensSkinName();
  const isHigh = Boolean(isSelected || art.isMouseover);
  if (isToy) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + 3, r, 0, Math.PI * 2);
    ctx.fillStyle = getToyLipColor();
    ctx.fill();
    ctx.restore();
  } else if (skin === 'comic') {
    const offset = isHigh ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.arc(cx + offset, cy + offset, r, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? COMIC_NIGHT_SHADOW : COMIC_INK;
    ctx.fill();
  }
  ctx.save();
  if (skin === 'journal' || skin === 'bento') {
    ctx.shadowColor = skin === 'journal'
      ? (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(90, 70, 40, 0.18)')
      : (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(17, 17, 24, 0.12)');
    ctx.shadowBlur = isHigh ? 10 : 5;
    ctx.shadowOffsetX = skin === 'journal' ? 1 : 0;
    ctx.shadowOffsetY = isHigh ? 4 : 2;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = isToy ? (isDark ? '#1a2338' : '#ffffff') : getLensSkinFill(skin, isDark);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (!drawLensCoverImage(ctx, art, l.left, l.top, l.width, l.height)) {
    ctx.fillStyle = hexToRgba(accent, isToy ? 0.28 : 0.18);
    ctx.fillRect(l.left, l.top, l.width, l.height);
    const initial = Array.from(getLensTitle(art))[0] || '•';
    ctx.font = `700 13px ${getCanvasFont(isToy)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isToy ? '#0f172a' : (skin === 'comic' ? (isDark ? '#ffffff' : COMIC_INK) : accent);
    ctx.fillText(initial.toUpperCase(), cx, cy + 0.5);
  }
  ctx.restore();
  if (isToy) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r - 1.8), 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? '#facc15' : accent;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = getToyEdgeColor();
    ctx.lineWidth = 2.2;
    ctx.stroke();
  } else if (skin === 'comic' || skin === 'journal') {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r - 2), 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = isHigh ? 2.4 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (skin === 'comic') {
      ctx.strokeStyle = isDark ? COMIC_NIGHT_EDGE : COMIC_INK;
      ctx.lineWidth = isSelected ? 2.8 : 2.2;
    } else {
      ctx.strokeStyle = isSelected ? '#2f5d9e' : (isDark ? 'rgba(232, 220, 196, 0.35)' : 'rgba(139, 115, 85, 0.6)');
      ctx.lineWidth = isSelected ? 2 : 1.2;
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = isHigh ? 2.6 : 1.8;
    ctx.stroke();
  }
}

function drawLensDot(ctx, art, isSelected) {
  const l = art._lens;
  const isToy = isToyThemeActive();
  const isDark = Boolean(window.__chronixDarkTheme);
  const skin = isToy ? null : getLensSkinName();
  const accent = getLensAccentColor(art);
  const r = isToy
    ? (isSelected ? l.width / 2 + 2.2 : l.width / 2 + 1)
    : (isSelected ? l.width / 2 + 1.5 : l.width / 2);
  if (isToy) {
    ctx.beginPath();
    ctx.arc(l.x, l.axisY + 1.5, r, 0, Math.PI * 2);
    ctx.fillStyle = getToyLipColor();
    ctx.fill();
  } else if (skin === 'comic') {
    ctx.beginPath();
    ctx.arc(l.x + 1.5, l.axisY + 1.5, r, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? COMIC_NIGHT_SHADOW : COMIC_INK;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(l.x, l.axisY, r, 0, Math.PI * 2);
  ctx.fillStyle = isToy && isSelected ? '#facc15' : accent;
  ctx.fill();
  if (isToy) {
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#0f172a';
  } else if (skin === 'comic') {
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = isDark ? COMIC_NIGHT_EDGE : COMIC_INK;
  } else if (skin === 'journal') {
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = isDark ? '#2a241d' : '#fffdf6';
  } else {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isDark ? '#09090b' : '#ffffff';
  }
  ctx.stroke();
}

function withLensClip(ctx, art, draw) {
  const clip = art._lens?.clip;
  if (!clip) {
    draw();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, clip.top, ctx.canvas?.width || 4000, clip.bottom - clip.top);
  ctx.clip();
  try {
    draw();
  } finally {
    ctx.restore();
  }
}

// Stems (axis -> card), axis anchors and the focus event's period span.
function drawLensStems(ctx, arts, side, focusId) {
  const isToy = isToyThemeActive();
  const isDark = Boolean(window.__chronixDarkTheme);
  const isArtHigh = (art) => {
    const selectedId = art.owner?._selectedArticleId;
    const isSel = Boolean((art.isActive && !art._chronixFakeActive) || (selectedId && isSameArticleId(art.id, selectedId)));
    return String(art.id) === focusId || Boolean(art.isMouseover || art.isDragging || isSel);
  };
  const ordered = arts.slice().sort((a, b) => Number(isArtHigh(a)) - Number(isArtHigh(b)));
  ordered.forEach((art) => {
    const l = art._lens;
    if (!l || l.side !== side) return;
    const isHigh = isArtHigh(art);
    const accent = getLensAccentColor(art);
    const endY = side === 'above' ? l.top + l.height : l.top;
    withLensClip(ctx, art, () => {
      ctx.save();
      if (isToy) {
        const baseAlpha = art.opacity ?? 1;
        const x = Math.round(l.x);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isHigh) {
          ctx.globalAlpha = baseAlpha;
          // Pass 1: Unified dark outline
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.moveTo(x, l.axisY);
          ctx.lineTo(x, endY);
          ctx.stroke();
          // Pass 2: Colorful inner fill
          ctx.strokeStyle = accent;
          ctx.lineWidth = 3.4;
          ctx.beginPath();
          ctx.moveTo(x, l.axisY);
          ctx.lineTo(x, endY);
          ctx.stroke();
        } else {
          ctx.globalAlpha = baseAlpha * (isDark ? 0.55 : 0.5);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x, l.axisY);
          ctx.lineTo(x, endY);
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = (art.opacity ?? 1) * (isHigh ? 0.95 : 0.45);
        ctx.strokeStyle = accent;
        ctx.lineWidth = isHigh ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(l.x + 0.5, l.axisY);
        ctx.lineTo(l.x + 0.5, endY);
        ctx.stroke();
      }
      ctx.restore();
    });
  });
}

function drawLensAnchors(ctx, arts, focusId) {
  const isToy = isToyThemeActive();
  const isDark = Boolean(window.__chronixDarkTheme);
  arts.forEach((art) => {
    const l = art._lens;
    if (!l || l.tier === 'dot') return;
    const isFocus = String(art.id) === focusId;
    const selectedId = art.owner?._selectedArticleId;
    const isSel = Boolean((art.isActive && !art._chronixFakeActive) || (selectedId && isSameArticleId(art.id, selectedId)));
    const isHigh = isFocus || Boolean(art.isMouseover || art.isDragging || isSel);
    const accent = getLensAccentColor(art);
    withLensClip(ctx, art, () => {
      ctx.save();
      const baseAlpha = art.opacity ?? 1;
      ctx.globalAlpha = baseAlpha;
      if (isFocus && art.indicator && art.indicator.toX - art.indicator.fromX > 6) {
        const spanW = art.indicator.toX - art.indicator.fromX;
        if (isToy) {
          ctx.beginPath();
          drawPillPath(ctx, art.indicator.fromX, l.axisY - 2, spanW, 8, 4);
          ctx.fillStyle = getToyLipColor();
          ctx.fill();
          ctx.beginPath();
          drawPillPath(ctx, art.indicator.fromX, l.axisY - 4, spanW, 8, 4);
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else {
          ctx.fillStyle = hexToRgba(accent, 0.45);
          ctx.beginPath();
          drawPillPath(ctx, art.indicator.fromX, l.axisY - 3, spanW, 6, 3);
          ctx.fill();
        }
      }
      if (isToy) {
        const r = isHigh ? 6.5 : 4;
        ctx.globalAlpha = isHigh ? baseAlpha : baseAlpha * (isDark ? 0.6 : 0.55);
        if (isHigh) {
          ctx.beginPath();
          ctx.arc(l.x, l.axisY + 1.8, r, 0, Math.PI * 2);
          ctx.fillStyle = getToyLipColor();
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(l.x, l.axisY, r, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = isHigh ? 2.2 : 1.4;
        ctx.strokeStyle = isHigh ? '#0f172a' : (isDark ? '#38466a' : '#475569');
        ctx.stroke();

        if (isHigh) {
          ctx.beginPath();
          ctx.arc(l.x, l.axisY, 2.3, 0, Math.PI * 2);
          ctx.fillStyle = '#fef9c3';
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(l.x, l.axisY, isHigh ? 5.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = isHigh ? 2 : 1.2;
        ctx.strokeStyle = window.__chronixDarkTheme ? '#09090b' : '#ffffff';
        ctx.stroke();
      }
      ctx.restore();
    });
  });
}

function drawLensLaneBaselines(ctx, tl, width) {
  if (!isLensLaneMode(tl)) return;
  const isDark = Boolean(window.__chronixDarkTheme);
  const isToy = isToyThemeActive();
  const lanes = typeof tl._getActiveLanesForLayout === 'function' ? tl._getActiveLanesForLayout() : (tl.lanes || []);
  (lanes || []).forEach((lane) => {
    const g = lane?.geometry;
    if (!g || !(g.height > 0)) return;
    const y = Math.round(g.bodyContentBottom - 8) + 0.5;
    ctx.save();
    ctx.strokeStyle = isToy
      ? (isDark ? 'rgba(15,23,42,0.7)' : 'rgba(15,23,42,0.22)')
      : (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)');
    ctx.lineWidth = isToy ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
  });
}

function renderFocusLens(tl, ctx, top, width, markers, drawCycleContext) {
  const effectiveVerticalOffset = tl._getEffectiveVerticalOffset();
  if (!tl.owner) {
    ctx.clearRect(0, 0, width, tl.top + effectiveVerticalOffset);
  }
  const arts = layoutFocusLens(tl, drawCycleContext, width);
  const focusId = tl._chronixLens.focusId != null ? String(tl._chronixLens.focusId) : null;
  const selectedId = tl._selectedArticleId != null ? String(tl._selectedArticleId) : null;
  const articles = arts.map((item) => item.art);

  tl.drawTimeBands(ctx, top, width, drawCycleContext);
  if (typeof tl.drawCharts === 'function') tl.drawCharts(ctx, top, width, drawCycleContext);
  drawLensLaneBaselines(ctx, tl, width);
  // Strip stems run under the ruler so the date labels stay legible on top of them.
  drawLensStems(ctx, articles, 'below', focusId);
  const mainLineTop = tl.options.style.mainLine.position === 'top' ? -effectiveVerticalOffset : top;
  tl.drawMainline(ctx, mainLineTop, width, markers);
  drawLensStems(ctx, articles, 'above', focusId);
  drawLensAnchors(ctx, articles, focusId);

  const order = { dot: 0, bubble: 1, chip: 2, focusRow: 3, focus: 3 };
  const sorted = articles
    .filter((art) => art._lens)
    .sort((a, b) => order[a._lens.tier] - order[b._lens.tier]);
  sorted.forEach((art) => {
    const isSelected = selectedId != null && String(art.id) === selectedId;
    withLensClip(ctx, art, () => {
      ctx.save();
      ctx.globalAlpha = art.opacity ?? 1;
      const prevDirection = ctx.direction;
      try {
        switch (art._lens.tier) {
          case 'focus':
          case 'focusRow':
            drawLensFocusCard(ctx, art, isSelected);
            break;
          case 'chip':
            drawLensChip(ctx, art, isSelected);
            break;
          case 'bubble':
            drawLensBubble(ctx, art, isSelected);
            break;
          default:
            drawLensDot(ctx, art, isSelected);
        }
      } finally {
        ctx.direction = prevDirection;
        ctx.restore();
      }
    });
  });
  if (!tl.options.disableBranding) {
    ctx.globalAlpha = 1;
    tl._drawBranding(ctx);
  }
}

// Visible articles ordered chronologically with their current axis x (for prev/next).
function getLensSequence(tl) {
  const items = [];
  (tl.articles || []).forEach((art) => {
    if (!art?.isDataLoaded || art.isHiddenByFilter || art.isVisibleInLane === false || !art.period?.from) return;
    const x = tl.getPixel(art.period.from);
    if (!Number.isFinite(x)) return;
    items.push({ id: String(art.id), x, art });
  });
  items.sort((a, b) => a.x - b.x);
  return items;
}

// Glides the timeline so the article sits under the lens centre and holds it as the
// focus for the duration of the animation.
function centerLensOnArticle(tl, articleId, { duration = 450 } = {}) {
  if (!tl || articleId == null) return false;
  const art = tl.getArticleById?.(articleId);
  if (!art?.period?.from) return false;
  const lens = getLensState(tl);
  const width = tl.width || tl.options?.width || 0;
  const x = tl.getPixel(art.period.from);
  if (!Number.isFinite(x)) return false;
  // updateFromByPixels(+n) scrolls content left, so this brings x to the centre.
  const delta = x - width / 2;
  lens.pendingFocusId = String(art.id);
  lens.focusId = String(art.id);
  const token = (lens.animToken || 0) + 1;
  lens.animToken = token;
  const finish = () => {
    if (lens.animToken !== token) return;
    lens.pendingFocusId = null;
    tl.requestRedraw?.(tl.redraw);
  };
  if (Math.abs(delta) < 1) {
    finish();
    tl.redraw();
    return true;
  }
  if (Math.abs(delta) > width * 3 || duration <= 0) {
    try {
      tl.setCentreDate(art.period.from);
    } catch (e) {
      tl.updateFromByPixels?.(delta);
    }
    finish();
    tl.redraw();
    return true;
  }
  tl.goToPixelAnim(delta, { duration, easing: 'easeOutCubic', onComplete: finish, complete: finish });
  // goToPixelAnim has no completion callback in every build; release the hold anyway.
  setTimeout(finish, duration + 120);
  return true;
}

// After a drag/fling settles, glide the nearest event under the lens centre.
function snapLensToNearest(tl) {
  const lens = tl?._chronixLens;
  if (!lens?.active || lens.pendingFocusId) return false;
  const width = tl.width || tl.options?.width || 0;
  const items = (lens.items || []).filter((item) => item.lane === (lens.focusLane ?? item.lane));
  const pool = items.length ? items : lens.items || [];
  // Always settle on an event so the focus card (and its prev / next controls) stays up,
  // including after panning into a gap or past either end of the timeline.
  const nearest = findNearestItem(pool, width / 2);
  if (!nearest) return false;
  if (Math.abs(nearest.x - width / 2) < 2) {
    tl._chronixOnLensFocus?.(nearest.id);
    return false;
  }
  const moved = centerLensOnArticle(tl, nearest.id, { duration: 280 });
  if (moved) tl._chronixOnLensFocus?.(nearest.id);
  return moved;
}

// Release velocity (px/ms, positive = content moving left) from the engine's drag
// samples, measured over the same window its momentum uses.
function getDragReleaseVelocity(tl) {
  const windowMs = tl?.options?.pan?.momentum?.sampleWindow || 100;
  const cutoff = Date.now() - windowMs;
  const samples = (tl?.dragMomentumSamples || []).filter((s) => s.time >= cutoff);
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsed = last.time - first.time;
  return elapsed > 0 ? (first.x - last.x) / elapsed : 0;
}

// Called synchronously from 'viewport-drag-end', before the engine starts its fling.
// A short swipe moves exactly one event from the one focused when the drag began
// (cancelling the fling); returns false to let a long swipe scroll freely.
function handleLensSwipeEnd(tl, totalDx) {
  const lens = tl?._chronixLens;
  if (!lens?.active) return false;
  const originId = lens.swipeOriginId ?? null;
  lens.swipeOriginId = null;
  const width = tl.width || tl.options?.width || 0;
  const swipe = classifyLensSwipe({ dx: totalDx, velocity: getDragReleaseVelocity(tl), width });
  if (swipe.kind !== 'step') return false;
  const target = findAdjacentItem(getLensSequence(tl), originId, swipe.direction, width / 2);
  if (!target) return false;
  tl.dragMomentumSamples = [];
  const token = (lens.snapToken || 0) + 1;
  lens.snapToken = token;
  // Defer until endDragging has finished (it may start an elastic bounds settle).
  setTimeout(() => {
    if (lens.snapToken !== token || tl.isDragging || tl.isPinching || !lens.active) return;
    tl.stopPanAnimation?.();
    if (centerLensOnArticle(tl, target.id, { duration: 320 })) tl._chronixOnLensFocus?.(target.id);
  }, 0);
  return true;
}

function stepLensFocus(tl, direction) {
  const lens = tl?._chronixLens;
  if (!lens?.active) return false;
  const width = tl.width || tl.options?.width || 0;
  const next = findAdjacentItem(getLensSequence(tl), lens.pendingFocusId || lens.focusId, direction, width / 2);
  if (!next) return false;
  const moved = centerLensOnArticle(tl, next.id);
  if (moved) tl._chronixOnLensFocus?.(next.id);
  return moved;
}

// After loading, a "fit all" overview crowds most events into dots; open instead
// centred on the first event, zoomed so the next few events fill the right half.
function applyLensOpeningView(tl) {
  if (!isLensActive(tl)) return false;
  const width = tl.width || tl.options?.width || 0;
  const seq = getLensSequence(tl);
  if (seq.length < 3 || !(width > 0)) return false;
  const k = Math.min(4, seq.length - 1);
  const span = seq[k].x - seq[0].x;
  const scale = span > 0.5 ? Math.min((width * 0.45) / span, 60) : 1;
  const ratio = tl.timescaleManager?.zoomOptions?.ratio;
  if (scale > 1.25 && Number.isFinite(ratio) && ratio > 0 && ratio !== 1) {
    tl.setZoom(tl.getZoom() + Math.log(scale) / Math.log(ratio));
  }
  const first = seq[0].art;
  tl.setCentreDate(first.period.from);
  const lens = getLensState(tl);
  lens.focusId = String(first.id);
  tl._chronixLensAutoOpened = true;
  tl.redraw();
  return true;
}

if (!Timeline.prototype._chronixLensPatched) {
  Timeline.prototype._chronixLensPatched = true;

  const originalGetEffectiveVerticalOffset = Timeline.prototype._getEffectiveVerticalOffset;
  Timeline.prototype._getEffectiveVerticalOffset = function () {
    const base = originalGetEffectiveVerticalOffset.call(this);
    if (this._chronixLens?.raised) {
      const height = this.options?.height || 0;
      const stripHeight = LENS.rulerHeight + LENS.stripTopGap
        + LENS.stripRows * LENS.stripChipHeight + (LENS.stripRows - 1) * LENS.stripRowGap
        + LENS.stripBottomGap;
      return Math.max(base, Math.min(Math.round(height * (1 - LENS.axisRatio)), stripHeight));
    }
    return base;
  };

  const originalIsInside = Article.prototype.isInside;
  Article.prototype.isInside = function (pos) {
    if (!isLensActive(this.owner)) return originalIsInside.call(this, pos);
    const l = this._lens;
    if (!this.isVisible || !l) return false;
    if (l.clip && (pos.top < l.clip.top || pos.top > l.clip.bottom)) return false;
    if (l.tier === 'dot' || l.tier === 'bubble') {
      const half = Math.max(LENS.dotHit, l.width) / 2;
      const cy = l.tier === 'dot' ? l.axisY : l.top + l.height / 2;
      const cx = l.tier === 'dot' ? l.x : l.left + l.width / 2;
      return Math.abs(pos.left - cx) <= half && Math.abs(pos.top - cy) <= half;
    }
    return pos.left >= l.left && pos.left <= l.left + l.width && pos.top >= l.top && pos.top <= l.top + l.height;
  };

  const originalGetIconBox = Article.prototype.getIconBox;
  Article.prototype.getIconBox = function () {
    if (!isLensActive(this.owner)) return originalGetIconBox.call(this);
    return this._lens ? getLensStarBox(this) : null;
  };

  // Runs on hover and on click (Article.clicked), so it also records which built-in
  // prev / next control of the focus card is under the pointer.
  const originalUpdateIsMouseOverStar = Article.prototype.updateIsMouseOverStar;
  Article.prototype.updateIsMouseOverStar = function (pos) {
    const result = originalUpdateIsMouseOverStar.call(this, pos);
    const hit = isLensActive(this.owner) && !this.isMouseOverStar ? getLensNavHit(this, pos) : null;
    this._lensNavHit = hit;
    if (hit !== (this._lensNavHover ?? null)) {
      this._lensNavHover = hit;
      this.owner?.requestRedraw?.(this.owner.redraw);
    }
    return result;
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
  const palette = getActiveCategoryPalette();
  return palette[artIdx % palette.length];
}

function withYouthArticleStyle(style, isDark, state) {
  return withJournalArticleStyle(withBentoArticleStyle(withComicArticleStyle(style, isDark, state), isDark, state), isDark, state);
}

function getTimelineArticleStyle(isDark, isRtl = false) {
  return withYouthArticleStyle(getBaseTimelineArticleStyle(isDark, isRtl), isDark, 'normal');
}

function getBaseTimelineArticleStyle(isDark, isRtl = false) {
  const isToy = isToyThemeActive();
  const canvasFont = getCanvasFont(isToy);
  return {
    backgroundColor: isToy ? (isDark ? '#1a2338' : '#ffffff') : (isDark ? '#18181b' : '#ffffff'),
    color: isToy ? (isDark ? '#1a2338' : '#ffffff') : (isDark ? '#18181b' : '#f4f4f5'),
    topRadius: isToy ? 10 : 6,
    borderRadius: isToy ? 10 : 6,
    border: {
      color: isToy ? 'rgba(0, 0, 0, 0)' : (isDark ? '#3f3f46' : '#d4d4d8'),
      width: isToy ? 2.2 : 1,
    },
    header: {
      height: 54,
      text: {
        font: `${isToy ? 700 : 600} 13px ${canvasFont}`,
        color: isToy ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#f4f4f5' : '#09090b'),
        align: isRtl ? 'right' : 'left',
        margin: 10,
        lineHeight: 18,
        numberOfLines: 8,
      }
    },
    subheader: {
      height: 26,
      color: isToy ? (isDark ? '#1f2941' : '#fef08a') : (isDark ? '#1f1f23' : '#e4e4e7'),
      text: {
        font: `${isToy ? (isDark ? 600 : 700) : 500} 11px ${canvasFont}`,
        color: isToy ? (isDark ? '#b8c4d9' : '#0f172a') : (isDark ? '#a1a1aa' : '#71717a'),
        align: isRtl ? 'right' : 'left',
        margin: 10,
        lineHeight: 14,
      }
    },
    shadow: {
      x: 0,
      y: isToy ? 0 : 3,
      amount: isToy ? 0 : (isDark ? 8 : 4),
      color: isToy ? 'rgba(0,0,0,0)' : (isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.08)'),
    },
    connectorLine: {
      visible: true,
      thickness: isToy ? 2.2 : 1,
      color: isDark ? '#3f3f46' : '#a1a1aa',
    }
  };
}

function getTimelineArticleNormalStyle(laneColor, isDark, articleStyle) {
  return withYouthArticleStyle(getBaseTimelineArticleNormalStyle(laneColor, isDark, articleStyle), isDark, 'normal');
}

function getBaseTimelineArticleNormalStyle(laneColor, isDark, articleStyle) {
  const isToy = isToyThemeActive();
  return {
    ...articleStyle,
    color: isToy ? (isDark ? '#1a2338' : '#ffffff') : (isDark ? '#141417' : '#ffffff'),
    border: {
      color: isToy ? 'rgba(0, 0, 0, 0)' : laneColor,
      width: isToy ? 2.2 : 1,
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: isToy ? 2.2 : 1,
    }
  };
}

function getTimelineArticleHoverStyle(laneColor, isDark, articleStyle) {
  return withYouthArticleStyle(getBaseTimelineArticleHoverStyle(laneColor, isDark, articleStyle), isDark, 'hover');
}

function getBaseTimelineArticleHoverStyle(laneColor, isDark, articleStyle) {
  const isToy = isToyThemeActive();
  return {
    ...articleStyle,
    color: isToy ? (isDark ? '#212c45' : '#f0f9ff') : (isDark ? '#1c1c20' : '#ffffff'),
    backgroundColor: isToy ? (isDark ? '#212c45' : '#f0f9ff') : (isDark ? '#1c1c20' : '#ffffff'),
    border: {
      color: isToy ? 'rgba(0, 0, 0, 0)' : laneColor,
      width: isToy ? 2.6 : 1.8,
    },
    shadow: {
      x: 0,
      y: isToy ? 0 : 6,
      amount: isToy ? 0 : 14,
      color: isToy ? 'rgba(0, 0, 0, 0)' : (isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)'),
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: isToy ? 2.6 : 1.8,
    }
  };
}

function getTimelineArticleActiveStyle(laneColor, isDark, articleStyle) {
  return withYouthArticleStyle(getBaseTimelineArticleActiveStyle(laneColor, isDark, articleStyle), isDark, 'active');
}

function getBaseTimelineArticleActiveStyle(laneColor, isDark, articleStyle) {
  const isToy = isToyThemeActive();
  return {
    ...articleStyle,
    color: isToy ? (isDark ? '#283552' : '#fef9c3') : (isDark ? '#27272a' : '#f4f4f5'),
    backgroundColor: isToy ? (isDark ? '#283552' : '#fef9c3') : (isDark ? '#27272a' : '#f4f4f5'),
    border: {
      color: isToy ? 'rgba(0, 0, 0, 0)' : laneColor,
      width: isToy ? 3 : 2.5,
    },
    shadow: {
      x: 0,
      y: isToy ? 0 : 8,
      amount: isToy ? 0 : 18,
      color: isToy ? 'rgba(0, 0, 0, 0)' : (isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.22)'),
    },
    connectorLine: {
      ...articleStyle.connectorLine,
      color: laneColor,
      thickness: isToy ? 3 : 2.5,
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

function persistManualLaneWeights(timeline) {
  if (typeof timeline?._chronixOnPersistLaneWeights === 'function') {
    timeline._chronixOnPersistLaneWeights(timeline._chronixManualLaneWeights);
  }
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
  const isToy = isToyThemeActive();
  const toyLaneColors = ['#0ea5e9', '#a855f7', '#22c55e', '#f59e0b'];

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

      const laneColor = isToy ? toyLaneColors[laneIndex % toyLaneColors.length] : '#71717a';
      const bodyBg = getLaneBodyBg(laneColor, isDark);
      const bodyBorder = getLaneBodyBorder(laneColor, isDark);

      refs.root.style.setProperty('--lane-color', laneColor);
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

  const isToy = isToyThemeActive();
  const canvasFont = getCanvasFont(isToy);
  window.__chronixDarkTheme = isDark;
  window.__chronixIsRtl = Boolean(isRtl);
  timeline._isDarkTheme = isDark;
  const articleStyle = getTimelineArticleStyle(isDark, isRtl);

  // 1. Pre-populate each article's data.style / hoverStyle / activeStyle BEFORE setOption,
  // because timeline.setOption({ article: { defaultStyle } }) synchronously calls
  // art.initialiseStyles() on every article using art.data.style.
  if (Array.isArray(timeline.articles) && timelineData) {
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
      art._lensMeasure = null;
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
    });
  }

  // 2. Apply all timeline-level options in a SINGLE setOption call so Histropedia
  // doesn't trigger 14 intermediate synchronous redraws with half-applied styles.
  const laneHeaderBg = isToy ? (isDark ? '#1a2338' : '#fef08a') : (isDark ? '#161619' : '#f7f7f8');
  const laneTitleColor = isToy ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#f4f4f6' : '#27272a');
  const laneTitleFont = `${isToy ? 700 : 600} 11px ${canvasFont}`;
  const landscapeHeaderColor = isToy ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#f4f4f5' : '#09090b');
  const landscapeSubheaderColor = isToy ? (isDark ? '#b8c4d9' : '#0f172a') : (isDark ? '#a1a1aa' : '#71717a');
  const landscapeHeaderFont = `${isToy ? 700 : 600} 11.5px ${canvasFont}`;
  const landscapeSubheaderFont = `${isToy ? 700 : 500} 10px ${canvasFont}`;

  try {
    timeline.setOption({
      style: {
        mainLine: isToy && isDark
          ? { color: '#2c3a58', opacity: 1 }
          : { color: '#cdd2d8', opacity: 0.75 },
        dateLabel: {
          minor: {
            color: isToy ? (isDark ? '#9aa7bf' : '#1e293b') : (isDark ? '#a1a1aa' : '#71717a'),
            font: `${isToy ? 600 : 500} 10px ${canvasFont}`,
          },
          major: {
            color: isToy ? (isDark ? '#fde68a' : '#0f172a') : (isDark ? '#f4f4f5' : '#09090b'),
            font: `700 12px ${canvasFont}`,
          },
        },
        marker: {
          minor: {
            color: isToy ? (isDark ? '#3d4a6b' : '#334155') : (isDark ? '#71717a' : '#a1a1aa'),
          },
          major: {
            color: isToy ? (isDark ? '#fbbf24' : '#0f172a') : (isDark ? '#a1a1aa' : '#52525b'),
          },
        },
        draggingHighlight: {
          visible: false,
        },
      },
      lane: {
        gap: 0,
        topGap: 0,
        defaultStyle: {
          header: {
            backgroundColor: laneHeaderBg,
          },
          body: {
            backgroundColor: 'transparent',
          },
          title: {
            color: laneTitleColor,
            font: laneTitleFont,
          },
        },
      },
      article: {
        defaultStyle: articleStyle,
        defaultHoverStyle: {
          backgroundColor: isToy ? (isDark ? '#212c45' : '#f0f9ff') : (isDark ? '#1c1c20' : '#ffffff'),
          border: { width: isToy ? 2.6 : 1.8 },
          shadow: {
            x: 0,
            y: isToy ? 0 : 6,
            amount: isToy ? 0 : 14,
            color: isToy ? 'rgba(0,0,0,0)' : (isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)'),
          },
        },
        defaultActiveStyle: {
          backgroundColor: isToy ? (isDark ? '#283552' : '#fef9c3') : (isDark ? '#27272a' : '#f4f4f5'),
          border: { width: isToy ? 3 : 2.5 },
        },
        layoutStyles: {
          landscape: {
            style: {
              header: {
                text: {
                  color: landscapeHeaderColor,
                  font: landscapeHeaderFont,
                },
              },
              subheader: {
                text: {
                  color: landscapeSubheaderColor,
                  font: landscapeSubheaderFont,
                },
              },
            },
            hoverStyle: {
              header: {
                text: {
                  color: landscapeHeaderColor,
                  font: landscapeHeaderFont,
                },
              },
            },
            activeStyle: {
              header: {
                text: {
                  color: landscapeHeaderColor,
                  font: landscapeHeaderFont,
                },
              },
              subheader: {
                text: {
                  color: landscapeSubheaderColor,
                  font: landscapeSubheaderFont,
                },
              },
            },
          },
        },
      },
    });
    if (timeline.options?.style?.draggingHighlight) {
      timeline.options.style.draggingHighlight.visible = false;
    }
  } catch (e) {
    console.warn('Error updating timeline theme options:', e);
  }

  // 3. Re-initialise article styles and invalidate layout/image caches so per-article
  // category colors, fonts, and wrapped text dimensions are cleanly recomputed.
  if (Array.isArray(timeline.articles)) {
    timeline.articles.forEach((art) => {
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

  // 4. Update active lanes with theme-appropriate header/title and transparent body
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
        lane.style.header.backgroundColor = laneHeaderBg;
      }
      if (lane.data?.style?.header) {
        lane.data.style.header.backgroundColor = laneHeaderBg;
      }
      if (lane.style?.title) {
        lane.style.title.color = laneTitleColor;
        lane.style.title.font = laneTitleFont;
      }
      if (lane.data?.style?.title) {
        lane.data.style.title.color = laneTitleColor;
        lane.data.style.title.font = laneTitleFont;
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
      const bandFont = `${isToy ? 700 : 600} 10px ${canvasFont}`;
      if (tb.style) {
        tb.style.background = bg;
        if (tb.style.text) {
          tb.style.text.color = textColor;
          tb.style.text.font = bandFont;
          tb.style.text.verticalAlign = 'bottom';
        }
      }
      if (tb.data?.style) {
        tb.data.style.background = bg;
        if (tb.data.style.text) {
          tb.data.style.text.color = textColor;
          tb.data.style.text.font = bandFont;
          tb.data.style.text.verticalAlign = 'bottom';
        }
      }
    });
  }

  // 6. Re-evaluate auto card layouts and perform a full layout + draw pass
  if ((timeline._chronixCardMode || 'auto') === 'auto') {
    try {
      syncAutoCardLayouts(timeline);
    } catch (e) { }
  }

  try {
    if (typeof timeline.defaultRedraw === 'function') {
      timeline.defaultRedraw();
    } else {
      timeline.redraw();
    }
  } catch (e) {
    console.warn('Error redrawing timeline after theme change:', e);
  }
}

// Horizontal camera state; unchanged since the last fit means the user hasn't panned/zoomed.
function getViewSignature(tl) {
  const v = tl?.timescaleManager?.startToken?.value;
  if (!v) return null;
  return `${tl.getZoom()}|${v.year}|${v.month}|${v.day}|${v.hour ?? ''}|${v.minute ?? ''}|${Math.round((tl.repositionWindow || 0) * 100)}`;
}

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  onFocusArticle,
  // (article) => void - the mobile focus lens moved to another event from the canvas itself
  // (card Prev/Next, swipe, settle after a pan, tap). Falls back to onFocusArticle when omitted.
  onLensFocusChange,
  selectedArticleId,
  starredArticleIds,
  filterStarredOnly = false,
  activeFilter = null,
  onToggleStar,
  theme = 'light',
  visualTheme = 'classic',
  // Notified with (items, mode) whenever lane/theme filters change, so the geo map
  // and prev/next event stepping stay in sync with the timeline's visible subset.
  onFilterChange,
  // Indicates if a right-side drawer (EventDrawer or CardsListDrawer) is currently open.
  hasRightDrawer = false,
  isNarrowViewport = false,
  forceDesktopCanvas = false,
  isMapEventCardVisible = false,
  hoveredArticleId = null,
  onHoverArticle,
  densityMode = 'auto',
  // (articleId, { x, y }) — saves a dragged photo focal point. Omit for read-only views.
  onImagePositionChange,
}, ref) => {
  const { t, isRtl, language } = useLanguage();
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
  const prevVisualThemeRef = useRef(visualTheme);
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
  const forceDesktopCanvasRef = useRef(forceDesktopCanvas);
  useEffect(() => {
    forceDesktopCanvasRef.current = forceDesktopCanvas;
  }, [forceDesktopCanvas]);
  const isMapEventCardVisibleRef = useRef(isMapEventCardVisible);
  useEffect(() => {
    isMapEventCardVisibleRef.current = isMapEventCardVisible;
    const tl = timelineInstanceRef.current;
    if (tl) {
      tl._isMapEventCardVisible = isMapEventCardVisible;
      const currentDensity = densityModeRef.current;
      const isCompact = currentDensity === 'compact';
      const isSmall = currentDensity === 'small';
      const isExpandableMode = isCompact || isSmall;
      const baseLayout = isSmall ? 'landscape' : 'compact';
      const selectedId = tl._selectedArticleId;
      if (selectedId && Array.isArray(tl.articles)) {
        tl.articles.forEach((a) => {
          if (!a) return;
          const isMatch = isSameArticleId(a.id, selectedId);
          if (isMatch) {
            const target = isMapEventCardVisible ? 'circle' : getSelectedCardLayoutForMode(tl, a, currentDensity);
            if (typeof a.setCardLayout === 'function') {
              a.setCardLayout(target);
              if (typeof a.invalidateCaches === 'function') a.invalidateCaches();
            }
          } else if (isExpandableMode && typeof a.setCardLayout === 'function') {
            a.setCardLayout(baseLayout);
            if (typeof a.invalidateCaches === 'function') a.invalidateCaches();
          }
        });
        if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
        else tl.redraw();
      }
    }
  }, [isMapEventCardVisible]);
  const onSelectArticleRef = useRef(onSelectArticle);
  onSelectArticleRef.current = onSelectArticle;
  const onToggleStarRef = useRef(onToggleStar);
  onToggleStarRef.current = onToggleStar;
  const onFocusArticleRef = useRef(onFocusArticle);
  useEffect(() => {
    onFocusArticleRef.current = onFocusArticle;
  }, [onFocusArticle]);
  const onLensFocusChangeRef = useRef(onLensFocusChange);
  onLensFocusChangeRef.current = onLensFocusChange;
  const selectedArticleIdRef = useRef(selectedArticleId);
  selectedArticleIdRef.current = selectedArticleId;
  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;
  // Shares a canvas-driven focus-lens move with the app (so the map follows). Moves the app
  // already knows about (e.g. its own focusArticle calls) are not echoed back.
  const reportLensFocus = useCallback((articleId) => {
    if (articleId == null || isSameArticleId(articleId, selectedArticleIdRef.current)) return;
    const original = timelineDataRef.current?.articles?.find((a) => isSameArticleId(a.id, articleId))
      || timelineInstanceRef.current?.getArticleById?.(articleId)?.data;
    if (!original) return;
    selectedArticleIdRef.current = original.id;
    mobileFocusedArticleIdRef.current = original.id;
    const tl = timelineInstanceRef.current;
    if (tl) tl._selectedArticleId = original.id;
    (onLensFocusChangeRef.current || onFocusArticleRef.current)?.(original);
  }, []);
  // Formulas are re-typeset once KaTeX's fonts finish loading.
  useEffect(() => subscribeCanvasMath(() => {
    const tl = timelineInstanceRef.current;
    if (!tl) return;
    if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
    else tl.redraw?.();
  }), []);
  const onHoverArticleRef = useRef(onHoverArticle);
  useEffect(() => {
    onHoverArticleRef.current = onHoverArticle;
  }, [onHoverArticle]);
  const onImagePositionChangeRef = useRef(onImagePositionChange);
  useEffect(() => {
    onImagePositionChangeRef.current = onImagePositionChange;
  }, [onImagePositionChange]);
  // Mobile two-tap-to-open: id of the event brought to the foreground by the first tap.
  // A second tap on that same event opens its details drawer.
  const mobileFocusedArticleIdRef = useRef(null);
  // Focus-lens (mobile) snapshot from the engine: drives the prev/next overlay buttons.
  // Set when a long press has already opened the drawer, so the click fired on
  // release (if any) is ignored instead of being treated as a normal tap.
  const longPressConsumedRef = useRef(false);
  // Pending long-press timer for the current touch gesture.
  const longPressTimerRef = useRef(null);
  const starredArticleIdsRef = useRef(starredArticleIds);
  const savedViewportRef = useRef(null);
  const savedLaneWeightsRef = useRef(null);

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
  }, [legendCategories, timelineData, visualTheme]);

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
  // split view toggle).
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
    // The canvas ignores image-position-only data changes (no reload), so edits made
    // elsewhere (drawer, feed) are pushed in here.
    setArticleImagePosition: (articleId, { x, y } = {}) => {
      const tl = timelineInstanceRef.current;
      const art = tl?.articles?.find((a) => a && isSameArticleId(a.id, articleId));
      if (!art?.data) return;
      art.data.imagePositionX = x;
      art.data.imagePositionY = y;
      if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
      else tl.redraw?.();
    },
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
        if (Array.isArray(tl.articles)) {
          tl.articles.forEach((a) => {
            if (!a) return;
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
          tl.redraw();
        }
      }
    },
    zoomIn: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        // Floor is the timeline's zoom.minimum: 0 (day) normally, negative for hour/minute timelines.
        const minZoom = tl.timescaleManager?.zoomOptions?.minimum ?? DEFAULT_ZOOM_MINIMUM;
        tl.setZoom(Math.max(minZoom, currentZoom - 4));
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
    // The event the mobile Focus Lens is centred on (null when the lens is off).
    getLensFocusId: () => {
      const tl = timelineInstanceRef.current;
      if (!tl || !isLensActive(tl)) return null;
      const lens = tl._chronixLens;
      return lens.pendingFocusId ?? lens.focusId ?? null;
    },
    isLensAutoOpened: () => Boolean(timelineInstanceRef.current?._chronixLensAutoOpened),
    focusArticle: (articleId, opts = {}) => {
      mobileFocusedArticleIdRef.current = articleId;
      const tl = timelineInstanceRef.current;
      if (tl) tl._chronixLensAutoOpened = false;
      if (tl && articleId && isLensActive(tl)) {
        tl._selectedArticleId = articleId;
        const lens = tl._chronixLens;
        if (String(lens.pendingFocusId ?? '') !== String(articleId)) {
          centerLensOnArticle(tl, articleId);
        }
        return;
      }
      if (tl && articleId) {
        tl._selectedArticleId = articleId;
        const currentDensity = densityModeRef.current;
        const isCompact = currentDensity === 'compact';
        const isSmall = currentDensity === 'small';
        const isExpandableMode = isCompact || isSmall;
        const keepAllCompact = isCompact && Boolean(opts.keepCompact);
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
          const isCardOnScreenForTap = typeof cardLeft === 'number' && cardLeft >= 0 && cardRight <= canvasW;
          const isAlreadyVisible = art.isInView && (opts.fromCanvasTap ? isCardOnScreenForTap : (isCardInView && isIndicatorInView));

          // If not already comfortably visible in the canvas viewport, smoothly pan to center it.
          // Maintain user's existing zoom level and layout - never call fitDateRange which resets zoom.
          if (!isAlreadyVisible || opts.forceCenter) {
            const date = art.period?.from || art.data?.from || art.from;
            if (date) {
              const targetPad = isWide
                ? Math.max(100, (canvasW - 420) / 2)
                : Math.max(16, Math.round((canvasW - Math.min(cardWidth, canvasW - 32)) / 2));
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
          ...pickTimeFields(earliest.from),
        };
      }
    }

    // Sub-day zoom (hours/minutes) is opt-in per timeline: only when some date carries a time.
    const zoomMinimum = getZoomMinimumForTimeline(timelineData);

    const isToy = isToyThemeActive();
    const canvasFont = getCanvasFont(isToy);
    const articleStyle = getTimelineArticleStyle(isDark, isRtl);
    const laneHeaderBg = isToy ? (isDark ? '#1a2338' : '#fef08a') : (isDark ? '#161619' : '#f7f7f8');
    const laneTitleColor = isToy ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#f4f4f6' : '#27272a');
    const laneTitleFont = `${isToy ? 700 : 600} 11px ${canvasFont}`;
    const landscapeHeaderColor = isToy ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#f4f4f5' : '#09090b');
    const landscapeSubheaderColor = isToy ? (isDark ? '#b8c4d9' : '#0f172a') : (isDark ? '#a1a1aa' : '#71717a');
    const landscapeHeaderFont = `${isToy ? 700 : 600} 11.5px ${canvasFont}`;
    const landscapeSubheaderFont = `${isToy ? 700 : 500} 10px ${canvasFont}`;

    try {
      const options = {
        width,
        height,
        initialDate,
        zoom: {
          minimum: zoomMinimum,
        },
        image: {
          maxConcurrent: 4,
        },
        disableBranding: true,
        enableUserControl: true,
        enableCursor: true,
        verticalOffset: 42,
        style: {
          mainLine: {
            visible: true,
            size: 5,
            ...(isToy && isDark ? { color: '#2c3a58', opacity: 1 } : {}),
          },
          draggingHighlight: {
            visible: false,
          },
          dateLabel: {
            minor: {
              color: isToy ? (isDark ? '#9aa7bf' : '#1e293b') : (isDark ? '#a1a1aa' : '#71717a'),
              font: `${isToy ? 600 : 500} 10px ${canvasFont}`,
            },
            major: {
              color: isToy ? (isDark ? '#fde68a' : '#0f172a') : (isDark ? '#f4f4f5' : '#09090b'),
              font: `${isToy ? 700 : 600} 12px ${canvasFont}`,
            }
          },
          marker: {
            minor: {
              height: 7,
              color: isToy ? (isDark ? '#3d4a6b' : '#334155') : (isDark ? '#71717a' : '#a1a1aa'),
            },
            major: {
              height: 14,
              color: isToy ? (isDark ? '#fbbf24' : '#0f172a') : (isDark ? '#a1a1aa' : '#52525b'),
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
              backgroundColor: laneHeaderBg,
            },
            body: {
              backgroundColor: 'transparent',
              borderColor: isDark ? 'rgba(42, 42, 47, 0.6)' : 'rgba(228, 228, 231, 0.8)',
            },
            title: {
              color: laneTitleColor,
              font: laneTitleFont,
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
            backgroundColor: isToy ? (isDark ? '#212c45' : '#f0f9ff') : (isDark ? '#1f1f23' : '#ffffff'),
            border: {
              width: isToy ? 2.6 : 1.8,
            },
            shadow: {
              x: 0,
              y: isToy ? 0 : 6,
              amount: isToy ? 0 : 14,
              color: isToy ? 'rgba(0, 0, 0, 0)' : (isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)'),
            }
          },
          defaultActiveStyle: {
            backgroundColor: isToy ? (isDark ? '#283552' : '#fef9c3') : (isDark ? '#27272a' : '#f4f4f5'),
            border: {
              width: isToy ? 3 : 2.5,
            }
          },
          layoutStyles: {
            landscape: {
              style: {
                width: LANDSCAPE_CARD_WIDTH,
                header: {
                  text: {
                    color: landscapeHeaderColor,
                    font: landscapeHeaderFont,
                    margin: 6,
                    lineHeight: 15,
                    numberOfLines: 10,
                  }
                },
                subheader: {
                  text: {
                    color: landscapeSubheaderColor,
                    font: landscapeSubheaderFont,
                    margin: 6,
                    lineHeight: 13,
                  }
                }
              },
              hoverStyle: {
                header: {
                  text: {
                    color: landscapeHeaderColor,
                    font: landscapeHeaderFont,
                  }
                }
              },
              activeStyle: {
                header: {
                  text: {
                    color: landscapeHeaderColor,
                    font: landscapeHeaderFont,
                  }
                },
                subheader: {
                  text: {
                    color: landscapeSubheaderColor,
                    font: landscapeSubheaderFont,
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
      window.__chronixLanguage = language;
      timeline._chronixCardMode = densityMode;
      timeline._chronixCanEditImage = typeof onImagePositionChangeRef.current === 'function';
      timeline._chronixOnLensFocus = (id) => {
        if (timelineInstanceRef.current === timeline) reportLensFocus(id);
      };
      timeline._chronixImageLabels = {
        done: t('common.confirm'),
        drag: t('eventDrawer.dragImageToPosition'),
      };
      timeline._chronixLaneResizeLabel = t('legend.resizeLanes');
      timeline._chronixOnPersistLaneWeights = (weights) => {
        savedLaneWeightsRef.current = weights && weights.size > 0
          ? { timelineId: timelineData?.id, weights: new Map(weights) }
          : null;
      };
      timeline._chronixManualLaneWeights =
        savedLaneWeightsRef.current && savedLaneWeightsRef.current.timelineId === timelineData?.id
          ? new Map(savedLaneWeightsRef.current.weights)
          : null;
      trackNaturalImageAspects(timeline);

      if (savedViewport && savedViewport.timelineId === timelineData?.id && savedViewport.zoom != null && typeof timeline.setZoom === 'function') {
        try {
          timeline.setZoom(savedViewport.zoom);
        } catch (e) { }
      }

      // Ensure narrative anchors (chronologically earliest & latest events) remain visible
      // in density-bucketed viewports so the timeline never feels like it starts in the middle.
      // Also restore chronological order before density-bucket selection so equal-rank ties
      // are broken chronologically rather than by previous row order.
      const originalUpdateVisibleArticlesOfGroups = timeline.updateVisibleArticlesOfGroups;
      if (typeof originalUpdateVisibleArticlesOfGroups === 'function') {
        timeline.updateVisibleArticlesOfGroups = function (drawCycleContext) {
          if (Array.isArray(this.articles)) {
            this.articles.sort(compareChronologicalStackOrder);
          }
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
      timeline._chronixLensDisabled = Boolean(forceDesktopCanvasRef.current);
      timeline._isNarrowViewport = Boolean(isNarrowViewportRef.current && !forceDesktopCanvasRef.current);
      timeline._isMapEventCardVisible = isMapEventCardVisibleRef.current;
      if (typeof timeline.registerCardLayout === 'function') {
        try {
          timeline.registerCardLayout(circleCardLayout);
        } catch (e) { }
      }
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
                  backgroundColor: laneHeaderBg,
                },
                body: {
                  backgroundColor: 'transparent',
                },
                title: {
                  color: laneTitleColor,
                  font: laneTitleFont,
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
            Object.assign(fromObj, pickTimeFields(tb.from));

            const toObj = {
              year: tb.to?.year ?? tb.to_year ?? fromObj.year,
              precision: tb.to?.precision || tb.precision || fromObj.precision,
            };
            if (tb.to?.month != null) toObj.month = tb.to.month;
            if (tb.to?.day != null) toObj.day = tb.to.day;
            Object.assign(toObj, pickTimeFields(tb.to));

            return {
              id: tb.id,
              title: tb.title,
              from: toHistropediaDate(fromObj),
              to: toHistropediaDate(toObj),
              style: {
                background: formatBandBg(tb.color, isDark),
                text: {
                  color: isDark ? '#f4f4f5' : '#3f3f46',
                  font: `${isToy ? 700 : 600} 10px ${canvasFont}`,
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

        const formattedArticles = spreadPrehistoricClusterDates(
          timelineData.articles.map((art, artIdx) => {
            const laneColor = resolveArticleDisplayColor(art, artIdx, isDark, timelineData, themeCategories, colorByTheme);
            const isAnchor = anchorArticleIds.has(String(art.id));

            return {
              ...art,
              id: art.id,
              _chronixOrder: artIdx,
              title: mathToPlainText(art.title),
              subtitle: mathToPlainText(art.subtitle || ''),
              // Unflattened copies: the focus card typesets their formulas (see wrapLensRichText).
              richTitle: art.title || '',
              richSubtitle: art.subtitle || '',
              lane: art.lane,
              from: toHistropediaDate(art.from),
              to: art.to ? toHistropediaDate(art.to) : undefined,
              isToPresent: art.isToPresent || false,
              rawImageUrl: art.imageUrl || undefined,
              imageUrl: getCanvasImageUrl(art.imageUrl) || undefined,
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
              extractIsCustom: Boolean(art.extractIsCustom),
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
          })
        );

        // Defer image fetches until the first live frame so synchronous StrictMode/layout
        // setup never fires throwaway requests that immediately get aborted.
        timeline._chronixDeferImageEnqueue = true;
        timeline.load(formattedArticles);
        if (timeline.articles) {
          let layoutChanged = false;
          timeline.articles.forEach((artInstance, idx) => {
            const src = formattedArticles[idx];
            if (src) {
              artInstance._chronixOrder = typeof src._chronixOrder === 'number' ? src._chronixOrder : idx;
              if (src.mediaType) artInstance.mediaType = src.mediaType;
              if (src.rawImageUrl) artInstance.rawImageUrl = src.rawImageUrl;
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

        if (isToyThemeActive()) {
          updateTimelineTheme(timeline, isDark, timelineData, isRtl);
        }

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

        if (typeof requestAnimationFrame === 'function') {
          timeline._chronixInitFrame = requestAnimationFrame(() => {
            timeline._chronixInitFrame = null;
            if (timeline._chronixDisposed) return;
            timeline._chronixDeferImageEnqueue = false;
            timeline.requestRedraw?.(timeline.defaultRedraw || timeline.redraw);
          });
        } else {
          timeline._chronixDeferImageEnqueue = false;
          timeline.redraw();
        }

        // Fit articles in view
        timeline._chronixInitFitTimer = setTimeout(() => {
          timeline._chronixInitFitTimer = null;
          if (timeline._chronixDisposed) return;
          try {
            fitAllArticles(timeline, 70);
            if (applyLensOpeningView(timeline)) {
              lastFitRef.current = null;
              return;
            }
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
        timeline._chronixArticleClickedInGesture = true;
        clearLaneHighlight(timeline);
        // A long press already opened the drawer for this gesture; ignore the
        // click that fires on release so we don't reprocess it as a tap.
        if (longPressConsumedRef.current) {
          return;
        }

        const clickedId = article?.id || article?.data?.id;
        if (!clickedId) return;

        // If the user clicked specifically on a visible star icon on canvas
        if (article.isMouseOverStar) {
          const wasStarred = Boolean(starredArticleIdsRef.current?.has?.(clickedId));
          const wasAlreadyFocused = isSameArticleId(mobileFocusedArticleIdRef.current, clickedId);
          const starWasVisible = !isNarrowViewportRef.current || isLensActive(timelineInstanceRef.current) || wasStarred || wasAlreadyFocused;
          if (starWasVisible) {
            onToggleStarRef.current?.(clickedId, article.isStarred);
            return;
          }
          article.isStarred = wasStarred;
          article.isMouseOverStar = false;
        }

        // Focus lens: tapping any event glides it under the lens; tapping the focus card opens it.
        const lensTl = timelineInstanceRef.current;
        if (lensTl) lensTl._chronixLensAutoOpened = false;
        if (isLensActive(lensTl)) {
          const lens = lensTl._chronixLens;
          const lensId = String(clickedId);
          if (article._lensNavHit && article._lens && (article._lens.tier === 'focus' || article._lens.tier === 'focusRow')) {
            const direction = article._lensNavHit === 'prev' ? -1 : 1;
            article._lensNavHit = null;
            stepLensFocus(lensTl, direction);
            return;
          }
          const original = timelineData?.articles?.find((a) => isSameArticleId(a.id, clickedId)) || article.data || article;
          const isFocus = lensId === String(lens.pendingFocusId ?? lens.focusId ?? '')
            && article._lens && (article._lens.tier === 'focus' || article._lens.tier === 'focusRow');
          lensTl._selectedArticleId = clickedId;
          mobileFocusedArticleIdRef.current = clickedId;
          if (isFocus) {
            lensTl.redraw();
            onSelectArticle?.(original, { fromUserClick: true });
            return;
          }
          centerLensOnArticle(lensTl, clickedId);
          reportLensFocus(clickedId);
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
              const baseLayout = isSmall ? 'landscape' : 'compact';
              tl.articles.forEach((a) => {
                const isMatch = isSameArticleId(a.id, clickedId);
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
          } catch (e) { }
          if (typeof tl.defaultRedraw === 'function') {
            tl.defaultRedraw();
          } else {
            tl.redraw();
          }
        }

        // Tap 1: On mobile portrait (including "Classic" full-timeline mode) or in compact/small
        // mode on any viewport: first tap brings the event to the foreground (focus) and syncs the
        // map pin without opening the details drawer; second tap on that focused card opens details.
        // A long press (handled separately) opens details directly.
        if (isNarrowViewportRef.current || isExpandableMode) {
          if (!alreadyFocused) {
            const original = timelineData?.articles?.find((a) => isSameArticleId(a.id, clickedId));
            onFocusArticleRef.current?.(original || article.data || article, { fromCanvasTap: true });
            return;
          }
        }

        if (onSelectArticleRef.current) {
          const original = timelineData.articles?.find((a) => isSameArticleId(a.id, clickedId));
          onSelectArticleRef.current(original || article.data || article, { fromUserClick: true });
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
      // Focus lens: remember which event was focused when the finger went down, so a
      // short swipe steps from it (rather than from whatever the drag passed over).
      timeline.on('viewport-drag-start', () => {
        timeline._chronixLensAutoOpened = false;
        if (!isLensActive(timeline)) return;
        const lens = timeline._chronixLens;
        lens.swipeOriginId = lens.pendingFocusId ?? lens.focusId ?? null;
      });
      // Focus lens: a short swipe moves one event; a long swipe pans (with momentum)
      // and, once it settles, snaps the nearest event under the lens.
      timeline.on('viewport-drag-end', (payload) => {
        if (timeline._chronixTapAssistGesture) {
          // A tap that the engine saw as a tiny drag: no swipe step, snap or fling.
          timeline._chronixTapAssistGesture = false;
          timeline.dragMomentumSamples = [];
          const lens = timeline._chronixLens;
          if (lens) lens.swipeOriginId = null;
          return;
        }
        if (!isLensActive(timeline)) return;
        if (handleLensSwipeEnd(timeline, payload?.totalDx)) return;
        const lens = timeline._chronixLens;
        const token = (lens.snapToken || 0) + 1;
        lens.snapToken = token;
        const waitForRest = (attempt) => {
          if (lens.snapToken !== token || timelineInstanceRef.current !== timeline) return;
          const isZoomAnimating = Boolean(timeline.isZooming || timeline.animation?.pinchZoom || timeline.animation?.zoom || timeline.animation?.wheelZoomFrame != null);
          if ((timeline.isPanning || timeline.isDragging || timeline.isPinching || isZoomAnimating) && attempt < 60) {
            setTimeout(() => waitForRest(attempt + 1), 60);
            return;
          }
          if (timeline.isDragging || timeline.isPinching) return;
          snapLensToNearest(timeline);
        };
        setTimeout(() => waitForRest(0), 40);
      });
      timeline.on('zoom', () => {
        timeline._chronixLensAutoOpened = false;
        clearLaneHighlight(timeline);
      });
      timeline.on('zoom-pinch-start', () => {
        timeline._chronixLensAutoOpened = false;
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

    // Histropedia only reports a click when the pointer ends within 2px of where it
    // started. A finger always jitters more than that, so on touch screens a tap on an
    // event was often treated as a tiny drag instead: no click, and the focus lens then
    // stepped/snapped to another event. We track taps ourselves and deliver the click
    // whenever the engine will not (the finger moved >2px but stayed within a tap slop).
    const TAP_SLOP_PX = 12;
    const ENGINE_CLICK_TOLERANCE_PX = 2;
    let tapAssist = null;

    const deliverAssistedTap = (assist) => {
      const tl = timelineInstanceRef.current;
      if (!tl || !tl.canvas || tl.isPinching) return;
      const article = Array.isArray(tl.articles)
        ? tl.articles.find((a) => a && String(a.id) === assist.articleId)
        : null;
      if (!article) return;
      const rect = tl.canvas.getBoundingClientRect();
      const pos = { left: assist.x - rect.left, top: assist.y - rect.top };
      try {
        tl.select(article.id);
        article.clicked(pos);
      } catch (err) { /* ignore */ }
      tl.trigger('article-click', article, assist.upEvent);
      tl.redraw();
    };

    const onCanvasPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      clearLongPressTimer();
      longPressConsumedRef.current = false;
      const { clientX, clientY } = e;
      const hitOnDown = findArticleAtPoint(clientX, clientY);
      backgroundTapStart = hitOnDown ? null : { x: clientX, y: clientY };

      const tlForTap = timelineInstanceRef.current;
      if (tlForTap) {
        tlForTap._chronixTapAssistGesture = false;
        tlForTap._chronixArticleClickedInGesture = false;
      }
      if (tapAssist && tapAssist.pointerId !== e.pointerId && Date.now() - tapAssist.t < 3000) {
        tapAssist.cancelled = true;
      } else {
        const tapHit = e.pointerType !== 'mouse' || isNarrowViewportRef.current
          ? hitOnDown
          : null;
        tapAssist = tapHit
          ? { pointerId: e.pointerId, x: clientX, y: clientY, t: Date.now(), articleId: String(tapHit.id), cancelled: false }
          : null;
      }

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
          if (onSelectArticleRef.current) {
            const original = timelineData.articles?.find((a) => isSameArticleId(a.id, id));
            onSelectArticleRef.current(original || hit.data || hit, { fromUserClick: true });
          }
        }, LONG_PRESS_MS);
      }
    };

    const onCanvasPointerMove = (e) => {
      if (
        tapAssist && !tapAssist.cancelled && e.pointerId === tapAssist.pointerId &&
        (Math.abs(e.clientX - tapAssist.x) > TAP_SLOP_PX || Math.abs(e.clientY - tapAssist.y) > TAP_SLOP_PX)
      ) {
        tapAssist.cancelled = true;
      }
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

      if (tapAssist && e.pointerId === tapAssist.pointerId) {
        const assist = tapAssist;
        tapAssist = null;
        const movedPastEngineTolerance =
          Math.abs(e.clientX - assist.x) > ENGINE_CLICK_TOLERANCE_PX ||
          Math.abs(e.clientY - assist.y) > ENGINE_CLICK_TOLERANCE_PX;
        const withinSlop =
          Math.abs(e.clientX - assist.x) <= TAP_SLOP_PX &&
          Math.abs(e.clientY - assist.y) <= TAP_SLOP_PX;
        const tlForTap = timelineInstanceRef.current;
        if (
          tlForTap && !assist.cancelled && !longPressConsumedRef.current &&
          movedPastEngineTolerance && withinSlop && !tlForTap.isPinching
        ) {
          // Lets 'viewport-drag-end' (fired by the engine right after this) ignore the jitter.
          tlForTap._chronixTapAssistGesture = true;
          assist.upEvent = e;
          setTimeout(() => deliverAssistedTap(assist), 0);
        }
      }

      const tapStart = backgroundTapStart;
      backgroundTapStart = null;
      const tl = timelineInstanceRef.current;
      if (!tl || !tapStart || longPressConsumedRef.current || tl._chronixArticleClickedInGesture) return;
      const tapTolerance = isNarrowViewportRef.current ? 28 : 14;
      if (
        Math.abs(e.clientX - tapStart.x) > tapTolerance ||
        Math.abs(e.clientY - tapStart.y) > tapTolerance
      ) return;

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
        onSelectArticleRef.current?.(null);
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
      tapAssist = null;
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

    // Focus-card photo positioning. Window capture runs before Histropedia's own canvas and
    // window listeners, so these gestures never pan the timeline or open the drawer.
    let photoDrag = null;
    const redrawTimeline = (tl) => {
      if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
      else tl.redraw?.();
    };
    const getFocusPhotoArticle = (tl) => {
      const focusId = tl?._chronixLens?.focusId;
      if (focusId == null || !isLensActive(tl) || !Array.isArray(tl.articles)) return null;
      return tl.articles.find((a) => a && String(a.id) === String(focusId) && a._lens?.tier === 'focus') || null;
    };
    const swallow = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    const onPhotoPointerDown = (e) => {
      const tl = timelineInstanceRef.current;
      if (!tl?.canvas || e.target !== tl.canvas || !tl._chronixCanEditImage) return;
      if (e.button !== undefined && e.button !== 0) return;
      const art = getFocusPhotoArticle(tl);
      const imageRect = art && getLensImageRect(art);
      if (!imageRect) return;
      const lens = tl._chronixLens;
      const positioning = lens.positioningId === String(art.id);
      const canvasRect = tl.canvas.getBoundingClientRect();
      const px = e.clientX - canvasRect.left;
      const py = e.clientY - canvasRect.top;
      const box = getLensMoveButtonBox(art, positioning);
      if (box && px >= box.x - 6 && px <= box.x + box.w + 6 && py >= box.y - 6 && py <= box.y + box.h + 6) {
        swallow(e);
        lens.positioningId = positioning ? null : String(art.id);
        photoDrag = { pointerId: e.pointerId, buttonOnly: true };
        redrawTimeline(tl);
        return;
      }
      if (!positioning) return;
      if (px < imageRect.x || px > imageRect.x + imageRect.w || py < imageRect.y || py > imageRect.y + imageRect.h) return;
      swallow(e);
      const img = getLensPhoto(art, { load: false })?.img || (art.imageLoaded ? art.image : null);
      const natW = img?.naturalWidth || img?.width || 0;
      const natH = img?.naturalHeight || img?.height || 0;
      if (!natW || !natH) return;
      const coverScale = Math.max(imageRect.w / natW, imageRect.h / natH);
      const startValue = (value) => (Number.isFinite(Number(value)) ? Number(value) : 50);
      photoDrag = {
        tl,
        art,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: { x: startValue(art.data?.imagePositionX), y: startValue(art.data?.imagePositionY) },
        overflowX: natW * coverScale - imageRect.w,
        overflowY: natH * coverScale - imageRect.h,
        moved: false,
      };
    };
    const onPhotoPointerMove = (e) => {
      if (!photoDrag || e.pointerId !== photoDrag.pointerId) return;
      swallow(e);
      if (photoDrag.buttonOnly) return;
      const { art, startPos, overflowX, overflowY } = photoDrag;
      const clampPct = (value) => Math.min(100, Math.max(0, value));
      const dx = e.clientX - photoDrag.startX;
      const dy = e.clientY - photoDrag.startY;
      const x = overflowX > 0 ? clampPct(startPos.x - (dx / overflowX) * 100) : startPos.x;
      const y = overflowY > 0 ? clampPct(startPos.y - (dy / overflowY) * 100) : startPos.y;
      if (x === art.data.imagePositionX && y === art.data.imagePositionY) return;
      art.data.imagePositionX = x;
      art.data.imagePositionY = y;
      photoDrag.moved = true;
      redrawTimeline(photoDrag.tl);
    };
    const onPhotoPointerUp = (e) => {
      if (!photoDrag || e.pointerId !== photoDrag.pointerId) return;
      swallow(e);
      const { art, moved } = photoDrag;
      photoDrag = null;
      if (moved) {
        onImagePositionChangeRef.current?.(art.id, {
          x: Math.round(art.data.imagePositionX * 10) / 10,
          y: Math.round(art.data.imagePositionY * 10) / 10,
        });
      }
    };
    window.addEventListener('pointerdown', onPhotoPointerDown, true);
    window.addEventListener('pointermove', onPhotoPointerMove, true);
    window.addEventListener('pointerup', onPhotoPointerUp, true);
    window.addEventListener('pointercancel', onPhotoPointerUp, true);

    // Focus-card description scrolling (long descriptions that don't fit the card).
    // A mostly-vertical drag over the text scrolls it; horizontal swipes, taps and
    // gestures elsewhere keep working as before.
    let textDrag = null;
    const getFocusTextArticle = (tl) => {
      const art = getFocusPhotoArticle(tl);
      return art?._lensSubRect && art._lensSubRect.maxScroll > 0 ? art : null;
    };
    const isInsideSubRect = (tl, e, art) => {
      const r = art._lensSubRect;
      const canvasRect = tl.canvas.getBoundingClientRect();
      const px = e.clientX - canvasRect.left;
      const py = e.clientY - canvasRect.top;
      return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    };
    const onTextPointerDown = (e) => {
      const tl = timelineInstanceRef.current;
      if (!tl?.canvas || e.target !== tl.canvas) return;
      if (e.button !== undefined && e.button !== 0) return;
      const art = getFocusTextArticle(tl);
      if (!art || !isInsideSubRect(tl, e, art)) return;
      textDrag = {
        tl,
        art,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startScroll: art._lensSubScroll || 0,
        active: false,
      };
    };
    const onTextPointerMove = (e) => {
      if (!textDrag || e.pointerId !== textDrag.pointerId) return;
      const dx = e.clientX - textDrag.startX;
      const dy = e.clientY - textDrag.startY;
      if (!textDrag.active) {
        if (Math.abs(dy) < 6 || Math.abs(dy) < Math.abs(dx)) return;
        textDrag.active = true;
      }
      const { art, tl, startScroll } = textDrag;
      const maxScroll = art._lensSubRect?.maxScroll || 0;
      const next = Math.min(maxScroll, Math.max(0, startScroll - dy));
      if (next === art._lensSubScroll) return;
      art._lensSubScroll = next;
      redrawTimeline(tl);
    };
    const onTextPointerEnd = (e) => {
      if (textDrag && e.pointerId === textDrag.pointerId) textDrag = null;
    };
    const onTextWheel = (e) => {
      const tl = timelineInstanceRef.current;
      if (!tl?.canvas || e.target !== tl.canvas) return;
      const art = getFocusTextArticle(tl);
      if (!art || !isInsideSubRect(tl, e, art)) return;
      const maxScroll = art._lensSubRect.maxScroll;
      const current = art._lensSubScroll || 0;
      const next = Math.min(maxScroll, Math.max(0, current + e.deltaY));
      // At either end, let the wheel fall through to the timeline as usual.
      if (next === current) return;
      swallow(e);
      art._lensSubScroll = next;
      redrawTimeline(tl);
    };
    window.addEventListener('pointerdown', onTextPointerDown, true);
    window.addEventListener('pointermove', onTextPointerMove, true);
    window.addEventListener('pointerup', onTextPointerEnd, true);
    window.addEventListener('pointercancel', onTextPointerEnd, true);
    window.addEventListener('wheel', onTextWheel, { capture: true, passive: false });

    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    const onCanvasContextMenu = (e) => {
      if (isNarrowViewportRef.current) {
        e.preventDefault();
      }
    };

    if (canvasEl) {
      canvasEl.addEventListener('wheel', onCanvasWheel, { passive: true });
      canvasEl.addEventListener('pointerdown', onCanvasPointerDown);
      canvasEl.addEventListener('pointermove', onCanvasPointerMove);
      canvasEl.addEventListener('pointerup', onCanvasPointerUp);
      canvasEl.addEventListener('pointercancel', onCanvasPointerCancel);
      canvasEl.addEventListener('contextmenu', onCanvasContextMenu);
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
            date: { year: startVal.year, month: startVal.month || 1, day: startVal.day || 1, ...pickTimeFields(startVal) },
            zoom: zoomVal
          };
        }
      }
      window.removeEventListener('pointerdown', onPhotoPointerDown, true);
      window.removeEventListener('pointermove', onPhotoPointerMove, true);
      window.removeEventListener('pointerup', onPhotoPointerUp, true);
      window.removeEventListener('pointercancel', onPhotoPointerUp, true);
      window.removeEventListener('pointerdown', onTextPointerDown, true);
      window.removeEventListener('pointermove', onTextPointerMove, true);
      window.removeEventListener('pointerup', onTextPointerEnd, true);
      window.removeEventListener('pointercancel', onTextPointerEnd, true);
      window.removeEventListener('wheel', onTextWheel, { capture: true });
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      window.removeEventListener('touchstart', handleGlobalPointerDown, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
      if (canvasEl) {
        canvasEl.removeEventListener('wheel', onCanvasWheel);
        canvasEl.removeEventListener('pointerdown', onCanvasPointerDown);
        canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
        canvasEl.removeEventListener('pointerup', onCanvasPointerUp);
        canvasEl.removeEventListener('pointercancel', onCanvasPointerCancel);
        canvasEl.removeEventListener('contextmenu', onCanvasContextMenu);
      }
      disposeTimelineResources(timelineInstanceRef.current);
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData]);

  const canEditImage = typeof onImagePositionChange === 'function';
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (!tl) return;
    tl._chronixCanEditImage = canEditImage;
    tl._chronixImageLabels = {
      done: t('common.confirm'),
      drag: t('eventDrawer.dragImageToPosition'),
    };
    if (!canEditImage && tl._chronixLens) tl._chronixLens.positioningId = null;
    if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
    else tl.redraw?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditImage, language, timelineData]);

  // Dismiss any temporary lane highlight indication whenever drawers, modals, selection, or filters change
  useEffect(() => {
    clearLaneHighlight(timelineInstanceRef.current);
  }, [hasRightDrawer, selectedArticleId, activeFilter]);

  // Handle theme changes in-place without tearing down the canvas or resetting the viewport
  useEffect(() => {
    if (prevThemeRef.current === theme && prevVisualThemeRef.current === visualTheme) return;
    prevThemeRef.current = theme;
    prevVisualThemeRef.current = visualTheme;
    window.__chronixVisualTheme = visualTheme;

    const timeline = timelineInstanceRef.current;
    if (!timeline || !timelineData) return;

    updateTimelineTheme(timeline, theme === 'dark', timelineData, isRtl);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        const tl = timelineInstanceRef.current;
        if (!tl) return;
        if (typeof tl.defaultRedraw === 'function') tl.defaultRedraw();
        else tl.redraw();
      }).catch(() => {});
    }
  }, [theme, visualTheme, timelineData, isRtl]);

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

    const prevLensDisabled = Boolean(timeline._chronixLensDisabled);
    const nextLensDisabled = Boolean(forceDesktopCanvas);
    const wasLensActive = isLensActive(timeline);
    const wasAutoOpened = Boolean(timeline._chronixLensAutoOpened);
    const wasFittedOverview = !wasLensActive && Boolean(
      lastFitRef.current
      && getViewSignature(timeline) === lastFitRef.current.signature
      && !selectedArticleIdRef.current
    );

    timeline._isNarrowViewport = Boolean(isNarrowViewport && !forceDesktopCanvas);
    timeline._chronixLensDisabled = nextLensDisabled;

    if (prevLensDisabled === nextLensDisabled) {
      timeline.redraw();
      return;
    }

    timeline.stopPanAnimation?.();
    syncFocusLensState(timeline);
    if (typeof timeline._updateLaneLayout === 'function') {
      timeline._updateLaneLayout();
    }

    if (nextLensDisabled) {
      // Switched from mobile Focus Lens -> full desktop timeline canvas
      timeline._chronixLensAutoOpened = false;
      if (wasLensActive && wasAutoOpened && Array.isArray(timeline.articles) && timeline.articles.length > 0) {
        mobileFocusedArticleIdRef.current = null;
        timeline._selectedArticleId = null;
        timeline.articles.forEach((art) => {
          if (art) art.isActive = false;
        });
        try {
          fitAllArticles(timeline, 70);
        } catch (e) { /* ignore */ }
      }
      rebalanceLaneHeights(timeline);
      if ((timeline._chronixCardMode || 'auto') === 'auto') {
        syncAutoCardLayouts(timeline);
      } else if (Array.isArray(timeline.articles)) {
        timeline.articles.forEach((art) => art?.invalidateCaches?.());
      }
      timeline._refreshAdaptiveArticleRuntimeOptions?.();
      if (typeof timeline.defaultRedraw === 'function') {
        timeline.defaultRedraw();
      } else {
        timeline.redraw();
      }
    } else {
      // Switched from full desktop timeline canvas -> mobile Focus Lens
      if (isLensActive(timeline)) {
        const focusTargetId = selectedArticleIdRef.current;
        if (focusTargetId != null) {
          centerLensOnArticle(timeline, focusTargetId, { duration: 0 });
          return;
        }
        if (wasFittedOverview && applyLensOpeningView(timeline)) {
          lastFitRef.current = null;
          return;
        }
      }
      if (typeof timeline.defaultRedraw === 'function') {
        timeline.defaultRedraw();
      } else {
        timeline.redraw();
      }
    }
  }, [isNarrowViewport, forceDesktopCanvas]);

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

  // Keep the geo map's pin filters synchronized with the timeline selection (both dimensions).
  useEffect(() => {
    const laneItems = laneFilterItems.filter((item) => activeLaneFilterIds.some((id) => String(id) === String(item.id)));
    const categoryItems = categoryFilterItems.filter((item) => activeCategoryFilterIds.some((id) => String(id) === String(item.id)));
    onFilterChange?.(laneItems, categoryItems);
  }, [activeLaneFilterIds, activeCategoryFilterIds, laneFilterItems, categoryFilterItems, onFilterChange]);

  // Lens cards format dates in the UI language; repaint when it changes.
  useEffect(() => {
    window.__chronixLanguage = language;
    const tl = timelineInstanceRef.current;
    if (tl && isLensActive(tl)) {
      (tl.articles || []).forEach((art) => { if (art) art._lensMeasure = null; });
      tl.redraw();
    }
  }, [language]);

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
          WebkitTouchCallout: 'none',
          userSelect: 'none',
        }}
      />
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;
