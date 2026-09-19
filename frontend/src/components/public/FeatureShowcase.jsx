import React from 'react';
import { Heart } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import CommunityTimelinesWall from '../CommunityTimelinesWall';

export default function FeatureShowcase({
  onSelectTimeline,
  onOpenComments,
  commentCountOverrides,
  isAdmin = false
}) {
  const { t, isRtl } = useLanguage();

  return (
    <section
      id="features-showcase"
      className="w-full max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-12 select-none border-t border-line/60 mt-16"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-4xl mx-auto mb-10 text-center" dir={isRtl ? 'rtl' : 'ltr'}>
        <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-[1.18] mb-4 sm:mb-5 font-sans">
          {t('auth.landingHeroTitle') || 'Explore History Across Parallel Dimensions'}
        </h2>

        <p className="text-base sm:text-lg md:text-xl text-slate-700 dark:text-slate-300 leading-relaxed max-w-4xl mx-auto font-medium mb-10 sm:mb-12">
          {t('auth.landingHeroSubtitle') ||
            'ChroniX synthesizes world history into interactive, multi-lane timelines. Compare parallel eras, map global events in real-time, and uncover deep historical connections powered by advanced AI.'}{' '}
          {t('auth.featuresShowcaseSubtitle') ||
            'ChroniX unifies advanced data visualization with artificial intelligence to reveal the flow of human history and cross-cultural milestones.'}
        </p>

        <div className="flex items-start justify-center gap-2.5 mt-2 text-ink-muted">
          <Heart className="w-4 h-4 mt-0.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <div className="text-xs sm:text-sm leading-relaxed text-start">
            <span className="font-bold text-ink">
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

      {/* Replaced static info bubbles with dynamic Public Timelines Wall */}
      <CommunityTimelinesWall
        onSelectTimeline={onSelectTimeline}
        onOpenComments={onOpenComments}
        commentCountOverrides={commentCountOverrides}
        isAdmin={isAdmin}
      />

    </section>
  );
}
