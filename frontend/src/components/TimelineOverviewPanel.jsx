import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, BookUser, X, Sparkles, ExternalLink, Pencil, Check, Info, MessageSquare, MessageCircleQuestion, PenLine } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { getTextDir } from '../utils/textDirection';
import { EVENT_DRAWER_MIN_WIDTH, EVENT_DRAWER_KEY_STEP, clampEventDrawerWidth } from '../utils/drawerLayout';
import PanelNavButtons from './PanelNavButtons';
import TimelineModeBadges from './TimelineModeBadges';
import { formatAiModelName } from '../utils/modelUtils';
import useIsMobileViewport from '../hooks/useIsMobileViewport';

// Markdown styling tuned for the overview reading panel (XSS-safe; no raw HTML).
const OV_COMPONENTS = {
  p: (props) => <p className="text-body-sm leading-relaxed text-ink mb-3 last:mb-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  a: (props) => <a className="text-accent hover:underline underline-offset-2 break-words" target="_blank" rel="noopener noreferrer" {...props} />,
  ul: (props) => <ul className="my-2 ps-4 list-disc space-y-1 text-body-sm leading-relaxed text-ink" {...props} />,
  ol: (props) => <ol className="my-2 ps-4 list-decimal space-y-1 text-body-sm leading-relaxed text-ink" {...props} />,
  li: (props) => <li className="leading-snug" {...props} />,
  h1: (props) => <h3 className="text-h3 font-bold tracking-tight text-ink mt-3 mb-2 first:mt-0" {...props} />,
  h2: (props) => <h3 className="text-body font-bold tracking-tight text-ink mt-3 mb-2 first:mt-0" {...props} />,
  h3: (props) => <h4 className="text-body-sm font-semibold tracking-tight text-ink mt-3 mb-1 first:mt-0" {...props} />,
  blockquote: (props) => <blockquote className="border-s-2 border-line-strong ps-3 my-2 text-ink-muted italic" {...props} />,
  code: (props) => <code className="px-1 py-0.5 rounded bg-surface-sunken text-ink text-caption font-mono border border-line break-words" {...props} />,
  hr: () => <hr className="my-3 border-line" />,
  img: () => null,
};

/**
 * Slide-in reading panel that shows the AI-written narrative overview for the
 * current timeline - the big-picture framing (subject, significance, arguments,
 * context) that the bare chronology can't convey. Opens to the right of the left
 * dock rail; non-blocking so the timeline stays interactive while it's open.
 */
