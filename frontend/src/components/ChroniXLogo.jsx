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

// Comic / Bento / Journal wordmarks share the same geometry as the classic logo; only the paint
// changes. Colors come from each theme's CSS variables so Day/Night mode adapts automatically.
const SKIN_TEXT_PROPS = {
  comic: { fontFamily: "'Bangers', 'Rubik', 'Outfit', sans-serif", fontWeight: "400", letterSpacing: "0.6px" },
  bento: { fontFamily: "'Inter Tight', 'Inter', 'Outfit', sans-serif", fontWeight: "800", letterSpacing: "-0.9px" },
  journal: { fontFamily: "'Caveat', 'Segoe Print', cursive", fontWeight: "700", letterSpacing: "0px" },
};

// Journal wordmark metrics: Caveat 700 renders "Chroni" ~2.33 font-px wide per px of size.
const JOURNAL_SIZE_SCALE = 26 / 23;
const JOURNAL_WIDTH_PER_PX = 60.5 / 26;
const JOURNAL_X_GAP_PER_PX = 3.5 / 23;

// The classic X geometry, shared by the Comic / Bento / Journal marks.
const X_FRONT_SHAPE = "M0 0 H25 L62.5 50 L25 100 H0 L37.5 50 Z";
const X_REAR_SHAPE = "M75 0 H100 L62.5 50 L100 100 H75 L37.5 50 Z";
const X_FRONT_POINTS = [[0, 0], [25, 0], [62.5, 50], [25, 100], [0, 100], [37.5, 50]];
const X_REAR_POINTS = [[75, 0], [100, 0], [62.5, 50], [100, 100], [75, 100], [37.5, 50]];

