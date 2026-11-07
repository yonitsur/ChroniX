/**
 * Shared utility helpers for Timeline Games (Sequence, TimeGuesser, WhoAmI).
 */

/**
 * Compute a numeric chronological sort key for an event's start date.
 */
export function getEventSortValue(article) {
  const from = article?.from || article?.from_ || {};
  const year = Number(from.year ?? 0);
  const month = Number(from.month ?? 1);
  const day = Number(from.day ?? 1);
  const hour = Number(from.hour ?? 0);
  const minute = Number(from.minute ?? 0);
  return (
    year +
    (Math.max(1, month) - 1) / 12 +
    (Math.max(1, day) - 1) / 365.25 +
    hour / 8760 +
    minute / 525600
  );
}

/**
 * Format an event's start year/date for game badges and sliders.
 */
export function formatGameYear(yearVal, lang = 'en') {
  const y = Math.round(Number(yearVal ?? 0));
  const isHe = lang === 'he';
  if (Math.abs(y) >= 1_000_000_000) {
    const b = (Math.abs(y) / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '');
    return isHe ? `לפני ${b} מיליארד שנה` : `${b}B yrs ago`;
  }
  if (Math.abs(y) >= 1_000_000) {
    const m = (Math.abs(y) / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return isHe ? `לפני ${m} מיליון שנה` : `${m}M yrs ago`;
  }
  if (y < 0) {
    return isHe ? `${Math.abs(y)} לפנה״ס` : `${Math.abs(y)} BCE`;
  }
  return String(y);
}

/**
 * Format an event's full display date (including month/day if all events share close years).
 */
export function formatEventDisplayDate(article, lang = 'en', includeMonthDay = false) {
  const from = article?.from || article?.from_ || {};
  const year = Number(from.year ?? 0);
  const baseYear = formatGameYear(year, lang);
  if (!includeMonthDay || !from.month || year < 0) {
    return baseYear;
  }
  const m = String(from.month).padStart(2, '0');
  if (from.day) {
    const d = String(from.day).padStart(2, '0');
    return lang === 'he' ? `${d}.${m}.${year}` : `${year}-${m}-${d}`;
  }
  return lang === 'he' ? `${m}/${year}` : `${year}-${m}`;
}

/**
 * Scrub literal year numbers and optionally location names from a clue snippet
 * so that the description doesn't give away the exact date or place before guessing.
 */
export function scrubEventSpoilers(text, article, { scrubYears = true, scrubLocation = false } = {}) {
  if (!text || typeof text !== 'string') return '';
  let result = text;

  if (scrubYears) {
    const fromYear = article?.from?.year ?? article?.from_?.year;
    const toYear = article?.to?.year;
    const yearsToMask = new Set();
    if (fromYear != null && Math.abs(Number(fromYear)) >= 10) {
      yearsToMask.add(String(Math.abs(Number(fromYear))));
    }
    if (toYear != null && Math.abs(Number(toYear)) >= 10) {
      yearsToMask.add(String(Math.abs(Number(toYear))));
    }
    for (const yStr of yearsToMask) {
      const escaped = yStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), '••••');
    }
    // Also mask any standalone 4-digit years (1000-2099) that might spoil adjacent dates
    result = result.replace(/\b(1\d{3}|20\d{2})\b/g, '••••');
  }

  if (scrubLocation && article?.locationName) {
    const locParts = String(article.locationName)
      .split(/[,/|-]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);
    for (const part of locParts) {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'gi'), '•••');
    }
  }

  return result;
}

/**
 * Calculate great-circle distance in kilometers between two lat/lng points using Haversine formula.
 */
export function calculateHaversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Fisher-Yates shuffle returning a new array.
 */
export function shuffleArray(items) {
  const copy = Array.isArray(items) ? [...items] : [];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const PHOTO_BLUR_CURVE = [24, 16, 10, 5.5, 2.2];
const PHOTO_SCALE_CURVE = [1.15, 1.11, 1.07, 1.04, 1.02];
const PHOTO_CLARITY_CURVE = [20, 40, 60, 80, 92];

/**
 * Progressive blur, scale, and clarity percentage for a mystery image clue in WhoAmIGame.
 */
export function getMysteryPhotoStage(revealedCount, totalClues, isResolved) {
  if (isResolved) {
    return { blurPx: 0, scale: 1, clarityPct: 100 };
  }
  const count = Math.max(1, Number(totalClues) || 5);
  const step = Math.max(0, Math.min(count - 1, (Number(revealedCount) || 1) - 1));
  if (count === PHOTO_BLUR_CURVE.length) {
    return {
      blurPx: PHOTO_BLUR_CURVE[step],
      scale: PHOTO_SCALE_CURVE[step],
      clarityPct: PHOTO_CLARITY_CURVE[step],
    };
  }
  const progress = count > 1 ? step / (count - 1) : 1;
  const scaledIdx = progress * (PHOTO_BLUR_CURVE.length - 1);
  const lo = Math.floor(scaledIdx);
  const hi = Math.min(PHOTO_BLUR_CURVE.length - 1, Math.ceil(scaledIdx));
  const frac = scaledIdx - lo;
  const lerp = (a, b) => a + (b - a) * frac;
  return {
    blurPx: Number(lerp(PHOTO_BLUR_CURVE[lo], PHOTO_BLUR_CURVE[hi]).toFixed(2)),
    scale: Number(lerp(PHOTO_SCALE_CURVE[lo], PHOTO_SCALE_CURVE[hi]).toFixed(3)),
    clarityPct: Math.round(lerp(PHOTO_CLARITY_CURVE[lo], PHOTO_CLARITY_CURVE[hi])),
  };
}
