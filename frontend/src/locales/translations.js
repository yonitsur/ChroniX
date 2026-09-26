import { en } from './en.js';
import { he } from './he.js';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', badge: 'EN', dir: 'ltr', isRtl: false },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', badge: 'עב', dir: 'rtl', isRtl: true }
];

export const translations = {
  en,
  he
};
