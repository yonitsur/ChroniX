// Shared Lane Colors & Utilities for ChroniX
// Curated 12-color archival/historical museum palette

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

// Complete mapping of legacy Tailwind / saturated / vibe-coding hexes
export const LEGACY_COLOR_MAP = {
  // Blues -> Prussian Navy (#2b5278)
  '#2563eb': '#2b5278',
  '#3b82f6': '#2b5278',
  '#1d4ed8': '#2b5278',
  '#1e40af': '#2b5278',
  '#1e3a8a': '#2b5278',
  '#3182ce': '#2b5278',
  '#2b6cb0': '#2b5278',
  '#1976d2': '#2b5278',
  '#1e88e5': '#2b5278',
  '#2980b9': '#2b5278',
  '#0d47a1': '#2b5278',
  '#4682b4': '#2b5278',

  // Reds -> Warm Terracotta (#b84a39) / Rosewood (#8c3a48)
  '#dc2626': '#b84a39',
  '#ef4444': '#b84a39',
  '#e53e3e': '#b84a39',
  '#c53030': '#b84a39',
  '#d32f2f': '#b84a39',
  '#f44336': '#b84a39',
  '#e74c3c': '#b84a39',
  '#b91c1c': '#8c3a48',
  '#b22222': '#8c3a48',
  '#8b0000': '#8c3a48',
  '#800020': '#8c3a48',
  '#8b263e': '#8c3a48',

  // Greens -> Antique Cypress (#2e6b56) / Dark Spruce (#235848)
  '#059669': '#2e6b56',
  '#10b981': '#2e6b56',
  '#047857': '#2e6b56',
  '#27ae60': '#2e6b56',
  '#2f855a': '#2e6b56',
  '#3b7a57': '#2e6b56',
  '#4caf50': '#2e6b56',
  '#8bc34a': '#2e6b56',
  '#1b5e20': '#235848',

  // Purples -> Muted Mulberry (#6e395e) / Amethyst (#5a4578)
  '#7c3aed': '#6e395e',
  '#8b5cf6': '#5a4578',
  '#7b1fa2': '#6e395e',
  '#9c27b0': '#6e395e',
  '#4f46e5': '#434875',
  '#6366f1': '#434875',

  // Ambers / Oranges -> Burnished Ochre (#b87326) / Sepia (#87593b)
  '#d97706': '#b87326',
  '#f59e0b': '#b87326',
  '#b45309': '#b87326',
  '#ff9800': '#b87326',
  '#e67e22': '#b87326',
  '#ea580c': '#87593b',
  '#f97316': '#87593b',
  '#dd6b20': '#87593b',
  '#e65100': '#87593b',
  '#b85d19': '#87593b',
  '#c2593f': '#b84a39',
  '#c29b38': '#b87326',
  '#c59b27': '#b87326',
  '#daa520': '#b87326',
  '#d4af37': '#b87326',
  '#795548': '#87593b',
  '#8b5a2b': '#87593b',

  // Cyans / Teals -> Aegean Petrol (#24657a) / Dark Spruce (#235848)
  '#0891b2': '#24657a',
  '#0284c7': '#24657a',
  '#38bdf8': '#24657a',
  '#0d9488': '#235848',

  // Pinks -> Rosewood (#8c3a48)
  '#db2777': '#8c3a48',
  '#ec4899': '#8c3a48',

  // Slate
  '#475569': '#3b4b5e',
};

/**
 * Maps an arbitrary hex color by perceived hue to the closest museum tone.
 */
function mapHexToMuseumColor(hex) {
  if (!hex || !hex.startsWith('#')) return null;
  let clean = hex.slice(1);
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return null;

  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  // Very low saturation -> Basalt Slate
  if (max === 0 || d < 0.12) {
    return '#3b4b5e';
  }

  let h = 0;
  if (max === r) {
    h = ((g - b) / d) % 6;
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  // Map hue spectrum into curated museum palette
  if (h >= 345 || h < 15) return '#b84a39'; // Terracotta
  if (h >= 15 && h < 45) return '#b87326';  // Burnished Ochre
  if (h >= 45 && h < 75) return '#87593b';  // Archival Sepia
  if (h >= 75 && h < 165) return '#2e6b56'; // Antique Cypress
  if (h >= 165 && h < 205) return '#24657a'; // Aegean Petrol
  if (h >= 205 && h < 250) return '#2b5278'; // Prussian Navy
  if (h >= 250 && h < 285) return '#434875'; // Slate Violet
  return '#6e395e'; // Muted Mulberry
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
 * Resolves the preferred museum color for a single lane, ignoring collisions.
 * Maps legacy/bright primary colors to the curated archival museum palette.
 */
function resolvePreferredLaneColor(lane, index = 0) {
  const fallbackColor = DEFAULT_LANE_COLORS[index % DEFAULT_LANE_COLORS.length];
  if (!lane) return fallbackColor;

  const rawColor = lane.color?.trim();
  if (!rawColor) return fallbackColor;

  const lower = rawColor.toLowerCase();

  // 1. If it's already one of our curated museum colors, keep it!
  if (DEFAULT_LANE_COLORS.some((c) => c.toLowerCase() === lower)) {
    return rawColor;
  }

  // 2. If it's in our legacy color map, translate it to its museum counterpart
  if (LEGACY_COLOR_MAP[lower]) {
    return LEGACY_COLOR_MAP[lower];
  }

  // 3. If it's another hex color, compute its hue and map to the closest museum tone
  const hueMapped = mapHexToMuseumColor(lower);
  if (hueMapped) {
    return hueMapped;
  }

  // 4. Harmonic fallback by lane index
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
