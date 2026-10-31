import { en } from './en.js';
import { he } from './he.js';
import { isExtraVisualThemesEnabled } from '../../utils/featureFlags.js';

export const publicPagesTranslations = {
  en,
  he
};

/**
 * Helper to retrieve localized public page content with automatic English fallback.
 * Feature-flagged copy (such as independent visual theme selection) is surfaced
 * only when the corresponding feature flag is enabled.
 */
export function getPublicPageContent(lang) {
  const base = publicPagesTranslations[lang] || publicPagesTranslations.en;
  if (!isExtraVisualThemesEnabled() || !base?.features?.items) {
    return base;
  }
  return {
    ...base,
    features: {
      ...base.features,
      items: base.features.items.map((item) =>
        item.titleExtraThemes || item.descExtraThemes
          ? {
              ...item,
              title: item.titleExtraThemes || item.title,
              desc: item.descExtraThemes || item.desc,
            }
          : item
      ),
    },
  };
}
