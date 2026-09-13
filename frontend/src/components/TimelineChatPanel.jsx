import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  MessageSquare, X, Minus, Send, Loader2, Square, Sparkles,
  Trash2, Undo2, GripHorizontal, Wand2, ExternalLink,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';

// Compact, XSS-safe markdown styling for assistant replies (react-markdown renders no raw HTML).
const MD_COMPONENTS = {
  p: (props) => <p className="my-1 first:mt-0 last:mb-0 leading-relaxed" {...props} />,
  ul: (props) => <ul className="my-1 ps-4 list-disc space-y-0.5" {...props} />,
  ol: (props) => <ol className="my-1 ps-4 list-decimal space-y-0.5" {...props} />,
  li: (props) => <li className="leading-snug" {...props} />,
  a: (props) => <a className="text-accent hover:underline underline-offset-2 break-words" target="_blank" rel="noopener noreferrer" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  h1: (props) => <h3 className="text-[14px] font-bold text-ink mt-2 mb-1 first:mt-0" {...props} />,
  h2: (props) => <h3 className="text-[13.5px] font-bold text-ink mt-2 mb-1 first:mt-0" {...props} />,
  h3: (props) => <h4 className="text-[13px] font-semibold text-ink mt-2 mb-1 first:mt-0" {...props} />,
  blockquote: (props) => <blockquote className="border-s-2 border-line-strong ps-2 my-1 text-ink-muted italic" {...props} />,
  hr: () => <hr className="my-2 border-line" />,
  code: (props) => <code className="px-1 py-0.5 rounded bg-surface-sunken border border-line text-[12px] font-mono break-words text-ink" {...props} />,
  pre: (props) => <pre className="my-1 p-2 rounded-control bg-surface-sunken border border-line text-ink text-[12px] overflow-x-auto [&_code]:bg-transparent [&_code]:p-0 [&_code]:border-0" {...props} />,
};

const GROUNDING_STORAGE_KEY = 'chronix_enable_grounding_v2';
// v3: stores bubble anchor so the panel always opens upwards and to the left of the bubble.
const DOCK_STORAGE_KEY = 'chronix_chat_dock_v3';
const SIZE_STORAGE_KEY = 'chronix_chat_size';
const PANEL_W = 380;
const PANEL_H = 560;
const MIN_W = 300;
const MIN_H = 380;
const LAUNCHER_SIZE = 48; // collapsed bubble footprint (w-12 h-12)
const EDGE_MARGIN = 16; // gap from the right screen edge
// Clearance reserved at the bottom for the timeline's year/date bar so the default
// launcher position floats just above it (mobile needs more room than desktop).
const YEAR_BAR_CLEARANCE_MOBILE = 100;
const YEAR_BAR_CLEARANCE_DESKTOP = 100;

function readGroundingPref() {
  try {
    const v = localStorage.getItem(GROUNDING_STORAGE_KEY);
    if (v === null) return true;
    return v === 'true';
  } catch {
    return true;
  }
}

function readDock() {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function readSize() {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.w && s.h) return { w: s.w, h: s.h };
    }
  } catch {}
  return { w: PANEL_W, h: PANEL_H };
}

function isRtlText(s) {
  return s ? /[\u0590-\u05FF\u0600-\u06FF]/.test(s) : false;
}

// Keep a floating element fully on-screen given its own width/height.
function clampPos(p, w, h) {
  if (!p) return null;
  const maxLeft = Math.max(8, window.innerWidth - w - 8);
  const maxTop = Math.max(8, window.innerHeight - h - 8);
  return {
    left: Math.max(8, Math.min(p.left, maxLeft)),
    top: Math.max(8, Math.min(p.top, maxTop)),
  };
}

/**
 * Floating, draggable, minimizable chat dock — "Talk to the timeline".
 * Presentational + local drag/minimize/input/grounding state; the conversation,
 * busy flag and undo are owned by App.jsx. onSend(text, grounding) mirrors the
 * generate/refine signature so grounding stays consistent app-wide.
 */
