import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  Columns2,
  Maximize2,
  Minimize2,
  X,
  MapPin,
  GripHorizontal
} from 'lucide-react';
import GeoMapView from './GeoMapView';

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
  theme = 'light',
  mapMode = 'icon', // 'icon' | 'pip' | 'full' | 'split'
  onModeChange
}) {
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
        style={
          iconPos
            ? {
                left: `${iconPos.x}px`,
                top: `${iconPos.y}px`,
                bottom: 'auto',
                right: 'auto',
                touchAction: 'none'
              }
            : {
                top: '76px',
                right: '20px',
                bottom: 'auto',
                touchAction: 'none'
              }
        }
        className="fixed z-40 flex items-center select-none cursor-grab active:cursor-grabbing animate-in fade-in zoom-in-90 duration-200"
      >
        <button
          type="button"
          onClick={handleIconClick}
          className="relative flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-xl shadow-indigo-500/30 border border-white/25 hover:scale-105 active:scale-95 transition-all cursor-grab active:cursor-grabbing group"
          title="Drag to reposition • Click to open Floating Map"
        >
          {/* Animated glow ring */}
          <span className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 opacity-40 blur-xs group-hover:opacity-75 transition-opacity -z-10" />

          <Globe className="w-4 h-4 text-sky-100 group-hover:rotate-12 transition-transform duration-300 pointer-events-none" />

          {geoCount > 0 && (
            <span className="flex items-center gap-0.5 bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white/20 shadow-2xs pointer-events-none">
              <MapPin className="w-2.5 h-2.5" />
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
          height: `${pipSize.height}px`
        }}
        className={`fixed z-40 min-w-[260px] min-h-[180px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-80px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl shadow-slate-900/25 overflow-hidden flex flex-col select-none ring-1 ring-black/5 dark:ring-white/10 ${
          isDraggingPip || isResizingPip
            ? 'shadow-sky-500/25 ring-2 ring-sky-500/50'
            : 'animate-in fade-in zoom-in-95 duration-200'
        }`}
      >
        {/* PiP Header Bar - Acts as Drag Handle */}
        <div
          onPointerDown={handlePipHeaderPointerDown}
          className="flex items-center justify-between px-3.5 py-2 bg-slate-50/95 dark:bg-slate-800/95 border-b border-slate-200/90 dark:border-slate-700/80 backdrop-blur-md shrink-0 cursor-grab active:cursor-grabbing select-none"
          title="Drag header to move window"
        >
          {/* Title, Grip Indicator & Count Badge */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onDoubleClick={() => onModeChange?.('full')}
            title="Drag header to move • Double-click to maximize"
          >
            <GripHorizontal className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-500 transition-colors" />
            <div className="p-1 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform">
              <Globe className="w-3.5 h-3.5" />
            </div>
            {geoCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300">
                {geoCount} locations
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
              className="p-1.5 text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 rounded-lg transition-colors cursor-pointer"
              title="Switch to Split Screen"
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>

            {/* Maximize to Full Screen */}
            <button
              type="button"
              onClick={() => onModeChange?.('full')}
              className="p-1.5 text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 rounded-lg transition-colors cursor-pointer"
              title="Full Screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Minimize to Earth Icon */}
            <button
              type="button"
              onClick={() => onModeChange?.('icon')}
              className="p-1.5 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
              title="Minimize to Globe icon"
            >
              <Minimize2 className="w-3.5 h-3.5" />
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
            theme={theme}
            className="w-full h-full"
          />

          {/* Resize Handles Overlay */}
          {/* Left Edge Resize */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'w')}
            className="absolute left-0 top-0 bottom-5 w-2 z-30 cursor-w-resize hover:bg-sky-500/20 transition-colors"
            title="Drag to resize width"
          />

          {/* Bottom Edge Resize */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 's')}
            className="absolute bottom-0 left-6 right-6 h-2 z-30 cursor-s-resize hover:bg-sky-500/20 transition-colors"
            title="Drag to resize height"
          />

          {/* Bottom-Left Corner Resize Handle (Primary expand direction) */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
            className="absolute bottom-0 left-0 w-6 h-6 z-30 cursor-sw-resize flex items-end justify-start p-1 text-slate-400 hover:text-sky-500 transition-colors group/corner"
            title="Drag to resize width and height"
          >
            <div className="w-2.5 h-2.5 border-b-2 border-l-2 border-slate-400 dark:border-slate-500 group-hover/corner:border-sky-500 transition-colors rounded-bl-xs" />
          </div>

          {/* Bottom-Right Corner Resize Handle */}
          <div
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
            className="absolute bottom-0 right-0 w-6 h-6 z-30 cursor-se-resize flex items-end justify-end p-1 text-slate-400 hover:text-sky-500 transition-colors group/corner"
            title="Drag to resize width and height"
          >
            <div className="w-2.5 h-2.5 border-b-2 border-r-2 border-slate-400 dark:border-slate-500 group-hover/corner:border-sky-500 transition-colors rounded-br-xs" />
          </div>
        </div>
      </div>
    );
  }

  // State 3: Full-Screen Map Overlay
  if (mapMode === 'full') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col animate-in fade-in duration-150">
        {/* Top Floating Control Bar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-white/95 dark:bg-slate-900/95 px-3.5 py-1.5 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-md select-none">
          {/* Title */}
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-slate-700">
            <Globe className="w-4 h-4 text-sky-500" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Geo Map
            </span>
            {geoCount > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                {geoCount} locations
              </span>
            )}
          </div>

          {/* Action: Switch to PiP */}
          <button
            type="button"
            onClick={() => onModeChange?.('pip')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Picture-in-Picture"
          >
            <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
            <span>PiP</span>
          </button>

          {/* Action: Switch to Split */}
          <button
            type="button"
            onClick={() => onModeChange?.('split')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Split Screen"
          >
            <Columns2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Split</span>
          </button>

          {/* Action: Close / Return to Pure Timeline */}
          <button
            type="button"
            onClick={() => onModeChange?.('icon')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
            title="Close map and return to timeline"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
          </button>
        </div>

        {/* Full-Screen Map Container */}
        <div className="w-full h-full relative">
          <GeoMapView
            articles={articles}
            lanes={lanes}
            selectedArticleId={selectedArticleId}
            onSelectArticle={onSelectArticle}
            theme={theme}
            className="w-full h-full"
          />
        </div>
      </div>
    );
  }

  return null;
}
