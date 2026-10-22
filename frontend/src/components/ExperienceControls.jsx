import React from 'react';

export const AGE_OPTIONS = [
  { id: 'kids', labelKey: 'toolbar.ageModeKids', rangeKey: 'toolbar.ageModeKidsRange' },
  { id: 'teens', labelKey: 'toolbar.ageModeTeens', rangeKey: 'toolbar.ageModeTeensRange' },
  { id: 'classic', labelKey: 'toolbar.ageModeClassic', rangeKey: 'toolbar.ageModeClassicRange' },
];

export const THEME_OPTIONS = [
  { id: 'classic', labelKey: 'toolbar.visualThemeClassic' },
  { id: 'toy', labelKey: 'toolbar.visualThemeToy' },
  { id: 'bento', labelKey: 'toolbar.visualThemeBento' },
  { id: 'comic', labelKey: 'toolbar.visualThemeComic' },
  { id: 'journal', labelKey: 'toolbar.visualThemeJournal' },
];

// Inline styles only, so no theme layer can restyle the previews themselves.
const SWATCH_STYLES = {
  classic: {
    background: 'linear-gradient(135deg, #ffffff 0 55%, #e4e4e7 55% 100%)',
    border: '1px solid #a1a1aa',
    borderRadius: 6,
  },
  toy: {
    background: 'linear-gradient(135deg, #fde047 0 55%, #38bdf8 55% 100%)',
    border: '2px solid #0f172a',
    borderRadius: 7,
  },
  comic: {
    background: 'radial-gradient(rgba(17,17,17,0.35) 0.8px, transparent 1px) 0 0 / 4px 4px, linear-gradient(135deg, #ffd23f 0 55%, #e63946 55% 100%)',
    border: '2px solid #111111',
    borderRadius: 3,
    boxShadow: '1.5px 1.5px 0 #111111',
  },
  bento: {
    background: 'linear-gradient(135deg, #f59e0b, #8b5cf6 55%, #0ea5e9)',
    border: '1px solid rgba(17,17,24,0.08)',
    borderRadius: 7,
  },
  journal: {
    background: 'linear-gradient(90deg, transparent 0 22%, rgba(214,69,65,0.7) 22% 28%, transparent 28%), repeating-linear-gradient(180deg, #fbf6e9 0 3px, #9fb6d6 3px 4px)',
    border: '1px solid #8b7355',
    borderRadius: 2,
    boxShadow: '1.5px 1.5px 0 rgba(90,70,40,0.25)',
  },
};

export function ThemeSwatch({ theme, size = 16 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{ width: size, height: size, boxSizing: 'border-box', ...(SWATCH_STYLES[theme] || SWATCH_STYLES.classic) }}
    />
  );
}
