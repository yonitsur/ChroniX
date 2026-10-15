import React, { useEffect } from 'react';
import { X, Lightbulb, Type, Crosshair, SlidersHorizontal, Columns2, Languages, Castle, Globe, MessageSquare, CornerDownLeft } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import useModalAnimation from '../hooks/useModalAnimation';

const SECTIONS = [
  { key: 'simple', Icon: Type },
  { key: 'focus', Icon: Crosshair },
  { key: 'depth', Icon: SlidersHorizontal },
  { key: 'parallel', Icon: Columns2 },
  { key: 'fiction', Icon: Castle },
  { key: 'language', Icon: Languages },
];

export default function PromptGuideModal({ isOpen, onClose, onUsePrompt }) {
  const { t, isRtl } = useLanguage();
  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isRendered) return null;

  const usePrompt = (text) => {
    onUsePrompt?.(text);
    handleClose();
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
      aria-labelledby="prompt-guide-title"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-xl overflow-hidden shadow-glass-lg flex flex-col max-h-[90vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-0 ${
          isVisible ? 'translate-y-0 opacity-100 sm:scale-100' : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
        } ${isRtl ? 'text-right' : 'text-left'}`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div
          className="sm:hidden flex justify-center pt-3 pb-2 bg-surface-raised/80 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          {...dragHandleProps}
        >
          <div className="w-12 h-1.5 rounded-full bg-line-strong/60" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none shrink-0" {...dragHandleProps}>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-surface-sunken border border-line flex items-center justify-center">
              <Lightbulb className="w-5 h-5 text-ink" />
            </div>
            <div>
              <h3 id="prompt-guide-title" className="font-semibold text-base text-ink">
                {t('promptGuide.title')}
              </h3>
              <p className="text-xs text-ink-muted">{t('promptGuide.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-full hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-5 text-sm text-ink-muted leading-relaxed">
          {SECTIONS.map(({ key, Icon }) => {
            const example = t(`promptGuide.sections.${key}.example`);
            return (
              <section key={key} className="flex items-start gap-3">
                <div className="p-1.5 rounded-control bg-surface-sunken border border-line shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-ink-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-ink text-sm">{t(`promptGuide.sections.${key}.title`)}</h4>
                  <p className="text-xs text-ink-muted mt-0.5">{t(`promptGuide.sections.${key}.body`)}</p>
                  <button
                    type="button"
                    onClick={() => usePrompt(example)}
                    title={t('promptGuide.useExample')}
                    className="group mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-control bg-surface-hover/50 hover:bg-surface-hover border border-line hover:border-line-strong text-start transition-colors cursor-pointer"
                  >
                    <span dir="auto" className="flex-1 min-w-0 text-xs text-ink font-medium">
                      {example}
                    </span>
                    <span className="inline-flex items-center gap-1 text-caption text-ink-subtle group-hover:text-ink shrink-0 transition-colors">
                      <CornerDownLeft className="w-3 h-3" />
                      {t('promptGuide.useExample')}
                    </span>
                  </button>
                </div>
              </section>
            );
          })}

          <div className="rounded-control bg-surface-hover/50 border border-line p-3.5 space-y-2 text-xs">
            <p className="flex items-start gap-2">
              <Globe className="w-3.5 h-3.5 text-ink-subtle shrink-0 mt-0.5" />
              <span>{t('promptGuide.tipWebSearch')}</span>
            </p>
            <p className="flex items-start gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-ink-subtle shrink-0 mt-0.5" />
              <span>{t('promptGuide.tipRefine')}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
