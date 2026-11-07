// Photo metadata -> a small, normalised record the clustering engine understands.
// Pure module (no DOM, no exifr import) so it runs under node --test; the browser-side reader
// (readPhotoFiles.js) hands raw EXIF tags in.
//
// Time model: cameras record LOCAL wall-clock time. We keep it as `wall` ({year..second}) for
// the timeline (TimelineDate is local time too), and as `wallMs` (the wall clock read as if it
// were UTC) for arithmetic. When the photo also records its UTC offset we derive `utcMs`, which
// orders photos correctly across time zones. `sortMs` is utcMs when known, else wallMs.

const MIN_YEAR = 1900;
const MAX_FUTURE_MS = 2 * 24 * 3600 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

function validParts(y, mo, d, h = 0, mi = 0, s = 0) {
  if (![y, mo, d, h, mi, s].every(Number.isFinite)) return false;
  if (y < MIN_YEAR || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCMonth() === mo - 1;
}

/** "+02:00" / "-0530" / "Z" -> minutes east of UTC, or null. */
export function parseUtcOffset(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^z$/i.test(s)) return 0;
  const m = s.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  if (mins > 14 * 60) return null;
  return m[1] === '-' ? -mins : mins;
}

function makeTime(y, mo, d, h, mi, s, offsetMin, source, now) {
  if (!validParts(y, mo, d, h, mi, s)) return null;
  const wallMs = Date.UTC(y, mo - 1, d, h, mi, Math.floor(s));
  const utcMs = offsetMin == null ? null : wallMs - offsetMin * 60000;
  // Clocks reset to the future (or to 1970) are noise, not dates.
  if ((utcMs ?? wallMs) > now + MAX_FUTURE_MS) return null;
  return {
    wall: { year: y, month: mo, day: d, hour: h, minute: mi, second: Math.floor(s) },
    wallMs,
    utcMs,
    offsetMin: offsetMin ?? null,
    sortMs: utcMs ?? wallMs,
    source,
  };
}

/**
 * EXIF "2023:05:14 10:22:31" (optionally with sub-seconds / offset) -> time record or null.
 * Also accepts a Date (exifr's revived value) read as local wall clock.
 */
export function parseExifDateTime(value, offsetValue = null, { now = Date.now(), source = 'exif' } = {}) {
  if (value == null || value === '') return null;
  const offsetMin = parseUtcOffset(offsetValue);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return makeTime(value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), offsetMin, source, now);
  }
  const m = String(value).trim().match(/^(\d{4})[:\-/.](\d{2})[:\-/.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/i);
  if (!m) return null;
  const off = offsetMin ?? parseUtcOffset(m[7]);
  return makeTime(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), off, source, now);
}

// Filename patterns from common phones and apps, most specific first.
const FILENAME_PATTERNS = [
  // IMG_20230514_102231, PXL_20230514_102231123, VID_..., 20230514_102231, Screenshot_20230514-102231
  /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})[_\-T ]?(\d{2})(\d{2})(\d{2})/,
  // "2023-05-14 10.22.31", "Photo 2023-05-14 at 10.22.31", "Screenshot 2023-05-14 at 10:22:31"
  /((?:19|20)\d{2})-(\d{2})-(\d{2})(?:[ _T]|\s+at\s+)(\d{2})[.:\-](\d{2})[.:\-](\d{2})/i,
];
// Date-only: IMG-20230514-WA0001 (WhatsApp), "2023-05-14", "20230514"
const FILENAME_DATE_ONLY = [
  /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?:[^\d]|$)/,
  /((?:19|20)\d{2})-(\d{2})-(\d{2})/,
];

/** Best-effort capture time from a filename (local time, no offset), or null. */
export function dateFromFilename(name, { now = Date.now() } = {}) {
  const base = String(name || '').replace(/\.[^./\\]+$/, '');
  if (!base) return null;
  for (const re of FILENAME_PATTERNS) {
    const m = base.match(re);
    if (m) {
      const t = makeTime(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], null, 'filename', now);
      if (t) return t;
    }
  }
  for (const re of FILENAME_DATE_ONLY) {
    const m = base.match(re);
    if (m) {
      // Noon keeps a date-only photo inside its own day whatever the gaps around it.
      const t = makeTime(+m[1], +m[2], +m[3], 12, 0, 0, null, 'filename', now);
      if (t) return { ...t, dateOnly: true };
    }
  }
  return null;
}

/**
 * [deg, min, sec] (or a decimal) + "N"/"S"/"E"/"W" -> signed decimal degrees, or null.
 */
