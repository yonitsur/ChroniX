import React, { useState } from 'react';
import { FileText, Code2, ArrowRight, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';
import OpenSourceView from './OpenSourceView';

export default function TermsView({ onOpenOpenSource, onOpenPublicRoute }) {
  const [internalOpenSource, setInternalOpenSource] = useState(false);
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).terms;

  const handleGoToOpenSource = (e) => {
    if (e) e.preventDefault();
    if (onOpenOpenSource) {
      onOpenOpenSource();
    } else if (onOpenPublicRoute) {
      onOpenPublicRoute('open-source');
    } else {
      setInternalOpenSource(true);
    }
  };

  const handleGoToPrivacy = (e) => {
    if (onOpenPublicRoute) {
      e.preventDefault();
      onOpenPublicRoute('privacy');
    }
  };

  if (internalOpenSource) {
    return <OpenSourceView onBackToTerms={() => setInternalOpenSource(false)} />;
  }

  const ArrowForwardIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      className={`w-full flex-1 flex flex-col animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <FileText className="w-3.5 h-3.5 text-accent" />
          <span>{content.heroBadge}</span>
        </div>
        <h1>{content.heroTitle}</h1>
        <p className="public-last-updated">{content.lastUpdated}</p>
      </section>

      {/* Legal Content Container */}
      <article className="public-content-card">
        {/* Intro */}
        <p>
          {content.introP1}
          <a
            href="https://chronix-ai.com/privacy"
            onClick={handleGoToPrivacy}
            className="font-medium text-accent hover:underline cursor-pointer"
          >
            {content.privacyLinkText || 'https://chronix-ai.com/privacy'}
          </a>
          .
        </p>
        <p>
          {content.introP2}
        </p>

        {/* 1. Use of the Website */}
        <h2>{content.sec1Title}</h2>
        <p>{content.sec1P1}</p>
        <p>{content.sec1P2}</p>

        {/* 2. User Account */}
        <h2>{content.sec2Title}</h2>
        <p>{content.sec2P1}</p>
        <p>{content.sec2P2}</p>
        <p>{content.sec2P3}</p>

        {/* 3. Intellectual Property */}
        <h2>{content.sec3Title}</h2>
        <p>{content.sec3P1}</p>
        <p>{content.sec3P2}</p>

        {/* 4. Links to Third-Party Websites */}
        <h2>{content.sec4Title}</h2>
        <p>{content.sec4P1}</p>

        {/* 5. Third-Party Content */}
        <h2>{content.sec5Title}</h2>
        <p>{content.sec5P1}</p>

        {/* 6. Open Source Components */}
        <h2>{content.sec6Title}</h2>
        <p>
          {content.sec6P1}{' '}
          <button
            type="button"
            onClick={handleGoToOpenSource}
            className="inline-flex items-center gap-1 font-semibold text-accent hover:text-accent-hover underline underline-offset-4 cursor-pointer transition-colors"
          >
            <span>{content.openSourceLinkText}</span>
            <ArrowForwardIcon className="w-3.5 h-3.5" />
          </button>
        </p>

        {/* Dedicated interactive callout box for Open Source */}
        <div className="public-callout my-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-soft border border-accent/25 flex items-center justify-center shrink-0">
              <Code2 className="w-4 h-4 text-accent" />
            </div>
            <div>
              <div className="font-semibold text-ink text-sm">{content.openSourceBoxTitle}</div>
              <div className="text-xs text-ink-muted">{content.openSourceBoxDesc}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleGoToOpenSource}
            className="group cursor-pointer inline-flex items-center gap-2 px-3.5 py-1.5 rounded-control text-xs font-medium text-ink bg-surface-raised hover:bg-surface-hover border border-line hover:border-line-strong transition-all shadow-2xs shrink-0 active:scale-95"
          >
            <span>{content.openSourceLinkText}</span>
            <ArrowForwardIcon className="w-3.5 h-3.5 text-ink-muted group-hover:text-ink transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
          </button>
        </div>

        {/* 7. Disclaimer of Warranties */}
        <h2>{content.sec7Title}</h2>
        <p>{content.sec7P1}</p>
        <p>{content.sec7P2}</p>
        <p>{content.sec7P3}</p>

        {/* 8. Limitation of Liability */}
        <h2>{content.sec8Title}</h2>
        <p>{content.sec8P1}</p>

        {/* 9. Governing Law */}
        <h2>{content.sec9Title}</h2>
        <p>{content.sec9P1}</p>

        {/* 10. Contact Information */}
        <h2>{content.sec10Title}</h2>
        <p>{content.sec10Intro}</p>
        <p>
          <strong>{content.websiteLabel}</strong>{' '}
          <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">
            {content.contactWebsite || 'https://chronix-ai.com'}
          </a>
          <br />
          <strong>{content.emailLabel}</strong>{' '}
          <a href={`mailto:${content.contactEmail || 'chronixaicom@gmail.com'}`}>
            {content.contactEmail || 'chronixaicom@gmail.com'}
          </a>
        </p>
      </article>
    </div>
  );
}
