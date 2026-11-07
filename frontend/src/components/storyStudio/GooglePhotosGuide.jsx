import React, { useEffect, useRef } from 'react';
import { X, ExternalLink, FolderOpen, Images, Clock, Check } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';

export const GOOGLE_TAKEOUT_URL = 'https://takeout.google.com';
export const GOOGLE_PHOTOS_URL = 'https://photos.google.com';

const TAKEOUT_STEPS = 10;
const ALBUM_STEPS = 4;

/** Renders **bold** spans inside a translated string (no other markup). */
function Rich({ text }) {
  const parts = String(text || '').split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
}

function LinkButton({ href, children, testId }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-control bg-accent text-accent-fg hover:bg-accent-hover"
      data-testid={testId}
    >
      {children}<ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}

function Steps({ prefix, count }) {
  const { t } = useLanguage();
  return (
    <ol className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex gap-3 text-sm text-ink-muted leading-relaxed">
          <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-accent-soft text-accent text-caption font-semibold flex items-center justify-center">{i + 1}</span>
          <span><Rich text={t(`photoImport.guide.${prefix}${i + 1}`)} /></span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Step-by-step guide for bringing photos from Google Photos into the import: Google Takeout
 * (dates, places, people, captions) or downloading an album (quick). Opens over the Studio.
 */
export default function GooglePhotosGuide({ open, onClose, canConnect = false }) {
  const { t, isRtl } = useLanguage();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    // Escape closes the guide only (the Studio listens for Escape on window too).
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} dir={isRtl ? 'rtl' : 'ltr'}>
      <div role="dialog" aria-modal="true" aria-labelledby="gp-guide-title" className="w-full max-w-2xl max-h-full overflow-y-auto rounded-panel bg-surface-raised border border-line shadow-xl" data-testid="google-photos-guide">
        <header className="sticky top-0 flex items-start gap-3 px-5 py-4 border-b border-line bg-surface-raised">
          <div className="flex-1 min-w-0">
            <h2 id="gp-guide-title" className="text-lg font-semibold text-ink">{t('photoImport.guide.title')}</h2>
            <p className="text-caption text-ink-muted mt-0.5 leading-snug">{t('photoImport.guide.subtitle')}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')} className="p-2 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-6">
          <table className="w-full text-xs border border-line rounded-control overflow-hidden">
            <thead className="bg-surface-sunken text-ink">
              <tr>
                <th className="text-start font-semibold p-2" />
                <th className="text-start font-semibold p-2">{t('photoImport.guide.colDates')}</th>
                <th className="text-start font-semibold p-2">{t('photoImport.guide.colPlaces')}</th>
                <th className="text-start font-semibold p-2">{t('photoImport.guide.colPeople')}</th>
                <th className="text-start font-semibold p-2">{t('photoImport.guide.colWait')}</th>
              </tr>
            </thead>
            <tbody className="text-ink-muted">
              <tr className="border-t border-line">
                <td className="p-2 font-medium text-ink">{t('photoImport.guide.optTakeout')}</td>
                <td className="p-2"><Check className="w-3.5 h-3.5 text-success" /></td>
                <td className="p-2">{t('photoImport.guide.placesAll')}</td>
                <td className="p-2"><Check className="w-3.5 h-3.5 text-success" /></td>
                <td className="p-2">{t('photoImport.guide.waitTakeout')}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="p-2 font-medium text-ink">{t('photoImport.guide.optAlbum')}</td>
                <td className="p-2"><Check className="w-3.5 h-3.5 text-success" /></td>
                <td className="p-2">{t('photoImport.guide.placesCamera')}</td>
                <td className="p-2">—</td>
                <td className="p-2">{t('photoImport.guide.waitNone')}</td>
              </tr>
              {canConnect && (
                <tr className="border-t border-line">
                  <td className="p-2 font-medium text-ink">{t('photoImport.guide.optConnect')}</td>
                  <td className="p-2"><Check className="w-3.5 h-3.5 text-success" /></td>
                  <td className="p-2">{t('photoImport.guide.placesNone')}</td>
                  <td className="p-2">—</td>
                  <td className="p-2">{t('photoImport.guide.waitNone')}</td>
                </tr>
              )}
            </tbody>
          </table>

          <section className="space-y-3" data-testid="guide-takeout">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink flex-1">{t('photoImport.guide.takeoutTitle')}</h3>
            </div>
            <p className="text-caption text-ink-muted leading-snug">{t('photoImport.guide.takeoutIntro')}</p>
            <LinkButton href={GOOGLE_TAKEOUT_URL} testId="guide-takeout-link">{t('photoImport.guide.openTakeout')}</LinkButton>
            <Steps prefix="t" count={TAKEOUT_STEPS} />
            <p className="text-caption text-ink-muted flex items-start gap-2"><Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" /><Rich text={t('photoImport.guide.takeoutNote')} /></p>
          </section>

          <section className="space-y-3 pt-5 border-t border-line" data-testid="guide-album">
            <div className="flex items-center gap-2">
              <Images className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink flex-1">{t('photoImport.guide.albumTitle')}</h3>
            </div>
            <p className="text-caption text-ink-muted leading-snug">{t('photoImport.guide.albumIntro')}</p>
            <LinkButton href={GOOGLE_PHOTOS_URL} testId="guide-photos-link">{t('photoImport.guide.openPhotos')}</LinkButton>
            <Steps prefix="a" count={ALBUM_STEPS} />
            <p className="text-caption text-ink-muted"><Rich text={t('photoImport.guide.albumNote')} /></p>
          </section>

          <p className="text-caption text-ink rounded-control bg-accent-soft/60 p-3"><Rich text={t('photoImport.guide.tip')} /></p>
        </div>
      </div>
    </div>
  );
}
