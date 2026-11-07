import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Undo2, Check } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { useHostedConfirm } from './StudioFeedback';
import { draftStoryOverview, getApiKey, notifyQuotaChanged } from '../../api';

/**
 * "Draft with AI" for the Story Studio overview: writes it from the story's own facts
 * (getFacts() -> the request body, see storyOverviewFacts) with a one-step Undo. Used both in the
 * Studio form and in the preview's Overview panel editor.
 */
export default function OverviewDraftButton({ value, onChange, getFacts, canDraft, timelineId = null, occasion = '' }) {
  const { t, language, contentMode } = useLanguage();
  const confirm = useHostedConfirm();
  const [isDrafting, setIsDrafting] = useState(false);
  const [undo, setUndo] = useState(null); // { previous, drafted }
  const [notice, setNotice] = useState(null); // { kind, text }
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(timerRef.current);
  }, []);

  const flash = (kind, text) => {
    clearTimeout(timerRef.current);
    setNotice({ kind, text });
    timerRef.current = setTimeout(() => setNotice(null), kind === 'error' ? 6000 : 3500);
  };

  const current = typeof value === 'string' ? value : '';
  const handleDraft = async () => {
    if (isDrafting) return;
    if (!canDraft) {
      flash('info', t('storyStudio.overviewNeedEvents'));
      return;
    }
    if (current.trim() && !(await confirm({
      body: t('storyStudio.overviewReplaceConfirm'),
      confirmLabel: t('storyStudio.overviewReplaceBtn'),
      cancelLabel: t('common.cancel'),
    }))) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsDrafting(true);
    setNotice(null);
    try {
      const res = await draftStoryOverview({
        story: getFacts(),
        language,
        timelineId,
        contentMode,
        occasion,
        signal: controller.signal,
      });
      notifyQuotaChanged();
      const drafted = typeof res?.overview === 'string' ? res.overview.trim() : '';
      if (!drafted) throw new Error('');
      setUndo({ previous: current, drafted });
      onChange(drafted);
      flash('info', t('storyStudio.overviewDrafted'));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      flash('error', err?.message && err.message !== 'Failed to draft the overview' ? err.message : t('storyStudio.overviewDraftError'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsDrafting(false);
    }
  };

  const showUndo = Boolean(undo && current === undo.drafted);
  const tooltip = getApiKey() ? t('storyStudio.overviewDraftTooltipByok') : t('storyStudio.overviewDraftTooltip');

  return (
    <span className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleDraft}
        disabled={isDrafting}
        title={tooltip}
        aria-busy={isDrafting || undefined}
        className="inline-flex items-center gap-2 rounded-full text-xs font-medium border px-3 py-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default bg-accent-soft/70 border-accent/30 text-accent hover:bg-accent-soft hover:border-accent/50"
        data-testid="studio-overview-draft"
      >
        {isDrafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        <span>{isDrafting ? t('storyStudio.overviewDrafting') : t(current.trim() ? 'storyStudio.overviewRedraft' : 'storyStudio.overviewDraft')}</span>
      </button>
      {showUndo && !isDrafting && (
        <button
          type="button"
          onClick={() => { onChange(undo.previous); setUndo(null); setNotice(null); }}
          className="inline-flex items-center gap-2 rounded-full text-xs font-medium border px-3 py-1 transition-colors cursor-pointer bg-surface-raised border-line text-ink-muted hover:text-ink hover:bg-surface-hover"
        >
          <Undo2 className="w-3.5 h-3.5" /><span>{t('storyStudio.overviewUndo')}</span>
        </button>
      )}
      {notice && (
        <span
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`absolute top-full mt-1 start-0 z-20 w-max max-w-[280px] px-3 py-2 rounded-control border text-caption leading-snug shadow-control flex items-start gap-2 ${
            notice.kind === 'error' ? 'bg-danger-soft border-danger/30 text-danger' : 'bg-surface-overlay border-line text-ink-muted'
          }`}
        >
          {notice.kind !== 'error' && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
          <span>{notice.text}</span>
        </span>
      )}
    </span>
  );
}
