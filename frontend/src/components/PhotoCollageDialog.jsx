import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Star, Plus, Loader2, LayoutGrid, AlertTriangle } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import {
  COLLAGE_LAYOUTS, COLLAGE_MAX_PHOTOS, COLLAGE_WIDTH, COLLAGE_HEIGHT,
  computeCollageCells, coverCrop, toggleCollageSelection,
} from '../utils/photoCollage';

// The saved collage is an inline JPEG data URL (like uploaded photos); keep it well under the
// backend's 1.5M-char imageUrl limit.
const MAX_DATA_URL_CHARS = 1_350_000;

const BACKGROUNDS = {
  light: { fill: '#f7f4ee', paper: '#efe7da' },
  dark: { fill: '#18181b', paper: '#27272a' },
};

// Loads a photo with CORS enabled so the canvas stays exportable; tries each candidate URL.
function loadCollageImage(candidates) {
  const urls = [...new Set(candidates.filter(Boolean))];
  return new Promise((resolve) => {
    const tryAt = (i) => {
      if (i >= urls.length) {
        resolve(null);
        return;
      }
      const img = new Image();
      if (!urls[i].startsWith('data:')) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => tryAt(i + 1);
      img.src = urls[i];
    };
    tryAt(0);
  });
}

function roundedClip(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.clip();
}

function drawPhoto(ctx, img, x, y, w, h) {
  const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawCollage(canvas, layout, images, background) {
  const ctx = canvas.getContext('2d');
  const colors = BACKGROUNDS[background] || BACKGROUNDS.light;
  canvas.width = COLLAGE_WIDTH;
  canvas.height = COLLAGE_HEIGHT;
  ctx.fillStyle = layout === 'polaroid' ? colors.paper : colors.fill;
  ctx.fillRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT);

  const cells = computeCollageCells(layout, images.length, COLLAGE_WIDTH, COLLAGE_HEIGHT, layout === 'polaroid' ? 28 : 12);
  cells.forEach((cell, i) => {
    const img = images[i];
    if (!img) return;
    ctx.save();
    if (layout === 'polaroid') {
      ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
      ctx.rotate(cell.rotation);
      const pad = Math.min(cell.w, cell.h) * 0.045;
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-cell.w / 2, -cell.h / 2, cell.w, cell.h);
      ctx.shadowColor = 'transparent';
      drawPhoto(ctx, img, -cell.w / 2 + pad, -cell.h / 2 + pad, cell.w - pad * 2, cell.h - pad * 3.2);
    } else {
      roundedClip(ctx, cell.x, cell.y, cell.w, cell.h, 10);
      drawPhoto(ctx, img, cell.x, cell.y, cell.w, cell.h);
    }
    ctx.restore();
  });
}

function exportCanvas(canvas) {
  for (const quality of [0.86, 0.75, 0.62]) {
    const url = canvas.toDataURL('image/jpeg', quality); // throws SecurityError if tainted
    if (url.length <= MAX_DATA_URL_CHARS) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.5);
}

/**
 * Builds a collage from an event's photos. `photos` items: { url, lightboxCandidates?, caption? }.
 * `onSave(dataUrl, { asCover })` is optional; without it only Download is offered.
 */
