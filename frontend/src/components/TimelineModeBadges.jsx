import React from 'react';
import { Users, Baby, GraduationCap, Zap, Globe } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

const AUDIENCE = {
  classic: { Icon: Users, labelKey: 'creationMode.standard', tipKey: 'creationMode.standardTip' },
  kids: { Icon: Baby, labelKey: 'creationMode.children', tipKey: 'creationMode.childrenTip' },
  teens: { Icon: GraduationCap, labelKey: 'creationMode.youth', tipKey: 'creationMode.youthTip' },
};

const SEARCH = {
  fast: { Icon: Zap, labelKey: 'creationMode.fast', tipKey: 'creationMode.fastTip' },
  web_search: { Icon: Globe, labelKey: 'creationMode.webSearch', tipKey: 'creationMode.webSearchTip' },
};

/**
 * Small read-only chips showing how a timeline was created: the audience mode
 * (Standard / Children / Youth) and the generation mode (Fast / Web Search).
 * Hand-built timelines have no AI creation mode, so nothing is rendered for them.
 */
export default function TimelineModeBadges({ contentMode, searchMode, isManual = false, className = '' }) {
  const { t } = useLanguage();
  if (isManual) return null;

  const audience = AUDIENCE[contentMode] || AUDIENCE.classic;
  const search = SEARCH[searchMode] || null;
  const chips = [audience, search].filter(Boolean);

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {chips.map(({ Icon, labelKey, tipKey }) => (
        <span
          key={labelKey}
          title={t(tipKey)}
          className="inline-flex shrink-0 items-center gap-1 text-caption font-medium bg-surface-sunken text-ink-muted border border-line px-1.5 py-0.5 rounded-control"
        >
          <Icon className="w-3 h-3" aria-hidden="true" />
          {t(labelKey)}
        </span>
      ))}
    </span>
  );
}
