/**
 * canvasMath.js
 * Typesets inline LaTeX formulas inside <canvas> text (the timeline's focus card) so they look
 * like the KaTeX rendering used by the map popups and the event drawer. Each formula is rendered
 * once by KaTeX into a hidden DOM node; its glyphs, rules and SVG strokes are measured there and
 * replayed on the canvas.
 */
import katex from 'katex';
import { containsMath, mathToPlainText, normalizeMathInText } from './mathUtils.js';

const MATH_SPLIT_REGEX = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
// Whitespace, a chunk ending in a break-after character (hyphens, dashes, slash), or a plain chunk.
const WORD_TOKEN_REGEX = /\s+|[^\s\-–—/]*[-–—/]|[^\s\-–—/]+/g;

/**
 * Splits text into plain-text and TeX runs, normalizing formulas the same way the map popup does.
 * Returns null when the text has no formula, so callers can keep their plain-text path.
 * @param {string} rawText
 * @returns {Array<{type: 'text', text: string} | {type: 'math', tex: string}> | null}
 */
export function splitMathRuns(rawText) {
  if (!rawText || typeof rawText !== 'string' || !containsMath(rawText)) return null;
  const runs = [];
  normalizeMathInText(rawText).split(MATH_SPLIT_REGEX).forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 0) {
      // normalizeMathInText protects currency as "&#36;".
      runs.push({ type: 'text', text: part.replace(/&#36;/g, '$') });
      return;
    }
    const tex = (part.startsWith('$$') ? part.slice(2, -2) : part.slice(1, -1)).trim();
    if (tex) runs.push({ type: 'math', tex });
  });
  return runs.some((run) => run.type === 'math') ? runs : null;
}

/**
 * Groups runs into unbreakable words. A formula glued to punctuation ("($x$).") stays one word;
 * lines may break at whitespace (spaceAfter: true) or after hyphens / dashes / slashes.
 */
export function buildRichWords(runs) {
  const words = [];
  let pieces = [];
  const endWord = (spaceAfter) => {
    if (pieces.length) words.push({ pieces, spaceAfter });
    else if (spaceAfter && words.length) words[words.length - 1].spaceAfter = true;
    pieces = [];
  };
  const addText = (text) => {
    const last = pieces[pieces.length - 1];
    if (last?.type === 'text') last.text += text;
    else pieces.push({ type: 'text', text });
  };
  (runs || []).forEach((run) => {
    if (run.type === 'math') {
      pieces.push({ type: 'math', tex: run.tex });
      return;
    }
    for (const [token] of run.text.matchAll(WORD_TOKEN_REGEX)) {
      if (/^\s+$/.test(token)) {
        endWord(true);
      } else if (/[-–—/]$/.test(token)) {
        addText(token);
        endWord(false);
      } else {
        addText(token);
      }
    }
  });
  endWord(false);
  if (words.length) words[words.length - 1].spaceAfter = false;
  return words;
}

const mergePieces = (pieces) => {
  const out = [];
  pieces.forEach((piece) => {
    const last = out[out.length - 1];
    if (piece.type === 'text' && last?.type === 'text') last.text += piece.text;
    else out.push({ ...piece });
  });
  return out;
};

/**
 * Greedy word wrap of rich words into canvas lines.
 * Each line: { pieces: [{type:'text', text, width} | {type:'math', layout, width}], width,
 *              baselineOffset, padTop, h } where `h` grows past `lineHeight` only when a tall
 * formula (e.g. a fraction) would not fit, and `baselineOffset` is the distance from the slot's
 * vertical centre (textBaseline 'middle') down to the alphabetic baseline.
 * Formulas that cannot be typeset (fonts still loading, no DOM) fall back to plain Unicode text.
 */