export default function PhotoCollageDialog({ photos: photosProp, title = '', onClose, onSave, zIndex = null }) {
  const { t, isRtl } = useLanguage();
  // Snapshot on open: the host rebuilds its photo list every render.
  const [photos] = useState(photosProp);
  const canvasRef = useRef(null);
  const [layout, setLayout] = useState('grid');
  const [background, setBackground] = useState('light');
  const [selection, setSelection] = useState(() => photos.slice(0, COLLAGE_MAX_PHOTOS).map((_, i) => i));
  const [loaded, setLoaded] = useState({}); // index -> HTMLImageElement | null (failed)
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    photos.forEach((photo, i) => {
      loadCollageImage([...(photo.lightboxCandidates || []), photo.url]).then((img) => {
        if (!cancelled) setLoaded((prev) => ({ ...prev, [i]: img }));
      });
    });
    return () => { cancelled = true; };
  }, [photos]);

  const usable = useMemo(
    () => selection.filter((i) => loaded[i]),
    [selection, loaded]
  );
  const isLoading = selection.some((i) => loaded[i] === undefined);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawCollage(canvasRef.current, layout, usable.map((i) => loaded[i]), background);
    setError(null);
  }, [layout, background, usable, loaded]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const getDataUrl = () => {
    try {
      return exportCanvas(canvasRef.current);
    } catch {
      setError(t('photoCollage.exportBlocked'));
      return null;
    }
  };

  const handleDownload = () => {
    const url = getDataUrl();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    const safe = (title || 'collage').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'collage';
    a.download = `${safe} - collage.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleSave = async (asCover) => {
    const url = getDataUrl();
    if (!url) return;
    setBusy(true);
    try {
      await onSave?.(url, { asCover });
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const failedCount = selection.filter((i) => loaded[i] === null).length;
  const canExport = usable.length >= 2 && !isLoading && !busy;

  const chip = (active) => `px-3 py-2 rounded-control text-xs font-medium border transition-colors cursor-pointer ${
    active ? 'bg-accent-soft border-accent text-accent' : 'bg-surface-raised border-line text-ink-muted hover:text-ink'
  }`;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-3 sm:p-6"
      style={zIndex != null ? { zIndex } : undefined}
      onClick={onClose}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('photoCollage.title')}
        className="w-full max-w-3xl max-h-full overflow-y-auto rounded-panel bg-surface-overlay border border-line shadow-pop text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LayoutGrid className="w-4 h-4 text-ink-subtle" />
            <span>{t('photoCollage.title')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover cursor-pointer"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-line bg-surface-sunken">
            <canvas ref={canvasRef} className="w-full h-full block" data-testid="photo-collage-canvas" />
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-semibold text-ink-subtle me-1">{t('photoCollage.layout')}</span>
            {COLLAGE_LAYOUTS.map((key) => (
              <button key={key} type="button" className={chip(layout === key)} aria-pressed={layout === key} onClick={() => setLayout(key)}>
                {t(`photoCollage.layouts.${key}`)}
              </button>
            ))}
            <span className="text-caption font-semibold text-ink-subtle ms-3 me-1">{t('photoCollage.background')}</span>
            {Object.keys(BACKGROUNDS).map((key) => (
              <button key={key} type="button" className={chip(background === key)} aria-pressed={background === key} onClick={() => setBackground(key)}>
                {t(`photoCollage.backgrounds.${key}`)}
              </button>
            ))}
          </div>

          <div>
            <p className="text-caption text-ink-muted mb-2">
              {t('photoCollage.pickHint', { max: COLLAGE_MAX_PHOTOS })}
            </p>
            <div className="flex flex-wrap gap-2">
              {photos.map((photo, i) => {
                const order = selection.indexOf(i);
                const failed = loaded[i] === null;
                return (
                  <button
                    key={`${i}-${photo.url.slice(-24)}`}
                    type="button"
                    onClick={() => setSelection((prev) => toggleCollageSelection(prev, i))}
                    aria-pressed={order !== -1}
                    title={failed ? t('photoCollage.photoUnavailable') : (photo.caption || '')}
                    className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      order !== -1 ? 'border-accent' : 'border-transparent opacity-50 hover:opacity-90'
                    } ${failed ? 'grayscale' : ''}`}
                  >
                    <img src={photo.url} alt="" className="w-full h-full object-cover bg-white" />
                    {order !== -1 && (
                      <span className="absolute top-0.5 end-0.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-accent text-accent-fg text-caption font-bold flex items-center justify-center tabular-nums">
                        {order + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {(failedCount > 0 || error || usable.length < 2) && !isLoading && (
            <p className="flex items-start gap-2 text-caption text-warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {error
                  || (usable.length < 2 ? t('photoCollage.needTwo') : t('photoCollage.someUnavailable', { count: failedCount }))}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-line">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-line bg-surface-raised text-xs font-semibold text-ink hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('photoCollage.download')}</span>
          </button>
          {onSave && (
            <>
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={!canExport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-line bg-surface-raised text-xs font-semibold text-ink hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('photoCollage.addToPhotos')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={!canExport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-control disabled:opacity-40 disabled:cursor-default cursor-pointer"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                <span>{t('photoCollage.setAsMain')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