// Polygon outline drawn as separate pencil strokes that overshoot each corner a little,
// the way a quick hand sketch does.
function sketchOutline(points, overshoot, wobble = 0) {
  return points.map(([x1, y1], k) => {
    const [x2, y2] = points[(k + 1) % points.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const o1 = overshoot * (0.4 + ((k * 37) % 10) / 12);
    const o2 = overshoot * (0.4 + ((k * 53 + 3) % 10) / 12);
    const bend = wobble * (k % 2 === 0 ? 1 : -1);
    const mx = (x1 + x2) / 2 - uy * bend;
    const my = (y1 + y2) / 2 + ux * bend;
    return `M${(x1 - ux * o1).toFixed(1)} ${(y1 - uy * o1).toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${(x2 + ux * o2).toFixed(1)} ${(y2 + uy * o2).toFixed(1)}`;
  }).join(' ');
}

const JOURNAL_FRONT_SKETCH = sketchOutline(X_FRONT_POINTS, 5, 1.2);
const JOURNAL_FRONT_SKETCH_2 = sketchOutline(X_FRONT_POINTS, 3, -1.5);
const JOURNAL_REAR_SKETCH = sketchOutline(X_REAR_POINTS, 5, -1.2);
const JOURNAL_REAR_SKETCH_2 = sketchOutline(X_REAR_POINTS, 3, 1.5);

function SkinXMark({ skin, x0, top, width, height, rotorClass, layer, gradIds }) {
  let content = null;
  let outerTransform = '';
  if (skin === 'comic') {
    // Leans like the Bangers lettering, with the same ink outline and hard drop shadow
    outerTransform = ' translate(50 50) skewX(-9) translate(-50 -50)';
    const edge = { stroke: 'rgb(var(--comic-ink))', strokeWidth: 15, strokeLinejoin: 'miter', strokeMiterlimit: 3 };
    if (layer === 'shadow') {
      content = (
        <g transform="translate(9 9)" fill="rgb(var(--comic-shadow))" {...edge} stroke="rgb(var(--comic-shadow))">
          <path d={X_REAR_SHAPE} />
          <path d={X_FRONT_SHAPE} />
        </g>
      );
    } else {
      content = (
        <>
          <path d={X_REAR_SHAPE} fill="rgb(var(--comic-blue))" paintOrder="stroke fill" {...edge} />
          <path d={X_FRONT_SHAPE} fill="rgb(var(--comic-red))" paintOrder="stroke fill" {...edge} />
          {/* Comic-book shine along the upper arms */}
          <g stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" opacity="0.85">
            <path d="M9 7 L24 27" />
            <path d="M91 7 L84 16" />
          </g>
        </>
      );
    }
  } else if (skin === 'bento') {
    if (layer === 'shadow') return null;
    content = (
      <>
        <defs>
          <linearGradient id={gradIds.front} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="55" y2="100">
            <stop offset="0" stopColor="#f59e0b" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id={gradIds.rear} gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="45" y2="100">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
          <mask id={gradIds.mask}>
            <rect x="-10" y="-10" width="120" height="120" fill="#ffffff" />
            <path d={X_FRONT_SHAPE} fill="#000000" stroke="#000000" strokeWidth="5" strokeLinejoin="round" />
          </mask>
          <filter id={gradIds.filter} x="-25%" y="-25%" width="170%" height="170%">
            <feDropShadow dx="2.4" dy="0" stdDeviation="2.5" floodColor="#6d28d9" floodOpacity="0.35" />
          </filter>
        </defs>
        <g mask={`url(#${gradIds.mask})`}>
          <path d={X_REAR_SHAPE} fill={`url(#${gradIds.rear})`} stroke={`url(#${gradIds.rear})`} strokeWidth="2" strokeLinejoin="round" />
        </g>
        <path d={X_FRONT_SHAPE} fill={`url(#${gradIds.front})`} stroke={`url(#${gradIds.front})`} strokeWidth="2" strokeLinejoin="round" filter={`url(#${gradIds.filter})`} />
      </>
    );
  } else if (skin === 'journal') {
    if (layer === 'shadow') return null;
    outerTransform = ' rotate(-2 50 50)';
    const graphite = 'rgb(var(--ink))';
    const redPencil = 'rgb(var(--journal-red))';
    content = (
      <>
        <defs>
          <pattern id={gradIds.front} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(38)">
            <line x1="0" y1="0" x2="0" y2="8" stroke={graphite} strokeWidth="3" opacity="0.75" />
          </pattern>
          <pattern id={gradIds.rear} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-50)">
            <line x1="0" y1="0" x2="0" y2="8" stroke={redPencil} strokeWidth="3" opacity="0.75" />
          </pattern>
          <mask id={gradIds.mask}>
            <rect x="-20" y="-20" width="140" height="140" fill="#ffffff" />
            <path d={X_FRONT_SHAPE} fill="#000000" stroke="#000000" strokeWidth="9" strokeLinejoin="round" />
          </mask>
        </defs>
        <g mask={`url(#${gradIds.mask})`}>
          <path d={X_REAR_SHAPE} fill={`url(#${gradIds.rear})`} />
          <path d={JOURNAL_REAR_SKETCH} stroke={redPencil} strokeWidth="4.2" />
          <path d={JOURNAL_REAR_SKETCH_2} stroke={redPencil} strokeWidth="2.4" opacity="0.5" />
        </g>
        <path d={X_FRONT_SHAPE} fill={graphite} opacity="0.3" />
        <path d={X_FRONT_SHAPE} fill={`url(#${gradIds.front})`} />
        <path d={JOURNAL_FRONT_SKETCH} stroke={graphite} strokeWidth="4.6" />
        <path d={JOURNAL_FRONT_SKETCH_2} stroke={graphite} strokeWidth="2.6" opacity="0.5" />
      </>
    );
  }
  return (
    <g transform={`translate(${x0} ${top}) scale(${width / 100} ${height / 100})${outerTransform}`}>
      <g className={rotorClass} style={{ transformOrigin: '50px 50px' }} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {content}
      </g>
    </g>
  );
}

