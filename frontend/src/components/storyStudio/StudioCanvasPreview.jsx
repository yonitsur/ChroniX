import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon, Loader2, BookOpen } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import useIsMobileViewport from '../../hooks/useIsMobileViewport';
import { isSameArticleId } from '../../utils/timelineArticles';
import { ACTIVE_TILE_PROVIDER } from '../../utils/mapConfig';

// The real ChroniX canvas inside the Story Studio, so you see exactly how the timeline will look
// (photos included) before creating or saving it. TimelineView rebuilds itself whenever its data
// changes, so the Studio feeds it a snapshot taken on "Apply" rather than live keystrokes.
// Clicking an event opens the real details drawer - editable when the Studio passes onSaveEvent
// (the edit goes back into the Studio form, nothing is saved to the timeline yet). The Overview
// panel and an optional map show the rest of what the finished timeline will have.
const TimelineView = lazy(() => import('../TimelineView'));
const EventDrawer = lazy(() => import('../EventDrawer'));
const GeoMapView = lazy(() => import('../GeoMapView'));
const TimelineOverviewPanel = lazy(() => import('../TimelineOverviewPanel'));

const EMPTY_SET = new Set();
const MAP_PREF_KEY = 'chronix_studio_preview_map_v1';
// Above the Studio (z-[110]) so the drawer's full-screen photo viewer isn't hidden behind it.
const LIGHTBOX_Z = 130;

// Approximate decimal year for chronological Prev/Next (same mapping as the main app).
const articleDateValue = (a) => {
  const f = a?.from || {};
  const y = Number(f.year) || 0;
  const m = (Number(f.month) || 1) - 1;
  const d = (Number(f.day) || 1) - 1;
  const minutesIntoDay = (Number(f.hour) || 0) * 60 + (Number(f.minute) || 0);
  return y + (m * 30 + d + minutesIntoDay / 1440) / 365;
};

const hasCoords = (a) => a?.lat != null && a?.lng != null
  && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

const readMapPref = () => {
  try { return localStorage.getItem(MAP_PREF_KEY) === '1'; } catch { return false; }
};

// The drawer's default desktop width, narrowed so some of the canvas stays visible in the pane.
const getDrawerWidth = (paneWidth) => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const preferred = vw >= 1024 ? 440 : 380;
  if (!paneWidth) return preferred;
  return Math.round(Math.min(preferred, Math.max(320, paneWidth - 140)));
};

