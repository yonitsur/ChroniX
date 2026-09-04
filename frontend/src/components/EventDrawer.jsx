import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Image as ImageIcon, AlertTriangle, MapPin } from 'lucide-react';
import { getLaneColor } from '../data/laneColors';

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
  onDelete,
  onOpenDisclaimer
}) {
  if (!article) return null;

  const laneIndex = lanes.findIndex((l) => l.id === article.lane);
  const laneObj = laneIndex >= 0 ? lanes[laneIndex] : null;
  const laneColor = laneObj ? getLaneColor(laneObj, laneIndex, lanes) : null;
  const timeSpan = formatTimeSpan(article.from, article.to, article.isToPresent);

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 md:w-[420px] bg-white/95 dark:bg-slate-950/95 backdrop-blur-2xl border-l border-slate-200/90 dark:border-slate-800/90 shadow-2xl z-40 flex flex-col transition-transform duration-300 ease-in-out font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-sans">
          Event Details
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-slate-700 dark:text-slate-200">
        {/* Banner image */}
        {article.imageUrl ? (
          <div className="w-full h-52 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 relative group shadow-sm">
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
          <div className="w-full h-28 rounded-xl bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1">
            <ImageIcon className="w-6 h-6 opacity-40" />
            <span className="text-xs">No image preview available</span>
          </div>
        )}

        {/* Title and Subtitle */}
        <div dir="auto">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
            {article.title}
          </h2>
          {article.subtitle && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {article.subtitle}
            </p>
          )}
        </div>

        {/* Badges: Date span & Lane */}
        <div className="flex flex-wrap gap-2 pt-1">
          {timeSpan && (
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs font-medium">
              <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>{timeSpan}</span>
            </div>
          )}

          {laneObj && (
            <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs font-medium">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                style={{ backgroundColor: laneColor }}
              />
              <span dir="auto">{laneObj.title}</span>
            </div>
          )}
        </div>

        {/* Location & Google Maps Link */}
        {(article.locationName || (article.lat && article.lng)) && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 shrink-0 text-rose-500" />
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">
                  {article.locationName || `${article.lat?.toFixed(2)}, ${article.lng?.toFixed(2)}`}
                </span>
                {article.lat && article.lng && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {Number(article.lat).toFixed(4)}°, {Number(article.lng).toFixed(4)}°
                  </span>
                )}
              </div>
            </div>

            {article.googleMapsUrl && (
              <a
                href={article.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-[11px] border border-slate-200 dark:border-slate-700 shadow-2xs transition-colors cursor-pointer"
                title="Open location in Google Maps"
              >
                <span>Google Maps</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* AI Disclaimer Note */}
        <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
          <div className="leading-snug">
            <span className="font-semibold text-slate-700 dark:text-slate-300">AI Synthesized:</span> Events and dates are automatically assembled and may contain inaccuracies.
            {onOpenDisclaimer && (
              <button
                type="button"
                onClick={onOpenDisclaimer}
                className="ml-1.5 text-sky-600 dark:text-sky-400 underline font-medium hover:text-sky-700 cursor-pointer inline"
              >
                Learn more
              </button>
            )}
          </div>
        </div>

        {/* Wikipedia Extract */}
        {article.extract ? (
          <div
            dir="auto"
            className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed text-start"
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
            className="flex items-center justify-between w-full bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/70 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 transition-colors group shadow-2xs"
          >
            <span>Read full article on Wikipedia</span>
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-white dark:bg-slate-950">
        <button
          type="button"
          onClick={() => onEdit(article)}
          className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>Edit Event</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete(article.id)}
          className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-rose-50 dark:bg-slate-900 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-800 hover:border-rose-300 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          title="Delete Event"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
