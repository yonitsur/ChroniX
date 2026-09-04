// Shared Lane Colors & Utilities for ChroniX

export const DEFAULT_LANE_COLORS = [
  '#2b5278', // Lapis Lazuli / Prussian Navy
  '#b84a39', // Warm Terracotta / Venetian Red
  '#2e6b56', // Antique Cypress / Deep Sage
  '#6e395e', // Muted Mulberry / Imperial Plum
  '#b87326', // Burnished Ochre / Byzantine Amber
  '#24657a', // Aegean Petrol / Mineral Teal
  '#87593b', // Archival Sepia / Renaissance Bronze
  '#434875', // Muted Indigo / Slate Violet
  '#8c3a48', // Rosewood / Crimson Pine
  '#235848', // Dark Spruce / Forest
  '#5a4578', // Amethyst Ore
  '#3b4b5e', // Basalt Slate / Anthracite
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
 * Resolves the color for a lane. If lanes already have distinct colors, uses lane.color.
 * Otherwise falls back to the curated DEFAULT_LANE_COLORS palette by lane index.
 */
export function getLaneColor(lane, index = 0, allLanes = []) {
  if (!lane) return DEFAULT_LANE_COLORS[0];

  const providedColor = lane.color?.trim();

  // If we have a list of all lanes, check if they provide diverse colors
  if (Array.isArray(allLanes) && allLanes.length > 1) {
    const uniqueColors = new Set(allLanes.map((l) => l.color?.trim()).filter(Boolean));
    // If multiple distinct colors were provided (e.g. from data/AI), honor them
    if (uniqueColors.size > 1 && providedColor) {
      return providedColor;
    }
  }

  // If a specific custom non-default color was set
  if (providedColor && !['#3b82f6', '#38bdf8', '#0284c7'].includes(providedColor.toLowerCase())) {
    return providedColor;
  }

  // Otherwise, use diverse palette by index
  return DEFAULT_LANE_COLORS[index % DEFAULT_LANE_COLORS.length];
}
