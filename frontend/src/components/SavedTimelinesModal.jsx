import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Calendar, Trash2, Upload, Loader2, Play, Copy, Pencil, Check } from 'lucide-react';
import { fetchTimelines, deleteTimeline, fetchTimeline, saveTimeline } from '../api';
import { useLanguage } from '../context/LanguageContext';

export default function SavedTimelinesModal({
  isOpen,
  onClose,
  onSelectTimeline,
  onImportJson
}) {
  const { t, language, isRtl } = useLanguage();
  const [timelines, setTimelines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRenameId, setSavingRenameId] = useState(null);

  const loadList = async () => {
    setLoading(true);
    try {
      const list = await fetchTimelines();
      setTimelines(list);
    } catch (e) {
      console.warn('Failed to load timelines list:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadList();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm(t('savedTimelines.confirmDelete'))) return;
    setDeletingId(id);
    try {
      await deleteTimeline(id);
      setTimelines((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert(t('savedTimelines.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (id, e) => {
    e.stopPropagation();
    setDuplicatingId(id);
    try {
      const original = await fetchTimeline(id);
      const { isOwner, isShared, ...rest } = original;
      const copy = {
        ...rest,
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: t('savedTimelines.copyTitle', { title: original.title }),
        createdAt: null,
        updatedAt: null,
      };
      await saveTimeline(copy);
      await loadList();
    } catch (err) {
      alert(t('savedTimelines.duplicateError'));
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleStartRename = (item, e) => {
    e.stopPropagation();
    setRenamingId(item.id);
    setRenameValue(item.title);
  };

  const handleCancelRename = (e) => {
    e?.stopPropagation();
    setRenamingId(null);
  };

  const handleConfirmRename = async (id, e) => {
    e?.stopPropagation();
    if (savingRenameId === id) return;
    const trimmed = renameValue.trim();
    const current = timelines.find((item) => item.id === id);
    if (!trimmed || (current && trimmed === current.title)) {
      setRenamingId(null);
      return;
    }
    setSavingRenameId(id);
    try {
      const original = await fetchTimeline(id);
      await saveTimeline({ ...original, title: trimmed });
      setTimelines((prev) => prev.map((item) => (item.id === id ? { ...item, title: trimmed } : item)));
      setRenamingId(null);
    } catch (err) {
      alert(t('savedTimelines.renameError'));
    } finally {
      setSavingRenameId(null);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result);
        if (!parsed.articles || !parsed.title) {
          throw new Error(t('savedTimelines.invalidJsonStructure'));
        }
        onImportJson(parsed);
        onClose();
      } catch (err) {
        alert(t('savedTimelines.invalidJson', { err: err.message }));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-xl overflow-hidden shadow-panel flex flex-col max-h-[85vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-control bg-warning-soft text-warning border border-warning/40">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">
                {t('savedTimelines.title')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('savedTimelines.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar: Import JSON */}
        <div className="px-6 py-3 bg-surface-sunken border-b border-line flex items-center justify-between">
          <span className="text-xs font-medium text-ink-muted">
            {timelines.length === 1
              ? t('savedTimelines.foundCountSingle')
              : t('savedTimelines.foundCount', { count: timelines.length })}
          </span>
          <label className="flex items-center gap-1.5 bg-surface-raised hover:bg-surface-hover text-ink px-3 py-1.5 rounded-control text-xs font-medium border border-line shadow-control cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5 text-accent" />
            <span>{t('savedTimelines.importJson')}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* List of timelines */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-ink-subtle gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <span className="text-xs">{t('savedTimelines.loading')}</span>
            </div>
          ) : timelines.length === 0 ? (
            <div className="py-12 text-center text-ink-subtle text-xs">
              {t('savedTimelines.empty')}
            </div>
          ) : (
            timelines.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (renamingId === item.id) return;
                  onSelectTimeline(item.id);
                  onClose();
                }}
                className="group flex items-center justify-between p-3.5 bg-surface-sunken hover:bg-surface-hover border border-line hover:border-line-strong rounded-panel cursor-pointer transition-all shadow-control"
              >
                <div className="flex-1 min-w-0 pr-4">
                  {renamingId === item.id ? (
                    <input
                      type="text"
                      autoFocus
                      dir="auto"
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmRename(item.id, e);
                        else if (e.key === 'Escape') handleCancelRename(e);
                      }}
                      onBlur={(e) => handleConfirmRename(item.id, e)}
                      className="w-full font-semibold text-sm text-ink bg-surface-raised border border-line-strong rounded-control px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent-ring"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <h4
                        dir="auto"
                        className="font-semibold text-sm text-ink group-hover:text-accent transition-colors truncate"
                      >
                        {item.title}
                      </h4>
                      {item.timeScale === 'prehistoric' && (
                        <span className="text-[10px] bg-accent-soft text-accent border border-accent/40 px-1.5 py-0.5 rounded-control">
                          {t('savedTimelines.prehistoricBadge')}
                        </span>
                      )}
                    </div>
                  )}
                  {item.description && (
                    <p dir="auto" className="text-xs text-ink-muted truncate mt-0.5">
                      {item.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-ink-subtle mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {t('savedTimelines.eventsCount', { count: item.articleCount })}
                    </span>
                    {item.updatedAt && (
                      <span>
                        {t('savedTimelines.updatedDate', {
                          date: new Date(item.updatedAt).toLocaleDateString(language)
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {renamingId === item.id ? (
                    <button
                      type="button"
                      onClick={(e) => handleConfirmRename(item.id, e)}
                      disabled={savingRenameId === item.id}
                      title={t('common.save')}
                      className="p-2 text-accent hover:bg-accent-soft rounded-control transition-colors cursor-pointer"
                    >
                      {savingRenameId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(item, e)}
                      title={t('savedTimelines.renameTooltip')}
                      className="p-2 text-ink-subtle hover:text-accent hover:bg-surface-active rounded-control transition-colors cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    title={t('savedTimelines.loadTooltip')}
                    className="p-2 text-ink-subtle group-hover:text-accent hover:bg-surface-active rounded-control transition-colors cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDuplicate(item.id, e)}
                    disabled={duplicatingId === item.id}
                    title={t('savedTimelines.duplicateTooltip')}
                    className="p-2 text-ink-subtle hover:text-accent hover:bg-surface-active rounded-control transition-colors cursor-pointer"
                  >
                    {duplicatingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(item.id, e)}
                    disabled={deletingId === item.id}
                    title={t('savedTimelines.deleteTooltip')}
                    className="p-2 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-control transition-colors cursor-pointer"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-danger" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
