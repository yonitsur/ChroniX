import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  X, Check, Sparkles, Loader2, Search, Upload, Link2, Trash2, Star, ChevronDown, ChevronLeft, ChevronRight,
  Image as ImageIcon, Images, Calendar, Tag, Layers, MapPin, Globe, FileText, ExternalLink, Plus, Zap, Lock,
  ShieldCheck, Leaf, Clock, AlertCircle, Pencil,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { translations } from '../../locales/translations';
import { getDistinctCategories, getCategoryColor } from '../../data/laneColors';
import { isAiImageEditModalEnabled } from '../../utils/featureFlags';
import { formatAiModelName, formatUsdDigits, isGeminiModel } from '../../utils/modelUtils';
import useEventEditor from './useEventEditor';
import AiPolishButton from '../AiPolishButton';
import { applyTimeInput, inputDir, isGifUrl, PRECISION_LABEL_KEYS, PRECISION_OPTIONS } from './eventEditorUtils';

// Editable text that sits exactly where the read-only text sits: the negative margin cancels
// the padding so the words don't shift when the drawer switches into edit mode.
const inPlaceCls =
  'block w-full resize-none bg-transparent rounded-lg px-2 py-1 -mx-2 w-[calc(100%+1rem)] border border-dashed border-line-strong/60 ' +
  'hover:border-line-strong hover:bg-surface-hover/30 focus:border-solid focus:border-accent focus:bg-surface-raised ' +
  'focus:ring-2 focus:ring-accent-ring/20 outline-none transition-colors placeholder-ink-faint';
const fieldCls =
  'w-full min-w-0 rounded-control border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder-ink-faint ' +
  'outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring/20 shadow-control disabled:opacity-50';
const chipBtnCls =
  'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ' +
  'disabled:opacity-40 disabled:cursor-default';
const ghostBtnCls =
  `${chipBtnCls} bg-surface-raised border-line text-ink-muted hover:text-ink hover:bg-surface-hover hover:border-line-strong`;
const accentGhostBtnCls =
  `${chipBtnCls} bg-accent-soft/70 border-accent/30 text-accent hover:bg-accent-soft hover:border-accent/50`;
const smallLabelCls = 'block mb-1 text-caption font-medium text-ink-subtle';

