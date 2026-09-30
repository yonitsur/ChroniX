import React, { useState, useRef, useEffect } from 'react';
import {
  Map,
  Columns2,
  Maximize2,
  Minimize2,
  X,
  GripHorizontal,
  GripVertical
} from 'lucide-react';
import GeoMapView, { ACTIVE_TILE_PROVIDER } from './GeoMapView';
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
  hoveredArticleId = null,
  onHoverArticle,
  timelineId = null,
  onSelectArticle,
  onOpenDetails,
  onFocusArticle,
  theme = 'light',
  mapMode = 'icon', // 'icon' | 'pip' | 'split' | 'full'
  onModeChange,
  activeFilter = null,
  filterStarredOnly = false,
  starredArticleIds = null,
  tileProvider = ACTIVE_TILE_PROVIDER,
  isExploring = false,
  isMobile,
  hasLeftDrawer = false,
  isWideDesktop = true,
  leftDockWidth = 52,
  leftDrawerWidth = 440,
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
  const [isDraggingIcon, setIsDraggingIcon] = useState(false);
  const [isCapsuleHovered, setIsCapsuleHovered] = useState(false);
  const iconDragDataRef = useRef({ startX: 0, startY: 0, initialLeft: 0, initialTop: 0, moved: false });

  // Position & Size state for PiP window: null = default top-right
  const [pipPos, setPipPos] = useState(null);
  const pipRef = useRef(null);
  const [isDraggingPip, setIsDraggingPip] = useState(false);
  const pipDragDataRef = useRef({ startX: 0, startY: 0, initialLeft: 0, initialTop: 0 });

  // Size state for PiP window (resizable)
  const [pipSize, setPipSize] = useState({ width: 440, height: 300 });
  const [isResizingPip, setIsResizingPip] = useState(false);

  // Reset positions and size to defaults when timeline changes
  useEffect(() => {
    setIconPos(null);
    setPipPos(null);
    setPipSize({ width: 440, height: 300 });
  }, [timelineId]);

  // Keep elements inside screen boundaries on window resize
  useEffect(() => {
    const handleResize = () => {
      if (iconRef.current && iconPos) {
        const btnWidth = iconPos.width || 52;
        const btnHeight = iconPos.height || 38;
        setIconPos((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            x: Math.max(10, Math.min(window.innerWidth - btnWidth - 10, prev.x)),
            y: Math.max(10, Math.min(window.innerHeight - btnHeight - 10, prev.y))
          };
        });
      }
      if (pipRef.current && pipPos) {
        const rect = pipRef.current.getBoundingClientRect();
        setPipPos({
          x: Math.max(10, Math.min(window.innerWidth - rect.width - 10, pipPos.x)),
          y: Math.max(10, Math.min(window.innerHeight - rect.height - 10, pipPos.y))
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [iconPos, pipPos]);

  // --- Handlers for Earth Icon Dragging ---
  const handleIconPointerDown = (e) => {
    // If clicking a quick mode action button, let the button handle it without drag
    if (e.target.closest('button[data-mode-action]')) return;
    if (e.button !== 0) return; // only left-click
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Compact resting width of the pill (Grip + Map)
    const compactWidth = 52;
    // In RTL when expanded, rect.left shifted to the left by the mode buttons width.
    // Calculate the resting left so mouse delta tracks the compact pill naturally.
    const isCurrentlyExpanded = iconRef.current.querySelector('[data-mode-actions-cluster]')?.offsetWidth > 0;
    const effectiveLeft = isCurrentlyExpanded ? (rect.right - compactWidth) : rect.left;

    iconDragDataRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: effectiveLeft,
      initialTop: rect.top,
      width: compactWidth,
      height: rect.height,
      moved: false
    };

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - iconDragDataRef.current.startX;
      const dy = moveEvent.clientY - iconDragDataRef.current.startY;

      if (!iconDragDataRef.current.moved && Math.hypot(dx, dy) > 4) {
        iconDragDataRef.current.moved = true;
        isDraggingIconRef.current = true;
        setIsDraggingIcon(true);
      }

      if (iconDragDataRef.current.moved) {
        const btnWidth = iconDragDataRef.current.width || 52;
        const btnHeight = iconDragDataRef.current.height || 38;
        const maxAllowedX = Math.max(10, window.innerWidth - btnWidth - 10);
        const nextX = Math.max(10, Math.min(maxAllowedX, iconDragDataRef.current.initialLeft + dx));
        const nextY = Math.max(10, Math.min(window.innerHeight - btnHeight - 10, iconDragDataRef.current.initialTop + dy));

        setIconPos({ x: nextX, y: nextY, width: btnWidth, height: btnHeight });
      }
    };

    const finishDrag = () => {
      const didDrag = iconDragDataRef.current.moved;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      setIsDraggingIcon(false);
      setTimeout(() => {
        isDraggingIconRef.current = false;
        if (didDrag) {
          iconDragDataRef.current.moved = false;
        }
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  };

  const handleModeClick = (e, targetMode) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDraggingIconRef.current || iconDragDataRef.current.moved) return;
    onModeChange?.(targetMode);
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
      const nextY = Math.max(10, Math.min(window.innerHeight - pipHeight - 10, pipDragDataRef.current.initialTop + dy));

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
    const initialTop = rect ? rect.top : 38;

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
        newWidth = Math.max(280, Math.min(window.innerWidth - 40, startWidth - dx));
        const diff = newWidth - startWidth;
        newLeft = Math.max(10, initialLeft - diff);
      } else if (direction.includes('e')) {
        // Dragging right edge
        newWidth = Math.max(280, Math.min(window.innerWidth - 40, startWidth + dx));
      }

      if (direction.includes('s')) {
        // Dragging bottom edge
        newHeight = Math.max(190, Math.min(window.innerHeight - 90, startHeight + dy));
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
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // If in 'split', the split layout is rendered in App.jsx
  if (mapMode === 'split') {
    return null;
  }

  // State 1: Floating Earth / Globe Mode Capsule (Expandable Frosted Glass Pill)
  if (mapMode === 'icon') {
    if (isMobile) return null;

    const btnWidth = iconPos?.width || 52;
    // When the capsule is in the right half of the screen (or default), anchor to `right`!
    // This ensures that when the mode buttons expand on the left, the right edge (Grip & Map icon)
    // stays 100% stable, and the capsule expands inward to the left without pushing anything to the right!
    const isRightAnchored = !iconPos || (iconPos.x > (window.innerWidth - btnWidth) / 2);

    const positionStyle = iconPos
      ? isRightAnchored
        ? {
            top: `${iconPos.y}px`,
            right: `${Math.max(10, window.innerWidth - iconPos.x - btnWidth)}px`,
            left: 'auto',
            bottom: 'auto',
            touchAction: 'none'
          }
        : {
            top: `${iconPos.y}px`,
            left: `${iconPos.x}px`,
            right: 'auto',
            bottom: 'auto',
            touchAction: 'none'
          }
      : {
          top: '38px',
          right: '20px',
          left: 'auto',
          bottom: 'auto',
          touchAction: 'none'
        };

    const showQuickModes = isCapsuleHovered && !isDraggingIcon;

    return (
      <div
        ref={iconRef}
        onPointerDown={handleIconPointerDown}
        onMouseEnter={() => setIsCapsuleHovered(true)}
        onMouseLeave={() => setIsCapsuleHovered(false)}
        style={{
          ...positionStyle,
          zIndex: mapZ
        }}
        onPointerDownCapture={raiseMap}
        className="fixed flex items-center select-none animate-in fade-in zoom-in-90 duration-200 group/map-capsule"
      >
        <div
          className={`relative flex items-center p-1 rounded-xl bg-surface-raised/90 backdrop-blur-2xl border transition-[border-color,box-shadow,transform] duration-200 ${
            isDraggingIcon
              ? 'cursor-grabbing border-line-strong shadow-panel scale-[1.02]'
              : 'border-line shadow-pop hover:border-line-strong'
          }`}
        >
          {/* Draggable Map Anchor (Grip + Map Icon - purely draggable, no competing click) */}
          <div
            className="flex items-center gap-1.5 px-2 py-1 cursor-grab active:cursor-grabbing text-ink-subtle hover:text-ink transition-colors shrink-0 select-none"
            title={t('floatingMap.earthDragging') || 'גרור למיקום מחדש'}
          >
            <GripVertical className="w-3.5 h-3.5 pointer-events-none opacity-60 group-hover/map-capsule:opacity-100 transition-opacity" />
            <Map className="w-4 h-4 text-ink pointer-events-none shrink-0" />
          </div>

          {/* Expandable Mode Actions Cluster: PiP | Split | Full Screen */}
          <div
            data-mode-actions-cluster
            className={`flex items-center overflow-hidden transition-all duration-300 ease-out ${
              showQuickModes
                ? 'max-w-[170px] opacity-100 pointer-events-auto'
                : 'max-w-0 opacity-0 pointer-events-none'
            } ${
              !isDraggingIcon
                ? 'group-hover/map-capsule:max-w-[170px] group-hover/map-capsule:opacity-100 group-hover/map-capsule:pointer-events-auto focus-within:max-w-[170px] focus-within:opacity-100 focus-within:pointer-events-auto'
                : ''
            }`}
          >
            {/* Divider */}
            <div className="w-px h-4 bg-line-strong/70 mx-1 shrink-0" />

            {/* Segmented Quick Actions */}
            <div className="flex items-center gap-0.5 bg-surface-hover/60 p-0.5 rounded-lg border border-line shrink-0">
              {/* Action: PiP */}
              <button
                type="button"
                data-mode-action="pip"
                onClick={(e) => handleModeClick(e, 'pip')}
                className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-raised rounded-md transition-colors active:scale-90 cursor-pointer group/btn"
                title={t('floatingMap.pipTooltip')}
                aria-label={t('floatingMap.pipTooltip')}
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>

              {/* Action: Split */}
              <button
                type="button"
                data-mode-action="split"
                onClick={(e) => handleModeClick(e, 'split')}
                className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-raised rounded-md transition-colors active:scale-90 cursor-pointer group/btn"
                title={t('floatingMap.splitTooltip')}
                aria-label={t('floatingMap.splitTooltip')}
              >
                <Columns2 className="w-3.5 h-3.5" />
              </button>

              {/* Action: Full Screen */}
              <button
                type="button"
                data-mode-action="full"
                onClick={(e) => handleModeClick(e, 'full')}
                className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-raised rounded-md transition-colors active:scale-90 cursor-pointer group/btn"
                title={t('floatingMap.fullTooltip')}
                aria-label={t('floatingMap.fullTooltip')}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Picture-in-Picture (PiP) Floating Compact Window (Frosted Glass Chassis)
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
                top: isMobile ? 'calc(60px + env(safe-area-inset-top, 0px))' : '38px',
                right: isMobile ? '12px' : '20px',
                bottom: 'auto',
                left: 'auto'
              }),
          width: `${pipSize.width}px`,
          height: `${pipSize.height}px`,
          zIndex: mapZ
        }}
        onPointerDownCapture={raiseMap}
        className={`fixed min-w-[280px] min-h-[190px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-80px)] bg-surface-raised backdrop-blur-2xl border rounded-xl shadow-panel overflow-hidden flex flex-col select-none ${
          isDraggingPip || isResizingPip
            ? 'border-line-strong'
            : 'border-line animate-in fade-in zoom-in-95 duration-200'
        }`}
      >
        {/* PiP Header Bar - Frosted Drag Handle */}
        <div
          onPointerDown={handlePipHeaderPointerDown}
          style={{ touchAction: 'none' }}
          className="flex items-center justify-between px-3.5 py-2 bg-surface-raised/85 backdrop-blur-md border-b border-line shrink-0 cursor-grab active:cursor-grabbing select-none"
          title={t('floatingMap.pipTooltip')}
        >
          {/* Title & Grip Indicator */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onDoubleClick={() => onModeChange?.('full')}
            title={t('floatingMap.fullTooltip')}
          >
            <GripHorizontal className="w-3.5 h-3.5 text-ink-subtle group-hover:text-ink transition-colors" />
            <div className="p-1 rounded-lg bg-accent-soft text-accent">
              <Map className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-1.5">
              {geoCount > 0 && (
                <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-surface-hover text-ink-muted border border-line">
                  {geoCount}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons: Split | Full Screen | Minimize to Icon */}
          <div
            className="flex items-center gap-1 cursor-default bg-surface-hover/60 p-0.5 rounded-lg border border-line"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Split Screen button */}
            <button
              type="button"
              onClick={() => onModeChange?.('split')}
              className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
              title={t('floatingMap.splitTooltip')}
              aria-label={t('floatingMap.splitTooltip')}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>

            {/* Maximize to Full Screen */}
            <button
              type="button"
              onClick={() => onModeChange?.('full')}
              className="p-1.5 text-ink-muted hover:text-accent hover:bg-surface-raised rounded-md transition-all cursor-pointer"
              title={t('floatingMap.fullTooltip')}
              aria-label={t('floatingMap.fullTooltip')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Close: Minimize to Earth Icon */}
            <button
              type="button"
              onClick={() => onModeChange?.('icon')}
              className="p-1.5 text-ink-muted hover:text-danger hover:bg-danger-soft rounded-md transition-all cursor-pointer"
              title={t('floatingMap.closeTooltip')}
              aria-label={t('floatingMap.closeTooltip')}
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
            hoveredArticleId={hoveredArticleId}
            onHoverArticle={onHoverArticle}
            timelineId={timelineId}
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
            className="absolute bottom-0 left-0 w-6 h-6 z-30 cursor-sw-resize flex items-end justify-start p-1.5 text-ink-subtle hover:text-accent transition-colors group/corner"
            title={t('floatingMap.resizeTooltip')}
          >
            <div className="w-2.5 h-2.5 border-b-2 border-l-2 border-line-strong group-hover/corner:border-accent transition-colors" />
          </div>

          {/* Bottom-Right Corner Resize Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
            style={{ touchAction: 'none' }}
            className="absolute bottom-0 right-0 w-6 h-6 z-30 cursor-se-resize flex items-end justify-end p-1.5 text-ink-subtle hover:text-accent transition-colors group/corner"
            title={t('floatingMap.resizeTooltip')}
          >
            <div className="w-2.5 h-2.5 border-b-2 border-r-2 border-line-strong group-hover/corner:border-accent transition-colors" />
          </div>
        </div>
      </div>
    );
  }

  // State 3: Full-Screen Map Overlay (Frosted Header Pill)
  if (mapMode === 'full') {
    const desktopLeft = isWideDesktop && hasLeftDrawer
      ? leftDockWidth + leftDrawerWidth
      : leftDockWidth;

    return (
      <div
        style={
          isMobile
            ? {
                top: 'calc(52px + env(safe-area-inset-top, 0px))',
                bottom: 'calc(52px + env(safe-area-inset-bottom, 0px))',
                left: 0,
                right: 0,
              }
            : {
                top: 0,
                bottom: 0,
                right: 0,
                left: `${desktopLeft}px`,
                transition: 'left 200ms ease-out',
              }
        }
        className={`absolute z-30 bg-surface-sunken/80 flex flex-col animate-in fade-in duration-150 transition-[left] duration-200 ease-out ${
          isMobile ? 'top-[calc(52px+env(safe-area-inset-top,0px))] bottom-[calc(52px+env(safe-area-inset-bottom,0px))] inset-x-0' : 'inset-y-0 right-0'
        }`}
      >
        {/* Top Floating Control Bar - Frosted Pill (Desktop only; mobile uses the unified top mode bar) */}
        {!isMobile && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-surface-raised/90 backdrop-blur-2xl px-3 py-1.5 rounded-full shadow-pop border border-line select-none animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Title & Count Badge */}
          <div className="flex items-center gap-2 pr-3 rtl:pr-0 rtl:pl-3 border-r rtl:border-r-0 rtl:border-l border-line">
            <div className="p-1 rounded-full bg-accent-soft text-accent">
              <Map className="w-3.5 h-3.5" />
            </div>
            {geoCount > 0 && (
              <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-surface-hover text-ink-muted border border-line">
                {geoCount}
              </span>
            )}
          </div>

          {/* Action: Switch to PiP */}
          <button
            type="button"
            onClick={() => onModeChange?.('pip')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-all cursor-pointer"
            title={t('floatingMap.pipTooltip')}
          >
            <Minimize2 className="w-3.5 h-3.5 text-ink-subtle" />
            <span>PiP</span>
          </button>

          {/* Action: Switch to Split */}
          <button
            type="button"
            onClick={() => onModeChange?.('split')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-all cursor-pointer"
            title={t('floatingMap.splitTooltip')}
          >
            <Columns2 className="w-3.5 h-3.5 text-ink-subtle" />
            <span>Split</span>
          </button>

          {/* Action: Close / Return to Pure Timeline */}
          <button
            type="button"
            onClick={() => onModeChange?.('icon')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-danger hover:bg-danger-soft transition-all cursor-pointer"
            title={t('floatingMap.closeTooltip')}
          >
            <X className="w-3.5 h-3.5" />
            <span>{t('common.close')}</span>
          </button>
        </div>
        )}

        {/* Full-Screen Map Container */}
        <div className="w-full h-full relative">
          <GeoMapView
            articles={articles}
            lanes={lanes}
            selectedArticleId={selectedArticleId}
            hoveredArticleId={hoveredArticleId}
            onHoverArticle={onHoverArticle}
            timelineId={timelineId}
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
