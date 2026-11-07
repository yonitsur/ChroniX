import './index.css';
import { detectInitialLanguage, ensureLanguageLoaded } from './locales/translations.js';
import { installVitePreloadErrorHandler, tryRecoverFromChunkError } from './utils/chunkLoadRecovery.js';

installVitePreloadErrorHandler();

// The entry stays tiny: the locale bundle and the app chunk (React, App, providers) are
// requested together, instead of the locale only being discovered after the whole app
// bundle has downloaded and run. Rendering still waits for the locale, so Hebrew users
// never see an English first paint.
const initialLanguage = detectInitialLanguage();
const localeReady = ensureLanguageLoaded(initialLanguage);
// LanguageProvider sets these in an effect after its first render; set them now so the first
// painted frame already has the right direction.
document.documentElement.lang = initialLanguage;
document.documentElement.dir = initialLanguage === 'he' ? 'rtl' : 'ltr';
const appReady = import('./bootApp.jsx');

Promise.all([appReady, localeReady.catch(() => null)])
  .then(([{ renderApp }]) => renderApp(document.getElementById('root')))
  .catch((err) => {
    if (!tryRecoverFromChunkError(err)) console.error('Failed to start ChroniX:', err);
  });
