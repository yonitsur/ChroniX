import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

export default function PrivacyView() {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).privacy;

  return (
    <div className={`w-full flex-1 flex flex-col animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <ShieldCheck className="w-3.5 h-3.5 text-accent" />
          <span>{content.heroBadge}</span>
        </div>
        <h1>{content.heroTitle}</h1>
        <p className="public-last-updated">{content.lastUpdated}</p>
      </section>

      {/* Legal Content Container */}
      <article className="public-content-card">
        <p>
          {content.welcome}
        </p>
        <p>
          {content.intro}
        </p>

        <h2>{content.sec1Title}</h2>
        <p>{content.sec1Intro}</p>
        <ul>
          <li>
            <strong>{content.sec1Item1Title}</strong> {content.sec1Item1Desc}
          </li>
          <li>
            <strong>{content.sec1Item2Title}</strong> {content.sec1Item2Desc}
          </li>
          <li>
            <strong>{content.sec1Item3Title}</strong> {content.sec1Item3Desc}
          </li>
        </ul>

        <h2>{content.sec2Title}</h2>
        <p>{content.sec2Intro}</p>
        <ul>
          <li>{content.sec2Item1}</li>
          <li>{content.sec2Item2}</li>
          <li>{content.sec2Item3}</li>
          <li>{content.sec2Item4}</li>
        </ul>

        <div className="public-callout">
          <strong>{content.calloutTitle}</strong><br />
          {content.calloutDesc}{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
        </div>

        <h2>{content.sec3Title}</h2>
        <p>
          <strong>{content.sec3P1}</strong>
        </p>
        <p>{content.sec3P2}</p>

        <h2>{content.sec4Title}</h2>
        <p>{content.sec4P1}</p>

        <h2>{content.sec5Title}</h2>
        <p>{content.sec5P1}</p>

        <h2>{content.sec6Title}</h2>
        <p>{content.sec6P1}</p>

        <h2>{content.sec7Title}</h2>
        <p>{content.sec7Intro}</p>
        <p>
          <strong>{content.websiteLabel}</strong> <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a><br />
          <strong>{content.emailLabel}</strong> chronix.ai.com@gmail.com
        </p>
      </article>
    </div>
  );
}
