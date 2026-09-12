import React from 'react';
import { Sparkles, Clock, Globe, ArrowRight, Layers, ShieldCheck, Camera, Smartphone } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

// Toggle to re-enable the mobile compatibility feature once mobile support ships.
const SHOW_MOBILE_FEATURE = false;

export default function FeaturesView({ onEnter }) {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).features;

  return (
    <div className={`w-full flex-1 flex flex-col animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span>{content.heroBadge}</span>
        </div>
        <h1>{content.heroTitle}</h1>
        <p className="public-subtitle">
          {content.heroSubtitle}
        </p>
      </section>

      {/* 6 Features Grid */}
      <main className="public-feature-grid">
        {/* 1. Cartesian Timelines */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Clock className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f1Title}</h3>
          <p className="public-feature-desc">
            {content.f1Desc}
          </p>
        </div>

        {/* 2. AI Historical Engine */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Sparkles className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f2Title}</h3>
          <p className="public-feature-desc">
            {content.f2Desc}
          </p>
        </div>

        {/* 3. Geospatial Mapping */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Globe className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f3Title}</h3>
          <p className="public-feature-desc">
            {content.f3Desc}
          </p>
        </div>

        {/* 4. Cross-Cultural Comparisons */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Layers className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f4Title}</h3>
          <p className="public-feature-desc">
            {content.f4Desc}
          </p>
        </div>

        {/* 5. Cloud Research & Sync */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <ShieldCheck className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f5Title}</h3>
          <p className="public-feature-desc">
            {content.f5Desc}
          </p>
        </div>

        {/* 6. High-Resolution Visual Export */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Camera className="w-5 h-5 text-accent" />
          </div>
          <h3 className="public-feature-title">{content.f6Title}</h3>
          <p className="public-feature-desc">
            {content.f6Desc}
          </p>
        </div>

        {/* 7. Mobile Compatibility (disabled until mobile support ships) */}
        {SHOW_MOBILE_FEATURE && (
          <div className="public-feature-card">
            <div className="public-feature-icon">
              <Smartphone className="w-5 h-5 text-accent" />
            </div>
            <h3 className="public-feature-title">Mobile-Optimized Experience</h3>
            <p className="public-feature-desc">
              Explore timelines on the go with a touch-first vertical view—pinch to zoom, swipe through eras, and filter events by theme on any phone.
            </p>
          </div>
        )}
      </main>

      {/* Call to Action Box */}
      <div className="public-cta-box">
        <h3>{content.ctaHeading}</h3>
        <p>{content.ctaDesc}</p>
        <button type="button" onClick={onEnter} className="public-cta-button">
          <span>{content.ctaBtn}</span>
          <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}
