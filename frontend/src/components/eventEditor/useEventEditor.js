import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  enrichItem,
  suggestEventData,
  searchWikiCandidates,
  searchGeocodeCandidates,
  generateEventImage,
  getApiKey,
} from '../../api';
import { normalizeDatePrecision, SUB_DAY_PRECISIONS } from '../../utils/dateTime';
import { normalizeAdditionalImages } from '../../utils/timelineArticles';
import { mergeEditedEvent } from './mergeEditedEvent';
import {
  formatUsdDigits,
  getCreditCosts,
  getRemainingPaidCredits,
  isGeminiModel,
  isPremiumCreditsExhausted,
} from '../../utils/modelUtils';
import {
  applyTimeInput,
  fileToCompressedDataUrl,
  guessSourceName,
  isGifUrl,
  MAX_UPLOAD_BYTES,
  toTimeInputValue,
} from './eventEditorUtils';

const COARSE_PRECISIONS = ['year', 'decade', 'century', 'millennium', 'million-years', 'billion-years'];

function makeDraft(initialEvent, timeScale) {
  const normFrom = initialEvent?.from ? normalizeDatePrecision(initialEvent.from) : null;
  const normTo = initialEvent?.to ? normalizeDatePrecision(initialEvent.to) : null;
  const srcUrl = initialEvent?.sourceUrl || initialEvent?.wikiUrl || '';
  const isWiki = Boolean(srcUrl && srcUrl.toLowerCase().includes('wikipedia.org'));
  const isToPresent = Boolean(initialEvent?.isToPresent);
  return {
    title: initialEvent?.title || '',
    subtitle: initialEvent?.subtitle || '',
    lane: initialEvent?.lane || '',
    newLaneName: '',
    category: initialEvent?.category || '',
    newCategoryName: '',
    fromYear: normFrom?.year ?? '',
    fromMonth: normFrom?.month ?? '',
    fromDay: normFrom?.day ?? '',
    fromTime: toTimeInputValue(normFrom),
    fromPrecision: normFrom?.precision || (timeScale === 'prehistoric' ? 'million-years' : 'year'),
    endMode: isToPresent ? 'ongoing' : (normTo?.year != null && normTo?.year !== '' ? 'range' : 'none'),
    toYear: normTo?.year ?? '',
    toMonth: normTo?.month ?? '',
    toDay: normTo?.day ?? '',
    toTime: toTimeInputValue(normTo),
    imageUrl: initialEvent?.imageUrl || '',
    imageSource: initialEvent?.imageSource || '',
    imageModel: initialEvent?.imageModel || '',
    imageCostUsd: initialEvent?.imageCostUsd ?? null,
    additionalImages: normalizeAdditionalImages(initialEvent?.additionalImages),
    extract: initialEvent?.extract || '',
    isExtractCustom: Boolean(initialEvent?.extractIsCustom),
    sourceName: initialEvent?.sourceName || (isWiki ? 'Wikipedia' : ''),
    sourceUrl: srcUrl,
    wikiTitle: initialEvent?.wikiTitle || '',
    locationName: initialEvent?.locationName || '',
    lat: initialEvent?.lat !== undefined && initialEvent?.lat !== null ? String(initialEvent.lat) : '',
    lng: initialEvent?.lng !== undefined && initialEvent?.lng !== null ? String(initialEvent.lng) : '',
  };
}

// Date fields from an AI suggestion, normalized into draft shape.
function datePatchFromSuggestion(data) {
  const patch = {};
  if (data.from) {
    const normFrom = normalizeDatePrecision(data.from);
    Object.assign(patch, {
      fromYear: normFrom.year ?? '',
      fromMonth: normFrom.month ?? '',
      fromDay: normFrom.day ?? '',
      fromPrecision: normFrom.precision || 'year',
      fromTime: toTimeInputValue(normFrom),
    });
  }
  if (data.to) {
    const normTo = normalizeDatePrecision(data.to);
    Object.assign(patch, {
      toYear: normTo.year ?? '',
      toMonth: normTo.month ?? '',
      toDay: normTo.day ?? '',
      toTime: toTimeInputValue(normTo),
    });
  } else {
    Object.assign(patch, { toYear: '', toMonth: '', toDay: '', toTime: '' });
  }
  patch.endMode = data.isToPresent ? 'ongoing' : (data.to ? 'range' : 'none');
  return patch;
}

