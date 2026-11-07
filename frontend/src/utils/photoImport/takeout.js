// Google Takeout support (pure): Takeout exports each photo with a JSON "sidecar" holding the
// capture time, the location (even when the photo's own EXIF lost it), the people tagged and the
// user's caption. This module matches photos to their sidecars and reads them.
//
// Sidecar names vary by export date:  IMG_1234.jpg.json
//                                     IMG_1234.jpg.supplemental-metadata.json
//                                     IMG_1234.jpg.supplemental-metad.json   (truncated, 51-char limit)
//                                     IMG_1234.jpg(1).json / IMG_1234.jpg.supplemental-metadata(1).json
// and edited copies ("IMG_1234-edited.jpg") share the original's sidecar.

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|tiff?|dng|raw|cr2|nef|arw)$/i;
const SUPPLEMENTAL = 'supplemental-metadata';
// Takeout cuts sidecar file names at ~51 characters; shorter names are never truncated, so a short
// sidecar that is merely a prefix of a photo's name ("IMG_1234.json" vs "IMG_12345.jpg") isn't its match.
const TRUNCATED_NAME_MIN = 40;

const dirOf = (path) => {
  const p = String(path || '').replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
};
const baseOf = (path) => {
  const p = String(path || '').replace(/\\/g, '/');
  return p.slice(p.lastIndexOf('/') + 1);
};

export const isSidecarName = (name) => /\.json$/i.test(String(name || ''));

const EDITED = /-(edited|bearbeitet|modifié|editado|modificato|bewerkt|編集済み)(\.[^.]+)$/i;
const DUP = /^(.*)\((\d+)\)(\.[^.]+)$/;

/**
 * "IMG_1234(1).jpg" -> { stem: "IMG_1234.jpg", dup: "1" }; "IMG_1234-edited.jpg" -> stem "IMG_1234.jpg";
 * "IMG_1234(1)-edited.jpg" (the edited copy of a duplicate) -> { stem: "IMG_1234.jpg", dup: "1" }.
 */
function imageKey(name) {
  // The edit suffix comes after the "(n)" counter, so it has to go first.
  let n = baseOf(name).replace(EDITED, '$2');
  let dup = '';
  const m = n.match(DUP);
  if (m) {
    n = `${m[1]}${m[3]}`;
    dup = m[2];
  }
  n = n.replace(EDITED, '$2');
  return { stem: n, dup };
}

/** "IMG_1234.jpg.supplemental-metadata(1).json" -> { media: "IMG_1234.jpg", dup: "1" } (media may be truncated). */
function sidecarKey(name) {
  let n = baseOf(name).replace(/\.json$/i, '');
  let dup = '';
  const m = n.match(/^(.*)\((\d+)\)$/);
  if (m) {
    n = m[1];
    dup = m[2];
  }
  // Strip ".supplemental-metadata" or any truncation of it (".supplemental-metad", ".suppl", ".s"...).
  const dot = n.lastIndexOf('.');
  if (dot > 0) {
    const tail = n.slice(dot + 1).toLowerCase();
    if (tail && SUPPLEMENTAL.startsWith(tail)) n = n.slice(0, dot);
  }
  return { media: n, dup };
}

/**
 * Matches image files to sidecar JSON files in the same folder.
 *
 * @param {Array<{path: string}>} images
 * @param {Array<{path: string}>} sidecars
 * @returns {Map<string, string>} image path -> sidecar path
 */
export function matchTakeoutSidecars(images, sidecars) {
  // Per folder: exact lookups keyed by "dup|lower-cased media name", plus the list for prefix matches.
  const byDir = new Map();
  for (const s of sidecars || []) {
    const dir = dirOf(s.path);
    if (!byDir.has(dir)) byDir.set(dir, { exact: new Map(), all: [] });
    const entry = byDir.get(dir);
    const { media, dup } = sidecarKey(s.path);
    const rec = { path: s.path, dup, lower: media.toLowerCase(), truncatable: baseOf(s.path).length >= TRUNCATED_NAME_MIN };
    const key = `${dup}|${rec.lower}`;
    if (!entry.exact.has(key)) entry.exact.set(key, rec);
    entry.all.push(rec);
  }
  const out = new Map();
  const claimed = new Set();
  const pending = [];
  // Pass 1: the exact name, then the extension-less exact name (some exports write "IMG_1234.json").
  for (const img of images || []) {
    const entry = byDir.get(dirOf(img.path));
    if (!entry) continue;
    const { stem, dup } = imageKey(img.path);
    const lower = stem.toLowerCase();
    const hit = entry.exact.get(`${dup}|${lower}`) || entry.exact.get(`${dup}|${lower.replace(/\.[^.]+$/, '')}`);
    if (hit) {
      out.set(img.path, hit.path);
      claimed.add(hit.path);
    } else {
      pending.push({ img, entry, dup, lower });
    }
  }
  // Pass 2: a truncated sidecar name that is a prefix of the photo's name. The longest prefix wins and
  // sidecars another photo matched exactly are skipped, so "IMG_12345.jpg" never takes "IMG_1234.json".
  for (const { img, entry, dup, lower } of pending) {
    let best = null;
    for (const s of entry.all) {
      if (s.dup !== dup || !s.truncatable || s.lower.length < 8 || claimed.has(s.path)) continue;
      if (lower.startsWith(s.lower) && (!best || s.lower.length > best.lower.length)) best = s;
    }
    if (best) out.set(img.path, best.path);
  }
  return out;
}

const isRealCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);

/**
 * Reads a Takeout sidecar object.
 * Takeout stores the capture time as a UTC timestamp without the place's time zone, so the wall
 * clock is derived with `tzOffsetMinutes` (the browser's offset at that instant by default).
 *
 * @returns {{utcMs: number|null, lat: number|null, lng: number|null, people: string[], description: string, title: string}|null}
 */
export function parseTakeoutSidecar(json) {
  if (!json || typeof json !== 'object') return null;
  const ts = Number(json.photoTakenTime?.timestamp ?? json.creationTime?.timestamp);
  const utcMs = Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
  let lat = null;
  let lng = null;
  // geoData is what the user sees in Google Photos (including locations they set by hand).
  for (const g of [json.geoData, json.geoDataExif]) {
    const la = Number(g?.latitude);
    const ln = Number(g?.longitude);
    if (isRealCoord(la, ln)) {
      lat = la;
      lng = ln;
      break;
    }
  }
  const people = Array.isArray(json.people)
    ? json.people.map((p) => String(p?.name || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    utcMs,
    lat,
    lng,
    people,
    description: String(json.description || '').trim().slice(0, 500),
    title: String(json.title || ''),
  };
}

/** UTC ms -> EXIF-style "YYYY:MM:DD HH:MM:SS" wall clock at `offsetMinutes` east of UTC. */
export function utcToExifWall(utcMs, offsetMinutes) {
  const d = new Date(utcMs + offsetMinutes * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** "+02:00" for 120 minutes. */
export function offsetToExif(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const a = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** The browser's UTC offset (minutes east) at a given instant (DST-aware). */
export const localOffsetAt = (utcMs) => -new Date(utcMs).getTimezoneOffset();

/**
 * Fills the gaps in a photo's EXIF tags from its sidecar: the capture time only when EXIF has
 * none, the location only when EXIF has none. Returns new tags (or null when there's nothing).
 */
export function mergeSidecarIntoTags(tags, sidecar, { offsetAt = localOffsetAt } = {}) {
  if (!sidecar) return tags || null;
  const t = { ...(tags || {}) };
  const hasExifTime = Boolean(t.DateTimeOriginal || t.CreateDate || t.DateTimeDigitized);
  if (!hasExifTime && sidecar.utcMs) {
    const off = offsetAt(sidecar.utcMs);
    t.DateTimeOriginal = utcToExifWall(sidecar.utcMs, off);
    t.OffsetTimeOriginal = offsetToExif(off);
  }
  // exifr adds decimal latitude/longitude whenever EXIF GPS parses; 0,0 is broken GPS.
  const hasExifGps = isRealCoord(Number(t.latitude), Number(t.longitude));
  if (!hasExifGps && sidecar.lat != null) {
    t.latitude = sidecar.lat;
    t.longitude = sidecar.lng;
  }
  return t;
}

export const looksLikeImage = (name) => IMAGE_EXT.test(String(name || ''));

/**
 * Google Photos Picker item -> EXIF-style tags for buildPhotoMeta. The Picker gives the capture
 * time as UTC (`createTime`) and never the location, so only the time is filled; the wall clock
 * uses the browser's offset at that instant.
 */
export function pickedItemToTags(item, { offsetAt = localOffsetAt } = {}) {
  const ms = Date.parse(item?.createTime || '');
  if (!Number.isFinite(ms)) return null;
  const off = offsetAt(ms);
  return { DateTimeOriginal: utcToExifWall(ms, off), OffsetTimeOriginal: offsetToExif(off) };
}