export function layoutRichLines(ctx, words, maxWidth, {
  fontPx,
  lineHeight,
  maxLines = Infinity,
  getMathLayout = getCanvasMathLayout,
} = {}) {
  const measure = (text) => ctx.measureText(text).width;
  const resolvePiece = (piece) => {
    if (piece.type !== 'math') return { type: 'text', text: piece.text };
    const layout = getMathLayout(piece.tex, fontPx);
    if (!layout || layout.width > maxWidth) return { type: 'text', text: mathToPlainText(`$${piece.tex}$`) };
    return { type: 'math', layout, width: layout.width };
  };
  const pieceWidth = (piece) => (piece.type === 'math' ? piece.width : measure(piece.text));
  const wordWidth = (word) => word.pieces.reduce((sum, piece) => sum + pieceWidth(piece), 0);
  const spaceWidth = measure(' ');

  const resolved = (words || []).map((word) => ({
    spaceAfter: word.spaceAfter,
    pieces: mergePieces(word.pieces.map(resolvePiece)),
  }));

  // Characters of an over-long plain word, chunked to fit the width.
  const breakLongText = (text) => {
    const chunks = [];
    let chunk = '';
    for (const ch of text) {
      if (chunk && measure(chunk + ch) > maxWidth) {
        chunks.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };

  const lineWords = [];
  let current = [];
  let currentWidth = 0;
  resolved.forEach((word) => {
    let width = wordWidth(word);
    if (current.length) {
      const gap = current[current.length - 1].spaceAfter ? spaceWidth : 0;
      if (currentWidth + gap + width <= maxWidth) {
        current.push(word);
        currentWidth += gap + width;
        return;
      }
      lineWords.push(current);
      current = [];
    }
    if (width > maxWidth && word.pieces.length === 1 && word.pieces[0].type === 'text') {
      const chunks = breakLongText(word.pieces[0].text);
      chunks.slice(0, -1).forEach((chunk) => lineWords.push([{ spaceAfter: false, pieces: [{ type: 'text', text: chunk }] }]));
      word = { spaceAfter: word.spaceAfter, pieces: [{ type: 'text', text: chunks[chunks.length - 1] || '' }] };
      width = wordWidth(word);
    }
    current = [word];
    currentWidth = width;
  });
  if (current.length) lineWords.push(current);

  const toPieces = (wordsOfLine) => {
    const pieces = [];
    wordsOfLine.forEach((word, i) => {
      if (i > 0 && wordsOfLine[i - 1].spaceAfter) pieces.push({ type: 'text', text: ' ' });
      pieces.push(...word.pieces);
    });
    return mergePieces(pieces);
  };
  const measurePieces = (pieces) => pieces.map((piece) => (
    piece.type === 'math' ? piece : { ...piece, width: measure(piece.text) }
  ));

  let linePieces = lineWords.map((wordsOfLine) => measurePieces(toPieces(wordsOfLine)));
  if (linePieces.length > maxLines) {
    // Clamp: the last kept line ends with an ellipsis (whole formulas are dropped, never cut).
    linePieces = linePieces.slice(0, maxLines);
    const last = linePieces[maxLines - 1].map((piece) => ({ ...piece }));
    const totalWidth = (pieces) => pieces.reduce((sum, piece) => sum + piece.width, 0) + measure('…');
    while (last.length && totalWidth(last) > maxWidth) {
      const tail = last[last.length - 1];
      if (tail.type === 'math' || [...tail.text].length <= 1) {
        last.pop();
      } else {
        tail.text = [...tail.text].slice(0, -1).join('');
        tail.width = measure(tail.text);
      }
    }
    const tail = last[last.length - 1];
    if (tail?.type === 'text') tail.text = tail.text.trimEnd();
    last.push({ type: 'text', text: '…' });
    linePieces[maxLines - 1] = measurePieces(mergePieces(last));
  }

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText('Hg');
  ctx.restore();
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? fontPx * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? fontPx * 0.2;
  const baselineOffset = (ascent - descent) / 2;
  const roomAbove = lineHeight / 2 + baselineOffset;
  const roomBelow = lineHeight / 2 - baselineOffset;

  return linePieces.map((pieces) => {
    let mathAscent = 0;
    let mathDescent = 0;
    pieces.forEach((piece) => {
      if (piece.type !== 'math') return;
      mathAscent = Math.max(mathAscent, piece.layout.ascent);
      mathDescent = Math.max(mathDescent, piece.layout.descent);
    });
    // A pixel of overlap into the line spacing is fine; taller formulas get extra room.
    const padTop = Math.max(0, Math.ceil(mathAscent - roomAbove - 1));
    const padBottom = Math.max(0, Math.ceil(mathDescent - roomBelow - 1));
    return {
      pieces,
      width: pieces.reduce((sum, piece) => sum + piece.width, 0),
      baselineOffset,
      padTop,
      h: lineHeight + padTop + padBottom,
    };
  });
}

/**
 * Draws a line produced by layoutRichLines. `startX` is the line's start edge (the right edge for
 * RTL); `centerY` is where a plain line would be drawn with textBaseline 'middle'. Text pieces use
 * the context's current font and fill style.
 */
export function drawRichLine(ctx, line, startX, centerY, isRtl) {
  const baseline = centerY + line.baselineOffset;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = isRtl ? 'right' : 'left';
  let x = startX;
  line.pieces.forEach((piece) => {
    if (piece.type === 'math') {
      drawCanvasMath(ctx, piece.layout, isRtl ? x - piece.width : x, baseline);
    } else {
      ctx.fillText(piece.text, x, baseline);
    }
    x += isRtl ? -piece.width : piece.width;
  });
  ctx.restore();
}

// ---- KaTeX measurement ----

const layoutCache = new Map();
const path2dCache = new Map();
const requestedFonts = new Set();
const listeners = new Set();
let version = 0;
let host = null;
let bumpTimer = null;
let measureCtx = null;

/** Changes whenever cached formula layouts are invalidated (e.g. once KaTeX fonts finish loading). */
export function getCanvasMathVersion() {
  return version;
}

/** Calls `callback` whenever formulas should be re-laid out and redrawn. Returns an unsubscribe. */
export function subscribeCanvasMath(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function scheduleInvalidate() {
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    version += 1;
    layoutCache.clear();
    listeners.forEach((callback) => {
      try {
        callback();
      } catch (e) { /* ignore */ }
    });
  }, 0);
}

function getHost() {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('dir', 'ltr');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
      + 'white-space:nowrap;line-height:normal;direction:ltr;contain:layout style;';
    document.body.appendChild(host);
  }
  return host;
}

