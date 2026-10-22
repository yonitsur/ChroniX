// Shared Lane & Topic Colors & Utilities for ChroniX
// Lanes (timeline tracks) and topics (categories) intentionally use SEPARATE palettes so the
// two dimensions stay visually distinguishable wherever they appear together (badges, dropdowns,
// map pins): lanes get a muted, neutral "stone" palette (structural axis), topics keep the vivid
// curated museum palette (the color-coding axis) further down this file (CATEGORY_PALETTE).

// Unified architectural tone for lanes (timeline tracks) - lanes share a single cohesive
// styling and are not split into different colors, reserving chromatic coding exclusively
// for categories / topics (CATEGORY_PALETTE).
export const DEFAULT_LANE_COLORS = [
  '#2563a2', // Brand Prussian Blue / Architectural Accent
];

export const TOY_LANE_COLORS = [
  '#0ea5e9', // Toy Sky Blue
  '#a855f7', // Toy Grape Purple
  '#22c55e', // Toy Grass Green
  '#f59e0b', // Toy Sunny Amber
];

// Vibrant archival palette for categories & themes - used in BOTH light and dark mode
// (topic colors intentionally do not shift with theme, unlike lanes).
export const CATEGORY_PALETTE = [
  '#b84a39', // Warm Terracotta / Venetian Red
  '#24657a', // Mineral Petrol / Teal
  '#b87326', // Burnished Ochre / Byzantine Amber
  '#6e395e', // Muted Mulberry / Imperial Plum
  '#2e6b56', // Antique Cypress / Deep Sage
  '#2b5278', // Prussian Navy / Lapis Lazuli
  '#8c3a48', // Rosewood / Crimson
  '#87593b', // Archival Sepia / Bronze
  '#434875', // Muted Indigo / Slate Violet
  '#235848', // Dark Spruce / Forest
  '#5a4578', // Amethyst Ore
  '#3b7a57', // Sage Green
];

export const TOY_CATEGORY_PALETTE = [
  '#ef4444', // Toy Block Red
  '#0ea5e9', // Sky Blue Block
  '#22c55e', // Grass Green Block
  '#f59e0b', // Sunny Amber Block
  '#a855f7', // Grape Purple Block
  '#ec4899', // Berry Pink Block
  '#14b8a6', // Aqua Teal Block
  '#f97316', // Tangy Orange Block
  '#6366f1', // Electric Indigo Block
  '#84cc16', // Lime Green Block
  '#e11d48', // Cherry Red Block
  '#06b6d4', // Cyan Toy Block
];

// Youth "comic" skin (preview): bold primary inks for lanes and topics.
export const COMIC_LANE_COLORS = [
  '#e63946', // Comic Red
  '#1d6fd8', // Comic Blue
  '#f4a90c', // Comic Yellow
  '#0f9d8a', // Comic Teal
];

export const COMIC_CATEGORY_PALETTE = [
  '#e63946', // Red
  '#1d6fd8', // Blue
  '#f4a90c', // Yellow
  '#0f9d8a', // Teal
  '#8e44ad', // Purple
  '#f26b1d', // Orange
  '#d6336c', // Magenta
  '#2b9348', // Green
  '#3a0ca3', // Indigo
  '#00a6d6', // Cyan
];

// Youth "bento" skin (preview): clean, modern era tones.
export const BENTO_LANE_COLORS = [
  '#8b5cf6', // Violet
  '#0ea5e9', // Sky
  '#f59e0b', // Amber
  '#10b981', // Emerald
];

export const BENTO_CATEGORY_PALETTE = [
  '#8b5cf6', // Violet
  '#0ea5e9', // Sky
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#f43f5e', // Rose
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#f97316', // Orange
];

export function isBentoThemeActive() {
  if (typeof document === 'undefined') return false;
  const cl = document.documentElement?.classList;
  return Boolean(cl?.contains('theme-bento') && !cl.contains('theme-toy'));
}

