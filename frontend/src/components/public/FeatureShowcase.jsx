import React from 'react';
import { Heart } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export default function FeatureShowcase() {
  const { t, isRtl } = useLanguage();

  return (
    <section
      id="features-showcase"
      className="w-full max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-12 select-none border-t border-line/60 mt-16"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-4xl mx-auto mb-10 text-center">
        <h2 className="text-2xl sm:text-4xl font-semibold text-ink tracking-tighter leading-[1.15] mb-4 sm:mb-5 font-sans text-center">
          {t('auth.landingHeroTitle') || 'Explore History Across Parallel Dimensions'}
        </h2>

        <p className="text-base sm:text-lg md:text-xl text-ink-muted leading-relaxed max-w-4xl mx-auto mb-10 sm:mb-12 text-center">
          {t('auth.featuresShowcaseIntro') ||
            'ChroniX synthesizes world history into interactive, multi-lane timelines, allowing you to compare parallel eras side-by-side, explore synchronized global maps, and uncover deep cross-cultural connections powered by advanced AI.'}
        </p>

        <div className="flex items-center justify-center gap-2.5 mt-2 text-ink-muted">
          <Heart className="w-4 h-4 text-success shrink-0" />
          <div className="text-xs sm:text-sm leading-relaxed text-center sm:text-start">
            <span className="font-semibold text-ink">
              {t('auth.freeNonProfitTitle') || 'Free & Non-Profit Project'}
            </span>
            <span className="mx-2 text-ink-faint" aria-hidden="true">/</span>
            <span>
              {t('auth.freeNonProfitDesc') ||
                'ChroniX is an independent, non-profit project created for fun, learning, and an interactive experience. Completely free with no ads or paywalls.'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
