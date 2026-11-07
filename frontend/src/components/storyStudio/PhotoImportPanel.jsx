import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Images, Upload, Loader2, MapPin, Sparkles, Check, AlertTriangle, ShieldCheck, Home, Plane,
  ChevronDown, ChevronRight, Trash2, Scissors, Merge, Calendar, Square, CheckSquare, Star,
  FolderOpen, Users, ExternalLink, BookOpen, ArrowLeft, ArrowRight, Wand2, Undo2, RefreshCw, SlidersHorizontal, X,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { useHostedConfirm } from './StudioFeedback';
import {
  fetchPhotoImportLimits, reverseGeocodePoints, deferredGeocodeIds, draftPhotoEvents, draftPhotoStory, draftStoryOverview, logPhotoImportCost,
  fetchUserQuota, notifyQuotaChanged, uploadTimelinePhoto, DEFAULT_PHOTO_IMPORT_LIMITS,
} from '../../api';
import {
  runAutoBuild, screenshotIds, estimateAutoBuildCredits, storyChaptersToRows, overviewFacts, lookTargets, clipStory,
} from '../../utils/photoImport/autoBuild';
import AiPolishButton from '../AiPolishButton';
import OverviewDraftButton from './OverviewDraftButton';
import { parseFuzzyDate } from '../../utils/fuzzyDate';
import { summarizePhotoMeta } from '../../utils/photoImport/photoMeta';
import {
  clusterPhotos, GROUPING_PRESET_KEYS, pickRepresentatives, suggestTrips, isFixedGrouping, countGroupingLevels,
} from '../../utils/photoImport/clusterPhotos';
import {
  createImportEvents, regroupEvents, mergeWithNext, splitEventAt, movePhotos, datePhoto,
  formatDateRange, placeLabel, eventTitle, defaultEventTitle, placesToLookup, applyPlaces,
  suggestAttachments, homeCountryOf, planPhotoAllocation, unmergeEvents, PHOTO_SIZES, HOSTED_PHOTO_SIZE,
  suggestBlueprintForImport, tripChapters, eventsToMoments, PHOTOS_PER_EVENT_DEFAULT,
  STORAGE_BUDGET_CHARS, eventPlaceLabel, eventPeople, eventCaptions, DATE_DETAILS, formatTimeRange, eventTimeDates,
  HOSTED_PHOTO_UPLOAD_CONCURRENCY, INLINE_PHOTO_ENCODE_CONCURRENCY,
} from '../../utils/photoImport/importModel';
import {
  readPhotoFiles, filesFromDataTransfer, detectPhonePlatform, dataUrlToBlob, createThumbnailStore, orientationStyle, encodePhoto, encodeForAi, mapLimit,
  PHOTO_IMPORT_ACCEPT, THUMB_MAX_DIM,
} from '../../utils/photoImport/photoFiles';
import {
  eventsNeedingDrafts, planDraftBatches, draftCreditCost, applyDrafts,
} from '../../utils/photoImport/aiDrafts';
import { STUDIO_INPUT_CLASS } from './FuzzyDateInput';
import GooglePhotosGuide from './GooglePhotosGuide';
import { dropDuplicatePhotos } from '../../utils/photoImport/dedupe';
import {
  getGooglePhotosClientId, loadGoogleIdentity, requestGooglePhotosToken, pickFromGooglePhotos, pickedItemsToPhotos,
  prefetchRemoteSources, releaseGooglePick, getCachedGooglePhotosToken, setCachedGooglePhotosToken, openPickerWindow,
  PICK_TOKEN_MIN_LIFE_MS,
} from '../../utils/photoImport/googlePhotos';
import { googleTokenNeedsRefresh, isGooglePickExpired } from '../../utils/photoImport/googlePhotosPick';

/**
 * "Add from Google Photos" button per Google's Photos UX guidelines: the full-color icon at
 * 24px on a white background with a #3C4043 label that names the action. Never recolored, never
 * icon-only. The icon is Google's own asset (gstatic branding), served from /brand.
 */
