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
  animated = false,
  variant = "auto" // 'auto' | 'dark' | 'light' | 'white'
}) {
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
    return (
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
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
        <circle cx="10" cy="26" r="2.6" fill="url(#chronix-dot-grad)" />

        {/* Stylized 'X' in Quadrant I */}
        <path
          d="M17 10 L28 21 M28 10 L17 21"
          stroke="url(#chronix-x-grad)"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="2 2 119 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
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

      {/* Wordmark in Quadrant I - Suez One Display Serif Typography */}
      <text
        x="19"
        y="27"
        fontFamily="'Suez One', serif"
        fontSize="21"
        letterSpacing="0px"
      >
        <tspan
          fill={isForcedDark ? "#ffffff" : isForcedLight ? "#0f172a" : "currentColor"}
          className={textColorClass}
        >
          Chroni
        </tspan>
        <tspan
          fill="url(#chronix-text-x-grad)"
        >
          X
        </tspan>
      </text>
    </svg>
  );
}
