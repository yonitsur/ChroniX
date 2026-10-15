import React from 'react';
import { X } from 'lucide-react';

export default function MobileActionSheet({
  isOpen,
  isClosing = false,
  title,
  onClose,
  onTouchStart,
  onTouchEnd,
  isRtl = false,
  children,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end md:hidden">
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-250 ease-out ${
          isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full max-h-[85vh] overflow-y-auto overscroll-contain bg-surface-overlay rounded-t-sheet border-t border-line shadow-panel p-4 flex flex-col transition-transform duration-250 ease-out ${
          isClosing ? 'translate-y-full' : 'translate-y-0'
        }`}
        style={{
          paddingBottom: 'max(24px, calc(env(safe-area-inset-bottom, 16px) + 20px))',
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div
          className="w-full flex justify-center pt-1 pb-3 cursor-grab active:cursor-grabbing touch-none shrink-0 select-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>

        <div
          className="flex items-center justify-between pb-3 mb-2 border-b border-line shrink-0 select-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-w-10 min-h-10 flex items-center justify-center rounded-full text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            aria-label={title}
          >
            <X className="w-4 h-4 shrink-0" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
