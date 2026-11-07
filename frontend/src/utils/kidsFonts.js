// Kids mode uses its own rounded fonts (Fredoka, Rubik). They are not part of the default font
// request in index.html, so General mode never downloads them: public/theme-init.js adds the
// stylesheet before first paint when a visit starts in Kids mode, and this adds it when Kids
// mode is switched on during a visit. Both use the same id, so it is only ever added once.
export const KIDS_FONTS_ID = 'chronix-webfonts-kids';
export const KIDS_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Rubik:wght@400;500;600;700;800&display=swap';

export function ensureKidsFonts(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.head || doc.getElementById(KIDS_FONTS_ID)) return false;
  const link = doc.createElement('link');
  link.id = KIDS_FONTS_ID;
  link.rel = 'stylesheet';
  link.href = KIDS_FONTS_HREF;
  doc.head.appendChild(link);
  return true;
}
