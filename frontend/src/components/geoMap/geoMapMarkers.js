// Pure helpers for GeoMapView's Leaflet pins (P-17 / P-24). Kept free of React and Leaflet so
// node:test can cover the HTML builders, the pin-state class toggles and the rebuild decision.
import { containsMath, mathToPlainText, normalizeMathInText } from '../../utils/mathUtils.js';

export const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Escaped text with **bold** / *italic* emphasis rendered (descriptions carry light Markdown).
export const escapeInlineMarkdown = (str) =>
  escapeHtml(str)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

const MATH_SEGMENT_SPLIT = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;

// Like escapeInlineMarkdown, but $...$ / $$...$$ formulas are typeset with KaTeX (always inline,
// so they flow inside the line-clamped popup description). Until KaTeX has been lazily loaded
// (`katex` null) formulas fall back to readable Unicode plain text.
export const renderInlineRichText = (str, katex = null) => {
  const normalized = normalizeMathInText(String(str || ''));
  return normalized
    .split(MATH_SEGMENT_SPLIT)
    .map((part, i) => {
      if (i % 2 === 0) {
        // normalizeMathInText protects currency as "&#36;" - keep it as an entity, not escaped text.
        return escapeInlineMarkdown(part).replace(/&amp;#36;/g, '&#36;');
      }
      if (katex) {
        const tex = part.startsWith('$$') ? part.slice(2, -2) : part.slice(1, -1);
        try {
          return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: false });
        } catch {
          // fall through to plain text
        }
      }
      return escapeHtml(mathToPlainText(part));
    })
    .join('');
};

export const textsNeedKatex = (...texts) => texts.some((text) => containsMath(String(text || '')));

// One shared in-flight/import result per loader; a failed import may be retried later.
export function createLazyModuleLoader(importer) {
  let value = null;
  let promise = null;
  return {
    get: () => value,
    load: () => {
      if (value) return Promise.resolve(value);
      if (!promise) {
        promise = Promise.resolve()
          .then(importer)
          .then((mod) => {
            value = mod?.default ?? mod;
            return value;
          })
          .catch((err) => {
            promise = null;
            throw err;
          });
      }
      return promise;
    },
  };
}

// Selected / hovered visual state of a pin, per element. Applied both when the icon HTML is built
// and when only the selection or hover changes (so those never rebuild the markers).
const PIN_STATE_VARIANTS = {
  root: { selected: 'z-50', hovered: 'z-40', idle: 'z-10' },
  pin: { selected: 'scale-125', hovered: 'scale-130', idle: 'group-hover:scale-115' },
  circle: {
    selected: 'border-accent ring-4 ring-accent-ring/40',
    hovered: 'border-accent ring-4 ring-accent-ring/60 shadow-glow-accent',
    idle: 'border-surface-raised',
  },
  tip: { selected: 'border-accent bg-accent', hovered: 'border-accent bg-accent', idle: 'border-surface-raised' },
  // The hover bubble is forced open only for a hovered pin that isn't the selected one.
  tooltip: { selected: 'hidden group-hover:flex', hovered: 'flex', idle: 'hidden group-hover:flex' },
};

const PIN_PART_SELECTORS = {
  root: '[data-pin-article-id]',
  pin: '.chronix-map-pin',
  circle: '.chronix-pin-circle',
  tip: '.chronix-pin-tip',
  tooltip: '.chronix-pin-hover-tooltip',
};

const pinVariantKey = (isSelected, isHovered) => (isSelected ? 'selected' : (isHovered ? 'hovered' : 'idle'));

export function getPinStateClasses(isSelected, isHovered) {
  const key = pinVariantKey(isSelected, isHovered);
  const out = {};
  for (const [part, variants] of Object.entries(PIN_STATE_VARIANTS)) out[part] = variants[key];
  return out;
}

const ALL_PART_TOKENS = Object.fromEntries(
  Object.entries(PIN_STATE_VARIANTS).map(([part, variants]) => [
    part,
    [...new Set(Object.values(variants).flatMap((v) => v.split(' ')))],
  ])
);

// Swaps only the state classes on an already-rendered pin (O(1) per pin, no innerHTML).
export function applyPinStateClasses(markerEl, isSelected, isHovered) {
  if (!markerEl || typeof markerEl.querySelector !== 'function') return false;
  const classes = getPinStateClasses(isSelected, isHovered);
  let touched = false;
  for (const [part, selector] of Object.entries(PIN_PART_SELECTORS)) {
    const el = markerEl.querySelector(selector);
    if (!el) continue;
    el.classList.remove(...ALL_PART_TOKENS[part]);
    el.classList.add(...classes[part].split(' '));
    touched = true;
  }
  return touched;
}

const CALENDAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-[3px] text-ink-subtle"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const PIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-[3px] text-ink-subtle"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

