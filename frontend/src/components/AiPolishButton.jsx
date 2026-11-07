import { useEffect, useRef, useState } from 'react';
import { Wand2, Loader2, Undo2, Check } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { getApiKey, notifyQuotaChanged, polishText, TEXT_POLISH_MAX_CHARS } from '../api';

const baseBtn =
  'inline-flex items-center gap-2 rounded-full text-xs font-medium border transition-colors cursor-pointer ' +
  'disabled:opacity-40 disabled:cursor-default shrink-0';
const polishBtn = `${baseBtn} bg-accent-soft/70 border-accent/30 text-accent hover:bg-accent-soft hover:border-accent/50`;
const undoBtn = `${baseBtn} bg-surface-raised border-line text-ink-muted hover:text-ink hover:bg-surface-hover hover:border-line-strong`;

/**
 * "Polish with AI" for a free-text field: the user jots rough notes, one click rewrites them into
 * well-phrased text (same language, no invented facts), with a one-step Undo. Uses one AI credit
 * (two for very long drafts); admins and BYOK users are not charged.
 *
 * Props:
 *  - value / onChange(text): the controlled field value.
 *  - field: backend TextPolishField ('event_title', 'event_subtitle', 'event_description',
 *    'timeline_title', 'timeline_description', 'timeline_overview', 'moment_title', 'moment_story',
 *    'chapter_title').
 *  - context: short surrounding context (timeline topic, event title) to help the model.
 *  - maxLength: the field's character limit; the result is kept within it.
 *  - variant: 'chip' (icon + label) or 'icon' (compact, for single-line rows).
 *  - label / tooltip: optional wording for fields where "polish" undersells it (e.g. writing a
 *    story out from notes).
 */
export default function AiPolishButton({
  value,
  onChange,
  field,
  context = '',
  maxLength = null,
  timelineId = null,
  variant = 'chip',
  disabled = false,
  className = '',
  label: customLabel = null,
  tooltip: customTooltip = null,
}) {
  const { t, contentMode } = useLanguage();
  const [isPolishing, setIsPolishing] = useState(false);
  const [undo, setUndo] = useState(null); // { previous, polished }
  const [notice, setNotice] = useState(null); // { kind: 'error' | 'info', text }
  const abortRef = useRef(null);
  const noticeTimerRef = useRef(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(noticeTimerRef.current);
  }, []);

  const text = typeof value === 'string' ? value : '';
  const trimmed = text.trim();
  const tooLong = text.length > TEXT_POLISH_MAX_CHARS;
  const showUndo = Boolean(undo && text === undo.polished);
  const isIcon = variant === 'icon';

  const flash = (kind, message) => {
    clearTimeout(noticeTimerRef.current);
    setNotice({ kind, text: message });
    noticeTimerRef.current = setTimeout(() => setNotice(null), kind === 'error' ? 6000 : 3000);
  };

  const handlePolish = async () => {
    if (isPolishing || disabled) return;
    if (!trimmed) {
      flash('info', t('aiPolish.empty'));
      return;
    }
    if (tooLong) {
      flash('error', t('aiPolish.tooLong', { max: TEXT_POLISH_MAX_CHARS.toLocaleString() }));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsPolishing(true);
    setNotice(null);
    try {
      const res = await polishText({
        text,
        field,
        context,
        maxLength,
        timelineId,
        contentMode,
        signal: controller.signal,
      });
      notifyQuotaChanged();
      const polished = typeof res?.text === 'string' ? res.text : '';
      if (!polished.trim() || polished.trim() === trimmed) {
        flash('info', t('aiPolish.alreadyGood'));
        return;
      }
      setUndo({ previous: text, polished });
      onChange(polished);
      flash('info', t('aiPolish.done'));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      flash('error', err?.message && err.message !== 'Failed to polish text' ? err.message : t('aiPolish.error'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsPolishing(false);
    }
  };

  const handleUndo = () => {
    if (!undo) return;
    onChange(undo.previous);
    setUndo(null);
    setNotice(null);
  };

  const tooltip = customTooltip || (getApiKey() ? t('aiPolish.tooltipByok') : t('aiPolish.tooltip'));
  const label = isPolishing ? t('aiPolish.polishing') : (customLabel || t('aiPolish.button'));

  return (
    <span className={`relative inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handlePolish}
        disabled={disabled || isPolishing || !trimmed}
        title={tooltip}
        aria-label={isIcon ? `${label} — ${tooltip}` : undefined}
        aria-busy={isPolishing || undefined}
        className={`${polishBtn} ${isIcon ? 'p-2' : 'px-3 py-1'}`}
        data-testid={`ai-polish-${field}`}
      >
        {isPolishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {!isIcon && <span>{label}</span>}
      </button>
      {showUndo && !isPolishing && (
        <button
          type="button"
          onClick={handleUndo}
          title={t('aiPolish.undoTooltip')}
          aria-label={isIcon ? t('aiPolish.undo') : undefined}
          className={`${undoBtn} ${isIcon ? 'p-2' : 'px-3 py-1'}`}
        >
          <Undo2 className="w-3.5 h-3.5" />
          {!isIcon && <span>{t('aiPolish.undo')}</span>}
        </button>
      )}
      {notice && (
        <span
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`absolute top-full mt-1 start-0 z-20 w-max max-w-[260px] px-3 py-2 rounded-control border text-caption leading-snug shadow-control flex items-start gap-2 animate-in fade-in ${
            notice.kind === 'error'
              ? 'bg-danger-soft border-danger/30 text-danger'
              : 'bg-surface-overlay border-line text-ink-muted'
          }`}
        >
          {notice.kind !== 'error' && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
          <span>{notice.text}</span>
        </span>
      )}
    </span>
  );
}
