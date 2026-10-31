import { decompressFrames, parseGIF } from 'gifuct-js';

// Canvas `drawImage` of an animated <img> draws only the first frame in Safari (and Chrome
// throttles off-DOM GIFs), so canvas-drawn GIFs are decoded into frames here.

const MAX_FRAME_SIDE = 720;
const MAX_FRAMES = 240;
const MIN_FRAME_DELAY_MS = 20;
// Browsers play GIF frame delays this short as 100ms.
const BROWSER_FAST_DELAY_MS = 10;

export function isGifSource(url, mediaType) {
  if (mediaType === 'gif') return true;
  if (typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.gif') || lower.includes('.gif?');
}

function normalizeDelay(delay) {
  const ms = Number(delay) || 0;
  if (ms <= BROWSER_FAST_DELAY_MS) return 100;
  return Math.max(MIN_FRAME_DELAY_MS, ms);
}

/**
 * Fetches and decodes an animated GIF into fully composited frames.
 * Resolves to `{ width, height, frames: [{ canvas, start }], duration }`; `duration` is 0
 * for single-frame GIFs. Rejects if the file cannot be fetched (CORS) or decoded.
 */
export async function decodeAnimatedGif(url, { signal } = {}) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
  if (!response.ok) throw new Error(`GIF fetch failed: ${response.status}`);
  const gif = parseGIF(await response.arrayBuffer());
  const rawFrames = decompressFrames(gif, true).slice(0, MAX_FRAMES);
  const width = gif.lsd?.width || rawFrames[0]?.dims?.width || 0;
  const height = gif.lsd?.height || rawFrames[0]?.dims?.height || 0;
  if (!width || !height || rawFrames.length === 0) throw new Error('Empty GIF');

  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const workCtx = work.getContext('2d', { willReadFrequently: true });
  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');

  const frames = [];
  let start = 0;
  for (const frame of rawFrames) {
    const { left, top, width: fw, height: fh } = frame.dims;
    const restore = frame.disposalType === 3 ? workCtx.getImageData(0, 0, width, height) : null;

    if (fw > 0 && fh > 0 && frame.patch) {
      patchCanvas.width = fw;
      patchCanvas.height = fh;
      patchCtx.putImageData(new ImageData(frame.patch, fw, fh), 0, 0);
      workCtx.drawImage(patchCanvas, left, top);
    }

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const outCtx = out.getContext('2d');
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(work, 0, 0, outW, outH);
    frames.push({ canvas: out, start });
    start += normalizeDelay(frame.delay);

    if (frame.disposalType === 2) workCtx.clearRect(left, top, fw, fh);
    else if (restore) workCtx.putImageData(restore, 0, 0);
  }

  return { width: outW, height: outH, frames, duration: frames.length > 1 ? start : 0 };
}

/** Frame to show at `time` (ms) plus how long until the next frame is due. */
export function getGifFrameAt(gif, time) {
  if (!gif?.frames?.length) return null;
  if (!gif.duration) return { frame: gif.frames[0], nextIn: Infinity };
  const t = ((time % gif.duration) + gif.duration) % gif.duration;
  let index = gif.frames.length - 1;
  for (let i = 1; i < gif.frames.length; i += 1) {
    if (gif.frames[i].start > t) {
      index = i - 1;
      break;
    }
  }
  const nextStart = index + 1 < gif.frames.length ? gif.frames[index + 1].start : gif.duration;
  return { frame: gif.frames[index], nextIn: Math.max(MIN_FRAME_DELAY_MS, nextStart - t) };
}
