import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Images, Upload, Search, Check, Undo2, Trash2 } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import {
  PHOTO_TRAY_MIME,
  TRAY_ACCEPT,
  TRAY_MAX_PHOTOS,
  classifyTrayFile,
  filterEventsByQuery,
  fileToTrayDataUrl,
  suggestEventsForPhoto,
  readPhotoTakenDay,
} from '../utils/photoTray';

let photoSeq = 0;

/**
 * Floating "Photo Tray": bulk-upload images, search events, and assign photos to events by
 * dragging a thumbnail onto an event (in this panel or on the timeline canvas) or by
 * selecting a photo and clicking an event.
 */
export default function PhotoTrayPanel({
  photos,
  setPhotos,
  articles = [],
  onAssign, // (articleId, photo) => void
  onUndo,
  canUndo = false,
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [dragOverEventId, setDragOverEventId] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const filtered = useMemo(() => filterEventsByQuery(articles, query), [articles, query]);
  const selectedPhoto = photos.find((p) => p.id === selectedId) || null;
  const suggestions = useMemo(
    () => (selectedPhoto ? suggestEventsForPhoto(selectedPhoto.name, articles, 3, selectedPhoto.taken || null) : []),
    [selectedPhoto, articles]
  );
  const withImageCount = useMemo(
    () => articles.filter((a) => typeof a?.imageUrl === 'string' && a.imageUrl.trim()).length,
    [articles]
  );

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsBusy(true);
    setNotice(null);
    let skipped = 0;
    const added = [];
    for (const file of files) {
      if (photos.length + added.length >= TRAY_MAX_PHOTOS) { skipped += 1; continue; }
      if (classifyTrayFile(file) !== 'ok') { skipped += 1; continue; }
      try {
        // Read the capture day before re-encoding (the canvas copy has no EXIF).
        const [dataUrl, taken] = await Promise.all([fileToTrayDataUrl(file), readPhotoTakenDay(file)]);
        photoSeq += 1;
        added.push({ id: `tray-${Date.now()}-${photoSeq}`, name: file.name, dataUrl, taken });
      } catch {
        skipped += 1;
      }
    }
    if (added.length) setPhotos((prev) => [...prev, ...added]);
    if (skipped) setNotice(t('photoTray.skipped', { count: skipped }));
    setIsBusy(false);
  }, [photos.length, setPhotos, t]);

  const handlePanelDrop = (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }
  };

  const assign = (articleId, photoId) => {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) return;
    onAssign?.(articleId, photo);
    setSelectedId(null);
  };

  return (
    <div
      className="flex flex-col min-h-0"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
      onDrop={handlePanelDrop}
      data-testid="photo-tray"
    >
      {canUndo && (
        <div className="flex justify-end px-3 pt-2">
          <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink" data-testid="photo-tray-undo">
            <Undo2 className="w-3.5 h-3.5" /> {t('photoTray.undo')}
          </button>
        </div>
      )}
      <div className="p-3 border-b border-line">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-sm text-ink hover:border-accent"
          data-testid="photo-tray-upload"
        >
          <Upload className="w-4 h-4" />
          {isBusy ? t('photoTray.processing') : t('photoTray.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={TRAY_ACCEPT}
          className="hidden"
          data-testid="photo-tray-input"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        {notice && <p className="mt-2 text-xs text-ink-subtle">{notice}</p>}
        <p className="mt-2 text-xs text-ink-subtle">{t('photoTray.hint')}</p>
      </div>

      {photos.length > 0 && (
        <div className="px-3 pt-3">
          <div className="flex items-center justify-between mb-2 text-xs text-ink-subtle">
            <span>{t('photoTray.photosCount', { count: photos.length })}</span>
            <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => { setPhotos([]); setSelectedId(null); }}>
              <Trash2 className="w-3 h-3" /> {t('photoTray.clear')}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 max-h-[22vh] overflow-y-auto" data-testid="photo-tray-thumbs">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PHOTO_TRAY_MIME, p.id);
                  e.dataTransfer.effectAllowed = 'copy';
                  setSelectedId(p.id);
                }}
                onClick={() => setSelectedId((cur) => (cur === p.id ? null : p.id))}
                title={p.name}
                aria-pressed={selectedId === p.id}
                className={`relative aspect-square overflow-hidden rounded-lg border-2 ${selectedId === p.id ? 'border-accent' : 'border-transparent'} ${p.assignedTo ? 'opacity-50' : ''}`}
              >
                <img src={p.dataUrl} alt={p.name} className="w-full h-full object-cover" draggable={false} />
                {p.assignedTo && <Check className="absolute top-1 right-1 w-4 h-4 p-0.5 rounded-full bg-accent text-accent-fg" />}
              </button>
            ))}
          </div>
          {selectedPhoto && suggestions.length > 0 && (
            <p className="mt-2 text-xs text-ink-subtle">
              {t('photoTray.suggested')}{' '}
              {suggestions.map((a) => (
                <button key={a.id} type="button" className="mr-1 underline text-accent" onClick={() => assign(a.id, selectedPhoto.id)}>
                  {a.title}
                </button>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="px-3 pt-3 pb-1">
        <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
          <Search className="w-4 h-4 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('photoTray.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm outline-none text-ink"
            data-testid="photo-tray-search"
          />
        </label>
        <p className="mt-1 text-xs text-ink-subtle">
          {t('photoTray.coverage', { withImage: withImageCount, total: articles.length })}
        </p>
      </div>

      <ul className="flex-1 min-h-[80px] overflow-y-auto px-3 pb-3 space-y-1" data-testid="photo-tray-events">
        {filtered.length === 0 && <li className="text-xs text-ink-subtle py-2">{t('photoTray.noResults')}</li>}
        {filtered.map((a) => {
          const hasImage = typeof a.imageUrl === 'string' && a.imageUrl.trim();
          return (
            <li key={a.id}>
              <button
                type="button"
                data-event-id={a.id}
                onClick={() => selectedPhoto && assign(a.id, selectedPhoto.id)}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes(PHOTO_TRAY_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverEventId(a.id); }
                }}
                onDragLeave={() => setDragOverEventId((cur) => (cur === a.id ? null : cur))}
                onDrop={(e) => {
                  const photoId = e.dataTransfer?.getData(PHOTO_TRAY_MIME);
                  setDragOverEventId(null);
                  if (photoId) { e.preventDefault(); assign(a.id, photoId); }
                }}
                className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-start text-sm ${dragOverEventId === a.id ? 'bg-accent/20 ring-2 ring-accent' : 'hover:bg-surface-hover'} ${selectedPhoto ? 'cursor-copy' : ''}`}
              >
                <span className="w-8 h-8 shrink-0 rounded-md overflow-hidden bg-surface-hover flex items-center justify-center">
                  {hasImage ? <img src={a.imageUrl} alt="" className="w-full h-full object-cover" /> : <Images className="w-4 h-4 text-ink-subtle" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-ink">{a.title}</span>
                  {a.from?.year != null && <span className="block text-xs text-ink-subtle">{a.from.year}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
