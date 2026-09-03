import React from 'react';
import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Image as ImageIcon } from 'lucide-react';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function formatDatePart(d) {
  if (!d || d.year === undefined || d.year === null) return '';
  const y = d.year;

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    const ma = Math.abs(y / 1000000);
    return `${ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1)} Million Years Ago`;
  }

  if (y < 0) {
    return `${Math.abs(y)} BCE`;
  }

  if (d.month && d.day) {
    const m = MONTH_NAMES[d.month - 1] || d.month;
    return `${m} ${d.day}, ${y}`;
  }

  if (d.month) {
    const m = MONTH_NAMES[d.month - 1] || d.month;
    return `${m} ${y}`;
  }

  return `${y}`;
}

export function formatTimeSpan(from, to, isToPresent) {
  const fromStr = formatDatePart(from);
  if (isToPresent) return `${fromStr} – Present`;
  if (!to) return fromStr;
  const toStr = formatDatePart(to);
  if (fromStr === toStr) return fromStr;
  return `${fromStr} – ${toStr}`;
}

export default function EventDrawer({
  article,
  lanes = [],
  onClose,
  onEdit,
  onDelete
}) {
  if (!article) return null;

  const laneObj = lanes.find((l) => l.id === article.lane);
  const timeSpan = formatTimeSpan(article.from, article.to, article.isToPresent);

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 md:w-[420px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-l border-slate-200 dark:border-slate-800 shadow-2xl z-40 flex flex-col transition-transform duration-300 ease-in-out">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
          Event Details
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-slate-700 dark:text-slate-200">
        {/* Banner image */}
        {article.imageUrl ? (
          <div className="w-full h-52 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 relative group shadow-md">
            <img
              src={article.imageUrl}
              alt={article.title}
              className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div className="w-full h-32 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1">
            <ImageIcon className="w-8 h-8 opacity-40" />
            <span className="text-xs">No image preview available</span>
          </div>
        )}

        {/* Title and Subtitle */}
        <div dir="auto">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            {article.title}
          </h2>
          {article.subtitle && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-snug">
              {article.subtitle}
            </p>
          )}
        </div>

        {/* Badges: Date span & Lane */}
        <div className="flex flex-wrap gap-2 pt-1">
          {timeSpan && (
            <div className="flex items-center gap-1.5 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 rounded-lg px-2.5 py-1 text-xs font-medium">
              <Calendar className="w-3.5 h-3.5" />
              <span>{timeSpan}</span>
            </div>
          )}

          {laneObj && (
            <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 rounded-lg px-2.5 py-1 text-xs font-medium">
              <Layers className="w-3.5 h-3.5" />
              <span dir="auto">{laneObj.title}</span>
            </div>
          )}
        </div>

        {/* Wikipedia Extract */}
        {article.extract ? (
          <div
            dir="auto"
            className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed text-start"
          >
            <p>{article.extract}</p>
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            No summary extract available.
          </p>
        )}

        {/* Wikipedia Link */}
        {article.wikiUrl && (
          <a
            href={article.wikiUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between w-full bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors group shadow-2xs"
          >
            <span>Read full article on Wikipedia</span>
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-white dark:bg-slate-900">
        <button
          type="button"
          onClick={() => onEdit(article)}
          className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
        >
          <Edit className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
          <span>Edit Event</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete(article.id)}
          className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-100 border border-rose-200 dark:border-rose-900/60 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors"
          title="Delete Event"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