function getMeasureCtx() {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

// Fraction of a text node's client rect height that lies above its baseline, for `font`.
function getAscentRatio(font, text) {
  const ctx = getMeasureCtx();
  if (!ctx) return 0.8;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  return Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
    ? ascent / (ascent + descent)
    : 0.8;
}

function intersectRect(a, b) {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function collectSvgPaths(svg, htmlEl, originX, baseline, out) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  let sx = 1;
  let sy = 1;
  let tx = r.left - originX;
  let ty = r.top - baseline;
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) {
    const [align = 'xMidYMid', mode = 'meet'] = (svg.getAttribute('preserveAspectRatio') || '').trim().split(/\s+/).filter(Boolean);
    sx = r.width / vb.width;
    sy = r.height / vb.height;
    if (align !== 'none') {
      const s = mode === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
      const ax = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
      const ay = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
      tx += (r.width - vb.width * s) * ax;
      ty += (r.height - vb.height * s) * ay;
      sx = s;
      sy = s;
    }
    tx -= vb.x * sx;
    ty -= vb.y * sy;
  }
  // KaTeX draws long SVG strokes (e.g. the √ overbar) and trims them with overflow:hidden parents.
  let clip = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let el = svg.parentElement; el && htmlEl.contains(el); el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clip = intersectRect(clip, el.getBoundingClientRect());
  }
  if (clip.right <= clip.left || clip.bottom <= clip.top) return;
  svg.querySelectorAll('path').forEach((path) => {
    const d = path.getAttribute('d');
    if (!d) return;
    out.push({
      d,
      sx,
      sy,
      tx,
      ty,
      clip: { x: clip.left - originX, y: clip.top - baseline, w: clip.right - clip.left, h: clip.bottom - clip.top },
    });
  });
}

function measureKatex(htmlEl, originX, baseline) {
  const glyphs = [];
  const rules = [];
  const paths = [];
  const fonts = new Map();

  const walker = document.createTreeWalker(htmlEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text || /^[\s\u200b]*$/.test(text)) continue;
    const cs = getComputedStyle(node.parentElement);
    // KaTeX \phantom content is transparent (the host itself is visibility:hidden, so don't test that).
    if (cs.color === 'transparent' || cs.color === 'rgba(0, 0, 0, 0)') continue;
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    fonts.set(font, (fonts.get(font) || '') + text);
    glyphs.push({ text, font, x: r.left - originX, y: r.top - baseline + r.height * getAscentRatio(font, text) });
  }

  htmlEl.querySelectorAll('*').forEach((el) => {
    if (el.tagName.toLowerCase() === 'svg') {
      collectSvgPaths(el, htmlEl, originX, baseline, paths);
      return;
    }
    if (el.closest('svg')) return;
    const cs = getComputedStyle(el);
    const sides = [
      ['Top', (r, w) => ({ x: r.left, y: r.top, w: r.width, h: w })],
      ['Bottom', (r, w) => ({ x: r.left, y: r.bottom - w, w: r.width, h: w })],
      ['Left', (r, w) => ({ x: r.left, y: r.top, w, h: r.height })],
      ['Right', (r, w) => ({ x: r.right - w, y: r.top, w, h: r.height })],
    ];
    let rect = null;
    sides.forEach(([side, toRule]) => {
      const width = parseFloat(cs[`border${side}Width`]) || 0;
      const style = cs[`border${side}Style`];
      if (width <= 0 || style === 'none' || style === 'hidden') return;
      rect = rect || el.getBoundingClientRect();
      const rule = toRule(rect, width);
      if (rule.w > 0 && rule.h > 0) rules.push({ ...rule, x: rule.x - originX, y: rule.y - baseline });
    });
  });

  return { glyphs, rules, paths, fonts };
}