export default function TimelineOverviewPanel({
  timeline,
  isOpen,
  onClose,
  // Side panel Back/Forward descriptor (see PanelNavButtons); null when there's no history.
  panelNav = null,
  onRename,
  style,
  chatSuggestions = null,
  onAskChat,
  onBuildPersonalTimeline,
  width = null,
  onWidthChange,
  // Optional in-place editing of the overview (the Story Studio preview): onSaveOverview(text),
  // plus renderEditorTools({ value, setValue }) for extra buttons beside the editor (e.g. AI).
  onSaveOverview,
  renderEditorTools,
  // Extra content under the overview (e.g. "Learn more" on personal timelines).
  footer = null,
}) {
  const { t, isRtl } = useLanguage();
  const isPersonalLibraryDemo = Boolean(timeline?.isLibrary && timeline?.isPersonal);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef(null);
  const [overviewDraft, setOverviewDraft] = useState(null); // null = not editing
  const canEditOverview = typeof onSaveOverview === 'function';
  const canRename = typeof onRename === 'function' && timeline?.isOwner !== false;
  // Timeline content follows its own language direction; isRtl (interface) is only a fallback.
  const titleDir = getTextDir(timeline?.title || '', isRtl);

  useEffect(() => {
    setIsEditingTitle(false);
    setOverviewDraft(null);
  }, [timeline?.id]);
  useEffect(() => {
    if (!isOpen) setOverviewDraft(null);
  }, [isOpen]);

  const saveOverviewDraft = () => {
    if (overviewDraft !== null && overviewDraft.trim() !== (timeline?.overview || '').trim()) onSaveOverview(overviewDraft.trim());
    setOverviewDraft(null);
  };

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

  const isMobile = useIsMobileViewport();

  const drawerRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null);
  const canResize = Boolean(onWidthChange) && !isMobile;

  const handleResizePointerDown = (e) => {
    if (e.button !== 0 || !drawerRef.current) return;
    e.preventDefault();
    const startWidth = drawerRef.current.getBoundingClientRect().width;
    resizeDragRef.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveWidth(startWidth);
  };
  const handleResizePointerMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    drag.width = clampEventDrawerWidth(drag.startWidth + e.clientX - drag.startX);
    setLiveWidth(drag.width);
  };
  const handleResizePointerEnd = () => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setLiveWidth(null);
    if (Math.abs(drag.width - drag.startWidth) >= 1) onWidthChange(drag.width);
  };
  const handleResizeKeyDown = (e) => {
    const current = drawerRef.current?.getBoundingClientRect().width || EVENT_DRAWER_MIN_WIDTH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? EVENT_DRAWER_KEY_STEP : -EVENT_DRAWER_KEY_STEP;
      onWidthChange(clampEventDrawerWidth(current + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(null);
    }
  };

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
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40"
          onClick={() => setSnap('half')}
        />
      )}
      <aside
        ref={drawerRef}
        style={isMobile ? mobileSheetStyle : {
          ...style,
          ...(canResize && (liveWidth ?? width) ? { width: liveWidth ?? clampEventDrawerWidth(width) } : {}),
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
        role="complementary"
        inert={!isOpen}
        className={`chronix-side-drawer ${
          isMobile
            ? 'fixed inset-x-0 bottom-0 w-full max-h-[90vh] rounded-t-3xl border-t overflow-hidden'
            : 'absolute inset-y-0 left-[calc(52px+env(safe-area-inset-left,0px))] right-auto w-[340px] md:w-[380px] lg:w-[440px] max-w-[calc(100vw-56px-env(safe-area-inset-left,0px))] h-full max-h-full rounded-none border-r overflow-visible'
        } border-line bg-surface-overlay shadow-2xl flex flex-col font-sans ${
          liveWidth != null ? 'select-none' : 'transition-all duration-300 ease-in-out'
        } z-50 ${isOpen
            ? (isMobile ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-x-0 opacity-100 pointer-events-auto')
            : (isMobile ? 'translate-y-full opacity-0 pointer-events-none' : '-translate-x-full opacity-0 pointer-events-none')
          }`}
      >
        {canResize && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('eventDrawer.resize')}
            title={t('eventDrawer.resize')}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
            onDoubleClick={() => onWidthChange(null)}
            onKeyDown={handleResizeKeyDown}
            style={{ touchAction: 'none' }}
            className="group/resize absolute top-0 bottom-0 -right-1.5 w-3 z-30 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
          >
            <span
              className={`h-full w-0.5 transition-colors ${
                liveWidth != null ? 'bg-ink-subtle' : 'bg-transparent group-hover/resize:bg-line-strong group-focus-visible/resize:bg-ink-subtle'
              }`}
            />
            <span
              className={`absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full border border-line bg-surface-raised shadow-control transition-opacity ${
                liveWidth != null ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100'
              }`}
            />
          </div>
        )}
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
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {panelNav && (
              <>
                <PanelNavButtons nav={panelNav} className="-ms-2" />
                <span className="w-px h-5 bg-line shrink-0" aria-hidden="true" />
              </>
            )}
            <h2 className="flex items-center gap-2 min-w-0 text-base font-semibold text-ink">
              <BookOpen className="w-4 h-4 text-accent shrink-0" />
              <span className="truncate">{t('overview.title')}</span>
            </h2>
          </div>
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
            <div className="flex items-center gap-2 mb-2">
              <input
                ref={titleInputRef}
                type="text"
                dir={getTextDir(titleValue, titleDir === 'rtl')}
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
                className="p-2 text-accent hover:bg-accent-soft rounded-control transition-colors cursor-pointer shrink-0"
                title={t('common.save')}
                aria-label={t('common.save')}
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            timeline?.title && (
              <div className="group flex items-center gap-2 mb-2" dir={titleDir}>
                <h2
                  dir={titleDir}
                  className="text-xl sm:text-2xl font-bold font-serif text-ink tracking-tight leading-snug break-words text-start"
                >
                  {timeline.title}
                </h2>
                {canRename && (
                  <button
                    type="button"
                    onClick={startEditTitle}
                    className="p-1 text-ink-subtle hover:text-accent opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-hover rounded-control transition-all cursor-pointer shrink-0"
                    title={t('overview.renameTooltip')}
                    aria-label={t('overview.renameTooltip')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          )}

          <TimelineModeBadges
            contentMode={timeline?.contentMode}
            searchMode={timeline?.searchMode}
            isManual={Boolean(timeline?.isManual || timeline?.isPersonal || timeline?.creationSource === 'manual')}
            isPersonalDemo={isPersonalLibraryDemo}
            mergedLayerCount={timeline?.mergedSources?.length || 0}
            className="mb-3"
          />

          {description && (
            <p dir={getTextDir(description, titleDir === 'rtl')} className="text-body-sm leading-relaxed text-ink-muted mb-4 text-start">
              {description}
            </p>
          )}

          {overviewDraft !== null ? (
            <div className="border-t border-line pt-4 space-y-2" data-testid="overview-editor">
              <textarea
                value={overviewDraft}
                onChange={(e) => setOverviewDraft(e.target.value)}
                dir={getTextDir(overviewDraft, titleDir === 'rtl')}
                rows={14}
                maxLength={20000}
                autoFocus
                placeholder={t('overview.editPlaceholder')}
                aria-label={t('overview.title')}
                className="w-full text-body-sm leading-relaxed text-ink bg-surface-sunken border border-line-strong rounded-control px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-ring resize-y"
              />
              <p className="text-caption text-ink-subtle">{t('overview.markdownHint')}</p>
              <div className="flex flex-wrap items-center gap-2">
                {renderEditorTools?.({ value: overviewDraft, setValue: setOverviewDraft })}
                <span className="flex-1" />
                <button type="button" onClick={() => setOverviewDraft(null)} className="px-3 py-2 text-xs text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover cursor-pointer">
                  {t('common.cancel')}
                </button>
                <button type="button" onClick={saveOverviewDraft} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control cursor-pointer">
                  <Check className="w-3.5 h-3.5" />{t('common.save')}
                </button>
              </div>
            </div>
          ) : overview ? (
            <div dir={getTextDir(overview, titleDir === 'rtl')} className="group/ov relative border-t border-line pt-4 text-start">
              {canEditOverview && (
                <button
                  type="button"
                  onClick={() => setOverviewDraft(timeline?.overview || '')}
                  className="absolute top-3 end-0 inline-flex items-center gap-1 px-2 py-1 text-caption font-medium text-accent bg-surface-overlay/90 hover:bg-accent-soft rounded-control border border-line cursor-pointer"
                  data-testid="overview-edit"
                >
                  <Pencil className="w-3 h-3" />{t('overview.edit')}
                </button>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={OV_COMPONENTS}
              >
                {overview}
              </ReactMarkdown>
            </div>
          ) : canEditOverview ? (
            <div className="border-t border-line pt-4 space-y-2">
              <p className="text-body-sm leading-relaxed text-ink-subtle italic">{t('overview.emptyEditable')}</p>
              <button
                type="button"
                onClick={() => setOverviewDraft('')}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-accent border border-accent/40 hover:bg-accent-soft rounded-control cursor-pointer"
                data-testid="overview-edit"
              >
                <Pencil className="w-3.5 h-3.5" />{t('overview.write')}
              </button>
            </div>
          ) : (
            <p className="text-body-sm leading-relaxed text-ink-subtle italic border-t border-line pt-4">
              {t('overview.empty')}
            </p>
          )}

          {overview && overviewDraft === null && !canEditOverview && (
            <div className="flex items-start gap-2 mt-3">
              <Info className="w-3.5 h-3.5 text-ink-subtle mt-0.5 shrink-0" />
              <p className="text-caption leading-snug text-ink-subtle">
                {isPersonalLibraryDemo
                  ? t('overview.personalDemoNote')
                  : timeline?.isPersonal ? t('overview.personalSharedNote') : t('overview.interpretationNote')}
              </p>
            </div>
          )}

          {isPersonalLibraryDemo && typeof onBuildPersonalTimeline === 'function' && (
            <div className="mt-4 p-4 rounded-panel bg-surface-sunken border border-accent/25 space-y-3 text-start">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-control bg-accent/12 border border-accent/20 flex items-center justify-center text-accent shrink-0 mt-0.5">
                  <BookUser className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-semibold text-ink">
                    {t('overview.personalDemoCtaTitle')}
                  </div>
                  <p className="text-caption text-ink-muted leading-relaxed">
                    {t('overview.personalDemoCtaBody')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onBuildPersonalTimeline}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs transition-colors shadow-control cursor-pointer"
              >
                <BookUser className="w-3.5 h-3.5 shrink-0" />
                <span>{t('overview.personalDemoCtaBtn')}</span>
              </button>
            </div>
          )}

          {footer}

          {/* Google Search grounding queries attribution (when grounded) */}
          {Array.isArray(timeline?.grounding?.search_queries) && timeline.grounding.search_queries.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line/60">
              <div className="text-caption font-medium text-ink-subtle mb-2">
                Google Search
              </div>
              <div className="flex flex-wrap gap-2">
                {timeline.grounding.search_queries.slice(0, 6).map((query, idx) => {
                  const q = String(query || '').trim();
                  if (!q) return null;
                  return (
                    <a
                      key={`${q}-${idx}`}
                      href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption bg-surface-sunken hover:bg-surface-hover text-ink-muted hover:text-ink border border-line transition-colors"
                    >
                      <span dir="auto" className="truncate max-w-[200px]">{q}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Continue in chat: one question + one edit so both chat abilities are visible */}
          {onAskChat && chatSuggestions && (chatSuggestions.questions?.length > 0 || chatSuggestions.edits?.length > 0) && (
            <div className="border-t border-line mt-5 pt-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2">
                <MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('overview.continueInChat')}</span>
              </div>
              <p className="text-caption leading-snug text-ink-muted mb-3">{t('overview.continueInChatBody')}</p>
              <div className="flex flex-col gap-2">
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
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-3">
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
                      className="group inline-flex items-center gap-2 px-3 py-2 rounded-full text-caption font-medium bg-surface-sunken hover:bg-accent-soft text-ink hover:text-accent border border-line hover:border-accent-ring transition-all duration-150 shadow-xs hover:shadow-sm cursor-pointer"
                    >
                      <span dir="auto">{promptText}</span>
                      <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-accent transition-colors shrink-0" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discreet AI Model & Cost Transparency attribution */}
          {!timeline?.isManual && (timeline?.tokenUsage?.model || timeline?.model) && (
            <div className="pt-2 text-center select-none">
              <span className="text-caption text-ink-faint/60 tracking-wide">
                {(() => {
                  const modelLabel = formatAiModelName(timeline.tokenUsage?.model || timeline.model);
                  const totalTokens = Number(timeline?.tokenUsage?.totalTokens || 0);
                  const estCost = Number(timeline?.tokenUsage?.estimatedCostUsd || 0);
                  if (totalTokens > 0 && estCost > 0) {
                    return t('overview.tokenCostSummary', {
                      model: modelLabel,
                      tokens: totalTokens.toLocaleString(),
                      cost: estCost < 0.01 ? estCost.toFixed(4) : estCost.toFixed(3),
                    });
                  }
                  if (totalTokens > 0) {
                    return t('overview.tokenSummaryOnly', {
                      model: modelLabel,
                      tokens: totalTokens.toLocaleString(),
                    });
                  }
                  return t('overview.generatedByModel', { model: modelLabel });
                })()}
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
