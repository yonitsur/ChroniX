import React, { useState, useRef, useEffect } from 'react';
import {
  Map,
  Columns2,
  Maximize2,
  Minimize2,
  X,
  MapPin,
  GripHorizontal,
  GripVertical
} from 'lucide-react';
import GeoMapView from './GeoMapView';
import { useLanguage } from '../context/LanguageContext';
import { useFloatingFocus, FLOATING_Z } from '../utils/floatingFocus';

/**
 * FloatingMapWidget:
 * Draggable and Resizable Picture-in-Picture (PiP) & Floating Globe widget:
 * 1. 'icon': Floating Earth/Globe icon button (draggable anywhere on screen)
 * 2. 'pip': Compact floating map window (draggable by header bar AND resizable by edges/corners)
 * 3. 'full': Full-screen map view with floating controls to return to PiP, Split, or Icon
 */
export default function FloatingMapWidget({
  articles = [],
  lanes = [],
  selectedArticleId,
  onSelectArticle,
  onOpenDetails,
  onFocusArticle,
  theme = 'light',
  mapMode = 'icon', // 'icon' | 'pip' | 'split' | 'full'
  onModeChange,
  activeFilter = null,
  filterStarredOnly = false,
  starredArticleIds = null,
  tileProvider = 'osm',
  isExploring = false,
  isMobile
}) {
  const { t, isRtl } = useLanguage();
  const { zIndex: mapZ, raise: raiseMap } = useFloatingFocus('map', FLOATING_Z.MAP_BASE);
  const geoCount = (articles || []).filter(
    (a) => a.lat != null && a.lng != null && !isNaN(parseFloat(a.lat)) && !isNaN(parseFloat(a.lng))
  ).length;

  // Position state for Earth icon: null = default top-right
  const [iconPos, setIconPos] = useState(null);
  const iconRef = useRef(null);
  const isDraggingIconRef = useRef(false);
  const iconDragDataRef = useRef({ startX: 0, startY: 0, initialLeft: 0, initialTop: 0, moved: false });

  // Position & Size state for PiP window: null = default top-right
  const [pipPos, setPipPos] = useState(null);
  const pipRef = useRef(null);
  const [isDraggingPip, setIsDraggingPip] = useState(false);
  const pipDragDataRef = useRef({ startX: 0, startY: 0, initialLeft: 0, initialTop: 0 });

  // Size state for PiP window (resizable)
  const [pipSize, setPipSize] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_pip_size');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.width && parsed.height) return parsed;
      }
    } catch (e) {}
    return { width: 420, height: 290 };
  });
  const [isResizingPip, setIsResizingPip] = useState(false);

  // Keep elements inside screen boundaries on window resize
  useEffect(() => {
    const handleResize = () => {
      if (iconRef.current && iconPos) {
        const rect = iconRef.current.getBoundingClientRect();
        setIconPos({
          x: Math.max(10, Math.min(window.innerWidth - rect.width - 10, iconPos.x)),
          y: Math.max(70, Math.min(window.innerHeight - rect.height - 10, iconPos.y))
        });
      }
      if (pipRef.current && pipPos) {
        const rect = pipRef.current.getBoundingClientRect();
        setPipPos({
          x: Math.max(10, Math.min(window.innerWidth - rect.width - 10, pipPos.x)),
          y: Math.max(70, Math.min(window.innerHeight - rect.height - 10, pipPos.y))
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [iconPos, pipPos]);

  // --- Handlers for Earth Icon Dragging ---
  const handleIconPointerDown = (e) => {
    if (e.button !== 0) return; // only left-click
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;

    iconDragDataRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
      moved: false
    };

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - iconDragDataRef.current.startX;
      const dy = moveEvent.clientY - iconDragDataRef.current.startY;

      if (!iconDragDataRef.current.moved && Math.hypot(dx, dy) > 4) {
        iconDragDataRef.current.moved = true;
        isDraggingIconRef.current = true;
      }

      if (iconDragDataRef.current.moved) {
        const btnWidth = rect.width;
        const btnHeight = rect.height;
        const nextX = Math.max(10, Math.min(window.innerWidth - btnWidth - 10, iconDragDataRef.current.initialLeft + dx));
        const nextY = Math.max(70, Math.min(window.innerHeight - btnHeight - 10, iconDragDataRef.current.initialTop + dy));

        setIconPos({ x: nextX, y: nextY });
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setTimeout(() => {
        isDraggingIconRef.current = false;
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleIconClick = (e) => {
    // If it was a drag gesture, do not trigger opening PiP
    if (isDraggingIconRef.current || iconDragDataRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onModeChange?.('pip');
  };

  // --- Handlers for PiP Window Dragging (by Header) ---
  const handlePipHeaderPointerDown = (e) => {
    if (e.target.closest('button')) return; // do not drag when clicking action buttons
    if (e.button !== 0) return;

    const rect = pipRef.current?.getBoundingClientRect();
    if (!rect) return;

    pipDragDataRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: rect.left,
      initialTop: rect.top
    };

    setIsDraggingPip(true);

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - pipDragDataRef.current.startX;
      const dy = moveEvent.clientY - pipDragDataRef.current.startY;

      const pipWidth = rect.width;
      const pipHeight = rect.height;
      const nextX = Math.max(10, Math.min(window.innerWidth - pipWidth - 10, pipDragDataRef.current.initialLeft + dx));
      const nextY = Math.max(70, Math.min(window.innerHeight - pipHeight - 10, pipDragDataRef.current.initialTop + dy));

      setPipPos({ x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setIsDraggingPip(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // --- Handlers for PiP Window Resizing (Corners & Edges) ---
  const handleResizePointerDown = (e, direction) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = pipSize.width;
    const startHeight = pipSize.height;
    const rect = pipRef.current?.getBoundingClientRect();
    const initialLeft = rect ? rect.left : window.innerWidth - startWidth - 20;
    const initialTop = rect ? rect.top : 76;

    setIsResizingPip(true);
    let latestSize = { width: startWidth, height: startHeight };

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = null;

      if (direction.includes('w')) {
        // Dragging left edge: width expands to the left
        newWidth = Math.max(260, Math.min(window.innerWidth - 40, startWidth - dx));
        const diff = newWidth - startWidth;
        newLeft = Math.max(10, initialLeft - diff);
      } else if (direction.includes('e')) {
        // Dragging right edge
        newWidth = Math.max(260, Math.min(window.innerWidth - 40, startWidth + dx));
      }

      if (direction.includes('s')) {
        // Dragging bottom edge
        newHeight = Math.max(180, Math.min(window.innerHeight - 90, startHeight + dy));
      }

      latestSize = { width: newWidth, height: newHeight };
      setPipSize(latestSize);

      if (newLeft !== null) {
        setPipPos({ x: newLeft, y: initialTop });
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setIsResizingPip(false);
      try {
        localStorage.setItem('chronix_pip_size', JSON.stringify(latestSize));
      } catch (err) {}
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // If in 'split', the split layout is rendered in App.jsx, so we don't render PiP or Full here
  if (mapMode === 'split') {
    return null;
  }

  // State 1: Floating Earth / Globe Icon Button (Draggable)
  if (mapMode === 'icon') {
    return (
      <div
        ref={iconRef}
        onPointerDown={handleIconPointerDown}
        style={{
          ...(iconPos
            ? {
                left: `${iconPos.x}px`,
                top: `${iconPos.y}px`,
                bottom: 'auto',
                right: 'auto',
                touchAction: 'none'
              }
            : {
                top: '108px',
                right: '20px',
                bottom: 'auto',
                touchAction: 'none'
              }),
          zIndex: mapZ
        }}
        onPointerDownCapture={raiseMap}
        className="fixed flex items-center select-none cursor-grab active:cursor-grabbing animate-in fade-in zoom-in-90 duration-200"
      >
        <button
          type="button"
          onClick={handleIconClick}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-panel bg-surface-raised hover:bg-surface-hover text-ink shadow-panel border border-line hover:border-line-strong active:scale-95 transition-all cursor-grab active:cursor-grabbing group"
          title={t('floatingMap.earthTooltip', { count: geoCount })}
          aria-label={t('floatingMap.earthTooltip', { count: geoCount })}
        >
          <GripVertical className="w-3 h-3 text-ink-subtle opacity-70 group-hover:opacity-100 transition-opacity pointer-events-none shrink-0" />
          <Map className="w-4 h-4 text-accent group-hover:rotate-12 transition-transform duration-300 pointer-events-none shrink-0" />

          {geoCount > 0 && (
            <span className="flex items-center gap-0.5 bg-surface-sunken text-ink text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-line pointer-events-none">
              <MapPin className="w-2.5 h-2.5 text-danger" />
              {geoCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  // State 2: Picture-in-Picture (PiP) Floating Compact Window (Draggable & Resizable)
  if (mapMode === 'pip') {
    return (
      <div
        ref={pipRef}
        style={{
          ...(pipPos
            ? {
                left: `${pipPos.x}px`,
                top: `${pipPos.y}px`,
                bottom: 'auto',
                right: 'auto'
              }
            : {
                top: '76px',
                right: '20px',
                bottom: 'auto'
              }),
          width: `${pipSize.width}px`,
          height: `${pipSize.height}px`,
          zIndex: mapZ
        }}
        onPointerDownCapture={raiseMap}
        className={`fixed min-w-[260px] min-h-[180px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-80px)] bg-surface border border-line rounded-panel shadow-panel overflow-hidden flex flex-col select-none ${
          isDraggingPip || isResizingPip
            ? 'border-accent shadow-panel'
            : 'animate-in fade-in zoom-in-95 duration-200'
        }`}
      >
        {/* PiP Header Bar - Acts as Drag Handle */}
        <div
          onPointerDown={handlePipHeaderPointerDown}
          style={{ touchAction: 'none' }}
          className="flex items-center justify-between px-3.5 py-2 bg-surface-raised border-b border-line shrink-0 cursor-grab active:cursor-grabbing select-none"
          title={t('floatingMap.pipTooltip')}
        >
          {/* Title, Grip Indicator & Count Badge */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onDoubleClick={() => onModeChange?.('full')}
            title={t('floatingMap.fullTooltip')}
          >
            <GripHorizontal className="w-3.5 h-3.5 text-ink-subtle group-hover:text-accent transition-colors" />
            <div className="p-1 rounded-control bg-accent-soft text-accent group-hover:scale-110 transition-transform">
              <Map className="w-3.5 h-3.5" />
            </div>
            {geoCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-control bg-surface-sunken text-ink-muted">
                {t('floatingMap.locationsCount', { count: geoCount })}
              </span>
            )}
          </div>

          {/* Action buttons: Split | Full Screen | Minimize to Icon */}
          <div
            className="flex items-center gap-1 cursor-default"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Split Screen button */}
            <button
              type="button"
              onClick={() => onModeChange?.('split')}
              className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-hover rounded-control transition-colors cursor-pointer"
              title={t('floatingMap.splitTooltip')}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>

            {/* Maximize to Full Screen */}
            <button
              type="button"
              onClick={() => onModeChange?.('full')}
              className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-hover rounded-control transition-colors cursor-pointer"
              title={t('floatingMap.fullTooltip')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Close: Minimize to Earth Icon */}
            <button
              type="button"
              onClick={() => onModeChange?.('icon')}
              className="p-1.5 text-ink-muted hover:text-danger hover:bg-danger-soft rounded-control transition-colors cursor-pointer"
              title={t('floatingMap.closeTooltip')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* PiP Map View Body */}
        <div className="flex-1 relative w-full h-full min-h-0">
          <GeoMapView
            articles={articles}
            lanes={lanes}
            selectedArticleId={selectedArticleId}
            onSelectArticle={onSelectArticle}
            onFocusArticle={onFocusArticle}
            onOpenDetails={onOpenDetails}
            theme={theme}
            className="w-full h-full"
            activeFilter={activeFilter}
            filterStarredOnly={filterStarredOnly}
            starredArticleIds={starredArticleIds}
            tileProvider={tileProvider}
            isExploring={isExploring}
            isMobile={isMobile}
            hasRightDrawer={false}
          />

          {/* Resize Handles Overlay */}
          {/* Left Edge Resize */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'w')}
            style={{ touchAction: 'none' }}
            className="absolute left-0 top-0 bottom-5 w-2 z-30 cursor-w-resize hover:bg-accent/20 transition-colors"
            title={t('floatingMap.resizeTooltip')}
          />

          {/* Bottom Edge Resize */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 's')}
            style={{ touchAction: 'none' }}
            className="absolute bottom-0 left-6 right-6 h-2 z-30 cursor-s-resize hover:bg-accent/20 transition-colors"
            title={t('floatingMap.resizeTooltip')}
          />

          {/* Bottom-Left Corner Resize Handle (Primary expand direction) */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
            style={{ touchAction: 'none' }}
            className="absolute bottom-0 left-0 w-6 h-6 z-30 cursor-sw-resize flex items-end justify-start p-1 text-ink-subtle hover:text-accent transition-colors group/corner"
            title={t('floatingMap.resizeTooltip')}
          >
            <div className="w-2.5 h-2.5 border-b-2 border-l-2 border-line-strong group-hover/corner:border-accent transition-colors" />
          </div>

          {/* Bottom-Right Corner Resize Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
            style={{ touchAction: 'none' }}
            className="absolute bottom-0 right-0 w-6 h-6 z-30 cursor-se-resize flex items-end justify-end p-1 text-ink-subtle hover:text-accent transition-colors group/corner"
            title={t('floatingMap.resizeTooltip')}
          >
            <div className="w-2.5 h-2.5 border-b-2 border-r-2 border-line-strong group-hover/corner:border-accent transition-colors" />
          </div>
        </div>
      </div>
    );
  }

  // State 3: Full-Screen Map Overlay (confined to the <main> area, never covers the top bar)
  if (mapMode === 'full') {
    return (
      <div className="absolute inset-0 z-40 bg-surface-sunken/80 flex flex-col animate-in fade-in duration-150">
        {/* Top Floating Control Bar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-surface-raised px-3.5 py-1.5 rounded-panel shadow-panel border border-line select-none">
          {/* Title */}
          <div className="flex items-center gap-2 pr-2 border-r border-line">
            <Map className="w-4 h-4 text-accent" />
            <span className="text-xs font-bold text-ink">
              {t('floatingMap.title')}
            </span>
            {geoCount > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-soft text-accent">
                {t('floatingMap.locationsCount', { count: geoCount })}
              </span>
            )}
          </div>

          {/* Action: Switch to PiP */}
          <button
            type="button"
            onClick={() => onModeChange?.('pip')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('floatingMap.pipTooltip')}
          >
            <Minimize2 className="w-3.5 h-3.5 text-ink-subtle" />
            <span>PiP</span>
          </button>

          {/* Action: Switch to Split */}
          <button
            type="button"
            onClick={() => onModeChange?.('split')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('floatingMap.splitTooltip')}
          >
            <Columns2 className="w-3.5 h-3.5 text-ink-subtle" />
            <span>Split</span>
          </button>

          {/* Action: Close / Return to Pure Timeline */}
          <button
            type="button"
            onClick={() => onModeChange?.('icon')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium text-danger hover:bg-danger-soft transition-colors cursor-pointer"
            title={t('floatingMap.closeTooltip')}
          >
            <X className="w-3.5 h-3.5" />
            <span>{t('common.close')}</span>
          </button>
        </div>

        {/* Full-Screen Map Container */}
        <div className="w-full h-full relative">
          <GeoMapView
            articles={articles}
            lanes={lanes}
            selectedArticleId={selectedArticleId}
            onSelectArticle={onSelectArticle}
            onFocusArticle={onFocusArticle}
            onOpenDetails={onOpenDetails}
            theme={theme}
            className="w-full h-full"
            activeFilter={activeFilter}
            filterStarredOnly={filterStarredOnly}
            starredArticleIds={starredArticleIds}
            tileProvider={tileProvider}
            isExploring={isExploring}
            isMobile={isMobile}
            hasRightDrawer={false}
          />
        </div>
      </div>
    );
  }

  return null;
}
