import { X, ExternalLink, Edit, Trash2, Calendar, Layers, Image as ImageIcon, AlertTriangle, MapPin, Star, ChevronLeft, ChevronRight, Compass, Globe, MessageSquare } from 'lucide-react';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { translations } from '../locales/translations';

export function formatDatePart(d, lang = 'en') {
  if (!d) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  if (d.year === undefined || d.year === null) return '';
  const y = Number(d.year);
  if (isNaN(y)) return String(d.year);

  const dict = translations[lang]?.dates || translations.en.dates;

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    const ma = Math.abs(y / 1000000);
    const maStr = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
    return `${maStr} ${dict.millionYearsAgo}`;
  }

  if (y < 0) {
    const absY = Math.abs(y);
    if (lang === 'ja' || lang === 'zh') return `${dict.bce} ${absY}年`;
    if (lang === 'ko') return `${dict.bce} ${absY}년`;
    return `${absY} ${dict.bce}`;
  }

  const monthIdx = Number(d.month) - 1;
  const monthName = dict.months?.[monthIdx] || d.month;

  if (d.month && d.day) {
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月${d.day}日`;
      case 'ko':
        return `${y}년 ${d.month}월 ${d.day}일`;
      case 'he':
        return `${d.day} ב${monthName} ${y}`;
      case 'ar':
        return `${d.day} ${monthName} ${y}`;
      case 'de':
        return `${d.day}. ${monthName} ${y}`;
      case 'es':
      case 'pt':
        return `${d.day} de ${monthName} de ${y}`;
      case 'fr':
      case 'hi':
        return `${d.day} ${monthName} ${y}`;
      default:
        return `${monthName} ${d.day}, ${y}`;
    }
  }

  if (d.month) {
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月`;
      case 'ko':
        return `${y}년 ${d.month}월`;
      case 'es':
      case 'pt':
        return `${monthName} de ${y}`;
      default:
        return `${monthName} ${y}`;
    }
  }

  if (lang === 'ja' || lang === 'zh') return `${y}年`;
  if (lang === 'ko') return `${y}년`;

  return `${y}`;
}

export function formatTimeSpan(from, to, isToPresent, lang = 'en') {
  const dict = translations[lang]?.dates || translations.en.dates;
  const fromStr = formatDatePart(from, lang);
  if (isToPresent) return fromStr ? `${fromStr} – ${dict.present}` : dict.present;
  if (!to) return fromStr;
  const toStr = formatDatePart(to, lang);
  if (!fromStr) return toStr;
  if (fromStr === toStr) return fromStr;
  return `${fromStr} – ${toStr}`;
}

