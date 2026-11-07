import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, FileText } from '../../icons/ThemeIcons';
import { useLanguage } from '../../../context/LanguageContext';
import { getBookImportUnit, resolveBookImportUrl } from '../../../api';

const strip = (s) => String(s || '').normalize('NFKD').replace(/[֑-ׇ]/g, '').replace(/[״׳"'`.,;:!?()[\]\-–—\s]+/g, ' ').trim().toLowerCase();

/** Splits `text` around the first fuzzy (niqqud/punctuation-insensitive) match of `quote`. */
export function highlightParts(text, quote) {
  const q = strip(quote).slice(0, 80);
  if (!q || !text) return [text];
  const words = q.split(' ').filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [text];
  // Find the region of the text where the first quote words appear in order.
  const lower = String(text).normalize('NFKD').replace(/[֑-ׇ]/g, '').toLowerCase();
  const first = lower.indexOf(words[0]);
  if (first < 0) return [text];
  let end = first + words[0].length;
  let cursor = end;
  for (const w of words.slice(1)) {
    const at = lower.indexOf(w, cursor);
    if (at < 0 || at - cursor > 40) break;
    end = at + w.length;
    cursor = end;
  }
  return [text.slice(0, first), text.slice(first, end), text.slice(end)];
}

/**
 * The page an event came from: the page image (with photo boxes) and its transcription, the evidence
 * quote highlighted. Steps through the event's source pages; unit data is cached per session.
 */
export default function SourcePane({ importId, draft, event, assets, onSelectEvent }) {
  const { t } = useLanguage();
  const refs = event?.sourceRefs || [];
  const units = useMemo(() => [...new Set(refs.map((r) => r.unit))], [refs]);
  const [pos, setPos] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map());
  const unit = units[Math.min(pos, Math.max(0, units.length - 1))];

  useEffect(() => { setPos(0); }, [event?.id]);

  useEffect(() => {
    if (unit === undefined) { setData(null); return undefined; }
    let cancelled = false;
    const load = (u) => {
      if (!cache.current.has(u)) cache.current.set(u, getBookImportUnit(importId, u).catch(() => null));
      return cache.current.get(u);
    };
    setLoading(true);
    load(unit).then((d) => { if (!cancelled) { setData(d); setLoading(false); } });
    // Prefetch the neighbours the user is likely to open next.
    if (units[pos + 1] !== undefined) load(units[pos + 1]);
    return () => { cancelled = true; };
  }, [unit, importId, units, pos]);

  if (!event) {
    return (
      <div className="p-6 text-center text-sm text-ink-muted" data-testid="book-source-empty">
        <FileText className="w-6 h-6 mx-auto mb-2 text-ink-subtle" />
        {t('bookImport.sourceEmpty')}
      </div>
    );
  }

  const snippet = refs.find((r) => r.unit === unit)?.snippet || '';
  const unitMeta = (draft.units || []).find((u) => u.index === unit);
  const photoStatus = Object.fromEntries((draft.photos || []).filter((p) => p.unit === unit).map((p) => [p.id.split('-')[1]?.toUpperCase(), p]));

  return (
    <div className="p-3 space-y-3" data-testid="book-source">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink" dir="auto">
          {unitMeta?.label || t('bookImport.pageN', { n: (unit ?? 0) + 1 })}
          {unitMeta?.printedPages?.length ? ` · ${t('bookImport.printedPages', { pages: unitMeta.printedPages.join('–') })}` : ''}
        </span>
        {units.length > 1 && (
          <span className="ms-auto inline-flex items-center gap-1">
            <button type="button" disabled={pos === 0} onClick={() => setPos((p) => p - 1)} className="p-1 rounded-control hover:bg-surface-hover disabled:opacity-30" aria-label={t('bookImport.prevSource')}><ChevronLeft className="w-4 h-4 rtl:rotate-180" /></button>
            <span className="text-caption tabular-nums text-ink-muted">{pos + 1}/{units.length}</span>
            <button type="button" disabled={pos >= units.length - 1} onClick={() => setPos((p) => p + 1)} className="p-1 rounded-control hover:bg-surface-hover disabled:opacity-30" aria-label={t('bookImport.nextSource')}><ChevronRight className="w-4 h-4 rtl:rotate-180" /></button>
          </span>
        )}
      </div>
      {loading && !data && <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
      {data && (
        <>
          {data.reviewUrl && (
            <div className="relative rounded-control overflow-hidden border border-line bg-surface-sunken">
              <img src={resolveBookImportUrl(data.reviewUrl)} alt={t('bookImport.sourceImageAlt')} className="w-full h-auto block" loading="lazy" />
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {(data.photos || []).filter((p) => Array.isArray(p.box2d) && p.box2d.length === 4 && !['decoration', 'logo'].includes(p.kind)).map((p) => {
                  const [y0, x0, y1, x1] = p.box2d;
                  const st = photoStatus[p.ref]?.status;
                  const inEvent = (event.photos || []).some((ep) => ep.photoId.endsWith(`-${String(p.ref).toLowerCase()}`) && ep.photoId.startsWith(`u${String(unit).padStart(4, '0')}`));
                  const color = inEvent ? '#16a34a' : st === 'linked' ? '#2563eb' : st === 'excluded' ? '#9ca3af' : '#d97706';
                  return <rect key={p.ref} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={color} strokeWidth="4" vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
            </div>
          )}
          {snippet && <blockquote className="text-caption text-ink-muted border-s-2 border-accent ps-2" dir="auto">“{snippet}”</blockquote>}
          <div className="space-y-2 text-sm leading-relaxed text-ink" dir="auto">
            {(data.blocks || []).map((b, i) => {
              const parts = highlightParts(b.text || '', snippet);
              const Tag = b.kind === 'heading' ? 'h4' : 'p';
              return (
                <Tag key={i} className={b.kind === 'heading' ? 'font-semibold' : b.kind === 'caption' ? 'text-caption text-ink-muted' : ''}>
                  {parts.length === 3 ? <>{parts[0]}<mark className="bg-accent-soft text-ink rounded px-0.5">{parts[1]}</mark>{parts[2]}</> : parts[0]}
                </Tag>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
