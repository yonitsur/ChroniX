import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations, SUPPORTED_LANGUAGES } from '../locales/translations.js';
import { isDefaultGroundingEnabled } from '../utils/groundingConfig.js';
import { isExtraVisualThemesEnabled } from '../utils/featureFlags.js';
import { dismissGoogleOneTap } from '../components/GoogleOneTap.jsx';
import { appendTimeOfDay, formatSpanWithTimes } from '../utils/dateTime.js';
import { AGE_MODES, DEFAULT_THEME_FOR_AGE, THEME_CLASS, normalizeAgeMode, normalizeVisualTheme } from '../data/experienceModes.js';

const LanguageContext = createContext(null);

export { SUPPORTED_LANGUAGES };

function detectSystemLanguage() {
  if (typeof navigator === 'undefined') return 'en';
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  const primary = String(langs[0] || '').toLowerCase();
  // 'iw' is the legacy code for Hebrew still reported by some Android devices
  return primary.startsWith('he') || primary.startsWith('iw') ? 'he' : 'en';
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_lang');
      const isManual = localStorage.getItem('chronix_lang_manual') === 'true';
      // Before auto-detection existed the default was 'en', so a saved 'he' was an explicit choice
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved) && (isManual || saved === 'he')) {
        return saved;
      }
      return detectSystemLanguage();
    } catch (e) {
      return detectSystemLanguage();
    }
  });

  const isRtl = language === 'he';

  const activeLanguageInfo = useMemo(() => {
    return SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem('chronix_lang', language);
    } catch (e) {}

    document.documentElement.lang = language;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

    // Remove previous language classes
    SUPPORTED_LANGUAGES.forEach((l) => {
      document.documentElement.classList.remove(`lang-${l.code}`);
    });

    // Add active language class
    document.documentElement.classList.add(`lang-${language}`);

    if (isRtl) {
      document.documentElement.classList.add('rtl-mode');
    } else {
      document.documentElement.classList.remove('rtl-mode');
    }
  }, [language, isRtl]);

  // Follow OS/browser language changes while the user has not manually chosen one
  useEffect(() => {
    const handleSystemLanguageChange = () => {
      try {
        if (localStorage.getItem('chronix_lang_manual') === 'true') return;
      } catch (e) {}
      setLanguageState(detectSystemLanguage());
    };
    window.addEventListener('languagechange', handleSystemLanguageChange);
    return () => window.removeEventListener('languagechange', handleSystemLanguageChange);
  }, []);

  const [hasChosenMode, setHasChosenMode] = useState(true);

  const markModeChosen = useCallback(() => {
    setHasChosenMode(true);
    try {
      localStorage.setItem('chronix_mode_onboarded', '1');
    } catch (e) {}
  }, []);

  const [contentMode, setContentModeState] = useState(() => {
    try {
      const savedContent = localStorage.getItem('chronix_content_mode');
      if (AGE_MODES.includes(savedContent)) return savedContent;
      // Legacy: before age groups existed, the Kids look implied Kids content
      if (localStorage.getItem('chronix_visual_theme') === 'toy') return 'kids';
      return 'classic';
    } catch (e) {
      return 'classic';
    }
  });

  const [visualTheme, setVisualThemeState] = useState(() => {
    try {
      // ?theme=classic|playful|comic|bento|journal opens the site in that look (handy for sharing previews)
      const fromUrl = normalizeVisualTheme(new URLSearchParams(window.location.search).get('theme'));
      if (fromUrl) return fromUrl;
      const legacyPreview = normalizeVisualTheme(localStorage.getItem('chronix_preview_theme'));
      localStorage.removeItem('chronix_preview_theme');
      if (legacyPreview) return legacyPreview;
      const saved = normalizeVisualTheme(localStorage.getItem('chronix_visual_theme'));
      if (saved) return saved;
    } catch (e) {}
    return DEFAULT_THEME_FOR_AGE[contentMode] || 'classic';
  });

  useEffect(() => {
    try {
      localStorage.setItem('chronix_content_mode', contentMode);
    } catch (e) {}
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.contentMode = contentMode;
    }
  }, [contentMode]);

  useEffect(() => {
    try {
      localStorage.setItem('chronix_visual_theme', visualTheme);
    } catch (e) {}
    if (typeof window !== 'undefined') {
      window.__chronixVisualTheme = visualTheme;
    }
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      Object.entries(THEME_CLASS).forEach(([theme, cls]) => {
        root.classList.toggle(cls, theme === visualTheme);
      });
    }
    try {
      window.dispatchEvent(new CustomEvent('chronix:visual-theme-change', { detail: { visualTheme } }));
    } catch (e) {}
  }, [visualTheme]);

  // Choosing an age group also switches to that age group's default look.
  const setContentMode = useCallback((mode) => {
    const next = normalizeAgeMode(mode);
    setContentModeState(next);
    setVisualThemeState(DEFAULT_THEME_FOR_AGE[next]);
    setHasChosenMode(true);
    try {
      localStorage.setItem('chronix_mode_onboarded', '1');
    } catch (e) {}
  }, []);

  const setVisualTheme = useCallback((theme) => {
    const next = normalizeVisualTheme(theme);
    if (next) setVisualThemeState(next);
  }, []);

  const setLanguage = useCallback((newLang) => {
    if (SUPPORTED_LANGUAGES.some((l) => l.code === newLang)) {
      try {
        localStorage.setItem('chronix_lang_manual', 'true');
      } catch (e) {}
      dismissGoogleOneTap();
      setLanguageState(newLang);
    }
  }, []);


  // Translation helper: resolves dot paths like 'toolbar.zoomIn' with parameter replacement
  const t = useCallback((path, params = {}) => {
    if (!path) return '';

    // Dynamically resolve grounding / creation mode copy based on the environment default
    let lookupPath = path;
    if (path === 'toolbar.groundingVerifiedTip') {
      lookupPath = isDefaultGroundingEnabled()
        ? 'toolbar.groundingVerifiedTipDefault'
        : 'toolbar.groundingVerifiedTipBase';
    } else if (path === 'toolbar.groundingFastTip') {
      lookupPath = isDefaultGroundingEnabled()
        ? 'toolbar.groundingFastTipBase'
        : 'toolbar.groundingFastTipDefault';
    } else if (path === 'aiDisclaimer.groundedVerificationText') {
      lookupPath = isDefaultGroundingEnabled()
        ? 'aiDisclaimer.groundedVerificationTextVerifiedDefault'
        : 'aiDisclaimer.groundedVerificationTextFastDefault';
    } else if (isExtraVisualThemesEnabled()) {
      if (path === 'about.heroDesc') {
        lookupPath = 'about.heroDescExtraThemes';
      } else if (path === 'about.features.3.title') {
        lookupPath = 'about.features.3.titleExtraThemes';
      } else if (path === 'about.features.3.desc') {
        lookupPath = 'about.features.3.descExtraThemes';
      } else if (path === 'auth.featuresShowcaseIntro') {
        lookupPath = 'auth.featuresShowcaseIntroExtraThemes';
      }
    }

    const walk = (root, keys) => {
      if (!root) return undefined;
      let cur = root;
      for (const k of keys) {
        if (cur && typeof cur === 'object' && k in cur) {
          cur = cur[k];
        } else {
          return undefined;
        }
      }
      return cur;
    };

    const resolvePath = (p) => {
      const keys = p.split('.');
      const overrideKey = contentMode === 'kids' ? 'kidsMode' : contentMode === 'teens' ? 'teensMode' : null;

      if (overrideKey) {
        const modeLangVal = walk(translations[language]?.[overrideKey], keys);
        if (modeLangVal !== undefined && modeLangVal !== null) return modeLangVal;
      }

      const langVal = walk(translations[language], keys);
      if (langVal !== undefined && langVal !== null) return langVal;

      if (overrideKey) {
        const modeEnVal = walk(translations.en?.[overrideKey], keys);
        if (modeEnVal !== undefined && modeEnVal !== null) return modeEnVal;
      }

      const enVal = walk(translations.en, keys);
      return enVal !== undefined ? enVal : null;
    };

    let current = resolvePath(lookupPath);
    if ((current === undefined || current === null) && lookupPath !== path) {
      current = resolvePath(path);
    }

    if (current === undefined || current === null) {
      return path;
    }

    if (typeof current === 'string') {
      let result = current;
      if (params && typeof params === 'object') {
        Object.entries(params).forEach(([paramKey, paramVal]) => {
          result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
        });
      }
      return result;
    }

    return current;
  }, [language, contentMode]);

  // Localized date formatting helpers
  const formatDatePart = useCallback((d, overrideLang) => {
    const activeLang = overrideLang || language;
    const dict = translations[activeLang]?.dates || translations.en.dates;

    if (!d) return '';
    if (typeof d === 'number') return String(d);
    if (typeof d === 'string') return d;
    if (d.year === undefined || d.year === null) return '';

    const y = Number(d.year);
    if (isNaN(y)) return String(d.year);

    if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
      const ma = Math.abs(y / 1000000);
      const maStr = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
      return `${maStr} ${dict.millionYearsAgo}`;
    }

    if (y < 0) {
      const absY = Math.abs(y);
      return `${absY} ${dict.bce}`;
    }

    const monthIdx = Number(d.month) - 1;
    const monthName = dict.months?.[monthIdx] || d.month;

    // Full Date (Year + Month + Day), plus the time of day when known
    if (d.month && d.day) {
      const fmt = dict.formatDate || "{month} {day}, {year}";
      return appendTimeOfDay(fmt.replace('{day}', d.day).replace('{month}', monthName).replace('{year}', y), d);
    }

    // Month + Year
    if (d.month) {
      return `${monthName} ${y}`;
    }

    // Year only
    return `${y}`;
  }, [language]);

  const formatTimeSpan = useCallback((from, to, isToPresent, overrideLang) => {
    const activeLang = overrideLang || language;
    const dict = translations[activeLang]?.dates || translations.en.dates;
    return formatSpanWithTimes(from, to, isToPresent, (d) => formatDatePart(d, activeLang), dict.present);
  }, [language, formatDatePart]);

  const value = useMemo(() => ({
    language,
    isRtl,
    supportedLanguages: SUPPORTED_LANGUAGES,
    activeLanguageInfo,
    setLanguage,
    contentMode,
    setContentMode,
    visualTheme,
    setVisualTheme,
    hasChosenMode,
    markModeChosen,
    t,
    formatDatePart,
    formatTimeSpan
  }), [language, isRtl, activeLanguageInfo, setLanguage, contentMode, setContentMode, visualTheme, setVisualTheme, hasChosenMode, markModeChosen, t, formatDatePart, formatTimeSpan]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
