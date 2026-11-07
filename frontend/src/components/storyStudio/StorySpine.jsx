import React, { useEffect, useMemo, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { formatFuzzyDate } from '../../utils/fuzzyDate';

// The story spine: a small, always-live map of the story being built in the Story Studio.
// One thin line per lane, a dot per moment placed by its year, chapters as faint bands, and the
// key questions not answered yet as hollow dots at the end of their lane ("still to tell").
// It redraws on every keystroke (a few dozen elements, unlike the real canvas), so the timeline
// visibly grows as the user answers: a new dot pops in. Clicking a dot jumps to its question.
// Positions use the logical start edge, so the spine mirrors naturally in RTL.

const dateValue = (d) => {
  if (!d || d.year == null) return null;
  const y = Number(d.year);
  if (!Number.isFinite(y)) return null;
  const m = (Number(d.month) || 1) - 1;
  const day = (Number(d.day) || 1) - 1;
  return y + (m * 30 + day) / 365;
};

// Share of the track used by dated moments; the rest is the "still to tell" tray.
const SPAN_FULL = 100;
const SPAN_WITH_TRAY = 76;
const FALLBACK_COLORS = ['#925434', '#2563a2', '#2e6b56', '#6e395e', '#b87326', '#3f6f8f'];

const pct = (value) => `${Math.max(0, Math.min(100, value)).toFixed(3)}%`;

export default function StorySpine({ timeline, pending = [], onSelectArticle, onSelectPending, compact = false }) {
  const { t, language, isRtl } = useLanguage();
  const lang = language === 'he' ? 'he' : 'en';
  const lanes = timeline?.lanes || [];
  const articles = timeline?.articles || [];
  const bands = timeline?.timeBands || [];
  const startSide = isRtl ? 'right' : 'left';

  const layout = useMemo(() => {
    const dated = articles
      .map((a) => ({ a, from: dateValue(a.from), to: dateValue(a.to) }))
      .filter((x) => x.from != null);
    let min = dated.length ? Math.min(...dated.map((x) => x.from)) : 0;
    let max = dated.length ? Math.max(...dated.map((x) => Math.max(x.from, x.to ?? x.from))) : 1;
    const firstYear = Math.floor(min);
    const lastYear = Math.floor(max);
    if (max - min < 2) { min -= 1; max += 1; }
    const pad = (max - min) * 0.05;
    min -= pad;
    max += pad;
    const span = pending.length && dated.length ? SPAN_WITH_TRAY : SPAN_FULL;
    return { dated, min, max, span, firstYear, lastYear, x: (v) => ((v - min) / (max - min)) * span };
  }, [articles, pending.length]);

  // Dots that appear after the first render pop in (skipped under reduced motion).
  const seenRef = useRef(null);
  const ids = articles.map((a) => String(a.id));
  const isNew = (id) => seenRef.current !== null && !seenRef.current.has(id);
  useEffect(() => {
    seenRef.current = new Set(ids);
  });

  if (!lanes.length) return null;

  const hasDated = layout.dated.length > 0;
  const laneIds = new Set(lanes.map((l) => l.id));
  const laneOf = (id) => (laneIds.has(id) ? id : lanes[0].id);
  const colorOf = (lane, i) => lane?.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  const showLabels = !compact;
  const rowClass = compact ? 'h-5' : 'h-6';

  const dot = (key, pos, label, onClick, inner) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="group absolute top-1/2 -translate-y-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2 w-6 h-6 flex items-center justify-center rounded-full cursor-pointer"
      style={{ [startSide]: pct(pos) }}
    >
      {inner}
    </button>
  );

  return (
    <figure className="m-0 flex gap-3" aria-label={t('storyStudio.spineLabel')} data-testid="story-spine">
      {showLabels && (
        <ul className="hidden sm:block w-24 shrink-0 space-y-0.5" aria-hidden="true">
          {lanes.map((lane) => (
            <li key={lane.id} className={`${rowClass} flex items-center text-caption text-ink-subtle truncate`} dir="auto" title={lane.title}>
              <span className="truncate">{lane.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex-1 min-w-0">
        <div className="relative">
          {/* Chapters: faint bands behind every lane. */}
          {hasDated && bands.map((b) => {
            const from = dateValue(b.from);
            const to = dateValue(b.to) ?? layout.max;
            if (from == null) return null;
            const start = layout.x(Math.max(from, layout.min));
            const end = layout.x(Math.min(to, layout.max));
            if (end - start < 0.5) return null;
            return (
              <div
                key={b.id}
                title={b.title}
                className="absolute inset-y-0 rounded-sm bg-memory-soft"
                style={{ [startSide]: pct(start), width: pct(end - start) }}
                aria-hidden="true"
              />
            );
          })}
          <ul className="relative space-y-0.5">
            {lanes.map((lane, i) => {
              const color = colorOf(lane, i);
              const lanePending = pending.filter((p) => laneOf(p.lane) === lane.id);
              const laneDots = layout.dated.filter((d) => laneOf(d.a.lane) === lane.id);
              return (
                <li key={lane.id} className={`relative ${rowClass}`}>
                  <span
                    className="absolute top-1/2 h-px bg-line-strong"
                    style={{ [startSide]: 0, width: pct(layout.span) }}
                    aria-hidden="true"
                  />
                  {layout.span < 100 && (
                    <span
                      className="absolute top-1/2 border-t border-dashed border-line-strong"
                      style={{ [startSide]: pct(layout.span), width: pct(100 - layout.span) }}
                      aria-hidden="true"
                    />
                  )}
                  {laneDots.map(({ a, from, to }) => {
                    const pos = layout.x(from);
                    const width = to != null && to > from ? layout.x(to) - pos : 0;
                    const when = formatFuzzyDate({ ...(a.from || {}), circa: a.circa }, lang);
                    const label = [a.title, when].filter(Boolean).join(', ');
                    return (
                      <React.Fragment key={a.id}>
                        {width > 0 && (
                          <span
                            className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full opacity-40"
                            style={{ [startSide]: pct(pos), width: pct(width), backgroundColor: color }}
                            aria-hidden="true"
                          />
                        )}
                        {dot(a.id, pos, label, () => onSelectArticle?.(a), (
                          <span
                            className={`block w-2.5 h-2.5 rounded-full ring-2 ring-surface transition-transform duration-150 ease-out group-hover:scale-125 ${isNew(String(a.id)) ? 'motion-safe:animate-spine-pop' : ''}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </React.Fragment>
                    );
                  })}
                  {lanePending.map((p, j) => {
                    // Hollow dots: spread over the whole track while nothing is dated yet,
                    // otherwise gathered in the tray at the end of the lane.
                    const pos = hasDated
                      ? layout.span + ((j + 1) / (lanePending.length + 1)) * (100 - layout.span)
                      : ((j + 1) / (lanePending.length + 1)) * 100;
                    return dot(`pending-${p.id}`, pos, `${t('storyStudio.spinePending')}: ${p.label}`, () => onSelectPending?.(p), (
                      <span className="block w-2.5 h-2.5 rounded-full border-[1.5px] bg-surface transition-transform duration-150 ease-out group-hover:scale-125" style={{ borderColor: color }} />
                    ));
                  })}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="relative h-4 mt-1 text-caption leading-4 text-ink-subtle tabular-nums">
          {hasDated ? (
            <>
              <span className="absolute" style={{ [startSide]: 0 }} dir="ltr">{layout.firstYear}</span>
              <span className="absolute ltr:-translate-x-full rtl:translate-x-full" style={{ [startSide]: pct(layout.span) }} dir="ltr">
                {layout.lastYear !== layout.firstYear ? layout.lastYear : ''}
              </span>
              {layout.span < 100 && (
                <span className="absolute ltr:-translate-x-1/2 rtl:translate-x-1/2 whitespace-nowrap" style={{ [startSide]: pct((layout.span + 100) / 2) }}>
                  {t('storyStudio.spinePending')}
                </span>
              )}
            </>
          ) : (
            <span>{t('storyStudio.spineEmpty')}</span>
          )}
        </div>
      </div>
    </figure>
  );
}