/**
 * State and actions behind the in-place event editor (event drawer edit mode). Holds one draft
 * object for the event fields plus the transient async/UI state of the AI / Wikipedia / map
 * helpers, and turns the draft back into a stored article with `buildArticle()`.
 */
export default function useEventEditor({
  initialEvent = null,
  lanes = [],
  timelineTopic = '',
  timeScale = 'calendar',
  timelineId = null,
  isTimelineFictional = false,
  quota = null,
  onRefreshQuota = null,
  t,
  contentMode,
}) {
  const [draft, setDraft] = useState(() => makeDraft(initialEvent, timeScale));
  const initialJsonRef = useRef(null);
  if (initialJsonRef.current === null) initialJsonRef.current = JSON.stringify(draft);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const set = useCallback((field, value) => {
    setDraft((prev) => (prev[field] === value ? prev : { ...prev, [field]: value }));
  }, []);
  const patch = useCallback((changes) => setDraft((prev) => ({ ...prev, ...changes })), []);

  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSearchingWiki, setIsSearchingWiki] = useState(false);
  const [wikiCandidates, setWikiCandidates] = useState([]);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationCandidates, setLocationCandidates] = useState([]);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isProcessingAdditional, setIsProcessingAdditional] = useState(false);
  const [isGeneratingAiImage, setIsGeneratingAiImage] = useState(false);
  const [aiImageCustomPrompt, setAiImageCustomPrompt] = useState('');
  const [aiImageStyle, setAiImageStyle] = useState('auto');
  const [aiImageEngine, setAiImageEngine] = useState('free');
  const [statusMessage, setStatusMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Success notes fade on their own; errors stay until dismissed or replaced.
  useEffect(() => {
    if (!statusMessage) return undefined;
    const timer = setTimeout(() => setStatusMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== initialJsonRef.current, [draft]);
  const canSave = Boolean(draft.title.trim()) && draft.fromYear !== '' && !isNaN(Number(draft.fromYear));

  // ---- Quota / AI image engine ----
  const isAdmin = quota?.is_admin === true;
  const isFreeMode = quota?.mode === 'free' && !isAdmin;
  const isEventAddUnlimited = !isAdmin && !isFreeMode && quota?.daily_paid_limit === -1;
  const eventAddLimit = quota?.daily_paid_limit && quota.daily_paid_limit > 0 ? quota.daily_paid_limit : 10;
  const eventAddRemaining = quota?.remaining_paid ?? 0;
  const isEventAddFreeTier = !isAdmin && !isEventAddUnlimited && !isFreeMode && eventAddRemaining === 0;
  const [hasCustomApiKey, setHasCustomApiKey] = useState(() => Boolean(getApiKey()));
  useEffect(() => {
    const sync = () => setHasCustomApiKey(Boolean(getApiKey()));
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('chronix-api-key-change', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('chronix-api-key-change', sync);
    };
  }, []);
  const imageCreditCost = getCreditCosts(quota).gemini_image;
  const remainingPaidCredits = getRemainingPaidCredits(quota);
  const isGeminiImageBlocked = isPremiumCreditsExhausted(quota, {
    isAdmin,
    hasCustomKey: hasCustomApiKey,
    requiredCredits: imageCreditCost,
  });
  const effectiveAiImageEngine = isGeminiImageBlocked ? 'free' : aiImageEngine;
  const selectAiImageEngine = (next) => {
    if (next === 'premium' && isGeminiImageBlocked) return;
    setAiImageEngine(next);
  };

  // ---- Cover image ----
  const coverMetaOf = (d) => {
    const url = d.imageUrl.trim();
    const isInitial = url === initialEvent?.imageUrl;
    return {
      source: d.imageSource || (isInitial ? initialEvent?.imageSource : ''),
      model: d.imageModel || (isInitial ? initialEvent?.imageModel : ''),
      cost: d.imageCostUsd ?? (isInitial ? initialEvent?.imageCostUsd : null),
    };
  };
  const coverAsGalleryItem = (d) => {
    const meta = coverMetaOf(d);
    return {
      url: d.imageUrl.trim(),
      caption: d.title ? d.title.trim() : '',
      ...(meta.source ? { imageSource: meta.source } : {}),
      ...(meta.model ? { imageModel: meta.model } : {}),
      ...(meta.cost > 0 ? { imageCostUsd: meta.cost } : {}),
    };
  };

  const validateImageFile = (file) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage(t('eventEditModal.imageInvalidType'));
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage(t('eventEditModal.imageTooLarge'));
      return false;
    }
    return true;
  };

  const setCoverUrl = (url) => {
    patch({ imageUrl: url, imageSource: url.trim() ? 'url' : '', imageModel: '', imageCostUsd: null });
  };

  const clearCover = () => patch({ imageUrl: '', imageSource: '', imageModel: '', imageCostUsd: null });

  const uploadCover = async (file) => {
    if (!file || !validateImageFile(file)) return;
    setIsProcessingImage(true);
    setErrorMessage(null);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      patch({ imageUrl: dataUrl, imageSource: 'upload', imageModel: '', imageCostUsd: null });
    } catch {
      setErrorMessage(t('eventEditModal.imageUploadFailed'));
    } finally {
      setIsProcessingImage(false);
    }
  };

  const generateAiCover = async () => {
    const d = draftRef.current;
    if (!d.title.trim() && !aiImageCustomPrompt.trim()) {
      setErrorMessage(t('eventEditModal.enterTitleFirst'));
      return;
    }
    setIsGeneratingAiImage(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const parsedFromYear = d.fromYear !== '' && !isNaN(Number(d.fromYear)) ? parseInt(d.fromYear, 10) : null;
      const res = await generateEventImage({
        title: d.title.trim() || aiImageCustomPrompt.trim(),
        subtitle: d.subtitle.trim(),
        extract: d.extract.trim(),
        fromYear: parsedFromYear,
        timelineTopic,
        timeScale,
        locationName: d.locationName.trim(),
        isFictional: Boolean(initialEvent?.isFictional || isTimelineFictional),
        customPrompt: aiImageCustomPrompt.trim() || undefined,
        style: aiImageStyle || 'auto',
        engine: effectiveAiImageEngine,
        timelineId,
        source: 'event_editor',
      });
      if (res?.imageUrl) {
        const genCost = Number(res.imageCostUsd ?? res.tokenUsage?.estimatedCostUsd ?? 0);
        const hasGeminiCost = genCost > 0 && isGeminiModel(res.model);
        const currentUrl = draftRef.current.imageUrl.trim();
        const hadPreviousCover = Boolean(currentUrl && currentUrl !== res.imageUrl);
        setDraft((prev) => {
          const prevUrl = prev.imageUrl.trim();
          const movesOldCover = Boolean(prevUrl && prevUrl !== res.imageUrl);
          const gallery = movesOldCover && !prev.additionalImages.some((img) => img.url === prevUrl)
            ? [coverAsGalleryItem(prev), ...prev.additionalImages]
            : prev.additionalImages;
          return {
            ...prev,
            imageUrl: res.imageUrl,
            imageSource: res.imageSource || 'ai',
            imageModel: res.model || '',
            imageCostUsd: hasGeminiCost ? genCost : null,
            additionalImages: gallery,
          };
        });
        setAiImageEngine('free');
        if (hasGeminiCost) {
          const cost = formatUsdDigits(genCost);
          setStatusMessage(hadPreviousCover
            ? t('eventEditModal.aiImageSuccessMovedOldWithCost', { cost })
            : t('eventEditModal.aiImageSuccessWithCost', { cost }));
        } else {
          setStatusMessage(hadPreviousCover
            ? (t('eventEditModal.aiImageSuccessMovedOld') || t('eventEditModal.aiImageSuccess'))
            : t('eventEditModal.aiImageSuccess'));
        }
      }
      onRefreshQuota?.();
    } catch (err) {
      if (err?.status === 402) onRefreshQuota?.();
      setErrorMessage(err?.message || t('eventEditModal.aiImageFailed'));
    } finally {
      setIsGeneratingAiImage(false);
    }
  };

  // ---- Gallery (additional photos) ----
  const addGalleryUrl = (url, caption = '') => {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    setDraft((prev) => ({ ...prev, additionalImages: [...prev.additionalImages, { url: trimmed, caption: caption.trim() }] }));
    return true;
  };

  const uploadGalleryFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!files.every(validateImageFile)) return;
    setIsProcessingAdditional(true);
    setErrorMessage(null);
    try {
      const processed = await Promise.all(files.map(async (file) => ({
        url: await fileToCompressedDataUrl(file),
        caption: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      })));
      setDraft((prev) => ({ ...prev, additionalImages: [...prev.additionalImages, ...processed] }));
    } catch {
      setErrorMessage(t('eventEditModal.imageUploadFailed'));
    } finally {
      setIsProcessingAdditional(false);
    }
  };

  const removeGalleryImage = (index) => {
    setDraft((prev) => ({ ...prev, additionalImages: prev.additionalImages.filter((_, i) => i !== index) }));
  };

  const updateGalleryCaption = (index, caption) => {
    setDraft((prev) => ({
      ...prev,
      additionalImages: prev.additionalImages.map((img, i) => (i === index ? { ...img, caption } : img)),
    }));
  };

  const moveGalleryImage = (index, direction) => {
    setDraft((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.additionalImages.length) return prev;
      const copy = [...prev.additionalImages];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return { ...prev, additionalImages: copy };
    });
  };

  // Promotes a gallery photo to cover; the previous cover moves to the front of the gallery.
  const setGalleryImageAsCover = (index) => {
    setDraft((prev) => {
      const selected = prev.additionalImages[index];
      if (!selected) return prev;
      const oldUrl = prev.imageUrl.trim();
      const next = prev.additionalImages.filter((_, i) => i !== index);
      if (oldUrl && oldUrl !== selected.url && !next.some((img) => img.url === oldUrl)) {
        next.unshift(coverAsGalleryItem(prev));
      }
      return {
        ...prev,
        imageUrl: selected.url,
        imageSource: selected.imageSource || '',
        imageModel: selected.imageModel || '',
        imageCostUsd: selected.imageCostUsd ?? null,
        additionalImages: next,
      };
    });
  };

  // ---- Source ----
  const setSourceUrl = (url) => {
    setDraft((prev) => {
      const next = { ...prev, sourceUrl: url };
      if (!prev.sourceName.trim()) {
        const guess = guessSourceName(url);
        if (guess) next.sourceName = guess;
      }
      return next;
    });
  };
  const clearSource = () => patch({ sourceName: '', sourceUrl: '', wikiTitle: '' });

  // ---- Dates ----
  const setFromMonth = (val) => {
    setDraft((prev) => {
      const next = { ...prev, fromMonth: val };
      if (!val) {
        next.fromDay = '';
        next.fromTime = '';
        if (['minute', 'hour', 'day', 'month'].includes(prev.fromPrecision)) next.fromPrecision = 'year';
      } else if (!prev.fromDay && !['minute', 'hour', 'day'].includes(prev.fromPrecision)) {
        next.fromPrecision = 'month';
      }
      return next;
    });
  };
  const setFromDay = (val) => {
    setDraft((prev) => {
      const next = { ...prev, fromDay: val };
      if (!val) {
        next.fromTime = '';
        if (['minute', 'hour', 'day'].includes(prev.fromPrecision)) next.fromPrecision = prev.fromMonth ? 'month' : 'year';
      } else if (!SUB_DAY_PRECISIONS.includes(prev.fromPrecision)) {
        next.fromPrecision = 'day';
      }
      return next;
    });
  };
  const setFromTime = (value) => {
    setDraft((prev) => {
      const next = { ...prev, fromTime: value };
      if (value && !SUB_DAY_PRECISIONS.includes(prev.fromPrecision)) next.fromPrecision = 'minute';
      if (!value && SUB_DAY_PRECISIONS.includes(prev.fromPrecision)) next.fromPrecision = 'day';
      return next;
    });
  };
  const setToTime = (value) => {
    setDraft((prev) => {
      const next = { ...prev, toTime: value };
      if (value && !SUB_DAY_PRECISIONS.includes(prev.fromPrecision)) next.fromPrecision = 'minute';
      return next;
    });
  };
  // A coarser precision clears the finer calendar/time parts to match.
  const setPrecision = (value) => {
    setDraft((prev) => {
      const next = { ...prev, fromPrecision: value };
      if (!SUB_DAY_PRECISIONS.includes(value)) {
        next.fromTime = '';
        next.toTime = '';
      }
      if (value === 'month') next.fromDay = '';
      else if (COARSE_PRECISIONS.includes(value)) {
        next.fromMonth = '';
        next.fromDay = '';
      }
      return next;
    });
  };

  // ---- AI helpers ----
  const suggestDates = async () => {
    const d = draftRef.current;
    if (!d.title.trim()) return;
    setIsSuggesting(true);
    setErrorMessage(null);
    try {
      const data = await suggestEventData({ query: d.title.trim(), timelineTopic, timeScale, lanes, timelineId });
      if (data?.from) {
        patch(datePatchFromSuggestion(data));
        onRefreshQuota?.();
        setStatusMessage(t('eventEditModal.datesUpdatedSuccess'));
      }
    } catch {
      setErrorMessage(t('eventEditModal.datesUpdatedError'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const autoFill = async () => {
    const d = draftRef.current;
    if (!d.title.trim()) return;
    setIsSuggesting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setWikiCandidates([]);
    try {
      const data = await suggestEventData({
        query: d.title.trim(), timelineTopic, timeScale, lanes, timelineId, contentMode,
      });
      if (data) {
        const changes = data.from ? datePatchFromSuggestion(data) : {};
        if (data.title) changes.title = data.title;
        if (data.subtitle) changes.subtitle = data.subtitle;
        if (data.lane) changes.lane = data.lane;
        if (data.category) changes.category = data.category;
        if (data.imageUrl) changes.imageUrl = data.imageUrl;
        if (data.extract) {
          changes.extract = data.extract;
          changes.isExtractCustom = false;
        }
        const autoUrl = data.sourceUrl || data.wikiUrl || '';
        if (autoUrl) changes.sourceUrl = autoUrl;
        if (data.sourceName) changes.sourceName = data.sourceName;
        else if (autoUrl.toLowerCase().includes('wikipedia.org')) changes.sourceName = 'Wikipedia';
        if (data.wikiTitle) changes.wikiTitle = data.wikiTitle;
        if (data.locationName) changes.locationName = data.locationName;
        if (data.lat !== undefined && data.lat !== null) changes.lat = String(data.lat);
        if (data.lng !== undefined && data.lng !== null) changes.lng = String(data.lng);
        patch(changes);
        onRefreshQuota?.();
        setStatusMessage(t('eventEditModal.autoFilledSuccess'));
      }
    } catch (err) {
      console.warn('AI auto-fill error:', err);
      setErrorMessage(err.message || t('eventEditModal.autoFilledError'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const applyWikiCandidate = (cand) => {
    if (!cand) return;
    const d = draftRef.current;
    const changes = {};
    if (cand.wikiTitle && !d.title.trim()) changes.title = cand.wikiTitle;
    if (cand.imageUrl) changes.imageUrl = cand.imageUrl;
    if (cand.extract) {
      changes.extract = cand.extract;
      changes.isExtractCustom = false;
    }
    if (cand.description && !d.subtitle) changes.subtitle = cand.description;
    if (cand.wikiUrl) {
      changes.sourceUrl = cand.wikiUrl;
      changes.sourceName = 'Wikipedia';
    }
    if (cand.wikiTitle) changes.wikiTitle = cand.wikiTitle;
    patch(changes);
    setWikiCandidates([]);
    if (d.fromYear === '') suggestDates();
  };

  const searchWikipedia = async () => {
    const d = draftRef.current;
    if (!d.title.trim()) return;
    setIsSearchingWiki(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const candidates = await searchWikiCandidates(d.title.trim(), timelineTopic);
      if (candidates?.length === 1) {
        applyWikiCandidate(candidates[0]);
        setStatusMessage(t('eventEditModal.linkedCandidateSuccess', { title: candidates[0].wikiTitle }));
      } else if (candidates?.length > 1) {
        setWikiCandidates(candidates);
      } else {
        const fallback = await enrichItem(d.title.trim(), timelineTopic);
        if (fallback) {
          const changes = {};
          if (fallback.imageUrl) changes.imageUrl = fallback.imageUrl;
          if (fallback.extract) {
            changes.extract = fallback.extract;
            changes.isExtractCustom = false;
          }
          if (fallback.description && !d.subtitle) changes.subtitle = fallback.description;
          if (fallback.wikiUrl) {
            changes.sourceUrl = fallback.wikiUrl;
            changes.sourceName = 'Wikipedia';
          }
          if (fallback.wikiTitle) changes.wikiTitle = fallback.wikiTitle;
          patch(changes);
          setStatusMessage(t('eventEditModal.wikiDetailsFound'));
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

  // ---- Location ----
  const searchLocation = async () => {
    const name = draftRef.current.locationName.trim();
    if (!name) return;
    setIsSearchingLocation(true);
    setErrorMessage(null);
    setLocationCandidates([]);
    try {
      const candidates = await searchGeocodeCandidates(name);
      if (candidates?.length) setLocationCandidates(candidates);
      else setErrorMessage(t('eventEditModal.noLocationFound'));
    } catch (e) {
      console.warn('Geocode search failed:', e);
      setErrorMessage(t('eventEditModal.locationSearchFailed'));
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const applyLocationCandidate = (cand) => {
    if (!cand) return;
    patch({
      locationName: cand.name || cand.displayName || draftRef.current.locationName,
      lat: String(cand.lat),
      lng: String(cand.lng),
    });
    setLocationCandidates([]);
  };

  const clearLocation = () => {
    patch({ locationName: '', lat: '', lng: '' });
    setLocationCandidates([]);
  };

  // ---- Save ----
  const buildArticle = () => {
    const d = draftRef.current;
    const fromDate = applyTimeInput({
      year: parseInt(d.fromYear, 10),
      month: d.fromMonth ? parseInt(d.fromMonth, 10) : undefined,
      day: d.fromDay ? parseInt(d.fromDay, 10) : undefined,
    }, d.fromTime, d.fromPrecision);

    let toDate;
    if (d.endMode !== 'none' && d.toYear !== '' && !isNaN(Number(d.toYear))) {
      toDate = applyTimeInput({
        year: parseInt(d.toYear, 10),
        month: d.toMonth ? parseInt(d.toMonth, 10) : undefined,
        day: d.toDay ? parseInt(d.toDay, 10) : undefined,
      }, d.toTime, d.fromPrecision);
    }

    const imageUrl = d.imageUrl.trim();
    const parsedLat = d.lat !== '' && !isNaN(Number(d.lat)) ? Number(d.lat) : undefined;
    const parsedLng = d.lng !== '' && !isNaN(Number(d.lng)) ? Number(d.lng) : undefined;
    const isFictional = initialEvent?.isFictional;
    let googleMapsUrl;
    if (parsedLat !== undefined && parsedLng !== undefined) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${parsedLat},${parsedLng}`;
    } else if (d.locationName.trim() && !isFictional) {
      googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.locationName.trim())}`;
    } else {
      googleMapsUrl = undefined;
    }

    const cover = coverMetaOf(d);
    const isAi = cover.source === 'ai';
    const lowerUrl = imageUrl.toLowerCase();
    const sourceUrl = d.sourceUrl.trim();

    const saved = {
      id: initialEvent?.id || `user-event-${Date.now()}`,
      title: d.title.trim(),
      subtitle: d.subtitle.trim(),
      lane: d.lane || undefined,
      category: d.category === '__new__' ? (d.newCategoryName.trim() || undefined) : (d.category || undefined),
      from: fromDate,
      to: toDate,
      isToPresent: d.endMode === 'ongoing',
      imageUrl: imageUrl || undefined,
      imageSource: imageUrl ? (cover.source || undefined) : undefined,
      imageModel: imageUrl && isAi ? (cover.model || undefined) : undefined,
      imageCostUsd: imageUrl && isAi && cover.cost > 0 ? cover.cost : undefined,
      mediaType: isGifUrl(imageUrl)
        ? 'gif'
        : (lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.webm'))
          ? 'video'
          : (initialEvent?.mediaType || 'image'),
      imagePositionX: imageUrl === initialEvent?.imageUrl ? initialEvent?.imagePositionX : undefined,
      imagePositionY: imageUrl === initialEvent?.imageUrl ? initialEvent?.imagePositionY : undefined,
      additionalImages: d.additionalImages.filter((img) => img?.url?.trim()),
      extract: d.extract.trim(),
      extractIsCustom: d.isExtractCustom && Boolean(d.extract.trim()),
      // Kept as-is; the drawer ignores them if the title/Wikipedia page (and so the search query) changed.
      videos: initialEvent?.videos,
      videosQuery: initialEvent?.videosQuery,
      sourceName: d.sourceName.trim() || undefined,
      sourceUrl: sourceUrl || undefined,
      wikiUrl: sourceUrl || undefined,
      wikiTitle: (d.sourceName.toLowerCase().includes('wiki') || sourceUrl.toLowerCase().includes('wikipedia.org'))
        ? (d.wikiTitle.trim() || undefined)
        : undefined,
      locationName: d.locationName.trim() || undefined,
      lat: parsedLat,
      lng: parsedLng,
      googleMapsUrl: googleMapsUrl || undefined,
      isFictional,
      rank: initialEvent ? initialEvent.rank : 8,
      isEdited: true,
      editedAt: new Date().toISOString(),
    };

    // Creating a brand-new lane: generate an id and attach it so the parent registers it.
    if (d.lane === '__new__') {
      const laneTitle = d.newLaneName.trim();
      if (laneTitle) {
        const laneId =
          laneTitle.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) ||
          `lane-${Date.now().toString(36)}`;
        saved.lane = laneId;
        saved.newLane = { id: laneId, title: laneTitle };
      } else {
        saved.lane = undefined;
      }
    }
    // Fields the form doesn't show (people, sources, provenance...) stay on the event.
    return mergeEditedEvent(initialEvent, saved);
  };

  return {
    draft,
    set,
    patch,
    isDirty,
    canSave,
    buildArticle,
    // async / status
    isSuggesting,
    isSearchingWiki,
    wikiCandidates,
    dismissWikiCandidates: () => setWikiCandidates([]),
    isSearchingLocation,
    locationCandidates,
    dismissLocationCandidates: () => setLocationCandidates([]),
    isProcessingImage,
    isProcessingAdditional,
    isGeneratingAiImage,
    statusMessage,
    errorMessage,
    setErrorMessage,
    // quota
    quotaInfo: {
      isAdmin, isFreeMode, isEventAddUnlimited, isEventAddFreeTier, eventAddLimit, eventAddRemaining,
    },
    // AI image
    aiImage: {
      customPrompt: aiImageCustomPrompt,
      setCustomPrompt: setAiImageCustomPrompt,
      style: aiImageStyle,
      setStyle: setAiImageStyle,
      engine: effectiveAiImageEngine,
      selectEngine: selectAiImageEngine,
      isGeminiBlocked: isGeminiImageBlocked,
      isPremiumFreeKey: !isAdmin && !hasCustomApiKey,
      creditCost: imageCreditCost,
      remainingCredits: remainingPaidCredits,
    },
    // actions
    autoFill,
    suggestDates,
    searchWikipedia,
    applyWikiCandidate,
    searchLocation,
    applyLocationCandidate,
    clearLocation,
    setCoverUrl,
    clearCover,
    uploadCover,
    generateAiCover,
    addGalleryUrl,
    uploadGalleryFiles,
    removeGalleryImage,
    updateGalleryCaption,
    moveGalleryImage,
    setGalleryImageAsCover,
    setSourceUrl,
    clearSource,
    setFromMonth,
    setFromDay,
    setFromTime,
    setToTime,
    setPrecision,
  };
}
