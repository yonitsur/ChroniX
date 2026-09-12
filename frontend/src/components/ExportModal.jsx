import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  FileText,
  FileCode,
  Table,
  Copy,
  Check,
  Printer,
  Image as ImageIcon,
  Code2,
  Calendar,
  Layers,
  BookOpen,
  Sparkles
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import {
  generateTimelineText,
  generateTimelineMarkdown,
  generateTimelineCsv,
  downloadFile,
  copyToClipboard,
  printTimelinePdf,
  sanitizeFilename
} from '../utils/timelineExport';

export default function ExportModal({
  isOpen,
  onClose,
  timeline,
  onExportImage,
  onExportJson
}) {
  const { t, language, isRtl } = useLanguage();
  const [copiedType, setCopiedType] = useState(null); // 'text' | 'md' | null

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !timeline) return null;

  const baseFilename = sanitizeFilename(timeline.title || 'timeline');
  const articleCount = timeline.articles?.length || 0;
  const laneCount = timeline.lanes?.length || 0;
  const hasOverview = Boolean(timeline.overview && timeline.overview.trim());

  // Export handlers
  const handleExportText = () => {
    const text = generateTimelineText(timeline, language);
    downloadFile(text, `${baseFilename}.txt`, 'text/plain;charset=utf-8');
  };

  const handleExportMarkdown = () => {
    const md = generateTimelineMarkdown(timeline, language);
    downloadFile(md, `${baseFilename}.md`, 'text/markdown;charset=utf-8');
  };

  const handleExportCsv = () => {
    const csv = generateTimelineCsv(timeline, language);
    downloadFile(csv, `${baseFilename}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleCopyText = async () => {
    const text = generateTimelineText(timeline, language);
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedType('text');
      setTimeout(() => setCopiedType(null), 2200);
    }
  };

  const handlePrintPdf = () => {
    printTimelinePdf(timeline, language, isRtl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-2xl overflow-hidden shadow-panel flex flex-col max-h-[90vh] ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-line bg-surface-raised shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-control bg-accent-soft text-accent border border-accent/20 flex items-center justify-center shadow-2xs">
              <Download className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-ink">
                {t('exportModal.title')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('exportModal.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Strip */}
        <div className="px-5 sm:px-6 py-2.5 bg-surface-sunken border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted shrink-0">
          <div className="font-semibold text-ink truncate max-w-[280px] sm:max-w-md">
            {timeline.title || t('exportModal.untitledTimeline')}
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-ink-subtle" />
              <span>{articleCount} {t('exportModal.eventsCount')}</span>
            </span>
            {laneCount > 1 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-ink-subtle" />
                <span>{laneCount} {t('exportModal.lanesCount')}</span>
              </span>
            )}
            {hasOverview && (
              <span className="flex items-center gap-1 text-accent">
                <BookOpen className="w-3.5 h-3.5" />
                <span>{t('exportModal.hasOverview')}</span>
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Export Options */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-ink text-sm">
          {/* Section 1: Documents & Text */}
          <div>
            <div className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-accent" />
              <span>{t('exportModal.sectionDocs')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Plain Text (.txt) */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <FileText className="w-4 h-4 text-accent shrink-0" />
                      {t('exportModal.txtTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-ink-subtle font-semibold">
                      .TXT
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.txtDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportText}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-accent hover:text-accent-fg border border-line hover:border-accent text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98 group-hover:border-accent/40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.downloadTxt')}</span>
                </button>
              </div>

              {/* Markdown (.md) */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-indigo-500 shrink-0" />
                      {t('exportModal.mdTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-ink-subtle font-semibold">
                      .MD
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.mdDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-indigo-600 hover:text-white border border-line hover:border-indigo-600 text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98 group-hover:border-indigo-500/40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.downloadMd')}</span>
                </button>
              </div>

              {/* Copy to Clipboard */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group sm:col-span-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <Copy className="w-4 h-4 text-emerald-500 shrink-0" />
                      {t('exportModal.copyTitle')}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      {t('exportModal.quickShareBadge')}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.copyDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyText}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-control text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98 ${
                    copiedType === 'text'
                      ? 'bg-emerald-600 text-white border border-emerald-600 ring-2 ring-emerald-500/30'
                      : 'bg-surface-raised hover:bg-emerald-600 hover:text-white border border-line hover:border-emerald-600 text-ink'
                  }`}
                >
                  {copiedType === 'text' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{t('exportModal.copiedNotification')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t('exportModal.copyAction')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Spreadsheets & Printing */}
          <div>
            <div className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Table className="w-3.5 h-3.5 text-accent" />
              <span>{t('exportModal.sectionDataAndPrint')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Excel / CSV (.csv) */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <Table className="w-4 h-4 text-emerald-600 shrink-0" />
                      {t('exportModal.csvTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-ink-subtle font-semibold">
                      .CSV
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.csvDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-emerald-700 hover:text-white border border-line hover:border-emerald-700 text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.downloadCsv')}</span>
                </button>
              </div>

              {/* Print / Save as PDF */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <Printer className="w-4 h-4 text-sky-500 shrink-0" />
                      {t('exportModal.printTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 border border-sky-500/20 font-semibold">
                      PDF / PRINT
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.printDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-sky-600 hover:text-white border border-line hover:border-sky-600 text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t('exportModal.printAction')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Visual Image & Data Backup */}
          <div>
            <div className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-accent" />
              <span>{t('exportModal.sectionVisualAndBackup')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Image (PNG) */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
                      {t('exportModal.pngTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-ink-subtle font-semibold">
                      .PNG
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.pngDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onExportImage?.();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-amber-600 hover:text-white border border-line hover:border-amber-600 text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.downloadPng')}</span>
                </button>
              </div>

              {/* JSON Data */}
              <div className="p-3.5 rounded-panel border border-line bg-surface hover:border-accent/40 transition-colors flex flex-col justify-between gap-3 shadow-2xs group">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink flex items-center gap-2">
                      <Code2 className="w-4 h-4 text-purple-500 shrink-0" />
                      {t('exportModal.jsonTitle')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-ink-subtle font-semibold">
                      .JSON
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {t('exportModal.jsonDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onExportJson?.();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-control bg-surface-raised hover:bg-purple-600 hover:text-white border border-line hover:border-purple-600 text-xs font-semibold shadow-control transition-all cursor-pointer active:scale-98"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.downloadJson')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-line bg-surface-raised flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-control text-xs font-medium text-ink hover:bg-surface-hover border border-line transition-colors cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
