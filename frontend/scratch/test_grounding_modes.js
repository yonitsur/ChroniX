// Test script to verify dynamic resolution of grounding mode copy across locales and configurations.

import { translations } from '../src/locales/translations.js';

function simulateT(language, defaultMode, path) {
  const isDefaultGrounding = defaultMode === 'verified';

  let lookupPath = path;
  if (path === 'toolbar.groundingVerifiedTip') {
    lookupPath = isDefaultGrounding
      ? 'toolbar.groundingVerifiedTipDefault'
      : 'toolbar.groundingVerifiedTipBase';
  } else if (path === 'toolbar.groundingFastTip') {
    lookupPath = isDefaultGrounding
      ? 'toolbar.groundingFastTipBase'
      : 'toolbar.groundingFastTipDefault';
  } else if (path === 'aiDisclaimer.groundedVerificationText') {
    lookupPath = isDefaultGrounding
      ? 'aiDisclaimer.groundedVerificationTextVerifiedDefault'
      : 'aiDisclaimer.groundedVerificationTextFastDefault';
  }

  const resolvePath = (p) => {
    const keys = p.split('.');
    let current = translations[language];

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
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
    return current;
  };

  let current = resolvePath(lookupPath);
  if ((current === undefined || current === null) && lookupPath !== path) {
    current = resolvePath(path);
  }
  return current;
}

console.log('--- Testing FAST mode default ---');
console.log('Hebrew Fast Tip:', simulateT('he', 'fast', 'toolbar.groundingFastTip'));
console.log('Hebrew Verified Tip:', simulateT('he', 'fast', 'toolbar.groundingVerifiedTip'));
console.log('Hebrew Disclaimer:', simulateT('he', 'fast', 'aiDisclaimer.groundedVerificationText').slice(0, 50) + '...');

console.log('\nEnglish Fast Tip:', simulateT('en', 'fast', 'toolbar.groundingFastTip'));
console.log('English Verified Tip:', simulateT('en', 'fast', 'toolbar.groundingVerifiedTip'));
console.log('English Disclaimer:', simulateT('en', 'fast', 'aiDisclaimer.groundedVerificationText').slice(0, 50) + '...');

console.log('\n--- Testing VERIFIED mode default ---');
console.log('Hebrew Fast Tip:', simulateT('he', 'verified', 'toolbar.groundingFastTip'));
console.log('Hebrew Verified Tip:', simulateT('he', 'verified', 'toolbar.groundingVerifiedTip'));
console.log('Hebrew Disclaimer:', simulateT('he', 'verified', 'aiDisclaimer.groundedVerificationText').slice(0, 50) + '...');

console.log('\nEnglish Fast Tip:', simulateT('en', 'verified', 'toolbar.groundingFastTip'));
console.log('English Verified Tip:', simulateT('en', 'verified', 'toolbar.groundingVerifiedTip'));
console.log('English Disclaimer:', simulateT('en', 'verified', 'aiDisclaimer.groundedVerificationText').slice(0, 50) + '...');

// Assertions
// In FAST mode:
if (!simulateT('he', 'fast', 'toolbar.groundingFastTip').includes('ברירת מחדל')) {
  throw new Error('Hebrew Fast Tip in fast mode must mention ברירת מחדל');
}
if (simulateT('he', 'fast', 'toolbar.groundingVerifiedTip').includes('ברירת מחדל')) {
  throw new Error('Hebrew Verified Tip in fast mode must NOT mention ברירת מחדל');
}
if (!simulateT('he', 'fast', 'aiDisclaimer.groundedVerificationText').includes('כברירת מחדל (במצב ״מהיר״)')) {
  throw new Error('Hebrew Disclaimer in fast mode must mention כברירת מחדל (במצב ״מהיר״)');
}

// In VERIFIED mode:
if (simulateT('he', 'verified', 'toolbar.groundingFastTip').includes('ברירת מחדל')) {
  throw new Error('Hebrew Fast Tip in verified mode must NOT mention ברירת מחדל');
}
if (!simulateT('he', 'verified', 'toolbar.groundingVerifiedTip').includes('ברירת מחדל')) {
  throw new Error('Hebrew Verified Tip in verified mode must mention ברירת מחדל');
}
if (!simulateT('he', 'verified', 'aiDisclaimer.groundedVerificationText').includes('כברירת מחדל (במצב ״מאומת״)')) {
  throw new Error('Hebrew Disclaimer in verified mode must mention כברירת מחדל (במצב ״מאומת״)');
}

// Check all languages
const langs = ['en', 'he', 'es', 'de', 'fr', 'pt', 'ar', 'ja', 'ko', 'zh', 'hi'];
for (const l of langs) {
  const gvFast = simulateT(l, 'fast', 'toolbar.groundingVerifiedTip');
  const gfFast = simulateT(l, 'fast', 'toolbar.groundingFastTip');
  const gdFast = simulateT(l, 'fast', 'aiDisclaimer.groundedVerificationText');
  if (!gvFast || !gfFast || !gdFast) {
    throw new Error(`Missing string in language ${l}`);
  }
}

console.log('\nAll assertions PASSED for all languages!');