/**
 * Typesets `tex` (inline style) with KaTeX at a surrounding font size of `fontPx` and returns a
 * replayable layout { width, ascent, descent, glyphs, rules, paths } (coordinates relative to the
 * formula's left edge and baseline), or null when it can't be typeset right now.
 */
export function getCanvasMathLayout(tex, fontPx) {
  const key = `${fontPx}|${tex}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const root = getHost();
  if (!root) return null;

  let html;
  try {
    html = katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: false });
  } catch (e) {
    layoutCache.set(key, null);
    return null;
  }

  const box = document.createElement('span');
  box.style.fontSize = `${fontPx}px`;
  // Zero-size inline-block sitting on the baseline: its top edge marks the baseline.
  box.innerHTML = `<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>${html}`;
  root.appendChild(box);
  let layout = null;
  try {
    const htmlEl = box.querySelector('.katex-html');
    if (htmlEl && !box.querySelector('.katex-error')) {
      const markerRect = box.firstElementChild.getBoundingClientRect();
      const originX = markerRect.left;
      const baseline = markerRect.top;
      const { glyphs, rules, paths, fonts } = measureKatex(htmlEl, originX, baseline);

      const missing = typeof document.fonts?.check === 'function'
        ? [...fonts].filter(([font, text]) => !document.fonts.check(font, text))
        : [];
      if (missing.length) {
        // Measured with fallback metrics: retry once the KaTeX fonts have loaded.
        const loads = missing
          .filter(([font]) => !requestedFonts.has(font))
          .map(([font, text]) => {
            requestedFonts.add(font);
            return document.fonts.load(font, text).catch(() => null);
          });
        if (loads.length) Promise.all(loads).then(scheduleInvalidate);
      } else {
        let ascent = 0;
        let descent = 0;
        // KaTeX's struts carry each base's height/depth (".katex-strut" in newer KaTeX, ".strut" before).
        htmlEl.querySelectorAll('.katex-strut, .strut').forEach((strut) => {
          const r = strut.getBoundingClientRect();
          ascent = Math.max(ascent, baseline - r.top);
          descent = Math.max(descent, r.bottom - baseline);
        });
        const width = htmlEl.getBoundingClientRect().width;
        if (width > 0) layout = { width, ascent, descent, glyphs, rules, paths };
      }
    }
  } catch (e) {
    layout = null;
  } finally {
    box.remove();
  }
  layoutCache.set(key, layout);
  return layout;
}

function getPath2D(d) {
  if (typeof Path2D === 'undefined') return null;
  let path = path2dCache.get(d);
  if (!path) {
    path = new Path2D(d);
    path2dCache.set(d, path);
  }
  return path;
}

/** Draws a formula layout with its left edge at `x` and its baseline at `baselineY`, in the current fill style. */
export function drawCanvasMath(ctx, layout, x, baselineY) {
  if (!layout) return;
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  layout.glyphs.forEach((glyph) => {
    ctx.font = glyph.font;
    ctx.fillText(glyph.text, x + glyph.x, baselineY + glyph.y);
  });
  layout.rules.forEach((rule) => ctx.fillRect(x + rule.x, baselineY + rule.y, rule.w, rule.h));
  layout.paths.forEach((p) => {
    const path = getPath2D(p.d);
    if (!path) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + p.clip.x, baselineY + p.clip.y, p.clip.w, p.clip.h);
    ctx.clip();
    ctx.translate(x + p.tx, baselineY + p.ty);
    ctx.scale(p.sx, p.sy);
    ctx.fill(path);
    ctx.restore();
  });
  ctx.restore();
}
