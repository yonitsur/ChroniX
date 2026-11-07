// Applies the saved light/dark and kids theme before first paint (avoids a theme flash).
// A plain blocking file instead of an inline <script>, so the CSP needs no 'unsafe-inline' (S-08).
(function() {
  try {
    var isManual = localStorage.getItem('vt_theme_manual') === 'true';
    var theme = isManual ? localStorage.getItem('vt_theme') : null;
    if (!theme || (theme !== 'dark' && theme !== 'light')) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    var contentMode = localStorage.getItem('chronix_content_mode');
    var visualTheme = localStorage.getItem('chronix_visual_theme');
    if (contentMode === 'kids' || (!contentMode && visualTheme === 'toy')) {
      document.documentElement.classList.add('theme-toy');
      window.__chronixVisualTheme = 'toy';
      // Kids-mode fonts are only fetched in Kids mode (src/utils/kidsFonts.js adds them later
      // if the mode is switched on during the visit). Same id, so it is never added twice.
      var kidsFonts = document.createElement('link');
      kidsFonts.id = 'chronix-webfonts-kids';
      kidsFonts.rel = 'stylesheet';
      kidsFonts.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Rubik:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(kidsFonts);
    }
  } catch (e) {}
})();

// Applies the Google Fonts stylesheet once it has loaded. It is linked with media="print" so it
// neither blocks first paint nor delays the app scripts; an inline onload handler would need
// 'unsafe-inline' in the CSP, so the swap lives here.
(function() {
  try {
    var link = document.getElementById('chronix-webfonts');
    if (!link || link.media === 'all') return;
    var apply = function() { link.media = 'all'; };
    if (link.sheet) {
      apply();
      return;
    }
    link.addEventListener('load', apply);
  } catch (e) {}
})();
