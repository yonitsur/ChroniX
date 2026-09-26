import React from 'react';

/**
 * ChroniX wordmark.
 *
 * The "X" is drawn (not typeset) as a symmetric hourglass with straight
 * diagonals and two mirrored sand shapes.
 * Monochrome by design so it sits naturally in both themes.
 */

const SIZE_CLASSES = {
  xs: "h-6",
  sm: "h-8",
  md: "h-10",
  lg: "h-14",
  xl: "h-20"
};

const WORDMARK_FONT = "'Outfit', 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";
// Natural advance of "Chroni" at 700/23px/-0.5px tracking; pinned so the drawn X aligns before/after font load.
const WORDMARK_WIDTH_23 = 71.5;

function XMark({ x0, top, width, height, inkProps, shadowProps, maskId, filterId, isThinking = false, isSpinning = false }) {
  return (
    <g transform={`translate(${x0} ${top}) scale(${width / 100} ${height / 100})`}>
      <defs>
        <mask id={maskId}>
          <rect x="-10" y="-10" width="120" height="120" fill="#ffffff" />
          {/* Slit gap: negative space cutout of front chevron */}
          <path
            d="M0 0 H25 L62.5 50 L25 100 H0 L37.5 50 Z"
            fill="#000000"
            stroke="#000000"
            strokeWidth="5"
            strokeLinejoin="round"
          />
        </mask>
        <filter id={filterId} x="-25%" y="-25%" width="170%" height="170%">
          <feDropShadow dx="2.4" dy="0" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.38" />
        </filter>
      </defs>

      <g
        className={isThinking ? 'animate-chronix-flip' : `chronix-x-rotor${isSpinning ? ' is-spinning' : ''}`}
        style={{ transformOrigin: '50px 50px' }}
      >
        {/* Rear element: dark parallel arm, masked by slit (pure Masterpiece, clean) */}
        <g mask={`url(#${maskId})`}>
          <path
            d="M75 0 H100 L62.5 50 L100 100 H75 L37.5 50 Z"
            strokeWidth="2"
            strokeLinejoin="round"
            {...shadowProps}
          />
        </g>

        {/* Front chevron with ambient depth shadow & micro-rounded corners */}
        <path
          d="M0 0 H25 L62.5 50 L25 100 H0 L37.5 50 Z"
          strokeWidth="2"
          strokeLinejoin="round"
          filter={`url(#${filterId})`}
          {...inkProps}
        />
      </g>
    </g>
  );
}

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
  isThinking = false,
  variant = "auto" // 'auto' | 'dark' | 'light' | 'white'
}) {
  const rawId = React.useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const [isSpinning, setIsSpinning] = React.useState(false);
  const spinTimerRef = React.useRef(null);

  React.useEffect(() => () => clearTimeout(spinTimerRef.current), []);

  // Touch devices keep :hover stuck after a tap, so the tap drives a self-resetting spin instead.
  const handleTouchSpin = () => {
    clearTimeout(spinTimerRef.current);
    setIsSpinning(true);
    spinTimerRef.current = setTimeout(() => setIsSpinning(false), 1800);
  };
  const maskId = `chronix-slit-${safeId}`;
  const filterId = `chronix-shadow-${safeId}`;

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

  const isForcedDark = variant === "dark" || variant === "white";
  const isForcedLight = variant === "light";

  // Forced variants use fixed values (used over imagery / before theme tokens apply).
  const textInkProps = isForcedDark
    ? { fill: "#ececef" }
    : isForcedLight
    ? { fill: "#17171a" }
    : { fill: "currentColor", className: "fill-ink transition-colors" };

  const inkProps = isForcedDark
    ? { fill: "#ececef", stroke: "#ececef" }
    : isForcedLight
    ? { fill: "#17171a", stroke: "#17171a" }
    : { fill: "currentColor", stroke: "currentColor", className: "fill-ink stroke-ink transition-colors" };

  const shadowProps = isForcedDark
    ? { fill: "#6b6d7a", stroke: "#6b6d7a" }
    : isForcedLight
    ? { fill: "#868790", stroke: "#868790" }
    : { fill: "rgb(var(--logo-shadow))", stroke: "rgb(var(--logo-shadow))", className: "transition-colors" };

  const mutedProps = isForcedDark
    ? { fill: "#858894", stroke: "#858894" }
    : isForcedLight
    ? { fill: "#b4b6bf", stroke: "#b4b6bf" }
    : { fill: "rgb(var(--logo-silver))", stroke: "rgb(var(--logo-silver))", className: "transition-colors" };

  const axisProps = isForcedDark
    ? { stroke: "#56565e" }
    : isForcedLight
    ? { stroke: "#c4c4cb" }
    : { stroke: "currentColor", className: "text-ink-faint" };

  const thinkingActive = Boolean(isThinking || animated);

  const svgProps = {
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    dir: "ltr",
    style: { direction: 'ltr' },
    className: `group shrink-0 select-none ${computedClass}`,
    onTouchStart: handleTouchSpin,
  };

  const textProps = {
    direction: "ltr",
    style: { direction: 'ltr', unicodeBidi: 'bidi-override' },
    fontFamily: WORDMARK_FONT,
    fontWeight: "700",
    letterSpacing: "-0.5px",
    lengthAdjust: "spacingAndGlyphs",
  };

  if (iconOnly) {
    return (
      <svg viewBox="0 0 36 36" aria-label="ChroniX Icon" {...svgProps}>
        {effectiveMode !== 'minimal' && <circle cx="7.5" cy="28.5" r="2.6" {...mutedProps} />}
        <XMark x0={9} top={8.5} width={18} height={19} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
      </svg>
    );
  }

  // Wordmark with a small graphite origin point before the "C"
  if (effectiveMode === 'dot') {
    return (
      <svg viewBox="0 0 98 28" aria-label="ChroniX Logo" {...svgProps}>
        <circle cx="4" cy="19.4" r="2.6" {...mutedProps} />
        <text x="8.8" y="21.5" fontSize="23" textLength={WORDMARK_WIDTH_23} {...textProps} {...textInkProps}>
          Chroni
        </text>
        <XMark x0={81.2} top={4.8} width={15} height={16.7} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
      </svg>
    );
  }

  if (effectiveMode === 'minimal') {
    return (
      <svg viewBox="0 0 90 28" aria-label="ChroniX Logo" {...svgProps}>
        <text x="1" y="21.5" fontSize="23" textLength={WORDMARK_WIDTH_23} {...textProps} {...textInkProps}>
          Chroni
        </text>
        <XMark x0={73.4} top={4.8} width={15} height={16.7} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
      </svg>
    );
  }

  // Full Cartesian mark: origin beneath the "C", time axis running right
  return (
    <svg viewBox="2 2 119 40" aria-label="ChroniX Logo" {...svgProps}>
      <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" {...axisProps}>
        <line x1="12" y1="40" x2="12" y2="7" />
        <path d="M8.8 9.8 L12 5 L15.2 9.8" />
        <line x1="5" y1="33" x2="113" y2="33" />
        <path d="M110.2 29.8 L115 33 L110.2 36.2" />
      </g>
      <circle cx="12" cy="33" r="3.6" {...textInkProps} />
      <text x="19" y="27" fontSize="21" textLength={WORDMARK_WIDTH_23 * (21 / 23)} {...textProps} {...textInkProps}>
        Chroni
      </text>
      <XMark x0={84.3} top={11.75} width={13.7} height={15.25} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
    </svg>
  );
}
