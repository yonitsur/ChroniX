import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, X, Sparkles, ExternalLink, Pencil, Check, Info } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// Markdown styling tuned for the overview reading panel (XSS-safe; no raw HTML).
const OV_COMPONENTS = {
  p: (props) => <p className="text-body-sm leading-relaxed text-ink mb-3 last:mb-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  a: (props) => <a className="text-accent hover:underline underline-offset-2 break-words" target="_blank" rel="noopener noreferrer" {...props} />,
  ul: (props) => <ul className="my-2 ps-4 list-disc space-y-1 text-body-sm leading-relaxed text-ink" {...props} />,
  ol: (props) => <ol className="my-2 ps-4 list-decimal space-y-1 text-body-sm leading-relaxed text-ink" {...props} />,
  li: (props) => <li className="leading-snug" {...props} />,
  h1: (props) => <h3 className="text-h3 font-bold text-ink mt-3 mb-1.5 first:mt-0" {...props} />,
  h2: (props) => <h3 className="text-body font-bold text-ink mt-3 mb-1.5 first:mt-0" {...props} />,
  h3: (props) => <h4 className="text-body-sm font-semibold text-ink mt-3 mb-1 first:mt-0" {...props} />,
  blockquote: (props) => <blockquote className="border-s-2 border-line-strong ps-3 my-2 text-ink-muted italic" {...props} />,
  code: (props) => <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-caption font-mono border border-line break-words" {...props} />,
  hr: () => <hr className="my-3 border-line" />,
};

/**
 * Slide-in reading panel that shows the AI-written narrative overview for the
 * current timeline — the big-picture framing (subject, significance, arguments,
 * context) that the bare chronology can't convey. Opens to the right of the left
 * dock rail; non-blocking so the timeline stays interactive while it's open.
 */
export default function TimelineOverviewPanel({ timeline, isOpen, onClose, onRename, style }) {
  const { t, isRtl } = useLanguage();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef(null);
  const canRename = typeof onRename === 'function' && timeline?.isOwner !== false;

  useEffect(() => {
    setIsEditingTitle(false);
  }, [timeline?.id]);

  useEffect(() => {
    if (isEditingTitle) titleInputRef.current?.select();
  }, [isEditingTitle]);

  const startEditTitle = () => {
    setTitleValue(timeline?.title || '');
    setIsEditingTitle(true);
  };

  const confirmEditTitle = () => {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== timeline?.title) onRename(trimmed);
    setIsEditingTitle(false);
  };

  const overview = (timeline?.overview || '').trim();
  const description = (timeline?.description || '').trim();
  const relatedPrompts = Array.isArray(timeline?.relatedPrompts)
    ? timeline.relatedPrompts
    : (Array.isArray(timeline?.related_prompts) ? timeline.related_prompts : []);

  return (
    <div
      style={style}
      dir={isRtl ? 'rtl' : 'ltr'}
      role="complementary"
      inert={!isOpen}
      className={`fixed md:absolute inset-y-0 left-0 md:left-[52px] w-full sm:w-[400px] max-w-[calc(100vw-52px)] border-r border-line bg-surface-overlay shadow-panel flex flex-col overflow-hidden font-sans transition-all duration-300 ease-in-out ${
        isOpen
          ? 'translate-x-0 opacity-100 pointer-events-auto'
          : '-translate-x-full opacity-0 pointer-events-none'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line shrink-0">
        <span className="flex items-center gap-2 min-w-0 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          <BookOpen className="w-4 h-4 text-accent shrink-0" />
          <span className="truncate">{t('overview.title')}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer shrink-0"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-start">
        {isEditingTitle ? (
          <div className="flex items-center gap-1.5 mb-1.5">
            <input
              ref={titleInputRef}
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmEditTitle();
                else if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              onBlur={confirmEditTitle}
              className="flex-1 min-w-0 text-lg font-bold leading-snug text-ink bg-surface-sunken border border-line-strong rounded-control px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={confirmEditTitle}
              className="p-1.5 text-accent hover:bg-accent-soft rounded-control transition-colors cursor-pointer shrink-0"
              title={t('common.save')}
              aria-label={t('common.save')}
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          timeline?.title && (
            <div className="group flex items-center gap-1.5 mb-1.5">
              <h2 className="text-lg font-bold leading-snug text-ink">
                {timeline.title}
              </h2>
              {canRename && (
                <button
                  type="button"
                  onClick={startEditTitle}
                  className="p-1 text-ink-faint hover:text-accent opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-hover rounded-control transition-all cursor-pointer shrink-0"
                  title={t('overview.renameTooltip')}
                  aria-label={t('overview.renameTooltip')}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )
        )}
        {description && (
          <p className="text-body-sm leading-relaxed text-ink-muted mb-4">
            {description}
          </p>
        )}

        {overview ? (
          <div className="border-t border-line pt-4">
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={OV_COMPONENTS}
            >
              {overview}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-body-sm leading-relaxed text-ink-faint italic border-t border-line pt-4">
            {t('overview.empty')}
          </p>
        )}

        {overview && (
          <div className="flex items-start gap-1.5 mt-3">
            <Info className="w-3 h-3 text-ink-faint mt-0.5 shrink-0" />
            <p className="text-caption leading-snug text-ink-faint">
              {t('overview.interpretationNote')}
            </p>
          </div>
        )}

        {/* Related Timelines exploration bubbles */}
        {relatedPrompts.length > 0 && (
          <div className="border-t border-line mt-5 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-3">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>{t('overview.relatedTimelines')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {relatedPrompts.map((promptItem, idx) => {
                const promptText = typeof promptItem === 'string' ? promptItem.trim() : (promptItem?.prompt || '').trim();
                if (!promptText) return null;
                const targetUrl = `${window.location.pathname}?prompt=${encodeURIComponent(promptText)}`;
                return (
                  <a
                    key={idx}
                    href={targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('overview.openInNewTab')}
                    className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-medium bg-surface-sunken hover:bg-accent-soft text-ink hover:text-accent border border-line hover:border-accent-ring transition-all duration-150 shadow-xs hover:shadow-sm cursor-pointer"
                  >
                    <span>{promptText}</span>
                    <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-accent transition-colors shrink-0" />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
