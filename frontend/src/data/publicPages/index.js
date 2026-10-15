import { en } from './en.js';
import { he } from './he.js';

export const publicPagesTranslations = {
  en,
  he
};

/**
 * Helper to retrieve localized public page content with automatic English fallback.
 */
export function getPublicPageContent(lang) {
  return publicPagesTranslations[lang] || publicPagesTranslations.en;
}
