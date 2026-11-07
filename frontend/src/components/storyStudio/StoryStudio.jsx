import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, User, Heart, Baby, Network, Plane, Briefcase, Flower2, Sparkles, Plus, Trash2, EyeOff, RotateCcw, Images,
  ArrowLeft, ArrowRight, BookUser, ShieldCheck, Loader2, MapPin, Check, AlertTriangle, Maximize2, Minimize2, RefreshCw,
  FileText, BookOpen,
} from '../icons/ThemeIcons';
import StorySpine from './StorySpine';
import { useStudioConfirm, useUndoToast, StudioConfirmProvider } from './StudioFeedback';
import { useLanguage } from '../../context/LanguageContext';
import AiPolishButton from '../AiPolishButton';
import useStoryDraft from '../../hooks/useStoryDraft';
import useModalFocusTrap from '../../hooks/useModalFocusTrap';
import {
  STORY_BLUEPRINTS, getStoryBlueprint, buildStoryTimeline, computeAutoChapters, emptyStoryAnswers,
  resolvePeopleNames, fillTemplate, pickLang, withoutEmptyStoryLanes, STORY_OCCASIONS, storyOccasion,
} from '../../data/storyBlueprints';
import { searchGeocodeCandidates, fetchPhotoImportLimits } from '../../api';
import {
  timelineToStoryAnswers, applyStoryToTimeline, storyOverviewFacts, applyEventEditToAnswers, removeStoryRow, applyEventExtras,
  findStoryRow,
} from '../../data/storyStudioSync';
import OverviewDraftButton from './OverviewDraftButton';
import FuzzyDateInput, { STUDIO_INPUT_CLASS } from './FuzzyDateInput';
import StudioCanvasPreview from './StudioCanvasPreview';
import PhotoImportPanel from './PhotoImportPanel';
import DocumentImportPanel from './DocumentImportPanel';
import { isPhotoImportEnabled, isPhotoAiFirstEnabled, isBookImportEnabled } from '../../utils/featureFlags';
import { fetchBookImportLimits } from '../../api';
import { applyPhotoMedia } from '../../utils/photoImport/importModel';
import { photoImportBlueprint, photoStoryAnswers } from '../../utils/photoImport/autoBuild';

// Book import (long books, scans, page photos): its own screens, loaded only when used.
const BookImportFlow = lazy(() => import('../bookImport/BookImportFlow'));

const BLUEPRINT_ICONS = { User, Heart, Baby, Network, Plane, Briefcase, Flower2, Sparkles };
const MAX_GEOCODE_PLACES = 15;
const GEOCODE_TIMEOUT_MS = 6000;
const newRowId = () => Math.random().toString(36).slice(2, 9);

const formatYearRange = (fromDec, toDec) => {
  const a = Math.floor(fromDec);
  const b = Math.floor(toDec);
  return a === b ? `${a}` : `${a} – ${b}`;
};

/**
 * Best-effort: look up coordinates for each distinct new place so events land on the map.
 * `cache` (Map of "lang|place" -> hit or null) is shared by the preview map and Create/Save,
 * so a place is looked up once per Studio session. Timeouts and errors are not cached.
 */
