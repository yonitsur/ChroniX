import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FolderOpen,
  Calendar,
  Trash2,
  Upload,
  Loader2,
  Play,
  Copy,
  Pencil,
  Check,
  Pin,
  MoreVertical,
  Share2,
  Link2,
  Download,
  ChevronDown,
  FileText,
  Table,
  Code2,
  Printer
} from 'lucide-react';
import { fetchTimelines, deleteTimeline, fetchTimeline, saveTimeline, setTimelineShareEnabled } from '../api';
import useModalAnimation from '../hooks/useModalAnimation';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import {
  copyToClipboard,
  downloadFile,
  sanitizeFilename,
  generateTimelineText,
  generateTimelineMarkdown,
  generateTimelineCsv,
  printTimelinePdf
} from '../utils/timelineExport';

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
  const [sharingTimelineId, setSharingTimelineId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [openExportSubmenuId, setOpenExportSubmenuId] = useState(null);
  const [exportingState, setExportingState] = useState({ id: null, format: null });
  const [selectedMobileId, setSelectedMobileId] = useState(null);
  const timelineCacheRef = useRef({});

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && (window.innerWidth < 640 || ('ontouchstart' in window && window.innerWidth < 768))
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(typeof window !== 'undefined' && (window.innerWidth < 640 || ('ontouchstart' in window && window.innerWidth < 768)));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      setOpenExportSubmenuId(null);
      setSelectedMobileId(null);
    }
  }, [isOpen]);

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (openExportSubmenuId) setOpenExportSubmenuId(null);
        else if (activeMenuId) setActiveMenuId(null);
        else handleClose();
      }
    };
    const handleDocumentClick = () => {
      if (activeMenuId) {
        setActiveMenuId(null);
        setOpenExportSubmenuId(null);
      }
    };
    window.addEventListener('click', handleDocumentClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleDocumentClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, activeMenuId, openExportSubmenuId, handleClose]);

  if (!isRendered) return null;

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

  const ensureTimelineShared = async (item) => {
    if (!item.isShared) {
      const author = user && !isGuest
        ? (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Explorer')
        : 'Explorer';
      try {
        await setTimelineShareEnabled(item.id, true, author);
        setTimelines((prev) =>
          prev.map((entry) => (entry.id === item.id ? { ...entry, isShared: true } : entry))
        );
      } catch (err) {
        console.warn('Failed to update timeline share status on server:', err);
      }
    }
  };

  const handleShareTimeline = async (item, e) => {
    e?.stopPropagation();
    if (sharingTimelineId === item.id) return;
    setSharingTimelineId(item.id);

    try {
      await ensureTimelineShared(item);
      const shareUrl = `${window.location.origin}/t/${item.id}`;
      const shareTitle = item.title || 'ChroniX Timeline';
      const shareText = `${shareTitle} | ChroniX`;

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        const shareData = {
          title: shareTitle,
          url: shareUrl,
        };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          setActiveMenuId(null);
          try {
            await navigator.share(shareData);
            return;
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }
      }

      await copyToClipboard(shareUrl);
      setCopiedId(item.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === item.id ? null : curr));
        setActiveMenuId(null);
      }, 1500);
    } catch (err) {
      console.error('Share failed:', err);
      alert(t('savedTimelines.shareError') || 'Failed to share timeline');
    } finally {
      setSharingTimelineId(null);
    }
  };

  const handleCopyShareLink = async (item, e) => {
    e?.stopPropagation();
    if (copiedId === item.id) return;

    try {
      await ensureTimelineShared(item);
      const shareUrl = `${window.location.origin}/t/${item.id}`;
      await copyToClipboard(shareUrl);
      setCopiedId(item.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === item.id ? null : curr));
        setActiveMenuId(null);
      }, 1500);
    } catch (err) {
      console.error('Copy link failed:', err);
      alert(t('savedTimelines.shareError') || 'Failed to copy share link');
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

  const getFullTimeline = async (id) => {
    if (timelineCacheRef.current[id]) {
      return timelineCacheRef.current[id];
    }
    const full = await fetchTimeline(id);
    timelineCacheRef.current[id] = full;
    return full;
  };

  const handleExport = async (item, format, e) => {
    e?.stopPropagation();
    if (exportingState.id === item.id) return;
    setExportingState({ id: item.id, format });

    try {
      const full = await getFullTimeline(item.id);
      const filename = sanitizeFilename(full.title || item.title || 'timeline');

      switch (format) {
        case 'json': {
          const content = JSON.stringify(full, null, 2);
          downloadFile(content, `${filename}.json`, 'application/json');
          break;
        }
        case 'csv': {
          const content = generateTimelineCsv(full, language);
          downloadFile(content, `${filename}.csv`, 'text/csv;charset=utf-8;');
          break;
        }
        case 'md': {
          const content = generateTimelineMarkdown(full, language);
          downloadFile(content, `${filename}.md`, 'text/markdown;charset=utf-8');
          break;
        }
        case 'txt': {
          const content = generateTimelineText(full, language);
          downloadFile(content, `${filename}.txt`, 'text/plain;charset=utf-8');
          break;
        }
        case 'pdf': {
          printTimelinePdf(full, language, isRtl);
          break;
        }
        default:
          break;
      }
      setActiveMenuId(null);
      setOpenExportSubmenuId(null);
    } catch (err) {
      console.error('Export timeline failed:', err);
      alert(t('savedTimelines.exportError') || 'Failed to export timeline');
    } finally {
      setExportingState({ id: null, format: null });
    }
  };

  const handleItemClick = (item) => {
    if (renamingId === item.id) return;

    if (isMobile) {
      if (selectedMobileId === item.id) {
        onSelectTimeline(item.id);
        handleClose();
      } else {
        setSelectedMobileId(item.id);
        if (activeMenuId) {
          setActiveMenuId(null);
          setOpenExportSubmenuId(null);
        }
      }
    } else {
      onSelectTimeline(item.id);
      handleClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-xl overflow-hidden shadow-glass-lg flex flex-col max-h-[90vh] sm:max-h-[85vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
          isVisible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
        } ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Mobile Drag Indicator */}
        <div
          className="sm:hidden flex justify-center pt-3 pb-2 bg-surface-raised/80 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          {...dragHandleProps}
        >
          <div className="w-12 h-1.5 rounded-full bg-line-strong/60" />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none"
          {...dragHandleProps}
        >
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
            onClick={handleClose}
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
        <div
          className="flex-1 overflow-y-auto p-3 pb-8 sm:p-6 sm:pb-8 space-y-2 sm:space-y-2.5"
          onClick={() => {
            if (selectedMobileId) setSelectedMobileId(null);
          }}
        >
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
            sortedTimelines.map((item) => {
              const isSelectedOnMobile = isMobile && selectedMobileId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleItemClick(item);
                  }}
                  className={`group relative flex items-start sm:items-center justify-between p-3 sm:p-3.5 rounded-panel cursor-pointer transition-all gap-2.5 sm:gap-3 ${
                    isSelectedOnMobile
                      ? 'bg-accent-soft border border-line-strong ring-1 ring-ink/10'
                      : 'bg-surface-sunken hover:bg-surface-hover border border-line hover:border-line-strong shadow-control'
                  }`}
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
                            const nextId = activeMenuId === item.id ? null : item.id;
                            setActiveMenuId(nextId);
                            if (nextId !== item.id) {
                              setOpenExportSubmenuId(null);
                            }
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
                            } bg-surface-raised border border-line-strong rounded-panel shadow-floating py-1 min-w-[200px] text-xs animate-in fade-in-50 zoom-in-95`}
                          >
                            <button
                              type="button"
                              onClick={(e) => handleShareTimeline(item, e)}
                              disabled={sharingTimelineId === item.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer font-medium"
                            >
                              {sharingTimelineId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                              ) : (
                                <Share2 className="w-3.5 h-3.5 text-accent shrink-0" />
                              )}
                              <span className="truncate">{t('toolbar.shareTimeline')}</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleCopyShareLink(item, e)}
                              className="w-full flex items-center justify-between px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                            >
                              <span className="flex items-center gap-2 truncate">
                                {copiedId === item.id ? (
                                  <Check className="w-3.5 h-3.5 text-success shrink-0" />
                                ) : (
                                  <Link2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                )}
                                <span className={`truncate ${copiedId === item.id ? 'text-success font-semibold' : ''}`}>
                                  {copiedId === item.id
                                    ? (t('toolbar.shareLinkCopied') || 'הקישור הועתק!')
                                    : (t('toolbar.shareCopyLink') || 'העתקת קישור שיתוף')}
                                </span>
                              </span>
                              {copiedId === item.id && (
                                <span className="text-[10px] text-success font-mono shrink-0">✓</span>
                              )}
                            </button>

                            <div className="my-1 border-t border-line" />

                            <button
                              type="button"
                              onClick={(e) => {
                                setActiveMenuId(null);
                                handleStartRename(item, e);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
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

                            {/* Export Timeline */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenExportSubmenuId((curr) => (curr === item.id ? null : item.id));
                              }}
                              aria-expanded={openExportSubmenuId === item.id}
                              className="w-full flex items-center justify-between px-3 py-2 text-ink hover:bg-surface-hover transition-colors text-start cursor-pointer"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <Download className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                <span>{t('savedTimelines.exportTimeline') || 'ייצוא ציר זמן'}</span>
                              </span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 text-ink-subtle transition-transform duration-150 ${
                                  openExportSubmenuId === item.id ? 'rotate-180 text-accent' : ''
                                }`}
                              />
                            </button>

                            {openExportSubmenuId === item.id && (
                              <div className="mx-1 my-0.5 p-1 bg-surface-hover/60 rounded-lg border border-line flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                                {/* JSON */}
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(item, 'json', e)}
                                  disabled={exportingState.id === item.id}
                                  className="w-full px-2 py-1.5 text-xs rounded-md flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {exportingState.id === item.id && exportingState.format === 'json' ? (
                                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                                    ) : (
                                      <Code2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                    )}
                                    <span className="truncate">{t('exportModal.jsonTitle')}</span>
                                  </div>
                                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                                    .JSON
                                  </span>
                                </button>

                                {/* CSV */}
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(item, 'csv', e)}
                                  disabled={exportingState.id === item.id}
                                  className="w-full px-2 py-1.5 text-xs rounded-md flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {exportingState.id === item.id && exportingState.format === 'csv' ? (
                                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                                    ) : (
                                      <Table className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                    )}
                                    <span className="truncate">{t('exportModal.csvTitle')}</span>
                                  </div>
                                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                                    .CSV
                                  </span>
                                </button>

                                {/* Markdown */}
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(item, 'md', e)}
                                  disabled={exportingState.id === item.id}
                                  className="w-full px-2 py-1.5 text-xs rounded-md flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {exportingState.id === item.id && exportingState.format === 'md' ? (
                                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                                    ) : (
                                      <FileText className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                    )}
                                    <span className="truncate">{t('exportModal.mdTitle')}</span>
                                  </div>
                                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                                    .MD
                                  </span>
                                </button>

                                {/* Text */}
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(item, 'txt', e)}
                                  disabled={exportingState.id === item.id}
                                  className="w-full px-2 py-1.5 text-xs rounded-md flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {exportingState.id === item.id && exportingState.format === 'txt' ? (
                                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                                    ) : (
                                      <FileText className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                    )}
                                    <span className="truncate">{t('exportModal.txtTitle')}</span>
                                  </div>
                                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                                    .TXT
                                  </span>
                                </button>

                                {/* Print / PDF */}
                                <button
                                  type="button"
                                  onClick={(e) => handleExport(item, 'pdf', e)}
                                  disabled={exportingState.id === item.id}
                                  className="w-full px-2 py-1.5 text-xs rounded-md flex items-center justify-between text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer text-start"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {exportingState.id === item.id && exportingState.format === 'pdf' ? (
                                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                                    ) : (
                                      <Printer className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                                    )}
                                    <span className="truncate">{t('exportModal.printTitle')}</span>
                                  </div>
                                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface-overlay text-ink-subtle font-semibold shrink-0 ms-1">
                                    PDF
                                  </span>
                                </button>
                              </div>
                            )}



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
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
