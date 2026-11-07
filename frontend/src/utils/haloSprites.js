// Cached radial-gradient "halo" sprites for the constellation sky.
// Instead of building a CanvasGradient per star per frame, each (colour, stop-profile) halo is
// rendered once at unit opacity into a small offscreen canvas and then stamped with drawImage
// using globalAlpha. Because every stop shares one colour and the stop alphas are a fixed ratio of
// the centre alpha, `gradient(alpha * k_i)` === `sprite(k_i)` drawn at globalAlpha `alpha`.

// Stop profiles: [offset, alpha relative to the centre].
export const HALO_PROFILES = Object.freeze({
  // Background specks: centre -> transparent.
  speck: Object.freeze([[0, 1], [1, 0]]),
  // Night constellation stars: centre, 45% at 0.45, transparent edge.
  night: Object.freeze([[0, 1], [0.45, 0.45], [1, 0]]),
  // Day constellation stars: centre, 42% at 0.45, transparent edge.
  day: Object.freeze([[0, 1], [0.45, 0.42], [1, 0]]),
});

// Largest halo drawn is ~24 CSS px (night, magnitude < 2, fully aligned), so a 32 CSS px sprite
// radius is only ever scaled down.
export const HALO_SPRITE_RADIUS_CSS = 32;
const MAX_CACHED_SPRITES = 48;

export function haloSpriteKey(r, g, b, profileName) {
  return `${r},${g},${b}|${profileName}`;
}

export function haloSpriteRadiusPx(pixelRatio) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.max(8, Math.ceil(HALO_SPRITE_RADIUS_CSS * ratio));
}

/**
 * @param {{ createCanvas: (size: number) => HTMLCanvasElement | OffscreenCanvas }} options
 */
export function createHaloSpriteCache({ createCanvas }) {
  const sprites = new Map();
  let radiusPx = haloSpriteRadiusPx(1);

  const render = (r, g, b, profileName) => {
    const profile = HALO_PROFILES[profileName];
    if (!profile) return null;
    const size = radiusPx * 2;
    const canvas = createCanvas(size);
    if (!canvas) return null;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(radiusPx, radiusPx, 0, radiusPx, radiusPx, radiusPx);
    for (const [offset, alpha] of profile) gradient.addColorStop(offset, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
  };

  return {
    get(r, g, b, profileName) {
      const key = haloSpriteKey(r, g, b, profileName);
      let sprite = sprites.get(key);
      if (sprite === undefined) {
        if (sprites.size >= MAX_CACHED_SPRITES) sprites.clear();
        sprite = render(r, g, b, profileName);
        sprites.set(key, sprite);
      }
      return sprite;
    },
    /** Drop all sprites; call on resize / devicePixelRatio change. */
    reset(pixelRatio = 1) {
      sprites.clear();
      radiusPx = haloSpriteRadiusPx(pixelRatio);
    },
    get size() { return sprites.size; },
    get radiusPx() { return radiusPx; },
  };
}

/** Stamp a cached halo centred on (x, y) with the given outer radius and centre alpha. */
export function drawHaloSprite(ctx, sprite, x, y, radius, alpha) {
  if (!sprite || !(radius > 0) || !(alpha > 0)) return;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = previousAlpha * alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = previousAlpha;
}