function SkinWordmarkText({ skin, x, y, fontSize, textLength, textProps, layer }) {
  const common = { x, y, fontSize, textLength, ...textProps };
  if (skin === 'comic') {
    if (layer === 'shadow') {
      return (
        <text {...common} x={x + 1.5} y={y + 1.5} fill="rgb(var(--comic-shadow))" stroke="rgb(var(--comic-shadow))" strokeWidth="2.4" strokeLinejoin="round">
          Chroni
        </text>
      );
    }
    return (
      <text {...common} fill="rgb(var(--comic-yellow))" stroke="rgb(var(--comic-ink))" strokeWidth="2.4" strokeLinejoin="round" paintOrder="stroke fill">
        Chroni
      </text>
    );
  }
  if (layer === 'shadow') return null;
  if (skin === 'journal') {
    return <text {...common} fill="rgb(var(--ink))" opacity="0.9">Chroni</text>;
  }
  return (
    <text {...common} fill="currentColor" className="fill-ink transition-colors">Chroni</text>
  );
}

function SkinDot({ skin, cx, cy, r, gradId }) {
  if (skin === 'comic') {
    return (
      <>
        <circle cx={cx + 1.2} cy={cy + 1.2} r={r} fill="rgb(var(--comic-shadow))" />
        <circle cx={cx} cy={cy} r={r} fill="rgb(var(--comic-red))" stroke="rgb(var(--comic-ink))" strokeWidth="1.3" />
      </>
    );
  }
  if (skin === 'bento') {
    return (
      <>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f59e0b" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${gradId})`} />
      </>
    );
  }
  // Journal: a graphite dot pressed hard into the paper
  return (
    <>
      <circle cx={cx} cy={cy} r={r * 0.95} fill="rgb(var(--ink))" opacity="0.85" />
      <circle cx={cx + 0.3} cy={cy - 0.2} r={r * 0.95} fill="none" stroke="rgb(var(--ink))" strokeWidth="0.3" opacity="0.5" />
    </>
  );
}

