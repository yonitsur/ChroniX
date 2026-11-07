import React from 'react';
import { Users, Baby, Zap, Globe, BookUser, Layers } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

const AUDIENCE = {
  classic: { Icon: Users, labelKey: 'creationMode.standard', tipKey: 'creationMode.standardTip' },
  kids: { Icon: Baby, labelKey: 'creationMode.children', tipKey: 'creationMode.childrenTip' },
};

const SEARCH = {
  fast: { Icon: Zap, labelKey: 'creationMode.fast', tipKey: 'creationMode.fastTip' },
  web_search: { Icon: Globe, labelKey: 'creationMode.webSearch', tipKey: 'creationMode.webSearchTip' },
};

/**
 * Small read-only chips showing how a timeline was created: the audience mode
 * (General / Children), generation mode (Fast / Web Search), or curated Personal Demo
 * and multi-layer badges for Public Library showcase timelines.
 * Private hand-built timelines have no AI creation mode, so nothing is rendered for them.
 */
export default function TimelineModeBadges({
  contentMode,
  searchMode,
  isManual = false,
  isPersonalDemo = false,
  mergedLayerCount = 0,
  className = '',
}) {
  const { t } = useLanguage();

  if (isPersonalDemo) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
        <span
          title={t('library.personalDemoBadgeTip')}
          className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold bg-accent-soft text-accent border border-accent/25 px-2 py-0.5 rounded-control"
        >
          <BookUser className="w-3 h-3" aria-hidden="true" />
          {t('library.personalDemoBadge')}
        </span>
        {contentMode === 'kids' && (
          <span
            title={t(AUDIENCE.kids.tipKey)}
            className="inline-flex shrink-0 items-center gap-1 text-caption font-medium bg-surface-sunken text-ink-muted border border-line px-2 py-0.5 rounded-control"
          >
            <Baby className="w-3 h-3" aria-hidden="true" />
            {t(AUDIENCE.kids.labelKey)}
          </span>
        )}
        {mergedLayerCount >= 2 && (
          <span
            title={t('library.layersCountBadgeTip', { count: mergedLayerCount })}
            className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold bg-surface-sunken text-ink border border-line-strong px-2 py-0.5 rounded-control"
          >
            <Layers className="w-3 h-3 text-accent" aria-hidden="true" />
            {t('library.layersCountBadge', { count: mergedLayerCount })}
          </span>
        )}
      </span>
    );
  }

  if (isManual) return null;

  const audience = AUDIENCE[contentMode] || AUDIENCE.classic;
  const search = SEARCH[searchMode] || null;
  const chips = [audience, search].filter(Boolean);

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {chips.map(({ Icon, labelKey, tipKey }) => (
        <span
          key={labelKey}
          title={t(tipKey)}
          className="inline-flex shrink-0 items-center gap-1 text-caption font-medium bg-surface-sunken text-ink-muted border border-line px-2 py-0.5 rounded-control"
        >
          <Icon className="w-3 h-3" aria-hidden="true" />
          {t(labelKey)}
        </span>
      ))}
      {mergedLayerCount >= 2 && (
        <span
          title={t('library.layersCountBadgeTip', { count: mergedLayerCount })}
          className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold bg-surface-sunken text-ink border border-line-strong px-2 py-0.5 rounded-control"
        >
          <Layers className="w-3 h-3 text-accent" aria-hidden="true" />
          {t('library.layersCountBadge', { count: mergedLayerCount })}
        </span>
      )}
    </span>
  );
}
