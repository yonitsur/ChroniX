import React, { useMemo } from 'react';
import { Check, AlertCircle } from '../icons/ThemeIcons';
import { parseFuzzyDate, formatFuzzyDate } from '../../utils/fuzzyDate';

// Story Studio form control: white on the paper surface, a >=3:1 boundary, 16px text and a 44px
// minimum height (touch target). Focus uses the accent with a soft ring.
export const STUDIO_INPUT_CLASS =
  'w-full min-h-11 bg-surface-raised text-ink placeholder-ink-subtle text-base px-3 py-2 rounded-control border border-line-input outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 transition-[border-color,box-shadow] duration-150';

/**
 * Free-text date field that shows how it understood the input when that differs from what was
 * typed ("around 1950" → "✓ c. 1950"), so people can type dates the way they remember them
 * instead of fighting a date picker. Unreadable input is flagged inline.
 */
export default function FuzzyDateInput({ value, onChange, placeholder, lang, unreadableText, className = '', ariaLabel }) {
  const parsed = useMemo(() => parseFuzzyDate(value, { lang }), [value, lang]);
  const hasText = Boolean((value || '').trim());
  const understood = parsed ? formatFuzzyDate(parsed, lang) : '';
  // Echo the interpretation only when it adds something ("1931" needs no "✓ 1931").
  const showUnderstood = hasText && parsed && understood.toLowerCase() !== (value || '').trim().toLowerCase();

  return (
    <div className={`min-w-0 ${className}`}>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        aria-invalid={hasText && !parsed ? 'true' : undefined}
        maxLength={40}
        dir="auto"
        className={`${STUDIO_INPUT_CLASS} ${hasText && !parsed ? 'border-warning' : ''}`}
      />
      <div className="min-h-5 mt-1 text-caption leading-5 truncate" aria-live="polite">
        {showUnderstood && (
          <span className="inline-flex items-center gap-1 text-success">
            <Check className="w-3 h-3 shrink-0" />
            {understood}
          </span>
        )}
        {hasText && !parsed && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {unreadableText}
          </span>
        )}
      </div>
    </div>
  );
}
