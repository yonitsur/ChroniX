// Shared Lane & Topic Colors & Utilities for ChroniX
// Lanes (timeline tracks) and topics (categories) intentionally use SEPARATE palettes so the
// two dimensions stay visually distinguishable wherever they appear together (badges, dropdowns,
// map pins): lanes get a muted, neutral "stone" palette (structural axis), topics keep the vivid
// curated museum palette (the color-coding axis) further down this file (CATEGORY_PALETTE).

export const DEFAULT_LANE_COLORS = [
  '#8bb3d6', // Pastel Slate Blue
  '#e8a590', // Pastel Warm Peach
  '#94c2a2', // Pastel Sage Green
  '#bca6d6', // Pastel Lavender
  '#dfbb7e', // Pastel Butter Amber
  '#7ec0cc', // Pastel Aqua Teal
  '#de9bb0', // Pastel Dusty Rose
  '#aebd85', // Pastel Celadon Olive
  '#9eade0', // Pastel Periwinkle
  '#e3a87d', // Pastel Soft Terracotta
  '#cca1d2', // Pastel Lilac
  '#87c4b6', // Pastel Seafoam Mint
];

// Vibrant archival palette for categories & themes — used in BOTH light and dark mode
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
 * Resolves the color for a lane, guaranteeing every lane in `allLanes`
 * receives a distinct color. Each lane keeps its preferred museum tone when
 * possible; on a collision it is reassigned to the next unused palette color.
 */
export function getLaneColor(lane, index = 0, allLanes = []) {
  if (!lane) return DEFAULT_LANE_COLORS[index % DEFAULT_LANE_COLORS.length];

  // Without the full lane set we cannot deduplicate; return preferred color.
  if (!Array.isArray(allLanes) || allLanes.length <= 1) {
    return resolvePreferredLaneColor(lane, index);
  }

  const used = new Set();
  const targetKey = laneKey(lane, index);

  for (let i = 0; i < allLanes.length; i += 1) {
    const current = allLanes[i];
    const preferred = resolvePreferredLaneColor(current, i);

    let assigned = preferred;
    if (used.has(preferred.toLowerCase())) {
      // Collision: pick the next unused color from the museum palette.
      assigned =
        DEFAULT_LANE_COLORS.find((c) => !used.has(c.toLowerCase())) || preferred;
    }
    used.add(assigned.toLowerCase());

    if (laneKey(current, i) === targetKey) {
      return assigned;
    }
  }

  return resolvePreferredLaneColor(lane, index);
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
 * light and dark mode — topic colors are theme-invariant, unlike lanes.
 * When `allCategories` is provided its order determines the palette slot so
 * every distinct theme gets a distinct color; otherwise a hash fallback keeps
 * the color deterministic.
 */
export function getCategoryColor(category, allCategories = []) {
  let key = category;
  if (typeof key === 'object' && key !== null) {
    key = key.en || key.he || Object.values(key)[0] || '';
  }
  key = String(key ?? '').trim().toLowerCase();
  const palette = CATEGORY_PALETTE;
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
  if (!laneColor) {
    return isDark ? 'rgba(28, 28, 32, 0.4)' : 'rgba(240, 240, 242, 0.45)';
  }
  const [r, g, b] = parseColorToRgb(laneColor);
  const { h, s } = getRgbHueAndSat(r, g, b);

  if (isDark) {
    // Faint, gentle dark tint that blends quietly into night mode without overpowering
    const sat = Math.max(12, Math.min(20, Math.round(s * 0.35)));
    return `hsla(${h}, ${sat}%, 12%, 0.55)`;
  } else {
    // Barely-there pastel wash — hints at the lane color without dominating
    const sat = Math.max(22, Math.min(38, Math.round(s * 0.7)));
    return `hsla(${h}, ${sat}%, 92%, 0.55)`;
  }
}

/**
 * Computes a matching tinted border color for a timeline track (lane body)
 * derived from the lane's header bar color.
 */
export function getLaneBodyBorder(laneColor, isDark = false) {
  if (!laneColor) {
    return isDark ? 'rgba(60, 60, 68, 0.7)' : 'rgba(228, 228, 231, 0.8)';
  }
  const [r, g, b] = parseColorToRgb(laneColor);
  const { h, s } = getRgbHueAndSat(r, g, b);

  if (isDark) {
    const sat = Math.max(18, Math.min(28, Math.round(s * 0.55)));
    return `hsl(${h}, ${sat}%, 20%)`;
  } else {
    const sat = Math.max(38, Math.min(55, Math.round(s * 1.1)));
    return `hsl(${h}, ${sat}%, 76%)`;
  }
}