export default function TimelineChatPanel({
  isOpen,
  onClose,
  onOpen,
  timelineTitle = '',
  messages = [],
  isBusy = false,
  onSend,
  onStop,
  onClear,
  onUndo,
  seed = null,
  onSeedConsumed,
}) {
  const { t, isRtl } = useLanguage();
  const zIndex = FLOATING_Z.CHAT;

  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [grounding, setGrounding] = useState(readGroundingPref);
  const [pos, setPos] = useState(readDock); // {left, top} viewport px, or null = default anchor
  const [size, setSize] = useState(readSize); // {w, h} panel size (persisted)
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 768));
  const isNarrow = vw < 640;
  const yearBarClearance = isNarrow ? YEAR_BAR_CLEARANCE_MOBILE : YEAR_BAR_CLEARANCE_DESKTOP;
  // Compact floating size used once the mobile bottom-sheet panel is dragged off its default anchor.
  const narrowFloatW = Math.min(vw - 16, 360);
  const narrowFloatH = Math.min(Math.round(vh * 0.7), 520);

  const dragRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Re-clamp on resize using the bubble anchor footprint.
  useEffect(() => {
    const onResize = () => {
      const w0 = window.innerWidth;
      const h0 = window.innerHeight;
      setVw(w0);
      setVh(h0);
      setPos((p) => (p ? clampPos(p, LAUNCHER_SIZE, LAUNCHER_SIZE) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (isOpen && !minimized && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isBusy, isOpen, minimized]);

  // Focus the input when opening / expanding.
  useEffect(() => {
    if (isOpen && !minimized && window.innerWidth >= 768) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [isOpen, minimized]);

  // Expanding via the dock button should always reveal the full panel.
  useEffect(() => {
    if (isOpen) setMinimized(false);
  }, [isOpen]);

  // Prefill the composer when asked to discuss a specific event.
  useEffect(() => {
    if (seed) {
      setMinimized(false);
      setInput(seed);
      const id = setTimeout(() => inputRef.current?.focus(), 80);
      onSeedConsumed?.();
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Pointer-drag for both the panel header and the collapsed bubble. If the pointer
  // didn't actually move, treat it as a tap and run onTap (used to open the bubble).
  // `isPanel` indicates whether we are dragging the expanded panel (true) or collapsed bubble (false).
  const beginDrag = (e, onTap, isPanel = false) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = dragRef.current?.getBoundingClientRect();
    const origin = rect ? { left: rect.left, top: rect.top } : { left: 0, top: 0 };
    const panelW = isNarrow ? narrowFloatW : size.w;
    const panelH = isNarrow ? narrowFloatH : size.h;
    let moved = false;
    try { e.target.setPointerCapture?.(e.pointerId); } catch {}

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      if (isPanel) {
        // Dragging the panel: clamp panel position, then anchor the bubble to its bottom-right
        const newPanel = clampPos({ left: origin.left + dx, top: origin.top + dy }, panelW, panelH);
        const bubbleAnchor = clampPos(
          { left: newPanel.left + panelW - LAUNCHER_SIZE, top: newPanel.top + panelH - LAUNCHER_SIZE },
          LAUNCHER_SIZE,
          LAUNCHER_SIZE
        );
        setPos(bubbleAnchor);
      } else {
        // Dragging the bubble: clamp bubble position directly
        setPos(clampPos({ left: origin.left + dx, top: origin.top + dy }, LAUNCHER_SIZE, LAUNCHER_SIZE));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        setPos((p) => {
          try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(p)); } catch {}
          return p;
        });
      } else {
        onTap?.();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Resize from the top-left corner: the bottom-right corner stays pinned while width/height grow.
  const beginResize = (e) => {
    e.stopPropagation();
    const rect = dragRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fixedRight = rect.left + rect.width;
    const fixedBottom = rect.top + rect.height;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;
    try { e.target.setPointerCapture?.(e.pointerId); } catch {}
    const onMove = (ev) => {
      const w = Math.max(MIN_W, Math.min(startW - (ev.clientX - startX), fixedRight - 8));
      const h = Math.max(MIN_H, Math.min(startH - (ev.clientY - startY), fixedBottom - 8));
      setSize({ w, h });
      setPos(clampPos({ left: fixedRight - LAUNCHER_SIZE, top: fixedBottom - LAUNCHER_SIZE }, LAUNCHER_SIZE, LAUNCHER_SIZE));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSize((s) => { try { localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(s)); } catch {} return s; });
      setPos((p) => { try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(p)); } catch {} return p; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const setGroundingValue = (next) => {
    if (isBusy || next === grounding) return;
    setGrounding(next);
    try { localStorage.setItem(GROUNDING_STORAGE_KEY, String(next)); } catch {}
  };

  const submit = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    onSend?.(text, grounding);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Default anchor: bottom-right corner, floating just above the timeline's year bar.
  const defaultAnchor = clampPos(
    {
      left: vw - LAUNCHER_SIZE - EDGE_MARGIN,
      top: vh - LAUNCHER_SIZE - yearBarClearance,
    },
    LAUNCHER_SIZE,
    LAUNCHER_SIZE
  );
  const bubbleStyle = pos
    ? { left: pos.left, top: pos.top, zIndex }
    : { ...defaultAnchor, zIndex };

  const openChat = () => { setMinimized(false); if (!isOpen) onOpen?.(); };

  // ---- Collapsed launcher bubble (always visible when the panel isn't expanded; draggable) ----
  if (!isOpen || minimized) {
    return (
      <button
        ref={dragRef}
        id="guide-chat-bubble"
        type="button"
        style={bubbleStyle}
        onPointerDown={(e) => beginDrag(e, openChat, false)}
        onClick={(e) => { if (e.detail === 0) openChat(); }}
        title={t('chat.title')}
        aria-label={t('chat.open')}
        className="chronix-chat-launcher fixed w-12 h-12 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing active:scale-95 touch-none overflow-visible shadow-control"
      >
        <span className="chronix-chat-launcher-inner">
          <MessageSquare className="w-5 h-5 pointer-events-none text-ink" />
        </span>
        {isBusy && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-warning border-2 border-surface animate-pulse pointer-events-none z-20" />
        )}
      </button>
    );
  }

  // Panel position: always opens upwards and to the left of the bubble anchor so that the
  // bottom-right corner of the panel aligns with the bottom-right corner of the bubble.
  const activeBubblePos = pos || defaultAnchor;
  const panelW = isNarrow ? narrowFloatW : size.w;
  const panelH = isNarrow ? narrowFloatH : size.h;

  const panelPos = clampPos(
    {
      left: activeBubblePos.left + LAUNCHER_SIZE - panelW,
      top: activeBubblePos.top + LAUNCHER_SIZE - panelH,
    },
    panelW,
    panelH
  );

  const panelStyle = isNarrow && !pos
    ? { left: 8, right: 8, bottom: 8, height: 'min(74vh, 620px)', zIndex }
    : { ...panelPos, width: panelW, height: panelH, zIndex };

  return (
    <div
      ref={dragRef}
      id="guide-chat-panel"
      style={{ ...panelStyle, maxHeight: 'calc(100vh - 16px)', maxWidth: 'calc(100vw - 16px)' }}
      dir={isRtl ? 'rtl' : 'ltr'}
      role="dialog"
      aria-label={t('chat.title')}
      className="fixed flex flex-col rounded-sheet border border-line bg-surface-raised shadow-panel overflow-hidden font-sans animate-in fade-in duration-200"
    >
      {/* Resize grip (top-left corner; bottom-right stays anchored) */}
      {!isNarrow && (
        <div
          onPointerDown={beginResize}
          aria-hidden="true"
          style={{ touchAction: 'none' }}
          className="absolute top-0 left-0 w-5 h-5 z-20 cursor-nwse-resize group"
        >
          <span className="absolute top-1.5 left-1.5 w-2 h-2 border-t-2 border-l-2 border-line-strong rounded-tl-[3px] group-hover:border-accent transition-colors" />
        </div>
      )}
      {/* Header (drag handle) — draggable on both desktop and mobile (narrow) */}
      <div
        onPointerDown={(e) => beginDrag(e, null, true)}
        style={{ touchAction: 'none' }}
        className="flex items-center gap-2 px-3 py-2.5 border-b border-line bg-surface-sunken cursor-grab active:cursor-grabbing select-none shrink-0"
      >
        <GripHorizontal className="w-4 h-4 text-ink-subtle shrink-0" />
        <div className="p-1 rounded-control bg-accent-soft text-accent shrink-0">
          <MessageSquare className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold text-ink leading-tight truncate">
            {t('chat.title')}
          </h3>
          {timelineTitle && (
            <p className="text-[10.5px] text-ink-subtle truncate leading-tight">
              {timelineTitle}
            </p>
          )}
        </div>
        {/* Grounding mode toggle: Web Search / Fast */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          role="radiogroup"
          aria-label={t('toolbar.groundingToggle')}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="inline-flex items-center p-0.5 bg-surface-raised border border-line rounded-full shrink-0 gap-0.5 select-none"
        >
          <button
            type="button"
            role="radio"
            aria-checked={grounding}
            disabled={isBusy}
            onClick={() => setGroundingValue(true)}
            title={t('toolbar.groundingVerifiedTip')}
            className={`px-2 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              grounding
                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm'
                : 'text-ink-muted hover:text-ink hover:bg-surface-hover/60'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {t('toolbar.groundingToggle')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!grounding}
            disabled={isBusy}
            onClick={() => setGroundingValue(false)}
            title={t('toolbar.groundingFastTip')}
            className={`px-2 py-0.5 rounded-full text-[10px] sm:text-[10.5px] font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer ${
              !grounding
                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm'
                : 'text-ink-muted hover:text-ink hover:bg-surface-hover/60'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {t('toolbar.groundingFast')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          title={t('chat.minimize')}
          aria-label={t('chat.minimize')}
          className="p-1 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer shrink-0"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="p-1 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-3 gap-3">
            <div className="p-3 rounded-panel bg-surface-sunken text-accent border border-line">
              <Sparkles className="w-7 h-7" />
            </div>
            <p className="text-sm font-semibold text-ink">
              {t('chat.emptyTitle')}
            </p>
            <p className="text-[12px] leading-relaxed text-ink-subtle max-w-[260px]">
              {t('chat.emptyBody')}
            </p>
          </div>
        )}

        {messages.map((m) => {
          const mine = m.role === 'user';
          const contentRtl = isRtlText(m.content);
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div
                  dir={contentRtl ? 'rtl' : 'ltr'}
                  className={`px-3 py-2 rounded-panel text-[13px] leading-relaxed break-words ${
                    mine
                      ? 'bg-accent text-accent-fg rounded-br-sm whitespace-pre-wrap'
                      : m.error
                        ? 'bg-danger-soft text-danger border border-danger/20 rounded-bl-sm whitespace-pre-wrap'
                        : 'bg-surface-sunken text-ink rounded-bl-sm border border-line'
                  } ${contentRtl ? 'text-right' : 'text-left'}`}
                >
                  {mine || m.error ? (
                    m.content
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={MD_COMPONENTS}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )}
                </div>

                {/* Edit-applied chip with one-step Undo */}
                {m.action === 'edit' && !m.error && (
                  <div className="flex items-center gap-2 text-[11px] text-success bg-success-soft border border-success/20 rounded-control px-2 py-1">
                    <Wand2 className="w-3 h-3 shrink-0" />
                    <span>{m.undone ? t('chat.reverted') : t('chat.updated')}</span>
                    {m.canUndo && !m.undone && (
                      <button
                        type="button"
                        onClick={() => onUndo?.(m.id)}
                        className="flex items-center gap-1 font-semibold text-accent hover:underline cursor-pointer ms-1"
                      >
                        <Undo2 className="w-3 h-3" />
                        {t('chat.undo')}
                      </button>
                    )}
                  </div>
                )}

                {/* Grounding sources */}
                {Array.isArray(m.sources) && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-w-full">
                    {m.sources.slice(0, 4).map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.title}
                        className="flex items-center gap-1 text-[10.5px] text-ink-muted bg-surface-sunken hover:bg-surface-hover border border-line rounded-control px-1.5 py-0.5 max-w-[150px] truncate transition-colors"
                      >
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 text-ink-subtle" />
                        <span className="truncate">{s.title || s.url}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isBusy && (
          <div className="flex justify-start">
            <div className="px-3 py-2.5 rounded-panel rounded-bl-sm bg-surface-sunken border border-line">
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-line p-2.5 shrink-0 bg-surface-sunken">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={1000}
            dir={isRtlText(input) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
            placeholder={t('chat.placeholder')}
            className="flex-1 min-w-0 resize-none max-h-28 bg-surface-raised border border-line rounded-control px-3 py-2 text-[13px] text-ink placeholder-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 transition-all shadow-control"
            style={{ minHeight: 40 }}
          />
          {isBusy ? (
            <button
              type="button"
              onClick={onStop}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              className="p-2.5 rounded-control bg-danger hover:bg-danger-hover text-danger-fg transition-colors cursor-pointer shrink-0 shadow-control"
            >
              <Square className="w-4 h-4" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              title={t('chat.send')}
              aria-label={t('chat.send')}
              className="p-2.5 rounded-control bg-accent hover:bg-accent-hover text-accent-fg transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-control"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <span className="text-[10px] text-ink-subtle">
            {t('chat.disclaimer')}
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 text-[10.5px] text-ink-subtle hover:text-ink transition-colors cursor-pointer"
              title={t('chat.clear')}
            >
              <Trash2 className="w-3 h-3" />
              {t('chat.clear')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
