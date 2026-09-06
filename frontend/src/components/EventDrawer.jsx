import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Image as ImageIcon, AlertTriangle, MapPin, Info, Star } from 'lucide-react';
import { getLaneColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function formatDatePart(d, lang = 'en') {
  if (!d) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  if (d.year === undefined || d.year === null) return '';
  const y = Number(d.year);
  if (isNaN(y)) return String(d.year);

  const isHe = lang === 'he';

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    const ma = Math.abs(y / 1000000);
    const maStr = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
    return isHe ? `${maStr} מיליון שנה לפני זמננו` : `${maStr} Million Years Ago`;
  }

  if (y < 0) {
    return isHe ? `${Math.abs(y)} לפנה״ס` : `${Math.abs(y)} BCE`;
  }

  const hebrewMonths = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  const monthList = isHe ? hebrewMonths : MONTH_NAMES;

  if (d.month && d.day) {
    const m = monthList[Number(d.month) - 1] || d.month;
    return isHe ? `${d.day} ב${m} ${y}` : `${m} ${d.day}, ${y}`;
  }

  if (d.month) {
    const m = monthList[Number(d.month) - 1] || d.month;
    return `${m} ${y}`;
  }

  return `${y}`;
}

export function formatTimeSpan(from, to, isToPresent, lang = 'en') {
  const isHe = lang === 'he';
  const presentStr = isHe ? 'הווה' : 'Present';
  const fromStr = formatDatePart(from, lang);
  if (isToPresent) return fromStr ? `${fromStr} – ${presentStr}` : presentStr;
  if (!to) return fromStr;
  const toStr = formatDatePart(to, lang);
  if (!fromStr) return toStr;
  if (fromStr === toStr) return fromStr;
  return `${fromStr} – ${toStr}`;
}

export default function EventDrawer({
  article,
  lanes = [],
  isStarred = false,
  onToggleStar,
  onClose,
  onEdit,
  onDelete,
  onOpenDisclaimer
}) {
  const { language, isRtl, t, formatTimeSpan: localizedTimeSpan } = useLanguage();

  if (!article) return null;

  const laneIndex = lanes.findIndex((l) => l.id === article.lane);
  const laneObj = laneIndex >= 0 ? lanes[laneIndex] : null;
  const laneColor = laneObj ? getLaneColor(laneObj, laneIndex, lanes) : null;
  const timeSpan = localizedTimeSpan(article.from, article.to, article.isToPresent);
  
  const hasHebrew = (str) => /[\u0590-\u05FF]/.test(str || '');
  const isTitleHebrew = hasHebrew((article.title || '') + ' ' + (article.subtitle || ''));
  const isLaneHebrew = hasHebrew(laneObj?.title || '');

  return (
    <div
      className={`fixed inset-y-0 right-0 w-full sm:w-96 md:w-[420px] bg-white/95 dark:bg-slate-950/95 backdrop-blur-2xl border-l border-slate-200/90 dark:border-slate-800/90 shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out font-sans ${
        isRtl ? 'text-right' : 'text-left'
      }`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-sans">
          {t('eventDrawer.title')}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleStar?.(article.id)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isStarred
                ? 'text-amber-500 hover:text-amber-600 bg-amber-500/10 dark:bg-amber-400/15'
                : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
            aria-label={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-slate-700 dark:text-slate-200">
        {/* Banner image */}
        {article.imageUrl ? (
          <div className="w-full h-52 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 relative group shadow-sm">
            <img
              src={article.imageUrl}
              alt={article.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div className="w-full h-28 rounded-xl bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1">
            <ImageIcon className="w-6 h-6 opacity-40" />
            <span className="text-xs">{t('eventDrawer.noImage')}</span>
          </div>
        )}

        {/* Title and Subtitle */}
        <div
          dir={isTitleHebrew ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
          className={isTitleHebrew ? 'text-right' : (isRtl ? 'text-right' : 'text-left')}
        >
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
              <span dir={isLaneHebrew ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}>{laneObj.title}</span>
            </div>
          )}
        </div>

        {/* Location & Google Maps Link */}
        {(article.locationName || (article.lat != null && article.lng != null)) && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 shrink-0 text-rose-500" />
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">
                  {article.locationName || `${Number(article.lat).toFixed(2)}, ${Number(article.lng).toFixed(2)}`}
                </span>
                {article.lat != null && article.lng != null && !isNaN(Number(article.lat)) && !isNaN(Number(article.lng)) && (
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
                title={t('eventDrawer.mapsTitle')}
              >
                <span>{t('eventDrawer.googleMaps')}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* AI Disclaimer Note */}
        <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
          <div className="leading-snug">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{t('eventDrawer.aiSynthesized')} </span>
            <span>{t('eventDrawer.aiSynthesizedDesc')}</span>
            {onOpenDisclaimer && (
              <button
                type="button"
                onClick={onOpenDisclaimer}
                className="mx-1 text-sky-600 dark:text-sky-400 underline font-medium hover:text-sky-700 cursor-pointer inline"
              >
                {t('common.learnMore')}
              </button>
            )}
          </div>
        </div>

        {/* Wikipedia Extract */}
        {article.extract ? (
          <div
            dir={hasHebrew(article.extract) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
            className={`bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed ${
              hasHebrew(article.extract) ? 'text-right' : (isRtl ? 'text-right' : 'text-left')
            }`}
          >
            <p>{article.extract}</p>
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            {t('eventDrawer.noSummary')}
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
            <span>{t('eventDrawer.wikiLink')}</span>
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-white dark:bg-slate-950">
        <button
          type="button"
          onClick={() => onEdit?.(article)}
          className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>{t('eventDrawer.editEvent')}</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete?.(article.id)}
          className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-rose-50 dark:bg-slate-900 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-800 hover:border-rose-300 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          title={t('eventDrawer.deleteEvent')}
          aria-label={t('eventDrawer.deleteEvent')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