// Divicon HTML for one event pin (+ the desktop hover bubble). The bubble's thumbnail is NOT in
// this string: it is injected by ensurePinTooltipImage when the bubble is first shown, so base64
// data: URLs never go through innerHTML or escapeHtml.
export function buildPinIconHtml({
  articleId,
  title = '',
  yearStr = '',
  locationName = '',
  eventNumber,
  laneColor,
  titleDir = 'ltr',
  isSelected = false,
  isHovered = false,
  showTooltip = true,
  spreadSlot = null,
  animateSpread = false,
}) {
  const cls = getPinStateClasses(isSelected, isHovered);
  const safeId = escapeHtml(articleId);
  const color = escapeHtml(laneColor);
  const spreadStyle = animateSpread && spreadSlot
    ? ` style="--spread-from-x: ${(-spreadSlot.x).toFixed(1)}px; --spread-from-y: ${(-spreadSlot.y).toFixed(1)}px;"`
    : '';
  const tip = spreadSlot
    ? ''
    : `<div class="chronix-pin-tip absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b pointer-events-none ${cls.tip}" style="background-color: ${color};"></div>`;
  const tooltip = showTooltip
    ? `<div dir="${titleDir}" class="chronix-pin-hover-tooltip ${cls.tooltip} absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-max max-w-[380px] p-1.5 rounded-md bg-surface-raised text-ink shadow-pop pointer-events-none border items-center gap-2 animate-in fade-in zoom-in-90 duration-150 z-50" style="border-color: ${color};">
            <span class="flex flex-col min-w-0 px-0.5 gap-0.5">
              <span class="text-xs font-semibold leading-snug break-words line-clamp-3" dir="${titleDir}">${escapeHtml(mathToPlainText(title))}</span>
              ${yearStr ? `<span class="flex items-start gap-1 min-w-0 text-[11px] font-medium leading-snug text-ink-muted">${CALENDAR_SVG}<span class="min-w-0 break-words" dir="auto">${escapeHtml(yearStr)}</span></span>` : ''}
              ${locationName ? `<span class="flex items-start gap-1 min-w-0 text-[11px] font-medium leading-snug text-ink-muted">${PIN_SVG}<span class="min-w-0 break-words" dir="auto">${escapeHtml(locationName)}</span></span>` : ''}
            </span>
          </div>`
    : '';
  return `
        <div class="group relative flex items-center justify-center cursor-pointer ${cls.root}${animateSpread ? ' chronix-pin-spread-enter' : ''}" data-pin-article-id="${safeId}"${spreadStyle}>
        <div class="chronix-map-pin relative flex items-center justify-center transition-transform duration-200 ${cls.pin}">
          <div class="chronix-pin-circle relative w-8 h-8 rounded-full shadow-md flex items-center justify-center border-2 pointer-events-none transition-all duration-150 ${cls.circle}" style="background-color: ${color};">
            <span class="text-caption font-bold text-white leading-none">${escapeHtml(eventNumber)}</span>
          </div>
          ${tip}
        </div>
          ${tooltip}
        </div>
      `;
}

export const PIN_TOOLTIP_IMG_CLASS = 'w-[54px] h-[54px] rounded shrink-0 object-cover bg-white';

// Adds the hover bubble's thumbnail the first time the bubble can become visible.
export function ensurePinTooltipImage(markerEl, imageUrl, posX, posY) {
  if (!markerEl || !imageUrl || typeof markerEl.querySelector !== 'function') return false;
  const tooltip = markerEl.querySelector('.chronix-pin-hover-tooltip');
  if (!tooltip || tooltip.querySelector('img[data-chronix-pin-img]')) return false;
  const img = tooltip.ownerDocument.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.className = PIN_TOOLTIP_IMG_CLASS;
  img.style.objectPosition = `${Number(posX ?? 50)}% ${Number(posY ?? 50)}%`;
  img.setAttribute('data-hide-on-error', 'self');
  img.setAttribute('data-chronix-pin-img', '');
  img.src = imageUrl;
  tooltip.insertBefore(img, tooltip.firstChild);
  return true;
}

// Popup cards render their <img> without a src; this sets it as a DOM property after opening.
export function hydratePopupImage(popupEl, imageUrl) {
  if (!popupEl || !imageUrl || typeof popupEl.querySelector !== 'function') return false;
  const img = popupEl.querySelector('img[data-chronix-popup-img]');
  if (!img || img.getAttribute('src')) return false;
  img.src = imageUrl;
  return true;
}

// Starred ids only shape the markers while the starred-only filter is on; otherwise a star toggle
// (which hands us a fresh Set) must not invalidate the filtered list.
export const getEffectiveStarredIds = (filterStarredOnly, starredArticleIds) =>
  (filterStarredOnly && starredArticleIds ? starredArticleIds : null);

// Every input that changes a pin's DOM, position or stack layout. Selection is deliberately absent
// except through `selectedStackKey` (selecting into a collapsed stack must fan it out).
export function getMarkerBuildDeps({
  filteredGeoArticles,
  categories,
  selectedStackKey = null,
  expandedStackKey = null,
  isMobile,
  isRtl,
  language,
  isDark,
  isToy,
  hasNavigation,
  visibleEventCount,
}) {
  return [
    filteredGeoArticles,
    categories,
    selectedStackKey,
    expandedStackKey,
    Boolean(isMobile),
    Boolean(isRtl),
    language,
    Boolean(isDark),
    Boolean(isToy),
    Boolean(hasNavigation),
    visibleEventCount,
  ];
}

export const shouldRebuildMarkers = (prevDeps, nextDeps) =>
  !prevDeps
  || prevDeps.length !== nextDeps.length
  || prevDeps.some((dep, i) => !Object.is(dep, nextDeps[i]));

// Stacks bigger than `ringMax` collapse into a count pin; maps each member id to its stack key.
export function getCollapsibleStackKeyById(groups, ringMax) {
  const map = new Map();
  for (const group of groups) {
    if (group.members.length <= ringMax) continue;
    for (const m of group.members) map.set(String(m.id), group.key);
  }
  return map;
}
