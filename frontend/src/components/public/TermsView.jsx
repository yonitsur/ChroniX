import React from 'react';
import { FileText } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

export default function TermsView() {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).terms;

  return (
    <div className={`w-full flex-1 flex flex-col animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
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
        <p>
          {content.introP1}
        </p>

        <h2>{content.sec1Title}</h2>
        <p>
          {content.sec1P1}
        </p>

        <h2>{content.sec2Title}</h2>
        <p>
          {content.sec2P1}
        </p>

        <h2>{content.sec3Title}</h2>
        <p>
          {content.sec3P1}
        </p>

        <h2>{content.sec4Title}</h2>
        <p>
          {content.sec4P1}
        </p>

        <h2>{content.sec5Title}</h2>
        <p>
          {content.sec5P1}
        </p>

        <h2>{content.sec6Title}</h2>
        <p>
          {content.sec6Intro}
        </p>
        <p>
          <strong>{content.websiteLabel}</strong> <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a><br />
          <strong>{content.emailLabel}</strong> chronix.ai.com@gmail.com
        </p>
      </article>
    </div>
  );
}
