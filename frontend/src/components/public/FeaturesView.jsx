import React from 'react';
import {
  Sparkles,
  Clock,
  Globe,
  ArrowRight,
  Layers,
  ShieldCheck,
  Download,
  Share2,
  MessageSquare,
  Compass,
  Camera,
  Smartphone,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

// Toggle to re-enable the mobile compatibility feature once mobile support ships.
const SHOW_MOBILE_FEATURE = false;

const ICON_MAP = {
  Clock,
  Sparkles,
  Globe,
  Download,
  Share2,
  MessageSquare,
  Layers,
  ShieldCheck,
  Compass,
  Camera,
  Smartphone,
};

export default function FeaturesView({ onEnter }) {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).features;

  const items = content.items || [
    { id: 'f1', icon: 'Clock', title: content.f1Title, desc: content.f1Desc },
    { id: 'f2', icon: 'Sparkles', title: content.f2Title, desc: content.f2Desc },
    { id: 'f3', icon: 'Globe', title: content.f3Title, desc: content.f3Desc },
    { id: 'f4', icon: 'Download', title: content.f6Title, desc: content.f6Desc },
    { id: 'f5', icon: 'Layers', title: content.f4Title, desc: content.f4Desc },
    { id: 'f6', icon: 'ShieldCheck', title: content.f5Title, desc: content.f5Desc },
  ];

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

      {/* Features Grid */}
      <main className="public-feature-grid">
        {items.map((item) => {
          const IconComp = ICON_MAP[item.icon] || Sparkles;
          return (
            <div key={item.id || item.title} className="public-feature-card">
              <div className="public-feature-icon">
                <IconComp className="w-5 h-5 text-accent" />
              </div>
              <h3 className="public-feature-title">{item.title}</h3>
              <p className="public-feature-desc">{item.desc}</p>
            </div>
          );
        })}

        {/* Mobile Compatibility (disabled until mobile support ships) */}
        {SHOW_MOBILE_FEATURE && (
          <div className="public-feature-card">
            <div className="public-feature-icon">
              <Smartphone className="w-5 h-5 text-accent" />
            </div>
            <h3 className="public-feature-title">Mobile-Optimized Experience</h3>
            <p className="public-feature-desc">
              Explore timelines on the go with a touch-first vertical view: pinch to zoom, swipe through eras, and filter events by theme on any phone.
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
