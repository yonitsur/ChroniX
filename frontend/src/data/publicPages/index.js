import { en } from './en.js';
import { he } from './he.js';
import { ar } from './ar.js';
import { es } from './es.js';
import { de } from './de.js';
import { fr } from './fr.js';
import { pt } from './pt.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { zh } from './zh.js';
import { hi } from './hi.js';

export const publicPagesTranslations = {
  en,
  he,
  ar,
  es,
  de,
  fr,
  pt,
  ja,
  ko,
  zh,
  hi
};

/**
 * Helper to retrieve localized public page content with automatic English fallback.
 */
export function getPublicPageContent(lang) {
  return publicPagesTranslations[lang] || publicPagesTranslations.en;
}
