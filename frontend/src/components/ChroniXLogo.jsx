import React from 'react';

/**
 * ChroniX Cartesian Coordinate Logo
 * 
 * Concept:
 * - Origin (0,0) is directly beneath the letter 'C'.
 * - Y-axis arrow points UP (events / lanes / dimensions).
 * - X-axis arrow points RIGHT (the timeline / chronological dimension).
 * - 'ChroniX' is situated in the upper-right quadrant (Quadrant I).
 */

const SIZE_CLASSES = {
  sm: "h-8",
  md: "h-10",
  lg: "h-14",
  xl: "h-20"
};

export default function ChroniXLogo({ 
  className = "", 
  size = "md",
  iconOnly = false,
  minimal = true,
  withDot = false,
  dot = false,
  mode = undefined, // 'dot' | 'minimal' | 'axes'
  showAxes = undefined,
  animated = false,
  variant = "auto" // 'auto' | 'dark' | 'light' | 'white'
}) {
  // Determine effective mode:
  // 'dot' = clean wordmark with accent origin dot (no arrows)
  // 'minimal' = pure wordmark only (no arrows, no dot)
  // 'axes' = full Cartesian coordinate system with arrows and origin dot
  let effectiveMode = 'dot';
  if (mode) {
    effectiveMode = mode;
  } else if (withDot || dot) {
    effectiveMode = 'dot';
  } else if (showAxes === true) {
    effectiveMode = 'axes';
  } else if (showAxes === false) {
    effectiveMode = 'minimal';
  } else if (minimal === true) {
    effectiveMode = 'minimal';
  } else if (minimal === false) {
    effectiveMode = 'dot';
  }

  const sizeClass = SIZE_CLASSES[size] || (className ? "" : "h-10");
  const computedClass = `${sizeClass} ${className}`.trim();

  // Color mappings based on variant
  const isForcedDark = variant === "dark" || variant === "white";
  const isForcedLight = variant === "light";

  const textColorClass = isForcedDark
    ? "fill-white"
    : isForcedLight
    ? "fill-slate-900"
    : "fill-slate-900 dark:fill-white transition-colors";

  const axisColorClass = isForcedDark
    ? "text-slate-400"
    : isForcedLight
    ? "text-slate-400"
    : "text-slate-400 dark:text-slate-500";

  if (iconOnly) {
    if (effectiveMode === 'minimal') {
      return (
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          dir="ltr"
          style={{ direction: 'ltr' }}
          className={`shrink-0 select-none ${computedClass}`}
          aria-label="ChroniX Icon"
        >
          <defs>
            <linearGradient id="chronix-x-grad-min" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>

          {/* Centered Plus Jakarta Sans 'X' without origin dot */}
          <text
            x="18"
            y="26"
            textAnchor="middle"
            direction="ltr"
            style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}
            fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
            fontWeight="900"
            fontSize="26"
            fill="url(#chronix-x-grad-min)"
          >
            X
          </text>
        </svg>
      );
    }

    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        dir="ltr"
        style={{ direction: 'ltr' }}
        className={`shrink-0 select-none ${computedClass}`}
        aria-label="ChroniX Icon"
      >
        <defs>
          <linearGradient id="chronix-x-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
          <linearGradient id="chronix-dot-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>

        {/* Origin dot */}
        <circle cx="9" cy="27" r="3.2" fill="#38bdf8" />

        {/* Plus Jakarta Sans 'X' in Quadrant I */}
        <text
          x="16"
          y="27"
          direction="ltr"
          style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}
          fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
          fontWeight="900"
          fontSize="24"
          fill="#38bdf8"
        >
          X
        </text>
      </svg>
    );
  }

  // Mode 3: Clean wordmark with accent origin dot (no arrows)
  if (effectiveMode === 'dot') {
    return (
      <svg
        viewBox="0 0 100 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        dir="ltr"
        style={{ direction: 'ltr' }}
        className={`shrink-0 select-none ${computedClass}`}
        aria-label="ChroniX Logo"
      >
        <defs>
          <linearGradient id="chronix-dot-x-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
        </defs>

        {/* Accent Origin Dot (grounded at the base/start of 'C', close gap) */}
        <circle
          cx="4.0"
          cy="20.2"
          r="3.4"
          fill="url(#chronix-dot-x-grad)"
          className="transition-all"
        />

        {/* Wordmark in Plus Jakarta Sans */}
        <text
          x="8.8"
          y="21.5"
          direction="ltr"
          style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}
          fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
          fontWeight="800"
          fontSize="23"
          letterSpacing="-0.5px"
        >
          <tspan
            fill={isForcedDark ? "#ffffff" : isForcedLight ? "#0f172a" : "currentColor"}
            className={textColorClass}
          >
            Chroni
          </tspan>
          <tspan
            fill="url(#chronix-dot-x-grad)"
            fontWeight="900"
          >
            X
          </tspan>
        </text>
      </svg>
    );
  }

  // Mode 2: Minimalist wordmark only (no arrows, no dot)
  if (effectiveMode === 'minimal') {
    return (
      <svg
        viewBox="0 0 96 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        dir="ltr"
        style={{ direction: 'ltr' }}
        className={`shrink-0 select-none ${computedClass}`}
        aria-label="ChroniX Logo"
      >
        <defs>
          <linearGradient id="chronix-min-text-x-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
        </defs>

        <text
          x="1"
          y="21.5"
          direction="ltr"
          style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}
          fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
          fontWeight="800"
          fontSize="23"
          letterSpacing="-0.5px"
        >
          <tspan
            fill={isForcedDark ? "#ffffff" : isForcedLight ? "#0f172a" : "currentColor"}
            className={textColorClass}
          >
            Chroni
          </tspan>
          <tspan
            fill="url(#chronix-min-text-x-grad)"
            fontWeight="900"
          >
            X
          </tspan>
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="2 2 119 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      dir="ltr"
      style={{ direction: 'ltr' }}
      className={`shrink-0 select-none ${computedClass}`}
      aria-label="ChroniX Logo"
    >
      <defs>
        <linearGradient id="chronix-axis-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="chronix-text-x-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>

      {/* Origin is at (12, 33), directly beneath the letter 'C' */}
      {/* Y Axis line */}
      <line
        x1="12"
        y1="40"
        x2="12"
        y2="7"
        stroke="currentColor"
        className={axisColorClass}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Y Arrowhead */}
      <path
        d="M8.5 9.5 L12 4 L15.5 9.5"
        stroke="currentColor"
        className={axisColorClass}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* X Axis line (proportional overhang past ChroniX) */}
      <line
        x1="5"
        y1="33"
        x2="113"
        y2="33"
        stroke="currentColor"
        className={axisColorClass}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* X Arrowhead */}
      <path
        d="M110.5 29.5 L116 33 L110.5 36.5"
        stroke="currentColor"
        className={axisColorClass}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Prominent Origin Dot (bold counter-weight to the blue 'X') */}
      <circle
        cx="12"
        cy="33"
        r="5"
        fill="url(#chronix-text-x-grad)"
        className="transition-all"
      />

      {/* Wordmark in Quadrant I - Plus Jakarta Sans Geometry Typography */}
      <text
        x="19"
        y="27"
        direction="ltr"
        style={{ direction: 'ltr', unicodeBidi: 'bidi-override' }}
        fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="21"
        letterSpacing="-0.5px"
      >
        <tspan
          fill={isForcedDark ? "#ffffff" : isForcedLight ? "#0f172a" : "currentColor"}
          className={textColorClass}
        >
          Chroni
        </tspan>
        <tspan
          fill="url(#chronix-text-x-grad)"
          fontWeight="900"
        >
          X
        </tspan>
      </text>
    </svg>
  );
}