async function geocodeArticles(articles, lang, cache = null) {
  const needsCoords = (a) => a.locationName && (a.lat == null || a.lng == null);
  const cacheKey = (place) => `${lang || ''}|${place}`;
  const coords = {};
  const places = [];
  for (const place of new Set(articles.filter(needsCoords).map((a) => a.locationName))) {
    if (cache?.has(cacheKey(place))) {
      const hit = cache.get(cacheKey(place));
      if (hit) coords[place] = hit;
    } else {
      places.push(place);
    }
  }
  const queue = places.slice(0, MAX_GEOCODE_PLACES);
  const worker = async () => {
    while (queue.length) {
      const place = queue.shift();
      try {
        const TIMED_OUT = Symbol('timeout');
        const results = await Promise.race([
          searchGeocodeCandidates(place, lang),
          new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), GEOCODE_TIMEOUT_MS)),
        ]);
        if (results === TIMED_OUT) continue;
        const first = Array.isArray(results) ? results[0] : null;
        const hit = first && Number.isFinite(first.lat) && Number.isFinite(first.lng) ? first : null;
        if (hit) coords[place] = hit;
        cache?.set(cacheKey(place), hit);
      } catch {
        // A place that can't be found simply stays off the map; the user can pin it later.
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return articles.map((a) => {
    const hit = needsCoords(a) && coords[a.locationName];
    if (!hit) return a;
    return { ...a, lat: hit.lat, lng: hit.lng, googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${hit.lat},${hit.lng}` };
  });
}

// Sub-heading inside a Studio section (e.g. "Lanes", "Chapters" under "Chapters and a name").
function SectionTitle({ children, hint }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-ink">{children}</h3>
      {hint && <p className="text-sm text-ink-muted leading-relaxed mt-1">{hint}</p>}
    </div>
  );
}

// Short context for AI polish requests, per occasion (the overview draft sends the key itself).
const OCCASION_CONTEXT = {
  keepsake: 'a personal keepsake',
  gift: 'a gift for the person it is about',
  family: 'to share with the whole family',
  memorial: 'in memory of someone who has died',
};

// Heading of a guided section: crisp, warm, unified system typography and a short human intro.
function SectionHeader({ title, intro, aside = null }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight text-ink text-balance">{title}</h2>
      {intro && <p className="mt-2 text-base text-ink-muted leading-relaxed max-w-prose">{intro}</p>}
      {aside}
    </div>
  );
}

function IconButton({ onClick, label, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-11 h-11 text-ink-subtle hover:text-danger rounded-control hover:bg-surface-hover transition-colors duration-150 shrink-0 cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}

// Quiet text button used for "Add a moment", "Add notes" and similar inline actions.
const LINK_BUTTON_CLASS = 'inline-flex items-center gap-2 min-h-11 -ms-2 px-2 rounded-control text-sm font-medium text-accent hover:text-accent-hover hover:bg-surface-hover transition-colors duration-150 cursor-pointer';
// Dashed "add another" button: the invitation to keep going.
const ADD_BUTTON_CLASS = 'w-full inline-flex items-center justify-center gap-2 h-12 px-4 rounded-panel border border-dashed border-line-input text-sm font-medium text-ink-muted hover:text-accent hover:border-accent hover:bg-accent-soft/40 transition-colors duration-150 cursor-pointer';
// Delay before the real canvas catches up with the form (it is too heavy to rebuild per keystroke).
const CANVAS_AUTO_APPLY_MS = 900;

const prefersReducedMotion = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const answersHaveContent = (a) => Boolean(a && (
  Object.values(a.people || {}).some((v) => (v || '').trim())
  || Object.values(a.anchors || {}).some((x) => (x?.date || '').trim() || (x?.place || '').trim())
  || (a.moments || []).some((m) => (m.title || '').trim() || (m.date || '').trim())
));

// Matches Tailwind's `lg` breakpoint, where the canvas sits beside the form.
const LARGE_QUERY = '(min-width: 1024px)';
function useIsLargeViewport() {
  const [isLarge, setIsLarge] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(LARGE_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(LARGE_QUERY);
    const update = () => setIsLarge(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);
  return isLarge;
}

// Details kept on an event that the form doesn't show (its notes and story text are in the form).
const hasRichDetails = (a) => Boolean(a && (a.imageUrl || a.additionalImages?.length || a.videos?.length));
const STORY_MAX = 6000;
const NOTE_MAX = 280;

/**
 * Story Studio - the guided personal-timeline builder (steps 1-2 of the spec:
 * choose a story type, then answer the frame). Everything here runs locally and costs
 * no AI credits.
 *
 * Create mode: the result is handed to onCreate as a normal personal TimelineData.
 * Edit mode (editTimeline set): the timeline is read back into the form, and "Save changes"
 * merges the edits into it via onSave(nextTimeline, { removedEventIds }) - photos, stories and
 * other details added outside the Studio are kept.
 */
export default function StoryStudio({
  isOpen, onClose, onCreate, onSave, onGenerateFromDocuments, onOpenTimeline, initialName = '', initialStart = null, editTimeline = null, theme = 'light',
}) {
  const { t, language, isRtl } = useLanguage();
  const lang = language === 'he' ? 'he' : 'en';
  const { draft, setDraft, clearDraft, savedAt } = useStoryDraft(isOpen);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showHiddenChapters, setShowHiddenChapters] = useState(false);
  // The canvas pane can be expanded to fill the Studio (the only way to see it on small screens).
  const [isCanvasView, setIsCanvasView] = useState(false);
  // What the canvas currently shows: a snapshot taken on "Apply" (or at natural moments such as
  // picking a story or finishing a photo import), so the real canvas is not rebuilt per keystroke.
  // { timeline, blueprintKey, answers, media, photoRows }
  const [canvasSnap, setCanvasSnap] = useState(null);
  // Place lookups shared by the preview map and Create/Save (see geocodeArticles).
  const geocodeCacheRef = useRef(new Map());
  const geocodePreview = useCallback(
    (articles) => geocodeArticles(articles, lang, geocodeCacheRef.current),
    [lang]
  );
  const containerRef = useModalFocusTrap(isOpen);
  // Start from documents: the open panel ({ tab, context }) and the timeline the AI extracted.
  // That timeline is reviewed here like one being edited, then created on "Create".
  const [docPanel, setDocPanel] = useState(null);
  const [docTimeline, setDocTimeline] = useState(null);
  const isEditing = Boolean(editTimeline);
  const isFromDocs = !isEditing && Boolean(docTimeline);
  // The timeline the form is read from and merged back into (edit mode, or the AI extraction).
  const baseTimeline = editTimeline || docTimeline;
  const hasBase = Boolean(baseTimeline);
  // A based Studio keeps its working copy in memory: { blueprintKey, answers, dirty }.
  const [edit, setEdit] = useState(null);
  // Photo import: the open panel ({ fromStart }) and the encoded photos waiting to be attached
  // to their events on Create / Save ({ [articleId]: media }). Photos are too big for the
  // localStorage draft, so they live only in this session.
  const [photoPanel, setPhotoPanel] = useState(null);
  const [photoMedia, setPhotoMedia] = useState({});
  const [photoNotice, setPhotoNotice] = useState('');
  const [photoPreviewRows, setPhotoPreviewRows] = useState(null);
  // True while the AI-first import is writing: the canvas follows the drafts as they land.
  const [photoLive, setPhotoLive] = useState(false);
  const photoImportOn = isPhotoImportEnabled();
  const photoAiFirst = photoImportOn && isPhotoAiFirstEnabled();
  // Book import: the import being followed ({ id }) and unfinished imports to continue.
  const bookImportOn = isBookImportEnabled() && !editTimeline;
  const [bookImport, setBookImport] = useState(null);
  const [activeBookImports, setActiveBookImports] = useState([]);
  // Unfinished imports (any device) offered as "Continue" on the start step.
  useEffect(() => {
    if (!isOpen || !bookImportOn || bookImport) return undefined;
    let cancelled = false;
    fetchBookImportLimits().then((limits) => { if (!cancelled) setActiveBookImports(limits?.enabled ? (limits.active || []) : []); });
    return () => { cancelled = true; };
  }, [isOpen, bookImportOn, bookImport]);
  // Details edited in the preview's event drawer that the form doesn't hold (photos, category,
  // links, picked coordinates...): { [articleId]: extras }. Session-only, like imported photos.
  const [eventExtras, setEventExtras] = useState({});
  // Bumped by edits made inside the preview so the canvas refreshes right away.
  const [previewEditTick, setPreviewEditTick] = useState(0);
  // Asks the preview to open its Overview panel ("Show the overview" in the form).
  const [overviewRequest, setOverviewRequest] = useState(0);
  // Rows whose notes area was opened or closed by hand (rows with notes start open).
  const [openNotes, setOpenNotes] = useState({});
  // The guided section shown in the frame step. Creating: kept in the draft (survives a refresh);
  // editing or reviewing a document draft: kept in memory.
  const [baseSection, setBaseSection] = useState(null);
  // "Next" was pressed without the name the questions are written around.
  const [whoError, setWhoError] = useState(false);
  // Row to bring into view once its section is on screen (from a spine dot): 'a-<anchor>' | 'm-<row>'.
  const [scrollTarget, setScrollTarget] = useState(null);
  // "Welcome back" when the Studio reopens in the middle of a story.
  const [showWelcome, setShowWelcome] = useState(false);
  const welcomeCheckRef = useRef(true);
  const formScrollRef = useRef(null);
  const nameInputRef = useRef(null);
  const [confirm, confirmElement] = useStudioConfirm();
  const undoToast = useUndoToast({ undoLabel: t('storyStudio.undo'), dismissLabel: t('storyStudio.dismiss') });

  useEffect(() => {
    if (!isOpen || !baseTimeline) {
      setEdit(null);
      return;
    }
    const { blueprint: bp, answers: a } = timelineToStoryAnswers(baseTimeline, { lang });
    setEdit({ blueprintKey: bp.key, answers: a, dirty: false });
    // Re-read only when a different timeline is opened; a language switch keeps the working copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, baseTimeline]);

  const blueprint = getStoryBlueprint(hasBase ? edit?.blueprintKey : draft.blueprintKey);
  const answers = useMemo(() => {
    if (!blueprint) return null;
    if (hasBase) return edit?.answers || null;
    return draft.answersByBlueprint[blueprint.key] || emptyStoryAnswers(blueprint, { initialName });
  }, [blueprint, hasBase, edit, draft.answersByBlueprint, initialName]);
  const existingById = useMemo(
    () => new Map((baseTimeline?.articles || []).map((a) => [String(a.id), a])),
    [baseTimeline],
  );

  const built = useMemo(() => {
    if (!blueprint || !answers) return null;
    try {
      return buildStoryTimeline(blueprint, answers, { lang, id: 'preview' });
    } catch {
      return null;
    }
  }, [blueprint, answers, lang]);

  // The timeline the canvas would show right now: when editing, the merged result (keeps the
  // event photos and stories); when creating, the freshly built timeline; with the imported
  // photos attached either way. While the photo panel is open it also includes the photo
  // moments under review (on the current story, or a plain one when starting from photos).
  // Only called on Apply - never per keystroke.
  const photoRowsInView = photoPanel ? photoPreviewRows : null;
  const computeCanvasTimeline = () => {
    try {
      if (photoRowsInView) {
        const fromStart = photoPanel.fromStart && !hasBase;
        const bp = fromStart || !blueprint ? getStoryBlueprint('custom') : blueprint;
        const base = fromStart || !answers ? emptyStoryAnswers(bp) : answers;
        const { timeline } = buildStoryTimeline(bp, { ...base, moments: [...(base.moments || []), ...photoRowsInView] }, { lang, id: 'preview' });
        return { ...withoutEmptyStoryLanes(timeline, bp), articles: applyEventExtras(applyPhotoMedia(timeline.articles, photoMedia), eventExtras) };
      }
      if (!blueprint || !answers || !built) return null;
      const timeline = withoutEmptyStoryLanes(hasBase ? applyStoryToTimeline(baseTimeline, blueprint, answers, { lang }).timeline : built.timeline, blueprint);
      return { ...timeline, articles: applyEventExtras(applyPhotoMedia(timeline.articles, photoMedia), eventExtras) };
    } catch {
      return built?.timeline || null;
    }
  };
  const applyCanvas = () => setCanvasSnap({
    timeline: computeCanvasTimeline(),
    blueprintKey: blueprint?.key || null,
    answers,
    media: photoMedia,
    extras: eventExtras,
    photoRows: photoRowsInView,
    lang,
  });
  const isCanvasStale = !canvasSnap
    || canvasSnap.blueprintKey !== (blueprint?.key || null)
    || canvasSnap.answers !== answers
    || canvasSnap.media !== photoMedia
    || canvasSnap.extras !== eventExtras
    || canvasSnap.photoRows !== photoRowsInView
    || canvasSnap.lang !== lang;
  const applyCanvasRef = useRef(applyCanvas);
  applyCanvasRef.current = applyCanvas;
  const isCanvasStaleRef = useRef(isCanvasStale);
  isCanvasStaleRef.current = isCanvasStale;

  const step = hasBase || (blueprint && draft.step === 'frame') ? 'frame' : 'story';
  const isLargeViewport = useIsLargeViewport();
  // The canvas sits beside the form once there is a story to show (or photos/documents under review);
  // the story picker gets the full width. Mounted only while actually on screen.
  const showCanvasPane = (step === 'frame' || Boolean(photoPanel)) && !bookImport && !docPanel;
  const canvasVisible = isCanvasView || (showCanvasPane && isLargeViewport);
  const hasEvents = Boolean(built?.stats?.events);
  const snapHasEvents = Boolean(canvasSnap?.timeline?.articles?.length);
  // Apply automatically at natural moments: opening, picking a story, changing step, a photo
  // import landing (or the panel closing), expanding the canvas, and the very first event.
  useEffect(() => {
    if (!isOpen) {
      setCanvasSnap(null);
      return;
    }
    if (isCanvasStaleRef.current) applyCanvasRef.current();
  }, [isOpen, blueprint?.key, step, photoMedia, Boolean(photoPanel), canvasVisible, lang, hasEvents && !snapHasEvents, previewEditTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isOpen && photoLive && photoPreviewRows) applyCanvasRef.current();
  }, [isOpen, photoLive, photoPreviewRows]);
  // When the build ends, show its last drafts too (the panel sends rows ~150 ms after a change).
  const photoLiveRef = useRef(false);
  useEffect(() => {
    const wasLive = photoLiveRef.current;
    photoLiveRef.current = photoLive;
    if (!isOpen || photoLive || !wasLive) return undefined;
    const timer = setTimeout(() => applyCanvasRef.current(), 300);
    return () => clearTimeout(timer);
  }, [isOpen, photoLive]);

  const names = useMemo(() => (blueprint ? resolvePeopleNames(blueprint, answers, lang) : {}), [blueprint, answers, lang]);
  const autoChapters = useMemo(
    () => (blueprint ? computeAutoChapters(blueprint, answers, { lang, names }) : []),
    [blueprint, answers, lang, names],
  );

  // ---- Guided sections of the frame step ----
  // Who → Key moments → More moments → Chapters & name → Finish. Sections a story type has no
  // content for are skipped (a blank canvas has no key moments). All answers stay in one form
  // model, so moving between sections never loses anything.
  const sections = useMemo(() => {
    if (!blueprint) return [];
    const list = [];
    if (blueprint.people.length || blueprint.customLanes) {
      list.push({ key: 'who', label: t(blueprint.people.length ? 'storyStudio.secWho' : 'storyStudio.secWhoCustom') });
    }
    if (blueprint.anchors.length) list.push({ key: 'moments', label: t('storyStudio.secMoments') });
    list.push(
      { key: 'more', label: t('storyStudio.secMore') },
      { key: 'chapters', label: t('storyStudio.secChapters') },
      { key: 'finish', label: t('storyStudio.secFinish') },
    );
    return list;
  }, [blueprint, t]);
  // A reviewed document draft opens on its moments; everything else starts at the beginning.
  const requestedSection = (hasBase ? baseSection : draft.section) || (isFromDocs ? 'more' : null);
  const sectionIndex = Math.max(0, sections.findIndex((s) => s.key === requestedSection));
  const section = sections[sectionIndex]?.key || null;
  const isLastSection = sectionIndex === sections.length - 1;

  // The questions are written around the first person's name, so it is asked for first.
  const firstPerson = blueprint?.people?.[0];
  const nameMissing = Boolean(firstPerson && !(answers?.people?.[firstPerson.id] || '').trim());

  // Key questions not answered yet: hollow "still to tell" dots on the spine.
  const pendingAnchors = useMemo(() => {
    if (!blueprint || !built) return [];
    const answered = new Set(built.timeline.articles.map((a) => a.storyAnchor).filter(Boolean));
    return blueprint.anchors
      .filter((a) => !answered.has(a.id))
      .map((a) => ({ id: a.id, lane: a.lane, label: fillTemplate(a.label, names, lang) }));
  }, [blueprint, built, names, lang]);
  const answeredAnchors = (blueprint?.anchors.length || 0) - pendingAnchors.length;

  // Bring a row picked on the spine into view (after its section has rendered).
  useEffect(() => {
    if (!scrollTarget) return undefined;
    const frame = requestAnimationFrame(() => {
      const el = formScrollRef.current?.querySelector(`[data-studio-row="${scrollTarget}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        el.querySelector('input, textarea')?.focus({ preventScroll: true });
      }
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, section]);

  // The real canvas catches up by itself shortly after typing stops (no "Apply" needed);
  // Ctrl+Enter still refreshes it at once.
  useEffect(() => {
    if (!isOpen || !canvasVisible || !canvasSnap || !isCanvasStale) return undefined;
    const timer = setTimeout(() => applyCanvasRef.current(), CANVAS_AUTO_APPLY_MS);
    return () => clearTimeout(timer);
  }, [isOpen, canvasVisible, canvasSnap, isCanvasStale, answers, photoMedia, eventExtras, photoRowsInView, lang]);

  // Reopened in the middle of a story (draft restored straight into the frame): say so.
  useEffect(() => {
    if (!isOpen) {
      welcomeCheckRef.current = true;
      setShowWelcome(false);
      return;
    }
    if (!welcomeCheckRef.current || hasBase || initialStart) return;
    // The first draft change after opening is the stored draft being read (or the user's first action).
    if (draft.updatedAt == null && !draft.blueprintKey) return;
    welcomeCheckRef.current = false;
    const restored = draft.step === 'frame' && draft.blueprintKey ? draft.answersByBlueprint[draft.blueprintKey] : null;
    setShowWelcome(answersHaveContent(restored));
  }, [isOpen, draft, hasBase, initialStart]);

  // Context for "Polish with AI" on Studio titles: the story kind, its title and the people in it.
  // Who the story is for: steers the tone of every AI wording request (overview draft and polish).
  const occasion = storyOccasion(blueprint, answers);
  const polishContext = blueprint
    ? [
      pickLang(blueprint.name, lang),
      answers?.title || built?.stats?.suggestedTitle || '',
      Object.values(names || {}).filter(Boolean).join(', '),
      OCCASION_CONTEXT[occasion] || '',
    ].filter(Boolean).join(' — ')
    : '';

  const hasPhotoMedia = Object.keys(photoMedia).length > 0;
  const hasEventExtras = Object.keys(eventExtras).length > 0;
  // "Add place pictures": a Wikimedia picture of the place (marked illustrative) on events without a
  // photo. On by default, except for stories built from the user's own photos.
  const [illustrativeChoice, setIllustrativeChoice] = useState(null);
  const wantsPictures = illustrativeChoice ?? !hasPhotoMedia;
  // "Link historical events": one AI pass after Create (credits for limited plans, shown here).
  const [wantsHistory, setWantsHistory] = useState(true);
  const [aiPlan, setAiPlan] = useState(null);
  useEffect(() => {
    if (!isOpen || aiPlan) return undefined;
    let alive = true;
    fetchPhotoImportLimits().then((l) => { if (alive) setAiPlan(l); }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, aiPlan]);
  const enrichOptions = { illustrativeImages: wantsPictures, history: wantsHistory };
  const isDirty = Boolean((isEditing && edit?.dirty) || (isEditing && (hasPhotoMedia || hasEventExtras)));
  const requestClose = async () => {
    if (isCreating) return;
    // A book import lives on the server: closing loses nothing (it can be continued later).
    if (bookImport) { onClose(); return; }
    if (isDirty || isFromDocs || hasPhotoMedia || hasEventExtras) {
      const ok = await confirm({
        title: t('storyStudio.discardTitle'),
        body: t('storyStudio.discardConfirm'),
        confirmLabel: t('storyStudio.discardBtn'),
        cancelLabel: t('storyStudio.keepEditing'),
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const isCanvasViewRef = useRef(isCanvasView);
  isCanvasViewRef.current = isCanvasView;

  const photoPanelRef = useRef(photoPanel);
  photoPanelRef.current = photoPanel;

  const docPanelRef = useRef(docPanel);
  docPanelRef.current = docPanel;

  const bookImportRef = useRef(bookImport);
  bookImportRef.current = bookImport;

  useEffect(() => {
    if (!isOpen) {
      setPhotoPanel(null);
      setPhotoMedia({});
      setPhotoNotice('');
      setEventExtras({});
      setOpenNotes({});
      setDocPanel(null);
      setDocTimeline(null);
      setBookImport(null);
      setBaseSection(null);
      setWhoError(false);
      setScrollTarget(null);
      undoToast.clear();
      return undefined;
    }
    // Opened for a specific start (e.g. "upload documents" from the unknown-subject notice).
    if (!editTimeline && (initialStart === 'documents' || initialStart === 'paste')) {
      setDocPanel({ tab: initialStart === 'paste' ? 'paste' : 'files', context: initialName || '' });
    } else if (!editTimeline && initialStart === 'blank') {
      setDraft((prev) => ({ ...prev, blueprintKey: 'custom', step: 'frame' }));
    }
    setError('');
    setIsCanvasView(false);
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        applyCanvasRef.current();
        return;
      }
      // Already handled inside the preview (closing its event details or photo viewer).
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape first leaves the canvas view or the photo panel, then closes the Studio.
      if (isCanvasViewRef.current) setIsCanvasView(false);
      else if (photoPanelRef.current) setPhotoPanel(null);
      else if (docPanelRef.current || bookImportRef.current) return; // their own Back handles leaving
      else requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;
  if (hasBase && !answers) return null;

  // ---- Draft mutations ----
  const updateAnswers = (fn) => {
    if (!blueprint) return;
    if (hasBase) {
      setEdit((prev) => (prev ? { ...prev, answers: fn(prev.answers), dirty: true } : prev));
      if (error) setError('');
      return;
    }
    setDraft((prev) => {
      const current = prev.answersByBlueprint[blueprint.key] || emptyStoryAnswers(blueprint, { initialName });
      return { ...prev, answersByBlueprint: { ...prev.answersByBlueprint, [blueprint.key]: fn(current) } };
    });
    if (error) setError('');
  };
  const setPerson = (id, value) => updateAnswers((a) => ({ ...a, people: { ...a.people, [id]: value } }));
  const setAnchor = (id, field, value) => updateAnswers((a) => ({
    ...a, anchors: { ...a.anchors, [id]: { ...(a.anchors[id] || {}), [field]: value } },
  }));
  const updateRow = (listKey, rowId, field, value) => updateAnswers((a) => ({
    ...a, [listKey]: a[listKey].map((r) => (r.id === rowId ? { ...r, [field]: value } : r)),
  }));
  const addRow = (listKey, row) => updateAnswers((a) => ({ ...a, [listKey]: [...(a[listKey] || []), { id: newRowId(), ...row }] }));
  const removeRow = (listKey, rowId) => updateAnswers((a) => ({ ...a, [listKey]: a[listKey].filter((r) => r.id !== rowId) }));
  const hideAutoChapter = (id) => updateAnswers((a) => ({ ...a, hiddenAutoChapters: [...new Set([...(a.hiddenAutoChapters || []), id])] }));
  const restoreAutoChapters = () => updateAnswers((a) => ({ ...a, hiddenAutoChapters: [] }));

  // Removes a row at once and offers Undo (no confirmation needed for something reversible).
  const removeRowWithUndo = (listKey, rowId, messageKey) => {
    const list = answers?.[listKey] || [];
    const index = list.findIndex((r) => r.id === rowId);
    const row = list[index];
    removeRow(listKey, rowId);
    if (!row) return;
    undoToast.show(t(messageKey), () => updateAnswers((a) => {
      const next = [...(a[listKey] || [])];
      next.splice(Math.min(index, next.length), 0, row);
      return { ...a, [listKey]: next };
    }));
  };

  // ---- Guided sections ----
  const goSection = (key) => {
    if (hasBase) setBaseSection(key);
    else setDraft((prev) => ({ ...prev, section: key }));
    setWhoError(false);
    setShowWelcome(false);
    formScrollRef.current?.scrollTo({ top: 0 });
  };
  const blockedByName = (key) => nameMissing && key !== 'who' && sections.some((s) => s.key === 'who');
  const goToSection = (key) => {
    if (blockedByName(key)) {
      if (section !== 'who') goSection('who');
      setWhoError(true);
      requestAnimationFrame(() => nameInputRef.current?.focus());
      return;
    }
    goSection(key);
  };
  const goNext = () => {
    const next = sections[sectionIndex + 1];
    if (next) goToSection(next.key);
  };

  const chooseBlueprint = (key) => {
    setDraft((prev) => ({ ...prev, blueprintKey: key, step: 'frame', section: null }));
    setError('');
    setWhoError(false);
    setShowWelcome(false);
  };
  const goToStory = () => {
    setPhotoPanel(null);
    setShowWelcome(false);
    setDraft((prev) => ({ ...prev, step: 'story' }));
  };
  const goPrev = () => {
    const prev = sections[sectionIndex - 1];
    if (prev) goSection(prev.key);
    else if (isFromDocs) leaveDocTimeline();
    else if (!isEditing) goToStory();
  };
  // Leaves the reviewed AI extraction and goes back to the ways to start.
  const leaveDocTimeline = async () => {
    const ok = await confirm({
      title: t('storyStudio.leaveDocsTitle'),
      body: t('docImport.leaveConfirm'),
      confirmLabel: t('storyStudio.leaveDocsBtn'),
      cancelLabel: t('storyStudio.keepEditing'),
      danger: true,
    });
    if (!ok) return;
    setDocTimeline(null);
    setPhotoMedia({});
    setEventExtras({});
    setOpenNotes({});
    setBaseSection(null);
    setDraft((prev) => ({ ...prev, step: 'story' }));
  };
  const startBlank = () => {
    setPhotoPanel(null);
    chooseBlueprint('custom');
  };
  const handleDocumentsGenerated = (timeline) => {
    setDocPanel(null);
    setPhotoMedia({});
    setEventExtras({});
    setOpenNotes({});
    setError('');
    setBaseSection(null);
    setDocTimeline(timeline);
  };
  const startOver = async () => {
    const ok = await confirm({
      title: t('storyStudio.startOverTitle'),
      body: t('storyStudio.startOverConfirm'),
      confirmLabel: t('storyStudio.startOverBtn'),
      cancelLabel: t('storyStudio.keepEditing'),
      danger: true,
    });
    if (!ok) return;
    clearDraft();
    setPhotoMedia({});
    setPhotoPanel(null);
    setEventExtras({});
    setOpenNotes({});
    setShowWelcome(false);
    setWhoError(false);
    undoToast.clear();
  };

  // ---- Spine ----
  const selectSpineArticle = (article) => {
    const row = blueprint && answers ? findStoryRow(blueprint, answers, article.id) : null;
    if (!row) return;
    goSection(row.kind === 'anchor' ? 'moments' : 'more');
    setScrollTarget(row.kind === 'anchor' ? `a-${row.id}` : `m-${row.id}`);
  };
  const selectSpinePending = (anchor) => {
    goToSection('moments');
    if (!blockedByName('moments')) setScrollTarget(`a-${anchor.id}`);
  };

  // ---- Photo import ----
  const openPhotoImport = (fromStart) => {
    setPhotoNotice('');
    setIsCanvasView(false);
    setPhotoPanel({ fromStart });
  };

  const mergeImportIntoAnswers = (a, rows, chapters) => {
    const titles = new Set((a.chapters || []).map((c) => (c.title || '').trim()));
    const newChapters = chapters
      .filter((c) => !titles.has(c.title))
      .map((c) => ({ id: newRowId(), title: c.title, from: c.from, to: c.to }));
    return { ...a, moments: [...(a.moments || []), ...rows], chapters: [...(a.chapters || []), ...newChapters] };
  };

  // Creates the timeline straight from a photo import's answers (the AI-first review's "Create
  // my timeline"). Anything missing (e.g. a story type's required name) leaves the user in the
  // frame with the reason, everything already filled in.
  const createFromPhotos = async (bp, a, media) => {
    const firstPerson = bp.people[0];
    if (firstPerson && !(a.people?.[firstPerson.id] || '').trim()) {
      setError(t('storyStudio.errorNeedName', { label: pickLang(firstPerson.label, lang) }));
      return;
    }
    const { timeline, stats } = buildStoryTimeline(bp, a, { lang });
    if (!stats.events || !timeline.title.trim()) {
      setError(t(stats.events ? 'storyStudio.errorNeedTitle' : 'storyStudio.errorNeedEvent'));
      return;
    }
    setIsCreating(true);
    try {
      const articles = await geocodeArticles(applyEventExtras(applyPhotoMedia(timeline.articles, media), eventExtras), lang, geocodeCacheRef.current);
      clearDraft();
      onCreate({ ...withoutEmptyStoryLanes(timeline, bp), articles, detectedLanguage: lang }, { illustrativeImages: illustrativeChoice ?? false, history: wantsHistory });
    } catch (err) {
      setError(err?.message || t('storyStudio.errorFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handlePhotoImport = async ({ rows, chapters, media, suggestion, failedCount, story = null, autoCreate = false }) => {
    const nextMedia = { ...photoMedia, ...media };
    setPhotoMedia(nextMedia);
    setPhotoNotice(failedCount ? t('photoImport.applyFailed', { count: failedCount }) : '');
    const fromStart = Boolean(photoPanel?.fromStart) && !hasBase;
    setPhotoPanel(null);
    setPhotoLive(false);
    setError('');
    if (!fromStart) {
      updateAnswers((a) => ({ ...mergeImportIntoAnswers(a, rows, chapters), ...(story?.aiAssisted ? { aiAssisted: true } : {}) }));
      return;
    }
    // Started from photos: the story type the AI shaped (when it had the names it needs), else
    // the one the photos suggest (a trip, or free-form).
    const choice = photoImportBlueprint(story, suggestion);
    const key = choice.key;
    const bp = getStoryBlueprint(key);
    const nextAnswers = photoStoryAnswers({
      blueprint: bp,
      base: draft.answersByBlueprint[key] || emptyStoryAnswers(bp, { initialName }),
      rows,
      chapters,
      story,
      choice,
      newId: newRowId,
      labels: { customLane: t('photoImport.customLane'), customTitle: t('photoImport.customTitle') },
    });
    setDraft((prev) => ({ ...prev, blueprintKey: key, step: 'frame', section: 'more', answersByBlueprint: { ...prev.answersByBlueprint, [key]: nextAnswers } }));
    if (autoCreate) await createFromPhotos(bp, nextAnswers, nextMedia);
  };

  const validate = () => {
    const firstPerson = blueprint.people[0];
    if (firstPerson && !(answers.people?.[firstPerson.id] || '').trim()) {
      setError(t('storyStudio.errorNeedName', { label: pickLang(firstPerson.label, lang) }));
      return false;
    }
    if (!built.timeline.title.trim()) {
      setError(t('storyStudio.errorNeedTitle'));
      return false;
    }
    if (!built.stats.events) {
      setError(t('storyStudio.errorNeedEvent'));
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!blueprint || !built || isCreating || !validate()) return;
    const result = applyStoryToTimeline(baseTimeline, blueprint, answers, { lang });
    if (isFromDocs) {
      // Reviewed AI extraction: create it (under the id the server already gave it).
      setIsCreating(true);
      try {
        const withPhotos = applyEventExtras(applyPhotoMedia(result.timeline.articles, photoMedia), eventExtras);
        const articles = await geocodeArticles(withPhotos, lang, geocodeCacheRef.current);
        onCreate({ ...withoutEmptyStoryLanes(result.timeline, blueprint), articles, isPersonal: true }, enrichOptions);
      } catch (err) {
        setError(err?.message || t('storyStudio.errorFailed'));
      } finally {
        setIsCreating(false);
      }
      return;
    }
    if (!result.changed && !hasPhotoMedia && !hasEventExtras) {
      onClose();
      return;
    }
    if (result.removedEventIds.length) {
      const ok = await confirm({
        title: t('storyStudio.deleteOnSaveTitle'),
        body: t('storyStudio.deleteConfirm', { count: result.removedEventIds.length }),
        confirmLabel: t('storyStudio.deleteOnSaveBtn'),
        cancelLabel: t('storyStudio.keepEditing'),
        danger: true,
      });
      if (!ok) return;
    }
    setIsCreating(true);
    try {
      const withPhotos = applyEventExtras(applyPhotoMedia(result.timeline.articles, photoMedia), eventExtras);
      const articles = await geocodeArticles(withPhotos, lang, geocodeCacheRef.current);
      onSave({ ...withoutEmptyStoryLanes(result.timeline, blueprint), articles }, { removedEventIds: result.removedEventIds, ...enrichOptions });
    } catch (err) {
      setError(err?.message || t('storyStudio.errorFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!blueprint || !built || isCreating || !validate()) return;
    setIsCreating(true);
    try {
      const { timeline } = buildStoryTimeline(blueprint, answers, { lang });
      const articles = await geocodeArticles(applyEventExtras(applyPhotoMedia(timeline.articles, photoMedia), eventExtras), lang, geocodeCacheRef.current);
      clearDraft();
      onCreate({ ...withoutEmptyStoryLanes(timeline, blueprint), articles, detectedLanguage: lang }, enrichOptions);
    } catch (err) {
      setError(err?.message || t('storyStudio.errorFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  // ---- Editing inside the preview (event drawer and Overview panel) ----
  const handlePreviewSaveEvent = (edited) => {
    if (!blueprint || !answers || !edited) return;
    const shown = canvasSnap?.timeline?.articles?.find((a) => String(a.id) === String(edited.id)) || edited;
    const res = applyEventEditToAnswers(blueprint, answers, edited, shown, { lang });
    if (!res) return;
    updateAnswers(() => res.answers);
    setEventExtras((prev) => ({ ...prev, [String(edited.id)]: res.extras }));
    setPreviewEditTick((n) => n + 1);
  };
  // Deleting from the preview's event drawer: done at once, with Undo.
  const handlePreviewDeleteEvent = (articleId) => {
    if (!blueprint || !answers) return false;
    const prevAnswers = answers;
    const prevExtras = eventExtras;
    updateAnswers((a) => removeStoryRow(blueprint, a, articleId));
    setEventExtras((prev) => {
      if (!prev[String(articleId)]) return prev;
      const next = { ...prev };
      delete next[String(articleId)];
      return next;
    });
    setPreviewEditTick((n) => n + 1);
    undoToast.show(t('storyStudio.momentRemoved'), () => {
      updateAnswers(() => prevAnswers);
      setEventExtras(prevExtras);
      setPreviewEditTick((n) => n + 1);
    });
    return true;
  };
  const setOverview = (text) => updateAnswers((a) => ({ ...a, overview: text }));
  const handlePreviewSaveOverview = (text) => {
    setOverview(text);
    setPreviewEditTick((n) => n + 1);
  };
  const getOverviewFacts = () => storyOverviewFacts(
    { ...(built?.timeline || {}), title: built?.timeline?.title || answers?.title || '' },
    { kind: blueprint ? pickLang(blueprint.name, lang) : '', people: Object.values(names || {}), lang },
  );
  // No editing while photo moments are under review: the preview then shows rows not in the form yet.
  const canEditInPreview = Boolean(blueprint && answers && !photoRowsInView);

  // The optional notes of an anchor or moment: a one-line summary (shown under the title) and
  // what happened (the event's story text), which AI can write out from rough notes.
  const renderNotes = (key, row, setField, { title = '', date = '', place = '' } = {}) => {
    const hasNotes = Boolean((row?.note || '').trim() || (row?.story || '').trim());
    const isOpenRow = openNotes[key] ?? hasNotes;
    const toggle = () => setOpenNotes((prev) => ({ ...prev, [key]: !isOpenRow }));
    if (!isOpenRow) {
      return (
        <button type="button" onClick={toggle} className={`${LINK_BUTTON_CLASS} mt-1 text-ink-muted`} data-testid="studio-notes-toggle">
          <FileText className="w-4 h-4" />{t('storyStudio.detailsShow')}
        </button>
      );
    }
    const where = [title, date, place].map((x) => (x || '').trim()).filter(Boolean).join(', ');
    const storyContext = [polishContext, where].filter(Boolean).join(' — ');
    return (
      <div className="mt-3 space-y-2" data-testid="studio-notes">
        <div className="flex items-center gap-2">
          <input type="text" value={row?.note || ''} onChange={(e) => setField('note', e.target.value)} placeholder={t('storyStudio.notePlaceholder')} maxLength={NOTE_MAX} dir="auto" className={`${STUDIO_INPUT_CLASS} flex-1 min-w-0`} />
          <AiPolishButton variant="icon" field="event_subtitle" value={row?.note || ''} onChange={(v) => setField('note', v)} context={storyContext} maxLength={NOTE_MAX} timelineId={baseTimeline?.id} />
        </div>
        <textarea value={row?.story || ''} onChange={(e) => setField('story', e.target.value)} placeholder={t('storyStudio.storyPlaceholder')} rows={(row?.story || '').length > 160 ? 5 : 3} maxLength={STORY_MAX} dir="auto" className={`${STUDIO_INPUT_CLASS} resize-y leading-relaxed`} />
        <div className="flex items-center gap-2">
          <AiPolishButton field="moment_story" value={row?.story || ''} onChange={(v) => setField('story', v)} context={storyContext} maxLength={STORY_MAX} timelineId={baseTimeline?.id} label={t('storyStudio.writeUp')} tooltip={t('storyStudio.writeUpTooltip')} />
          <span className="flex-1" />
          {!hasNotes && (
            <button type="button" onClick={toggle} className="min-h-11 px-2 text-sm text-ink-subtle hover:text-ink cursor-pointer">{t('storyStudio.detailsHide')}</button>
          )}
        </div>
      </div>
    );
  };

  const laneOptions = built?.timeline.lanes || [];
  const hiddenCount = (answers?.hiddenAutoChapters || []).filter((id) => autoChapters.some((c) => c.id === id)).length;
  const inProgressBadge = (
    <span className="text-caption font-medium px-2 py-0.5 rounded-pill bg-accent-soft text-accent whitespace-nowrap">{t('storyStudio.inProgress')}</span>
  );

  // ---- Step 1: flagship AI imports at the top, followed by guided templates & blank canvas ----
  const renderSourceOption = ({ icon: Icon, title, hint, cta, showAiBadge, onClick, testId }) => (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col justify-between p-5 rounded-panel border border-accent/25 bg-surface-raised hover:border-accent/60 shadow-control hover:shadow-pop motion-safe:hover:-translate-y-0.5 text-start transition-[border-color,box-shadow,transform,background-color] duration-150 ease-out cursor-pointer"
      data-testid={testId}
    >
      <span className="w-full">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent-soft text-accent transition-transform duration-150 group-hover:scale-105 shrink-0">
            <Icon className="w-5 h-5" />
          </span>
          {showAiBadge && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-pill bg-accent-soft text-accent text-caption font-semibold">
              <Sparkles className="w-3 h-3" />
              <span>{t('docImport.aiBadge')}</span>
            </span>
          )}
        </span>
        <span className="block mt-3.5 text-lg font-semibold tracking-tight text-ink leading-snug">{title}</span>
        <span className="block mt-1.5 text-sm text-ink-muted leading-relaxed">{hint}</span>
      </span>
      {cta && (
        <span className="mt-4 pt-3 w-full border-t border-line/80 flex items-center justify-between gap-2 text-sm font-semibold text-accent group-hover:text-accent-hover transition-colors">
          <span>{cta}</span>
          {isRtl
            ? <ArrowLeft className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5" />
            : <ArrowRight className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />}
        </span>
      )}
    </button>
  );

  const hasHeroSources = Boolean(onGenerateFromDocuments || photoImportOn);

  const renderStoryStep = () => (
    <div className="pb-8">
      <header className="mb-6 sm:mb-8">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight text-ink text-balance">{t('storyStudio.startTitle')}</h2>
        <p className="mt-2.5 text-base text-ink-muted leading-relaxed max-w-2xl">{t('storyStudio.startSubtitle')}</p>
      </header>

      {bookImportOn && activeBookImports.length > 0 && (
        <div className="mb-6 space-y-2.5">
          {activeBookImports.map((imp) => (
            <button
              key={imp.id}
              type="button"
              onClick={() => { setError(''); setBookImport({ id: imp.id }); }}
              className="w-full flex items-center gap-3 p-4 rounded-panel border border-accent/35 bg-accent-soft/45 hover:bg-accent-soft text-start transition-colors duration-150 cursor-pointer"
              data-testid="studio-continue-book"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-raised text-accent shrink-0"><BookOpen className="w-5 h-5" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-semibold text-ink truncate" dir="auto">{t('bookImport.continueTitle', { title: imp.title || t('bookImport.untitled') })}</span>
                <span className="block text-sm text-ink-muted">{t(`bookImport.status_${imp.status}`)}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-accent hidden sm:inline">{t('bookImport.continueBtn')}</span>
            </button>
          ))}
        </div>
      )}

      {hasHeroSources && (
        <section className="mb-9" aria-labelledby="studio-sources-title">
          <h3 id="studio-sources-title" className="text-sm font-semibold text-accent mb-3 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{t('storyStudio.startFromWhatYouHave')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" data-testid="studio-start-options">
            {onGenerateFromDocuments && renderSourceOption({
              icon: FileText,
              title: t('docImport.startTitle'),
              hint: t('docImport.startHint'),
              cta: t('docImport.startBtn'),
              showAiBadge: true,
              onClick: () => { setError(''); setDocPanel({ tab: 'files', context: initialName || '' }); },
              testId: 'studio-start-docs',
            })}
            {photoImportOn && renderSourceOption({
              icon: Images,
              title: t(photoAiFirst ? 'photoImport.startTitleAi' : 'photoImport.startTitle'),
              hint: t(photoAiFirst ? 'photoImport.startHintAi' : 'photoImport.startHint'),
              cta: t(photoAiFirst ? 'photoImport.startBtnAi' : 'photoImport.startBtn'),
              showAiBadge: Boolean(photoAiFirst),
              onClick: () => openPhotoImport(true),
              testId: 'studio-start-photos',
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="studio-templates-title">
        <div className="mb-3.5">
          <h3 id="studio-templates-title" className="text-base font-semibold text-ink">{t('storyStudio.chooseTitle')}</h3>
          <p className="mt-0.5 text-sm text-ink-muted leading-relaxed">{t('storyStudio.chooseSubtitle')}</p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="studio-blueprints">
          {STORY_BLUEPRINTS.filter((bp) => bp.key !== 'custom').map((bp) => {
            const Icon = BLUEPRINT_ICONS[bp.icon] || Sparkles;
            const hasDraft = answersHaveContent(draft.answersByBlueprint[bp.key]);
            return (
              <li key={bp.key}>
                <button
                  type="button"
                  onClick={() => chooseBlueprint(bp.key)}
                  className="group w-full h-full flex items-start gap-3.5 p-4 rounded-panel border border-line bg-surface-raised text-start hover:border-accent/45 hover:shadow-card motion-safe:hover:-translate-y-px transition-[border-color,box-shadow,transform] duration-150 ease-out cursor-pointer"
                >
                  <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-sunken text-ink-muted group-hover:bg-accent-soft group-hover:text-accent transition-colors duration-150 shrink-0"><Icon className="w-5 h-5" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-ink leading-snug">{pickLang(bp.name, lang)}</span>
                      {hasDraft && inProgressBadge}
                    </span>
                    <span className="block mt-1 text-sm text-ink-muted leading-relaxed">{pickLang(bp.tagline, lang)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-7 pt-5 border-t border-line flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={startBlank} className={`${LINK_BUTTON_CLASS} text-ink-muted hover:text-ink`} data-testid="studio-start-blank">
          <BookUser className="w-4 h-4" />{t('storyStudio.blankCanvasLink')}
        </button>
        {answersHaveContent(draft.answersByBlueprint.custom) && inProgressBadge}
        <span className="text-sm text-ink-subtle">{t('storyStudio.blankCanvasHint')}</span>
      </div>
    </div>
  );

  // ---- Step 2: the guided sections ----
  const renderWho = () => (
    <>
      <SectionHeader
        title={t(blueprint.people.length ? 'storyStudio.secWhoTitle' : 'storyStudio.secWhoCustomTitle')}
        intro={t(blueprint.people.length ? 'storyStudio.secWhoIntro' : 'storyStudio.secWhoCustomIntro')}
      />
      {blueprint.people.length > 0 && (
        <div className="space-y-5">
          {blueprint.people.map((p, i) => {
            const isFirst = i === 0;
            const invalid = isFirst && whoError && nameMissing;
            return (
              <label key={p.id} className="block">
                <span className="block text-sm font-medium text-ink mb-2">{pickLang(p.label, lang)}</span>
                <input
                  ref={isFirst ? nameInputRef : undefined}
                  type="text"
                  value={answers.people?.[p.id] || ''}
                  onChange={(e) => { setPerson(p.id, e.target.value); if (isFirst && whoError) setWhoError(false); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goNext(); } }}
                  placeholder={pickLang(p.placeholder, lang)}
                  maxLength={60}
                  dir="auto"
                  aria-invalid={invalid ? 'true' : undefined}
                  aria-describedby={invalid ? 'studio-name-error' : undefined}
                  className={`${STUDIO_INPUT_CLASS} text-lg ${invalid ? 'border-danger' : ''}`}
                />
                {invalid && (
                  <span id="studio-name-error" role="alert" className="mt-2 flex items-start gap-2 text-sm text-danger">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{t('storyStudio.nameFirst')}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {blueprint.customLanes && (
        <section className={blueprint.people.length ? 'mt-8' : ''}>
          {blueprint.people.length > 0 && <SectionTitle hint={t('storyStudio.lanesHint')}>{t('storyStudio.lanesTitle')}</SectionTitle>}
          <div className="space-y-2">
            {(answers.customLanes || []).map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <input type="text" value={l.title} onChange={(e) => updateRow('customLanes', l.id, 'title', e.target.value)} placeholder={t('storyStudio.lanePlaceholder')} maxLength={60} dir="auto" className={STUDIO_INPUT_CLASS} />
                {answers.customLanes.length > 1 && (
                  <IconButton onClick={() => removeRowWithUndo('customLanes', l.id, 'storyStudio.laneRemoved')} label={t('common.remove')}><Trash2 className="w-4 h-4" /></IconButton>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addRow('customLanes', { title: '' })} className={`${LINK_BUTTON_CLASS} mt-2`}>
            <Plus className="w-4 h-4" />{t('storyStudio.addLane')}
          </button>
        </section>
      )}
    </>
  );

  const renderMoments = () => (
    <>
      <SectionHeader
        title={t('storyStudio.secMomentsTitle')}
        intro={t('storyStudio.secMomentsIntro')}
        aside={(
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-ink-muted" aria-live="polite">
            <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
            {t('storyStudio.answeredOf', { done: answeredAnchors, total: blueprint.anchors.length })}
          </p>
        )}
      />
      <ol className="space-y-3">
        {blueprint.anchors.map((a) => {
          const ans = answers.anchors?.[a.id] || {};
          const filled = Boolean(built?.timeline.articles.some((x) => x.storyAnchor === a.id));
          return (
            <li
              key={a.id}
              data-studio-row={`a-${a.id}`}
              className={`p-4 rounded-panel border transition-colors duration-200 ${filled ? 'border-accent/30 bg-accent-soft/40' : 'border-line bg-surface-raised'}`}
            >
              <div className="flex items-start gap-3 mb-3">
                <span className={`mt-1 flex items-center justify-center w-5 h-5 rounded-full shrink-0 transition-colors duration-200 ${filled ? 'bg-accent text-accent-fg' : 'border-[1.5px] border-line-input'}`} aria-hidden="true">
                  {filled && <Check className="w-3 h-3" />}
                </span>
                <h3 className="flex-1 text-base font-semibold leading-snug text-ink" dir="auto">{fillTemplate(a.label, names, lang)}</h3>
                {hasRichDetails(existingById.get(String(ans.articleId))) && (
                  <span className="mt-1 text-ink-subtle" title={t('storyStudio.keptDetails')} aria-label={t('storyStudio.keptDetails')}><Images className="w-4 h-4" /></span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 ps-8">
                <FuzzyDateInput className="w-36" value={ans.date} onChange={(v) => setAnchor(a.id, 'date', v)} placeholder={a.toPresent ? t('storyStudio.sincePlaceholder') : t('storyStudio.datePlaceholder')} lang={lang} unreadableText={t('storyStudio.dateUnreadable')} />
                {a.span && (
                  <FuzzyDateInput className="w-36" value={ans.to} onChange={(v) => setAnchor(a.id, 'to', v)} placeholder={t('storyStudio.toPlaceholder')} lang={lang} unreadableText={t('storyStudio.dateUnreadable')} />
                )}
                {a.place && (
                  <div className="flex-1 min-w-[10rem] relative">
                    <MapPin className="w-4 h-4 text-ink-subtle absolute top-3.5 start-3 pointer-events-none" />
                    <input type="text" value={ans.place || ''} onChange={(e) => setAnchor(a.id, 'place', e.target.value)} placeholder={t('storyStudio.placePlaceholder')} aria-label={t('storyStudio.placePlaceholder')} maxLength={120} dir="auto" className={`${STUDIO_INPUT_CLASS} ps-9`} />
                  </div>
                )}
              </div>
              <div className="ps-8">
                {renderNotes(`a-${a.id}`, ans, (field, v) => setAnchor(a.id, field, v), {
                  title: ans.title || fillTemplate(a.eventTitle, names, lang), date: ans.date, place: ans.place,
                })}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );

  const renderMore = () => (
    <>
      <SectionHeader
        title={isFromDocs ? t('docImport.reviewTitle') : t('storyStudio.secMoreTitle')}
        intro={isFromDocs ? t('docImport.reviewSubtitle') : (pickLang(blueprint.momentsHint, lang) || t('storyStudio.secMoreIntro'))}
      />
      {(answers.moments || []).length === 0 && (
        <p className="mb-4 p-4 rounded-panel bg-surface-sunken text-sm text-ink-muted leading-relaxed">{t('storyStudio.emptyMoments')}</p>
      )}
      <ul className="space-y-3">
        {(answers.moments || []).map((m) => (
          <li key={m.id} data-studio-row={`m-${m.id}`} className="p-4 rounded-panel border border-line bg-surface-raised motion-safe:animate-slide-up">
            <div className="flex items-center gap-2">
              <input type="text" value={m.title || ''} onChange={(e) => updateRow('moments', m.id, 'title', e.target.value)} placeholder={t('storyStudio.momentTitlePlaceholder')} aria-label={t('storyStudio.momentTitlePlaceholder')} maxLength={120} dir="auto" className={`${STUDIO_INPUT_CLASS} flex-1 min-w-0 font-medium`} />
              <AiPolishButton variant="icon" field="moment_title" value={m.title || ''} onChange={(v) => updateRow('moments', m.id, 'title', v)} context={polishContext} maxLength={120} timelineId={baseTimeline?.id} />
              {hasRichDetails(existingById.get(String(m.articleId))) && (
                <span className="p-1 text-ink-subtle" title={t('storyStudio.keptDetails')} aria-label={t('storyStudio.keptDetails')}><Images className="w-4 h-4" /></span>
              )}
              {!m.articleId && photoMedia['ss-m-' + m.id] && (
                <span className="p-1 text-accent" title={t('photoImport.rowPhotos', { count: photoMedia['ss-m-' + m.id].photoCount })} aria-label={t('photoImport.rowPhotos', { count: photoMedia['ss-m-' + m.id].photoCount })}><Images className="w-4 h-4" /></span>
              )}
              <IconButton onClick={() => removeRowWithUndo('moments', m.id, 'storyStudio.momentRemoved')} label={t('common.remove')}><Trash2 className="w-4 h-4" /></IconButton>
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <FuzzyDateInput className="w-36" value={m.date} onChange={(v) => updateRow('moments', m.id, 'date', v)} placeholder={t('storyStudio.datePlaceholder')} lang={lang} unreadableText={t('storyStudio.dateUnreadableShort')} />
              <div className="flex-1 min-w-[9rem] relative">
                <MapPin className="w-4 h-4 text-ink-subtle absolute top-3.5 start-3 pointer-events-none" />
                <input type="text" value={m.place || ''} onChange={(e) => updateRow('moments', m.id, 'place', e.target.value)} placeholder={t('storyStudio.placeShortPlaceholder')} aria-label={t('storyStudio.placeShortPlaceholder')} maxLength={120} dir="auto" className={`${STUDIO_INPUT_CLASS} ps-9`} />
              </div>
              {laneOptions.length > 1 && (
                <select value={m.lane || laneOptions[0].id} onChange={(e) => updateRow('moments', m.id, 'lane', e.target.value)} aria-label={t('storyStudio.laneLabel')} className={`${STUDIO_INPUT_CLASS} w-auto max-w-[11rem]`}>
                  {laneOptions.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              )}
            </div>
            {renderNotes(`m-${m.id}`, m, (field, v) => updateRow('moments', m.id, field, v), { title: m.title, date: m.date, place: m.place })}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => addRow('moments', { title: '', date: '', place: '', lane: laneOptions[laneOptions.length - 1]?.id || '' })} className={`${ADD_BUTTON_CLASS} mt-3`}>
        <Plus className="w-4 h-4" />{t('storyStudio.addMoment')}
      </button>

      {photoImportOn && (
        <section className="mt-8 p-4 rounded-panel bg-surface-sunken" data-testid="studio-photos-section">
          <SectionTitle hint={t('photoImport.addHint')}>{t('photoImport.addTitle')}</SectionTitle>
          <button type="button" onClick={() => openPhotoImport(false)} className="inline-flex items-center gap-2 h-11 px-4 rounded-control border border-line-input bg-surface-raised hover:border-accent hover:text-accent text-sm font-medium text-ink transition-colors duration-150 cursor-pointer" data-testid="studio-add-photos">
            <Images className="w-4 h-4" />{t('photoImport.addBtn')}
          </button>
          {hasPhotoMedia && <p className="mt-2 text-sm text-ink-muted">{t('photoImport.keptNote')}</p>}
          {photoNotice && <p className="mt-2 text-sm text-warning">{photoNotice}</p>}
        </section>
      )}
    </>
  );

  const renderChapters = () => (
    <>
      <SectionHeader title={t('storyStudio.secChaptersTitle')} intro={t('storyStudio.secChaptersIntro')} />
      <section>
        <SectionTitle>{t('storyStudio.chaptersTitle')}</SectionTitle>
        <div className="space-y-2">
          {autoChapters.filter((c) => showHiddenChapters || !(answers.hiddenAutoChapters || []).includes(c.id)).map((c) => {
            const hidden = (answers.hiddenAutoChapters || []).includes(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-3 ps-4 pe-1 min-h-12 rounded-panel bg-accent-soft/50 ${hidden ? 'opacity-50' : ''}`}>
                <span className="text-sm font-medium text-ink flex-1 truncate" dir="auto">{c.title}</span>
                <span className="text-sm text-ink-muted tabular-nums" dir="ltr">{formatYearRange(c.fromDec, c.toDec)}</span>
                <span className="text-caption px-2 py-0.5 rounded-pill bg-surface-raised text-ink-muted">{t('storyStudio.autoChapter')}</span>
                {!hidden && <IconButton onClick={() => hideAutoChapter(c.id)} label={t('storyStudio.hideChapter')}><EyeOff className="w-4 h-4" /></IconButton>}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button type="button" onClick={restoreAutoChapters} className={LINK_BUTTON_CLASS}>
              <RotateCcw className="w-4 h-4" />{t('storyStudio.restoreChapters', { count: hiddenCount })}
            </button>
          )}
          {(answers.chapters || []).map((c) => (
            <div key={c.id} className="p-3 rounded-panel border border-line bg-surface-raised">
              <div className="flex items-center gap-2">
                <input type="text" value={c.title || ''} onChange={(e) => updateRow('chapters', c.id, 'title', e.target.value)} placeholder={t('storyStudio.chapterPlaceholder')} aria-label={t('storyStudio.chapterPlaceholder')} maxLength={80} dir="auto" className={`${STUDIO_INPUT_CLASS} flex-1 min-w-0`} />
                <AiPolishButton variant="icon" field="chapter_title" value={c.title || ''} onChange={(v) => updateRow('chapters', c.id, 'title', v)} context={polishContext} maxLength={80} timelineId={baseTimeline?.id} />
                <IconButton onClick={() => removeRowWithUndo('chapters', c.id, 'storyStudio.chapterRemoved')} label={t('common.remove')}><Trash2 className="w-4 h-4" /></IconButton>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <FuzzyDateInput className="w-32" value={c.from} onChange={(v) => updateRow('chapters', c.id, 'from', v)} placeholder={t('storyStudio.fromPlaceholder')} lang={lang} unreadableText={t('storyStudio.dateUnreadableShort')} />
                <FuzzyDateInput className="w-32" value={c.to} onChange={(v) => updateRow('chapters', c.id, 'to', v)} placeholder={t('storyStudio.toPlaceholder')} lang={lang} unreadableText={t('storyStudio.dateUnreadableShort')} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button type="button" onClick={() => addRow('chapters', { title: '', from: '', to: '' })} className={LINK_BUTTON_CLASS}>
            <Plus className="w-4 h-4" />{t('storyStudio.addChapter')}
          </button>
          {(blueprint.chapterSuggestions || []).map((s) => {
            const title = pickLang(s, lang);
            if ((answers.chapters || []).some((c) => c.title === title)) return null;
            return (
              <button key={title} type="button" onClick={() => addRow('chapters', { title, from: '', to: '' })} className="inline-flex items-center gap-1 h-9 px-3 rounded-pill border border-line bg-surface-raised text-sm text-ink-muted hover:text-accent hover:border-accent/50 transition-colors duration-150 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />{title}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <SectionTitle>{t('storyStudio.titleLabel')}</SectionTitle>
        <div className="flex items-center gap-2">
          <input type="text" value={answers.title || ''} onChange={(e) => updateAnswers((a) => ({ ...a, title: e.target.value }))} placeholder={built?.stats.suggestedTitle || t('storyStudio.titlePlaceholder')} aria-label={t('storyStudio.titleLabel')} maxLength={120} dir="auto" className={`${STUDIO_INPUT_CLASS} flex-1 min-w-0 font-semibold text-base`} />
          <AiPolishButton variant="icon" field="timeline_title" value={answers.title || ''} onChange={(v) => updateAnswers((a) => ({ ...a, title: v }))} context={polishContext} maxLength={120} timelineId={baseTimeline?.id} />
        </div>
      </section>
    </>
  );

  const renderFinish = () => (
    <>
      <SectionHeader title={t('storyStudio.secFinishTitle')} intro={t('storyStudio.secFinishIntro')} />
      <div className="mb-8 p-5 rounded-panel bg-accent-soft/50 border border-accent/20">
        <p className="text-lg font-semibold text-ink leading-snug" dir="auto">{answers.title || built?.stats.suggestedTitle || t('storyStudio.titlePlaceholder')}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {[
            ['countMoments', built?.stats.events || 0, true],
            ['countChapters', built?.stats.chapters || 0, false],
            ['countPlaces', built?.stats.places || 0, false],
          ].filter(([, n, always]) => always || n > 0)
            .map(([key, n]) => t(`storyStudio.${key}${n === 1 ? 'One' : ''}`, { count: n }))
            .join(' · ')}
        </p>
        {!hasBase && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-success">
            <ShieldCheck className="w-4 h-4" />
            {t(historyCredits > 0 ? 'storyStudio.noCreditsBuilding' : 'storyStudio.noCredits')}
          </p>
        )}
      </div>
      <section className="mb-8" data-testid="studio-occasion">
        <SectionTitle hint={t('storyStudio.occasionHint')}>{t('storyStudio.occasionTitle')}</SectionTitle>
        <div role="radiogroup" aria-label={t('storyStudio.occasionTitle')} className="flex flex-wrap gap-2">
          {STORY_OCCASIONS.map((key) => {
            const selected = occasion === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => updateAnswers((a) => ({ ...a, occasion: selected ? '' : key }))}
                className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-pill border text-sm transition-colors duration-150 cursor-pointer ${selected
                  ? 'bg-accent-soft border-accent text-ink font-medium'
                  : 'bg-surface-raised border-line-input text-ink-muted hover:text-ink hover:bg-surface-hover'}`}
              >
                {selected && <Check className="w-4 h-4 text-accent" aria-hidden="true" />}
                {t(`storyStudio.occasion_${key}`)}
              </button>
            );
          })}
        </div>
      </section>
      <section data-testid="studio-overview-section">
        <SectionTitle hint={t('storyStudio.overviewHint')}>{t('storyStudio.overviewTitle')}</SectionTitle>
        <textarea
          value={answers.overview || ''}
          onChange={(e) => setOverview(e.target.value)}
          placeholder={t('storyStudio.overviewPlaceholder')}
          aria-label={t('storyStudio.overviewTitle')}
          rows={(answers.overview || '').trim() ? 10 : 5}
          maxLength={20000}
          dir="auto"
          className={`${STUDIO_INPUT_CLASS} resize-y leading-relaxed`}
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <OverviewDraftButton value={answers.overview || ''} onChange={setOverview} getFacts={getOverviewFacts} canDraft={hasEvents} timelineId={baseTimeline?.id} occasion={occasion} />
          <AiPolishButton field="timeline_overview" value={answers.overview || ''} onChange={setOverview} context={polishContext} maxLength={20000} timelineId={baseTimeline?.id} />
          {hasEvents && (
            <button
              type="button"
              onClick={() => { setOverviewRequest((n) => n + 1); if (!canvasVisible) setIsCanvasView(true); }}
              className={LINK_BUTTON_CLASS}
            >
              <BookOpen className="w-4 h-4" />{t('storyStudio.previewOverviewShow')}
            </button>
          )}
        </div>
      </section>
      <p className="mt-8 text-sm text-ink-muted leading-relaxed">{t(isEditing ? 'storyStudio.editHint' : 'storyStudio.afterCreateHint')}</p>
    </>
  );

  const renderFrameStep = () => (
    <div className="pb-8">
      {sectionIndex === 0 && !isEditing && (
        <button
          type="button"
          onClick={isFromDocs ? leaveDocTimeline : goToStory}
          className={`${LINK_BUTTON_CLASS} mb-4 text-ink-muted hover:text-ink`}
          data-testid="studio-frame-back"
        >
          {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{t('storyStudio.backToStart')}
        </button>
      )}
      {showWelcome && !hasBase && (
        <div className="mb-8 p-4 rounded-panel bg-accent-soft/50 border border-accent/20 motion-safe:animate-fade-in" role="status">
          <p className="text-base font-semibold text-ink">{t('storyStudio.welcomeBackTitle')}</p>
          <p className="mt-1 text-sm text-ink-muted" dir="auto">
            {t('storyStudio.welcomeBackBody', { title: answers.title || (nameMissing ? pickLang(blueprint.name, lang) : built?.stats.suggestedTitle) || pickLang(blueprint.name, lang) })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowWelcome(false)} className="h-11 px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-semibold transition-colors duration-150 cursor-pointer">
              {t('storyStudio.welcomeBackContinue')}
            </button>
            <button type="button" onClick={startOver} className="h-11 px-4 rounded-control text-sm font-medium text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
              {t('storyStudio.welcomeBackFresh')}
            </button>
          </div>
        </div>
      )}
      <div key={section} className="motion-safe:animate-fade-in">
        {section === 'who' && renderWho()}
        {section === 'moments' && renderMoments()}
        {section === 'more' && renderMore()}
        {section === 'chapters' && renderChapters()}
        {section === 'finish' && renderFinish()}
      </div>
      {!hasBase && draft.blueprintKey && (
        <div className="mt-12 pt-4 border-t border-line">
          <button type="button" onClick={startOver} className={`${LINK_BUTTON_CLASS} text-ink-subtle hover:text-danger`}>
            <RotateCcw className="w-4 h-4" />{t('storyStudio.startOver')}
          </button>
        </div>
      )}
    </div>
  );

  // Progress through the guided sections: a thin segmented bar (each segment jumps there).
  const renderProgress = () => (
    <nav aria-label={t('storyStudio.stepOf', { n: sectionIndex + 1, total: sections.length })} className="mt-2 sm:mt-3">
      <p className="hidden sm:block text-sm text-ink-muted">
        <span className="font-medium text-ink">{t('storyStudio.stepOf', { n: sectionIndex + 1, total: sections.length })}</span>
        <span aria-hidden="true"> · </span>{sections[sectionIndex]?.label}
      </p>
      <ol className="sm:mt-2 flex items-center gap-1">
        {sections.map((s, i) => (
          <li key={s.key} className="flex-1">
            <button
              type="button"
              onClick={() => goToSection(s.key)}
              aria-current={i === sectionIndex ? 'step' : undefined}
              aria-label={s.label}
              title={s.label}
              className="group w-full h-6 flex items-center cursor-pointer"
            >
              <span className={`block w-full h-1.5 rounded-pill transition-colors duration-200 ${i <= sectionIndex ? 'bg-accent' : 'bg-line-strong group-hover:bg-line-input'}`} />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );

  const renderPhotoPanel = () => {
    const fromStart = Boolean(photoPanel?.fromStart) && !hasBase;
    const builtArticles = fromStart ? [] : (built?.timeline.articles || []);
    // Existing events the photos can be added to (with coordinates where the timeline has them).
    const matchable = builtArticles.map((a) => {
      const prev = existingById.get(String(a.id));
      return prev && prev.lat != null ? { ...a, lat: prev.lat, lng: prev.lng } : a;
    });
    const mediaChars = Object.values(photoMedia).reduce((n, m) => n + (m.chars || 0), 0);
    const existingChars = (hasBase ? JSON.stringify(baseTimeline).length : 0) + mediaChars;
    const lanes = fromStart ? [] : laneOptions;
    return (
      <PhotoImportPanel
        storyContext={{
          kind: blueprint && !fromStart ? pickLang(blueprint.name, lang) : '',
          title: fromStart ? '' : (answers?.title || built?.stats?.suggestedTitle || ''),
          people: fromStart ? [] : Object.values(names || {}).filter(Boolean),
        }}
        existingArticles={matchable}
        existingChars={existingChars}
        laneOptions={lanes}
        defaultLane={lanes[lanes.length - 1]?.id || ''}
        timelineId={baseTimeline?.id || null}
        onCancel={() => setPhotoPanel(null)}
        backLabelKey={fromStart ? 'storyStudio.backToStart' : 'photoImport.backToStory'}
        onApply={handlePhotoImport}
        onPreviewChange={setPhotoPreviewRows}
        onLiveChange={setPhotoLive}
        aiFirst={photoAiFirst}
        canCreate={fromStart && !isEditing}
        existingTitle={fromStart ? '' : (answers?.title || built?.stats?.suggestedTitle || baseTimeline?.title || '')}
      />
    );
  };

  const stats = built?.stats;
  const isFrame = step === 'frame' && !photoPanel && !docPanel;
  // Until the name is given, lanes named after the person show no label (never "Someone special").
  const spineTimeline = built?.timeline && nameMissing && firstPerson
    ? {
      ...built.timeline,
      lanes: built.timeline.lanes.map((l) => (l.title.includes(pickLang(firstPerson.fallback, lang)) ? { ...l, title: '' } : l)),
    }
    : built?.timeline;
  const storyTitle = isFrame && blueprint
    ? (answers?.title || (isEditing ? editTimeline.title : '') || (!nameMissing ? built?.stats?.suggestedTitle : '') || '')
    : '';
  const nextSection = sections[sectionIndex + 1];
  const createLabel = t(isEditing ? 'storyStudio.saveBtn' : 'storyStudio.createBtn');
  // What the historical-links pass will cost after Create (0: off, unlimited plan, or nothing to link).
  const historyCredits = (() => {
    const events = built?.stats?.events || 0;
    if (!wantsHistory || hasBase || !events || !aiPlan || aiPlan.unlimited) return 0;
    return Math.max(1, Math.ceil(events / Math.max(1, aiPlan.history_events_per_credit || 60)));
  })();
  const busyLabel = t(isEditing ? 'storyStudio.saving' : 'storyStudio.creating');
  const onCreateOrSave = hasBase ? handleSave : handleCreate;
  // Editing: saving is always the main action. Creating: "Next" leads, "Create" waits at the end
  // (and is offered early, quietly, once there is something to create).
  const primaryIsCreate = isEditing || isLastSection;
  const showEarlyCreate = !primaryIsCreate && (hasEvents || isEditing);
  const previewEmptyLabel = photoPanel ? t('storyStudio.previewEmptyPhotos') : t('storyStudio.previewEmpty');

  return (
    <StudioConfirmProvider value={confirm}>
    <div
      ref={containerRef}
      className="theme-memory fixed inset-0 z-[110] flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label={t('storyStudio.title')}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header: the story's own name once it has one; Preview and Close. */}
      <header className="flex items-center gap-3 px-4 sm:px-6 h-16 border-b border-line bg-surface shrink-0">
        <span className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-accent-soft text-accent shrink-0"><BookUser className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight text-ink leading-tight truncate" dir="auto">
            {storyTitle || t('storyStudio.title')}
          </h1>
          <p className="text-caption text-ink-muted truncate" dir="auto">
            {isEditing
              ? t('storyStudio.editingSubtitle', { title: editTimeline.title || '' })
              : storyTitle ? t('storyStudio.title') : t('storyStudio.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!hasBase && savedAt && isFrame && (
            <span className="hidden md:inline-flex items-center gap-1 text-caption text-ink-subtle"><Check className="w-3.5 h-3.5" />{t('storyStudio.draftSaved')}</span>
          )}
          {isDirty && <span className="hidden md:inline text-caption text-warning">{t('storyStudio.unsavedChanges')}</span>}
          {/* "Create" is always within reach: here until the last section makes it the main action. */}
          {isFrame && showEarlyCreate && (
            <button
              type="button"
              onClick={onCreateOrSave}
              disabled={isCreating}
              className="hidden sm:inline-flex items-center gap-2 h-10 px-3 rounded-control border border-line-input text-sm font-medium text-ink hover:border-accent hover:text-accent transition-colors duration-150 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
              {isCreating ? busyLabel : createLabel}
            </button>
          )}
          {/* Small screens have no side canvas: this is how you see the real timeline there. */}
          {blueprint && (isCanvasView || (step === 'frame' && !docPanel)) && (
            <button
              type="button"
              onClick={() => setIsCanvasView((v) => !v)}
              disabled={!isCanvasView && !stats?.events}
              title={isCanvasView ? undefined : t('storyStudio.canvasPreviewHint')}
              className={`${isCanvasView || !showCanvasPane ? 'inline-flex' : 'inline-flex lg:hidden'} items-center gap-2 h-10 px-3 rounded-control border text-sm font-medium transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-default ${isCanvasView ? 'border-accent bg-accent-soft text-accent' : 'border-line-input text-ink hover:bg-surface-hover'}`}
            >
              {isCanvasView
                ? <>{isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}<span>{t('storyStudio.canvasPreviewBack')}</span></>
                : <><Maximize2 className="w-4 h-4" /><span>{t('storyStudio.canvasPreviewBtn')}</span></>}
            </button>
          )}
          <button type="button" onClick={requestClose} disabled={isCreating} aria-label={t('common.close')} className="inline-flex items-center justify-center w-11 h-11 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors duration-150 disabled:opacity-40 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Body: the form, and beside it (lg+) the real canvas, which catches up shortly after typing
          stops. Picking a story and importing documents use the full width. */}
      {bookImport ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>}>
            <BookImportFlow
              importId={bookImport.id}
              onExit={() => setBookImport(null)}
              onOpenTimeline={(id) => { setBookImport(null); onOpenTimeline?.(id); }}
            />
          </Suspense>
        </div>
      ) : (
      <div className={`flex-1 min-h-0 grid grid-cols-1 ${showCanvasPane && !isCanvasView ? 'lg:grid-cols-[minmax(26rem,32rem)_1fr]' : ''}`}>
        <div className={`relative min-h-0 flex-col ${showCanvasPane ? 'border-e border-line' : ''} ${isCanvasView ? 'hidden' : 'flex'}`}>
          {/* The story so far: always visible above the questions. */}
          {isFrame && blueprint && (
            <div className="shrink-0 px-4 sm:px-6 pt-3 sm:pt-4 pb-1 sm:pb-3 border-b border-line bg-surface">
              <StorySpine
                timeline={spineTimeline}
                pending={pendingAnchors}
                onSelectArticle={selectSpineArticle}
                onSelectPending={selectSpinePending}
                compact={!isLargeViewport}
              />
              {sections.length > 1 && renderProgress()}
            </div>
          )}
          <div ref={formScrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className={showCanvasPane ? 'max-w-xl' : 'max-w-3xl mx-auto'}>
              {docPanel ? (
                <DocumentImportPanel
                  initialTab={docPanel.tab}
                  initialContext={docPanel.context}
                  onBack={() => setDocPanel(null)}
                  onGenerate={onGenerateFromDocuments}
                  onGenerated={handleDocumentsGenerated}
                  onStartBookImport={bookImportOn ? (id) => { setDocPanel(null); setBookImport({ id }); } : undefined}
                />
              ) : photoPanel ? renderPhotoPanel() : step === 'story' ? renderStoryStep() : renderFrameStep()}
            </div>
          </div>

          {isFrame && (
            <footer className="shrink-0 border-t border-line bg-surface px-4 sm:px-6 py-3 space-y-2">
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-control bg-danger-soft border border-danger/30" role="alert">
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <p className="text-sm text-danger leading-snug">{error}</p>
                </div>
              )}
              {/* Wikipedia choices: their own rows above the buttons (the column is narrow). */}
              {primaryIsCreate && (
                <label className="flex items-center gap-2 text-caption text-ink-muted cursor-pointer select-none" title={t('storyStudio.historyLinksHint')}>
                  <input
                    type="checkbox"
                    checked={wantsHistory}
                    onChange={(e) => setWantsHistory(e.target.checked)}
                    className="w-4 h-4 accent-[rgb(var(--accent))] cursor-pointer shrink-0"
                    data-testid="studio-history-links"
                  />
                  <span>
                    {t('storyStudio.historyLinks')}
                    {historyCredits > 0 && (
                      <span className="text-ink-subtle"> · {t(historyCredits === 1 ? 'storyStudio.historyLinksCostOne' : 'storyStudio.historyLinksCost', { count: historyCredits })}</span>
                    )}
                  </span>
                </label>
              )}
              {primaryIsCreate && (
                <label
                  className="flex items-center gap-2 text-caption text-ink-muted cursor-pointer select-none"
                  title={t('storyStudio.placePicturesHint')}
                >
                  <input
                    type="checkbox"
                    checked={wantsPictures}
                    onChange={(e) => setIllustrativeChoice(e.target.checked)}
                    className="w-4 h-4 accent-[rgb(var(--accent))] cursor-pointer shrink-0"
                  />
                  <span>{t('storyStudio.placePictures')}</span>
                </label>
              )}
              <div className="flex items-center gap-2">
                {sectionIndex === 0 && isEditing ? (
                  <button type="button" onClick={requestClose} className="h-11 px-3 text-sm font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
                    {t('common.cancel')}
                  </button>
                ) : (
                  <button type="button" onClick={goPrev} className="inline-flex items-center gap-2 h-11 px-3 text-sm font-medium text-ink-muted hover:text-ink rounded-control hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
                    {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{t('storyStudio.back')}
                  </button>
                )}
                <span className="flex-1" />
                {isEditing && !isLastSection && nextSection && (
                  <button type="button" onClick={goNext} className="inline-flex items-center gap-2 h-11 px-4 rounded-control border border-line-input text-sm font-medium text-ink hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
                    {t('storyStudio.next')}{isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </button>
                )}
                {primaryIsCreate ? (
                  <button
                    type="button"
                    onClick={onCreateOrSave}
                    disabled={isCreating}
                    className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control transition-colors duration-150 cursor-pointer motion-safe:active:scale-[0.98] disabled:opacity-60 disabled:cursor-default"
                  >
                    {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isCreating ? busyLabel : createLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover rounded-control shadow-control transition-colors duration-150 cursor-pointer motion-safe:active:scale-[0.98] whitespace-nowrap"
                  >
                    <span className="sm:hidden">{t('storyStudio.next')}</span>
                    <span className="hidden sm:inline">{nextSection ? t('storyStudio.nextTo', { label: nextSection.label }) : t('storyStudio.next')}</span>
                    {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </footer>
          )}
          {undoToast.element}
        </div>

        {canvasVisible && (
          <aside className="min-h-0 flex flex-col bg-surface-sunken" data-testid="studio-canvas-pane">
            <div className="flex-1 min-h-0 relative">
              <StudioCanvasPreview
                timeline={canvasSnap?.timeline}
                theme={theme}
                emptyLabel={previewEmptyLabel}
                geocode={geocodePreview}
                timelineId={baseTimeline?.id || null}
                onSaveEvent={canEditInPreview ? handlePreviewSaveEvent : undefined}
                onDeleteEvent={canEditInPreview ? handlePreviewDeleteEvent : undefined}
                onSaveOverview={canEditInPreview ? handlePreviewSaveOverview : undefined}
                renderOverviewTools={canEditInPreview ? ({ value, setValue }) => (
                  <OverviewDraftButton value={value} onChange={setValue} getFacts={getOverviewFacts} canDraft={hasEvents} timelineId={baseTimeline?.id} occasion={occasion} />
                ) : undefined}
                overviewRequest={overviewRequest}
              />
              {/* While the canvas catches up with the form: a quiet "Updating" note (refresh now on click). */}
              {isCanvasStale && canvasSnap && (
                <div className="absolute top-3 inset-x-0 z-10 flex justify-center px-16 pointer-events-none">
                  <div className="pointer-events-auto flex items-center gap-2 ps-3 pe-1 py-1 rounded-pill bg-surface-raised/95 border border-line shadow-card motion-safe:animate-fade-in">
                    <RefreshCw className="w-3.5 h-3.5 text-ink-subtle motion-safe:animate-spin" />
                    <span className="text-caption text-ink-muted">{t('storyStudio.canvasUpdating')}</span>
                    <button
                      type="button"
                      onClick={applyCanvas}
                      title={t('storyStudio.canvasApplyHint')}
                      className="inline-flex items-center h-8 px-3 rounded-pill text-caption font-semibold text-accent hover:bg-accent-soft transition-colors duration-150 cursor-pointer"
                      data-testid="studio-canvas-apply"
                    >
                      {t('storyStudio.canvasApply')}
                    </button>
                  </div>
                </div>
              )}
              {!isCanvasView ? (
                <button
                  type="button"
                  onClick={() => setIsCanvasView(true)}
                  aria-label={t('storyStudio.canvasExpand')}
                  title={t('storyStudio.canvasExpand')}
                  className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-10 h-10 rounded-control bg-surface-raised/95 border border-line shadow-card text-ink-muted hover:text-ink transition-colors duration-150 cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              ) : isLargeViewport && (
                <button
                  type="button"
                  onClick={() => setIsCanvasView(false)}
                  aria-label={t('storyStudio.canvasPreviewBack')}
                  title={t('storyStudio.canvasPreviewBack')}
                  className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-10 h-10 rounded-control bg-surface-raised/95 border border-line shadow-card text-ink-muted hover:text-ink transition-colors duration-150 cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {!isCanvasView && (
              <p className="shrink-0 px-6 py-3 border-t border-line text-sm text-ink-muted leading-snug">{t('storyStudio.canvasPreviewNote')}</p>
            )}
          </aside>
        )}
      </div>
      )}

      {confirmElement}
    </div>
    </StudioConfirmProvider>
  );
}