export default function StudioCanvasPreview({
  timeline,
  theme = 'light',
  emptyLabel,
  geocode,
  timelineId = null,
  // Editing (all optional; without them the drawer and overview are read-only).
  onSaveEvent,
  onDeleteEvent,
  onSaveOverview,
  renderOverviewTools,
  // Bumped by the Studio to open the Overview panel.
  overviewRequest = 0,
}) {
  const { t, visualTheme } = useLanguage();
  const isNarrowViewport = useIsMobileViewport();
  const timelineRef = useRef(null);
  const paneRef = useRef(null);
  // Local selection only, so clicking a card opens its details like on the real canvas.
  const [selectedId, setSelectedId] = useState(null);
  const [isMapOpen, setIsMapOpen] = useState(readMapPref);
  const [paneWidth, setPaneWidth] = useState(0);
  // { source, articles } - the snapshot's articles with looked-up coordinates for the map.
  const [geoResult, setGeoResult] = useState(null);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  // Unsaved changes in the drawer's editor: switching events or Escape asks first.
  const editDirtyRef = useRef(false);
  const confirmDiscardEdit = useCallback(() => {
    if (!editDirtyRef.current) return true;
    if (!window.confirm(t('eventEditor.discardConfirm'))) return false;
    editDirtyRef.current = false;
    return true;
  }, [t]);

  useEffect(() => {
    if (!overviewRequest || !confirmDiscardEdit()) return;
    setSelectedId(null);
    setIsOverviewOpen(true);
  }, [overviewRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceArticles = timeline?.articles;
  const articles = useMemo(() => sourceArticles || [], [sourceArticles]);
  const lanes = timeline?.lanes || [];
  const hasGeoResult = Boolean(geoResult && sourceArticles && geoResult.source === sourceArticles);
  const isLocating = isMapOpen && Boolean(geocode) && articles.length > 0 && !hasGeoResult;
  const placedArticles = hasGeoResult ? geoResult.articles : articles;

  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setPaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [articles.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look up coordinates for the map only while it's shown (the Studio caches each place).
  useEffect(() => {
    if (!isMapOpen || !geocode || !sourceArticles?.length) return undefined;
    if (geoResult?.source === sourceArticles) return undefined;
    let cancelled = false;
    geocode(sourceArticles)
      .then((next) => { if (!cancelled) setGeoResult({ source: sourceArticles, articles: next }); })
      .catch(() => { if (!cancelled) setGeoResult({ source: sourceArticles, articles: sourceArticles }); });
    return () => { cancelled = true; };
  }, [isMapOpen, geocode, sourceArticles]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(
    () => placedArticles.slice().sort((a, b) => articleDateValue(a) - articleDateValue(b)),
    [placedArticles]
  );
  const selectedIdx = selectedId == null ? -1 : order.findIndex((a) => isSameArticleId(a.id, selectedId));
  const selectedArticle = selectedIdx >= 0 ? order[selectedIdx] : null;
  const navProgress = selectedArticle ? { current: selectedIdx + 1, total: order.length } : null;

  const selectArticle = useCallback((article, { focus = false } = {}) => {
    const id = article?.id ?? article?.data?.id ?? null;
    if (!confirmDiscardEdit()) return;
    setSelectedId(id);
    if (id != null) setIsOverviewOpen(false);
    if (focus && id != null) timelineRef.current?.focusArticle?.(id);
  }, [confirmDiscardEdit]);
  const closeDetails = useCallback(() => {
    editDirtyRef.current = false;
    setSelectedId(null);
  }, []);
  const stepEvent = (delta) => {
    if (selectedIdx < 0) return;
    const target = order[Math.min(order.length - 1, Math.max(0, selectedIdx + delta))];
    if (target) selectArticle(target, { focus: true });
  };

  // Escape closes the details first (or just the photo viewer on top of them) before the Studio
  // reacts: the Studio's own Escape handler skips events marked as handled.
  useEffect(() => {
    if (!selectedArticle && !isOverviewOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      // While writing the overview, Escape does nothing (Cancel closes the editor) - and is
      // marked handled so the Studio doesn't close either.
      if (!selectedArticle && document.activeElement?.closest?.('[data-testid="overview-editor"]')) return;
      // The drawer's photo viewer is a second modal dialog and closes itself on Escape.
      if (document.querySelectorAll('[aria-modal="true"]').length > 1) return;
      if (!selectedArticle) {
        setIsOverviewOpen(false);
        return;
      }
      if (confirmDiscardEdit()) closeDetails();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedArticle, isOverviewOpen, closeDetails, confirmDiscardEdit]);

  const toggleMap = () => {
    setIsMapOpen((open) => {
      try { localStorage.setItem(MAP_PREF_KEY, open ? '0' : '1'); } catch { /* ignore */ }
      return !open;
    });
  };

  if (!articles.length) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center">
        <p className="text-sm text-ink-muted" dir="auto">{emptyLabel}</p>
      </div>
    );
  }

  const drawerWidth = getDrawerWidth(paneWidth);
  const showDrawer = Boolean(selectedArticle);
  const showOverview = isOverviewOpen && !showDrawer;
  const canEdit = typeof onSaveEvent === 'function';
  const toggleOverview = () => {
    if (!isOverviewOpen && !confirmDiscardEdit()) return;
    if (!isOverviewOpen) setSelectedId(null);
    setIsOverviewOpen((open) => !open);
  };
  const hasPlacedEvents = placedArticles.some(hasCoords);

  return (
    <div ref={paneRef} className="relative h-full w-full flex flex-col" data-testid="studio-canvas-preview">
      {isMapOpen && (
        <div className="relative isolate h-[40%] min-h-[180px] shrink-0 border-b border-line" data-testid="studio-preview-map">
          <Suspense fallback={<div className="w-full h-full bg-surface-sunken animate-pulse" />}>
            <GeoMapView
              articles={placedArticles}
              lanes={lanes}
              selectedArticleId={selectedArticle?.id ?? null}
              onSelectArticle={(a) => selectArticle(a, { focus: true })}
              onOpenDetails={(a) => selectArticle(a, { focus: true })}
              onFocusArticle={(a) => { const id = a?.id ?? a?.data?.id; if (id != null) timelineRef.current?.focusArticle?.(id); }}
              onNavigate={(from, delta) => {
                const idx = order.findIndex((a) => isSameArticleId(a.id, from?.id));
                const target = order[Math.min(order.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + delta))];
                if (target) selectArticle(target, { focus: true });
              }}
              theme={theme}
              tileProvider={ACTIVE_TILE_PROVIDER}
              isMobile={isNarrowViewport}
              showEventCard={false}
            />
          </Suspense>
          {(isLocating || !hasPlacedEvents) && (
            <div className="absolute bottom-2 inset-x-0 z-[1000] flex justify-center px-3 pointer-events-none">
              <p className="inline-flex items-center gap-2 max-w-[90%] px-3 py-2 rounded-full bg-surface-overlay/95 border border-line shadow-sm text-caption text-ink-muted text-center" dir="auto">
                {isLocating && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                {t(isLocating ? 'storyStudio.previewMapLocating' : 'storyStudio.previewMapNoPlaces')}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="relative isolate flex-1 min-h-0">
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <TimelineView
            ref={timelineRef}
            timelineData={timeline}
            theme={theme}
            visualTheme={visualTheme}
            selectedArticleId={selectedId}
            onSelectArticle={(article) => selectArticle(article)}
            starredArticleIds={EMPTY_SET}
            isNarrowViewport={isNarrowViewport}
            forceDesktopCanvas={!isNarrowViewport}
            leftOcclusion={(showDrawer || showOverview) && !isNarrowViewport ? drawerWidth : 0}
          />
        </Suspense>
      </div>

      {/* Left of the map button: the overview of the story, as the Overview panel will show it. */}
      <button
        type="button"
        onClick={toggleOverview}
        aria-pressed={showOverview}
        aria-label={t('storyStudio.previewOverviewShow')}
        title={t('storyStudio.previewOverviewShow')}
        className={`absolute top-2 right-20 z-10 p-2 rounded-control border shadow-sm transition-colors cursor-pointer ${
          showOverview ? 'bg-accent-soft border-accent text-accent' : 'bg-surface-overlay/90 border-line text-ink-muted hover:text-ink'
        }`}
        data-testid="studio-preview-overview-toggle"
      >
        <BookOpen className="w-3.5 h-3.5" />
      </button>

      {/* Beside the Studio's expand button. Physical right in both directions: the details drawer is always on the left. */}
      <button
        type="button"
        onClick={toggleMap}
        aria-pressed={isMapOpen}
        aria-label={t(isMapOpen ? 'storyStudio.previewMapHide' : 'storyStudio.previewMapShow')}
        title={t(isMapOpen ? 'storyStudio.previewMapHide' : 'storyStudio.previewMapShow')}
        className={`absolute top-2 right-11 z-10 p-2 rounded-control border shadow-sm transition-colors cursor-pointer ${
          isMapOpen ? 'bg-accent-soft border-accent text-accent' : 'bg-surface-overlay/90 border-line text-ink-muted hover:text-ink'
        }`}
        data-testid="studio-preview-map-toggle"
      >
        <MapIcon className="w-3.5 h-3.5" />
      </button>

      {showDrawer && (
        <Suspense fallback={null}>
          <EventDrawer
            article={selectedArticle}
            lanes={lanes}
            articles={placedArticles}
            timelineTitle={timeline?.title || ''}
            timelineTags={timeline?.tags || []}
            timelineTimeScale={timeline?.timeScale || 'calendar'}
            isTimelineFictional={Boolean(timeline?.isFictional)}
            isTimelinePersonal
            readOnly={!canEdit}
            timelineId={timelineId}
            onSaveEdit={canEdit ? onSaveEvent : undefined}
            onEditDirtyChange={(dirty) => { editDirtyRef.current = dirty; }}
            onDelete={onDeleteEvent ? (id) => { if (onDeleteEvent(id)) closeDetails(); } : undefined}
            onClose={closeDetails}
            navProgress={navProgress}
            onNavigateNext={() => stepEvent(1)}
            onNavigatePrev={() => stepEvent(-1)}
            lightboxZIndex={LIGHTBOX_Z}
            style={{ left: 0, top: 0, bottom: 0, width: drawerWidth, zIndex: 20 }}
          />
        </Suspense>
      )}

      {showOverview && (
        <Suspense fallback={null}>
          <TimelineOverviewPanel
            timeline={timeline}
            isOpen
            onClose={() => setIsOverviewOpen(false)}
            onSaveOverview={onSaveOverview}
            renderEditorTools={renderOverviewTools}
            style={{ left: 0, top: 0, bottom: 0, width: drawerWidth, zIndex: 20 }}
          />
        </Suspense>
      )}
    </div>
  );
}
