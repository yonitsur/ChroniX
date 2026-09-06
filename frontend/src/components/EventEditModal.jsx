import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  Check,
  ExternalLink,
  Calendar,
  Layers,
  ChevronDown,
  AlertCircle,
  MapPin,
  Clock,
  ShieldCheck
} from 'lucide-react';
import { enrichItem, suggestEventData, searchWikiCandidates } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function EventEditModal({
  isOpen,
  onClose,
  onSave,
  initialEvent = null,
  lanes = [],
  timelineTopic = '',
  timeScale = 'calendar',
  timelineId = null,
  currentTimeline = null,
  quota = null
}) {
  const { t, isRtl } = useLanguage();
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [lane, setLane] = useState('');
  const [fromYear, setFromYear] = useState('');
  const [fromMonth, setFromMonth] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [fromPrecision, setFromPrecision] = useState('year');
  const [toYear, setToYear] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [toDay, setToDay] = useState('');
  const [isToPresent, setIsToPresent] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [extract, setExtract] = useState('');
  const [wikiUrl, setWikiUrl] = useState('');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  // Async states
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSearchingWiki, setIsSearchingWiki] = useState(false);
  const [wikiCandidates, setWikiCandidates] = useState([]);
  const [showCandidatePicker, setShowCandidatePicker] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [localEventAddCount, setLocalEventAddCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setLocalEventAddCount(currentTimeline?.aiEventAddCount || 0);
      setTitle(initialEvent?.title || '');
      setSubtitle(initialEvent?.subtitle || '');
      setLane(initialEvent?.lane || '');
      setFromYear(initialEvent?.from?.year ?? '');
      setFromMonth(initialEvent?.from?.month ?? '');
      setFromDay(initialEvent?.from?.day ?? '');
      setFromPrecision(initialEvent?.from?.precision || (timeScale === 'prehistoric' ? 'million-years' : 'year'));
      setToYear(initialEvent?.to?.year ?? '');
      setToMonth(initialEvent?.to?.month ?? '');
      setToDay(initialEvent?.to?.day ?? '');
      setIsToPresent(initialEvent?.isToPresent || false);
      setImageUrl(initialEvent?.imageUrl || '');
      setExtract(initialEvent?.extract || '');
      setWikiUrl(initialEvent?.wikiUrl || '');
      setLocationName(initialEvent?.locationName || '');
      setLat(initialEvent?.lat !== undefined && initialEvent?.lat !== null ? String(initialEvent.lat) : '');
      setLng(initialEvent?.lng !== undefined && initialEvent?.lng !== null ? String(initialEvent.lng) : '');
      setShowCandidatePicker(false);
      setWikiCandidates([]);
      setStatusMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, initialEvent, timeScale, currentTimeline]);

  if (!isOpen) return null;

  const isAdmin = quota?.is_admin === true;
  const eventAddLimit = quota?.timeline_paid_event_add_limit && quota.timeline_paid_event_add_limit > 0
    ? quota.timeline_paid_event_add_limit
    : 10;
  const eventAddUsed = localEventAddCount;
  const eventAddRemaining = Math.max(0, eventAddLimit - eventAddUsed);
  const isEventAddFreeTier = !isAdmin && (eventAddRemaining === 0 || (quota && quota.remaining_paid === 0));

  // 1. Full AI Auto-Fill (Title, dates, lane, Wikipedia info)
  const handleAiAutoFill = async () => {
    if (!title.trim()) return;
    setIsSuggesting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setShowCandidatePicker(false);

    try {
      const data = await suggestEventData({
        query: title.trim(),
        timelineTopic,
        timeScale,
        lanes,
        timelineId
      });

      if (data) {
        if (data.title) setTitle(data.title);
        if (data.subtitle) setSubtitle(data.subtitle);
        if (data.lane) setLane(data.lane);

        if (data.from) {
          if (data.from.year !== undefined && data.from.year !== null) {
            setFromYear(data.from.year);
          }
          if (data.from.month !== undefined && data.from.month !== null) {
            setFromMonth(data.from.month);
          }
          if (data.from.day !== undefined && data.from.day !== null) {
            setFromDay(data.from.day);
          }
          if (data.from.precision) {
            setFromPrecision(data.from.precision);
          }
        }

        if (data.to) {
          if (data.to.year !== undefined && data.to.year !== null) {
            setToYear(data.to.year);
          }
          if (data.to.month !== undefined && data.to.month !== null) {
            setToMonth(data.to.month);
          }
          if (data.to.day !== undefined && data.to.day !== null) {
            setToDay(data.to.day);
          }
        } else {
          setToYear('');
          setToMonth('');
          setToDay('');
        }

        setIsToPresent(!!data.isToPresent);
        if (data.imageUrl) setImageUrl(data.imageUrl);
        if (data.extract) setExtract(data.extract);
        if (data.wikiUrl) setWikiUrl(data.wikiUrl);
        if (data.imageUrl) setImageUrl(data.imageUrl);
        if (data.locationName) setLocationName(data.locationName);
        if (data.lat !== undefined && data.lat !== null) setLat(String(data.lat));
        if (data.lng !== undefined && data.lng !== null) setLng(String(data.lng));

        if (typeof data.ai_event_add_count === 'number') {
          setLocalEventAddCount(data.ai_event_add_count);
          if (currentTimeline) currentTimeline.aiEventAddCount = data.ai_event_add_count;
        } else {
          setLocalEventAddCount((prev) => prev + 1);
          if (currentTimeline) currentTimeline.aiEventAddCount = (currentTimeline.aiEventAddCount || 0) + 1;
        }

        setStatusMessage(t('eventEditModal.autoFilledSuccess'));
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      console.warn('AI auto-fill error:', err);
      setErrorMessage(err.message || t('eventEditModal.autoFilledError'));
    } finally {
      setIsSuggesting(false);
    }
  };

  // 2. Suggest Dates Only
  const handleSuggestDatesOnly = async () => {
    if (!title.trim()) return;
    setIsSuggesting(true);
    setErrorMessage(null);
    try {
      const data = await suggestEventData({
        query: title.trim(),
        timelineTopic,
        timeScale,
        lanes,
        timelineId
      });
      if (data && data.from) {
        if (data.from.year !== undefined && data.from.year !== null) setFromYear(data.from.year);
        if (data.from.month !== undefined && data.from.month !== null) setFromMonth(data.from.month);
        if (data.from.day !== undefined && data.from.day !== null) setFromDay(data.from.day);
        if (data.from.precision) setFromPrecision(data.from.precision);
        if (data.to) {
          if (data.to.year !== undefined && data.to.year !== null) setToYear(data.to.year);
          if (data.to.month !== undefined && data.to.month !== null) setToMonth(data.to.month);
          if (data.to.day !== undefined && data.to.day !== null) setToDay(data.to.day);
        } else {
          setToYear('');
          setToMonth('');
          setToDay('');
        }
        setIsToPresent(Boolean(data.isToPresent));

        if (typeof data.ai_event_add_count === 'number') {
          setLocalEventAddCount(data.ai_event_add_count);
          if (currentTimeline) currentTimeline.aiEventAddCount = data.ai_event_add_count;
        } else {
          setLocalEventAddCount((prev) => prev + 1);
          if (currentTimeline) currentTimeline.aiEventAddCount = (currentTimeline.aiEventAddCount || 0) + 1;
        }

        setStatusMessage(t('eventEditModal.datesUpdatedSuccess'));
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      setErrorMessage(t('eventEditModal.datesUpdatedError'));
    } finally {
      setIsSuggesting(false);
    }
  };

  // 3. Search Wikipedia candidates & handle disambiguation
  const handleFetchWikiData = async () => {
    if (!title.trim()) return;
    setIsSearchingWiki(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const candidates = await searchWikiCandidates(title.trim(), timelineTopic);
      if (candidates && candidates.length > 0) {
        if (candidates.length === 1) {
          // Single match -> apply directly
          applyCandidate(candidates[0]);
          setStatusMessage(t('eventEditModal.linkedCandidateSuccess', { title: candidates[0].wikiTitle }));
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          // Multiple candidates -> show interactive selection dropdown
          setWikiCandidates(candidates);
          setShowCandidatePicker(true);
        }
      } else {
        // Direct enrichment fallback
        const fallback = await enrichItem(title.trim(), timelineTopic);
        if (fallback) {
          if (fallback.imageUrl) setImageUrl(fallback.imageUrl);
          if (fallback.extract) setExtract(fallback.extract);
          if (fallback.description && !subtitle) setSubtitle(fallback.description);
          if (fallback.wikiUrl) setWikiUrl(fallback.wikiUrl);
          setStatusMessage(t('eventEditModal.wikiDetailsFound'));
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          setErrorMessage(t('eventEditModal.noWikiFound'));
        }
      }
    } catch (e) {
      console.warn('Enrichment failed:', e);
      setErrorMessage(t('eventEditModal.wikiSearchFailed'));
    } finally {
      setIsSearchingWiki(false);
    }
  };

  const applyCandidate = (cand) => {
    if (!cand) return;
    if (cand.wikiTitle && !title.trim()) setTitle(cand.wikiTitle);
    if (cand.imageUrl) setImageUrl(cand.imageUrl);
    if (cand.extract) setExtract(cand.extract);
    if (cand.description && !subtitle) setSubtitle(cand.description);
    if (cand.wikiUrl) setWikiUrl(cand.wikiUrl);
    setShowCandidatePicker(false);

    // If dates are empty, automatically suggest dates
    if (fromYear === '') {
      handleSuggestDatesOnly();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim() || fromYear === '') return;

    const fromDate = {
      year: parseInt(fromYear, 10),
      month: fromMonth ? parseInt(fromMonth, 10) : undefined,
      day: fromDay ? parseInt(fromDay, 10) : undefined,
      precision: fromPrecision,
    };

    let toDate = undefined;
    if (toYear !== '') {
      toDate = {
        year: parseInt(toYear, 10),
        month: toMonth ? parseInt(toMonth, 10) : undefined,
        day: toDay ? parseInt(toDay, 10) : undefined,
        precision: fromPrecision,
      };
    }

    const parsedLat = lat !== '' && !isNaN(Number(lat)) ? Number(lat) : undefined;
    const parsedLng = lng !== '' && !isNaN(Number(lng)) ? Number(lng) : undefined;
    const isFictional = initialEvent?.isFictional;
    let googleMapsUrl = initialEvent?.googleMapsUrl;
    if (parsedLat !== undefined && parsedLng !== undefined) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${parsedLat},${parsedLng}`;
    } else if (locationName.trim() && !isFictional) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName.trim())}`;
    } else if (isFictional && (parsedLat === undefined || parsedLng === undefined)) {
      googleMapsUrl = undefined;
    }

    const savedArticle = {
      id: initialEvent?.id || `user-event-${Date.now()}`,
      title: title.trim(),
      subtitle: subtitle.trim(),
      lane: lane || undefined,
      from: fromDate,
      to: toDate,
      isToPresent,
      imageUrl: imageUrl.trim() || undefined,
      extract: extract.trim(),
      wikiUrl: wikiUrl.trim(),
      locationName: locationName.trim() || undefined,
      lat: parsedLat,
      lng: parsedLng,
      googleMapsUrl: googleMapsUrl || undefined,
      isFictional: isFictional,
      rank: initialEvent?.rank || 8,
    };

    onSave(savedArticle);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`bg-white/75 dark:bg-slate-900/75 backdrop-blur-2xl backdrop-saturate-150 border border-white/60 dark:border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-slate-950/30 dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/5 flex flex-col max-h-[90vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 dark:border-white/10 bg-gradient-to-b from-white/60 via-white/30 to-transparent dark:from-white/[0.07] dark:to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500 flex items-center justify-center text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {initialEvent ? t('eventEditModal.editTitle') : t('eventEditModal.addTitle')}
              </h3>
              {timelineTopic && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                  {t('eventEditModal.contextLabel')}{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">{timelineTopic}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback / status banner */}
        {statusMessage && (
          <div className="px-6 py-2 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800/60 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 animate-in fade-in slide-in-from-top-1">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="px-6 py-2 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800/60 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in slide-in-from-top-1">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              aria-label={t('common.close')}
              className="text-rose-400 hover:text-rose-700 dark:hover:text-rose-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          {/* Title with AI Auto-fill & Wikipedia Search */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t('eventEditModal.titleLabel')}
              </label>

              <div className="flex items-center gap-2">
                {/* Timeline AI Event Add Quota Indicator */}
                {timelineId && (
                  isAdmin ? (
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-md border border-purple-200/60 dark:border-purple-800/50 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 shrink-0" />
                      <span>{t('eventEditModal.adminUnlimited')}</span>
                    </span>
                  ) : isEventAddFreeTier ? (
                    <span
                      className="text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-800/50 flex items-center gap-1"
                      title={t('eventEditModal.freeTierNotice', { limit: eventAddLimit })}
                    >
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{t('eventEditModal.freeTierNotice', { limit: eventAddLimit })}</span>
                    </span>
                  ) : (
                    <span
                      className="text-[10px] text-sky-600 dark:text-sky-400 font-medium bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md border border-sky-200/60 dark:border-sky-800/50 flex items-center gap-1"
                      title={t('eventEditModal.remainingTooltip', { remaining: eventAddRemaining, limit: eventAddLimit })}
                    >
                      <Sparkles className="w-3 h-3 text-sky-500 shrink-0" />
                      <span>{t('eventEditModal.remainingPremium', { remaining: eventAddRemaining, limit: eventAddLimit })}</span>
                    </span>
                  )
                )}
                <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
                  {t('eventEditModal.titleHint')}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                required
                dir={title ? (/[\u0590-\u05FF]/.test(title) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
                maxLength={150}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setShowCandidatePicker(false);
                }}
                placeholder={t('eventEditModal.titlePlaceholder')}
                className={`flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm ${
                  (title ? /[\u0590-\u05FF]/.test(title) : isRtl) ? 'text-right' : 'text-left'
                }`}
              />

              <div className="flex items-center gap-1.5 shrink-0">
                {/* AI Magic Auto-Fill Button */}
                <button
                  type="button"
                  onClick={handleAiAutoFill}
                  disabled={isSuggesting || !title.trim()}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-2 rounded-xl text-xs font-medium shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  title={t('eventEditModal.autoFillTooltip')}
                >
                  {isSuggesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-sky-200" />
                  )}
                  <span>{t('eventEditModal.autoFillAi')}</span>
                </button>

                {/* Wikipedia Search & Disambiguation Button */}
                <button
                  type="button"
                  onClick={handleFetchWikiData}
                  disabled={isSearchingWiki || !title.trim()}
                  className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-2.5 py-2 rounded-xl text-xs font-medium border border-slate-300 dark:border-slate-700 transition-colors disabled:opacity-50"
                  title={t('eventEditModal.wikiTooltip')}
                >
                  {isSearchingWiki ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5 text-sky-500" />
                  )}
                  <span className="hidden sm:inline">{t('eventEditModal.wikiBtn')}</span>
                </button>
              </div>
            </div>

            {/* Wikipedia Candidates Disambiguation Dropdown */}
            {showCandidatePicker && wikiCandidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-72 flex flex-col">
                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-sky-500" />
                    {t('eventEditModal.wikiCandidatesHeader', { count: wikiCandidates.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCandidatePicker(false)}
                    aria-label={t('common.close')}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-750">
                  {wikiCandidates.map((cand, idx) => (
                    <div
                      key={cand.wikiTitle || idx}
                      onClick={() => applyCandidate(cand)}
                      className="p-2.5 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 cursor-pointer transition-colors flex items-start gap-3 group ltr:text-left rtl:text-right"
                    >
                      {cand.imageUrl ? (
                        <img
                          src={cand.imageUrl}
                          alt={cand.wikiTitle}
                          className="w-11 h-11 rounded-lg object-cover bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 shrink-0 group-hover:ring-2 ring-sky-500/40"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-400">
                          <ImageIcon className="w-5 h-5 opacity-60" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-semibold text-xs text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate">
                            {cand.wikiTitle}
                          </h4>
                          {idx === 0 && (
                            <span className="text-[10px] bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-medium px-1.5 py-0.5 rounded">
                              {t('eventEditModal.bestMatchBadge')}
                            </span>
                          )}
                        </div>
                        {cand.description && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                            {cand.description}
                          </p>
                        )}
                        {cand.extract && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 line-clamp-2 mt-0.5 leading-snug">
                            {cand.extract}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Subtitle */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t('eventEditModal.subtitleLabel')}
            </label>
            <input
              type="text"
              dir={subtitle ? (/[\u0590-\u05FF]/.test(subtitle) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              maxLength={300}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={t('eventEditModal.subtitlePlaceholder')}
              className={`w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm ${
                (subtitle ? /[\u0590-\u05FF]/.test(subtitle) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Lane selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-500" />
              <span>{t('eventEditModal.laneLabel')}</span>
            </label>
            <select
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm"
            >
              <option value="">{t('eventEditModal.laneNone')}</option>
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>

          {/* From Date with Suggest Dates Button */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400">
                <Calendar className="w-3.5 h-3.5" />
                {t('eventEditModal.startDateLabel')}
              </span>
              <button
                type="button"
                onClick={handleSuggestDatesOnly}
                disabled={isSuggesting || !title.trim()}
                className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 font-medium px-2 py-0.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/50 transition-colors disabled:opacity-40 cursor-pointer"
                title={t('eventEditModal.suggestDatesTooltip')}
              >
                <Sparkles className="w-3 h-3" />
                <span>{t('eventEditModal.suggestDatesBtn')}</span>
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                  {t('eventEditModal.yearLabel')}
                </label>
                <input
                  type="number"
                  required
                  value={fromYear}
                  onChange={(e) => setFromYear(e.target.value)}
                  placeholder="e.g. 1974, -753, -3200000"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.monthLabel')}</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={fromMonth}
                  onChange={(e) => setFromMonth(e.target.value)}
                  placeholder="MM"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.dayLabel')}</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={fromDay}
                  onChange={(e) => setFromDay(e.target.value)}
                  placeholder="DD"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.precisionLabel')}</label>
              <select
                value={fromPrecision}
                onChange={(e) => setFromPrecision(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
              >
                <option value="day">{t('eventEditModal.precisionDay')}</option>
                <option value="month">{t('eventEditModal.precisionMonth')}</option>
                <option value="year">{t('eventEditModal.precisionYear')}</option>
                <option value="decade">{t('eventEditModal.precisionDecade')}</option>
                <option value="century">{t('eventEditModal.precisionCentury')}</option>
                <option value="millennium">{t('eventEditModal.precisionMillennium')}</option>
                <option value="million-years">{t('eventEditModal.precisionMillionYears')}</option>
                <option value="billion-years">{t('eventEditModal.precisionBillionYears')}</option>
              </select>
            </div>
          </div>

          {/* To Date */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t('eventEditModal.endDateLabel')}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isToPresent}
                  onChange={(e) => setIsToPresent(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span>{t('eventEditModal.ongoingToPresent')}</span>
              </label>
            </div>

            {!isToPresent && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.endYearLabel')}</label>
                  <input
                    type="number"
                    value={toYear}
                    onChange={(e) => setToYear(e.target.value)}
                    placeholder="e.g. 1980"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.endMonthLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={toMonth}
                    onChange={(e) => setToMonth(e.target.value)}
                    placeholder="MM"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.endDayLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={toDay}
                    onChange={(e) => setToDay(e.target.value)}
                    placeholder="DD"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Geographic Location */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-rose-500" />
                <span>{t('eventEditModal.geoLabel')}</span>
              </label>
              {lat !== '' && lng !== '' && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>{t('eventEditModal.testGoogleMaps')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.locationNameLabel')}</label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder={t('eventEditModal.locationNamePlaceholder')}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.latitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="e.g. 49.33"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono text-left"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">{t('eventEditModal.longitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="e.g. -0.45"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono text-left"
                />
              </div>
            </div>
          </div>

          {/* Image URL with thumbnail preview */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t('eventEditModal.imageUrlLabel')}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                dir="ltr"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://upload.wikimedia.org/..."
                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs text-left"
              />
              {imageUrl && (
                <div className="w-9 h-9 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800">
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Extract / Summary */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t('eventEditModal.fullDescLabel')}
            </label>
            <textarea
              rows={3}
              dir={extract ? (/[\u0590-\u05FF]/.test(extract) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              value={extract}
              onChange={(e) => setExtract(e.target.value)}
              placeholder={t('eventEditModal.fullDescPlaceholder')}
              className={`w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 resize-none text-xs leading-relaxed ${
                (extract ? /[\u0590-\u05FF]/.test(extract) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Wikipedia URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span>{t('eventEditModal.wikiUrlLabel')}</span>
              {wikiUrl && (
                <a
                  href={wikiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline font-normal"
                >
                  <span>{t('eventEditModal.openPage')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </label>
            <input
              type="url"
              dir="ltr"
              value={wikiUrl}
              onChange={(e) => setWikiUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/wiki/..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs text-left"
            />
          </div>

          {/* Footer buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors text-xs"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold shadow-lg shadow-sky-500/25 transition-all text-xs flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('eventEditModal.saveEvent')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
