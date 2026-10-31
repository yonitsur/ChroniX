import React, { forwardRef, useSyncExternalStore } from 'react';
import * as Lucide from 'lucide-react';

// Re-export everything from lucide-react so any icon or helper not explicitly overridden works seamlessly
export * from 'lucide-react';

// Singleton store so all mounted icons and theme-aware hooks react synchronously to theme-toy changes
function computeToySnapshot() {
  if (typeof window !== 'undefined' && typeof window.__chronixVisualTheme === 'string') {
    return window.__chronixVisualTheme === 'toy';
  }
  return typeof document !== 'undefined' && document.documentElement.classList.contains('theme-toy');
}

let isToySnapshot = computeToySnapshot();
const listeners = new Set();

function notifyToyThemeChange() {
  const next = computeToySnapshot();
  if (next !== isToySnapshot) {
    isToySnapshot = next;
    listeners.forEach((cb) => cb());
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('chronix:visual-theme-change', notifyToyThemeChange);
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(notifyToyThemeChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

function subscribeToyTheme(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getToyThemeSnapshot() {
  return computeToySnapshot();
}

function getServerSnapshot() {
  return false;
}

export function useIsToyTheme() {
  return useSyncExternalStore(subscribeToyTheme, getToyThemeSnapshot, getServerSnapshot);
}

const OUTLINE = 'var(--toy-icon-outline, #0f172a)';
const INK = 'var(--toy-icon-ink, #0f172a)';
const STROKE = 'var(--toy-icon-stroke, #0f172a)';

/**
 * Helper to create a theme-aware icon component:
 * - In Classic mode: renders the exact original Lucide icon component.
 * - In Kids / Toy mode: renders the custom colorful 3D-toy duotone SVG illustration.
 */
function createToyIcon(LucideIcon, renderToySvg, displayName) {
  const Component = forwardRef(function ThemeAwareIcon(
    { className = 'w-4 h-4', size, style, strokeWidth, ...rest },
    ref
  ) {
    const isToy = useIsToyTheme();
    if (!isToy) {
      return (
        <LucideIcon
          ref={ref}
          className={className}
          size={size}
          style={style}
          strokeWidth={strokeWidth}
          {...rest}
        />
      );
    }

    const sizeProps = size
      ? { width: size, height: size }
      : {};

    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} chronix-toy-icon`}
        style={style}
        aria-hidden="true"
        {...sizeProps}
        {...rest}
      >
        {renderToySvg({ className })}
      </svg>
    );
  });
  Component.displayName = displayName || LucideIcon?.displayName || 'ThemeAwareIcon';
  return Component;
}

/**
 * Helper for utility/stroke icons (arrows, chevrons, check, close, spinner)
 * that keep `currentColor` for legibility inside small buttons/badges but adopt
 * chunky, bubbly rounded toy strokes in Kids mode.
 */
function createChunkyStrokeIcon(LucideIcon, toyStrokeWidth = 2.75) {
  const Component = forwardRef(function ChunkyThemeIcon(
    { strokeWidth, ...rest },
    ref
  ) {
    const isToy = useIsToyTheme();
    return (
      <LucideIcon
        ref={ref}
        strokeWidth={isToy ? toyStrokeWidth : strokeWidth}
        {...rest}
      />
    );
  });
  Component.displayName = LucideIcon?.displayName || 'ChunkyThemeIcon';
  return Component;
}

// ============================================================================
// 1. PRIMARY NAVIGATION & DOCK RAIL ICONS
// ============================================================================

export const Home = createToyIcon(
  Lucide.Home,
  () => (
    <>
      {/* House walls */}
      <path
        d="M5.2 10.8h13.6v8.2a2 2 0 0 1-2 2H7.2a2 2 0 0 1-2-2v-8.2Z"
        fill="#fde68a"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Arched toy door */}
      <path
        d="M9.8 21v-5.2a2.2 2.2 0 0 1 4.4 0V21"
        fill="#38bdf8"
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Pitched coral-red roof */}
      <path
        d="M2.6 11.4 10.8 3.7a1.8 1.8 0 0 1 2.4 0l8.2 7.7a1 1 0 0 1-.68 1.73H3.28a1 1 0 0 1-.68-1.73Z"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'Home'
);

export const BookOpen = createToyIcon(
  Lucide.BookOpen,
  () => (
    <>
      {/* Outer teal book cover base */}
      <path
        d="M2.5 6.5A2.5 2.5 0 0 1 5 4h5a2 2 0 0 1 2 2v13.5a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 1-1.5-1.5V6.5Z"
        fill="#fef3c7"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M21.5 6.5A2.5 2.5 0 0 0 19 4h-5a2 2 0 0 0-2 2v13.5a1.5 1.5 0 0 1 1.5-1.5H20a1.5 1.5 0 0 0 1.5-1.5V6.5Z"
        fill="#fde68a"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Center spine & bookmark ribbon */}
      <path d="M12 5.5v13.5" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M15.5 4v6.5l1.75-1.3 1.75 1.3V4h-3.5Z"
        fill="#fb7185"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Cute page lines on left page */}
      <path
        d="M5.5 8.5h3.5M5.5 12h3.5"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  'BookOpen'
);

export const Filter = createToyIcon(
  Lucide.Filter,
  () => (
    <>
      {/* Funnel body */}
      <path
        d="M4 6.5h16l-5.8 7v5.2l-4.4 2.1v-7.3L4 6.5Z"
        fill="#a855f7"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Top 3D funnel rim */}
      <rect
        x="2.5"
        y="3.5"
        width="19"
        height="3.6"
        rx="1.8"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
      />
    </>
  ),
  'Filter'
);

export const LayoutList = createToyIcon(
  Lucide.LayoutList,
  () => (
    <>
      {/* Top block */}
      <rect
        x="3"
        y="3.8"
        width="6.8"
        height="6.8"
        rx="2"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="2"
      />
      {/* Bottom block */}
      <rect
        x="3"
        y="13.4"
        width="6.8"
        height="6.8"
        rx="2"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
      />
      {/* Top pill bar */}
      <rect
        x="12.5"
        y="5.2"
        width="8.5"
        height="4"
        rx="2"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
      />
      {/* Bottom pill bar */}
      <rect
        x="12.5"
        y="14.8"
        width="8.5"
        height="4"
        rx="2"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
      />
    </>
  ),
  'LayoutList'
);

export const LayoutGrid = createToyIcon(
  Lucide.LayoutGrid,
  () => (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2.2" fill="#fb7185" stroke={OUTLINE} strokeWidth="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'LayoutGrid'
);

export const Star = createToyIcon(
  Lucide.Star,
  ({ className = '' }) => {
    const isFilled = className.includes('fill-current');
    return (
      <>
        <path
          d="M12 2.5l2.75 5.45 6.05.88-4.38 4.25 1.03 6.02L12 16.25 6.55 19.1l1.03-6.02L3.2 8.83l6.05-.88L12 2.5Z"
          fill={isFilled ? '#f59e0b' : '#fbbf24'}
          stroke={OUTLINE}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="10.2" cy="9.8" r="1.1" fill="#fef9c3" />
      </>
    );
  },
  'Star'
);

export const Menu = createToyIcon(
  Lucide.Menu,
  () => (
    <>
      <rect x="3" y="4.2" width="18" height="3.8" rx="1.9" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3" y="10.1" width="18" height="3.8" rx="1.9" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3" y="16" width="18" height="3.8" rx="1.9" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'Menu'
);

export const Sun = createToyIcon(
  Lucide.Sun,
  () => (
    <>
      {/* Rays: dark toy outline under a sunny core, so they stay visible on Night Mode's indigo */}
      <path
        d="M12 2.2v2.3M12 19.5v2.3M4.9 4.9l1.65 1.65M17.45 17.45l1.65 1.65M2.2 12h2.3M19.5 12h2.3M4.9 19.1l1.65-1.65M17.45 6.55l1.65-1.65"
        stroke={OUTLINE}
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M12 2.2v2.3M12 19.5v2.3M4.9 4.9l1.65 1.65M17.45 17.45l1.65 1.65M2.2 12h2.3M19.5 12h2.3M4.9 19.1l1.65-1.65M17.45 6.55l1.65-1.65"
        stroke="#fbbf24"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="5.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="10.3" cy="10.3" r="1.3" fill="#fef08a" />
    </>
  ),
  'Sun'
);

export const Moon = createToyIcon(
  Lucide.Moon,
  () => (
    <>
      <path
        d="M20.2 14.4A8.2 8.2 0 0 1 9.6 3.8a8.2 8.2 0 1 0 10.6 10.6Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="6.2" r="1.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.6" />
    </>
  ),
  'Moon'
);

export const Headphones = createToyIcon(
  Lucide.Headphones,
  () => (
    <>
      {/* Headband arch */}
      <path
        d="M4 13v-1a8 8 0 0 1 16 0v1"
        stroke={OUTLINE}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M4 13v-1a8 8 0 0 1 16 0v1"
        stroke="#38bdf8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Left earcup */}
      <rect
        x="2.5"
        y="12.5"
        width="4.5"
        height="7.5"
        rx="2.2"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
      />
      {/* Right earcup */}
      <rect
        x="17"
        y="12.5"
        width="4.5"
        height="7.5"
        rx="2.2"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
      />
    </>
  ),
  'Headphones'
);

// ============================================================================
// 2. HOME SCREEN, PROMPT BAR & TOOLBAR ICONS
// ============================================================================

export const Globe = createToyIcon(
  Lucide.Globe,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M8.5 4.2c1.2 1.8.8 3.5-.5 4.8-1.2 1.2-1.2 2.8.5 3.8 1.5.9 1.8 2.8.8 4.8L8 20.2"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.8 5c-1.3 1.5-1.2 3.4.3 4.5 1.2.9 1.6 2.5.4 4.2-.8 1.1-.8 2.4 0 3.8"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="9.2" fill="none" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'Globe'
);

export const Zap = createToyIcon(
  Lucide.Zap,
  () => (
    <path
      d="M13.2 2.4 4.5 13.2h6.3l-1 8.4 9.7-10.8h-6.3l1-8.4Z"
      fill="#fbbf24"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  'Zap'
);

export const Lightbulb = createToyIcon(
  Lucide.Lightbulb,
  () => (
    <>
      <path
        d="M9 17.5h6v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 3a6.5 6.5 0 0 0-4.2 11.45c.7.6 1.2 1.45 1.2 2.35v.7h6v-.7c0-.9.5-1.75 1.2-2.35A6.5 6.5 0 0 0 12 3Z"
        fill="#fde047"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9.8 8.2a2.8 2.8 0 0 1 2.2-1.7" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  'Lightbulb'
);

export const BookUser = createToyIcon(
  Lucide.BookUser,
  () => (
    <>
      <rect x="4" y="2.8" width="16" height="18.4" rx="2.8" fill="#a78bfa" stroke={OUTLINE} strokeWidth="2" />
      <rect x="4" y="2.8" width="4" height="18.4" rx="1.5" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <path d="M8 3.5v17" stroke={INK} strokeWidth="1.6" />
      <circle cx="14" cy="9.5" r="2.3" fill="#fde68a" stroke={INK} strokeWidth="1.6" />
      <path
        d="M10.5 16.5a3.5 3.5 0 0 1 7 0"
        fill="#38bdf8"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  'BookUser'
);

export const FolderOpen = createToyIcon(
  Lucide.FolderOpen,
  () => (
    <>
      <path
        d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.8l2.2 2.4H18.5A2.5 2.5 0 0 1 21 8.9v9.6a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-12Z"
        fill="#f59e0b"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M3.2 10.5h17.6l-1.3 8.5a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7l-1.3-8.5Z"
        fill="#fde047"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'FolderOpen'
);

export const Palette = createToyIcon(
  Lucide.Palette,
  () => (
    <>
      <path
        d="M12 2.8a9.2 9.2 0 0 0 0 18.4c1.5 0 2.6-1.1 2.6-2.5 0-.65-.25-1.25-.65-1.7-.4-.45-.6-.95-.6-1.5 0-1.2 1-2.1 2.2-2.1h1.5A4.1 4.1 0 0 0 21.2 9.3C21.2 5.5 17.1 2.8 12 2.8Z"
        fill="#fde68a"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="1.6" fill="#ef4444" stroke={INK} strokeWidth="1.3" />
      <circle cx="11.5" cy="7.2" r="1.6" fill="#38bdf8" stroke={INK} strokeWidth="1.3" />
      <circle cx="15.8" cy="8.8" r="1.6" fill="#4ade80" stroke={INK} strokeWidth="1.3" />
      <circle cx="7.8" cy="14.5" r="1.5" fill="#a855f7" stroke={INK} strokeWidth="1.3" />
    </>
  ),
  'Palette'
);

export const Languages = createToyIcon(
  Lucide.Languages,
  () => (
    <>
      <rect x="2.5" y="3" width="11.5" height="10.5" rx="2.5" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="10" y="10.5" width="11.5" height="10.5" rx="2.5" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <path d="M5.5 6.8h5.5M8.25 5.4v1.4c0 2.2-1.2 3.7-2.6 4.4" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M13.5 18l2.2-5 2.2 5M14.2 16.6h3" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Languages'
);

export const UserRound = createToyIcon(
  Lucide.UserRound,
  () => (
    <>
      <circle cx="12" cy="8" r="4.2" fill="#fde68a" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M4.8 19.8c0-3.5 3.2-6 7.2-6s7.2 2.5 7.2 6a1.2 1.2 0 0 1-1.2 1.2H6a1.2 1.2 0 0 1-1.2-1.2Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'UserRound'
);

export const User = UserRound;

export const Users = createToyIcon(
  Lucide.Users,
  () => (
    <>
      <circle cx="16.5" cy="8.5" r="3.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <path
        d="M13 19.5c0-2.6 2.1-4.5 5-4.5 1.8 0 3.3.7 4 2v2.5H13Z"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="9.2" cy="8" r="3.8" fill="#fde68a" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M2.8 19.8c0-3.2 2.9-5.5 6.4-5.5s6.4 2.3 6.4 5.5a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'Users'
);

export const LogIn = createToyIcon(
  Lucide.LogIn,
  () => (
    <>
      <rect x="11" y="3" width="9.5" height="18" rx="2.5" fill="#a78bfa" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M3 12h10m0 0-3.5-3.5M13 12l-3.5 3.5"
        stroke={STROKE}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  'LogIn'
);

export const LogOut = createToyIcon(
  Lucide.LogOut,
  () => (
    <>
      <rect x="3.5" y="3" width="9.5" height="18" rx="2.5" fill="#fb7185" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M10 12h10.5m0 0-3.5-3.5M20.5 12 17 15.5"
        stroke={STROKE}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  'LogOut'
);

export const Split = createToyIcon(
  Lucide.Split,
  () => (
    <>
      <circle cx="6" cy="6" r="2.8" fill="#fb7185" stroke={OUTLINE} strokeWidth="1.9" />
      <circle cx="18" cy="6" r="2.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.9" />
      <circle cx="12" cy="18.5" r="2.8" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.9" />
      <path
        d="M6 8.8v2.2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8.8M12 14v1.7"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </>
  ),
  'Split'
);

export const ScrollText = createToyIcon(
  Lucide.ScrollText,
  () => (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.8" fill="#fde68a" stroke={OUTLINE} strokeWidth="2" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  'ScrollText'
);

// ============================================================================
// 3. TIMELINE, MAP, DRAWER & CHAT ICONS
// ============================================================================

export const Map = createToyIcon(
  Lucide.Map,
  () => (
    <>
      <path
        d="M3 6.2 9 3.5l6 2.7 6-2.7v14.3l-6 2.7-6-2.7-6 2.7V6.2Z"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 3.5v14.3l6 2.7V6.2L9 3.5Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'Map'
);

export const MapPin = createToyIcon(
  Lucide.MapPin,
  () => (
    <>
      <path
        d="M12 21.5s7-5.8 7-11.5a7 7 0 1 0-14 0c0 5.7 7 11.5 7 11.5Z"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.8" fill="#fef3c7" stroke={INK} strokeWidth="1.6" />
    </>
  ),
  'MapPin'
);

export const MapPinOff = createToyIcon(
  Lucide.MapPinOff,
  () => (
    <>
      <path
        d="M12 21.5s7-5.8 7-11.5a7 7 0 1 0-14 0c0 5.7 7 11.5 7 11.5Z"
        fill="#94a3b8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M3.5 3.5 20.5 20.5" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  'MapPinOff'
);

export const Compass = createToyIcon(
  Lucide.Compass,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <polygon
        points="16.2,7.8 13.8,13.8 7.8,16.2 10.2,10.2"
        fill="#fb7185"
        stroke={INK}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </>
  ),
  'Compass'
);

export const Navigation = createToyIcon(
  Lucide.Navigation,
  () => (
    <polygon
      points="3,11 21,3 13,21 11,13"
      fill="#38bdf8"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  'Navigation'
);

export const Calendar = createToyIcon(
  Lucide.Calendar,
  () => (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.8" fill="#fef3c7" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M3 7.3A2.8 2.8 0 0 1 5.8 4.5h12.4A2.8 2.8 0 0 1 21 7.3v2.7H3V7.3Z"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
      />
      <path d="M8 2.5v3.5M16 2.5v3.5" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="8.5" cy="14" r="1.4" fill="#38bdf8" />
      <circle cx="12" cy="14" r="1.4" fill="#4ade80" />
      <circle cx="15.5" cy="14" r="1.4" fill="#fbbf24" />
    </>
  ),
  'Calendar'
);

export const Clock = createToyIcon(
  Lucide.Clock,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="12" cy="12" r="6.8" fill="#fef9c3" stroke={INK} strokeWidth="1.5" />
      <path d="M12 8v4.2l2.8 1.8" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Clock'
);

export const Hourglass = createToyIcon(
  Lucide.Hourglass,
  () => (
    <>
      <path
        d="M6.5 3.5h11v3.2c0 2.5-2.2 4.3-4.2 5.3 2 1 4.2 2.8 4.2 5.3v3.2h-11v-3.2c0-2.5 2.2-4.3 4.2-5.3-2-1-4.2-2.8-4.2-5.3V3.5Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="4.5" y="2.5" width="15" height="2.6" rx="1.3" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="4.5" y="18.9" width="15" height="2.6" rx="1.3" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'Hourglass'
);

export const Layers = createToyIcon(
  Lucide.Layers,
  () => (
    <>
      <path d="M12 13.2 2.8 17.5 12 21.8l9.2-4.3L12 13.2Z" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 7.8 2.8 12.1 12 16.4l9.2-4.3L12 7.8Z" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 2.4 2.8 6.7 12 11l9.2-4.3L12 2.4Z" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  'Layers'
);

export const Tag = createToyIcon(
  Lucide.Tag,
  () => (
    <>
      <path
        d="M3.5 11.2V4.8A1.3 1.3 0 0 1 4.8 3.5h6.4a2 2 0 0 1 1.4.6l7.3 7.3a2 2 0 0 1 0 2.8l-5.7 5.7a2 2 0 0 1-2.8 0l-7.3-7.3a2 2 0 0 1-.6-1.4Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.7" fill="#ffffff" stroke={INK} strokeWidth="1.6" />
    </>
  ),
  'Tag'
);

export const Columns2 = createToyIcon(
  Lucide.Columns2,
  () => (
    <>
      <rect x="3" y="3.5" width="8" height="17" rx="2.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="13" y="3.5" width="8" height="17" rx="2.2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'Columns2'
);

export const Search = createToyIcon(
  Lucide.Search,
  () => (
    <>
      <path d="m15.5 15.5 5.2 5.2" stroke={STROKE} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="10.8" cy="10.8" r="7.2" fill="#bae6fd" stroke={OUTLINE} strokeWidth="2" />
      <path d="M8.2 8.2a3.8 3.8 0 0 1 3.8-1.2" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  'Search'
);

export const SearchX = createToyIcon(
  Lucide.SearchX,
  () => (
    <>
      <path d="m15.5 15.5 5.2 5.2" stroke={STROKE} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="10.8" cy="10.8" r="7.2" fill="#fecdd3" stroke={OUTLINE} strokeWidth="2" />
      <path d="m8.5 8.5 4.6 4.6m0-4.6-4.6 4.6" stroke={INK} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  'SearchX'
);

export const MessageSquare = createToyIcon(
  Lucide.MessageSquare,
  () => (
    <>
      <path
        d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.5L4 21.5V18a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="11" r="1.3" fill="#ffffff" />
      <circle cx="12" cy="11" r="1.3" fill="#ffffff" />
      <circle cx="15.5" cy="11" r="1.3" fill="#ffffff" />
    </>
  ),
  'MessageSquare'
);

export const MessageCircleQuestion = createToyIcon(
  Lucide.MessageCircleQuestion,
  () => (
    <>
      <path
        d="M12 3a8.8 8.8 0 0 0-7.6 13.2L3.2 20.8l4.6-1.2A8.8 8.8 0 1 0 12 3Z"
        fill="#a78bfa"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.8 9.2a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="1.2" fill="#ffffff" />
    </>
  ),
  'MessageCircleQuestion'
);

export const Sparkles = createToyIcon(
  Lucide.Sparkles,
  () => (
    <>
      <path
        d="M10.5 2.5 12.6 8l5.5 2.1-5.5 2.1-2.1 5.5-2.1-5.5-5.5-2.1L8.4 8l2.1-5.5Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 13.5 19.6 16.4l2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1 1.1-2.9Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </>
  ),
  'Sparkles'
);

export const Wand2 = createToyIcon(
  Lucide.Wand2,
  () => (
    <>
      <path
        d="M3.5 20.5 14.5 9.5"
        stroke={STROKE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16.5 2.5 18 6l3.5 1.5L18 9l-1.5 3.5L15 9l-3.5-1.5L15 6l1.5-3.5Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </>
  ),
  'Wand2'
);

export const Send = createToyIcon(
  Lucide.Send,
  () => (
    <path
      d="M21.2 2.8 10.8 13.2M21.2 2.8l-6.4 18.4-4-8-8-4 18.4-6.4Z"
      fill="#38bdf8"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  'Send'
);

export const Pencil = createToyIcon(
  Lucide.Pencil,
  () => (
    <>
      <path
        d="M16.2 3.4a2.4 2.4 0 0 1 3.4 3.4L7.8 18.6 3 20l1.4-4.8L16.2 3.4Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m14 5.6 3.4 3.4" stroke={INK} strokeWidth="1.8" />
    </>
  ),
  'Pencil'
);

export const Edit = Pencil;
export const Edit3 = Pencil;
export const PenLine = Pencil;

export const Trash2 = createToyIcon(
  Lucide.Trash2,
  () => (
    <>
      <path
        d="M5.5 6.8h13l-1 13a2 2 0 0 1-2 1.8h-7a2 2 0 0 1-2-1.8l-1-13Z"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="3.5" y="4" width="17" height="3" rx="1.5" fill="#fde047" stroke={OUTLINE} strokeWidth="1.9" />
      <path d="M9.5 10.5v6.5M14.5 10.5v6.5" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  'Trash2'
);

// ============================================================================
// 4. SHARE, EXPORT, MEDIA & SYSTEM ICONS
// ============================================================================

export const Share2 = createToyIcon(
  Lucide.Share2,
  () => (
    <>
      <path d="M8.5 10.8 15.5 6.8M8.5 13.2l7 4" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="6" cy="12" r="3.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="18" cy="5.5" r="3.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="18" cy="18.5" r="3.2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'Share2'
);

export const Download = createToyIcon(
  Lucide.Download,
  () => (
    <>
      <rect x="3.5" y="15.5" width="17" height="5" rx="2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <path d="M12 3v9.5m0 0-3.8-3.8M12 12.5l3.8-3.8" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Download'
);

export const Upload = createToyIcon(
  Lucide.Upload,
  () => (
    <>
      <rect x="3.5" y="15.5" width="17" height="5" rx="2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
      <path d="M12 12.5V3m0 0L8.2 6.8M12 3l3.8 3.8" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Upload'
);

export const Copy = createToyIcon(
  Lucide.Copy,
  () => (
    <>
      <rect x="3" y="3" width="12.5" height="12.5" rx="2.4" fill="#fde68a" stroke={OUTLINE} strokeWidth="2" />
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="2.4" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'Copy'
);

export const Image = createToyIcon(
  Lucide.Image,
  () => (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.8" fill="#bae6fd" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="8.5" cy="8.8" r="2.1" fill="#fbbf24" stroke={INK} strokeWidth="1.6" />
      <path
        d="M3.5 18.5 9.8 12l4.2 4.2 2.8-2.8 3.7 5.1H3.5Z"
        fill="#4ade80"
        stroke={INK}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </>
  ),
  'Image'
);

export const Images = Image;

export const Film = createToyIcon(
  Lucide.Film,
  () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.6" fill="#a78bfa" stroke={OUTLINE} strokeWidth="2" />
      <polygon points="10,8.5 16,12 10,15.5" fill="#fbbf24" stroke={INK} strokeWidth="1.7" strokeLinejoin="round" />
    </>
  ),
  'Film'
);

export const Play = createToyIcon(
  Lucide.Play,
  () => (
    <polygon
      points="6,4 20,12 6,20"
      fill="#4ade80"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  'Play'
);

export const Pause = createToyIcon(
  Lucide.Pause,
  () => (
    <>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'Pause'
);

export const Printer = createToyIcon(
  Lucide.Printer,
  () => (
    <>
      <rect x="6.5" y="2.8" width="11" height="5.2" rx="1.4" fill="#fde68a" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3" y="8" width="18" height="9" rx="2.4" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="6.5" y="14" width="11" height="7" rx="1.4" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'Printer'
);

export const FileText = createToyIcon(
  Lucide.FileText,
  () => (
    <>
      <rect x="4.5" y="2.8" width="15" height="18.4" rx="2.6" fill="#fef3c7" stroke={OUTLINE} strokeWidth="2" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke={INK} strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
  'FileText'
);

export const FileCode = createToyIcon(
  Lucide.FileCode,
  () => (
    <>
      <rect x="4.5" y="2.8" width="15" height="18.4" rx="2.6" fill="#bae6fd" stroke={OUTLINE} strokeWidth="2" />
      <path d="m10 10-2.2 2.2L10 14.4m4-4.4 2.2 2.2L14 14.4" stroke={INK} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'FileCode'
);

export const Table = createToyIcon(
  Lucide.Table,
  () => (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.6" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
      <path d="M3 9.5h18M3 15h18M10 3.5v17" stroke={INK} strokeWidth="1.8" />
    </>
  ),
  'Table'
);

export const Code2 = createToyIcon(
  Lucide.Code2,
  () => (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill="#a78bfa" stroke={OUTLINE} strokeWidth="2" />
      <path d="m8.5 9.5-2.8 2.5 2.8 2.5m7-5 2.8 2.5-2.8 2.5m-2.5-6.5-2 8" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Code2'
);

export const ShieldCheck = createToyIcon(
  Lucide.ShieldCheck,
  () => (
    <>
      <path
        d="M12 2.5 4.5 5.8v5.7c0 5.2 3.2 8.8 7.5 10.2 4.3-1.4 7.5-5 7.5-10.2V5.8L12 2.5Z"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m8.8 12.2 2.2 2.2 4.4-4.4" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'ShieldCheck'
);

export const Shield = ShieldCheck;

export const Key = createToyIcon(
  Lucide.Key,
  () => (
    <>
      <circle cx="8" cy="15" r="4.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <path d="M11.5 11.5 20.5 2.5m-2.5 2.5 2.5 2.5M15 8l2 2" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Key'
);

export const Info = createToyIcon(
  Lucide.Info,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <path d="M12 11.2v5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.3" fill="#ffffff" />
    </>
  ),
  'Info'
);

export const HelpCircle = createToyIcon(
  Lucide.HelpCircle || Lucide.CircleHelp,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <path
        d="M9.8 9.2a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="1.2" fill="#ffffff" />
    </>
  ),
  'HelpCircle'
);

export const CircleHelp = HelpCircle;


export const AlertTriangle = createToyIcon(
  Lucide.AlertTriangle,
  () => (
    <>
      <path
        d="M10.3 3.9a2 2 0 0 1 3.4 0l7.5 13a2 2 0 0 1-1.7 3H4.5a2 2 0 0 1-1.7-3l7.5-13Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 9v4.2" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.2" fill={INK} />
    </>
  ),
  'AlertTriangle'
);

export const AlertCircle = AlertTriangle;

export const CheckCircle = createToyIcon(
  Lucide.CheckCircle,
  () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
      <path d="m8.2 12.2 2.5 2.5 5.2-5.2" stroke={INK} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'CheckCircle'
);

export const CheckCircle2 = CheckCircle;

export const Heart = createToyIcon(
  Lucide.Heart,
  () => (
    <path
      d="M12 20.4s-8.5-5.2-8.5-11.2a4.8 4.8 0 0 1 8.5-3 4.8 4.8 0 0 1 8.5 3c0 6-8.5 11.2-8.5 11.2Z"
      fill="#fb7185"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  'Heart'
);

export const Mail = createToyIcon(
  Lucide.Mail,
  () => (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.6" fill="#fde68a" stroke={OUTLINE} strokeWidth="2" />
      <path d="m3 6 9 6.5L21 6" stroke={INK} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  'Mail'
);

export const Lock = createToyIcon(
  Lucide.Lock,
  () => (
    <>
      <path d="M7.5 10.5V7.2a4.5 4.5 0 0 1 9 0v3.3" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="12" cy="15.8" r="1.6" fill={INK} />
    </>
  ),
  'Lock'
);

export const Pin = createToyIcon(
  Lucide.Pin,
  () => (
    <>
      <path d="M12 15v6.5" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M6.5 15h11l-1.8-4.5V5h1.3V3h-10v2h1.3v5.5L6.5 15Z"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  'Pin'
);

export const Castle = createToyIcon(
  Lucide.Castle,
  () => (
    <>
      <path
        d="M4 9h16v11H4V9Zm0-5h3v5H4V4Zm13 0h3v5h-3V4Zm-6.5 2h3v3h-3V6Z"
        fill="#a78bfa"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M10 20v-4a2 2 0 0 1 4 0v4" fill="#fbbf24" stroke={INK} strokeWidth="1.8" />
    </>
  ),
  'Castle'
);

export const Crosshair = createToyIcon(
  Lucide.Crosshair,
  () => (
    <>
      <circle cx="12" cy="12" r="8.2" fill="#fecdd3" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" fill="#fb7185" stroke={INK} strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.4" fill="#ffffff" />
    </>
  ),
  'Crosshair'
);

export const SlidersHorizontal = createToyIcon(
  Lucide.SlidersHorizontal,
  () => (
    <>
      <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="9" cy="6.5" r="2.5" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.9" />
      <circle cx="15" cy="12" r="2.5" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <circle cx="10" cy="17.5" r="2.5" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'SlidersHorizontal'
);

export const Type = createToyIcon(
  Lucide.Type,
  () => (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#fde047" stroke={OUTLINE} strokeWidth="2" />
      <path d="M7.5 8h9M12 8v8.5m-2.5 0h5" stroke={INK} strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  'Type'
);

export const Eye = createToyIcon(
  Lucide.Eye,
  () => (
    <>
      <path
        d="M2.2 12S6 5.5 12 5.5 21.8 12 21.8 12 18 18.5 12 18.5 2.2 12 2.2 12Z"
        fill="#bae6fd"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="#fbbf24" stroke={INK} strokeWidth="1.8" />
    </>
  ),
  'Eye'
);

export const EyeOff = createToyIcon(
  Lucide.EyeOff,
  () => (
    <>
      <path
        d="M2.2 12S6 5.5 12 5.5 21.8 12 21.8 12 18 18.5 12 18.5 2.2 12 2.2 12Z"
        fill="#cbd5e1"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M3.5 3.5 20.5 20.5" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  'EyeOff'
);

export const Save = createToyIcon(
  Lucide.Save,
  () => (
    <>
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h10.8L20 7.7v10.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="7.5" y="13" width="9" height="7" rx="1" fill="#fef3c7" stroke={INK} strokeWidth="1.7" />
      <rect x="7.5" y="4" width="7" height="4.5" rx="1" fill="#ffffff" stroke={INK} strokeWidth="1.7" />
    </>
  ),
  'Save'
);

export const RectangleVertical = createToyIcon(
  Lucide.RectangleVertical,
  () => (
    <rect x="5.5" y="2.5" width="13" height="19" rx="2.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
  ),
  'RectangleVertical'
);

export const RectangleHorizontal = createToyIcon(
  Lucide.RectangleHorizontal,
  () => (
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
  ),
  'RectangleHorizontal'
);

export const Rows3 = createToyIcon(
  Lucide.Rows3,
  () => (
    <>
      <rect x="3" y="3.5" width="18" height="4.5" rx="1.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3" y="9.75" width="18" height="4.5" rx="1.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3" y="16" width="18" height="4.5" rx="1.8" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'Rows3'
);

export const GalleryVertical = createToyIcon(
  Lucide.GalleryVertical,
  () => (
    <>
      <rect x="4" y="2.5" width="16" height="3.2" rx="1.4" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.8" />
      <rect x="4" y="7.5" width="16" height="9" rx="2.2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="4" y="18.3" width="16" height="3.2" rx="1.4" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.8" />
    </>
  ),
  'GalleryVertical'
);

export const List = createToyIcon(
  Lucide.List,
  () => (
    <>
      <circle cx="5" cy="6" r="1.8" fill="#fb7185" stroke={OUTLINE} strokeWidth="1.6" />
      <circle cx="5" cy="12" r="1.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.6" />
      <circle cx="5" cy="18" r="1.8" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.6" />
      <path d="M9.5 6h11M9.5 12h11M9.5 18h11" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  'List'
);

export const LayoutTemplate = createToyIcon(
  Lucide.LayoutTemplate,
  () => (
    <>
      <rect x="3" y="3" width="18" height="6" rx="2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <rect x="3" y="11.5" width="8" height="9.5" rx="2" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" fill="#4ade80" stroke={OUTLINE} strokeWidth="2" />
    </>
  ),
  'LayoutTemplate'
);

export const Network = createToyIcon(
  Lucide.Network,
  () => (
    <>
      <path d="M12 8.5v3.5M6.5 15.5v-3.5h11v3.5" stroke={STROKE} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9" y="2.5" width="6" height="6" rx="1.8" fill="#fbbf24" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="3.5" y="15.5" width="6" height="6" rx="1.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="1.9" />
      <rect x="14.5" y="15.5" width="6" height="6" rx="1.8" fill="#4ade80" stroke={OUTLINE} strokeWidth="1.9" />
    </>
  ),
  'Network'
);

export const Leaf = createToyIcon(
  Lucide.Leaf,
  () => (
    <>
      <path
        d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"
        fill="#4ade80"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  'Leaf'
);

export const Cpu = createToyIcon(
  Lucide.Cpu,
  () => (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2.6" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="#fbbf24" stroke={INK} strokeWidth="1.7" />
    </>
  ),
  'Cpu'
);

export const Camera = createToyIcon(
  Lucide.Camera,
  () => (
    <>
      <path
        d="M14.5 4h-5L7.5 6.5H4A2 2 0 0 0 2 8.5v9.5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3.5L14.5 4Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.6" fill="#38bdf8" stroke={INK} strokeWidth="1.8" />
    </>
  ),
  'Camera'
);

export const Mic = createToyIcon(
  Lucide.Mic,
  () => (
    <>
      {/* Outer dark outline for cradle, stem, and base */}
      <path d="M5.2 10.5a6.8 6.8 0 0 0 13.6 0" stroke={OUTLINE} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M12 17.3v3.5M8 20.8h8" stroke={OUTLINE} strokeWidth="4.2" strokeLinecap="round" />
      {/* Bright sky-blue inner fill for cradle, stem, and base */}
      <path d="M5.2 10.5a6.8 6.8 0 0 0 13.6 0" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 17.3v3.5M8 20.8h8" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
      {/* Coral-pink microphone capsule with grille lines */}
      <rect x="8.2" y="2" width="7.6" height="11.2" rx="3.8" fill="#fb7185" stroke={OUTLINE} strokeWidth="2" />
      <path d="M10.4 5.8h3.2M10.4 8.6h3.2" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  'Mic'
);

export const MicOff = createToyIcon(
  Lucide.MicOff,
  () => (
    <>
      <path d="M5.2 10.5a6.8 6.8 0 0 0 13.6 0" stroke={OUTLINE} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M12 17.3v3.5M8 20.8h8" stroke={OUTLINE} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M5.2 10.5a6.8 6.8 0 0 0 13.6 0" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 17.3v3.5M8 20.8h8" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="8.2" y="2" width="7.6" height="11.2" rx="3.8" fill="#cbd5e1" stroke={OUTLINE} strokeWidth="2" />
      <path d="M3 3l18 18" stroke={OUTLINE} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M3 3l18 18" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  'MicOff'
);

export const Smartphone = createToyIcon(
  Lucide.Smartphone,
  () => (
    <>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.8" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="12" cy="18" r="1.2" fill="#ffffff" />
    </>
  ),
  'Smartphone'
);

export const Trophy = createToyIcon(
  Lucide.Trophy,
  () => (
    <>
      {/* Side handles */}
      <path
        d="M6.2 5.2H4a1.8 1.8 0 0 0-1.8 1.8v1.2a3.8 3.8 0 0 0 3.8 3.8h.8M17.8 5.2H20a1.8 1.8 0 0 1 1.8 1.8v1.2a3.8 3.8 0 0 1-3.8 3.8h-.8"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <path d="M12 14.5v3.5" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      {/* Pedestal base */}
      <rect x="7" y="17.8" width="10" height="3.4" rx="1.6" fill="#38bdf8" stroke={OUTLINE} strokeWidth="2" />
      {/* Golden Trophy Cup */}
      <path
        d="M6 3.2h12v5.6a6 6 0 0 1-12 0V3.2Z"
        fill="#fbbf24"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Center Coral Star / Badge */}
      <circle cx="12" cy="8.2" r="2.1" fill="#fb7185" stroke={INK} strokeWidth="1.5" />
    </>
  ),
  'Trophy'
);

export const Gamepad2 = createToyIcon(
  Lucide.Gamepad2,
  () => (
    <>
      <path
        d="M6.2 6h11.6a4.2 4.2 0 0 1 4.1 5.1l-1.1 5.4a2.8 2.8 0 0 1-4.7 1.4l-2.2-2.2H10.1l-2.2 2.2a2.8 2.8 0 0 1-4.7-1.4L2.1 11.1A4.2 4.2 0 0 1 6.2 6Z"
        fill="#a78bfa"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M7.5 9.2v3.6M5.7 11h3.6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="15.5" cy="10" r="1.3" fill="#fbbf24" />
      <circle cx="17.8" cy="12" r="1.3" fill="#4ade80" />
    </>
  ),
  'Gamepad2'
);

export const Puzzle = createToyIcon(
  Lucide.Puzzle,
  () => (
    <>
      <path
        d="M19.4 12a2.1 2.1 0 0 1 0 4.2h-1.6v2.1a1.7 1.7 0 0 1-1.7 1.7h-2.5v-1.4a2.1 2.1 0 1 0-4.2 0V20H6.7A1.7 1.7 0 0 1 5 18.3v-2.5h1.4a2.1 2.1 0 1 0 0-4.2H5V9.1a1.7 1.7 0 0 1 1.7-1.7h2.7V5.8a2.1 2.1 0 1 1 4.2 0v1.6h2.5a1.7 1.7 0 0 1 1.7 1.7V12h1.6Z"
        fill="#38bdf8"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="11.5" cy="5.8" r="1.1" fill="#fbbf24" />
    </>
  ),
  'Puzzle'
);

export const Award = createToyIcon(
  Lucide.Award,
  () => (
    <>
      <path
        d="m8.5 13.5-2 7.5 5.5-2.8 5.5 2.8-2-7.5"
        fill="#fb7185"
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9" r="6.2" fill="#fbbf24" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="12" cy="9" r="3.2" fill="#fef08a" stroke={INK} strokeWidth="1.6" />
    </>
  ),
  'Award'
);

// ============================================================================
// 5. CHUNKY UTILITY / CONTROL STROKE ICONS
// ============================================================================

export const Check = createChunkyStrokeIcon(Lucide.Check, 3);
export const X = createChunkyStrokeIcon(Lucide.X, 2.8);
export const Plus = createChunkyStrokeIcon(Lucide.Plus, 2.8);
export const Minus = createChunkyStrokeIcon(Lucide.Minus, 2.8);
export const ArrowUp = createChunkyStrokeIcon(Lucide.ArrowUp, 3);
export const ArrowLeft = createChunkyStrokeIcon(Lucide.ArrowLeft, 2.8);
export const ArrowRight = createChunkyStrokeIcon(Lucide.ArrowRight, 2.8);
export const ArrowUpRight = createChunkyStrokeIcon(Lucide.ArrowUpRight, 2.8);
export const ArrowUpDown = createChunkyStrokeIcon(Lucide.ArrowUpDown, 2.6);
export const ChevronDown = createChunkyStrokeIcon(Lucide.ChevronDown, 2.8);
export const ChevronLeft = createChunkyStrokeIcon(Lucide.ChevronLeft, 2.8);
export const ChevronRight = createChunkyStrokeIcon(Lucide.ChevronRight, 2.8);
export const ChevronsUpDown = createChunkyStrokeIcon(Lucide.ChevronsUpDown, 2.6);
export const ChevronsDownUp = createChunkyStrokeIcon(Lucide.ChevronsDownUp, 2.6);
export const Maximize2 = createChunkyStrokeIcon(Lucide.Maximize2, 2.6);
export const Minimize2 = createChunkyStrokeIcon(Lucide.Minimize2, 2.6);
export const ExternalLink = createChunkyStrokeIcon(Lucide.ExternalLink, 2.5);
export const Loader2 = createChunkyStrokeIcon(Lucide.Loader2, 2.8);
export const Undo2 = createChunkyStrokeIcon(Lucide.Undo2, 2.6);
export const RotateCcw = createChunkyStrokeIcon(Lucide.RotateCcw, 2.6);
export const RefreshCw = createChunkyStrokeIcon(Lucide.RefreshCw, 2.6);
export const Scan = createChunkyStrokeIcon(Lucide.Scan, 2.6);
export const Paperclip = createChunkyStrokeIcon(Lucide.Paperclip, 2.6);
export const Quote = createChunkyStrokeIcon(Lucide.Quote, 2.6);
export const Link2 = createChunkyStrokeIcon(Lucide.Link2, 2.6);
export const CornerDownLeft = createChunkyStrokeIcon(Lucide.CornerDownLeft, 2.6);
export const MoreVertical = createChunkyStrokeIcon(Lucide.MoreVertical, 2.8);
export const Move = createChunkyStrokeIcon(Lucide.Move, 2.6);
export const GripHorizontal = createChunkyStrokeIcon(Lucide.GripHorizontal, 2.8);
export const GripVertical = createChunkyStrokeIcon(Lucide.GripVertical, 2.8);
export const Square = createChunkyStrokeIcon(Lucide.Square, 2.8);

