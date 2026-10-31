// Automatic focal point for cover-cropped photos (used when the event has no saved
// imagePositionX/Y). A downscaled copy of the photo is turned into an "interest" map:
// edge detail, distance from the background colour (estimated from the border),
// saturation and skin tones. The crop window is then slid along the overflowing axis to
// the spot holding the most interest, with a gentle pull toward the centre (or, for tall
// photos, the upper third, where heads and tops of objects usually are).

const ANALYSIS_SIZE = 96;
const MAP_CACHE_LIMIT = 200;
const mapCache = new Map();

function isSkinTone(r, g, b) {
  return r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15;
}

// `data` is RGBA pixel data (as from getImageData) of a `width` x `height` image.
export function buildInterestMap(data, width, height) {
  const count = width * height;
  const lum = new Float32Array(count);
  const interest = new Float32Array(count);

  let br = 0;
  let bg = 0;
  let bb = 0;
  let borderCount = 0;
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (x < border || y < border || x >= width - border || y >= height - border) {
        br += r;
        bg += g;
        bb += b;
        borderCount += 1;
      }
    }
  }
  br /= borderCount || 1;
  bg /= borderCount || 1;
  bb /= borderCount || 1;

  // A busy border (the photo fills the frame) says nothing about the background, so the
  // background-contrast term only counts when the border is fairly uniform.
  let borderSpread = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!(x < border || y < border || x >= width - border || y >= height - border)) continue;
      const i = (y * width + x) * 4;
      borderSpread += Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb);
    }
  }
  borderSpread /= borderCount || 1;
  const backgroundWeight = Math.max(0, Math.min(1, 1 - borderSpread / 70));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const left = lum[y * width + Math.max(0, x - 1)];
      const right = lum[y * width + Math.min(width - 1, x + 1)];
      const up = lum[Math.max(0, y - 1) * width + x];
      const down = lum[Math.min(height - 1, y + 1) * width + x];
      const edge = Math.min(1, (Math.abs(right - left) + Math.abs(down - up)) / 160);
      const max = Math.max(r, g, b);
      const saturation = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
      const contrast = Math.min(1, Math.hypot(r - br, g - bg, b - bb) / 180);
      interest[i] = 0.45 * edge
        + 0.4 * backgroundWeight * contrast
        + 0.1 * saturation
        + (isSkinTone(r, g, b) ? 0.2 : 0);
    }
  }
  return { width, height, interest };
}

function windowSum(prefix, start, size) {
  const at = (pos) => {
    const i = Math.floor(pos);
    if (i >= prefix.length - 1) return prefix[prefix.length - 1];
    return prefix[i] + (prefix[i + 1] - prefix[i]) * (pos - i);
  };
  return at(start + size) - at(start);
}

// Best object-position (in percent) for showing `map`'s photo cover-cropped in a frame of
// `frameRatio` (width / height).
export function computeFocalPoint(map, frameRatio) {
  const center = { x: 50, y: 50 };
  if (!map || !(frameRatio > 0)) return center;
  const { width, height, interest } = map;
  const imageRatio = width / height;
  if (Math.abs(imageRatio - frameRatio) / frameRatio < 0.03) return center;

  const cropsX = imageRatio > frameRatio;
  const length = cropsX ? width : height;
  const visible = cropsX ? height * frameRatio : width / frameRatio;
  const travel = length - visible;
  if (travel <= 0.5) return center;

  const profile = new Float32Array(length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      profile[cropsX ? x : y] += interest[y * width + x];
    }
  }
  const prefix = new Float32Array(length + 1);
  for (let i = 0; i < length; i++) prefix[i + 1] = prefix[i] + profile[i];
  const total = prefix[length];

  // Preferred resting spot when the photo has no clear subject.
  const preferred = cropsX ? 0.5 : 0.35;
  const toPoint = (t) => {
    const percent = Math.round(t * 1000) / 10;
    return cropsX ? { x: percent, y: 50 } : { x: 50, y: percent };
  };
  if (!(total > 0)) return toPoint(preferred);

  const steps = 60;
  let best = preferred;
  let bestScore = -Infinity;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const share = windowSum(prefix, travel * t, visible) / total;
    const score = share - 0.06 * Math.abs(t - preferred);
    if (score > bestScore + 1e-6) {
      bestScore = score;
      best = t;
    }
  }
  return toPoint(best);
}

// Resolves to an interest map, or null when the photo can't be read (load error or a
// host without CORS headers) - callers then keep the default centred crop.
export function loadInterestMap(url) {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  const cached = mapCache.get(url);
  if (cached) return cached;
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const scale = Math.min(1, ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        resolve(buildInterestMap(ctx.getImageData(0, 0, w, h).data, w, h));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  mapCache.set(url, promise);
  while (mapCache.size > MAP_CACHE_LIMIT) mapCache.delete(mapCache.keys().next().value);
  return promise;
}
