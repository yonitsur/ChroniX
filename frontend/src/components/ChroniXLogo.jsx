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

const TOY_X_REAR = "M86 13 L52 50 L86 87";
const TOY_X_FRONT = "M14 13 L48 50 L14 87";

// Toy-theme X, split into paint layers ('rim' | 'lip' | 'top') so the whole logo is composed
// layer-by-layer: the X's sticker rim and 3D lip must sit *under* the neighbouring letters,
// never be stamped over the "i". All layers share the rotor class so they spin in sync.
function ToyXMark({ x0, top, width, height, layer, rotorClass }) {
  let content;
  if (layer === 'rim') {
    // Night-only moonlit sticker rim wrapping chevrons + lip (hidden in Day Mode via CSS)
    content = (
      <g className="chronix-toy-logo-rim" stroke="rgb(var(--toy-edge))" strokeWidth="52">
        <path d={TOY_X_REAR} />
        <path d={TOY_X_FRONT} />
        <path d={TOY_X_REAR} transform="translate(0 11)" />
        <path d={TOY_X_FRONT} transform="translate(0 11)" />
      </g>
    );
  } else if (layer === 'lip') {
    // 3D Bottom Lip Extrusion (matches Chroni's y+1.8 and heavy dark casing)
    content = (
      <g transform="translate(0 11)" stroke="rgb(var(--toy-lip))" strokeWidth="43">
        <path d={TOY_X_REAR} />
        <path d={TOY_X_FRONT} />
      </g>
    );
  } else {
    content = (
      <>
        {/* Unified Outer Dark Toy Outline for both chevrons */}
        <g stroke="rgb(var(--toy-ink))" strokeWidth="40">
          <path d={TOY_X_REAR} />
          <path d={TOY_X_FRONT} />
        </g>
        {/* Rear Right Chevron: Plump Rounded Sky-Blue Toy Bar */}
        <path d={TOY_X_REAR} stroke="#38bdf8" strokeWidth="23" />
        {/* Crisp Inner Divider Outline + Front Left Chevron: Plump Rounded Sunny-Gold Toy Bar */}
        <path d={TOY_X_FRONT} stroke="rgb(var(--toy-ink))" strokeWidth="30" />
        <path d={TOY_X_FRONT} stroke="#facc15" strokeWidth="23" />
      </>
    );
  }
  return (
    <g transform={`translate(${x0} ${top}) scale(${width / 100} ${height / 100})`}>
      <g
        className={rotorClass}
        style={{ transformOrigin: '50px 50px' }}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {content}
      </g>
    </g>
  );
}

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

function ToyWordmarkText({ x, y, fontSize, textLength, textProps, layer }) {
  if (layer === 'rim') {
    // Night-only moonlit sticker rim wrapping letters + lip (hidden in Day Mode via CSS)
    return (
      <g className="chronix-toy-logo-rim" fill="rgb(var(--toy-edge))" stroke="rgb(var(--toy-edge))" strokeWidth="5.2" strokeLinejoin="round">
        <text x={x} y={y} fontSize={fontSize} textLength={textLength} {...textProps}>Chroni</text>
        <text x={x} y={y + 1.8} fontSize={fontSize} textLength={textLength} {...textProps}>Chroni</text>
      </g>
    );
  }
  if (layer === 'lip') {
    // 3D Extruded Bottom Lip
    return (
      <text
        x={x}
        y={y + 1.8}
        fontSize={fontSize}
        textLength={textLength}
        {...textProps}
        fill="rgb(var(--toy-lip))"
        stroke="rgb(var(--toy-lip))"
        strokeWidth="3.2"
        strokeLinejoin="round"
        paintOrder="stroke fill"
      >
        Chroni
      </text>
    );
  }
  // Colorful Toy Block Letters with Bold Outline
  return (
    <text
      x={x}
      y={y}
      fontSize={fontSize}
      textLength={textLength}
      {...textProps}
      stroke="rgb(var(--toy-ink))"
      strokeWidth="2.6"
      strokeLinejoin="round"
      paintOrder="stroke fill"
    >
      <tspan fill="#ef4444">C</tspan>
      <tspan fill="#f97316">h</tspan>
      <tspan fill="#facc15">r</tspan>
      <tspan fill="#22c55e">o</tspan>
      <tspan fill="#38bdf8">n</tspan>
      <tspan fill="#c084fc">i</tspan>
    </text>
  );
}