export function gpsToDecimal(value, ref) {
  let deg;
  if (Array.isArray(value)) {
    const [d = 0, m = 0, s = 0] = value.map(Number);
    if (![d, m, s].every(Number.isFinite)) return null;
    deg = Math.abs(d) + m / 60 + s / 3600;
    if (d < 0) deg = -deg;
  } else {
    deg = Number(value);
  }
  if (!Number.isFinite(deg)) return null;
  const r = String(ref || '').trim().toUpperCase();
  if ((r === 'S' || r === 'W') && deg > 0) deg = -deg;
  return deg;
}

function readCoords(tags) {
  let lat = null;
  let lng = null;
  // exifr adds decimal `latitude`/`longitude` when it parses GPS; fall back to raw tags.
  if (Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude)) {
    lat = tags.latitude;
    lng = tags.longitude;
  } else if (tags.GPSLatitude != null && tags.GPSLongitude != null) {
    lat = gpsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef);
    lng = gpsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 0,0 ("Null Island") is what broken GPS writes.
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return null;
  return { lat, lng };
}

/**
 * Builds the record the clustering engine uses from a file's basics and its raw EXIF tags.
 *
 * @param {{id: string, name: string, size?: number, type?: string, tags?: object|null}} input
 * @returns {{id, name, size, type, time: object|null, timeSource: 'exif'|'filename'|null,
 *            lat: number|null, lng: number|null, orientation: number}}
 */
export function buildPhotoMeta({ id, name, size = 0, type = '', tags = null, timeSource = null, people = null, description = '' }, { now = Date.now() } = {}) {
  const t = tags || {};
  // `timeSource` labels where an injected capture time came from ('takeout', 'google').
  let time = parseExifDateTime(t.DateTimeOriginal ?? t.CreateDate ?? t.DateTimeDigitized, t.OffsetTimeOriginal ?? t.OffsetTimeDigitized ?? t.OffsetTime, { now });
  // exifr names IFD0 DateTime "ModifyDate"; it is the last resort (edits can change it).
  if (!time && (t.ModifyDate || t.DateTime)) time = parseExifDateTime(t.ModifyDate || t.DateTime, t.OffsetTime, { now });
  if (time && timeSource) time = { ...time, source: timeSource };
  if (!time) time = dateFromFilename(name, { now });
  const coords = readCoords(t);
  const orientation = Number.isInteger(t.Orientation) ? t.Orientation : 1;
  // The camera that took it (EXIF IFD0 Make/Model): screenshots and saved images have none.
  const camera = [t.Make, t.Model].filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()).join(' ').slice(0, 80) || null;
  return {
    id,
    name: String(name || ''),
    size: Number(size) || 0,
    type: String(type || ''),
    time,
    timeSource: time ? time.source : null,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    orientation,
    camera,
    people: Array.isArray(people) && people.length ? people.slice(0, 20) : null,
    description: String(description || '').slice(0, 500),
  };
}

// Screen captures by their usual file names (Android, iOS exports, macOS, Windows, Hebrew/German/
// French systems) - set aside by the AI-first import before anything is sent to the AI.
const SCREENSHOT_NAME = /screen ?shot|screen[_ -]?recording|screencapture|צילום[_ -]?מסך|bildschirmfoto|capture d.[ée]cran/i;

/**
 * True when a photo is very probably a screenshot: a screenshot-like file name, or a PNG with no
 * camera and no location (what phones and computers save screen captures as).
 */
export function isLikelyScreenshot(meta) {
  if (!meta) return false;
  const name = String(meta.name || '');
  if (SCREENSHOT_NAME.test(name)) return true;
  const png = /\.png$/i.test(name) || String(meta.type || '').toLowerCase() === 'image/png';
  return png && !meta.camera && meta.lat == null;
}

/** Summary of what an import contained - drives the "what we found" banner. */
export function summarizePhotoMeta(metas) {
  const list = Array.isArray(metas) ? metas : [];
  let dated = 0;
  let fromFilename = 0;
  let fromTakeout = 0;
  let fromGoogle = 0;
  let withGps = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const m of list) {
    if (m.time) {
      dated += 1;
      if (m.time.source === 'filename') fromFilename += 1;
      if (m.time.source === 'takeout') fromTakeout += 1;
      if (m.time.source === 'google') fromGoogle += 1;
      minMs = Math.min(minMs, m.time.wallMs);
      maxMs = Math.max(maxMs, m.time.wallMs);
    }
    if (m.lat != null) withGps += 1;
  }
  return {
    total: list.length,
    dated,
    undated: list.length - dated,
    fromFilename,
    fromTakeout,
    fromGoogle,
    withGps,
    firstMs: dated ? minMs : null,
    lastMs: dated ? maxMs : null,
  };
}

/** {year, month, day} -> "2023-05-14" (handy as a stable day key). */
export function dayKey(wall) {
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}
