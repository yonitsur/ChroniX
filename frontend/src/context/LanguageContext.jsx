import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations } from '../locales/translations';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_lang');
      if (saved === 'en' || saved === 'he') return saved;
      // Default to English
      return 'en';
    } catch (e) {
      return 'en';
    }
  });

  const isRtl = language === 'he';

  // Maintain strict LTR layout direction so UI controls, top bar, and panels never shift position
  useEffect(() => {
    try {
      localStorage.setItem('chronix_lang', language);
    } catch (e) {}

    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';

    if (isRtl) {
      document.documentElement.classList.add('lang-he');
      document.documentElement.classList.add('rtl-mode');
    } else {
      document.documentElement.classList.remove('lang-he');
      document.documentElement.classList.remove('rtl-mode');
    }
  }, [language, isRtl]);

  const setLanguage = useCallback((newLang) => {
    if (newLang === 'en' || newLang === 'he') {
      setLanguageState(newLang);
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'en' ? 'he' : 'en'));
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
    const isHe = activeLang === 'he';
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
      return isHe ? `${Math.abs(y)} ${dict.bce}` : `${Math.abs(y)} ${dict.bce}`;
    }

    const monthIdx = Number(d.month) - 1;
    const monthName = dict.months[monthIdx] || d.month;

    if (d.month && d.day) {
      return isHe ? `${d.day} ב${monthName} ${y}` : `${monthName} ${d.day}, ${y}`;
    }

    if (d.month) {
      return `${monthName} ${y}`;
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
    setLanguage,
    toggleLanguage,
    t,
    formatDatePart,
    formatTimeSpan
  }), [language, isRtl, setLanguage, toggleLanguage, t, formatDatePart, formatTimeSpan]);

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