// "Journal" skin: notebook inks - fountain-pen blue, red pencil, ochre, sage.
export const JOURNAL_LANE_COLORS = [
  '#2f5d9e', // Fountain-pen blue
  '#b8432f', // Red pencil
  '#c08a1e', // Ochre
  '#4a7c59', // Sage
];

export const JOURNAL_CATEGORY_PALETTE = [
  '#2f5d9e', // Ink blue
  '#b8432f', // Red pencil
  '#c08a1e', // Ochre
  '#4a7c59', // Sage
  '#7b5299', // Violet ink
  '#2a8a86', // Teal ink
  '#c2577a', // Rose
  '#6b7a2f', // Olive
  '#8a5a2b', // Sepia
  '#3f7fbf', // Sky ink
];

export function isJournalThemeActive() {
  if (typeof document === 'undefined') return false;
  const cl = document.documentElement?.classList;
  return Boolean(cl?.contains('theme-journal') && !cl.contains('theme-toy'));
}

export function isComicThemeActive() {
  if (typeof document === 'undefined') return false;
  const cl = document.documentElement?.classList;
  return Boolean(cl?.contains('theme-comic') && !cl.contains('theme-toy'));
}

export function isToyThemeActive() {
  if (typeof window !== 'undefined' && typeof window.__chronixVisualTheme === 'string') {
    return window.__chronixVisualTheme === 'toy';
  }
  if (typeof document !== 'undefined' && document.documentElement?.classList?.contains('theme-toy')) return true;
  return false;
}


/**
 * Determines if a color is light or dark to pick the best contrasting text color.
 * Uses YIQ perceived brightness.
 */
export function isColorLight(hexOrColor) {
  if (!hexOrColor) return false;
  let hex = String(hexOrColor).trim();

  // If hex code e.g. #fff or #ffffff
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 165;
    }
  }

  // If rgba / rgb format
  const match = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 165;
  }

  return false;
}

/**
 * Resolves the preferred color for a single lane, ignoring collisions: keeps the lane's
 * own color if it's already one of our curated tones, otherwise falls back to the palette
 * slot matching its index (any other/legacy color is intentionally ignored, not translated).
 */
function resolvePreferredLaneColor(lane, index = 0) {
  const fallbackColor = DEFAULT_LANE_COLORS[index % DEFAULT_LANE_COLORS.length];
  if (!lane) return fallbackColor;

  const rawColor = lane.color?.trim();
  if (!rawColor) return fallbackColor;

  const lower = rawColor.toLowerCase();

  // If it's already one of our curated lane colors, keep it!
  if (DEFAULT_LANE_COLORS.some((c) => c.toLowerCase() === lower)) {
    return rawColor;
  }

  // Otherwise, assign by lane index instead of trying to translate an arbitrary color.
  return fallbackColor;
}

/** Returns a stable key identifying a lane for uniqueness bookkeeping. */
function laneKey(lane, index) {
  if (lane && (lane.id !== undefined && lane.id !== null)) return `id:${lane.id}`;
  if (lane && lane.name) return `name:${lane.name}`;
  return `idx:${index}`;
}

/**
 * Resolves the color for a lane. All lanes share a single cohesive architectural tone (#2563a2)
 * so tracks do not compete visually with categories/topics.
 */
export function getLaneColor(lane, index = 0, allLanes = []) {
  if (isToyThemeActive()) {
    return TOY_LANE_COLORS[Math.abs(index) % TOY_LANE_COLORS.length] || '#0ea5e9';
  }
  if (isComicThemeActive()) {
    return COMIC_LANE_COLORS[Math.abs(index) % COMIC_LANE_COLORS.length] || '#e63946';
  }
  if (isBentoThemeActive()) {
    return BENTO_LANE_COLORS[Math.abs(index) % BENTO_LANE_COLORS.length] || '#8b5cf6';
  }
  if (isJournalThemeActive()) {
    return JOURNAL_LANE_COLORS[Math.abs(index) % JOURNAL_LANE_COLORS.length] || '#2f5d9e';
  }
  return DEFAULT_LANE_COLORS[0] || '#2563a2';
}