function GooglePhotosButton({ onClick, disabled, busy, label, testId, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-control border border-[#dadce0] bg-white hover:bg-[#f8f9fa] text-[#3C4043] font-medium shadow-sm disabled:opacity-60 cursor-pointer disabled:cursor-default ${compact ? 'text-xs px-2 py-1' : 'text-sm px-3 py-2'}`}
      data-testid={testId}
    >
      {busy
        ? <Loader2 className="w-6 h-6 p-1 animate-spin text-[#3C4043]" />
        : <img src="/brand/google-photos.png" alt="" width={24} height={24} className="w-6 h-6 shrink-0" draggable={false} />}
      <span>{label}</span>
    </button>
  );
}

// 0 = all photos of each event (as storage allows).
const PHOTOS_PER_EVENT_OPTIONS = [0, 1, 2, 4, 8, 12, 24];
// Characters of base64 ~ bytes on the wire; shown in decimal MB like the server's limit.
const fmtMb = (chars) => (chars / 1_000_000).toFixed(1);

/** Thumbnail that is generated only once it scrolls into view. */
function LazyThumb({ id, store, files, metas, className = '', label, version }) {
  const ref = useRef(null);
  const thumb = store.get(id);
  const failed = store.hasFailed(id);
  useEffect(() => {
    if (thumb || failed) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      store.request(id, files.get(id));
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        store.request(id, files.get(id));
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [id, store, files, thumb, failed, version]);
  return (
    <span ref={ref} className={`block overflow-hidden bg-surface-hover ${className}`}>
      {thumb ? (
        <img src={thumb.url} alt={label || ''} draggable={false} className="w-full h-full object-cover" style={orientationStyle(metas.get(id)?.orientation, thumb.embedded)} />
      ) : failed ? (
        <span className="w-full h-full flex items-center justify-center text-caption text-ink-subtle text-center p-1 leading-tight">{label}</span>
      ) : (
        <span className="w-full h-full block animate-pulse" />
      )}
    </span>
  );
}

/**
 * The photo import workspace of the Story Studio: pick photos -> review the grouped moments ->
 * hand rows, chapters and encoded photos back to the Studio (onApply). Free except the optional
 * AI drafting, whose size follows the caller's plan (unlimited for admins and own-key users).
 */
export default function PhotoImportPanel({
  storyContext = {},
  existingArticles = [],
  existingChars = 0,
  laneOptions = [],
  defaultLane = '',
  timelineId = null,
  onCancel,
  onApply,
  onPreviewChange,
  onLiveChange,
  backLabelKey = 'photoImport.backToStory',
  // AI-first import: AI builds the whole draft (manual stays one click away).
  aiFirst = false,
  // A new timeline from these photos (vs. adding them to an existing story): AI also writes its
  // title and overview, and the review can create the timeline directly.
  canCreate = false,
  existingTitle = '',
}) {
  const { t, language, isRtl } = useLanguage();
  const confirm = useHostedConfirm();
  const lang = language === 'he' ? 'he' : 'en';
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  // React doesn't know `webkitdirectory`; set it on the element directly.
  const setFolderInput = useCallback((el) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createThumbnailStore();
  const store = storeRef.current;
  const [thumbVersion, setThumbVersion] = useState(0);

  const [limits, setLimits] = useState(DEFAULT_PHOTO_IMPORT_LIMITS);
  const [stage, setStage] = useState('pick'); // pick | reading | review | applying
  const [readProgress, setReadProgress] = useState({ done: 0, total: 0 });
  const [notices, setNotices] = useState([]);
  const filesRef = useRef(new Map());
  const [metas, setMetas] = useState(() => new Map());
  const [preset, setPreset] = useState('balanced');
  const [home, setHome] = useState(null);
  const [events, setEvents] = useState([]);
  const [unassignedIds, setUnassignedIds] = useState([]);
  const [photosPerEvent, setPhotosPerEvent] = useState(0);
  const [dateDetail, setDateDetail] = useState('day');
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [lane, setLane] = useState(defaultLane || laneOptions[laneOptions.length - 1]?.id || '');
  const [geo, setGeo] = useState({ running: false, done: 0, total: 0, failed: false, capped: false });
  const placeCacheRef = useRef({});
  const [ai, setAi] = useState({ running: false, done: 0, total: 0, credits: 0, message: '', error: '' });
  const [aiIncludeNamed, setAiIncludeNamed] = useState(false);
  const [quota, setQuota] = useState(null);
  const aiAbortRef = useRef(null);
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [dateDrafts, setDateDrafts] = useState({});
  const [guideOpen, setGuideOpen] = useState(false);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const dirtyRef = useRef(false);

  // ---- AI-first state ----
  // flow 'ai': read -> ready card -> AI builds everything -> one review; 'manual': the classic import.
  const [flow, setFlow] = useState(aiFirst ? 'ai' : 'manual');
  const buildMode = canCreate ? 'new' : 'add';
  const [context, setContext] = useState({ text: '', instructions: '', people: (storyContext.people || []).filter(Boolean).join(', ') });
  const [countdown, setCountdown] = useState({ left: null, paused: false });
  // { stage, done, total, credits } while running; null otherwise.
  const [build, setBuild] = useState(null);
  // What the last build produced: story pass (title, type, chapters...), overview, notices.
  const [story, setStory] = useState(null);
  const [storyTitle, setStoryTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [buildInfo, setBuildInfo] = useState(null); // { credits, failedIds, merged, stoppedBy, storyFailed, overviewFailed, setAsideShots }
  const [mergeUndo, setMergeUndo] = useState(null); // events before the story pass merged them
  const buildAbortRef = useRef(null);
  const geoRunningRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchPhotoImportLimits().then((l) => { if (alive) setLimits(l); });
    fetchUserQuota().then((q) => { if (alive) setQuota(q); }).catch(() => {});
    const unsub = store.subscribe(() => setThumbVersion((v) => v + 1));
    return () => {
      alive = false;
      unsub();
      aiAbortRef.current?.abort();
      buildAbortRef.current?.abort();
      store.clear();
    };
  }, [store]);

  // ---- Reading & grouping ----
  const regroup = useCallback((nextMetas, nextPreset, prevEvents, nextUnassigned) => {
    // Photos in the unassigned tray (undated, or removed by the user) stay out of the grouping.
    const aside = new Set(nextUnassigned);
    const dated = [...nextMetas.values()].filter((m) => m.time && !aside.has(m.id));
    const { clusters, home: h } = clusterPhotos(dated, { preset: nextPreset });
    let evs = prevEvents ? regroupEvents(prevEvents, clusters, nextMetas, { photosPerEvent: PHOTOS_PER_EVENT_DEFAULT }) : createImportEvents(clusters, nextMetas, { photosPerEvent: PHOTOS_PER_EVENT_DEFAULT });
    evs = applyPlaces(evs, placeCacheRef.current);
    evs = suggestAttachments(evs, existingArticles);
    setHome(h);
    setEvents(evs);
  }, [existingArticles]);

  // Local files, Takeout folders and Google Photos picks all end up here.
  const ingest = (incoming, files, notices) => {
    // The same photo from two sources (or twice in one Takeout) is kept once.
    const { keep: newMetas, duplicateIds } = dropDuplicatePhotos(metas.values(), incoming);
    const next = duplicateIds.length ? [...notices, t('photoImport.duplicatesSkipped', { count: duplicateIds.length })] : notices;
    const dup = new Set(duplicateIds);
    for (const [id, f] of files) if (!dup.has(id)) filesRef.current.set(id, f);
    const merged = new Map(metas);
    for (const m of newMetas) merged.set(m.id, m);
    const undatedNew = newMetas.filter((m) => !m.time).map((m) => m.id);
    // AI-first: screenshots wait in the tray instead of becoming moments (free, on the device).
    const shots = flow === 'ai' ? screenshotIds(newMetas.filter((m) => m.time)) : [];
    if (shots.length) next.push(t('photoImport.aiScreenshotsAside', { count: shots.length }));
    const nextUnassigned = [...unassignedIds, ...undatedNew, ...shots];
    setNotices(next);
    setMetas(merged);
    setUnassignedIds(nextUnassigned);
    if (!merged.size) {
      setStage('pick');
      return;
    }
    regroup(merged, preset, events.length ? events : null, nextUnassigned);
    // The first photos of an AI-first import go to the ready card; later additions to the review.
    setStage(flow === 'ai' && !story && !buildInfo ? 'ready' : 'review');
  };

  const addFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    setError('');
    setStage('reading');
    setReadProgress({ done: 0, total: list.length });
    const { metas: newMetas, files, skipped, sidecars } = await readPhotoFiles(list, {
      maxPhotos: limits.max_photos,
      already: metas.size,
      onProgress: (done, total) => setReadProgress({ done, total }),
    });
    const next = [];
    if (skipped.type) next.push(t('photoImport.skippedType', { count: skipped.type }));
    if (skipped.size) next.push(t('photoImport.skippedSize', { count: skipped.size }));
    if (skipped.limit) next.push(t('photoImport.skippedLimit', { count: skipped.limit, max: limits.max_photos }));
    if (sidecars) next.push(t('photoImport.takeoutMatched', { count: sidecars }));
    ingest(newMetas, files, next);
  };

  // ---- Google Photos (Picker API through our backend; dates only, Google strips locations) ----
  const googleClientId = getGooglePhotosClientId();
  // Starts from the page session's token, so a second import doesn't ask to sign in again.
  const googleTokenRef = useRef(getCachedGooglePhotosToken());
  const setGoogleToken = (token) => {
    googleTokenRef.current = token;
    setCachedGooglePhotosToken(token);
  };
  const googleAbortRef = useRef(null);
  // Open Picker sessions of this import: closed on Apply, Cancel or unmount (B-28), never earlier,
  // because stale photo URLs are re-listed from them.
  const googlePicksRef = useRef([]);
  // state: idle | connecting (Google sign-in) | waiting (picker open) | loading (reading the pick).
  // `blocked`: the browser blocked the picker window, so it's offered as a button to click.
  const [google, setGoogle] = useState({ state: 'idle', pickerUrl: '', blocked: false, error: '', note: '' });
  const releaseGooglePicks = () => {
    const token = googleTokenRef.current?.accessToken;
    for (const pick of googlePicksRef.current) releaseGooglePick(token, pick);
    googlePicksRef.current = [];
  };
  useEffect(() => {
    if (googleClientId) loadGoogleIdentity().catch(() => {});
    return () => {
      googleAbortRef.current?.abort();
      releaseGooglePicks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  const googleErrorText = (err) => {
    const code = err?.message || '';
    if (code === 'picker-closed' || code === 'popup_closed' || code === 'popup-closed') return '';
    if (code === 'picker-timeout') return t('photoImport.googleTimeout');
    if (code === 'google-expired') return t('photoImport.googleExpired');
    if (code === 'access-denied' || code === 'access_denied') return t('photoImport.googleDenied');
    if (code === 'gis-unavailable' || code === 'gis-failed') return t('photoImport.googleUnavailable');
    if (err?.status === 401) return /sign in/i.test(code) ? t('photoImport.aiSignIn') : t('photoImport.googleExpired');
    return t('photoImport.googleFailed', { message: code });
  };

  const tokenValid = () => {
    if (!googleTokenRef.current) googleTokenRef.current = getCachedGooglePhotosToken(Date.now(), PICK_TOKEN_MIN_LIFE_MS);
    return Boolean(googleTokenRef.current && googleTokenRef.current.expiresAt - Date.now() > PICK_TOKEN_MIN_LIFE_MS);
  };
  const GOOGLE_IDLE = { state: 'idle', pickerUrl: '', blocked: false, error: '', note: '' };
  const googleOpenPickerRef = useRef(null);
  const openReadyPicker = () => {
    if (googleOpenPickerRef.current) {
      googleOpenPickerRef.current();
      return;
    }
    if (google.pickerUrl) openPickerWindow(google.pickerUrl);
  };

  // One click: sign in to Google when needed, then straight on to the picker.
  const startGooglePick = async () => {
    if (google.state === 'waiting' && google.blocked && google.pickerUrl) {
      openReadyPicker();
      return;
    }
    setError('');
    // With a token already, the picker window is opened synchronously, inside the click, so the
    // browser doesn't block it. Otherwise Google's sign-in popup uses the click, and the picker
    // is opened right after it (offered as a button if the browser blocks that window).
    const popup = tokenValid() ? openPickerWindow() : null;
    const controller = new AbortController();
    googleAbortRef.current = controller;
    googleOpenPickerRef.current = null;
    try {
      if (!tokenValid()) {
        setGoogle({ ...GOOGLE_IDLE, state: 'connecting' });
        setGoogleToken(await requestGooglePhotosToken(googleClientId));
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }
      const token = googleTokenRef.current.accessToken;
      const { items, skipped, pick } = await pickFromGooglePhotos(token, {
        popup,
        signal: controller.signal,
        onState: (state, info) => {
          googleOpenPickerRef.current = info?.openPicker || null;
          setGoogle({ ...GOOGLE_IDLE, state, pickerUrl: info?.pickerUrl || '', blocked: Boolean(info?.blocked) });
        },
      });
      googlePicksRef.current.push(pick);
      const { metas: newMetas, files, limited } = pickedItemsToPhotos(items, () => googleTokenRef.current, {
        maxPhotos: limits.max_photos, already: metas.size, pick,
      });
      setGoogle(GOOGLE_IDLE);
      if (!newMetas.length) {
        releaseGooglePick(token, pick);
        return;
      }
      // Review thumbnails are fetched now, while the photo URLs are fresh (they expire in ~1 hour).
      prefetchRemoteSources([...files.values()], THUMB_MAX_DIM);
      const next = [t('photoImport.googleAdded', { count: newMetas.length })];
      if (skipped) next.push(t('photoImport.googleSkippedVideos', { count: skipped }));
      if (limited) next.push(t('photoImport.skippedLimit', { count: limited, max: limits.max_photos }));
      ingest(newMetas, files, next);
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      if (err?.status === 401 && !/sign in/i.test(err?.message || '')) setGoogleToken(null);
      if (err?.name === 'AbortError') {
        setGoogle(GOOGLE_IDLE);
        return;
      }
      if (err?.message === 'picker-closed') {
        setGoogle({ ...GOOGLE_IDLE, note: t('photoImport.googleClosed') });
        return;
      }
      setGoogle({ ...GOOGLE_IDLE, error: googleErrorText(err) });
    } finally {
      googleOpenPickerRef.current = null;
      if (googleAbortRef.current === controller) googleAbortRef.current = null;
    }
  };
  const googleBusy = google.state === 'connecting' || google.state === 'loading' || (google.state === 'waiting' && !google.blocked);

  // Where the Google flow is at, beside the button: the picker as a button when the browser
  // blocked its window, what to do in it, and a way to stop waiting.
  const renderGoogleStatus = () => (
    <>
      {google.state === 'connecting' && <span className="text-caption text-ink-muted">{t('photoImport.googleSigningIn')}</span>}
      {google.state === 'waiting' && google.blocked && (
        <button type="button" onClick={openReadyPicker} className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover shadow-sm cursor-pointer" data-testid="photo-import-google-open">
          <ExternalLink className="w-4 h-4" />{t('photoImport.googleOpenPicker')}
        </button>
      )}
      {google.state === 'waiting' && !google.blocked && (
        <>
          <span className="text-caption text-ink-muted">{t('photoImport.googleWaiting')}</span>
          <button type="button" onClick={openReadyPicker} className="inline-flex items-center gap-1 text-caption text-accent underline cursor-pointer">
            <ExternalLink className="w-3 h-3" />{t('photoImport.googleOpenAgain')}
          </button>
        </>
      )}
      {(google.state === 'waiting' || google.state === 'connecting') && (
        <button type="button" onClick={() => googleAbortRef.current?.abort()} className="text-caption text-ink-muted hover:text-ink underline cursor-pointer" data-testid="photo-import-google-stop">{t('photoImport.googleStop')}</button>
      )}
      {google.state === 'loading' && <span className="text-caption text-ink-muted">{t('photoImport.googleLoading')}</span>}
    </>
  );

  const renderGoogle = ({ hint = true } = {}) => {
    if (!googleClientId) return null;
    return (
      <div className="text-start space-y-2" data-testid="photo-import-google">
        <div className="flex flex-wrap items-center gap-2">
          <GooglePhotosButton
            onClick={startGooglePick}
            disabled={googleBusy}
            busy={googleBusy}
            label={t('photoImport.googleConnect')}
            testId="photo-import-google-btn"
          />
          {renderGoogleStatus()}
        </div>
        {google.state === 'waiting' && google.blocked && <p className="text-caption text-ink-muted leading-snug">{t('photoImport.googleBlockedHint')}</p>}
        {hint && <p className="text-caption text-ink-muted leading-snug">{t('photoImport.googleHint')}</p>}
        {google.note && <p className="text-caption text-ink-muted">{google.note}</p>}
        {google.error && <p className="text-caption text-danger">{google.error}</p>}
      </div>
    );
  };

  const summary = useMemo(() => summarizePhotoMeta([...metas.values()]), [metas]);
  const phone = useMemo(() => detectPhonePlatform(), []);
  const phoneTip = phone === 'ios' ? t('photoImport.phoneTipIos') : phone === 'android' ? t('photoImport.phoneTipAndroid') : '';
  // Why the places are missing, when they are: Google never shares them; phones remove them.
  const noPlacesText = summary.dated > 0 && summary.withGps === 0
    ? (summary.fromGoogle === summary.dated ? t('photoImport.googleNoPlaces') : (phoneTip || t('photoImport.noGpsWarning')))
    : '';

  // ---- Place names (free, rounded coordinates, batched per the caller's plan) ----
  const pendingPlaceKey = useMemo(() => placesToLookup(events).map((p) => p.id).join('|'), [events]);
  geoRunningRef.current = geo.running;
  // Places are named as soon as the photos are grouped (the AI build waits for them). A boolean,
  // so moving between these stages doesn't cancel lookups in flight.
  const geoActive = ['ready', 'building', 'review'].includes(stage);
  useEffect(() => {
    if (!geoActive || geo.running) return undefined;
    const all = placesToLookup(events).filter((p) => !(p.id in placeCacheRef.current));
    if (!all.length) return undefined;
    const alreadyNamed = Object.keys(placeCacheRef.current).length;
    const room = limits.max_places == null ? all.length : Math.max(0, limits.max_places - alreadyNamed);
    const points = all.slice(0, room);
    if (!points.length) {
      if (!geo.capped) setGeo((g) => ({ ...g, capped: true }));
      return undefined;
    }
    let cancelled = false;
    const chunk = Math.max(1, limits.geocode_points_per_call || 10);
    setGeo({ running: true, done: 0, total: points.length, failed: false, capped: points.length < all.length });
    (async () => {
      let failed = false;
      const retriedBusy = new Set();
      for (let i = 0; i < points.length && !cancelled; i += chunk) {
        const batch = points.slice(i, i + chunk);
        try {
          const res = await reverseGeocodePoints(batch, lang);
          const deferred = new Set(deferredGeocodeIds(res));
          if (deferred.size && !retriedBusy.has(i)) {
            // The shared place lookup was busy (SC-11): keep what came back, retry the rest once.
            retriedBusy.add(i);
            for (const p of batch) if (!deferred.has(String(p.id))) placeCacheRef.current[p.id] = res[p.id] || null;
            setEvents((prev) => applyPlaces(prev, placeCacheRef.current));
            await new Promise((r) => setTimeout(r, 5000));
            if (cancelled) break;
            i -= chunk;
            continue;
          }
          if (deferred.size) failed = true;
          for (const p of batch) placeCacheRef.current[p.id] = res[p.id] || null;
        } catch (err) {
          failed = true;
          // Rate limited: wait a little and retry this batch once.
          if (err?.status === 429) {
            await new Promise((r) => setTimeout(r, 20000));
            i -= chunk;
            if (cancelled) break;
            continue;
          }
          for (const p of batch) placeCacheRef.current[p.id] = null;
        }
        if (cancelled) break;
        setEvents((prev) => applyPlaces(prev, placeCacheRef.current));
        setGeo((g) => ({ ...g, done: Math.min(points.length, i + chunk) }));
      }
      if (!cancelled) setGeo((g) => ({ ...g, running: false, failed }));
    })();
    return () => { cancelled = true; };
    // Re-run only when the set of unnamed places changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoActive, pendingPlaceKey, limits.max_places, limits.geocode_points_per_call, lang]);

  const homeCountry = useMemo(() => homeCountryOf(events), [events]);
  const trips = useMemo(() => suggestTrips(events, home), [events, home]);
  const tripEventIds = useMemo(() => new Set(trips.flatMap((tr) => tr.clusterIds)), [trips]);

  // Preview on the Studio canvas (shown on Apply): the included events as they would be added.
  const previewKey = useMemo(
    () => events.filter((e) => e.include && !e.attachTo).map((e) => `${e.id}:${e.title}:${e.place?.city || ''}:${e.photoIds.length}:${(e.note || '').length}:${(e.story || '').length}`).join('|'),
    [events],
  );
  useEffect(() => {
    if (!onPreviewChange) return undefined;
    const timer = setTimeout(() => {
      let n = 0;
      const { rows } = eventsToMoments(eventsRef.current.filter((e) => !e.attachTo), { lang, lane, homeCountry, newRowId: () => `pv${(n += 1)}`, dateDetail });
      onPreviewChange(rows);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, lane, homeCountry, lang, dateDetail]);
  useEffect(() => () => onPreviewChange?.(null), [onPreviewChange]);
  // While the AI builds, the Studio canvas follows the drafts as they land.
  // (and on the ready card, so the grouped moments show right away).
  useEffect(() => { onLiveChange?.(stage === 'building' || stage === 'ready'); }, [stage, onLiveChange]);
  useEffect(() => () => onLiveChange?.(false), [onLiveChange]);

  // ---- Edits ----
  const updateEvent = (id, patch) => {
    dirtyRef.current = true;
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const autoTimeRef = useRef(false);
  const changePreset = async (key) => {
    if (key === preset) return;
    if (dirtyRef.current && !(await confirm({
      body: t('photoImport.regroupConfirm'),
      confirmLabel: t('photoImport.regroupBtn'),
      cancelLabel: t('common.cancel'),
    }))) return;
    // Hourly / per-photo events on one day need their times, or they'd all share one date.
    const fine = key === 'hour' || key === 'photo';
    if (fine && dateDetail === 'day') {
      setDateDetail('time');
      autoTimeRef.current = true;
    } else if (!fine && autoTimeRef.current && dateDetail === 'time') {
      setDateDetail('day');
      autoTimeRef.current = false;
    }
    setPreset(key);
    setExpandedId(null);
    setSelected(new Set());
    regroup(metas, key, events, unassignedIds);
  };
  const doMerge = (id) => {
    dirtyRef.current = true;
    setEvents((prev) => mergeWithNext(prev, id, metas));
  };
  const doSplit = (id, photoId) => {
    dirtyRef.current = true;
    setEvents((prev) => suggestAttachments(splitEventAt(prev, id, photoId, metas), existingArticles));
    setSelected(new Set());
  };
  const doMove = (photoIds, targetId) => {
    dirtyRef.current = true;
    const res = movePhotos(eventsRef.current, unassignedIds, photoIds, targetId, metas);
    setEvents(res.events);
    setUnassignedIds(res.unassignedIds);
    setSelected(new Set());
  };
  const toggleSelected = (pid) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });
  const giveDate = (photoId, text) => {
    const d = parseFuzzyDate(text, { lang });
    if (!d || !d.month || !d.day) return false;
    const meta = datePhoto(metas.get(photoId), d);
    const nextMetas = new Map(metas);
    nextMetas.set(photoId, meta);
    setMetas(nextMetas);
    const nextUnassigned = unassignedIds.filter((id) => id !== photoId);
    const sameDay = eventsRef.current.find((e) => e.startWall.year === d.year && e.startWall.month === d.month && e.startWall.day === d.day);
    if (sameDay) {
      const res = movePhotos(eventsRef.current, nextUnassigned, [photoId], sameDay.id, nextMetas);
      setEvents(res.events);
      setUnassignedIds(res.unassignedIds);
    } else {
      const [ev] = createImportEvents(clusterPhotos([meta], { home: null }).clusters, nextMetas, { photosPerEvent: PHOTOS_PER_EVENT_DEFAULT });
      setEvents((prev) => suggestAttachments([...prev, ev], existingArticles).sort((a, b) => a.startMs - b.startMs));
      setUnassignedIds(nextUnassigned);
    }
    dirtyRef.current = true;
    return true;
  };

  // ---- Visible list & storage ----
  const visible = events;
  const included = events.filter((e) => e.include);
  // Signed-in users keep photos in their hosted photo library (Supabase Storage) when it has
  // room for at least a cover per event; otherwise photos go inline within the timeline budget.
  const hostedPlan = limits.hosted_photos || {};
  const hostedRemaining = hostedPlan.enabled
    ? (hostedPlan.quota == null ? Infinity : Math.max(0, hostedPlan.quota - (hostedPlan.used || 0)))
    : 0;
  const useHosted = hostedPlan.enabled && hostedRemaining >= Math.max(1, included.length);
  // Every included event is kept; storage decides how many photos (and how sharp) each keeps.
  const allocation = planPhotoAllocation(included, useHosted
    ? { maxPerEvent: photosPerEvent || Infinity, budgetChars: Infinity, maxPhotos: hostedRemaining }
    : { maxPerEvent: photosPerEvent || Infinity, budgetChars: STORAGE_BUDGET_CHARS, existingChars });
  const includedPhotos = included.reduce((n, e) => n + e.photoIds.length, 0);
  const keptPhotos = allocation.photos;
  const storageChars = allocation.chars;
  const reduced = !useHosted && allocation.size !== 'normal';
  const hostedFull = hostedPlan.enabled && !useHosted;

  // ---- AI drafts ----
  const draftTargets = eventsNeedingDrafts(events, { includeNamed: aiIncludeNamed });
  const draftCredits = draftCreditCost(draftTargets.length, limits);
  const remaining = quota && Number.isFinite(Number(quota.remaining_paid)) ? Number(quota.remaining_paid) : null;
  const overQuota = !limits.unlimited && remaining != null && remaining >= 0 && draftCredits > remaining;

  const runAi = async () => {
    if (ai.running || !draftTargets.length) return;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const ids = draftTargets.map((e) => e.id);
    const batches = planDraftBatches(ids, limits);
    setAi({ running: true, done: 0, total: ids.length, credits: 0, message: '', error: '' });
    let done = 0;
    let credits = 0;
    let drafted = 0;
    try {
      await mapLimit(batches, Math.max(1, limits.draft_parallel_calls || 1), async (batch) => {
        const payloadEvents = [];
        for (const id of batch) {
          const ev = eventsRef.current.find((e) => e.id === id);
          if (!ev) continue;
          const reps = pickRepresentatives(ev.photoIds, metas, limits.draft_images_per_event);
          const ordered = ev.coverId && ev.photoIds.includes(ev.coverId) ? [ev.coverId, ...reps.filter((x) => x !== ev.coverId)].slice(0, limits.draft_images_per_event) : reps;
          const images = [];
          for (const pid of ordered) {
            if (controller.signal.aborted) return;
            try {
              const b64 = await encodeForAi(filesRef.current.get(pid), limits.draft_image_max_px);
              if (b64) images.push(b64);
            } catch {
              // An unreadable photo is simply left out.
            }
          }
          payloadEvents.push({
            id: ev.id,
            place: eventPlaceLabel(ev, homeCountry),
            date_text: formatDateRange(ev.startWall, ev.endWall, lang),
            photo_count: ev.photoIds.length,
            at_home: ev.atHome === true,
            hint: (ev.noteSource === 'user' ? (ev.note || '') : eventCaptions(ev, metas).join(' · ')).slice(0, 300),
            people_tagged: eventPeople(ev, metas, 10),
            // No location in the photos at all: let the AI recognise the place if it can.
            needs_place: !ev.centroid && !eventPlaceLabel(ev, homeCountry),
            current_title: ev.titleSource === 'user' ? (ev.title || '').slice(0, 200) : '',
            images,
          });
        }
        if (!payloadEvents.length || controller.signal.aborted) return;
        const res = await draftPhotoEvents({
          events: payloadEvents,
          storyKind: storyContext.kind,
          storyTitle: storyContext.title,
          people: storyContext.people,
          lang,
          timelineId,
          signal: controller.signal,
        });
        credits += Number(res.credits) || 0;
        drafted += (res.drafts || []).length;
        done += batch.length;
        setEvents((prev) => applyDrafts(prev, res.drafts));
        setAi((a) => ({ ...a, done, credits }));
      }, { signal: controller.signal });
      setAi((a) => ({ ...a, running: false, message: t('photoImport.aiDone', { count: drafted }) }));
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      setAi((a) => ({
        ...a,
        running: false,
        message: drafted ? t('photoImport.aiDone', { count: drafted }) : '',
        error: aborted ? '' : (err?.status === 401 ? t('photoImport.aiSignIn') : t('photoImport.aiError', { message: err?.message || '' })),
      }));
    } finally {
      aiAbortRef.current = null;
      if (credits) notifyQuotaChanged();
      fetchUserQuota().then(setQuota).catch(() => {});
    }
  };

  // ---- AI-first: build the whole timeline ----
  const contextPeople = useMemo(
    () => [...new Set(context.people.split(/[,،;\n]/).map((p) => p.trim()).filter(Boolean))].slice(0, 8),
    [context.people],
  );
  const buildTargets = lookTargets(events);
  const buildEstimate = estimateAutoBuildCredits(buildTargets.length, limits, { overview: buildMode === 'new' });
  const buildOverQuota = !limits.unlimited && remaining != null && remaining >= 0 && buildEstimate.total > remaining;

  // The "how finely to split" scale: events and credits per level, before anything is built.
  // Credit-gated: a limited plan can pick any level its remaining credits cover.
  const levelCounts = useMemo(() => {
    const aside = new Set(unassignedIds);
    const dated = [...metas.values()].filter((m) => m.time && !aside.has(m.id));
    return dated.length ? countGroupingLevels(dated) : {};
  }, [metas, unassignedIds]);
  const levelEvents = (key) => (key === preset ? buildTargets.length : (levelCounts[key] || 0));
  const levelCredits = (key) => estimateAutoBuildCredits(levelEvents(key), limits, { overview: buildMode === 'new' }).total;
  const levelLocked = (key) => !limits.unlimited && remaining != null && remaining >= 0 && key !== preset && levelCredits(key) > remaining;
  const instructionsMax = Math.max(0, Number(limits.instructions_max_chars) || 2800);
  const encodeImage = useCallback((pid, maxPx) => encodeForAi(filesRef.current.get(pid), maxPx), []);

  // Waits for the place names (they go into every AI request), at most ~2 minutes.
  const waitForPlaces = async (signal) => {
    for (let i = 0; i < 400 && geoRunningRef.current; i += 1) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  // onlyIds: draft just these events (failed ones, or photos added after the build) - no story
  // pass or overview then; otherwise the whole build.
  const runBuild = async ({ onlyIds = null } = {}) => {
    const onlyNew = Boolean(onlyIds);
    if (build) return;
    setCountdown({ left: null, paused: true });
    setError('');
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setStage('building');
    setBuild({ stage: 'places', done: 0, total: 0, credits: 0 });
    dirtyRef.current = true;
    await waitForPlaces(controller.signal);
    const skip = onlyNew ? new Set(eventsRef.current.filter((e) => !onlyIds.has(e.id)).map((e) => e.id)) : null;
    let res;
    try {
      res = await runAutoBuild({
        getEvents: () => (skip ? eventsRef.current.filter((e) => !skip.has(e.id)) : eventsRef.current),
        setEvents: (fn) => {
          // Drafting only some events: the others pass through untouched.
          const update = (list) => {
            if (!skip) return fn(list);
            const fresh = fn(list.filter((e) => !skip.has(e.id)));
            return [...list.filter((e) => skip.has(e.id)), ...fresh].sort((a, b) => a.startMs - b.startMs);
          };
          // The same pure update on the ref right away (the next step reads it before React
          // re-renders) and on the state (which also holds whatever the user typed meanwhile).
          eventsRef.current = update(eventsRef.current);
          setEvents(update);
        },
        metasById: metas,
        limits,
        lang,
        homeCountry,
        trips,
        home,
        context: context.text.trim(),
        instructions: context.instructions.trim().slice(0, instructionsMax),
        // One event per day / hour / photo: the story pass must not merge them back.
        allowMerges: !isFixedGrouping(preset),
        people: contextPeople.length ? contextPeople : (storyContext.people || []),
        mode: onlyNew ? 'add' : buildMode,
        existingTitle: onlyNew ? (storyTitle || existingTitle) : existingTitle,
        storyKind: storyContext.kind || '',
        timelineId,
        api: { draftPhotoEvents, draftPhotoStory, draftStoryOverview, logPhotoImportCost },
        encodeImages: encodeImage,
        overview: !onlyNew && buildMode === 'new',
        storyPass: !onlyNew,
        onProgress: (p) => setBuild(p),
        signal: controller.signal,
      });
    } catch (err) {
      res = { credits: 0, failedIds: [], story: null, stoppedBy: err, merged: 0 };
    }
    buildAbortRef.current = null;
    if (res.story && !onlyNew) {
      setStory(res.story);
      if (buildMode === 'new' && res.story.timeline_title) setStoryTitle(res.story.timeline_title);
    }
    if (res.overview && !onlyNew) setOverview(res.overview);
    if (!onlyNew) {
      setMergeUndo(res.merged ? { originals: res.mergedOriginals || [], keepers: [...new Set(Object.values(res.mergedInto || {}))] } : null);
    }
    setBuildInfo((prev) => ({
      credits: (prev?.credits || 0) + (res.credits || 0),
      failedIds: res.failedIds || [],
      merged: onlyNew ? (prev?.merged || 0) : (res.merged || 0),
      stopped: res.stoppedBy === 'abort',
      error: res.stoppedBy && res.stoppedBy !== 'abort'
        ? (res.stoppedBy.status === 401 ? t('photoImport.aiSignIn') : t('photoImport.aiError', { message: res.stoppedBy.message || '' }))
        : '',
      storyFailed: onlyNew ? Boolean(prev?.storyFailed) : Boolean(res.storyFailed),
      overviewFailed: onlyNew ? Boolean(prev?.overviewFailed) : Boolean(res.overviewFailed),
    }));
    setBuild(null);
    setStage('review');
    if (res.credits) notifyQuotaChanged();
    fetchUserQuota().then(setQuota).catch(() => {});
  };

  const stopBuild = () => buildAbortRef.current?.abort();

  // Re-drafts the events whose AI call failed (or that came in after the build).
  const retryFailed = () => runBuild({ onlyIds: new Set(buildInfo?.failedIds || []) });
  const draftNewMoments = () => runBuild({ onlyIds: new Set(buildTargets.filter((e) => !e.aiDrafted).map((e) => e.id)) });

  const undoMerges = () => {
    if (!mergeUndo) return;
    setEvents((prev) => unmergeEvents(prev, mergeUndo.originals, mergeUndo.keepers));
    setMergeUndo(null);
    setBuildInfo((prev) => (prev ? { ...prev, merged: 0 } : prev));
  };

  const switchToManual = () => {
    setCountdown({ left: null, paused: true });
    setFlow('manual');
    setStage('review');
  };

  // Admins and own-key users (free): the build starts by itself a few seconds after the photos
  // are ready, unless they start typing what the photos are about.
  useEffect(() => {
    if (stage !== 'ready' || !limits.unlimited || countdown.paused || !buildTargets.length) return undefined;
    if (countdown.left == null) {
      setCountdown({ left: 6, paused: false });
      return undefined;
    }
    if (countdown.left <= 0) {
      runBuild();
      return undefined;
    }
    const timer = setTimeout(() => setCountdown((c) => (c.paused || c.left == null ? c : { ...c, left: c.left - 1 })), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, limits.unlimited, countdown, buildTargets.length]);
  const pauseCountdown = () => setCountdown((c) => (c.paused ? c : { left: null, paused: true }));

  // Chapters the story pass named, against the events as they are now.
  const storyChapterRows = useMemo(
    () => (story?.chapters?.length ? storyChaptersToRows(story.chapters, events, lang) : []),
    [story, events, lang],
  );
  const renameStoryChapter = (i, title) => setStory((prev) => {
    if (!prev?.chapters) return prev;
    const chapters = prev.chapters.map((c, k) => (k === i ? { ...c, title } : c));
    return { ...prev, chapters };
  });
  const removeStoryChapter = (i) => setStory((prev) => (prev?.chapters ? { ...prev, chapters: prev.chapters.filter((_, k) => k !== i) } : prev));
  const getOverviewFacts = () => overviewFacts({
    title: storyTitle, kind: storyContext.kind || story?.story_type || '', people: contextPeople,
    events, chapters: storyChapterRows, lang, homeCountry,
  });
  const undraftedCount = flow === 'ai' && (story || buildInfo) ? buildTargets.filter((e) => !e.aiDrafted).length : 0;

  // ---- Apply ----
  const apply = async ({ autoCreate = false } = {}) => {
    if (!included.length) {
      setError(t('photoImport.nothingToAdd'));
      return;
    }
    setError('');
    aiAbortRef.current?.abort();
    buildAbortRef.current?.abort();
    // Google picks older than ~an hour need a fresh token to re-list their photos. Asked here,
    // first thing in the click, because Google's consent popup only opens from a user gesture.
    const stalePicks = googlePicksRef.current.some((pick) => isGooglePickExpired(pick));
    if (stalePicks && googleClientId && googleTokenNeedsRefresh(googleTokenRef.current)) {
      try {
        setGoogleToken(await requestGooglePhotosToken(googleClientId));
      } catch {
        setError(t('photoImport.googleExpired'));
      }
    }
    setStage('applying');
    const sizes = useHosted ? HOSTED_PHOTO_SIZE : PHOTO_SIZES[allocation.size];
    const jobs = [];
    for (const ev of included) {
      const perEvent = allocation.counts.get(ev.id) || 0;
      if (!perEvent) continue;
      const reps = pickRepresentatives(ev.photoIds, metas, perEvent);
      const cover = ev.coverId && ev.photoIds.includes(ev.coverId) ? ev.coverId : reps[0];
      const ordered = [cover, ...reps.filter((x) => x !== cover)].slice(0, perEvent);
      ordered.forEach((pid, i) => jobs.push({ eventId: ev.id, pid, isCover: i === 0 && !ev.attachTo }));
    }
    setApplyProgress({ done: 0, total: jobs.length });
    let doneCount = 0;
    let failedCount = 0;
    let uploadFailures = 0;
    let usedChars = existingChars;
    const encoded = await mapLimit(jobs, useHosted ? HOSTED_PHOTO_UPLOAD_CONCURRENCY : INLINE_PHOTO_ENCODE_CONCURRENCY, async (job) => {
      let url = null;
      const file = filesRef.current.get(job.pid);
      try {
        const spec = job.isCover ? sizes.cover : sizes.gallery;
        url = await encodePhoto(file, { maxDim: spec.dim, maxChars: spec.chars, quality: job.isCover ? 0.8 : 0.76 });
        if (url && useHosted) {
          const ext = url.startsWith('data:image/webp') ? 'webp' : 'jpg';
          try {
            url = (await uploadTimelinePhoto(await dataUrlToBlob(url), `photo.${ext}`)).url;
          } catch {
            // Keep the event's cover inline (small) rather than lose it; gallery photos are skipped.
            uploadFailures += 1;
            url = job.isCover
              ? await encodePhoto(file, { maxDim: PHOTO_SIZES.compact.cover.dim, maxChars: PHOTO_SIZES.compact.cover.chars })
              : null;
          }
        }
      } catch {
        failedCount += 1;
      }
      doneCount += 1;
      if (doneCount % 3 === 0 || doneCount === jobs.length) setApplyProgress({ done: doneCount, total: jobs.length });
      return url;
    });
    const inlineChars = (u) => (typeof u === 'string' && u.startsWith('data:') ? u.length : 0);
    // Real sizes: covers first, then gallery photos while they still fit the budget.
    const byEvent = new Map();
    jobs.forEach((job, i) => {
      if (!encoded[i]) return;
      if (!byEvent.has(job.eventId)) byEvent.set(job.eventId, []);
      byEvent.get(job.eventId).push({ url: encoded[i], isCover: job.isCover });
    });
    // Inline photos must still fit the timeline (hosted ones are just short links).
    for (const list of byEvent.values()) usedChars += inlineChars(list[0]?.url);
    for (const list of byEvent.values()) {
      for (let k = 1; k < list.length; k += 1) {
        const c = inlineChars(list[k].url);
        if (c && usedChars + c > STORAGE_BUDGET_CHARS) list[k].drop = true;
        else usedChars += c;
      }
    }

    let n = 0;
    const newRowId = () => `ph${Date.now().toString(36)}${(n += 1)}`;
    const withCaptions = included.map((e) => ((e.note || '').trim() ? e : { ...e, note: eventCaptions(e, metas).join(' · ') }));
    const { rows, plan } = eventsToMoments(withCaptions, { lang, lane, homeCountry, newRowId, dateDetail, metasById: metas });
    const media = {};
    for (const p of plan) {
      const ev = included.find((e) => e.id === p.eventId);
      const list = (byEvent.get(p.eventId) || []).filter((x) => !x.drop);
      if (!ev) continue;
      media[p.articleId] = {
        kind: p.kind,
        cover: list[0]?.url || null,
        gallery: list.slice(1).map((x) => x.url),
        centroid: ev.centroid,
        photoCount: ev.photoIds.length,
        chars: list.reduce((n, x) => n + inlineChars(x.url), 0),
        ...(p.dates ? { dates: p.dates } : {}),
      };
    }
    // Chapters named by the AI story pass win over the plain trip chapters.
    const chapters = storyChapterRows.length ? storyChapterRows : tripChapters(trips, included, lang, homeCountry);
    const suggestion = suggestBlueprintForImport(included, home, homeCountry);
    const aiAssisted = included.some((e) => e.aiDrafted) || Boolean(story);
    // What the AI shaped (a new timeline only): its title, type, people, lane and overview.
    const aiStory = aiAssisted ? {
      aiAssisted: true,
      ...(buildMode === 'new' ? {
        title: storyTitle.trim(),
        overview: overview.trim(),
        storyType: story?.story_type || '',
        subjectNames: story?.subject_names || [],
        laneTitle: story?.lane_title || '',
      } : {}),
    } : null;
    store.clear();
    releaseGooglePicks();
    onApply?.({ rows, chapters, media, suggestion, failedCount: failedCount + uploadFailures, story: aiStory, autoCreate: Boolean(autoCreate && canCreate) });
  };

  // Back out of the import (asks first once photos have been read in).
  const requestCancel = async () => {
    if (stage === 'applying') return;
    if (metas.size > 0 && !(await confirm({
      body: t('photoImport.discardConfirm'),
      confirmLabel: t('storyStudio.leaveDocsBtn'),
      cancelLabel: t('storyStudio.keepEditing'),
      danger: true,
    }))) return;
    googleAbortRef.current?.abort();
    onCancel();
  };

  // ---- Render ----

  const renderPicker = (compact = false) => (
    <div
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
      onDrop={async (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        addFiles(await filesFromDataTransfer(e.dataTransfer));
      }}
      className={compact ? '' : 'space-y-3'}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={PHOTO_IMPORT_ACCEPT}
        className="hidden"
        data-testid="photo-import-input"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={setFolderInput}
        type="file"
        multiple
        className="hidden"
        data-testid="photo-import-folder-input"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      {compact ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 text-xs font-medium text-accent hover:text-accent-hover px-2 py-1 rounded-control hover:bg-surface-hover cursor-pointer">
            <Upload className="w-3.5 h-3.5" />{t('photoImport.addMore')}
          </button>
          <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-control hover:bg-surface-hover cursor-pointer">
            {t('photoImport.guideLink')}
          </button>
          {googleClientId && (
            <GooglePhotosButton
              compact
              onClick={startGooglePick}
              disabled={googleBusy}
              busy={googleBusy}
              label={t('photoImport.googleConnect')}
            />
          )}
        </span>
      ) : (
        <>
          {/* 1. Files already on this computer / phone (also where a Google Takeout folder goes). */}
          <section className="rounded-panel border-2 border-dashed border-line hover:border-accent/60 bg-surface-sunken/50 p-5 text-center" data-testid="photo-import-device">
            <h3 className="text-sm font-semibold text-ink flex items-center justify-center gap-2">
              <Images className="w-4 h-4 text-accent" />{t('photoImport.sourceDeviceTitle')}
            </h3>
            <p className="text-caption text-ink-muted mt-1">{t('photoImport.dropHere')}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover shadow-sm cursor-pointer" data-testid="photo-import-browse">
                <Upload className="w-4 h-4" />{t('photoImport.browse')}
              </button>
              <button type="button" onClick={() => folderInputRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-control border border-line bg-surface-raised hover:bg-surface-hover text-ink cursor-pointer" data-testid="photo-import-folder">
                <FolderOpen className="w-4 h-4" />{t('photoImport.chooseFolder')}
              </button>
            </div>
            <p className="text-caption text-ink-subtle mt-3">{t('photoImport.dropHint')}</p>
          </section>

          {/* 2. Photos kept in a Google account: Takeout (everything, recommended) or quick connect (dates only).
              The Google Photos logo and name appear only on the official button, never twice. */}
          <section className="rounded-panel border border-line bg-surface-raised p-4 text-start space-y-3" data-testid="photo-import-google-section">
            <h3 className="text-sm font-semibold text-ink">{t('photoImport.sourceGoogleTitle')}</h3>

            <div className="rounded-control border border-accent/40 bg-accent-soft/50 p-3 space-y-2" data-testid="photo-import-takeout">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{t('photoImport.takeoutCardTitle')}</span>
                  <span className="text-caption font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent text-accent-fg">{t('photoImport.recommended')}</span>
                </div>
                <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover shadow-sm cursor-pointer" data-testid="photo-import-guide-link">
                  <BookOpen className="w-4 h-4" />{t('photoImport.guideLink')}
                </button>
              </div>
              <p className="text-caption text-ink-muted leading-snug">{t('photoImport.takeoutHint')}</p>
            </div>

            {googleClientId && (
              <div className="px-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{t('photoImport.quickTitle')}</span>
                  <span className="text-caption text-ink-muted">{t('photoImport.googleHint')}</span>
                </div>
                {renderGoogle({ hint: false })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );

  const renderEventCard = (ev) => {
    const isOpen = expandedId === ev.id;
    const reps = pickRepresentatives(ev.photoIds, metas, Math.min(4, Math.max(1, ev.photoIds.length)));
    const strip = ev.coverId && ev.photoIds.includes(ev.coverId) ? [ev.coverId, ...reps.filter((x) => x !== ev.coverId)].slice(0, 4) : reps;
    const placeholder = defaultEventTitle(ev, lang, homeCountry);
    const label = placeLabel(ev.place, homeCountry);
    const people = eventPeople(ev, metas, 4);
    // Photos dated only by day (file names, typed dates) have no real time to show.
    const times = dateDetail === 'time' && !ev.everydayMonth ? eventTimeDates(ev, metas) : null;
    const timeText = times ? formatTimeRange(times.from, times.to || times.from) : '';
    const attachOptions = existingArticles.filter((a) => a?.from?.day);
    const idx = events.findIndex((e) => e.id === ev.id);
    const hasNext = idx >= 0 && idx < events.length - 1;
    return (
      <li key={ev.id} className={`rounded-panel border transition-colors ${ev.include ? 'border-line bg-surface-raised' : 'border-dashed border-line bg-surface-sunken/40 opacity-70'}`} data-testid="photo-event">
        <div className="flex gap-3 p-3">
          <button type="button" onClick={() => updateEvent(ev.id, { include: !ev.include, includeSource: 'user', setAside: '' })} aria-pressed={ev.include} aria-label={t('photoImport.include')} title={t('photoImport.include')} className="shrink-0 mt-0.5 text-accent cursor-pointer">
            {ev.include ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-ink-subtle" />}
          </button>
          <div className="grid grid-cols-2 gap-0.5 w-20 h-20 shrink-0 rounded-control overflow-hidden">
            {strip.slice(0, 4).map((pid, i) => (
              <LazyThumb key={pid} id={pid} store={store} files={filesRef.current} metas={metas} version={thumbVersion} label={t('photoImport.previewFailed')} className={strip.length === 1 ? 'col-span-2 row-span-2' : (strip.length === 3 && i === 0 ? 'row-span-2' : '')} />
            ))}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ev.title}
                onChange={(e) => updateEvent(ev.id, { title: e.target.value, titleSource: e.target.value.trim() ? 'user' : 'auto' })}
                placeholder={placeholder}
                maxLength={120}
                dir="auto"
                className={`${STUDIO_INPUT_CLASS} flex-1 min-w-0 !py-2`}
                data-testid="photo-event-title"
              />
              {ev.titleSource === 'ai' && <span className="shrink-0 text-caption px-2 py-0.5 rounded-full bg-accent-soft text-accent" title={t('photoImport.aiDraftedBadge')}><Sparkles className="w-3 h-3 inline" /></span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
              <span className="inline-flex items-center gap-1" dir="auto"><Calendar className="w-3 h-3" />{formatDateRange(ev.startWall, ev.endWall, lang)}{timeText && <span dir="ltr"> · {timeText}</span>}</span>
              {label && !ev.placeText && (
                <button type="button" onClick={() => updateEvent(ev.id, { placeText: label })} title={t('photoImport.editPlace')} className="inline-flex items-center gap-1 truncate max-w-[12rem] hover:text-accent cursor-pointer" dir="auto">
                  <MapPin className="w-3 h-3" />{label}
                </button>
              )}
              <span>{t(ev.photoIds.length === 1 ? 'photoImport.photoCountOne' : 'photoImport.photosCount', { count: ev.photoIds.length })}</span>
              {ev.atHome === true && <span className="inline-flex items-center gap-1"><Home className="w-3 h-3" />{t('photoImport.atHomeBadge')}</span>}
              {tripEventIds.has(ev.id) && <span className="inline-flex items-center gap-1 text-accent"><Plane className="w-3 h-3" />{t('photoImport.tripBadge')}</span>}
              {ev.everyday && <span className="text-caption px-2 py-0.5 rounded-full border border-line" title={t('photoImport.everydayHint')}>{t('photoImport.everydayBadge')}</span>}
              {people.length > 0 && <span className="inline-flex items-center gap-1 truncate max-w-[14rem]" dir="auto" title={t('photoImport.peopleTagged')}><Users className="w-3 h-3" />{people.join(', ')}</span>}
              {ev.highlight && ev.include && <span className="inline-flex items-center gap-1 text-accent" data-testid="photo-event-highlight"><Star className="w-3 h-3" />{t('photoImport.aiHighlight')}</span>}
              {ev.category && ev.include && <span className="text-caption px-2 py-0.5 rounded-full border border-line" dir="auto">{ev.category}</span>}
              {!ev.include && ev.setAside && <span className="text-caption px-2 py-0.5 rounded-full border border-warning/50 text-warning" data-testid="photo-event-set-aside" title={t('photoImport.aiSetAsideHint')}>{t(`photoImport.aiSetAside_${ev.setAside}`)}</span>}
            </div>
            {ev.include && ev.occasion && (
              <p className="text-caption text-ink-muted flex flex-wrap items-center gap-2" data-testid="photo-event-occasion">
                <Sparkles className="w-3 h-3 text-accent" />
                <span dir="auto">{t('photoImport.aiOccasion', { occasion: ev.occasion })}</span>
                <button type="button" onClick={() => updateEvent(ev.id, { occasion: '' })} className="hover:text-ink underline cursor-pointer">{t('photoImport.aiOccasionDismiss')}</button>
              </p>
            )}
            {ev.include && !ev.attachTo && (!label || ev.placeText) && (
              <div className="relative">
                <MapPin className="w-3 h-3 text-ink-subtle absolute top-2 start-2 pointer-events-none" />
                <input
                  type="text"
                  value={ev.placeText || ''}
                  onChange={(e) => updateEvent(ev.id, { placeText: e.target.value, placeSource: 'user', placeSuggestion: '' })}
                  placeholder={label || t('photoImport.placeTypePlaceholder')}
                  maxLength={120}
                  dir="auto"
                  className={`${STUDIO_INPUT_CLASS} !py-1 ps-7 text-xs`}
                  data-testid="photo-event-place"
                />
                {ev.placeSource === 'ai' && ev.placeText && (
                  <span className="absolute top-1/2 -translate-y-1/2 end-1.5 inline-flex items-center gap-0.5 text-caption px-2 py-0.5 rounded-full bg-accent-soft text-accent pointer-events-none" title={t('photoImport.placeAiHint')} data-testid="photo-place-ai">
                    <Sparkles className="w-2.5 h-2.5" />{t('photoImport.placeAiBadge')}
                  </span>
                )}
              </div>
            )}
            {ev.include && !ev.attachTo && ev.placeSuggestion && !ev.placeText && (
              <p className="text-caption text-ink-muted flex flex-wrap items-center gap-2" data-testid="photo-place-suggestion">
                <Sparkles className="w-3 h-3 text-accent" />
                <span dir="auto">{t('photoImport.placeSuggest', { place: ev.placeSuggestion })}</span>
                <button type="button" onClick={() => updateEvent(ev.id, { placeText: ev.placeSuggestion, placeSource: 'ai', placeSuggestion: '' })} className="font-semibold text-accent hover:text-accent-hover underline cursor-pointer">{t('photoImport.placeSuggestUse')}</button>
                <button type="button" onClick={() => updateEvent(ev.id, { placeSuggestion: '' })} className="hover:text-ink underline cursor-pointer">{t('photoImport.placeSuggestDismiss')}</button>
              </p>
            )}
            {ev.include && (
              <input
                type="text"
                value={ev.note}
                onChange={(e) => updateEvent(ev.id, { note: e.target.value, noteSource: e.target.value.trim() ? 'user' : 'auto' })}
                placeholder={t(flow === 'ai' ? 'photoImport.aiCaptionPlaceholder' : 'photoImport.notePlaceholder')}
                maxLength={600}
                dir="auto"
                className={`${STUDIO_INPUT_CLASS} !py-1 text-xs`}
                data-testid="photo-event-caption"
              />
            )}
            {ev.include && !ev.attachTo && flow === 'ai' && (ev.story || ev.aiDrafted) && (
              <div className="space-y-1">
                <textarea
                  value={ev.story || ''}
                  onChange={(e) => updateEvent(ev.id, { story: clipStory(e.target.value), storySource: e.target.value.trim() ? 'user' : 'auto' })}
                  placeholder={t('photoImport.aiStoryPlaceholder')}
                  rows={(ev.story || '').length > 220 ? 5 : 3}
                  dir="auto"
                  className={`${STUDIO_INPUT_CLASS} !py-2 text-xs leading-relaxed resize-y`}
                  data-testid="photo-event-story"
                />
                <div className="flex items-center gap-2">
                  {ev.storySource === 'ai' && <span className="text-caption px-2 py-0.5 rounded-full bg-accent-soft text-accent inline-flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />{t('photoImport.aiDraftedBadge')}</span>}
                  <AiPolishButton
                    field="moment_story"
                    value={ev.story || ''}
                    onChange={(v) => updateEvent(ev.id, { story: clipStory(v), storySource: 'user' })}
                    context={[storyTitle || existingTitle, eventTitle(ev, lang, homeCountry), eventPlaceLabel(ev, homeCountry)].filter(Boolean).join(' — ').slice(0, 400)}
                    maxLength={6000}
                    timelineId={timelineId}
                  />
                </div>
              </div>
            )}
            {ev.include && attachOptions.length > 0 && (
              <label className="flex items-center gap-2 text-caption text-ink-muted">
                <span>{t('photoImport.attachLabel')}</span>
                <select value={ev.attachTo || ''} onChange={(e) => updateEvent(ev.id, { attachTo: e.target.value })} className={`${STUDIO_INPUT_CLASS} !py-1 !w-auto max-w-[16rem] text-xs`}>
                  <option value="">{t('photoImport.attachNew')}</option>
                  {attachOptions.map((a) => <option key={a.id} value={String(a.id)}>{a.title}</option>)}
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => { setExpandedId(isOpen ? null : ev.id); setSelected(new Set()); }} className="inline-flex items-center gap-1 text-caption text-accent hover:text-accent-hover px-2 py-0.5 rounded-control hover:bg-surface-hover cursor-pointer">
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3 rtl:rotate-180" />}{isOpen ? t('photoImport.hidePhotos') : t('photoImport.showPhotos')}
              </button>
              {hasNext && (
                <button type="button" onClick={() => doMerge(ev.id)} className="inline-flex items-center gap-1 text-caption text-ink-muted hover:text-ink px-2 py-0.5 rounded-control hover:bg-surface-hover cursor-pointer">
                  <Merge className="w-3 h-3" />{t('photoImport.mergeNext')}
                </button>
              )}
            </div>
          </div>
        </div>
        {isOpen && renderExpanded(ev)}
      </li>
    );
  };

  const renderExpanded = (ev) => {
    const sel = [...selected].filter((pid) => ev.photoIds.includes(pid));
    return (
      <div className="border-t border-line px-3 py-3 space-y-2">
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-caption">
            <span className="text-ink-muted">{t('photoImport.selectedCount', { count: sel.length })}</span>
            {sel.length === 1 && (
              <>
                <button type="button" onClick={() => { updateEvent(ev.id, { coverId: sel[0], coverSource: 'user' }); setSelected(new Set()); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border border-line hover:bg-surface-hover cursor-pointer"><Star className="w-3 h-3" />{t('photoImport.setCover')}</button>
                {ev.photoIds.indexOf(sel[0]) > 0 && (
                  <button type="button" onClick={() => doSplit(ev.id, sel[0])} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border border-line hover:bg-surface-hover cursor-pointer"><Scissors className="w-3 h-3" />{t('photoImport.splitHere')}</button>
                )}
              </>
            )}
            <button type="button" onClick={() => doMove(sel, null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border border-line hover:bg-surface-hover cursor-pointer"><Trash2 className="w-3 h-3" />{t('photoImport.removeSelected')}</button>
            <select value="" onChange={(e) => e.target.value && doMove(sel, e.target.value)} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs`}>
              <option value="">{t('photoImport.moveTo')}</option>
              {events.filter((x) => x.id !== ev.id).map((x) => <option key={x.id} value={x.id}>{eventTitle(x, lang, homeCountry)} · {formatDateRange(x.startWall, x.endWall, lang)}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-5 sm:grid-cols-6 gap-1 max-h-72 overflow-y-auto">
          {ev.photoIds.map((pid) => (
            <button key={pid} type="button" onClick={() => toggleSelected(pid)} aria-pressed={selected.has(pid)} title={metas.get(pid)?.name} className={`relative aspect-square rounded-control overflow-hidden border-2 cursor-pointer ${selected.has(pid) ? 'border-accent' : 'border-transparent'}`}>
              <LazyThumb id={pid} store={store} files={filesRef.current} metas={metas} version={thumbVersion} label={t('photoImport.previewFailed')} className="w-full h-full" />
              {pid === ev.coverId && <span className="absolute bottom-0.5 start-0.5 text-caption px-1 rounded bg-accent text-accent-fg">{t('photoImport.cover')}</span>}
              {selected.has(pid) && <Check className="absolute top-0.5 end-0.5 w-4 h-4 p-0.5 rounded-full bg-accent text-accent-fg" />}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderUnassigned = () => {
    if (!unassignedIds.length) return null;
    return (
      <section className="rounded-panel border border-line bg-surface-sunken/40 p-3 space-y-2" data-testid="photo-unassigned">
        <div>
          <h4 className="text-xs font-semibold text-ink">{t('photoImport.unassignedTitle', { count: unassignedIds.length })}</h4>
          <p className="text-caption text-ink-muted">{t('photoImport.unassignedHint')}</p>
        </div>
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {unassignedIds.slice(0, 200).map((pid) => {
            const m = metas.get(pid);
            return (
              <li key={pid} className="flex items-center gap-2">
                <LazyThumb id={pid} store={store} files={filesRef.current} metas={metas} version={thumbVersion} label={t('photoImport.previewFailed')} className="w-10 h-10 rounded-control shrink-0" />
                <span className="text-caption text-ink-muted truncate flex-1 min-w-0" dir="ltr">{m?.name}</span>
                {m?.time ? (
                  <select value="" onChange={(e) => e.target.value && doMove([pid], e.target.value)} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs max-w-[11rem]`}>
                    <option value="">{t('photoImport.addToEvent')}</option>
                    {events.map((x) => <option key={x.id} value={x.id}>{eventTitle(x, lang, homeCountry)}</option>)}
                  </select>
                ) : (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (giveDate(pid, dateDrafts[pid] || '')) setDateDrafts((d) => ({ ...d, [pid]: '' }));
                    }}
                  >
                    <input type="text" value={dateDrafts[pid] || ''} onChange={(e) => setDateDrafts((d) => ({ ...d, [pid]: e.target.value }))} placeholder={t('photoImport.giveDatePlaceholder')} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-36 text-xs`} aria-label={t('photoImport.giveDate')} />
                    <button type="submit" className="p-1 rounded-control text-accent hover:bg-surface-hover cursor-pointer" aria-label={t('photoImport.giveDate')}><Check className="w-3.5 h-3.5" /></button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  // ---- AI-first renderers ----

  // "What are these photos about?" - shown while the photos are read, so it costs no time.
  const renderContextFields = () => (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-ink">{t('photoImport.aiContextLabel')}</span>
        <textarea
          value={context.text}
          onChange={(e) => { pauseCountdown(); setContext((c) => ({ ...c, text: e.target.value.slice(0, 600) })); }}
          onFocus={pauseCountdown}
          placeholder={t('photoImport.aiContextPlaceholder')}
          rows={2}
          dir="auto"
          className={`${STUDIO_INPUT_CLASS} resize-y text-sm`}
          data-testid="photo-ai-context"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-ink">{t('photoImport.aiPeopleLabel')}</span>
        <input
          type="text"
          value={context.people}
          onChange={(e) => { pauseCountdown(); setContext((c) => ({ ...c, people: e.target.value.slice(0, 300) })); }}
          onFocus={pauseCountdown}
          placeholder={t('photoImport.aiPeoplePlaceholder')}
          dir="auto"
          className={`${STUDIO_INPUT_CLASS} text-sm`}
          data-testid="photo-ai-people"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-ink">{t('photoImport.aiInstructionsLabel')}</span>
        <textarea
          value={context.instructions}
          onChange={(e) => { pauseCountdown(); setContext((c) => ({ ...c, instructions: e.target.value.slice(0, instructionsMax) })); }}
          onFocus={pauseCountdown}
          placeholder={t('photoImport.aiInstructionsPlaceholder')}
          rows={3}
          dir="auto"
          maxLength={instructionsMax}
          className={`${STUDIO_INPUT_CLASS} resize-y text-sm`}
          data-testid="photo-ai-instructions"
        />
        <span className="block text-caption text-ink-subtle text-end">{context.instructions.length.toLocaleString()} / {instructionsMax.toLocaleString()}</span>
      </label>
      <p className="text-caption text-ink-subtle leading-snug">{t('photoImport.aiContextHint')}</p>
    </div>
  );

  const renderCostLine = () => (
    <p className="text-caption text-ink" data-testid="photo-ai-build-cost">
      {limits.unlimited
        ? t('photoImport.aiBuildFree')
        : t(buildEstimate.total === 1 ? 'photoImport.aiBuildCostOne' : 'photoImport.aiBuildCost', { credits: buildEstimate.total })}
      {!limits.unlimited && remaining != null && remaining >= 0 && !buildOverQuota && <> {t('photoImport.aiRemaining', { remaining })}</>}
    </p>
  );

  // Own-key note for limited plans: what the site's key limits, and that a personal key lifts it.
  const renderOwnKeyNote = () => (limits.unlimited ? null : (
    <p className="text-caption text-ink-muted flex items-start gap-2" data-testid="photo-own-key-note">
      <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{t('photoImport.ownKeyNote', {
        photos: limits.max_photos != null ? Number(limits.max_photos).toLocaleString() : '\u221e',
        chars: instructionsMax.toLocaleString(),
      })}</span>
    </p>
  ));

  const renderGroupingScale = () => (
    <div className="space-y-2" data-testid="photo-ai-grouping">
      <div className="space-y-1">
        <span className="text-xs font-semibold text-ink">{t('photoImport.aiGroupingLabel')}</span>
        <div className="flex flex-wrap gap-2" role="group">
          {GROUPING_PRESET_KEYS.map((key) => {
            const n = levelEvents(key);
            const locked = levelLocked(key);
            const credits = levelCredits(key);
            const title = locked
              ? t('photoImport.aiLevelLocked', { credits, remaining })
              : (limits.unlimited ? t('photoImport.aiLevelEvents', { count: n }) : t('photoImport.aiLevelCost', { count: n, credits }));
            return (
              <button
                key={key}
                type="button"
                onClick={() => { pauseCountdown(); changePreset(key); }}
                disabled={locked || !n}
                aria-pressed={preset === key}
                title={title}
                className={`inline-flex items-center gap-2 px-3 py-1 text-xs rounded-full border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${preset === key ? 'border-accent bg-accent-soft text-accent font-semibold' : 'border-line bg-surface-raised text-ink-muted hover:bg-surface-hover'}`}
                data-testid={`photo-level-${key}`}
              >
                {t(`photoImport.preset${key[0].toUpperCase()}${key.slice(1)}`)}
                <span className="tabular-nums opacity-70">{n.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <p className="text-caption text-ink-subtle leading-snug">
          {GROUPING_PRESET_KEYS.some(levelLocked) ? t('photoImport.aiLevelLockedHint') : t('photoImport.aiGroupingHint')}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <span className="font-semibold text-ink">{t('photoImport.dateDetail')}</span>
        <select value={dateDetail} onChange={(e) => { pauseCountdown(); autoTimeRef.current = false; setDateDetail(e.target.value); }} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs`} data-testid="photo-ai-date-detail">
          {DATE_DETAILS.map((d) => <option key={d} value={d}>{t(`photoImport.dateDetail_${d}`)}</option>)}
        </select>
      </label>
    </div>
  );

  const renderReady = () => {
    const places = new Set(events.map((e) => eventPlaceLabel(e, homeCountry)).filter(Boolean)).size;
    return (
      <section className="rounded-panel border border-accent/40 bg-accent-soft/40 p-4 space-y-4" data-testid="photo-ai-ready">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-ink flex items-center gap-2"><Wand2 className="w-4 h-4 text-accent" />{t('photoImport.aiReadyTitle')}</h3>
            <p className="text-sm text-ink-muted mt-0.5" data-testid="photo-ai-found">
              {t('photoImport.aiReadyFound', { moments: buildTargets.length, photos: summary.total })}
              {places > 0 && <> · {t('photoImport.aiReadyPlaces', { count: places })}</>}
            </p>
          </div>
          {renderPicker(true)}
        </div>
        {notices.map((n) => <p key={n} className="text-caption text-ink-muted">{n}</p>)}
        {noPlacesText && <p className="text-caption text-warning flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{noPlacesText}</p>}
        {renderGroupingScale()}
        {renderContextFields()}
        <p className="text-caption text-ink-muted leading-snug">{t('photoImport.aiReadyWhat')}</p>
        {renderCostLine()}
        {renderOwnKeyNote()}
        {buildOverQuota && <p className="text-caption text-warning">{t('photoImport.aiOverQuota', { remaining })}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => runBuild()} disabled={!buildTargets.length} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control disabled:opacity-60 cursor-pointer disabled:cursor-default" data-testid="photo-ai-build">
            <Sparkles className="w-4 h-4" />{t('photoImport.aiBuildBtn')}
          </button>
          {countdown.left != null && !countdown.paused && (
            <span className="text-caption text-ink-muted inline-flex items-center gap-2" data-testid="photo-ai-countdown">
              {t('photoImport.aiCountdown', { seconds: countdown.left })}
              <button type="button" onClick={pauseCountdown} className="underline hover:text-ink cursor-pointer">{t('photoImport.aiCountdownWait')}</button>
            </span>
          )}
          <button type="button" onClick={switchToManual} className="text-sm text-ink-muted hover:text-ink underline cursor-pointer" data-testid="photo-ai-manual">{t('photoImport.aiManual')}</button>
        </div>
        {!buildTargets.length && <p className="text-caption text-ink-muted">{t('photoImport.aiReadyNothing')}</p>}
      </section>
    );
  };

  const renderBuilding = () => {
    const current = build?.stage || 'places';
    const order = ['places', 'moments', 'story', 'overview'].filter((k) => k !== 'overview' || buildMode === 'new');
    const at = order.indexOf(current);
    const label = (k) => {
      if (k === 'places') return geo.running ? t('photoImport.places', { done: geo.done, total: geo.total }) : t('photoImport.aiStagePlaces');
      if (k === 'moments') return k === current && build?.total ? t('photoImport.aiStageMomentsCount', { done: build.done, total: build.total }) : t('photoImport.aiStageMoments');
      return t(k === 'story' ? 'photoImport.aiStageStory' : 'photoImport.aiStageOverview');
    };
    return (
      <section className="rounded-panel border border-accent/40 bg-accent-soft/40 p-4 space-y-3" data-testid="photo-ai-progress" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-accent" />{t('photoImport.aiBuilding')}</h3>
          <button type="button" onClick={stopBuild} className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-control border border-line bg-surface-raised hover:bg-surface-hover cursor-pointer" data-testid="photo-ai-stop">
            <X className="w-3.5 h-3.5" />{t('photoImport.aiStopBuild')}
          </button>
        </div>
        <ol className="space-y-2">
          {order.map((k, i) => (
            <li key={k} className={`flex items-center gap-2 text-sm ${i < at ? 'text-success' : i === at ? 'text-ink font-medium' : 'text-ink-subtle'}`} data-testid={`photo-ai-stage-${k}`}>
              {i < at ? <Check className="w-4 h-4" /> : i === at ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-4 h-4 inline-block rounded-full border border-line" />}
              {label(k)}
            </li>
          ))}
        </ol>
        <p className="text-caption text-ink-muted">{t('photoImport.aiBuildingHint')}</p>
      </section>
    );
  };

  // The top of the AI review: the timeline's title, overview and chapters, and what happened.
  const renderAiSummary = () => {
    const info = buildInfo || {};
    const failed = (info.failedIds || []).filter((id) => events.some((e) => e.id === id && e.include)).length;
    const setAside = events.filter((e) => !e.include && e.setAside).length;
    return (
      <section className="rounded-panel border border-accent/40 bg-surface-raised p-4 space-y-3" data-testid="photo-ai-summary">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" />{t('photoImport.aiReviewTitle')}</h3>
        <p className="text-caption text-ink-muted leading-snug">{t('photoImport.aiReviewHint')}</p>
        {buildMode === 'new' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink">{t('photoImport.aiTimelineTitle')}</span>
            <input type="text" value={storyTitle} onChange={(e) => setStoryTitle(e.target.value.slice(0, 160))} placeholder={t('photoImport.customTitle')} dir="auto" className={`${STUDIO_INPUT_CLASS} text-sm font-medium`} data-testid="photo-ai-title" />
          </label>
        )}
        {buildMode === 'new' && (
          <div className="space-y-1">
            <span className="text-xs font-semibold text-ink">{t('photoImport.aiOverview')}</span>
            <textarea value={overview} onChange={(e) => setOverview(e.target.value.slice(0, 20000))} placeholder={t('photoImport.aiOverviewPlaceholder')} rows={overview ? 7 : 3} dir="auto" className={`${STUDIO_INPUT_CLASS} resize-y text-xs leading-relaxed`} data-testid="photo-ai-overview" />
            <div className="flex flex-wrap items-center gap-2">
              <OverviewDraftButton value={overview} onChange={setOverview} getFacts={getOverviewFacts} canDraft={included.length > 0} timelineId={timelineId} />
              {info.overviewFailed && <span className="text-caption text-warning">{t('photoImport.aiOverviewFailed')}</span>}
            </div>
          </div>
        )}
        {storyChapterRows.length > 0 && (
          <div className="space-y-2" data-testid="photo-ai-chapters">
            <span className="text-xs font-semibold text-ink">{t('photoImport.aiChapters')}</span>
            <ul className="space-y-1">
              {(story?.chapters || []).map((c, i) => {
                const row = storyChapterRows.find((r) => r.key === `story-${i}`);
                if (!row) return null;
                return (
                  <li key={`${i}-${c.first_event_id}`} className="flex items-center gap-2" data-testid="photo-ai-chapter">
                    <input type="text" value={c.title} onChange={(e) => renameStoryChapter(i, e.target.value.slice(0, 60))} dir="auto" className={`${STUDIO_INPUT_CLASS} !py-1 text-xs flex-1 min-w-0`} aria-label={t('photoImport.aiChapters')} />
                    <span className="text-caption text-ink-muted whitespace-nowrap" dir="auto">{row.from}{row.to !== row.from ? ` – ${row.to}` : ''}</span>
                    <button type="button" onClick={() => removeStoryChapter(i)} className="p-1 rounded-control text-ink-subtle hover:text-danger hover:bg-surface-hover cursor-pointer" aria-label={t('photoImport.aiChapterRemove')} title={t('photoImport.aiChapterRemove')}><X className="w-3.5 h-3.5" /></button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="space-y-1 text-caption">
          {info.merged > 0 && mergeUndo && (
            <p className="text-ink-muted flex flex-wrap items-center gap-2" data-testid="photo-ai-merged">
              <Merge className="w-3 h-3" />{t('photoImport.aiMerged', { count: info.merged })}
              <button type="button" onClick={undoMerges} className="inline-flex items-center gap-0.5 underline hover:text-ink cursor-pointer" data-testid="photo-ai-undo-merges"><Undo2 className="w-3 h-3" />{t('photoImport.aiUndo')}</button>
            </p>
          )}
          {setAside > 0 && <p className="text-ink-muted">{t('photoImport.aiSetAsideCount', { count: setAside })}</p>}
          {info.stopped && <p className="text-ink-muted">{t('photoImport.aiStoppedNote')}</p>}
          {info.storyFailed && <p className="text-warning">{t('photoImport.aiStoryFailed')}</p>}
          {info.error && <p className="text-danger" data-testid="photo-ai-error">{info.error}</p>}
          {(failed > 0 || undraftedCount > 0) && (
            <p className="text-warning flex flex-wrap items-center gap-2" data-testid="photo-ai-retry-note">
              {failed > 0 ? t('photoImport.aiFailedCount', { count: failed }) : t('photoImport.aiUndraftedCount', { count: undraftedCount })}
              <button type="button" onClick={failed > 0 ? retryFailed : draftNewMoments} className="inline-flex items-center gap-0.5 font-semibold underline text-accent hover:text-accent-hover cursor-pointer" data-testid="photo-ai-retry"><RefreshCw className="w-3 h-3" />{t('photoImport.aiRetry')}</button>
            </p>
          )}
          {info.credits > 0 && <p className="text-ink-subtle">{t('photoImport.aiCreditsUsed', { credits: info.credits })}</p>}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5" data-testid="photo-import">
      <GooglePhotosGuide open={guideOpen} onClose={closeGuide} canConnect={Boolean(googleClientId)} />
      <div>
        <button type="button" onClick={requestCancel} disabled={stage === 'applying'} className="inline-flex items-center gap-1 -ms-2 mb-2 px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover disabled:opacity-40 cursor-pointer" data-testid="photo-import-back">
          {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}{t(backLabelKey)}
        </button>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight text-ink">{t('photoImport.panelTitle')}</h2>
        <p className="text-sm text-ink-muted mt-1 leading-relaxed">{t('photoImport.panelSubtitle')}</p>
      </div>

      {stage === 'pick' && (
        <>
          {renderPicker()}
          {phoneTip && <p className="text-caption text-ink flex items-start gap-2 rounded-control bg-accent-soft/60 p-2" data-testid="photo-import-phone-tip"><MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent" />{phoneTip}</p>}
          <p className="text-caption text-ink-subtle flex items-start gap-2"><ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-success" />{t('photoImport.privacy')}</p>
        </>
      )}

      {stage === 'reading' && (
        <div className="flex items-center gap-2 text-sm text-ink-muted py-6 justify-center" data-testid="photo-import-reading">
          <Loader2 className="w-4 h-4 animate-spin" />{t('photoImport.reading', { done: readProgress.done, total: readProgress.total })}
        </div>
      )}
      {stage === 'reading' && flow === 'ai' && !story && !buildInfo && (
        <section className="rounded-panel border border-line bg-surface-sunken/50 p-4">{renderContextFields()}</section>
      )}

      {stage === 'ready' && renderReady()}

      {stage === 'building' && (
        <>
          {renderBuilding()}
          {visible.length > 0 && <ul className="space-y-2" data-testid="photo-events">{visible.map(renderEventCard)}</ul>}
        </>
      )}

      {stage === 'applying' && (
        <div className="flex items-center gap-2 text-sm text-ink-muted py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />{t('photoImport.applying', { done: applyProgress.done, total: applyProgress.total })}
        </div>
      )}

      {stage === 'review' && (
        <>
          <div className="rounded-panel border border-line bg-surface-sunken/50 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink" data-testid="photo-import-summary">
                {t('photoImport.found', { total: summary.total, dated: summary.dated, gps: summary.withGps })}
                {summary.undated > 0 && <> · {t('photoImport.foundUndated', { count: summary.undated })}</>}
              </p>
              {renderPicker(true)}
            </div>
            {summary.fromFilename > 0 && <p className="text-caption text-ink-muted">{t('photoImport.fromFilename', { count: summary.fromFilename })}</p>}
            {summary.fromTakeout > 0 && <p className="text-caption text-ink-muted">{t('photoImport.fromTakeout', { count: summary.fromTakeout })}</p>}
            {summary.fromGoogle > 0 && <p className="text-caption text-ink-muted">{t('photoImport.fromGoogle', { count: summary.fromGoogle })}</p>}
            {googleClientId && (google.state !== 'idle' || google.note || google.error) && (
              <div className="space-y-1" data-testid="photo-import-google-status">
                <div className="flex flex-wrap items-center gap-2">{renderGoogleStatus()}</div>
                {google.note && <p className="text-caption text-ink-muted">{google.note}</p>}
                {google.error && <p className="text-caption text-danger">{google.error}</p>}
              </div>
            )}
            {noPlacesText && (
              <p className="text-caption text-warning flex items-start gap-2" data-testid="photo-import-no-places"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{noPlacesText}</p>
            )}
            {notices.map((n) => <p key={n} className="text-caption text-ink-muted">{n}</p>)}
            {geo.running && <p className="text-caption text-ink-muted inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t('photoImport.places', { done: geo.done, total: geo.total })}</p>}
            {!geo.running && geo.failed && <p className="text-caption text-ink-muted">{t('photoImport.placesFailed')}</p>}
            {!geo.running && geo.capped && limits.max_places != null && <p className="text-caption text-ink-muted">{t('photoImport.placesCapped', { max: limits.max_places })}</p>}
          </div>

          {flow === 'ai' && (story || buildInfo) && renderAiSummary()}
          {flow === 'ai' && !story && !buildInfo && (
            <section className="rounded-panel border border-accent/40 bg-accent-soft/40 p-3 flex flex-wrap items-center gap-3" data-testid="photo-ai-offer">
              <p className="text-caption text-ink flex-1 min-w-[12rem]">{t('photoImport.aiOfferManual')}</p>
              {renderCostLine()}
              <button type="button" onClick={() => runBuild()} disabled={!buildTargets.length} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 cursor-pointer" data-testid="photo-ai-build">
                <Sparkles className="w-3.5 h-3.5" />{t('photoImport.aiBuildBtn')}
              </button>
            </section>
          )}

          <details className="group rounded-panel border border-line bg-surface-sunken/30 open:bg-transparent" open={flow !== 'ai' || undefined} data-testid="photo-adjust">
          {flow === 'ai' && (
            <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" />{t('photoImport.aiAdjust')}
            </summary>
          )}
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${flow === 'ai' ? 'px-3 pb-3' : ''}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ink-muted">{t('photoImport.grouping')}</span>
              <div className="inline-flex rounded-control border border-line overflow-hidden" role="group">
                {GROUPING_PRESET_KEYS.map((key) => (
                  <button key={key} type="button" onClick={() => changePreset(key)} aria-pressed={preset === key} className={`px-3 py-1 text-xs cursor-pointer ${preset === key ? 'bg-accent-soft text-accent font-semibold' : 'text-ink-muted hover:bg-surface-hover'}`} data-testid={`photo-preset-${key}`}>
                    {t(`photoImport.preset${key[0].toUpperCase()}${key.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              {t('photoImport.dateDetail')}
              <select value={dateDetail} onChange={(e) => { autoTimeRef.current = false; setDateDetail(e.target.value); }} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs`} data-testid="photo-date-detail">
                {DATE_DETAILS.map((d) => <option key={d} value={d}>{t(`photoImport.dateDetail_${d}`)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              {t('photoImport.photosPerEvent')}
              <select value={photosPerEvent} onChange={(e) => setPhotosPerEvent(Number(e.target.value))} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs`}>
                {PHOTOS_PER_EVENT_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? t('photoImport.photosAll') : n}</option>)}
              </select>
            </label>
            {laneOptions.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                {t('photoImport.laneLabel')}
                <select value={lane} onChange={(e) => setLane(e.target.value)} className={`${STUDIO_INPUT_CLASS} !py-0.5 !w-auto text-xs`}>
                  {laneOptions.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
            )}
          </div>
          </details>

          {flow === 'manual' && (
          <section className="rounded-panel border border-accent/30 bg-accent-soft/40 p-3 space-y-2" data-testid="photo-ai">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              <h4 className="text-xs font-semibold text-ink flex-1">{t('photoImport.aiTitle')}</h4>
              {ai.running ? (
                <button type="button" onClick={() => aiAbortRef.current?.abort()} className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-control border border-line bg-surface-raised hover:bg-surface-hover cursor-pointer">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />{t('photoImport.aiStop')}
                </button>
              ) : (
                <button type="button" onClick={runAi} disabled={!draftTargets.length} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 cursor-pointer disabled:cursor-default" data-testid="photo-ai-run">
                  <Sparkles className="w-3.5 h-3.5" />{ai.message ? t('photoImport.aiBtnRedo') : t('photoImport.aiBtn')}
                </button>
              )}
            </div>
            <p className="text-caption text-ink-muted leading-snug">{t('photoImport.aiHint')}</p>
            <p className="text-caption text-ink" data-testid="photo-ai-cost">
              {draftTargets.length === 0
                ? t('photoImport.aiNothing')
                : limits.unlimited
                  ? t('photoImport.aiCostUnlimited', { events: draftTargets.length })
                  : t(draftCredits === 1 ? 'photoImport.aiCostOne' : 'photoImport.aiCost', { events: draftTargets.length, credits: draftCredits })}
              {!limits.unlimited && remaining != null && remaining >= 0 && !overQuota && <> {t('photoImport.aiRemaining', { remaining })}</>}
            </p>
            {overQuota && <p className="text-caption text-warning">{t('photoImport.aiOverQuota', { remaining })}</p>}
            {events.some((e) => e.include && !e.attachTo && e.titleSource === 'user') && (
              <label className="flex items-center gap-2 text-caption text-ink-muted cursor-pointer">
                <input type="checkbox" checked={aiIncludeNamed} onChange={(e) => setAiIncludeNamed(e.target.checked)} />{t('photoImport.aiIncludeNamed')}
              </label>
            )}
            {ai.running && <p className="text-caption text-ink-muted">{t('photoImport.aiRunning', { done: ai.done, total: ai.total })}</p>}
            {!ai.running && ai.message && <p className="text-caption text-success">{ai.message}</p>}
            {ai.error && <p className="text-caption text-danger">{ai.error}</p>}
          </section>
          )}

          {visible.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('photoImport.noPhotosYet')}</p>
          ) : (
            <ul className="space-y-2" data-testid="photo-events">
              {visible.map(renderEventCard)}
            </ul>
          )}
          {renderUnassigned()}
        </>
      )}

      {(stage === 'review' || stage === 'applying') && (
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t border-line bg-surface-raised space-y-2">
          {error && <p className="text-caption text-danger flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}</p>}
          <div className={`flex gap-3 ${flow === 'ai' && canCreate && (story || buildInfo) ? 'flex-wrap items-center' : 'items-center'}`}>
            <button type="button" onClick={requestCancel} disabled={stage === 'applying'} className="px-3 py-2 text-sm text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover disabled:opacity-40 cursor-pointer">
              {t('photoImport.cancel')}
            </button>
            <div className={flow === 'ai' && canCreate && (story || buildInfo) ? 'order-first basis-full min-w-0' : 'flex-1 min-w-0'}>
              <p className="text-caption truncate text-ink-muted" data-testid="photo-storage">
                {useHosted
                  ? (hostedPlan.quota == null
                    ? t('photoImport.storageHostedUnlimited', { kept: keptPhotos, total: includedPhotos })
                    : t('photoImport.storageHosted', { kept: keptPhotos, total: includedPhotos, used: (hostedPlan.used || 0) + keptPhotos, quota: hostedPlan.quota }))
                  : t('photoImport.storageKept', { kept: keptPhotos, total: includedPhotos, mb: fmtMb(existingChars + storageChars), max: fmtMb(STORAGE_BUDGET_CHARS) })}
              </p>
              {hostedFull && <p className="text-caption text-warning">{t('photoImport.storageHostedFull', { quota: hostedPlan.quota })}</p>}
              {!hostedPlan.enabled && <p className="text-caption text-ink-muted">{t('photoImport.storageSignIn')}</p>}
              {allocation.coverless > 0
                ? <p className="text-caption text-warning">{t('photoImport.storageCoverless', { count: allocation.coverless })}</p>
                : reduced && <p className="text-caption text-ink-muted">{t('photoImport.storageReduced')}</p>}
            </div>
            {flow === 'ai' && canCreate && (story || buildInfo) ? (
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => apply()} disabled={stage === 'applying' || !included.length} className="px-3 py-2 text-sm font-medium text-ink hover:text-accent rounded-control border border-line bg-surface-raised hover:bg-surface-hover disabled:opacity-60 cursor-pointer disabled:cursor-default" data-testid="photo-import-apply">
                  {t('photoImport.aiFineTune')}
                </button>
                <button type="button" onClick={() => apply({ autoCreate: true })} disabled={stage === 'applying' || !included.length} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control disabled:opacity-60 cursor-pointer disabled:cursor-default" data-testid="photo-ai-create">
                  {stage === 'applying' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('photoImport.aiCreate')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => apply()} disabled={stage === 'applying' || !included.length} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control disabled:opacity-60 cursor-pointer disabled:cursor-default" data-testid="photo-import-apply">
                {stage === 'applying' && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('photoImport.applyBtn', { count: included.length })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
