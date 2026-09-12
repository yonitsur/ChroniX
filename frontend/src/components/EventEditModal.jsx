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
  ShieldCheck,
  Leaf,
  Upload
} from 'lucide-react';
import { enrichItem, suggestEventData, searchWikiCandidates, searchGeocodeCandidates } from '../api';
import { useLanguage } from '../context/LanguageContext';

// Uploaded photos are downscaled client-side and stored inline as a data URL in `imageUrl`,
// so they render everywhere images already do without any backend/storage changes.
const MAX_IMAGE_DIM = 900;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // reject source files larger than 12MB

function fileToCompressedDataUrl(file, maxDim = MAX_IMAGE_DIM, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Keep PNG transparency; otherwise compress to JPEG to shrink the payload.
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        try {
          resolve(canvas.toDataURL(mime, quality));
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
  const [newLaneName, setNewLaneName] = useState('');
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
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [wikiCandidates, setWikiCandidates] = useState([]);
  const [showCandidatePicker, setShowCandidatePicker] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationCandidates, setLocationCandidates] = useState([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [localEventAddCount, setLocalEventAddCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setLocalEventAddCount(currentTimeline?.aiEventAddCount || 0);
      setTitle(initialEvent?.title || '');
      setSubtitle(initialEvent?.subtitle || '');
      setLane(initialEvent?.lane || '');
      setNewLaneName('');
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
      setShowLocationPicker(false);
      setLocationCandidates([]);
      setStatusMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, initialEvent, timeScale, currentTimeline]);

  if (!isOpen) return null;

  const isAdmin = quota?.is_admin === true;
  const isFreeMode = quota?.mode === 'free' && !isAdmin;
  const isEventAddUnlimited = !isAdmin && !isFreeMode && quota?.timeline_paid_event_add_limit === -1;
  const eventAddLimit = quota?.timeline_paid_event_add_limit && quota.timeline_paid_event_add_limit > 0
    ? quota.timeline_paid_event_add_limit
    : 10;
  const eventAddUsed = localEventAddCount;
  const eventAddRemaining = Math.max(0, eventAddLimit - eventAddUsed);
  const isEventAddFreeTier = !isAdmin && !isEventAddUnlimited && (eventAddRemaining === 0 || (quota && quota.remaining_paid === 0));

  // Upload a local image: downscale/compress it and store it inline as a data URL.
  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage(t('eventEditModal.imageInvalidType'));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage(t('eventEditModal.imageTooLarge'));
      return;
    }
    setIsProcessingImage(true);
    setErrorMessage(null);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setImageUrl(dataUrl);
    } catch (err) {
      setErrorMessage(t('eventEditModal.imageUploadFailed'));
    } finally {
      setIsProcessingImage(false);
    }
  };

  // 1. Full AI Auto-Fill (Title, dates, lane, Wikipedia info)
  const handleAiAutoFill = async () => {    if (!title.trim()) return;
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

  // 3b. Search place-name candidates & let the user pick one to set lat/lng
  const handleSearchLocation = async () => {
    if (!locationName.trim()) return;
    setIsSearchingLocation(true);
    setErrorMessage(null);
    setShowLocationPicker(false);
    try {
      const candidates = await searchGeocodeCandidates(locationName.trim());
      if (candidates && candidates.length > 0) {
        setLocationCandidates(candidates);
        setShowLocationPicker(true);
      } else {
        setErrorMessage(t('eventEditModal.noLocationFound'));
      }
    } catch (e) {
      console.warn('Geocode search failed:', e);
      setErrorMessage(t('eventEditModal.locationSearchFailed'));
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const applyLocationCandidate = (cand) => {
    if (!cand) return;
    setLocationName(cand.name || cand.displayName || locationName);
    setLat(String(cand.lat));
    setLng(String(cand.lng));
    setShowLocationPicker(false);
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

    // Creating a brand-new topic/lane: generate an id and attach it so the parent adds it.
    if (lane === '__new__' && newLaneName.trim()) {
      const laneTitle = newLaneName.trim();
      const laneId =
        laneTitle.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) ||
        `lane-${Date.now().toString(36)}`;
      savedArticle.lane = laneId;
      savedArticle.newLane = { id: laneId, title: laneTitle };
    } else if (lane === '__new__') {
      // "New topic" chosen but left blank — treat as no lane.
      savedArticle.lane = undefined;
    }

    onSave(savedArticle);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-lg overflow-hidden shadow-panel flex flex-col max-h-[90vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-control bg-accent flex items-center justify-center text-accent-fg shadow-control">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">
                {initialEvent ? t('eventEditModal.editTitle') : t('eventEditModal.addTitle')}
              </h3>
              {timelineTopic && (
                <p className="text-[11px] text-ink-muted truncate max-w-xs">
                  {t('eventEditModal.contextLabel')}{' '}
                  <span className="font-medium text-ink">{timelineTopic}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback / status banner */}
        {statusMessage && (
          <div className="px-6 py-2 bg-success-soft border-b border-success/30 flex items-center gap-2 text-xs text-success animate-in fade-in slide-in-from-top-1">
            <Check className="w-4 h-4 text-success shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="px-6 py-2 bg-danger-soft border-b border-danger/30 flex items-center gap-2 text-xs text-danger animate-in fade-in slide-in-from-top-1">
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
            <span className="flex-1">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              aria-label={t('common.close')}
              className="text-danger hover:opacity-80 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-sm text-ink">
          {/* Title with AI Auto-fill & Wikipedia Search */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <label className="block text-xs font-semibold text-ink">
                {t('eventEditModal.titleLabel')}
              </label>

              <div className="flex items-center gap-2">
                {/* Timeline AI Event Add Quota Indicator */}
                {timelineId && (
                  isAdmin ? (
                    <span className="text-[10px] text-warning font-medium bg-warning-soft px-2 py-0.5 rounded-control border border-warning/40 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 shrink-0" />
                      <span>{t('eventEditModal.adminUnlimited')}</span>
                    </span>
                  ) : isEventAddUnlimited ? (
                    <span className="text-[10px] text-accent font-medium bg-accent-soft px-2 py-0.5 rounded-control border border-accent/40 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-accent shrink-0" />
                      <span>{t('eventEditModal.unlimitedNotice')}</span>
                    </span>
                  ) : isFreeMode ? (
                    <span
                      className="text-[10px] text-success font-medium bg-success-soft px-2 py-0.5 rounded-control border border-success/40 flex items-center gap-1"
                      title={t('quota.freeModeNotice')}
                    >
                      <Leaf className="w-3 h-3 shrink-0" />
                      <span>{t('quota.badgeFreeMode')}</span>
                    </span>
                  ) : isEventAddFreeTier ? (
                    <span
                      className="text-[10px] text-warning font-medium bg-warning-soft px-2 py-0.5 rounded-control border border-warning/40 flex items-center gap-1"
                      title={t('eventEditModal.freeTierNotice', { limit: eventAddLimit })}
                    >
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{t('eventEditModal.freeTierNotice', { limit: eventAddLimit })}</span>
                    </span>
                  ) : (
                    <span
                      className="text-[10px] text-accent font-medium bg-accent-soft px-2 py-0.5 rounded-control border border-accent/40 flex items-center gap-1"
                      title={t('eventEditModal.remainingTooltip', { remaining: eventAddRemaining, limit: eventAddLimit })}
                    >
                      <Sparkles className="w-3 h-3 text-accent shrink-0" />
                      <span>{t('eventEditModal.remainingPremium', { remaining: eventAddRemaining, limit: eventAddLimit })}</span>
                    </span>
                  )
                )}
                <span className="text-[11px] text-ink-subtle hidden sm:inline">
                  {t('eventEditModal.titleHint')}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                required
                dir={title ? (/[\u0590-\u05FF\u0600-\u06FF]/.test(title) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
                maxLength={150}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setShowCandidatePicker(false);
                }}
                placeholder={t('eventEditModal.titlePlaceholder')}
                className={`flex-1 bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 text-sm shadow-control ${
                  (title ? /[\u0590-\u05FF\u0600-\u06FF]/.test(title) : isRtl) ? 'text-right' : 'text-left'
                }`}
              />

              <div className="flex items-center gap-1.5 shrink-0">
                {/* AI Magic Auto-Fill Button */}
                <button
                  type="button"
                  onClick={handleAiAutoFill}
                  disabled={isSuggesting || !title.trim()}
                  className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-accent-fg px-3 py-2 rounded-control text-xs font-medium shadow-control transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={t('eventEditModal.autoFillTooltip')}
                >
                  {isSuggesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-fg" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-accent-fg" />
                  )}
                  <span>{t('eventEditModal.autoFillAi')}</span>
                </button>

                {/* Wikipedia Search & Disambiguation Button */}
                <button
                  type="button"
                  onClick={handleFetchWikiData}
                  disabled={isSearchingWiki || !title.trim()}
                  className="flex items-center gap-1 bg-surface-raised hover:bg-surface-hover text-ink px-2.5 py-2 rounded-control text-xs font-medium border border-line transition-colors disabled:opacity-40 cursor-pointer shadow-control"
                  title={t('eventEditModal.wikiTooltip')}
                >
                  {isSearchingWiki ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5 text-accent" />
                  )}
                  <span className="hidden sm:inline">{t('eventEditModal.wikiBtn')}</span>
                </button>
              </div>
            </div>

            {/* Wikipedia Candidates Disambiguation Dropdown */}
            {showCandidatePicker && wikiCandidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-surface-overlay border border-line rounded-panel shadow-panel overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-72 flex flex-col">
                <div className="px-3 py-2 bg-surface-raised border-b border-line flex items-center justify-between text-xs font-semibold text-ink">
                  <span className="flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-accent" />
                    {t('eventEditModal.wikiCandidatesHeader', { count: wikiCandidates.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCandidatePicker(false)}
                    aria-label={t('common.close')}
                    className="text-ink-subtle hover:text-ink p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="overflow-y-auto divide-y divide-line">
                  {wikiCandidates.map((cand, idx) => (
                    <div
                      key={cand.wikiTitle || idx}
                      onClick={() => applyCandidate(cand)}
                      className="p-2.5 hover:bg-surface-hover cursor-pointer transition-colors flex items-start gap-3 group ltr:text-left rtl:text-right"
                    >
                      {cand.imageUrl ? (
                        <img
                          src={cand.imageUrl}
                          alt={cand.wikiTitle}
                          className="w-11 h-11 rounded-control object-cover bg-surface-sunken border border-line shrink-0 group-hover:border-accent"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-control bg-surface-sunken border border-line flex items-center justify-center shrink-0 text-ink-subtle">
                          <ImageIcon className="w-5 h-5 opacity-60" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-semibold text-xs text-ink group-hover:text-accent truncate">
                            {cand.wikiTitle}
                          </h4>
                          {idx === 0 && (
                            <span className="text-[10px] bg-accent-soft text-accent font-medium px-1.5 py-0.5 rounded-control">
                              {t('eventEditModal.bestMatchBadge')}
                            </span>
                          )}
                        </div>
                        {cand.description && (
                          <p className="text-[11px] text-ink-muted line-clamp-1 mt-0.5">
                            {cand.description}
                          </p>
                        )}
                        {cand.extract && (
                          <p className="text-[11px] text-ink-subtle line-clamp-2 mt-0.5 leading-snug">
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
            <label className="block text-xs font-semibold text-ink mb-1">
              {t('eventEditModal.subtitleLabel')}
            </label>
            <input
              type="text"
              dir={subtitle ? (/[\u0590-\u05FF\u0600-\u06FF]/.test(subtitle) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              maxLength={300}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={t('eventEditModal.subtitlePlaceholder')}
              className={`w-full bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 text-sm shadow-control ${
                (subtitle ? /[\u0590-\u05FF\u0600-\u06FF]/.test(subtitle) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Lane selector */}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-accent" />
              <span>{t('eventEditModal.laneLabel')}</span>
            </label>
            <select
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              className="w-full bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 text-sm shadow-control cursor-pointer"
            >
              <option value="">{t('eventEditModal.laneNone')}</option>
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
              <option value="__new__">{t('eventEditModal.laneNew')}</option>
            </select>
            {lane === '__new__' && (
              <input
                type="text"
                value={newLaneName}
                onChange={(e) => setNewLaneName(e.target.value)}
                maxLength={60}
                autoFocus
                placeholder={t('eventEditModal.newLanePlaceholder')}
                className="mt-2 w-full bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent-ring/30 text-sm shadow-control"
              />
            )}
          </div>

          {/* From Date with Suggest Dates Button */}
          <div className="bg-surface-sunken p-3.5 rounded-panel border border-line space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                <Calendar className="w-3.5 h-3.5" />
                {t('eventEditModal.startDateLabel')}
              </span>
              <button
                type="button"
                onClick={handleSuggestDatesOnly}
                disabled={isSuggesting || !title.trim()}
                className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover font-medium px-2 py-0.5 rounded-control hover:bg-accent-soft transition-colors disabled:opacity-40 cursor-pointer"
                title={t('eventEditModal.suggestDatesTooltip')}
              >
                <Sparkles className="w-3 h-3" />
                <span>{t('eventEditModal.suggestDatesBtn')}</span>
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-ink-muted mb-0.5">
                  {t('eventEditModal.yearLabel')}
                </label>
                <input
                  type="number"
                  required
                  value={fromYear}
                  onChange={(e) => setFromYear(e.target.value)}
                  placeholder="e.g. 1974, -753, -3200000"
                  className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs font-mono shadow-control"
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.monthLabel')}</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={fromMonth}
                  onChange={(e) => setFromMonth(e.target.value)}
                  placeholder="MM"
                  className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control"
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.dayLabel')}</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={fromDay}
                  onChange={(e) => setFromDay(e.target.value)}
                  placeholder="DD"
                  className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.precisionLabel')}</label>
              <select
                value={fromPrecision}
                onChange={(e) => setFromPrecision(e.target.value)}
                className="w-full bg-surface-raised border border-line rounded-control px-2 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control cursor-pointer"
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
          <div className="bg-surface-sunken p-3.5 rounded-panel border border-line space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-semibold text-ink">
                {t('eventEditModal.endDateLabel')}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={isToPresent}
                  onChange={(e) => setIsToPresent(e.target.checked)}
                  className="rounded-control border-line text-accent focus:ring-accent"
                />
                <span>{t('eventEditModal.ongoingToPresent')}</span>
              </label>
            </div>

            {!isToPresent && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.endYearLabel')}</label>
                  <input
                    type="number"
                    value={toYear}
                    onChange={(e) => setToYear(e.target.value)}
                    placeholder="e.g. 1980"
                    className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs font-mono shadow-control"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.endMonthLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={toMonth}
                    onChange={(e) => setToMonth(e.target.value)}
                    placeholder="MM"
                    className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.endDayLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={toDay}
                    onChange={(e) => setToDay(e.target.value)}
                    placeholder="DD"
                    className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Geographic Location */}
          <div className="bg-surface-sunken p-3.5 rounded-panel border border-line space-y-2.5 relative">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <MapPin className="w-3.5 h-3.5 text-danger" />
                <span>{t('eventEditModal.geoLabel')}</span>
              </label>
              {lat !== '' && lng !== '' && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-accent hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>{t('eventEditModal.testGoogleMaps')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.locationNameLabel')}</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={locationName}
                  onChange={(e) => {
                    setLocationName(e.target.value);
                    setShowLocationPicker(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchLocation();
                    }
                  }}
                  placeholder={t('eventEditModal.locationNamePlaceholder')}
                  className="flex-1 bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs shadow-control"
                />
                <button
                  type="button"
                  onClick={handleSearchLocation}
                  disabled={isSearchingLocation || !locationName.trim()}
                  title={t('eventEditModal.locationSearchTooltip')}
                  className="flex items-center gap-1 bg-surface-raised hover:bg-surface-hover text-ink px-2 py-1.5 rounded-control text-xs font-medium border border-line transition-colors disabled:opacity-40 shrink-0 cursor-pointer shadow-control"
                >
                  {isSearchingLocation ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5 text-accent" />
                  )}
                </button>
              </div>

              {/* Location Candidates Dropdown (from OpenStreetMap/Nominatim) */}
              {showLocationPicker && locationCandidates.length > 0 && (
                <div className="absolute left-3.5 right-3.5 top-full mt-1.5 z-30 bg-surface-overlay border border-line rounded-panel shadow-panel overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-56 flex flex-col">
                  <div className="px-3 py-2 bg-surface-raised border-b border-line flex items-center justify-between text-xs font-semibold text-ink">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-danger" />
                      {t('eventEditModal.locationCandidatesHeader', { count: locationCandidates.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowLocationPicker(false)}
                      aria-label={t('common.close')}
                      className="text-ink-subtle hover:text-ink p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="overflow-y-auto divide-y divide-line">
                    {locationCandidates.map((cand, idx) => (
                      <div
                        key={`${cand.lat}-${cand.lng}-${idx}`}
                        onClick={() => applyLocationCandidate(cand)}
                        className="p-2.5 hover:bg-surface-hover cursor-pointer transition-colors ltr:text-left rtl:text-right"
                      >
                        <h4 className="font-semibold text-xs text-ink truncate">
                          {cand.name}
                        </h4>
                        <p className="text-[11px] text-ink-muted line-clamp-1 mt-0.5" dir="ltr">
                          {cand.displayName}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.latitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="e.g. 49.33"
                  className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs font-mono text-left shadow-control"
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-muted mb-0.5">{t('eventEditModal.longitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="e.g. -0.45"
                  className="w-full bg-surface-raised border border-line rounded-control px-2.5 py-1.5 text-ink outline-none focus:border-accent text-xs font-mono text-left shadow-control"
                />
              </div>
            </div>
          </div>

          {/* Image: URL or upload from computer, with thumbnail preview */}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              {t('eventEditModal.imageUrlLabel')}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                dir="ltr"
                value={imageUrl.startsWith('data:') ? '' : imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                disabled={isProcessingImage}
                placeholder={imageUrl.startsWith('data:') ? t('eventEditModal.imageUploadedPlaceholder') : 'https://upload.wikimedia.org/...'}
                className="flex-1 bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent text-xs text-left disabled:opacity-50 shadow-control"
              />
              <label
                title={t('eventEditModal.uploadImage')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-control text-xs font-medium border shrink-0 transition-colors shadow-control ${
                  isProcessingImage
                    ? 'bg-surface-sunken border-line text-ink-subtle cursor-wait'
                    : 'bg-surface-raised hover:bg-surface-hover border-line text-ink cursor-pointer'
                }`}
              >
                {isProcessingImage ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <Upload className="w-3.5 h-3.5 text-accent" />
                )}
                <span className="hidden sm:inline">{t('eventEditModal.uploadImage')}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileSelect}
                  disabled={isProcessingImage}
                  className="hidden"
                />
              </label>
              {imageUrl && (
                <div className="relative w-9 h-9 rounded-control overflow-hidden border border-line shrink-0 bg-surface-sunken group">
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    title={t('common.clear')}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-1 text-[11px] text-ink-subtle">
              {t('eventEditModal.imageHint')}
            </p>
          </div>

          {/* Extract / Summary */}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              {t('eventEditModal.fullDescLabel')}
            </label>
            <textarea
              rows={3}
              dir={extract ? (/[\u0590-\u05FF\u0600-\u06FF]/.test(extract) ? 'rtl' : 'ltr') : (isRtl ? 'rtl' : 'ltr')}
              value={extract}
              onChange={(e) => setExtract(e.target.value)}
              placeholder={t('eventEditModal.fullDescPlaceholder')}
              className={`w-full bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent resize-none text-xs leading-relaxed shadow-control ${
                (extract ? /[\u0590-\u05FF\u0600-\u06FF]/.test(extract) : isRtl) ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Wikipedia URL */}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1 flex items-center justify-between">
              <span>{t('eventEditModal.wikiUrlLabel')}</span>
              {wikiUrl && (
                <a
                  href={wikiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline font-normal cursor-pointer"
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
              className="w-full bg-surface-sunken border border-line rounded-control px-3 py-2 text-ink placeholder-ink-faint outline-none focus:border-accent text-xs text-left shadow-control"
            />
          </div>

          {/* Footer buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover font-medium transition-colors text-xs cursor-pointer"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold shadow-control transition-all text-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
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