/**
 * Returns the ordered list of distinct, non-empty event themes (`category`
 * field) in first-appearance order. Used to color a single (non-split)
 * timeline by theme, similar to how lanes color a split timeline.
 */
export function getDistinctCategories(articles = []) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    let c = a?.category;
    if (typeof c === 'object' && c !== null) {
      c = c.en || c.he || Object.values(c)[0] || '';
    }
    if (!c) {
      c = a?.categoryKey || a?.theme || '';
    }
    c = String(c).trim();
    if (!c || c === '[object Object]') continue;
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/**
 * Resolves a stable museum-palette color for a single theme/category. Same palette in
 * light and dark mode - topic colors are theme-invariant, unlike lanes.
 * When `allCategories` is provided its order determines the palette slot so
 * every distinct theme gets a distinct color; otherwise a hash fallback keeps
 * the color deterministic.
 */
export function getActiveCategoryPalette() {
  if (isToyThemeActive()) return TOY_CATEGORY_PALETTE;
  if (isComicThemeActive()) return COMIC_CATEGORY_PALETTE;
  if (isBentoThemeActive()) return BENTO_CATEGORY_PALETTE;
  if (isJournalThemeActive()) return JOURNAL_CATEGORY_PALETTE;
  return CATEGORY_PALETTE;
}

export function getCategoryColor(category, allCategories = []) {
  let key = category;
  if (typeof key === 'object' && key !== null) {
    key = key.en || key.he || Object.values(key)[0] || '';
  }
  key = String(key ?? '').trim().toLowerCase();
  const palette = getActiveCategoryPalette();
  if (!key || key === '[object Object]') return palette[0];

  const list = Array.isArray(allCategories) ? allCategories : [];
  const idx = list.findIndex((c) => {
    let str = c;
    if (typeof str === 'object' && str !== null) {
      str = str.en || str.he || Object.values(str)[0] || '';
    }
    return String(str ?? '').trim().toLowerCase() === key;
  });
  if (idx >= 0) return palette[idx % palette.length];

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Parses any color string (#rgb, #rrggbb, rgb(), rgba()) into [r, g, b] (0-255).
 */
export function parseColorToRgb(color) {
  if (!color || typeof color !== 'string') return [128, 128, 128];
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      return [
        parseInt(hex.substring(0, 2), 16),
        parseInt(hex.substring(2, 4), 16),
        parseInt(hex.substring(4, 6), 16),
      ];
    }
  }
  const rgbMatch = trimmed.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }
  return [128, 128, 128];
}

/**
 * Returns the HSL representation of an RGB triplet.
 * h: 0-360, s: 0-100, l: 0-100
 */
