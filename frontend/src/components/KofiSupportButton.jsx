import React from 'react';
import { getCommunityDonationUrl } from '../api';
import { useLanguage } from '../context/LanguageContext';

export const KOFI_WIDGET_ID = 'A2R129OICB';

/**
 * Clean `currentColor` outline cup with a warm coral-red heart inside.
 * Fills the 24x24 viewBox generously so its optical weight matches adjacent UI icons.
 */
export function CommunityCupIcon({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0`}
      aria-hidden="true"
    >
      {/* Cup handle */}
      <path
        d="M17.75 6.5H19.25C21.13 6.5 22.65 8.02 22.65 9.9C22.65 11.78 21.13 13.3 19.25 13.3H17.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cup body */}
      <path
        d="M1.75 5.35C1.75 4.33 2.58 3.5 3.6 3.5H15.9C16.92 3.5 17.75 4.33 17.75 5.35V12.5C17.75 16.92 14.17 20.5 9.75 20.5C5.33 20.5 1.75 16.92 1.75 12.5V5.35Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* Warm coral-red heart */}
      <path
        d="M9.75 15.8C9.43 15.8 5.45 13.08 5.45 10.17C5.45 8.59 6.65 7.45 8.04 7.45C8.86 7.45 9.43 7.89 9.75 8.53C10.07 7.89 10.64 7.45 11.46 7.45C12.85 7.45 14.05 8.59 14.05 10.17C14.05 13.08 10.07 15.8 9.75 15.8Z"
        fill="#ff5e5b"
      />
    </svg>
  );
}

export function KofiCupIcon({ className = 'w-[22px] h-[17px]', animated = false }) {
  return (
    <svg
      viewBox="0 0 28 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0 ${animated ? 'kofi-cup-wiggle' : ''}`}
      aria-hidden="true"
    >
      {/* Sticker halo adapts via --kofi-cup-halo (white on dark buttons, transparent on light buttons) */}
      <path
        d="M4.2 5.4C4.2 4.6 4.8 4 5.6 4H16.9C17.7 4 18.3 4.6 18.3 5.4V6.8H20.6C22.5 6.8 23.8 8.1 23.8 10C23.8 11.9 22.5 13.2 20.6 13.2H18.0C17.1 16.0 14.4 18.0 11.25 18.0C7.4 18.0 4.2 15.1 4.2 11.2V5.4Z"
        fill="var(--kofi-cup-halo, #ffffff)"
        stroke="var(--kofi-cup-halo, #ffffff)"
        strokeWidth="3.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Cup handle */}
      <path
        d="M18.1 6.8H20.6C22.5 6.8 23.8 8.1 23.8 10C23.8 11.9 22.5 13.2 20.6 13.2H17.9"
        fill="#ffffff"
        stroke="#202020"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cup body */}
      <path
        d="M4.2 5.4C4.2 4.6 4.8 4 5.6 4H16.9C17.7 4 18.3 4.6 18.3 5.4V11.2C18.3 15.1 15.1 18.0 11.25 18.0C7.4 18.0 4.2 15.1 4.2 11.2V5.4Z"
        fill="#ffffff"
        stroke="#202020"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      {/* Warm coral-red heart */}
      <path
        d="M11.25 14.35C10.95 14.35 7.35 11.95 7.35 9.45C7.35 8.05 8.42 7.05 9.68 7.05C10.42 7.05 10.96 7.43 11.25 7.98C11.54 7.43 12.08 7.05 12.82 7.05C14.08 7.05 15.15 8.05 15.15 9.45C15.15 11.95 11.55 14.35 11.25 14.35Z"
        fill="#ff5e5b"
      />
    </svg>
  );
}

/**
 * Animated Ko-fi cup button styled natively for ChroniX's active theme
 * (Classic graphite, Kids 3D toy block, Teens Bento violet, Comic, Journal).
 * Used exclusively inside `CommunitySupportModal` so users always see transparency context first.
 */
export default function KofiSupportButton({
  href = null,
  label = null,
  size = 'md',
  className = '',
}) {
  const { t, isRtl } = useLanguage();
  const resolvedHref = href || getCommunityDonationUrl();
  if (!resolvedHref) return null;

  const resolvedLabel = label || t('communityModal.donateBtn') || t('about.supportCommunityBtn');

  const sizeClasses =
    size === 'sm'
      ? 'min-h-[34px] px-3.5 py-1.5 text-xs gap-1.5'
      : 'min-h-[42px] px-5 py-2 text-sm gap-2';

  return (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      dir={isRtl ? 'rtl' : 'ltr'}
      data-kofi-id={KOFI_WIDGET_ID}
      className={`kofi-support-btn inline-flex items-center justify-center rounded-full bg-accent hover:bg-accent-hover text-accent-fg shadow-control font-semibold tracking-[-0.01em] whitespace-nowrap select-none transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] cursor-pointer no-underline ${sizeClasses} ${className}`}
    >
      <KofiCupIcon
        animated
        className={size === 'sm' ? 'w-[22px] h-[17px]' : 'w-[26px] h-[20px]'}
      />
      <span>{resolvedLabel}</span>
    </a>
  );
}
