import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Calendar,
  Layers,
  ArrowUpDown,
  Image as ImageIcon,
  ChevronLeft,
  Filter,
  Check,
  MapPin
} from 'lucide-react';
import { formatTimeSpan } from './EventDrawer';

export default function CardsListDrawer({
  isOpen,
  onClose,
  articles = [],
  lanes = [],
  selectedArticleId,
  onSelectArticle
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaneId, setSelectedLaneId] = useState('all');
  const [sortBy, setSortBy] = useState('chronological_asc'); // 'chronological_asc' | 'chronological_desc' | 'alphabetical'

  // Map lanes for fast lookup
  const laneMap = useMemo(() => {
    const map = new Map();
    lanes.forEach((lane) => {
      map.set(lane.id, lane.title);
    });
    return map;
  }, [lanes]);

  // Filter and sort articles
  const filteredArticles = useMemo(() => {
    return articles
      .filter((art) => {
        // Filter by lane
        if (selectedLaneId !== 'all') {
          if (art.lane !== selectedLaneId) return false;
        }

        // Filter by search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const titleMatch = art.title?.toLowerCase().includes(q);
          const subtitleMatch = art.subtitle?.toLowerCase().includes(q);
          const extractMatch = art.extract?.toLowerCase().includes(q);
          const laneName = (laneMap.get(art.lane) || '').toLowerCase();
          const laneMatch = laneName.includes(q);
          const yearMatch = art.from?.year?.toString().includes(q);

          return titleMatch || subtitleMatch || extractMatch || laneMatch || yearMatch;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'alphabetical') {
          return (a.title || '').localeCompare(b.title || '');
        }

        const aYear = a.from?.year ?? 0;
        const bYear = b.from?.year ?? 0;
        const aMonth = a.from?.month ?? 1;
        const bMonth = b.from?.month ?? 1;
        const aDay = a.from?.day ?? 1;
        const bDay = b.from?.day ?? 1;

        if (sortBy === 'chronological_desc') {
          if (aYear !== bYear) return bYear - aYear;
          if (aMonth !== bMonth) return bMonth - aMonth;
          return bDay - aDay;
        }

        // Default: chronological_asc
        if (aYear !== bYear) return aYear - bYear;
        if (aMonth !== bMonth) return aMonth - bMonth;
        return aDay - bDay;
      });
  }, [articles, searchQuery, selectedLaneId, sortBy, laneMap]);

  if (!isOpen) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 w-full sm:w-96 md:w-[410px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-l border-slate-200 dark:border-slate-800 shadow-2xl z-30 flex flex-col transition-all duration-300 ease-in-out select-none"
      aria-label="Cards List Panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse" />
          <h2 className="font-bold text-sm text-slate-900 dark:text-white">
            Cards List
          </h2>
          <span className="text-[11px] font-semibold bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded-full border border-sky-200 dark:border-sky-800/80">
            {filteredArticles.length === articles.length
              ? articles.length
              : `${filteredArticles.length} of ${articles.length}`}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          title="Close panel"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search & Sort Controls */}
      <div className="p-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/40 space-y-2">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            dir="auto"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards by title, year or lane..."
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-0.5"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sort & Lane Filters Bar */}
        <div className="flex items-center justify-between gap-2 text-xs">
          {/* Sort Selector */}
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium outline-none focus:border-sky-500"
            >
              <option value="chronological_asc">Chronological (Oldest first)</option>
              <option value="chronological_desc">Chronological (Newest first)</option>
              <option value="alphabetical">Alphabetical (A-Z)</option>
            </select>
          </div>

          {/* Lane Filter dropdown if lanes exist */}
          {lanes.length > 0 && (
            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Filter className="w-3 h-3 text-slate-400" />
              <select
                value={selectedLaneId}
                onChange={(e) => setSelectedLaneId(e.target.value)}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium outline-none focus:border-sky-500 max-w-[130px] truncate"
              >
                <option value="all">All Lanes</option>
                {lanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Cards Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y-0">
        {filteredArticles.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 text-center px-4">
            <Search className="w-8 h-8 opacity-40" />
            <p className="text-xs">No cards matching your search</p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedLaneId('all');
                }}
                className="text-xs text-sky-600 dark:text-sky-400 underline font-medium"
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          filteredArticles.map((art) => {
            const isSelected = selectedArticleId === art.id;
            const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent);
            const laneTitle = laneMap.get(art.lane);

            return (
              <div
                key={art.id}
                onClick={() => onSelectArticle(art)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectArticle(art);
                  }
                }}
                className={`group relative flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer text-start ${
                  isSelected
                    ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 dark:border-sky-600 ring-2 ring-sky-500/20 shadow-sm'
                    : 'bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200/90 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 shadow-2xs'
                }`}
              >
                {/* Thumbnail / Icon */}
                <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 overflow-hidden shrink-0 flex items-center justify-center">
                  {art.imageUrl ? (
                    <img
                      src={art.imageUrl}
                      alt={art.title}
                      className="w-full h-full object-cover object-center group-hover:scale-110 transition-transform duration-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0" dir="auto">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-xs sm:text-[13px] text-slate-900 dark:text-white truncate leading-snug">
                      {art.title}
                    </h3>
                  </div>

                  {art.subtitle && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {art.subtitle}
                    </p>
                  )}

                  {/* Badges: Time & Lane */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {timeSpan && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/70 border border-sky-200/80 dark:border-sky-800/60 px-1.5 py-0.5 rounded-md">
                        <Calendar className="w-2.5 h-2.5" />
                        <span>{timeSpan}</span>
                      </span>
                    )}

                    {laneTitle && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/60 px-1.5 py-0.5 rounded-md truncate max-w-[120px]">
                        <Layers className="w-2.5 h-2.5" />
                        <span className="truncate">{laneTitle}</span>
                      </span>
                    )}

                    {art.locationName && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 px-1.5 py-0.5 rounded-md truncate max-w-[120px]" title={art.locationName}>
                        <MapPin className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                        <span className="truncate">{art.locationName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Chevron indicator / Select marker */}
                <div className="shrink-0 text-slate-300 group-hover:text-sky-500 dark:text-slate-600 dark:group-hover:text-sky-400 transition-colors">
                  {isSelected ? (
                    <div className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  ) : (
                    <ChevronLeft className="w-4 h-4" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>💡 Click a card to focus it on the timeline</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
        >
          Close
        </button>
      </div>
    </aside>
  );
}
