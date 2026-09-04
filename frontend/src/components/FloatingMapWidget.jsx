import React from 'react';
import {
  Globe,
  Columns2,
  Maximize2,
  Minimize2,
  X,
  MapPin
} from 'lucide-react';
import GeoMapView from './GeoMapView';

/**
 * FloatingMapWidget:
 * Picture-in-Picture (PiP) and Floating Globe widget with 3 interactive states:
 * 1. 'icon': Floating Earth/Globe icon button + adjacent Split button in bottom-right corner
 * 2. 'pip': Compact floating map window in bottom-right corner with live interactive Leaflet map
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

  // If in 'split', the split layout is rendered in App.jsx, but we don't render PiP or Full here
  if (mapMode === 'split') {
    return null;
  }

  // State 1: Floating Earth / Globe Icon + Split Button (Minimally intrusive, bottom-right)
  if (mapMode === 'icon') {
    return (
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 select-none animate-in fade-in zoom-in-90 duration-200">
        {/* Adjacent Split Screen Button */}
        <button
          type="button"
          onClick={() => onModeChange?.('split')}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 border border-slate-200/90 dark:border-slate-700/80 shadow-lg shadow-slate-900/10 backdrop-blur-md text-xs font-semibold hover:scale-105 active:scale-95 transition-all cursor-pointer group"
          title="Split Screen • Map & Timeline side by side"
        >
          <Columns2 className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" />
          <span className="hidden sm:inline">Split</span>
        </button>

        {/* Floating Earth / Globe Button */}
        <button
          type="button"
          onClick={() => onModeChange?.('pip')}
          className="relative flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-xl shadow-indigo-500/30 border border-white/25 hover:scale-105 active:scale-95 transition-all cursor-pointer group"
          title="Floating Map (Picture-in-Picture) • Click to open"
        >
          {/* Animated glow ring */}
          <span className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 opacity-40 blur-xs group-hover:opacity-75 transition-opacity -z-10" />

          <Globe className="w-4 h-4 text-sky-100 group-hover:rotate-12 transition-transform duration-300" />
          <span className="text-xs font-semibold tracking-wide">Floating Map</span>

          {geoCount > 0 && (
            <span className="flex items-center gap-0.5 bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white/20 shadow-2xs">
              <MapPin className="w-2.5 h-2.5" />
              {geoCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  // State 2: Picture-in-Picture (PiP) Floating Compact Window
  if (mapMode === 'pip') {
    return (
      <div className="fixed bottom-5 right-5 z-40 w-[380px] h-[280px] sm:w-[440px] sm:h-[310px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-100px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl shadow-slate-900/25 overflow-hidden flex flex-col select-none animate-in fade-in zoom-in-95 duration-200 ring-1 ring-black/5 dark:ring-white/10">
        {/* PiP Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50/95 dark:bg-slate-800/95 border-b border-slate-200/90 dark:border-slate-700/80 backdrop-blur-md shrink-0">
          {/* Title & Count Badge */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => onModeChange?.('full')}
            title="Click to maximize to full screen"
          >
            <div className="p-1 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform">
              <Globe className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
              Floating Map (PiP)
            </span>
            {geoCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300">
                {geoCount} locations
              </span>
            )}
          </div>

          {/* Action buttons: Split | Full Screen | Minimize to Icon */}
          <div className="flex items-center gap-1">
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