function AutoTextarea({ value, minRows = 1, className = '', inputRef, ...rest }) {
  const ref = useRef(null);
  const setRef = (el) => {
    ref.current = el;
    if (inputRef) inputRef.current = el;
  };
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(resize, [value]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
    let lastWidth = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || 0;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      resize();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={setRef} rows={minRows} value={value} className={className} {...rest} />;
}

function SectionHeader({ Icon, label, count, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-ink">
        <Icon className="w-4 h-4 text-ink-subtle" />
        <span>{label}</span>
        {count > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-surface-active text-ink-muted text-caption font-semibold tabular-nums">{count}</span>
        )}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cover photo
// ---------------------------------------------------------------------------------------------

function AiImageOptions({ ed, onClose }) {
  const { t } = useLanguage();
  const ai = ed.aiImage;
  const busy = ed.isGeneratingAiImage;
  const premiumTitle = ai.isGeminiBlocked
    ? (ai.remainingCredits > 0
      ? t('eventEditModal.aiImageEngineInsufficientCreditsHint', { credits: ai.creditCost, remaining: ai.remainingCredits })
      : t('eventEditModal.aiImageEngineQuotaExhaustedHint'))
    : (ai.isPremiumFreeKey
      ? t('eventEditModal.aiImageEnginePremiumCreditHint', { credits: ai.creditCost })
      : t('eventEditModal.aiImageEnginePremiumHint'));
  const pill = (active) => `${chipBtnCls} ${active ? 'bg-accent text-accent-fg border-accent' : 'bg-surface-raised text-ink-muted border-line hover:text-ink'}`;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-accent">
          <Sparkles className="w-3.5 h-3.5" />
          {t('eventEditor.aiPanelTitle')}
        </span>
        <button type="button" onClick={onClose} className="p-1 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover cursor-pointer" aria-label={t('common.close')}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        type="text"
        value={ai.customPrompt}
        onChange={(e) => ai.setCustomPrompt(e.target.value)}
        placeholder={t('eventEditModal.aiImagePromptPlaceholder')}
        disabled={busy}
        className={fieldCls}
      />
      <div>
        <span className={smallLabelCls}>{t('eventEditModal.aiImageStyleLabel')}</span>
        <div className="flex flex-wrap gap-2">
          {['auto', 'historical', 'illustration', 'painting', 'cinematic'].map((key) => (
            <button key={key} type="button" disabled={busy} onClick={() => ai.setStyle(key)} className={pill(ai.style === key)}>
              {t(`eventEditModal.aiImageStyles.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={smallLabelCls}>{t('eventEditModal.aiImageEngineLabel')}</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => ai.selectEngine('free')} title={t('eventEditModal.aiImageEngineFreeHint')} className={pill(ai.engine === 'free')}>
            <Zap className="w-3 h-3 shrink-0" />
            {t('eventEditModal.aiImageEngineFree')}
          </button>
          <button
            type="button"
            disabled={busy || ai.isGeminiBlocked}
            onClick={() => ai.selectEngine('premium')}
            title={premiumTitle}
            className={ai.isGeminiBlocked ? `${chipBtnCls} bg-surface-raised text-ink-subtle border-line opacity-50 !cursor-not-allowed` : pill(ai.engine === 'premium')}
          >
            {ai.isGeminiBlocked ? <Lock className="w-3 h-3 text-amber-500 shrink-0" /> : <Sparkles className="w-3 h-3 shrink-0" />}
            {t('eventEditModal.aiImageEnginePremium')}
            {ai.isPremiumFreeKey ? ` · ${ai.creditCost}` : ''}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={ed.generateAiCover}
        disabled={busy || ed.isProcessingImage}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-control transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {busy ? t('eventEditModal.generatingAiImage') : t('eventEditor.generateCover')}
      </button>
    </div>
  );
}

function OverlayButton({ Icon, label, onClick, active = false, danger = false, iconOnly = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-2 h-8 rounded-full border backdrop-blur-md text-caption font-semibold shadow-pop transition-colors cursor-pointer ${
        iconOnly ? 'w-8 justify-center' : 'px-3'
      } ${
        active
          ? 'bg-white text-black border-white'
          : danger
            ? 'bg-black/60 text-white border-white/20 hover:bg-red-600/90 hover:border-red-500'
            : 'bg-black/60 text-white border-white/20 hover:bg-black/85'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

function CoverEditor({ ed }) {
  const { t } = useLanguage();
  const { draft } = ed;
  const fileRef = useRef(null);
  const [panel, setPanel] = useState(null); // 'url' | 'ai' | null
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBroken, setIsBroken] = useState(false);
  useEffect(() => setIsBroken(false), [draft.imageUrl]);

  const aiEnabled = isAiImageEditModalEnabled();
  const busy = ed.isProcessingImage || ed.isGeneratingAiImage;
  const hasImage = Boolean(draft.imageUrl);
  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));

  const dropProps = {
    onDragOver: (e) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: () => setIsDragOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        ed.uploadCover(file);
        return;
      }
      const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
      if (/^https?:\/\//i.test(url)) ed.setCoverUrl(url);
    },
  };

  const aiBadge = (() => {
    if (draft.imageSource !== 'ai') return null;
    const hasCost = Number(draft.imageCostUsd) > 0 && isGeminiModel(draft.imageModel);
    if (draft.imageModel && hasCost) {
      return t('eventEditModal.aiImageBadgeWithCost', { model: formatAiModelName(draft.imageModel), cost: formatUsdDigits(draft.imageCostUsd) });
    }
    if (draft.imageModel) return t('eventEditModal.aiImageBadgeWithModel', { model: formatAiModelName(draft.imageModel) });
    return t('eventEditModal.aiImageBadge');
  })();

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) ed.uploadCover(file);
        }}
      />

      {hasImage ? (
        <div
          {...dropProps}
          className={`relative w-full aspect-[16/10] max-h-[280px] rounded-xl overflow-hidden bg-surface-sunken border shadow-card transition-colors ${
            isDragOver ? 'border-accent ring-2 ring-accent/40' : 'border-line'
          }`}
        >
          {isBroken ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-subtle text-xs">
              <ImageIcon className="w-7 h-7 opacity-60" />
              <span>{t('eventEditor.imageBroken')}</span>
            </div>
          ) : (
            <img src={draft.imageUrl} alt="" className="w-full h-full object-cover bg-white" onError={() => setIsBroken(true)} />
          )}

          {aiBadge && (
            <span className="absolute top-2.5 end-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-caption font-medium border border-white/15 pointer-events-none">
              <Sparkles className="w-2.5 h-2.5 text-amber-400 shrink-0" />
              {aiBadge}
            </span>
          )}
          {isGifUrl(draft.imageUrl) && (
            <span className="absolute top-2.5 start-2.5 px-2 py-0.5 rounded bg-black/70 text-white text-caption font-black tracking-wider pointer-events-none">GIF</span>
          )}

          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px] text-white text-xs font-semibold gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {ed.isGeneratingAiImage ? t('eventEditModal.generatingAiImage') : t('eventEditor.processingPhoto')}
            </div>
          )}

          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-accent/25 text-white text-sm font-semibold pointer-events-none">
              {t('eventEditor.dropToReplace')}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 p-3 pt-10 bg-gradient-to-t from-black/75 via-black/35 to-transparent flex items-center gap-2">
            <OverlayButton Icon={Upload} label={t('eventEditor.replacePhoto')} onClick={() => fileRef.current?.click()} />
            <OverlayButton Icon={Link2} label={t('eventEditor.photoLink')} onClick={() => togglePanel('url')} active={panel === 'url'} />
            {aiEnabled && <OverlayButton Icon={Sparkles} label={t('eventEditor.aiShort')} onClick={() => togglePanel('ai')} active={panel === 'ai'} />}
            <span className="flex-1" />
            <OverlayButton Icon={Trash2} label={t('eventEditor.removePhoto')} onClick={ed.clearCover} danger iconOnly />
          </div>
        </div>
      ) : (
        <div
          {...dropProps}
          className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center text-center gap-3 transition-colors ${
            isDragOver ? 'border-accent bg-accent-soft/40' : 'border-line-strong/60 bg-surface-sunken/60'
          }`}
        >
          <div className="w-11 h-11 rounded-full bg-surface-raised border border-line flex items-center justify-center text-ink-subtle shadow-control">
            {busy ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : <ImageIcon className="w-5 h-5" />}
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-ink">{t('eventEditor.addCoverTitle')}</p>
            <p className="text-caption text-ink-subtle">{t('eventEditor.addCoverHint')}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={ghostBtnCls} onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="w-3.5 h-3.5" />
              {t('eventEditor.uploadPhoto')}
            </button>
            <button type="button" className={ghostBtnCls} onClick={() => togglePanel('url')} disabled={busy}>
              <Link2 className="w-3.5 h-3.5" />
              {t('eventEditor.photoLink')}
            </button>
            {aiEnabled && (
              <button type="button" className={accentGhostBtnCls} onClick={() => togglePanel('ai')} disabled={busy}>
                <Sparkles className="w-3.5 h-3.5" />
                {t('eventEditor.generateCover')}
              </button>
            )}
          </div>
        </div>
      )}

      {panel === 'url' && (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <input
            type="url"
            dir="ltr"
            autoFocus
            value={draft.imageUrl.startsWith('data:') ? '' : draft.imageUrl}
            onChange={(e) => ed.setCoverUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setPanel(null);
              }
            }}
            placeholder={draft.imageUrl.startsWith('data:') ? t('eventEditModal.imageUploadedPlaceholder') : 'https://upload.wikimedia.org/…'}
            className={`${fieldCls} text-xs text-left`}
          />
          <button type="button" onClick={() => setPanel(null)} className={ghostBtnCls}>
            <Check className="w-3.5 h-3.5" />
            {t('eventEditor.done')}
          </button>
        </div>
      )}
      {panel === 'ai' && aiEnabled && <AiImageOptions ed={ed} onClose={() => setPanel(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Title / subtitle
// ---------------------------------------------------------------------------------------------

function QuotaPill({ info }) {
  const { t } = useLanguage();
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium border';
  if (info.isAdmin) {
    return <span className={`${base} text-warning bg-warning-soft border-warning/40`}><ShieldCheck className="w-3 h-3" />{t('eventEditModal.adminUnlimited')}</span>;
  }
  if (info.isEventAddUnlimited) {
    return <span className={`${base} text-accent bg-accent-soft border-accent/40`}><Sparkles className="w-3 h-3" />{t('eventEditModal.unlimitedNotice')}</span>;
  }
  if (info.isFreeMode) {
    return <span className={`${base} text-warning bg-warning-soft border-warning/40`} title={t('quota.freeModeNotice')}><Leaf className="w-3 h-3" />{t('quota.badgeFreeMode')}</span>;
  }
  if (info.isEventAddFreeTier) {
    return <span className={`${base} text-warning bg-warning-soft border-warning/40`}><Clock className="w-3 h-3" />{t('eventEditModal.freeTierNotice', { limit: info.eventAddLimit })}</span>;
  }
  return (
    <span className={`${base} text-accent bg-accent-soft border-accent/40`} title={t('eventEditModal.remainingTooltip', { remaining: info.eventAddRemaining, limit: info.eventAddLimit })}>
      <Sparkles className="w-3 h-3" />
      {t('eventEditModal.remainingPremium', { remaining: info.eventAddRemaining, limit: info.eventAddLimit })}
    </span>
  );
}

function WikiCandidates({ ed }) {
  const { t } = useLanguage();
  if (!ed.wikiCandidates.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface-overlay shadow-panel overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="px-3 py-2 bg-surface-raised border-b border-line flex items-center justify-between text-xs font-semibold text-ink">
        <span className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-accent" />
          {t('eventEditModal.wikiCandidatesHeader', { count: ed.wikiCandidates.length })}
        </span>
        <button type="button" onClick={ed.dismissWikiCandidates} aria-label={t('common.close')} className="p-0.5 text-ink-subtle hover:text-ink cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line">
        {ed.wikiCandidates.map((cand, idx) => (
          <button
            key={cand.wikiTitle || idx}
            type="button"
            onClick={() => ed.applyWikiCandidate(cand)}
            className="w-full p-3 hover:bg-surface-hover cursor-pointer transition-colors flex items-start gap-3 text-start group"
          >
            {cand.imageUrl ? (
              <img src={cand.imageUrl} alt="" className="w-11 h-11 rounded-control object-cover bg-white border border-line shrink-0" />
            ) : (
              <span className="w-11 h-11 rounded-control bg-surface-sunken border border-line flex items-center justify-center shrink-0 text-ink-subtle">
                <ImageIcon className="w-5 h-5 opacity-60" />
              </span>
            )}
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-1">
                <span className="font-semibold text-xs text-ink group-hover:text-accent truncate">{cand.wikiTitle}</span>
                {idx === 0 && (
                  <span className="text-caption bg-accent-soft text-accent font-medium px-2 py-0.5 rounded-control shrink-0">{t('eventEditModal.bestMatchBadge')}</span>
                )}
              </span>
              {cand.description && <span className="block text-caption text-ink-muted line-clamp-1 mt-0.5">{cand.description}</span>}
              {cand.extract && <span className="block text-caption text-ink-subtle line-clamp-2 mt-0.5 leading-snug">{cand.extract}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Properties: when / topic / lane / place
// ---------------------------------------------------------------------------------------------

function PropertyRow({ Icon, label, value, placeholder, isOpen, onToggle, isMissing = false, children }) {
  return (
    <div className={isOpen ? 'bg-surface-sunken/50' : ''}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-3 px-3 py-3 text-start hover:bg-surface-hover/70 transition-colors cursor-pointer group"
      >
        <Icon className={`w-4 h-4 shrink-0 ${isMissing ? 'text-danger' : 'text-ink-subtle'}`} />
        <span className="w-16 shrink-0 text-caption font-medium text-ink-subtle">{label}</span>
        <span className={`flex-1 min-w-0 truncate text-sm ${value ? 'text-ink font-medium' : (isMissing ? 'text-danger' : 'text-ink-subtle')}`}>
          {value || placeholder}
        </span>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-ink-subtle rotate-180 transition-transform" />
        ) : (
          <Pencil className="w-3.5 h-3.5 shrink-0 text-ink-subtle group-hover:text-ink-subtle transition-colors" />
        )}
      </button>
      {isOpen && <div className="px-3 pb-4 pt-1 space-y-3 animate-in fade-in duration-150">{children}</div>}
    </div>
  );
}

function SegmentedControl({ value, options, onChange }) {
  return (
    <div className="inline-flex p-0.5 rounded-control bg-surface-sunken border border-line w-full">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`flex-1 px-2 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer ${
            value === opt.value ? 'bg-surface-raised text-ink shadow-control' : 'text-ink-subtle hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function DateFields({ year, month, day, time, onYear, onMonth, onDay, onTime, months, yearRequired = false }) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-2">
      <label className="min-w-0">
        <span className={smallLabelCls}>{t('eventEditModal.yearLabel')}{yearRequired ? ' *' : ''}</span>
        <input type="number" dir="ltr" value={year} onChange={(e) => onYear(e.target.value)} placeholder="1969" className={`${fieldCls} font-mono text-xs`} />
      </label>
      <label className="min-w-0">
        <span className={smallLabelCls}>{t('eventEditModal.monthLabel')}</span>
        <select value={month === '' || month == null ? '' : String(month)} onChange={(e) => onMonth(e.target.value)} className={`${fieldCls} text-xs cursor-pointer`}>
          <option value="">—</option>
          {months.map((name, i) => <option key={name} value={String(i + 1)}>{name}</option>)}
        </select>
      </label>
      <label className="min-w-0">
        <span className={smallLabelCls}>{t('eventEditModal.dayLabel')}</span>
        <input type="number" dir="ltr" min={1} max={31} value={day} disabled={!month} onChange={(e) => onDay(e.target.value)} placeholder="—" className={`${fieldCls} text-xs`} />
      </label>
      <label className="min-w-0">
        <span className={smallLabelCls}>{t('eventEditor.time')}</span>
        <input type="time" dir="ltr" value={time} disabled={!day} title={t('eventEditModal.timeHint')} onChange={(e) => onTime(e.target.value)} className={`${fieldCls} text-xs font-mono px-2`} />
      </label>
    </div>
  );
}

function DateEditor({ ed }) {
  const { t, language } = useLanguage();
  const { draft, set } = ed;
  const months = translations[language]?.dates?.monthsFull || translations.en.dates.monthsFull;
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink">{t('eventEditor.starts')}</span>
          <button
            type="button"
            onClick={ed.suggestDates}
            disabled={ed.isSuggesting || !draft.title.trim()}
            title={t('eventEditModal.suggestDatesTooltip')}
            className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover px-2 py-0.5 rounded-control hover:bg-accent-soft transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {ed.isSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {t('eventEditModal.suggestDatesBtn')}
          </button>
        </div>
        <DateFields
          year={draft.fromYear}
          month={draft.fromMonth}
          day={draft.fromDay}
          time={draft.fromTime}
          onYear={(v) => set('fromYear', v)}
          onMonth={ed.setFromMonth}
          onDay={ed.setFromDay}
          onTime={ed.setFromTime}
          months={months}
          yearRequired
        />
        <p className="text-caption text-ink-subtle">{t('eventEditModal.yearBceNote')}</p>
      </div>

      <label className="block">
        <span className={smallLabelCls}>{t('eventEditModal.precisionLabel')}</span>
        <select value={draft.fromPrecision} onChange={(e) => ed.setPrecision(e.target.value)} className={`${fieldCls} text-xs cursor-pointer`}>
          {PRECISION_OPTIONS.map((p) => <option key={p} value={p}>{t(`eventEditModal.${PRECISION_LABEL_KEYS[p]}`)}</option>)}
        </select>
      </label>

      <div className="space-y-2">
        <span className="block text-xs font-semibold text-ink">{t('eventEditor.ends')}</span>
        <SegmentedControl
          value={draft.endMode}
          onChange={(v) => set('endMode', v)}
          options={[
            { value: 'none', label: t('eventEditor.endNone') },
            { value: 'range', label: t('eventEditor.endDate') },
            { value: 'ongoing', label: t('eventEditor.endOngoing') },
          ]}
        />
        {draft.endMode === 'range' && (
          <DateFields
            year={draft.toYear}
            month={draft.toMonth}
            day={draft.toDay}
            time={draft.toTime}
            onYear={(v) => set('toYear', v)}
            onMonth={(v) => ed.patch(v ? { toMonth: v } : { toMonth: '', toDay: '', toTime: '' })}
            onDay={(v) => ed.patch(v ? { toDay: v } : { toDay: '', toTime: '' })}
            onTime={ed.setToTime}
            months={months}
          />
        )}
      </div>
    </>
  );
}

function ChoiceChips({ options, value, onChange, newLabel, isNew, newValue, onNewValue, newPlaceholder, maxLength }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = !isNew && opt.value === value;
          return (
            <button
              key={opt.value || '__none__'}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`${chipBtnCls} max-w-full ${
                active
                  ? 'bg-accent-soft border-accent text-ink ring-1 ring-accent/40'
                  : 'bg-surface-raised border-line text-ink-muted hover:text-ink hover:border-line-strong'
              }`}
            >
              {opt.color !== undefined && (
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${opt.color ? 'ring-1 ring-black/10 dark:ring-white/20' : 'border border-dashed border-ink-faint'}`}
                  style={opt.color ? { backgroundColor: opt.color } : undefined}
                />
              )}
              <span className="truncate">{opt.label}</span>
              {active && <Check className="w-3 h-3 shrink-0 text-accent" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange('__new__')}
          aria-pressed={isNew}
          className={`${chipBtnCls} border-dashed ${isNew ? 'bg-accent-soft border-accent text-accent' : 'bg-transparent border-line-strong text-ink-subtle hover:text-ink'}`}
        >
          <Plus className="w-3 h-3" />
          {newLabel}
        </button>
      </div>
      {isNew && (
        <input
          type="text"
          autoFocus
          value={newValue}
          maxLength={maxLength}
          onChange={(e) => onNewValue(e.target.value)}
          placeholder={newPlaceholder}
          className={fieldCls}
        />
      )}
    </div>
  );
}

function PlaceEditor({ ed }) {
  const { t, isRtl } = useLanguage();
  const { draft, set } = ed;
  const hasCoords = draft.lat !== '' && draft.lng !== '';
  return (
    <>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft.locationName}
          dir={inputDir(draft.locationName, isRtl)}
          onChange={(e) => set('locationName', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ed.searchLocation();
            }
          }}
          placeholder={t('eventEditModal.locationNamePlaceholder')}
          className={fieldCls}
        />
        <button
          type="button"
          onClick={ed.searchLocation}
          disabled={ed.isSearchingLocation || !draft.locationName.trim()}
          title={t('eventEditModal.locationSearchTooltip')}
          className="shrink-0 inline-flex items-center gap-2 px-3 rounded-control bg-surface-raised hover:bg-surface-hover border border-line text-xs font-medium text-ink shadow-control cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          {ed.isSearchingLocation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5 text-accent" />}
          {t('eventEditor.findPlace')}
        </button>
      </div>

      {ed.locationCandidates.length > 0 && (
        <div className="rounded-control border border-line bg-surface-overlay shadow-panel overflow-hidden">
          <div className="px-3 py-2 bg-surface-raised border-b border-line flex items-center justify-between text-caption font-semibold text-ink">
            <span>{t('eventEditModal.locationCandidatesHeader', { count: ed.locationCandidates.length })}</span>
            <button type="button" onClick={ed.dismissLocationCandidates} aria-label={t('common.close')} className="p-0.5 text-ink-subtle hover:text-ink cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-line">
            {ed.locationCandidates.map((cand, idx) => (
              <button
                key={`${cand.lat}-${cand.lng}-${idx}`}
                type="button"
                onClick={() => ed.applyLocationCandidate(cand)}
                className="w-full px-3 py-2 hover:bg-surface-hover cursor-pointer transition-colors text-start flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 mt-0.5 text-danger shrink-0" />
                <span className="min-w-0">
                  <span className="block font-semibold text-xs text-ink truncate">{cand.name}</span>
                  <span className="block text-caption text-ink-muted line-clamp-1" dir="ltr">{cand.displayName}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className={smallLabelCls}>{t('eventEditModal.latitudeLabel')}</span>
          <input type="number" step="any" dir="ltr" value={draft.lat} onChange={(e) => set('lat', e.target.value)} placeholder="31.77" className={`${fieldCls} font-mono text-xs text-left`} />
        </label>
        <label className="min-w-0">
          <span className={smallLabelCls}>{t('eventEditModal.longitudeLabel')}</span>
          <input type="number" step="any" dir="ltr" value={draft.lng} onChange={(e) => set('lng', e.target.value)} placeholder="35.21" className={`${fieldCls} font-mono text-xs text-left`} />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        {hasCoords ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${draft.lat},${draft.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-caption text-accent hover:underline"
          >
            {t('eventEditModal.testGoogleMaps')}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-caption text-ink-subtle">{t('eventEditor.placeHint')}</span>
        )}
        {(draft.locationName || hasCoords) && (
          <button type="button" onClick={ed.clearLocation} className="text-caption font-medium text-ink-subtle hover:text-danger cursor-pointer">
            {t('eventEditor.clearPlace')}
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Gallery & source
// ---------------------------------------------------------------------------------------------

function GalleryEditor({ ed }) {
  const { t, isRtl } = useLanguage();
  const { draft } = ed;
  const images = draft.additionalImages;
  const fileRef = useRef(null);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkCaption, setLinkCaption] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const addLink = () => {
    if (ed.addGalleryUrl(linkUrl, linkCaption)) {
      setLinkUrl('');
      setLinkCaption('');
    }
  };
  const tileBtn = 'w-7 h-7 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/85 text-white border border-white/20 backdrop-blur-md cursor-pointer transition-colors';

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-colors ${isDragOver ? 'border-accent bg-accent-soft/30' : 'border-line bg-surface-hover/40'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files?.length) ed.uploadGalleryFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          ed.uploadGalleryFiles(files);
          e.target.value = '';
        }}
      />
      <SectionHeader Icon={Images} label={t('eventDrawer.additionalPhotos')} count={images.length}>
        <button type="button" onClick={() => setShowLink((v) => !v)} className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:text-accent-hover cursor-pointer">
          <Link2 className="w-3 h-3" />
          {t('eventEditor.addFromLink')}
        </button>
      </SectionHeader>

      {showLink && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <input
            type="url"
            dir="ltr"
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder={t('eventEditModal.addPhotoUrlPlaceholder')}
            className={`${fieldCls} text-xs text-left`}
          />
          <div className="flex gap-2">
            <input
              type="text"
              dir={inputDir(linkCaption, isRtl)}
              value={linkCaption}
              onChange={(e) => setLinkCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLink();
                }
              }}
              placeholder={t('eventEditModal.photoCaptionPlaceholder')}
              className={`${fieldCls} text-xs`}
            />
            <button
              type="button"
              onClick={addLink}
              disabled={!linkUrl.trim()}
              className="shrink-0 inline-flex items-center gap-1 px-3 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-control cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('eventEditModal.addPhotoBtn')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {images.map((img, idx) => (
          <div key={`${idx}-${img.url.slice(-24)}`} className="group relative flex flex-col rounded-lg overflow-hidden border border-line bg-surface-raised shadow-2xs">
            <div className="relative w-full aspect-[4/3] bg-surface-sunken">
              <img src={img.url} alt={img.caption || ''} className="w-full h-full object-cover bg-white" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              <div className="absolute inset-x-0 top-0 p-2 flex items-center justify-between gap-1 bg-gradient-to-b from-black/50 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button type="button" className={tileBtn} onClick={() => ed.setGalleryImageAsCover(idx)} title={t('eventEditModal.setAsCover')} aria-label={t('eventEditModal.setAsCover')}>
                  <Star className="w-3.5 h-3.5 text-amber-300" />
                </button>
                <span className="flex items-center gap-1">
                  {idx > 0 && (
                    <button type="button" className={tileBtn} onClick={() => ed.moveGalleryImage(idx, -1)} title={t('eventEditModal.movePhotoEarlier')} aria-label={t('eventEditModal.movePhotoEarlier')}>
                      {isRtl ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  {idx < images.length - 1 && (
                    <button type="button" className={tileBtn} onClick={() => ed.moveGalleryImage(idx, 1)} title={t('eventEditModal.movePhotoLater')} aria-label={t('eventEditModal.movePhotoLater')}>
                      {isRtl ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button type="button" className={`${tileBtn} hover:!bg-red-600/90`} onClick={() => ed.removeGalleryImage(idx)} title={t('eventEditModal.removePhoto')} aria-label={t('eventEditModal.removePhoto')}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            </div>
            <input
              type="text"
              value={img.caption || ''}
              dir={inputDir(img.caption, isRtl)}
              onChange={(e) => ed.updateGalleryCaption(idx, e.target.value)}
              placeholder={t('eventEditor.addCaption')}
              className="w-full px-2 py-2 bg-transparent border-t border-line text-caption text-ink placeholder-ink-faint outline-none focus:bg-surface-sunken focus:ring-1 focus:ring-inset focus:ring-accent/40"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={ed.isProcessingAdditional}
          className="flex flex-col items-center justify-center gap-2 min-h-[112px] rounded-lg border-2 border-dashed border-line-strong/60 text-ink-subtle hover:text-accent hover:border-accent/60 hover:bg-accent-soft/30 transition-colors cursor-pointer disabled:cursor-wait"
        >
          {ed.isProcessingAdditional ? <Loader2 className="w-5 h-5 animate-spin text-accent" /> : <Plus className="w-5 h-5" />}
          <span className="text-caption font-medium">{t('eventEditor.addPhotos')}</span>
          <span className="text-caption text-ink-subtle px-2 text-center">{t('eventEditor.dragHint')}</span>
        </button>
      </div>
    </div>
  );
}

function SourceEditor({ ed }) {
  const { t, isRtl } = useLanguage();
  const { draft, set } = ed;
  return (
    <div className="rounded-xl border border-line bg-surface-hover/40 p-4 space-y-3">
      <SectionHeader Icon={Globe} label={t('eventEditModal.sourceSectionLabel')}>
        {(draft.sourceName || draft.sourceUrl) && (
          <button type="button" onClick={ed.clearSource} className="text-caption font-medium text-ink-subtle hover:text-danger cursor-pointer">
            {t('eventEditModal.clearSource')}
          </button>
        )}
      </SectionHeader>
      <label className="block">
        <span className={smallLabelCls}>{t('eventEditModal.sourceNameLabel')}</span>
        <input
          type="text"
          dir={inputDir(draft.sourceName, isRtl)}
          value={draft.sourceName}
          onChange={(e) => set('sourceName', e.target.value)}
          placeholder={t('eventEditModal.sourceNamePlaceholder')}
          className={`${fieldCls} text-xs`}
        />
      </label>
      <label className="block">
        <span className={`${smallLabelCls} flex items-center justify-between`}>
          <span>{t('eventEditModal.sourceUrlLabel')}</span>
          {draft.sourceUrl && (
            <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {t('eventEditModal.openPage')}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </span>
        <input
          type="url"
          dir="ltr"
          value={draft.sourceUrl}
          onChange={(e) => ed.setSourceUrl(e.target.value)}
          placeholder={t('eventEditModal.sourceUrlPlaceholder')}
          className={`${fieldCls} text-xs text-left`}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

/**
 * In-place editor for an event, rendered inside the event drawer in place of the read-only
 * details. Mirrors the read layout (cover, title, facts, description, photos, source) so each
 * piece is edited where it's shown. Renders its own scroll area and Save / Cancel footer.
 */
export default function InlineEventEditor({
  initialEvent = null,
  isNew = false,
  lanes = [],
  articles = [],
  timelineTitle = '',
  timeScale = 'calendar',
  timelineId = null,
  isTimelineFictional = false,
  quota = null,
  onRefreshQuota,
  onSave,
  onCancel,
  onDirtyChange,
  isMobile = false,
}) {
  const { t, isRtl, contentMode, formatTimeSpan } = useLanguage();
  const ed = useEventEditor({
    initialEvent,
    lanes,
    timelineTopic: timelineTitle,
    timeScale,
    timelineId,
    isTimelineFictional,
    quota,
    onRefreshQuota,
    t,
    contentMode,
  });
  const { draft, set } = ed;
  const [openProp, setOpenProp] = useState(isNew ? 'when' : null);
  const [showErrors, setShowErrors] = useState(false);
  const titleRef = useRef(null);
  const toggleProp = (name) => setOpenProp((p) => (p === name ? null : name));

  useEffect(() => {
    onDirtyChange?.(ed.isDirty);
  }, [ed.isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  const requestCancel = () => {
    if (ed.isDirty && !window.confirm(t('eventEditor.discardConfirm'))) return;
    onCancel?.();
  };

  const handleSave = () => {
    if (!ed.canSave) {
      setShowErrors(true);
      if (!draft.title.trim()) titleRef.current?.focus();
      else setOpenProp('when');
      return;
    }
    if (!isNew && !ed.isDirty) {
      onCancel?.();
      return;
    }
    onSave?.(ed.buildArticle());
  };

  // Esc closes the innermost open helper first, then cancels; Ctrl/Cmd+Enter saves.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const escapeRef = useRef(null);
  escapeRef.current = () => {
    if (ed.wikiCandidates.length) ed.dismissWikiCandidates();
    else if (ed.locationCandidates.length) ed.dismissLocationCandidates();
    else if (openProp) setOpenProp(null);
    else requestCancel();
  };
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        escapeRef.current();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- Property summaries ----
  const previewSpan = (() => {
    if (draft.fromYear === '' || isNaN(Number(draft.fromYear))) return '';
    try {
      const from = applyTimeInput({
        year: parseInt(draft.fromYear, 10),
        month: draft.fromMonth ? parseInt(draft.fromMonth, 10) : undefined,
        day: draft.fromDay ? parseInt(draft.fromDay, 10) : undefined,
      }, draft.fromTime, draft.fromPrecision);
      const to = draft.endMode === 'range' && draft.toYear !== '' && !isNaN(Number(draft.toYear))
        ? applyTimeInput({
          year: parseInt(draft.toYear, 10),
          month: draft.toMonth ? parseInt(draft.toMonth, 10) : undefined,
          day: draft.toDay ? parseInt(draft.toDay, 10) : undefined,
        }, draft.toTime, draft.fromPrecision)
        : undefined;
      return formatTimeSpan(from, to, draft.endMode === 'ongoing');
    } catch {
      return String(draft.fromYear);
    }
  })();

  const categories = getDistinctCategories(articles);
  const topicNames = draft.category && draft.category !== '__new__' && !categories.includes(draft.category)
    ? [...categories, draft.category]
    : categories;
  const topicOptions = [
    { value: '', label: t('eventEditor.none'), color: null },
    ...topicNames.map((c) => ({ value: c, label: c, color: getCategoryColor(c, categories) || null })),
  ];
  const topicSummary = draft.category === '__new__' ? draft.newCategoryName.trim() : draft.category;
  const topicColor = draft.category && draft.category !== '__new__' ? getCategoryColor(draft.category, categories) : null;

  const laneOptions = [
    { value: '', label: t('eventEditor.none'), color: null },
    ...lanes.map((l) => ({ value: l.id, label: l.title, color: l.color || null })),
  ];
  if (draft.lane && draft.lane !== '__new__' && !lanes.some((l) => String(l.id) === String(draft.lane))) {
    laneOptions.push({ value: draft.lane, label: draft.lane, color: null });
  }
  const laneSummary = draft.lane === '__new__'
    ? draft.newLaneName.trim()
    : (lanes.find((l) => String(l.id) === String(draft.lane))?.title || draft.lane);

  const placeSummary = draft.locationName.trim()
    || (draft.lat !== '' && draft.lng !== '' ? `${Number(draft.lat).toFixed(2)}°, ${Number(draft.lng).toFixed(2)}°` : '');

  const titleMissing = showErrors && !draft.title.trim();
  const dateMissing = showErrors && (draft.fromYear === '' || isNaN(Number(draft.fromYear)));

  return (
    <>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-5 text-ink selection:bg-accent/20 animate-in fade-in duration-200">
        <CoverEditor ed={ed} />

        {/* Title, assists, subtitle */}
        <div className="space-y-2">
          <AutoTextarea
            inputRef={titleRef}
            value={draft.title}
            dir={inputDir(draft.title, isRtl)}
            maxLength={150}
            aria-label={t('eventEditModal.titleLabel')}
            placeholder={t('eventEditor.titlePlaceholder')}
            onChange={(e) => {
              set('title', e.target.value.replace(/\n/g, ' '));
              if (ed.wikiCandidates.length) ed.dismissWikiCandidates();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.preventDefault();
            }}
            className={`${inPlaceCls} event-drawer-title text-xl sm:text-2xl font-semibold font-serif text-ink tracking-tight leading-snug ${titleMissing ? '!border-danger !border-solid' : ''}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={ed.autoFill}
              disabled={ed.isSuggesting || !draft.title.trim()}
              title={t('eventEditModal.autoFillTooltip')}
              className={accentGhostBtnCls}
            >
              {ed.isSuggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t('eventEditModal.autoFillAi')}
            </button>
            <button
              type="button"
              onClick={ed.searchWikipedia}
              disabled={ed.isSearchingWiki || !draft.title.trim()}
              title={t('eventEditModal.wikiTooltip')}
              className={ghostBtnCls}
            >
              {ed.isSearchingWiki ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {t('eventEditor.findOnWikipedia')}
            </button>
            <AiPolishButton
              variant="icon"
              field="event_title"
              value={draft.title}
              onChange={(v) => set('title', v)}
              context={timelineTitle}
              maxLength={150}
              timelineId={timelineId}
            />
            {timelineId && <QuotaPill info={ed.quotaInfo} />}
          </div>
          <WikiCandidates ed={ed} />
          <AutoTextarea
            value={draft.subtitle}
            dir={inputDir(draft.subtitle, isRtl)}
            maxLength={600}
            aria-label={t('eventEditModal.subtitleLabel')}
            placeholder={t('eventEditor.subtitlePlaceholder')}
            onChange={(e) => set('subtitle', e.target.value)}
            className={`${inPlaceCls} text-sm text-ink-muted leading-relaxed`}
          />
          <div className="flex justify-end">
            <AiPolishButton
              field="event_subtitle"
              value={draft.subtitle}
              onChange={(v) => set('subtitle', v)}
              context={[timelineTitle, draft.title].filter(Boolean).join(' — ')}
              maxLength={600}
              timelineId={timelineId}
            />
          </div>
        </div>

        {/* Facts */}
        <div className="rounded-xl border border-line bg-surface-raised/60 divide-y divide-line overflow-hidden shadow-2xs">
          <PropertyRow
            Icon={Calendar}
            label={t('eventEditor.when')}
            value={previewSpan}
            placeholder={t('eventEditor.addDate')}
            isMissing={dateMissing}
            isOpen={openProp === 'when'}
            onToggle={() => toggleProp('when')}
          >
            <DateEditor ed={ed} />
          </PropertyRow>
          <PropertyRow
            Icon={Tag}
            label={t('eventEditor.topic')}
            value={topicSummary ? (
              <span className="inline-flex items-center gap-2 min-w-0">
                {topicColor && <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10" style={{ backgroundColor: topicColor }} />}
                <span className="truncate">{topicSummary}</span>
              </span>
            ) : ''}
            placeholder={t('eventEditor.none')}
            isOpen={openProp === 'topic'}
            onToggle={() => toggleProp('topic')}
          >
            <ChoiceChips
              options={topicOptions}
              value={draft.category}
              onChange={(v) => set('category', v)}
              isNew={draft.category === '__new__'}
              newLabel={t('eventEditor.newTopic')}
              newValue={draft.newCategoryName}
              onNewValue={(v) => set('newCategoryName', v)}
              newPlaceholder={t('eventEditModal.newCategoryPlaceholder')}
              maxLength={40}
            />
            <p className="text-caption text-ink-subtle">{t('eventEditor.topicHint')}</p>
          </PropertyRow>
          <PropertyRow
            Icon={Layers}
            label={t('eventEditor.lane')}
            value={laneSummary}
            placeholder={t('eventEditor.none')}
            isOpen={openProp === 'lane'}
            onToggle={() => toggleProp('lane')}
          >
            <ChoiceChips
              options={laneOptions}
              value={draft.lane}
              onChange={(v) => set('lane', v)}
              isNew={draft.lane === '__new__'}
              newLabel={t('eventEditor.newLane')}
              newValue={draft.newLaneName}
              onNewValue={(v) => set('newLaneName', v)}
              newPlaceholder={t('eventEditModal.newLanePlaceholder')}
              maxLength={60}
            />
            <p className="text-caption text-ink-subtle">{t('eventEditor.laneHint')}</p>
          </PropertyRow>
          <PropertyRow
            Icon={MapPin}
            label={t('eventEditor.place')}
            value={placeSummary}
            placeholder={t('eventEditor.noPlace')}
            isOpen={openProp === 'place'}
            onToggle={() => toggleProp('place')}
          >
            <PlaceEditor ed={ed} />
          </PropertyRow>
        </div>

        {/* Description */}
        <div className="bg-surface-hover/40 border border-line rounded-xl p-4 space-y-2">
          <SectionHeader Icon={FileText} label={t('eventEditor.description')}>
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-caption text-ink-subtle truncate">{t('eventEditor.markdownHint')}</span>
              <AiPolishButton
                field="event_description"
                value={draft.extract}
                onChange={(v) => ed.patch({ extract: v, isExtractCustom: true })}
                context={[timelineTitle, draft.title].filter(Boolean).join(' — ')}
                timelineId={timelineId}
              />
            </span>
          </SectionHeader>
          <AutoTextarea
            minRows={4}
            value={draft.extract}
            dir={inputDir(draft.extract, isRtl)}
            aria-label={t('eventEditor.description')}
            placeholder={t('eventEditModal.fullDescPlaceholder')}
            onChange={(e) => ed.patch({ extract: e.target.value, isExtractCustom: true })}
            className={`${inPlaceCls} text-sm text-ink leading-relaxed`}
          />
        </div>

        <GalleryEditor ed={ed} />
        <SourceEditor ed={ed} />
      </div>

      {(ed.statusMessage || ed.errorMessage) && (
        <div
          role="status"
          className={`mx-4 mb-2 -mt-1 px-3 py-2 rounded-control border text-xs flex items-center gap-2 shadow-control animate-in fade-in slide-in-from-bottom-1 ${
            ed.errorMessage ? 'bg-danger-soft border-danger/30 text-danger' : 'bg-success-soft border-success/30 text-success'
          }`}
        >
          {ed.errorMessage ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
          <span className="flex-1 min-w-0">{ed.errorMessage || ed.statusMessage}</span>
          {ed.errorMessage && (
            <button type="button" onClick={() => ed.setErrorMessage(null)} aria-label={t('common.close')} className="hover:opacity-80 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div
        style={{ paddingBottom: isMobile ? 'max(14px, calc(env(safe-area-inset-bottom, 0px) + 14px))' : undefined }}
        className="px-5 py-3 border-t border-line flex items-center gap-2 bg-surface-overlay/95 backdrop-blur-md shrink-0"
      >
        <span className={`flex-1 min-w-0 truncate text-caption ${showErrors && !ed.canSave ? 'text-danger' : 'text-ink-subtle'}`}>
          {!ed.canSave
            ? t('eventEditor.requiredHint')
            : ed.isDirty
              ? t('eventEditor.unsavedChanges')
              : (isNew ? '' : t('eventEditor.noChanges'))}
        </span>
        <button
          type="button"
          onClick={requestCancel}
          className="px-4 py-2 rounded-xl text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover border border-line transition-colors cursor-pointer"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          title={`${isNew ? t('eventEditor.addEvent') : t('eventEditor.save')} (Ctrl+Enter)`}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-95 ${
            ed.canSave ? 'bg-accent hover:bg-accent-hover text-accent-fg' : 'bg-accent/50 text-accent-fg/90'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          {isNew ? t('eventEditor.addEvent') : t('eventEditor.save')}
        </button>
      </div>
    </>
  );
}
