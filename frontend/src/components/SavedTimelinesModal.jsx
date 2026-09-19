import React, { useState, useEffect, useRef } from 'react';
import { X, FolderOpen, Calendar, Trash2, Upload, Loader2, Play, Copy, Pencil, Check, Pin, MoreVertical, Globe } from 'lucide-react';
import { fetchTimelines, deleteTimeline, fetchTimeline, saveTimeline, setTimelineShareEnabled } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

function SavedTimelineTitle({ title, isRtl }) {
  const isTitleRtl = /[\u0590-\u08FF]/.test(title) || (!/[A-Za-z\u00C0-\u024F]/.test(title) && isRtl);

  return (
    <div
      dir={isTitleRtl ? 'rtl' : 'ltr'}
      className={`min-w-0 flex-1 overflow-hidden ${isTitleRtl ? 'text-right' : 'text-left'}`}
    >
      <h4
        title={title}
        className="font-semibold text-sm text-ink group-hover:text-accent transition-colors line-clamp-2 leading-snug break-words"
      >
        {title}
      </h4>
    </div>
  );
}

export default function SavedTimelinesModal({
  isOpen,
  onClose,
  onSelectTimeline,
  onImportJson
}) {
  const { t, language, isRtl } = useLanguage();
  const { user, isGuest } = useAuth();
  const [timelines, setTimelines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRenameId, setSavingRenameId] = useState(null);
  const [pinningId, setPinningId] = useState(null);
  const [sharingId, setSharingId] = useState(null);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const sortedTimelines = [...timelines].sort((first, second) => (
    Number(Boolean(second.isPinned)) - Number(Boolean(first.isPinned))
  ));

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
    } else {
      setRenamingId(null);
      setActiveMenuId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!activeMenuId) return;
    const handleDocumentClick = () => setActiveMenuId(null);
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setActiveMenuId(null);
    };
    window.addEventListener('click', handleDocumentClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleDocumentClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuId]);

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
        isPinned: false,
      };
      await saveTimeline(copy);
      await loadList();
    } catch (err) {
      alert(t('savedTimelines.duplicateError'));
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleTogglePin = async (item, e) => {
    e.stopPropagation();
    if (pinningId === item.id) return;

    setPinningId(item.id);
    try {
      const original = await fetchTimeline(item.id);
      const { isOwner, isShared, ...timeline } = original;
      const isPinned = !item.isPinned;
      await saveTimeline({ ...timeline, isPinned });
      setTimelines((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, isPinned } : entry
      )));
    } catch (err) {
      alert('Failed to update the timeline pin. Please try again.');
    } finally {
      setPinningId(null);
    }
  };

  const handleToggleShare = async (item, e) => {
    e.stopPropagation();
    if (sharingId === item.id) return;
    setSharingId(item.id);
    const newStatus = !item.isShared;
    const author = user && !isGuest
      ? (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Community Explorer')
      : 'Guest Explorer';
    try {
      await setTimelineShareEnabled(item.id, newStatus, newStatus ? author : null);
      setTimelines((prev) =>
        prev.map((entry) => (entry.id === item.id ? { ...entry, isShared: newStatus } : entry))
      );
    } catch (err) {
      alert(t('savedTimelines.shareError') || 'Failed to update community status');
    } finally {
      setSharingId(null);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-xl overflow-hidden shadow-panel flex flex-col max-h-[90vh] sm:max-h-[85vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-line bg-surface-raised">
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
        <div className="px-4 py-2.5 sm:px-6 sm:py-3 bg-surface-sunken border-b border-line flex items-center justify-between">
          <span className="text-xs font-medium text-ink-muted">
            {timelines.length === 1
              ? t('savedTimelines.foundCountSingle')
              : t('savedTimelines.foundCount', { count: timelines.length })}
          </span>
          <label className="flex items-center gap-1.5 bg-surface-raised hover:bg-surface-hover text-ink px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-control text-xs font-medium border border-line shadow-control cursor-pointer transition-colors">
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
        <div className="flex-1 overflow-y-auto p-3 pb-8 sm:p-6 sm:pb-8 space-y-2 sm:space-y-2.5">
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
            sortedTimelines.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (renamingId === item.id) return;
                  onSelectTimeline(item.id);
                  onClose();
                }}
                className="group relative flex items-start sm:items-center justify-between p-3 sm:p-3.5 bg-surface-sunken hover:bg-surface-hover border border-line hover:border-line-strong rounded-panel cursor-pointer transition-all shadow-control gap-2.5 sm:gap-3"
              >
                {renamingId === item.id ? (
                  <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        dir="auto"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmRename(item.id, e);
                          else if (e.key === 'Escape') handleCancelRename(e);
                        }}
                        className="flex-1 font-semibold text-sm text-ink bg-surface-raised border border-line-strong rounded-control px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent-ring"
                      />
                      <button
                        type="button"
                        onClick={(e) => handleConfirmRename(item.id, e)}
                        disabled={savingRenameId === item.id}
                        title={t('common.save')}
                        className="p-1.5 text-accent hover:bg-accent-soft rounded-control transition-colors cursor-pointer"
                      >
                        {savingRenameId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleCancelRename(e)}
                        title={t('common.cancel')}
                        className="p-1.5 text-ink-subtle hover:bg-surface-active rounded-control transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SavedTimelineTitle title={item.title} isRtl={isRtl} />
                      {item.isShared && (
                        <span className="shrink-0 text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-control flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          <span>{t('savedTimelines.publicBadge') || 'Public'}</span>
                        </span>
                      )}
                      {item.timeScale === 'prehistoric' && (
                        <span className="shrink-0 text-caption font-semibold bg-accent-soft text-accent border border-accent/40 px-1.5 py-0.5 rounded-control">
                          {t('savedTimelines.prehistoricBadge')}
                        </span>
                      )}
                    </div>
                    {item.description && (() => {
                      const isDescRtl = /[\u0590-\u08FF]/.test(item.description) || (!/[A-Za-z\u00C0-\u024F]/.test(item.description) && isRtl);
                      return (
                        <p
                          dir={isDescRtl ? 'rtl' : 'ltr'}
                          className={`text-xs text-ink-muted line-clamp-2 mt-0.5 ${isDescRtl ? 'text-right' : 'text-left'}`}
                        >
                          {item.description}
                        </p>
                      );
                    })()}
                    <div className="flex items-center gap-3 text-caption text-ink-subtle mt-1">
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
                )}

                {renamingId !== item.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Direct Community Wall Visibility Toggle */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleShare(item, e)}
                      disabled={sharingId === item.id}
                      aria-pressed={Boolean(item.isShared)}
                      title={
                        item.isShared
                          ? (t('savedTimelines.unpublishWall') || 'Unpublish from Wall')
                          : (t('savedTimelines.publishWall') || 'Publish to Wall')
                      }
                      className={`p-2 rounded-control transition-colors cursor-pointer ${
                        item.isShared
                          ? 'text-emerald-500 hover:bg-emerald-500/15'
                          : 'text-ink-subtle hover:text-emerald-500 hover:bg-surface-active'
                      }`}
                    >
                      {sharingId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Globe className={`w-4 h-4 ${item.isShared ? 'stroke-[2.5]' : ''}`} />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(item, e)}
                      disabled={pinningId === item.id}
                      aria-pressed={Boolean(item.isPinned)}
                      title={item.isPinned ? t('savedTimelines.unpinTooltip') : t('savedTimelines.pinTooltip')}
                      className={`p-2 rounded-control transition-colors cursor-pointer ${
                        item.isPinned
                          ? 'text-warning'
                          : 'text-ink-subtle hover:text-warning hover:bg-surface-active'
                      }`}
                    >
                      {pinningId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Pin className={`w-4 h-4 ${item.isPinned ? 'fill-current' : ''}`} />
                      )}
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(activeMenuId === item.id ? null : item.id);
                        }}
                        aria-label="Options"
                        className="p-2 text-ink-subtle hover:text-ink hover:bg-surface-active rounded-control transition-colors cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeMenuId === item.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute z-30 top-full mt-1 ${
                            isRtl ? 'left-0' : 'right-0'
                          } bg-surface-raised border border-line-strong rounded-panel shadow-floating py-1 min-w-[150px] text-xs animate-in fade-in-50 zoom-in-95`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              setActiveMenuId(null);
                              handleStartRename(item, e);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5 text-ink-subtle" />
                            <span>{t('savedTimelines.renameTooltip')}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              setActiveMenuId(null);
                              handleDuplicate(item.id, e);
                            }}
                            disabled={duplicatingId === item.id}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5 text-ink-subtle" />
                            <span>{t('savedTimelines.duplicateTooltip')}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              setActiveMenuId(null);
                              handleToggleShare(item, e);
                            }}
                            disabled={sharingId === item.id}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                          >
                            <Globe className="w-3.5 h-3.5 text-accent" />
                            <span>
                              {item.isShared
                                ? (t('savedTimelines.unpublishWall') || 'Unpublish from Wall')
                                : (t('savedTimelines.publishWall') || 'Publish to Wall')}
                            </span>
                          </button>

                          <div className="my-1 border-t border-line" />

                          <button
                            type="button"
                            onClick={(e) => {
                              setActiveMenuId(null);
                              handleDelete(item.id, e);
                            }}
                            disabled={deletingId === item.id}
                            className="w-full flex items-center gap-2 px-3 py-2 text-danger hover:bg-danger-soft transition-colors text-start cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-danger" />
                            <span>{t('savedTimelines.deleteTooltip')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
