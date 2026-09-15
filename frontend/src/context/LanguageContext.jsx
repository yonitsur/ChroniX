import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations, SUPPORTED_LANGUAGES } from '../locales/translations.js';

const LanguageContext = createContext(null);

export { SUPPORTED_LANGUAGES };

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_lang');
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        return saved;
      }
      return 'en';
    } catch (e) {
      return 'en';
    }
  });

  const isRtl = language === 'he' || language === 'ar';

  const activeLanguageInfo = useMemo(() => {
    return SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];
  }, [language]);

  // Maintain strict LTR layout direction so UI controls, top bar, and canvas coordinates never break
  useEffect(() => {
    try {
      localStorage.setItem('chronix_lang', language);
    } catch (e) {}

    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';

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

  const setLanguage = useCallback((newLang) => {
    if (SUPPORTED_LANGUAGES.some((l) => l.code === newLang)) {
      setLanguageState(newLang);
    }
  }, []);


  // Translation helper: resolves dot paths like 'toolbar.zoomIn' with parameter replacement
  const t = useCallback((path, params = {}) => {
    if (!path) return '';

    const keys = path.split('.');
    let current = translations[language];

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        // Fallback to English if missing in current language
        let fallback = translations.en;
        for (const fbKey of keys) {
          if (fallback && typeof fallback === 'object' && fbKey in fallback) {
            fallback = fallback[fbKey];
          } else {
            fallback = null;
            break;
          }
        }
        current = fallback;
        break;
      }
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
  }, [language]);

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
      if (activeLang === 'ja' || activeLang === 'zh') {
        return `${dict.bce} ${absY}年`;
      }
      if (activeLang === 'ko') {
        return `${dict.bce} ${absY}년`;
      }
      return `${absY} ${dict.bce}`;
    }

    const monthIdx = Number(d.month) - 1;
    const monthName = dict.months?.[monthIdx] || d.month;

    // Full Date (Year + Month + Day)
    if (d.month && d.day) {
      switch (activeLang) {
        case 'ja':
        case 'zh':
          return `${y}年${d.month}月${d.day}日`;
        case 'ko':
          return `${y}년 ${d.month}월 ${d.day}일`;
        case 'he':
          return `${d.day} ב${monthName} ${y}`;
        case 'ar':
          return `${d.day} ${monthName} ${y}`;
        case 'de':
          return `${d.day}. ${monthName} ${y}`;
        case 'es':
        case 'pt':
          return `${d.day} de ${monthName} de ${y}`;
        case 'fr':
          return `${d.day} ${monthName} ${y}`;
        case 'hi':
          return `${d.day} ${monthName} ${y}`;
        default:
          return `${monthName} ${d.day}, ${y}`;
      }
    }

    // Month + Year
    if (d.month) {
      switch (activeLang) {
        case 'ja':
        case 'zh':
          return `${y}年${d.month}月`;
        case 'ko':
          return `${y}년 ${d.month}월`;
        case 'es':
        case 'pt':
          return `${monthName} de ${y}`;
        default:
          return `${monthName} ${y}`;
      }
    }

    // Year only
    if (activeLang === 'ja' || activeLang === 'zh') {
      return `${y}年`;
    }
    if (activeLang === 'ko') {
      return `${y}년`;
    }

    return `${y}`;
  }, [language]);

  const formatTimeSpan = useCallback((from, to, isToPresent, overrideLang) => {
    const activeLang = overrideLang || language;
    const dict = translations[activeLang]?.dates || translations.en.dates;
    const fromStr = formatDatePart(from, activeLang);

    if (isToPresent) {
      return fromStr ? `${fromStr} – ${dict.present}` : dict.present;
    }

    if (!to) return fromStr;
    const toStr = formatDatePart(to, activeLang);
    if (!fromStr) return toStr;
    if (fromStr === toStr) return fromStr;

    return `${fromStr} – ${toStr}`;
  }, [language, formatDatePart]);

  const value = useMemo(() => ({
    language,
    isRtl,
    supportedLanguages: SUPPORTED_LANGUAGES,
    activeLanguageInfo,
    setLanguage,
    t,
    formatDatePart,
    formatTimeSpan
  }), [language, isRtl, activeLanguageInfo, setLanguage, t, formatDatePart, formatTimeSpan]);

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