export function getRgbHueAndSat(r, g, b) {
  const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
  let h = 0, s = 0, l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rNorm) h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
    else if (max === gNorm) h = (bNorm - rNorm) / d + 2;
    else h = (rNorm - gNorm) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Converts any hex (#rgb, #rrggbb) or rgb(r, g, b) string to rgba(r, g, b, alpha).
 * Falls back safely if given an unrecognized format or already an rgba string.
 */
export function colorToRgba(color, alpha = 1) {
  if (!color || typeof color !== 'string') return `rgba(128, 128, 128, ${alpha})`;
  const trimmed = color.trim();

  // If already rgba
  if (trimmed.startsWith('rgba')) {
    return trimmed.replace(/[\d.]+\)$/, `${alpha})`);
  }

  const [r, g, b] = parseColorToRgb(trimmed);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Computes a clearly visible yet elegant tinted background color for a timeline track (lane body)
 * derived from the lane's header bar color.
 * Uses calibrated HSL values so that even muted stone colors have an identifiable pastel hue in light mode
 * and an atmospheric deep glow in dark mode.
 */
export function getLaneBodyBg(laneColor, isDark = false) {
  if (isToyThemeActive()) {
    if (!laneColor) {
      return isDark ? 'rgba(26, 35, 56, 0.35)' : 'rgba(255, 255, 255, 0.65)';
    }
    const [r, g, b] = parseColorToRgb(laneColor);
    const { h } = getRgbHueAndSat(r, g, b);
    // Night: only a whisper of the lane hue so the midnight canvas stays calm and cards pop.
    return isDark ? `hsla(${h}, 55%, 55%, 0.05)` : `hsla(${h}, 85%, 94%, 0.72)`;
  }
  if (isComicThemeActive()) {
    if (!laneColor) return isDark ? 'rgba(34, 34, 39, 0.4)' : 'rgba(255, 255, 255, 0.5)';
    const [r, g, b] = parseColorToRgb(laneColor);
    const { h } = getRgbHueAndSat(r, g, b);
    return isDark ? `hsla(${h}, 60%, 55%, 0.07)` : `hsla(${h}, 90%, 92%, 0.55)`;
  }
  if (isBentoThemeActive()) {
    if (!laneColor) return isDark ? 'rgba(21, 21, 29, 0.6)' : 'rgba(255, 255, 255, 0.6)';
    const [r, g, b] = parseColorToRgb(laneColor);
    const { h } = getRgbHueAndSat(r, g, b);
    return isDark ? `hsla(${h}, 70%, 60%, 0.05)` : `hsla(${h}, 80%, 97%, 0.8)`;
  }
  if (isJournalThemeActive()) {
    if (!laneColor) return isDark ? 'rgba(36, 31, 25, 0.5)' : 'rgba(253, 249, 238, 0.6)';
    const [r, g, b] = parseColorToRgb(laneColor);
    const { h } = getRgbHueAndSat(r, g, b);
    return isDark ? `hsla(${h}, 35%, 55%, 0.06)` : `hsla(${h}, 45%, 93%, 0.45)`;
  }
  if (!laneColor) {
    return isDark ? 'rgba(20, 21, 26, 0.25)' : 'rgba(230, 230, 233, 0.45)';
  }
  const [r, g, b] = parseColorToRgb(laneColor);
  const { h, s } = getRgbHueAndSat(r, g, b);

  if (isDark) {
    // Subtle, clean neutral tint that keeps cards 100% crisp without canvas muddying
    const sat = Math.max(8, Math.min(18, Math.round(s * 0.3)));
    return `hsla(${h}, ${sat}%, 13%, 0.4)`;
  } else {
    // Gentle, subtle neutral wash for day mode
    const sat = Math.max(8, Math.min(20, Math.round(s * 0.35)));
    return `hsla(${h}, ${sat}%, 91%, 0.45)`;
  }
}

/**
 * Computes a matching tinted border color for a timeline track (lane body)
 * derived from the lane's header bar color.
 */
export function getLaneBodyBorder(laneColor, isDark = false) {
  if (isToyThemeActive()) {
    return isDark ? '#38466a' : '#0f172a';
  }
  if (isComicThemeActive()) {
    return isDark ? '#4a4a56' : '#111111';
  }
  if (isBentoThemeActive()) {
    return isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
  }
  if (isJournalThemeActive()) {
    return isDark ? 'rgba(232, 220, 196, 0.14)' : 'rgba(139, 115, 85, 0.28)';
  }
  if (!laneColor) {
    return isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)';
  }
  const [r, g, b] = parseColorToRgb(laneColor);
  const { h, s } = getRgbHueAndSat(r, g, b);

  if (isDark) {
    // Crisp, luminous hairline instead of murky dark navy
    return `hsla(${h}, 65%, 62%, 0.45)`;
  } else {
    const sat = Math.max(22, Math.min(46, Math.round(s * 0.7)));
    return `hsl(${h}, ${sat}%, 75%)`;
  }
}

