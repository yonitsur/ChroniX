import React from 'react';

/**
 * Standardized Typography Component for ChroniX
 * 
 * Complies with:
 * - WCAG 2.1/2.2 AA Accessibility standards (strict >= 12px / 0.75rem floor)
 * - Semantic typography scale tokens (display, h1, h2, h3, body, body-sm, caption)
 * - Screen density discipline (3-5 distinct sizes per view)
 */

const VARIANT_ELEMENT_MAP = {
  display: 'h1',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  body: 'p',
  'body-sm': 'p',
  caption: 'span',
};

const VARIANT_CLASSES = {
  display: 'text-display font-semibold tracking-tighter',
  h1: 'text-h1 font-semibold tracking-tight',
  h2: 'text-h2 font-semibold tracking-tight',
  h3: 'text-h3 font-semibold',
  body: 'text-body font-normal leading-relaxed',
  'body-sm': 'text-body-sm font-normal leading-normal',
  caption: 'text-caption font-normal leading-normal',
};

const COLOR_CLASSES = {
  default: 'text-ink',
  muted: 'text-ink-muted',
  subtle: 'text-ink-subtle',
  faint: 'text-ink-faint',
  accent: 'text-accent',
  danger: 'text-danger',
  success: 'text-success',
  warning: 'text-warning',
  inherit: '',
};

const WEIGHT_CLASSES = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  extrabold: 'font-extrabold',
};

export default function Typography({
  variant = 'body',
  as,
  color = 'default',
  weight,
  align,
  className = '',
  children,
  ...rest
}) {
  const Component = as || VARIANT_ELEMENT_MAP[variant] || 'p';
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.body;
  const colorClass = COLOR_CLASSES[color] || '';
  const weightClass = weight ? (WEIGHT_CLASSES[weight] || '') : '';
  const alignClass = align ? `text-${align}` : '';

  return (
    <Component
      className={`${variantClass} ${colorClass} ${weightClass} ${alignClass} ${className}`.trim()}
      {...rest}
    >
      {children}
    </Component>
  );
}
