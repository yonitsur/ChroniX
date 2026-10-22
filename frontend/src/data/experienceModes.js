// Age group (content + tone) and visual theme (look only) are independent settings.
// Picking an age group applies its default theme; picking a theme never changes the age group.

export const AGE_MODES = ['kids', 'teens', 'classic'];

export const VISUAL_THEMES = ['classic', 'toy', 'comic', 'bento', 'journal'];

export const DEFAULT_THEME_FOR_AGE = {
  kids: 'toy',
  teens: 'bento',
  classic: 'classic',
};

// <html> class applied for each visual theme ('classic' has none)
export const THEME_CLASS = {
  toy: 'theme-toy',
  comic: 'theme-comic',
  bento: 'theme-bento',
  journal: 'theme-journal',
};

export function normalizeAgeMode(mode) {
  if (mode === 'kids' || mode === 'toy') return 'kids';
  if (mode === 'teens') return 'teens';
  return 'classic';
}

export function normalizeVisualTheme(theme) {
  if (theme === 'playful' || theme === 'kids') return 'toy';
  return VISUAL_THEMES.includes(theme) ? theme : null;
}

// The backend tailors content and tone for each age group.
export function toBackendContentMode(mode) {
  return normalizeAgeMode(mode);
}
