import React from 'react';
import {
  Layers,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  X,
  Plus,
  Maximize2,
  Rows3,
  Save,
  Check,
  Loader2,
  Info,
} from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { isTextRtl } from '../utils/textDirection';
import {
  MAX_MERGED_SOURCES,
  MAX_EXPANDED_LANES,
  LAYER_ACCENT_COLORS,
  canExpandSourceSubLanes,
} from '../utils/mergeTimelines';

export default function TimelineLayerBar({
  timeline,
  hiddenLayerIds,
  onToggleHideLayer,
  onZoomToLayer,
  onFitAll,
  onMoveLayer,
  onRemoveLayer,
  onToggleExpandSubLanes,
  onOpenAddLayer,
  onSaveMerged,
  isSavingMerged = false,
  mergedSavedDone = false,
}) {
  const { t, isRtl } = useLanguage();
  const sources = Array.isArray(timeline?.mergedSources) ? timeline.mergedSources : [];
  if (sources.length < 2) return null;

  const hiddenSet =
    hiddenLayerIds instanceof Set
      ? hiddenLayerIds
      : new Set(Array.isArray(hiddenLayerIds) ? hiddenLayerIds : []);

  const canExpand = canExpandSourceSubLanes(sources);
  const subLanesExpanded = Boolean(timeline?.subLanesExpanded);
  const canAddMore = sources.length < MAX_MERGED_SOURCES;
  const isUnsaved = Boolean(timeline?._unsavedMerged);

  // Prevent hiding EVERY single layer simultaneously so the canvas never goes completely blank
  const visibleLayersCount = sources.filter((s, idx) => !hiddenSet.has(s.laneId || `layer-${idx + 1}`)).length;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="w-full shrink-0 z-30 bg-surface-overlay/92 backdrop-blur-xl border-b border-line px-3 sm:px-4 py-2 flex items-center justify-between gap-2 select-none shadow-2xs"
    >
      {/* Left/Start: Layer Badge + Scrollable Source Chips */}
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-accent-soft text-accent border border-accent/25 text-caption font-bold shrink-0">
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">{t('layers.barTitle')}</span>
          <span className="font-mono text-caption px-1 rounded bg-surface/80">{sources.length}</span>
        </div>

        {sources.map((src, idx) => {
          const laneId = src.laneId || `layer-${idx + 1}`;
          const isHidden = hiddenSet.has(laneId);
          const color = src.color || LAYER_ACCENT_COLORS[idx % LAYER_ACCENT_COLORS.length];
          const isTitleRtl = isTextRtl(src.title || '', isRtl);

          return (
            <div
              key={`${laneId}-${src.id || idx}`}
              className={`inline-flex items-center gap-1 ps-2 pe-1 py-1 rounded-xl border text-xs transition-all shrink-0 ${
                isHidden
                  ? 'bg-surface-sunken/70 border-line text-ink-subtle opacity-60'
                  : 'bg-surface-raised border-line-strong text-ink shadow-2xs'
              }`}
            >
              {/* Color Dot + Click-to-Zoom Title */}
              <button
                type="button"
                onClick={() => {
                  if (isHidden) {
                    onToggleHideLayer?.(laneId);
                  }
                  onZoomToLayer?.(src);
                }}
                title={t('layers.zoomToLayer')}
                className="inline-flex items-center gap-2 min-w-0 max-w-[135px] sm:max-w-[190px] hover:text-accent transition-colors cursor-pointer"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                  style={{ backgroundColor: color }}
                />
                <span
                  dir={isTitleRtl ? 'rtl' : 'ltr'}
                  className="font-semibold truncate text-caption sm:text-xs"
                >
                  {src.title}
                </span>
                <span className="text-caption font-mono text-ink-subtle shrink-0">
                  ({src.articleCount ?? 0})
                </span>
              </button>

              {/* Show / Hide Layer */}
              <button
                type="button"
                disabled={!isHidden && visibleLayersCount <= 1}
                onClick={() => onToggleHideLayer?.(laneId)}
                aria-pressed={!isHidden}
                title={isHidden ? t('layers.showLayer') : t('layers.hideLayer')}
                aria-label={isHidden ? t('layers.showLayer') : t('layers.hideLayer')}
                className="p-1 rounded-md text-ink-subtle hover:text-ink hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>

              {/* Reorder Up / Down */}
              <div className="inline-flex items-center">
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => onMoveLayer?.(idx, -1)}
                    title={t('layers.moveUp')}
                    aria-label={t('layers.moveUp')}
                    className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                )}
                {idx < sources.length - 1 && (
                  <button
                    type="button"
                    onClick={() => onMoveLayer?.(idx, 1)}
                    title={t('layers.moveDown')}
                    aria-label={t('layers.moveDown')}
                    className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Remove Layer */}
              <button
                type="button"
                onClick={() => onRemoveLayer?.(idx)}
                title={t('layers.removeLayer')}
                aria-label={t('layers.removeLayer')}
                className="p-1 rounded-md text-ink-subtle hover:text-danger hover:bg-danger-soft transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Mixed Time-Scale Hint */}
        {timeline?.hasMixedTimeScales && (
          <span
            title={t('layers.mixedTimeScaleNotice')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-warning-soft text-warning border border-warning/30 text-caption font-medium shrink-0"
          >
            <Info className="w-3 h-3 shrink-0" />
            <span className="hidden xl:inline">{t('layers.mixedTimeScaleNotice')}</span>
          </span>
        )}
      </div>

      {/* Right/End: Fit All + Sub-lanes Toggle + Add Layer + Save as New Timeline */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Fit All */}
        <button
          type="button"
          onClick={onFitAll}
          title={t('layers.fitAllLayers')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-raised hover:bg-surface-hover border border-line text-ink-muted hover:text-ink text-caption font-medium transition-colors cursor-pointer"
        >
          <Maximize2 className="w-3 h-3 shrink-0" />
          <span className="hidden lg:inline">{t('layers.fitAllLayers')}</span>
        </button>

        {/* Sub-lanes Expand / Collapse */}
        {canExpand && (
          <button
            type="button"
            onClick={onToggleExpandSubLanes}
            title={
              subLanesExpanded
                ? t('layers.collapseSubLanes')
                : `${t('layers.expandSubLanes')} (${t('layers.maxSubLanesNote', { max: MAX_EXPANDED_LANES })})`
            }
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-caption font-medium transition-colors cursor-pointer ${
              subLanesExpanded
                ? 'bg-accent-soft border-accent/40 text-accent font-semibold'
                : 'bg-surface-raised hover:bg-surface-hover border-line text-ink-muted hover:text-ink'
            }`}
          >
            <Rows3 className="w-3 h-3 shrink-0" />
            <span className="hidden xl:inline">
              {subLanesExpanded ? t('layers.collapseSubLanes') : t('layers.expandSubLanes')}
            </span>
          </button>
        )}

        {/* + Add Layer */}
        <button
          type="button"
          disabled={!canAddMore}
          onClick={onOpenAddLayer}
          title={canAddMore ? t('layers.addLayerBtn') : t('library.maxLayersReached', { max: MAX_MERGED_SOURCES })}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-surface-raised hover:bg-surface-hover disabled:opacity-40 border border-line hover:border-accent/45 text-ink text-caption font-semibold transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-accent shrink-0" />
          <span>{t('layers.addLayerBtn')}</span>
        </button>

        {/* Save as New Timeline (shown while unsaved or right after saving) */}
        {(isUnsaved || mergedSavedDone) && (
          <button
            type="button"
            disabled={isSavingMerged || mergedSavedDone}
            onClick={onSaveMerged}
            className={`inline-flex items-center gap-2 px-3 sm:px-3 py-1 rounded-lg text-caption font-bold shadow-xs transition-all cursor-pointer ${
              mergedSavedDone
                ? 'bg-success-soft text-success border border-success/35'
                : 'bg-accent hover:bg-accent-hover text-accent-fg'
            }`}
          >
            {isSavingMerged ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : mergedSavedDone ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Save className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="whitespace-nowrap">
              {isSavingMerged
                ? t('layers.savingMerged')
                : mergedSavedDone
                  ? t('layers.savedMergedToast')
                  : t('layers.saveMergedBtn')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
