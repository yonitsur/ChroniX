import { en } from './en.js';
import { he } from './he.js';
import { es } from './es.js';
import { de } from './de.js';
import { fr } from './fr.js';
import { pt } from './pt.js';
import { ar } from './ar.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { zh } from './zh.js';
import { hi } from './hi.js';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', badge: 'EN', dir: 'ltr', isRtl: false },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', badge: 'ES', dir: 'ltr', isRtl: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', badge: 'DE', dir: 'ltr', isRtl: false },
  { code: 'fr', label: 'French', nativeLabel: 'Français', badge: 'FR', dir: 'ltr', isRtl: false },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', badge: 'PT', dir: 'ltr', isRtl: false },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', badge: 'עב', dir: 'rtl', isRtl: true },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', badge: 'عر', dir: 'rtl', isRtl: true },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', badge: '日', dir: 'ltr', isRtl: false },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', badge: '한', dir: 'ltr', isRtl: false },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', badge: '中', dir: 'ltr', isRtl: false },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', badge: 'हि', dir: 'ltr', isRtl: false }
];

export const translations = {
  en,
  he,
  es,
  de,
  fr,
  pt,
  ar,
  ja,
  ko,
  zh,
  hi
};
