import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, PenLine, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { FLOATING_Z } from '../utils/floatingFocus';

const CARD_W = 304;
const GAP = 10;
const AUTO_HIDE_MS = 14000;
const AUTO_HIDE_AFTER_HOVER_MS = 6000;

/**
 * Speech-bubble teaser anchored to the chat launcher (desktop floating bubble or mobile top-bar
 * button). Shows one example question and one example edit so both chat abilities are obvious.
 */
export default function ChatTeaser({ open, anchorId, question, editIdea, onPick, onDismiss }) {
  const { t, isRtl } = useLanguage();
  const [rect, setRect] = useState(null);
  const hideTimerRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return undefined;
    }
    const measure = () => {
      const el = document.getElementById(anchorId);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchorId]);

  const scheduleHide = (ms) => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => onDismissRef.current?.('timeout'), ms);
  };

  useEffect(() => {
    if (!open) return undefined;
    scheduleHide(AUTO_HIDE_MS);
    const onKey = (e) => { if (e.key === 'Escape') onDismissRef.current?.('close'); };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(hideTimerRef.current);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open || !rect || (!question && !editIdea)) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 16);
  const anchorCenterX = rect.left + rect.width / 2;
  const below = rect.top < vh / 2;
  const cardLeft = Math.max(8, Math.min(anchorCenterX > vw / 2 ? rect.right - width : rect.left, vw - width - 8));
  const arrowLeft = Math.max(14, Math.min(anchorCenterX - cardLeft - 6, width - 26));

  const style = {
    position: 'fixed',
    left: cardLeft,
    width,
    zIndex: FLOATING_Z.CHAT,
    ...(below ? { top: rect.bottom + GAP } : { bottom: vh - rect.top + GAP }),
  };

  const rows = [
    question && { key: 'ask', Icon: MessageCircleQuestion, label: t('chat.teaser.askLabel'), text: question },
    editIdea && { key: 'edit', Icon: PenLine, label: t('chat.teaser.editLabel'), text: editIdea },
  ].filter(Boolean);

  return (
    <div
      role="dialog"
      aria-label={t('chat.teaser.title')}
      dir={isRtl ? 'rtl' : 'ltr'}
      style={style}
      onMouseEnter={() => clearTimeout(hideTimerRef.current)}
      onMouseLeave={() => scheduleHide(AUTO_HIDE_AFTER_HOVER_MS)}
      className={`chronix-chat-teaser ${below ? 'is-below' : 'is-above'} rounded-panel border border-line bg-surface-overlay shadow-pop p-3`}
    >
      <span
        aria-hidden="true"
        style={{ left: arrowLeft }}
        className={`absolute w-3 h-3 rotate-45 bg-surface-overlay border-line ${below ? '-top-1.5 border-t border-l' : '-bottom-1.5 border-b border-r'}`}
      />
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-body-sm font-semibold text-ink leading-snug">{t('chat.teaser.title')}</p>
        <button
          type="button"
          onClick={() => onDismiss?.('close')}
          title={t('chat.teaser.dismiss')}
          aria-label={t('chat.teaser.dismiss')}
          className="-m-1 p-1 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="mt-1 text-caption leading-relaxed text-ink-muted">{t('chat.teaser.body')}</p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {rows.map(({ key, Icon, label, text }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick?.(text)}
            className="group flex items-start gap-2 w-full text-start rounded-control border border-line bg-surface-raised hover:bg-surface-hover px-2.5 py-2 transition-colors cursor-pointer"
          >
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-muted group-hover:text-ink" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</span>
              <span dir="auto" className="block text-caption leading-snug text-ink">{text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