// Paints shadows first, then faces, so a neighbour's offset shadow never covers a glyph.
function SkinLogoLayers({ skin, text: baseText, x, dot: baseDot, dotHugsText = false, rotorClass, textProps, ids }) {
  let text = baseText;
  let dot = baseDot;
  if (skin === 'journal' && baseText) {
    // Caveat is much narrower than the classic face; stretching it to the classic width distorts
    // the letters, so keep its natural width and right-align it with some air before the X.
    const fontSize = baseText.fontSize * JOURNAL_SIZE_SCALE;
    const textLength = fontSize * JOURNAL_WIDTH_PER_PX;
    const shift = baseText.textLength - baseText.fontSize * JOURNAL_X_GAP_PER_PX - textLength;
    text = { ...baseText, x: baseText.x + shift, y: baseText.y + baseText.fontSize * 0.02, fontSize, textLength };
    if (dot && dotHugsText) dot = { ...dot, cx: dot.cx + shift };
  }
  const gradIds = { rear: `${ids}-xr`, front: `${ids}-xf`, mask: `${ids}-xm`, filter: `${ids}-xs` };
  const pencilId = `${ids}-pencil`;
  const layers = (
    <>
      {text && <SkinWordmarkText skin={skin} {...text} textProps={textProps} layer="shadow" />}
      <SkinXMark skin={skin} {...x} rotorClass={rotorClass} layer="shadow" gradIds={gradIds} />
      {dot && <SkinDot skin={skin} {...dot} gradId={`${ids}-dot`} />}
      {text && <SkinWordmarkText skin={skin} {...text} textProps={textProps} layer="face" />}
      <SkinXMark skin={skin} {...x} rotorClass={rotorClass} layer="face" gradIds={gradIds} />
    </>
  );
  if (skin !== 'journal') return layers;
  // Roughens edges and breaks fills up with paper grain so everything reads as graphite
  return (
    <>
      <defs>
        <filter id={pencilId} x="-8%" y="-20%" width="116%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="0.35" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="1.2 4" numOctaves="2" seed="9" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.2 0 0 0 2.75" result="grainMask" />
          <feComposite in="rough" in2="grainMask" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${pencilId})`}>{layers}</g>
    </>
  );
}

function readLogoSkin() {
  if (typeof document === 'undefined') return null;
  const cl = document.documentElement.classList;
  if (cl.contains('theme-toy')) return 'toy';
  if (cl.contains('theme-comic')) return 'comic';
  if (cl.contains('theme-bento')) return 'bento';
  if (cl.contains('theme-journal')) return 'journal';
  return null;
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
  const [skin, setSkin] = React.useState(readLogoSkin);
  const isToy = skin === 'toy';
  const styledSkin = skin && skin !== 'toy' ? skin : null;
  const spinTimerRef = React.useRef(null);

  React.useEffect(() => {
    const syncSkin = () => setSkin(readLogoSkin());
    syncSkin();
    window.addEventListener('chronix:visual-theme-change', syncSkin);
    let observer;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      observer = new MutationObserver(syncSkin);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    return () => {
      clearTimeout(spinTimerRef.current);
      window.removeEventListener('chronix:visual-theme-change', syncSkin);
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
  const rotorClass = thinkingActive ? 'animate-chronix-flip' : `chronix-x-rotor${isSpinning ? ' is-spinning' : ''}`;

  const svgProps = {
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    dir: "ltr",
    style: { direction: 'ltr', overflow: skin ? 'visible' : undefined },
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
    ...(styledSkin ? SKIN_TEXT_PROPS[styledSkin] : null),
  };
  const skinIds = `${maskId}-skin`;

  if (iconOnly) {
    return (
      <svg viewBox="0 0 36 36" aria-label="ChroniX Icon" {...svgProps}>
        {styledSkin ? (
          <SkinLogoLayers
            skin={styledSkin}
            x={{ x0: 9, top: 8.5, width: 18, height: 19 }}
            dot={effectiveMode !== 'minimal' ? { cx: 7.5, cy: 28.5, r: 3 } : null}
            rotorClass={rotorClass}
            textProps={textProps}
            ids={skinIds}
          />
        ) : isToy ? (
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
        {styledSkin ? (
          <SkinLogoLayers
            skin={styledSkin}
            text={{ x: 8.8, y: 21.5, fontSize: 23, textLength: WORDMARK_WIDTH_23 }}
            x={{ x0: 81.2, top: 4.8, width: 15, height: 16.7 }}
            dot={{ cx: 4, cy: 19.4, r: 2.8 }}
            dotHugsText
            rotorClass={rotorClass}
            textProps={textProps}
            ids={skinIds}
          />
        ) : isToy ? (
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
        {styledSkin ? (
          <SkinLogoLayers
            skin={styledSkin}
            text={{ x: 1, y: 21.5, fontSize: 23, textLength: WORDMARK_WIDTH_23 }}
            x={{ x0: 73.4, top: 4.8, width: 15, height: 16.7 }}
            rotorClass={rotorClass}
            textProps={textProps}
            ids={skinIds}
          />
        ) : isToy ? (
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
        strokeWidth={isToy || styledSkin === 'comic' ? "2.6" : "1.8"}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        {...(isToy
          ? { stroke: "rgb(var(--toy-edge))" }
          : styledSkin === 'comic'
          ? { stroke: "rgb(var(--comic-edge))" }
          : styledSkin === 'journal'
          ? { stroke: "rgb(var(--ink))", opacity: 0.55, filter: `url(#${skinIds}-pencil)` }
          : axisProps)}
      >
        <line x1="12" y1="40" x2="12" y2="7" />
        <path d="M8.8 9.8 L12 5 L15.2 9.8" />
        <line x1="5" y1="33" x2="113" y2="33" />
        <path d="M110.2 29.8 L115 33 L110.2 36.2" />
      </g>
      {styledSkin ? (
        <SkinLogoLayers
          skin={styledSkin}
          text={{ x: 19, y: 27, fontSize: 21, textLength: WORDMARK_WIDTH_23 * (21 / 23) }}
          x={{ x0: 84.3, top: 11.75, width: 13.7, height: 15.25 }}
          dot={{ cx: 12, cy: 33, r: 3.6 }}
          rotorClass={rotorClass}
          textProps={textProps}
          ids={skinIds}
        />
      ) : isToy ? (
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