// Composes the toy logo one paint layer at a time across all parts (rims → lips → faces),
// so the overlapping rim/lip of one glyph never covers the face of its neighbour.
function ToyLogoLayers({ text, x, rotorClass, textProps, faceExtras = null }) {
  return (
    <>
      {text && <ToyWordmarkText {...text} textProps={textProps} layer="rim" />}
      <ToyXMark {...x} rotorClass={rotorClass} layer="rim" />
      {text && <ToyWordmarkText {...text} textProps={textProps} layer="lip" />}
      <ToyXMark {...x} rotorClass={rotorClass} layer="lip" />
      {faceExtras}
      {text && <ToyWordmarkText {...text} textProps={textProps} layer="top" />}
      <ToyXMark {...x} rotorClass={rotorClass} layer="top" />
    </>
  );
}

function readIsToyLogo() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('theme-toy');
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
  const [isToy, setIsToy] = React.useState(readIsToyLogo);
  const spinTimerRef = React.useRef(null);

  React.useEffect(() => {
    const syncToy = () => setIsToy(readIsToyLogo());
    syncToy();
    window.addEventListener('chronix:visual-theme-change', syncToy);
    let observer;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      observer = new MutationObserver(syncToy);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    return () => {
      clearTimeout(spinTimerRef.current);
      window.removeEventListener('chronix:visual-theme-change', syncToy);
      observer?.disconnect();
    };
  }, []);

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

  // Forced variants use fixed warm archival values (used over imagery / before theme tokens apply).
  const textInkProps = isForcedDark
    ? { fill: "#f5f3f0" }
    : isForcedLight
    ? { fill: "#1c1a18" }
    : { fill: "currentColor", className: "fill-ink transition-colors" };

  const inkProps = isForcedDark
    ? { fill: "#f5f3f0", stroke: "#f5f3f0" }
    : isForcedLight
    ? { fill: "#1c1a18", stroke: "#1c1a18" }
    : { fill: "currentColor", stroke: "currentColor", className: "fill-ink stroke-ink transition-colors" };

  const shadowProps = isForcedDark
    ? { fill: "#d4956a", stroke: "#d4956a" }
    : isForcedLight
    ? { fill: "#a85d3b", stroke: "#a85d3b" }
    : { fill: "rgb(var(--logo-shadow))", stroke: "rgb(var(--logo-shadow))", className: "transition-colors" };

  const mutedProps = isForcedDark
    ? { fill: "#c48a62", stroke: "#c48a62" }
    : isForcedLight
    ? { fill: "#b87252", stroke: "#b87252" }
    : { fill: "rgb(var(--logo-silver))", stroke: "rgb(var(--logo-silver))", className: "transition-colors" };

  const axisProps = isForcedDark
    ? { stroke: "#5c5650" }
    : isForcedLight
    ? { stroke: "#c8c1b8" }
    : { stroke: "currentColor", className: "text-ink-faint" };

  const thinkingActive = Boolean(isThinking || animated);
  const rotorClass = thinkingActive ? 'animate-chronix-flip' : `chronix-x-rotor${isSpinning ? ' is-spinning' : ''}`;

  const svgProps = {
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    dir: "ltr",
    style: { direction: 'ltr', overflow: isToy ? 'visible' : undefined },
    className: `group shrink-0 select-none ${computedClass}`,
    onTouchStart: handleTouchSpin,
  };

  const textProps = {
    direction: "ltr",
    style: { direction: 'ltr', unicodeBidi: 'bidi-override' },
    fontFamily: isToy ? "'Fredoka', 'Rubik', 'Outfit', 'Plus Jakarta Sans', sans-serif" : WORDMARK_FONT,
    fontWeight: isToy ? "800" : "700",
    letterSpacing: "-0.5px",
    lengthAdjust: "spacingAndGlyphs",
  };

  if (iconOnly) {
    return (
      <svg viewBox="0 0 36 36" aria-label="ChroniX Icon" {...svgProps}>
        {isToy ? (
          <ToyLogoLayers
            x={{ x0: 9, top: 8.5, width: 18, height: 19 }}
            rotorClass={rotorClass}
            textProps={textProps}
            faceExtras={effectiveMode !== 'minimal' && <circle cx="7.5" cy="28.5" r="3.2" fill="#22c55e" stroke="rgb(var(--toy-ink))" strokeWidth="1.5" />}
          />
        ) : (
          <>
            {effectiveMode !== 'minimal' && <circle cx="7.5" cy="28.5" r="2.6" {...mutedProps} />}
            <XMark x0={9} top={8.5} width={18} height={19} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
          </>
        )}
      </svg>
    );
  }

  // Wordmark with a small graphite origin point before the "C"
  if (effectiveMode === 'dot') {
    return (
      <svg viewBox="0 0 98 28" aria-label="ChroniX Logo" {...svgProps}>
        {isToy ? (
          <ToyLogoLayers
            text={{ x: 8.8, y: 21.5, fontSize: 23, textLength: WORDMARK_WIDTH_23 }}
            x={{ x0: 81.2, top: 4.8, width: 15, height: 16.7 }}
            rotorClass={rotorClass}
            textProps={textProps}
            faceExtras={<circle cx="4" cy="19.4" r="3" fill="#22c55e" stroke="rgb(var(--toy-ink))" strokeWidth="1.5" />}
          />
        ) : (
          <>
            <circle cx="4" cy="19.4" r="2.6" {...mutedProps} />
            <text x="8.8" y="21.5" fontSize="23" textLength={WORDMARK_WIDTH_23} {...textProps} {...textInkProps}>
              Chroni
            </text>
            <XMark x0={81.2} top={4.8} width={15} height={16.7} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
          </>
        )}
      </svg>
    );
  }

  if (effectiveMode === 'minimal') {
    return (
      <svg viewBox="0 0 90 28" aria-label="ChroniX Logo" {...svgProps}>
        {isToy ? (
          <ToyLogoLayers
            text={{ x: 1, y: 21.5, fontSize: 23, textLength: WORDMARK_WIDTH_23 }}
            x={{ x0: 73.4, top: 4.8, width: 15, height: 16.7 }}
            rotorClass={rotorClass}
            textProps={textProps}
          />
        ) : (
          <>
            <text x="1" y="21.5" fontSize="23" textLength={WORDMARK_WIDTH_23} {...textProps} {...textInkProps}>
              Chroni
            </text>
            <XMark x0={73.4} top={4.8} width={15} height={16.7} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
          </>
        )}
      </svg>
    );
  }

  // Full Cartesian mark: origin beneath the "C", time axis running right
  return (
    <svg viewBox="2 2 119 40" aria-label="ChroniX Logo" {...svgProps}>
      <g
        strokeWidth={isToy ? "2.6" : "1.8"}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        {...(isToy
          ? { stroke: "rgb(var(--toy-edge))" }
          : axisProps)}
      >
        <line x1="12" y1="40" x2="12" y2="7" />
        <path d="M8.8 9.8 L12 5 L15.2 9.8" />
        <line x1="5" y1="33" x2="113" y2="33" />
        <path d="M110.2 29.8 L115 33 L110.2 36.2" />
      </g>
      {isToy ? (
        <ToyLogoLayers
          text={{ x: 19, y: 27, fontSize: 21, textLength: WORDMARK_WIDTH_23 * (21 / 23) }}
          x={{ x0: 84.3, top: 11.75, width: 13.7, height: 15.25 }}
          rotorClass={rotorClass}
          textProps={textProps}
          faceExtras={<circle cx="12" cy="33" r="3.6" fill="#22c55e" stroke="rgb(var(--toy-ink))" strokeWidth="1.5" />}
        />
      ) : (
        <>
          <circle cx="12" cy="33" r="3.6" {...textInkProps} />
          <text x="19" y="27" fontSize="21" textLength={WORDMARK_WIDTH_23 * (21 / 23)} {...textProps} {...textInkProps}>
            Chroni
          </text>
          <XMark x0={84.3} top={11.75} width={13.7} height={15.25} inkProps={inkProps} shadowProps={shadowProps} maskId={maskId} filterId={filterId} isThinking={thinkingActive} isSpinning={isSpinning} />
        </>
      )}
    </svg>
  );
}
