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
  MapPin
} from 'lucide-react';
import { enrichItem, suggestEventData, searchWikiCandidates } from '../api';

export default function EventEditModal({
  isOpen,
  onClose,
  onSave,
  initialEvent = null,
  lanes = [],
  timelineTopic = '',
  timeScale = 'calendar'
}) {
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

  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen, initialEvent, timeScale]);

  if (!isOpen) return null;

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
        lanes
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
        setStatusMessage('Auto-filled with AI based on timeline context!');
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      console.warn('AI auto-fill error:', err);
      setErrorMessage(err.message || 'Failed to auto-fill event with AI');
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
        lanes
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
        }
        setStatusMessage('Dates updated using AI estimate.');
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      setErrorMessage('Could not estimate dates');
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
          setStatusMessage(`Linked to "${candidates[0].wikiTitle}"`);
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
          setStatusMessage('Wikipedia details found.');
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          setErrorMessage('No matching Wikipedia article found.');
        }
      }
    } catch (e) {
      console.warn('Enrichment failed:', e);
      setErrorMessage('Failed to search Wikipedia');
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
    let googleMapsUrl = initialEvent?.googleMapsUrl;
    if (parsedLat !== undefined && parsedLng !== undefined) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${parsedLat},${parsedLng}`;
    } else if (locationName.trim()) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName.trim())}`;
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
      rank: initialEvent?.rank || 8,
    };

    onSave(savedArticle);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {initialEvent ? 'Edit Event' : 'Add New Event'}
              </h3>
              {timelineTopic && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                  Context: <span className="font-medium text-slate-700 dark:text-slate-300">{timelineTopic}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Event / Person Title *
              </label>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Type a name & click Auto-Fill
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                required
                dir="auto"
                maxLength={150}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setShowCandidatePicker(false);
                }}
                placeholder="e.g. Lucy, Battle of Waterloo, Tyrannosaurus, Churchill..."
                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm"
              />

              <div className="flex items-center gap-1.5 shrink-0">
                {/* AI Magic Auto-Fill Button */}
                <button
                  type="button"
                  onClick={handleAiAutoFill}
                  disabled={isSuggesting || !title.trim()}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                  title="Auto-fill dates, subtitle, lane, and Wikipedia using AI"
                >
                  {isSuggesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-200" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                  )}
                  <span>Auto-Fill AI</span>
                </button>

                {/* Wikipedia Search & Disambiguation Button */}
                <button
                  type="button"
                  onClick={handleFetchWikiData}
                  disabled={isSearchingWiki || !title.trim()}
                  className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-2.5 py-2 rounded-xl text-xs font-medium border border-slate-300 dark:border-slate-700 transition-colors disabled:opacity-50"
                  title="Search Wikipedia & pick candidate"
                >
                  {isSearchingWiki ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5 text-sky-500" />
                  )}
                  <span className="hidden sm:inline">Wiki</span>
                </button>
              </div>
            </div>

            {/* Wikipedia Candidates Disambiguation Dropdown */}
            {showCandidatePicker && wikiCandidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-72 flex flex-col">
                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-sky-500" />
                    Select matching Wikipedia article ({wikiCandidates.length} found):
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCandidatePicker(false)}
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
                      className="p-2.5 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 cursor-pointer transition-colors flex items-start gap-3 group text-left"
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
                              Best Match
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
              Subtitle / One-line Description
            </label>
            <input
              type="text"
              dir="auto"
              maxLength={300}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="e.g. 3.2-million-year-old fossilized hominid skeleton"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm"
            />
          </div>

          {/* Lane selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-500" />
              <span>Swimlane / Category</span>
            </label>
            <select
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm"
            >
              <option value="">(None - Main timeline)</option>
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
                Start Date (From) *
              </span>
              <button
                type="button"
                onClick={handleSuggestDatesOnly}
                disabled={isSuggesting || !title.trim()}
                className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium px-2 py-0.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors disabled:opacity-40"
                title="Use AI to estimate or refine dates"
              >
                <Sparkles className="w-3 h-3" />
                <span>Suggest Dates</span>
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                  Year (Negative for BCE / Ma)
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
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Month (1-12)</label>
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
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Day (1-31)</label>
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
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Time Precision</label>
              <select
                value={fromPrecision}
                onChange={(e) => setFromPrecision(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
              >
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="decade">Decade</option>
                <option value="century">Century</option>
                <option value="millennium">Millennium</option>
                <option value="million-years">Million Years (Prehistoric)</option>
                <option value="billion-years">Billion Years</option>
              </select>
            </div>
          </div>

          {/* To Date */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                End Date (To - Optional)
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isToPresent}
                  onChange={(e) => setIsToPresent(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span>Ongoing to Present</span>
              </label>
            </div>

            {!isToPresent && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">End Year</label>
                  <input
                    type="number"
                    value={toYear}
                    onChange={(e) => setToYear(e.target.value)}
                    placeholder="e.g. 1980"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">End Month</label>
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
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">End Day</label>
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
                <span>Geographic Location (Optional)</span>
              </label>
              {lat !== '' && lng !== '' && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Test in Google Maps</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Location Name</label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Normandy, France or ירושלים"
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Latitude (lat)</label>
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="e.g. 49.33"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Longitude (lng)</label>
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="e.g. -0.45"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {/* Image URL with thumbnail preview */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Image URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://upload.wikimedia.org/..."
                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
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
              Full Description / Extract
            </label>
            <textarea
              rows={3}
              dir="auto"
              value={extract}
              onChange={(e) => setExtract(e.target.value)}
              placeholder="Detailed description of the event or person..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 resize-none text-xs leading-relaxed"
            />
          </div>

          {/* Wikipedia URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span>Wikipedia URL</span>
              {wikiUrl && (
                <a
                  href={wikiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline font-normal"
                >
                  <span>Open Page</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </label>
            <input
              type="url"
              value={wikiUrl}
              onChange={(e) => setWikiUrl(e.target.value)}
              placeholder="https://en.wikipedia.org/wiki/..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-sky-500 text-xs"
            />
          </div>

          {/* Footer buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold shadow-lg shadow-sky-500/25 transition-all text-xs flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Event</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
