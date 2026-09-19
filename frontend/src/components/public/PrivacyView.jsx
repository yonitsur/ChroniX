import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

export default function PrivacyView() {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).privacy;
  const email = content.contactEmail || 'chronixaicom@gmail.com';

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
        <p>{content.welcome}</p>
        <p>{content.intro}</p>
        {content.voluntaryNotice && (
          <p className="italic font-medium text-slate-700 dark:text-slate-300">
            {content.voluntaryNotice}
          </p>
        )}

        <h2>{content.sec1Title}</h2>
        <p>{content.sec1Intro}</p>
        <ol className="list-decimal space-y-2">
          <li>
            <strong>{content.sec1Item1Title}</strong> {content.sec1Item1Desc}
          </li>
          <li>
            <strong>{content.sec1Item2Title}</strong> {content.sec1Item2Desc}
          </li>
          <li>
            <strong>{content.sec1Item3Title}</strong> {content.sec1Item3Desc}
          </li>
          <li>
            <strong>{content.sec1Item4Title}</strong> {content.sec1Item4Desc}
          </li>
        </ol>

        <h2>{content.sec2Title}</h2>
        <p>{content.sec2Intro}</p>
        <ul className="list-disc space-y-2">
          <li>{content.sec2Item1}</li>
          <li>{content.sec2Item2}</li>
          <li>{content.sec2Item3}</li>
          <li>{content.sec2Item4}</li>
        </ul>

        <h2>{content.sec3Title}</h2>
        <p>{content.sec3P1}</p>

        <h2>{content.sec4Title}</h2>
        <p>{content.sec4Intro}</p>
        <ul className="list-disc space-y-2">
          <li>
            <strong>{content.sec4Item1Title}</strong>{content.sec4Item1Desc ? `, ${content.sec4Item1Desc}` : ''}
          </li>
          <li>
            <strong>{content.sec4Item2Title}</strong>{content.sec4Item2Desc ? `, ${content.sec4Item2Desc}` : ''}
          </li>
          <li>
            <strong>{content.sec4Item3Title}</strong>{content.sec4Item3Desc ? `, ${content.sec4Item3Desc}` : ''}
          </li>
          <li>
            <strong>{content.sec4Item4Title}</strong>{content.sec4Item4Desc ? `, ${content.sec4Item4Desc}` : ''}
          </li>
        </ul>

        <h2>{content.sec5Title}</h2>
        <p>{content.sec5P1}</p>
        <p>{content.sec5P2}</p>

        <h2>{content.sec6Title}</h2>
        <p>{content.sec6P1}</p>

        <h2>{content.sec7Title}</h2>
        <p>
          {content.sec7P1}{' '}
          <a href={`mailto:${email}`} className="text-accent underline hover:opacity-80">
            {email}
          </a>
        </p>

        <h2>{content.sec8Title}</h2>
        <p>{content.sec8P1}</p>

        <h2>{content.sec9Title}</h2>
        <p>
          {content.sec9Intro}{' '}
          <a href={`mailto:${email}`} className="text-accent underline hover:opacity-80">
            {email}
          </a>
        </p>
      </article>
    </div>
  );
}
