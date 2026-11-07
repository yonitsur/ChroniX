// ChroniX experience modes: General ('classic') and Kids ('kids', ages 8-11),
// paired 1:1 with their visual themes ('classic' and 'toy').

export const AGE_MODES = ['kids', 'classic'];

export const VISUAL_THEMES = ['classic', 'toy'];

export const DEFAULT_THEME_FOR_AGE = {
  kids: 'toy',
  classic: 'classic',
};

export const THEME_CLASS = {
  toy: 'theme-toy',
};

export function normalizeAgeMode(mode) {
  return mode === 'kids' ? 'kids' : 'classic';
}

export function normalizeVisualTheme(theme) {
  if (theme === 'playful' || theme === 'toy') return 'toy';
  if (theme === 'classic') return 'classic';
  return null;
}

export function toBackendContentMode(mode) {
  return normalizeAgeMode(mode);
}
