import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, X, Sparkles, ExternalLink, Pencil, Check, Info, MessageSquare, MessageCircleQuestion, PenLine } from 'lucide-react';
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
  h1: (props) => <h3 className="text-h3 font-bold font-serif tracking-tight text-ink mt-3 mb-1.5 first:mt-0" {...props} />,
  h2: (props) => <h3 className="text-body font-bold font-serif tracking-tight text-ink mt-3 mb-1.5 first:mt-0" {...props} />,
  h3: (props) => <h4 className="text-body-sm font-semibold font-serif tracking-tight text-ink mt-3 mb-1 first:mt-0" {...props} />,
  blockquote: (props) => <blockquote className="border-s-2 border-line-strong ps-3 my-2 text-ink-muted italic" {...props} />,
  code: (props) => <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-caption font-mono border border-line break-words" {...props} />,
  hr: () => <hr className="my-3 border-line" />,
};

/**
 * Slide-in reading panel that shows the AI-written narrative overview for the
 * current timeline - the big-picture framing (subject, significance, arguments,
 * context) that the bare chronology can't convey. Opens to the right of the left
 * dock rail; non-blocking so the timeline stays interactive while it's open.
 */
export default function TimelineOverviewPanel({ timeline, isOpen, onClose, onRename, style, chatSuggestions = null, onAskChat }) {
  const { t, isRtl } = useLanguage();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef(null);
  const canRename = typeof onRename === 'function' && timeline?.isOwner !== false;
  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');
  const isTitleRtl = hasRtl(timeline?.title);

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

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const touchStartYRef = useRef(0);
  const [snap, setSnap] = useState('half');
  const [dragDelta, setDragDelta] = useState(null);
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Opens at half height so the timeline stays visible above it (Google Maps-style peek).
  useEffect(() => {
    if (isOpen) setSnap('half');
  }, [isOpen]);

  const snapHeight = Math.round(vh * (snap === 'full' ? 0.86 : 0.5));
  const handleTouchStart = (e) => {
    if (e.target.closest('button, input')) return;
    touchStartYRef.current = e.touches[0].clientY;
    setDragDelta(0);
  };
  const handleTouchMove = (e) => {
    if (dragDelta === null) return;
    setDragDelta(e.touches[0].clientY - touchStartYRef.current);
  };
  const handleTouchEnd = (e) => {
    if (dragDelta === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    setDragDelta(null);
    if (Math.abs(deltaY) < 6) {
      setSnap((s) => (s === 'full' ? 'half' : 'full'));
    } else if (deltaY < -50) {
      setSnap('full');
    } else if (deltaY > 60) {
      if (snap === 'full' && deltaY < vh * 0.3) setSnap('half');
      else onClose?.();
    }
  };
  const mobileSheetStyle = {
    height: dragDelta === null
      ? snapHeight
      : Math.max(vh * 0.2, Math.min(vh * 0.9, snapHeight - dragDelta)),
    ...(dragDelta === null ? {} : { transition: 'none' }),
  };

  const overview = (timeline?.overview || '').trim();
  const description = (timeline?.description || '').trim();
  const relatedPrompts = Array.isArray(timeline?.relatedPrompts)
    ? timeline.relatedPrompts
    : (Array.isArray(timeline?.related_prompts) ? timeline.related_prompts : []);

  return (
    <>
      {/* Mobile Backdrop Overlay (only when fully expanded; the half sheet leaves the timeline usable) */}
      {isMobile && isOpen && snap === 'full' && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
          onClick={() => setSnap('half')}
        />
      )}
      <aside
        style={isMobile ? mobileSheetStyle : style}
        dir={isRtl ? 'rtl' : 'ltr'}
        role="complementary"
        inert={!isOpen}
        className={`fixed md:absolute inset-x-0 bottom-0 md:inset-y-0 md:left-[52px] md:right-auto w-full md:w-[380px] lg:w-[440px] md:max-w-[calc(100vw-56px)] md:h-full max-h-[90vh] md:max-h-full rounded-t-3xl md:rounded-none border-t md:border-t-0 md:border-r border-line bg-surface-overlay shadow-2xl flex flex-col overflow-hidden font-sans transition-all duration-300 ease-in-out z-50 ${isOpen
            ? (isMobile ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-x-0 opacity-100 pointer-events-auto')
            : (isMobile ? 'translate-y-full opacity-0 pointer-events-none' : '-translate-x-full opacity-0 pointer-events-none')
          }`}
      >
        {/* Mobile drag zone (handle + header): drag or tap the handle to expand/collapse */}
        <div
          className={`shrink-0 ${isMobile ? 'touch-none' : ''}`}
          onTouchStart={isMobile ? handleTouchStart : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
        >
        {isMobile && (
          <div
            role="button"
            tabIndex={0}
            aria-expanded={snap === 'full'}
            aria-label={t('overview.title')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSnap((s) => (s === 'full' ? 'half' : 'full'));
              }
            }}
            className="w-full flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
          >
            <div className="w-10 h-1 rounded-full bg-line-strong" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-line shrink-0">
          <span className="flex items-center gap-2 min-w-0 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            <BookOpen className="w-4 h-4 text-accent shrink-0" />
            <span className="truncate">{t('overview.title')}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-full transition-all cursor-pointer shrink-0 active:scale-95 touch-manipulation"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        </div>

        {/* Body */}
        <div
          style={{
            paddingBottom: isMobile ? 'max(24px, calc(env(safe-area-inset-bottom, 16px) + 20px))' : undefined,
          }}
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-start"
        >
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 mb-2">
              <input
                ref={titleInputRef}
                type="text"
                dir={hasRtl(titleValue) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmEditTitle();
                  else if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={confirmEditTitle}
                className="flex-1 min-w-0 text-xl sm:text-2xl font-bold font-serif leading-snug text-ink tracking-tight bg-surface-sunken border border-line-strong rounded-control px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent-ring"
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
              <div className="group flex items-center gap-1.5 mb-2">
                <h2
                  dir={isTitleRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
                  className="text-xl sm:text-2xl font-bold font-serif text-ink tracking-tight leading-snug break-words"
                >
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

          {/* Continue in chat: one question + one edit so both chat abilities are visible */}
          {onAskChat && chatSuggestions && (chatSuggestions.questions?.length > 0 || chatSuggestions.edits?.length > 0) && (
            <div className="border-t border-line mt-5 pt-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('overview.continueInChat')}</span>
              </div>
              <p className="text-caption leading-snug text-ink-muted mb-3">{t('overview.continueInChatBody')}</p>
              <div className="flex flex-col gap-1.5">
                {[
                  ...(chatSuggestions.questions || []).slice(0, 2).map((text) => ({ text, Icon: MessageCircleQuestion })),
                  ...(chatSuggestions.edits || []).slice(0, 1).map((text) => ({ text, Icon: PenLine })),
                ].map(({ text, Icon }) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => onAskChat(text)}
                    className="group flex items-start gap-2 w-full text-start rounded-control border border-line bg-surface-sunken hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer"
                  >
                    <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-subtle group-hover:text-ink" />
                    <span dir="auto" className="min-w-0 flex-1 text-caption leading-snug text-ink">{text}</span>
                  </button>
                ))}
              </div>
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
      </aside>
    </>
  );
}
