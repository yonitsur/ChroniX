import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Calendar, Trash2, Upload, Loader2, Play } from 'lucide-react';
import { fetchTimelines, deleteTimeline } from '../api';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md">
      <div
        className={`bg-white/75 dark:bg-slate-900/75 backdrop-blur-2xl backdrop-saturate-150 border border-white/60 dark:border-white/10 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl shadow-slate-950/30 dark:shadow-black/50 ring-1 ring-black/5 dark:ring-white/5 flex flex-col max-h-[85vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 dark:border-white/10 bg-gradient-to-b from-white/60 via-white/30 to-transparent dark:from-white/[0.07] dark:to-transparent">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/15 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t('savedTimelines.title')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('savedTimelines.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar: Import JSON */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {timelines.length === 1
              ? t('savedTimelines.foundCountSingle')
              : t('savedTimelines.foundCount', { count: timelines.length })}
          </span>
          <label className="flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 shadow-2xs cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
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
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-sky-500 dark:text-sky-400" />
              <span className="text-xs">{t('savedTimelines.loading')}</span>
            </div>
          ) : timelines.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-xs">
              {t('savedTimelines.empty')}
            </div>
          ) : (
            timelines.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onSelectTimeline(item.id);
                  onClose();
                }}
                className="group flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/90 dark:bg-slate-800/70 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl cursor-pointer transition-all shadow-xs"
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors truncate">
                      {item.title}
                    </h4>
                    {item.timeScale === 'prehistoric' && (
                      <span className="text-[10px] bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded">
                        {t('savedTimelines.prehistoricBadge')}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {t('savedTimelines.eventsCount', { count: item.articleCount })}
                    </span>
                    {item.updatedAt && (
                      <span>
                        {t('savedTimelines.updatedDate', {
                          date: new Date(item.updatedAt).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US')
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title={t('savedTimelines.loadTooltip')}
                    className="p-2 text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(item.id, e)}
                    disabled={deletingId === item.id}
                    title={t('savedTimelines.deleteTooltip')}
                    className="p-2 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
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