export default function EventDrawer({
  article,
  lanes = [],
  articles = [],
  grounding = null,
  isStarred = false,
  onToggleStar,
  onClose,
  onEdit,
  onDelete,
  onAskAi,
  isExploring = false,
  exploreProgress = null,
  onExploreNext,
  onExplorePrev,
  style
}) {
  const { language, isRtl, t, formatTimeSpan: localizedTimeSpan } = useLanguage();

  if (!article) return null;

  const laneIndex = lanes.findIndex((l) => l.id === article.lane);
  const laneObj = laneIndex >= 0 ? lanes[laneIndex] : null;
  const laneColor = laneObj ? getLaneColor(laneObj, laneIndex, lanes) : null;
  const timeSpan = localizedTimeSpan(article.from, article.to, article.isToPresent);

  // In a single (non-split) timeline events are grouped/colored by theme
  // (`category`) instead of lane, mirroring the timeline and cards list.
  const categories = getDistinctCategories(articles);
  const themedMode = lanes.length <= 1 && categories.length >= 2;
  const themeLabel = (article.category || '').toString().trim();
  const showThemeBadge = themedMode && themeLabel;
  const themeColor = showThemeBadge ? getCategoryColor(themeLabel, categories) : null;

  const hasRtl = (str) => /[\u0590-\u05FF\u0600-\u06FF]/.test(str || '');
  const isTitleRtl = hasRtl((article.title || '') + ' ' + (article.subtitle || ''));
  const isLaneRtl = hasRtl(laneObj?.title || '');
  const isThemeRtl = hasRtl(themeLabel);

  return (
    <div
      className={`absolute right-0 left-0 sm:left-auto sm:w-96 md:w-[420px] bg-surface-overlay border-l border-line shadow-panel flex flex-col transition-transform duration-300 ease-in-out font-sans ${
        isRtl ? 'text-right' : 'text-left'
      }`}
      style={style}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle font-sans">
          {t('eventDrawer.title')}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleStar?.(article.id)}
            className={`p-1.5 rounded-control transition-colors cursor-pointer ${
              isStarred
                ? 'text-amber-500 bg-amber-500/10'
                : 'text-ink-subtle hover:text-amber-500 hover:bg-surface-hover'
            }`}
            title={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
            aria-label={isStarred ? t('eventDrawer.unstarEvent') : t('eventDrawer.starEvent')}
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-subtle hover:text-ink hover:bg-surface-hover rounded-control transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prev/Next event navigation strip. Always shown so the user can step between
          events straight from the details pane, not only during a guided tour.
          Kept LTR so Prev/Next match the canvas time direction. */}
      {exploreProgress && (
        <div
          dir="ltr"
          className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line bg-surface-sunken select-none animate-in fade-in duration-200"
        >
          <button
            type="button"
            onClick={onExplorePrev}
            disabled={!exploreProgress || exploreProgress.current <= 1}
            title={`${t('explore.prev')} (←)`}
            aria-label={t('explore.prev')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-control text-xs font-semibold text-accent bg-accent-soft hover:bg-accent-soft/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{t('explore.prev')}</span>
          </button>

          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-muted">
            <Compass className="w-3.5 h-3.5 text-accent" />
            <span className="tabular-nums whitespace-nowrap">
              {exploreProgress ? `${exploreProgress.current} / ${exploreProgress.total}` : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={onExploreNext}
            disabled={!exploreProgress || exploreProgress.current >= exploreProgress.total}
            title={`${t('explore.next')} (→)`}
            aria-label={t('explore.next')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-control text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover shadow-control transition-all cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-default"
          >
            <span>{t('explore.next')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content scroll area */}
      <div
        key={article.id}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-ink animate-in fade-in duration-200"
      >
        {/* Banner image */}
        {article.imageUrl ? (
          <div className="w-full h-52 rounded-panel overflow-hidden bg-surface-sunken border border-line relative group shadow-control">
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
          <div className="w-full h-28 rounded-panel bg-surface-sunken border border-line flex flex-col items-center justify-center text-ink-subtle gap-1">
            <ImageIcon className="w-6 h-6 opacity-40" />
            <span className="text-xs">{t('eventDrawer.noImage')}</span>
          </div>
        )}

        {/* Title and Subtitle */}
        <div
          dir={isTitleRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
          className={isTitleRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left')}
        >
          <h2 className="text-xl font-bold text-ink tracking-tight leading-snug">
            {article.title}
          </h2>
          {article.subtitle && (
            <p className="text-sm text-ink-muted mt-1 leading-relaxed">
              {article.subtitle}
            </p>
          )}
        </div>

        {/* Badges: Date span & Lane */}
        <div className="flex flex-wrap gap-2 pt-1">
          {timeSpan && (
            <div className="flex items-center gap-1.5 bg-surface-sunken text-ink border border-line rounded-control px-2.5 py-1 text-xs font-medium">
              <Calendar className="w-3.5 h-3.5 text-ink-subtle" />
              <span>{timeSpan}</span>
            </div>
          )}

          {showThemeBadge ? (
            <div className="flex items-center gap-1.5 bg-surface-sunken text-ink border border-line rounded-control px-2.5 py-1 text-xs font-medium">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                style={{ backgroundColor: themeColor }}
              />
              <span dir={isThemeRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}>{themeLabel}</span>
            </div>
          ) : laneObj ? (
            <div className="flex items-center gap-1.5 bg-surface-sunken text-ink border border-line rounded-control px-2.5 py-1 text-xs font-medium">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                style={{ backgroundColor: laneColor }}
              />
              <span dir={isLaneRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}>{laneObj.title}</span>
            </div>
          ) : null}
        </div>

        {/* Location & Google Maps Link */}
        {(article.locationName || (article.lat != null && article.lng != null)) && (
          <div className="flex items-center justify-between p-3 rounded-panel bg-surface-sunken border border-line text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 shrink-0 text-danger" />
              <div className="truncate">
                <span className="font-semibold text-ink block truncate">
                  {article.locationName || `${Number(article.lat).toFixed(2)}, ${Number(article.lng).toFixed(2)}`}
                </span>
                {article.lat != null && article.lng != null && !isNaN(Number(article.lat)) && !isNaN(Number(article.lng)) && (
                  <span className="text-[10px] text-ink-subtle">
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
                className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-control bg-surface-raised hover:bg-surface-hover text-ink font-medium text-[11px] border border-line shadow-control transition-colors cursor-pointer"
                title={t('eventDrawer.mapsTitle')}
              >
                <span>{t('eventDrawer.googleMaps')}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Discuss this event with the AI chat */}
        {onAskAi && (
          <button
            type="button"
            onClick={() => onAskAi(article)}
            className="flex items-center justify-between w-full bg-accent-soft hover:bg-accent-soft/80 border border-accent/20 rounded-panel p-3 text-xs font-semibold text-accent transition-colors group cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 shrink-0" />
              {t('chat.askAboutEvent')}
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform group-hover:translate-x-0.5 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
        )}

        {/* Wikipedia Extract */}
        {article.extract ? (
          <div
            dir={hasRtl(article.extract) ? 'rtl' : (isRtl ? 'rtl' : 'ltr')}
            className={`bg-surface-sunken border border-line rounded-panel p-4 text-sm text-ink leading-relaxed ${
              hasRtl(article.extract) ? 'text-right' : (isRtl ? 'text-right' : 'text-left')
            }`}
          >
            <p>{article.extract}</p>
          </div>
        ) : (
          <p className="text-xs text-ink-faint italic">
            {t('eventDrawer.noSummary')}
          </p>
        )}

        {/* Wikipedia Link */}
        {article.wikiUrl && (
          <a
            href={article.wikiUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between w-full bg-surface-sunken hover:bg-surface-hover border border-line rounded-panel p-3 text-xs font-medium text-ink hover:text-accent transition-colors group shadow-control"
          >
            <span>{t('eventDrawer.wikiLink')}</span>
            <ExternalLink className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        )}

        {/* Google Grounding Sources */}
        {grounding?.is_grounded && grounding.sources && grounding.sources.length > 0 && (
          <div className="rounded-panel border border-accent/25 bg-accent-soft/40 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-accent">
              <span className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-accent" />
                <span>{t('eventDrawer.groundingSources')}</span>
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                {grounding.sources.length}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 pt-1">
              {grounding.sources.slice(0, 5).map((src, idx) => (
                <a
                  key={idx}
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between text-[11px] p-2 rounded-control bg-surface-raised hover:bg-surface-hover border border-line text-ink hover:text-accent transition-colors shadow-control group"
                >
                  <span className="truncate max-w-[220px] sm:max-w-[260px] font-medium">{src.title || src.url}</span>
                  <ExternalLink className="w-3 h-3 text-ink-subtle group-hover:text-accent shrink-0 ml-1.5" />
                </a>
              ))}
            </div>

            {/* Google Search Queries Chips */}
            {grounding.search_queries && grounding.search_queries.length > 0 && (
              <div className="pt-1 border-t border-line">
                <span className="text-[10px] font-medium text-ink-subtle block mb-1">
                  {t('eventDrawer.groundingQueries')}
                </span>
                <div className="flex flex-wrap gap-1">
                  {grounding.search_queries.map((q, qIdx) => (
                    <a
                      key={qIdx}
                      href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-surface-raised border border-line text-ink-muted hover:text-accent hover:border-accent/40 transition-colors inline-flex items-center gap-1"
                    >
                      <span className="truncate max-w-[180px]">{q}</span>
                      <ExternalLink className="w-2.5 h-2.5 text-ink-subtle" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-5 py-4 border-t border-line flex items-center justify-between gap-3 bg-surface-overlay">
        <button
          type="button"
          onClick={() => onEdit?.(article)}
          className="flex-1 flex items-center justify-center gap-2 bg-surface-raised hover:bg-surface-hover text-ink border border-line px-4 py-2.5 rounded-control text-xs font-semibold shadow-control transition-colors cursor-pointer"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>{t('eventDrawer.editEvent')}</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete?.(article.id)}
          className="flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-danger-soft text-ink-muted hover:text-danger border border-line hover:border-danger/30 px-3.5 py-2.5 rounded-control text-xs font-medium transition-colors cursor-pointer"
          title={t('eventDrawer.deleteEvent')}
          aria-label={t('eventDrawer.deleteEvent')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
