import { hasTimeOfDay, formatTimeOfDay, normalizeDatePrecision } from '../../utils/dateTime';
import { INLINE_IMAGE_MAX_CHARS } from '../../utils/inlineImageBudget';
import { encodeImageToBudget } from '../../utils/inlineImageCompress';

// "HH:MM" value for <input type="time">, or '' when the date has no time of day.
export const toTimeInputValue = (d) => (hasTimeOfDay(d) ? formatTimeOfDay(d) : '');

// Applies an "HH:MM" input to a date object. The time wins over a coarser precision; without a
// usable time (or without a day) precision is derived from the finest calendar part present.
export function applyTimeInput(date, timeStr, basePrecision) {
  const match = date.day ? /^(\d{1,2}):(\d{2})/.exec(timeStr || '') : null;
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) {
    return normalizeDatePrecision({ ...date, precision: basePrecision });
  }
  if (basePrecision === 'hour') return normalizeDatePrecision({ ...date, hour, precision: 'hour' });
  return normalizeDatePrecision({ ...date, hour, minute, precision: 'minute' });
}

// Uploaded photos are downscaled client-side and stored inline as a data URL in `imageUrl`,
// so they render everywhere images already do without any backend/storage changes.
export const MAX_IMAGE_DIM = 900;
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // reject source files larger than 12MB

// The result is compressed once, here, to the inline budget (P-10): the app stores exactly this URL,
// so later saves never re-encode it. PNG keeps its transparency while it fits; otherwise it becomes
// a JPEG on white, which is what a save-time pass would have turned it into anyway.
export function fileToCompressedDataUrl(file, maxDim = MAX_IMAGE_DIM, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-failed'));
      img.onload = () => {
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        encodeImageToBudget(img, { maxDim, maxChars: INLINE_IMAGE_MAX_CHARS, mime, quality })
          .then(resolve, reject);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const RTL_CHARS = /[֐-׿؀-ۿ]/;

/** Text direction for an input: follows its content, falling back to the interface direction. */
export const inputDir = (value, isRtl) => (value ? (RTL_CHARS.test(value) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr'));

/** Best-effort source name for a pasted reference URL ('' when nothing sensible is found). */
export function guessSourceName(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower.includes('wikipedia.org')) return 'Wikipedia';
  if (lower.includes('britannica.com')) return 'Encyclopaedia Britannica';
  if (lower.includes('nasa.gov')) return 'NASA';
  if (lower.includes('nationalgeographic.com')) return 'National Geographic';
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
  return '';
}

export const isGifUrl = (url) => {
  const lower = String(url || '').trim().toLowerCase();
  return lower.endsWith('.gif') || lower.includes('.gif?');
};

export const PRECISION_OPTIONS = [
  'minute', 'hour', 'day', 'month', 'year', 'decade', 'century', 'millennium', 'million-years', 'billion-years',
];

export const PRECISION_LABEL_KEYS = {
  minute: 'precisionMinute',
  hour: 'precisionHour',
  day: 'precisionDay',
  month: 'precisionMonth',
  year: 'precisionYear',
  decade: 'precisionDecade',
  century: 'precisionCentury',
  millennium: 'precisionMillennium',
  'million-years': 'precisionMillionYears',
  'billion-years': 'precisionBillionYears',
};
