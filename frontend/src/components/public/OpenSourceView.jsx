import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Code2, ExternalLink, Copy, Check } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getPublicPageContent } from '../../data/publicPages';

export default function OpenSourceView({ onBackToTerms }) {
  const { language, isRtl } = useLanguage();
  const content = getPublicPageContent(language).openSource;
  const [copiedSection, setCopiedSection] = useState(null);

  const handleCopy = (sectionKey, text) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedSection(sectionKey);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      // Fallback if clipboard API is not available
    }
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div
      className={`w-full flex-1 flex flex-col animate-fade-in ${isRtl ? 'text-right' : 'text-left'}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top Back to Terms of Service navigation */}
      <div className="mb-6 flex items-center justify-start">
        <button
          type="button"
          onClick={onBackToTerms}
          className="public-back-btn group cursor-pointer inline-flex items-center gap-2 px-3.5 py-1.5 rounded-control text-xs font-medium text-ink-muted hover:text-ink bg-surface-sunken hover:bg-surface-hover border border-line transition-all"
          title={content.backToTerms}
        >
          <BackIcon className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
          <span>{content.backToTerms}</span>
        </button>
      </div>

      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <Code2 className="w-3.5 h-3.5 text-accent" />
          <span>{content.heroBadge}</span>
        </div>
        <h1>{content.heroTitle}</h1>
        <p className="public-last-updated">{content.lastUpdated}</p>
      </section>

      {/* Content Container */}
      <article className="public-content-card">
        <p className="text-base text-ink-muted leading-relaxed mb-8">
          {content.intro}
        </p>

        {/* 1. Leaflet Card */}
        <section className="public-license-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-line">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="!my-0 text-xl font-bold text-ink">{content.leaflet.title}</h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-caption font-semibold bg-accent-soft text-accent border border-accent/20">
                {content.leaflet.licenseType}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs" dir="ltr" style={{ direction: 'ltr' }}>
              <a
                href={content.leaflet.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-muted hover:text-accent font-medium transition-colors"
              >
                <span>{content.viewSourceCode}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="text-ink-faint">•</span>
              <a
                href={content.leaflet.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-muted hover:text-accent font-medium transition-colors"
              >
                <span>{content.viewLicense}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="text-ink-faint">•</span>
              <button
                type="button"
                onClick={() => handleCopy('leaflet', `${content.leaflet.copyright}\n\n${content.leaflet.body}`)}
                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink cursor-pointer transition-colors"
                title="Copy License"
              >
                {copiedSection === 'leaflet' ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedSection === 'leaflet' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div
            className="public-license-code select-text"
            dir="ltr"
            style={{ direction: 'ltr', textAlign: 'left' }}
          >
            <div className="font-semibold text-ink mb-3">{content.leaflet.copyright}</div>
            <div>{content.leaflet.body}</div>
          </div>
        </section>

        {/* 2. HistropediaJS Card */}
        <section className="public-license-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-line">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="!my-0 text-xl font-bold text-ink">{content.histropedia.title}</h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-caption font-semibold bg-accent-soft text-accent border border-accent/20">
                {content.histropedia.licenseType}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs" dir="ltr" style={{ direction: 'ltr' }}>
              <a
                href={content.histropedia.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-muted hover:text-accent font-medium transition-colors"
              >
                <span>{content.viewSourceCode}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="text-ink-faint">•</span>
              <a
                href={content.histropedia.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-ink-muted hover:text-accent font-medium transition-colors"
              >
                <span>{content.viewLicense}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="text-ink-faint">•</span>
              <button
                type="button"
                onClick={() => handleCopy('histropedia', content.histropedia.body)}
                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink cursor-pointer transition-colors"
                title="Copy Agreement"
              >
                {copiedSection === 'histropedia' ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedSection === 'histropedia' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Simple terms summary callout */}
          <div className="public-callout mb-5">
            <h3 className="font-semibold text-ink text-sm mb-2">{content.histropedia.prefaceTitle}</h3>
            <p className="text-xs text-ink-muted mb-2 leading-relaxed">{content.histropedia.prefaceP1}</p>
            <p className="text-xs text-ink-muted mb-2 leading-relaxed">{content.histropedia.prefaceP2}</p>
            <p className="text-xs text-ink font-medium">{content.histropedia.prefaceP3}</p>
          </div>

          <div
            className="public-license-code select-text"
            dir="ltr"
            style={{ direction: 'ltr', textAlign: 'left' }}
          >
            <div className="font-semibold text-ink mb-3 pb-2 border-b border-line/60">
              ----------------------------------------------------------------<br />
              {content.histropedia.agreementHeading}<br />
              ----------------------------------------------------------------
            </div>
            <div>{content.histropedia.body}</div>
          </div>
        </section>

        {/* Bottom Back Button */}
        <div className="pt-4 pb-6 flex items-center justify-center">
          <button
            type="button"
            onClick={onBackToTerms}
            className="public-back-btn group cursor-pointer inline-flex items-center gap-2 px-5 py-2.5 rounded-control text-sm font-medium text-ink bg-surface-sunken hover:bg-surface-hover border border-line transition-all shadow-sm"
          >
            <BackIcon className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            <span>{content.backToTerms}</span>
          </button>
        </div>
      </article>
    </div>
  );
}
