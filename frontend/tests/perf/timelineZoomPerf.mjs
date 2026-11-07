// Timeline zoom / pan smoothness benchmark.
//
// Drives the real ChroniX canvas (mocked backend) and, as a baseline, a bare HistropediaJS
// page with the same events, through scripted trackpad zoom, mouse-wheel zoom and drag-pan,
// and reports frame pacing, redraw cost and visual-glitch counters.
//
// Usage (dev server must be running: `npm run dev -- --host 127.0.0.1 --port 5179`):
//   node tests/perf/timelineZoomPerf.mjs [--target app|vanilla|both] [--lanes] [--throttle 4]
//                                        [--events 160] [--out results.json] [--profile]
//                                        [--only trackpadZoom|wheelZoom|dragPan] [--software]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { mockBackend } from '../e2e/podcastMocks.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const BASE = arg('base', 'http://127.0.0.1:5179');
const TARGET = arg('target', 'both');
const LANES = Boolean(arg('lanes', false));
const THROTTLE = Number(arg('throttle', 4));
const EVENT_COUNT = Number(arg('events', 160));
const OUT = arg('out', null);
const PROFILE = Boolean(arg('profile', false));
// Chrome trace of the gesture, summarised by rendering phase (style, layout, paint, GPU...).
const TRACE = Boolean(arg('trace', false));
// Diagnostic only: disable one kind of canvas work to see what it costs
// (noshadow | noclip | nogradient | noimage).
const EXPERIMENT = arg('experiment', null);
const ONLY = arg('only', null);
// Force the engine's density on the app (e.g. to benchmark an older build without the setting).
const FORCE_DENSITY = arg('force-density', null);
// Real GPU rasterization by default (closer to a user's browser); --software for SwiftShader.
const SOFTWARE = Boolean(arg('software', false));
const GPU_ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

// Aggregates a V8 CPU profile by function: self time and inclusive time (ms).
function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000);
  }
  const label = (n) => {
    const f = n.callFrame;
    const file = (f.url || '').split('/').pop().split('?')[0];
    return `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}`;
  };
  const selfBy = new Map();
  const inclBy = new Map();
  const visit = (node, stack) => {
    const key = label(node);
    const own = self.get(node.id) || 0;
    selfBy.set(key, (selfBy.get(key) || 0) + own);
    let total = own;
    const nextStack = new Set(stack).add(key);
    for (const c of node.children || []) total += visit(byId.get(c), nextStack);
    if (!stack.has(key)) inclBy.set(key, (inclBy.get(key) || 0) + total); // no double count on recursion
    return total;
  };
  const root = profile.nodes[0];
  visit(root, new Set());
  const top = (m, n) => [...m.entries()].filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(1)]);
  return { self: top(selfBy, 25), inclusive: top(inclBy, 40), gc: +(selfBy.get('(garbage collector) :0') || 0).toFixed(1) };
}

// ---------------------------------------------------------------------------------------
// Deterministic dataset: clustered dates (like real AI-built timelines), ranks 1-10,
// ~65% with images, realistic title / subtitle lengths.
function makeDataset(count, withLanes) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const clusters = [[1450, 1520], [1600, 1650], [1760, 1800], [1840, 1870], [1900, 1950], [1955, 1975], [1985, 2005]];
  const words = 'empire treaty revolution discovery voyage charter reform council expedition dynasty uprising alliance invention republic crusade'.split(' ');
  const lanes = withLanes ? [{ id: 'lane-pol', title: 'Politics' }, { id: 'lane-sci', title: 'Science' }, { id: 'lane-art', title: 'Culture' }] : [];
  const articles = Array.from({ length: count }, (_, i) => {
    const [a, b] = clusters[Math.floor(rnd() * clusters.length)];
    const year = Math.floor(a + rnd() * (b - a));
    const titleWords = 2 + Math.floor(rnd() * 7);
    const title = Array.from({ length: titleWords }, () => words[Math.floor(rnd() * words.length)]).join(' ');
    const subtitle = Array.from({ length: 18 + Math.floor(rnd() * 30) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
    return {
      id: `evt-${i + 1}`,
      title: title[0].toUpperCase() + title.slice(1),
      subtitle,
      from: { year, month: 1 + Math.floor(rnd() * 12), day: 1 + Math.floor(rnd() * 27), precision: 'day' },
      rank: 1 + Math.floor(rnd() * 10),
      ...(rnd() < 0.65 ? { imageUrl: `https://upload.wikimedia.org/wikipedia/commons/perf/img-${i % 24}.jpg` } : {}),
      ...(withLanes ? { lane: lanes[i % 3].id } : {}),
    };
  });
  return { lanes, articles };
}

// ---------------------------------------------------------------------------------------
// In-page instrumentation: wraps the timeline's redraw entry points and samples every
// article each animation frame.
function installInstrumentation() {
  const tl = window.__timeline;
  const now = () => performance.now();
  const P = {
    frames: [], redraws: [], kinds: { default: 0, reposition: 0, plain: 0 },
    layoutFlips: 0, visToggles: 0, fadeReversals: 0, pops: 0, jumps: 0, maxJump: 0, orderChurn: 0,
    jumpCauses: {}, jumpKinds: {}, planChanges: {}, planDeltas: {},
    longTasks: [], reactStart: window.__reactCommits || 0, zoomStart: tl.getZoom?.() ?? tl.timescaleManager?.zoom,
    running: true,
  };
  window.__perf = P;

  let kind = null;
  for (const [name, k] of [['defaultRedraw', 'default'], ['repositionRedraw', 'reposition']]) {
    const orig = tl[name];
    tl[name] = function (...a) {
      const prev = kind;
      if (!kind) kind = k;
      try { return orig.apply(this, a); } finally { kind = prev; }
    };
  }
  // Card re-targets: every time a card is sent towards a new vertical offset, and how often
  // that new target reverses the direction of the previous one (cards hesitating /
  // bouncing between rows while the user zooms).
  P.retargets = 0;
  P.retargetReversals = 0;
  const proto = Object.getPrototypeOf(tl.articles[0]);
  if (!proto.__perfOrigMove) proto.__perfOrigMove = proto.moveToOffsetWithAnim;
  proto.moveToOffsetWithAnim = function (destination, ...rest) {
    const perf = window.__perf;
    if (perf?.running) {
      const prevTarget = this.moveAnimation?.finalOffset?.top ?? this.finalOffset?.top;
      if (Number.isFinite(prevTarget) && destination.top !== prevTarget) {
        perf.retargets += 1;
        if (this.row === this.__perfLastRow) perf.sameRowRetargets = (perf.sameRowRetargets || 0) + 1;
        // Target is not the plain stacked row offset -> it was rewritten by a clamp.
        const spacing = this.owner?.options?.article?.autoStacking?.rowSpacing;
        if (Number.isFinite(spacing) && Number.isFinite(this.row) && Math.abs(destination.top + this.row * spacing) > 0.5) {
          perf.clampRetargets = (perf.clampRetargets || 0) + 1;
        }
        this.__perfLastRow = this.row;
        const dir = Math.sign(destination.top - prevTarget);
        if (this.__perfLastDir && dir && dir !== this.__perfLastDir && this.isMoving) perf.retargetReversals += 1;
        this.__perfLastDir = dir;
      }
    }
    return proto.__perfOrigMove.call(this, destination, ...rest);
  };

  const origRedraw = tl.redraw;
  tl.redraw = function (...a) {
    if (this.redrawInProgress || !P.running) return origRedraw.apply(this, a);
    const t0 = now();
    const k = kind || 'plain';
    try { return origRedraw.apply(this, a); } finally {
      P.redraws.push(now() - t0);
      P.kinds[k] += 1;
    }
  };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (P.running) P.longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  } catch (e) { /* unsupported */ }

  let prev = new Map();
  let prevOrder = '';
  let last = null;
  const sample = (ts) => {
    if (!P.running) return;
    if (last != null) P.frames.push(ts - last);
    last = ts;
    // ChroniX slot plan (single timeline): how much the planned distance from the axis
    // and the row spacing change from one frame to the next.
    const plan = tl._chronixTimelinePlan;
    if (plan) {
      const spacing = tl.options?.article?.autoStacking?.rowSpacing;
      const cur = { distance: plan.distance, spacing };
      if (P.lastPlan) {
        for (const key of ['distance', 'spacing']) {
          const d = Math.abs((cur[key] ?? 0) - (P.lastPlan[key] ?? 0));
          if (d > 0) {
            P.planChanges[key] = (P.planChanges[key] || 0) + 1;
            const bucket = d < 4 ? '<4' : d < 10 ? '4-10' : d < 25 ? '10-25' : '25+';
            P.planDeltas[`${key}:${bucket}`] = (P.planDeltas[`${key}:${bucket}`] || 0) + 1;
          }
        }
      }
      P.lastPlan = cur;
    }
    const next = new Map();
    const visibleIds = [];
    for (const art of tl.articles || []) {
      if (!art) continue;
      const s = {
        vis: Boolean(art.isVisible),
        op: typeof art.opacity === 'number' ? art.opacity : 1,
        after: Boolean(art.isVisibleAfterFade),
        fading: Boolean(art.isFading),
        layout: art._resolvedCardLayoutName || art.cardLayout || null,
        top: art.position?.top,
        reg: art.registeredPosition?.top,
        off: art.offset?.top,
        row: art.row,
        h: art._cachedHeight,
      };
      next.set(art.id, s);
      const shown = s.vis && s.op > 0.02;
      if (shown) visibleIds.push(art.id);
      const p = prev.get(art.id);
      if (!p) continue;
      const wasShown = p.vis && p.op > 0.02;
      if (p.after !== s.after) {
        P.visToggles += 1;
        if (p.fading) P.fadeReversals += 1;
      }
      // Hard appearance / disappearance: fully opaque <-> invisible in a single frame.
      if ((!wasShown && shown && s.op > 0.9) || (wasShown && p.op > 0.9 && !shown)) P.pops += 1;
      if (shown && wasShown && p.layout && s.layout && p.layout !== s.layout) P.layoutFlips += 1;
      // A visible card changing size (e.g. image released while hidden, re-decoded on show).
      if (shown && wasShown && Number.isFinite(p.h) && Number.isFinite(s.h) && Math.abs(p.h - s.h) > 8) P.sizeJumps = (P.sizeJumps || 0) + 1;
      if (shown && wasShown && Number.isFinite(p.top) && Number.isFinite(s.top)) {
        const d = Math.abs(s.top - p.top);
        if (d > 30) {
          P.jumps += 1;
          // Where did the jump come from? Base slot position (distance to the axis),
          // the row offset, or neither (a hard clamp / direct position write).
          const dReg = (s.reg ?? 0) - (p.reg ?? 0);
          const dOff = (s.off ?? 0) - (p.off ?? 0);
          const cause = Math.abs(dReg) > 20 ? 'base' : Math.abs(dOff) > 20 ? 'offset' : 'direct';
          P.jumpCauses[cause] = (P.jumpCauses[cause] || 0) + 1;
          const key = `${cause}:${p.layout}->${s.layout}:row${p.row}->${s.row}`;
          P.jumpKinds[key] = (P.jumpKinds[key] || 0) + 1;
        }
        P.maxJump = Math.max(P.maxJump, d);
      }
    }
    // Same set of cards drawn in a different stacking order = cards swapping on top.
    const membership = [...visibleIds].sort().join('|');
    const order = visibleIds.join('|');
    if (prevOrder && prevOrder.membership === membership && prevOrder.order !== order) P.orderChurn += 1;
    prevOrder = { membership, order };
    prev = next;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

function collectInstrumentation() {
  const P = window.__perf;
  P.running = false;
  const tl = window.__timeline;
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const wall = sum(P.frames);
  return {
    wallMs: Math.round(wall),
    frames: P.frames.length,
    fps: P.frames.length ? +(1000 * P.frames.length / wall).toFixed(1) : 0,
    frameP50: +q(P.frames, 0.5).toFixed(1),
    frameP95: +q(P.frames, 0.95).toFixed(1),
    frameMax: +Math.max(0, ...P.frames).toFixed(1),
    slowFrames: P.frames.filter((f) => f > 25).length,
    veryslowFrames: P.frames.filter((f) => f > 50).length,
    redraws: P.redraws.length,
    redrawKinds: P.kinds,
    redrawMean: +(sum(P.redraws) / Math.max(1, P.redraws.length)).toFixed(2),
    redrawP95: +q(P.redraws, 0.95).toFixed(2),
    redrawMax: +Math.max(0, ...P.redraws).toFixed(2),
    redrawShare: wall ? +(sum(P.redraws) / wall).toFixed(3) : 0,
    longTasks: P.longTasks.length,
    longTaskMs: Math.round(sum(P.longTasks)),
    reactCommits: (window.__reactCommits || 0) - P.reactStart,
    visToggles: P.visToggles,
    fadeReversals: P.fadeReversals,
    pops: P.pops,
    layoutFlips: P.layoutFlips,
    jumps: P.jumps,
    jumpCauses: P.jumpCauses,
    planChanges: P.planChanges,
    planDeltas: P.planDeltas,
    jumpKinds: Object.fromEntries(Object.entries(P.jumpKinds).sort((a, b) => b[1] - a[1]).slice(0, 6)),
    maxJump: Math.round(P.maxJump),
    orderChurn: P.orderChurn,
    retargets: P.retargets,
    reversals: P.retargetReversals,
    sameRow: P.sameRowRetargets || 0,
    clamped: P.clampRetargets || 0,
    sizeJumps: P.sizeJumps || 0,
    zoomFrom: +(+P.zoomStart).toFixed(2),
    zoomTo: +(+(tl.getZoom?.() ?? tl.timescaleManager?.zoom)).toFixed(2),
  };
}

// ---------------------------------------------------------------------------------------
const SCENARIOS = {
  // Trackpad / precision wheel: many small pixel deltas -> engine zooms synchronously
  // with a full defaultRedraw per event.
  async trackpadZoom(page, cx, cy) {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 45; i++) { await page.mouse.wheel(0, -6); await page.waitForTimeout(16); }
    await page.waitForTimeout(300);
    for (let i = 0; i < 45; i++) { await page.mouse.wheel(0, 6); await page.waitForTimeout(16); }
  },
  // Classic mouse wheel: 100px notches -> engine animates the zoom (repositionRedraw per
  // frame) and restacks once it settles.
  async wheelZoom(page, cx, cy) {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(140); }
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(140); }
  },
  async dragPan(page, cx, cy) {
    await page.mouse.move(cx, cy - 250);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(cx - i * 18, cy - 250); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(cx - 540 + i * 18, cy - 250); await page.waitForTimeout(16); }
    await page.mouse.up();
  },
};

const SETTLE_MS = 1800; // engine fades last 1.5s; include them in the measurement

async function prepareApp(page, dataset) {
  const id = 'tl-perf';
  await mockBackend(page, { timelineId: id, isOwner: false, episodes: [] });
  await page.route(`**/api/timelines/${id}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id, title: 'Perf timeline', description: '', detectedLanguage: 'en', timeScale: 'calendar',
      isOwner: false, isShared: true, lanes: dataset.lanes, timeBands: [], articles: dataset.articles,
    }),
  }));
  await page.goto(`${BASE}/t/${id}`);
  await page.waitForFunction(() => window.__timeline?.articles?.length > 0, null, { timeout: 30000 });
}

async function prepareVanilla(page, dataset) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  await page.addInitScript((data) => { window.__perfData = data; }, { ...dataset, density: 'high' });
  await page.goto(`${BASE}/tests/perf/vanilla.html`);
  await page.waitForFunction(() => window.__timeline?.articles?.length > 0, null, { timeout: 30000 });
}

async function makeJpeg(browser) {
  const p = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await p.setContent('<div style="width:400px;height:300px;background:linear-gradient(135deg,#3b82f6,#f59e0b)"></div>');
  const buf = await p.screenshot({ type: 'jpeg', quality: 80 });
  await p.close();
  return buf;
}

// Totals the duration of the renderer's main-thread work per event name.
function summarizeTrace(trace) {
  const events = trace.traceEvents || trace;
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args?.name);
  const totals = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const thread = threads.get(`${e.pid}:${e.tid}`) || '';
    if (!/CrRendererMain|CrGpuMain|VizCompositor|Compositor/.test(thread)) continue;
    const key = `${thread.replace(/Thread$/, '')}:${e.name}`;
    totals.set(key, (totals.get(key) || 0) + e.dur / 1000);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => [k, +v.toFixed(1)]);
}

async function runTarget(browser, target, dataset, jpeg) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Minimal React DevTools hook so we can count React commits (re-renders) during gestures.
  await page.addInitScript(() => {
    window.__reactCommits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      isDisabled: false, supportsFiber: true, renderers: new Map(),
      inject() { return 1; }, checkDCE() {},
      onCommitFiberRoot() { window.__reactCommits += 1; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    };
  });
  if (EXPERIMENT) {
    await page.addInitScript((kind) => {
      const proto = CanvasRenderingContext2D.prototype;
      if (kind === 'noshadow') {
        const d = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
        Object.defineProperty(proto, 'shadowBlur', { configurable: true, get: d.get, set() { d.set.call(this, 0); } });
        const c = Object.getOwnPropertyDescriptor(proto, 'shadowColor');
        Object.defineProperty(proto, 'shadowColor', { configurable: true, get: c.get, set() { c.set.call(this, 'rgba(0,0,0,0)'); } });
      }
      if (kind === 'noclip') proto.clip = function () {};
      if (kind === 'nogradient') {
        // Same colour stops, but as a cheap 2-point linear gradient.
        const linear = proto.createLinearGradient;
        proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { return linear.call(this, x1, y1 - r1, x1, y1 + r1); };
      }
      if (kind === 'noimage') proto.drawImage = function () {};
    }, EXPERIMENT);
  }
  if (target === 'app') await prepareApp(page, dataset); else await prepareVanilla(page, dataset);
  // Images: registered last so it takes precedence over the "abort external" route.
  await page.route('https://upload.wikimedia.org/**', (route) => route.fulfill({
    status: 200, contentType: 'image/jpeg', body: jpeg, headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' },
  }));
  if (FORCE_DENSITY && target === 'app') {
    await page.evaluate((density) => { window.__timeline.setOption({ article: { density } }); window.__timeline.defaultRedraw(); }, FORCE_DENSITY);
  }
  await page.waitForTimeout(2500); // initial fit, image decode, first fades

  const cdp = await context.newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const box = await page.locator('#histropedia-container canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const results = {};
  for (const [name, run] of Object.entries(SCENARIOS)) {
    if (ONLY && ONLY !== name) continue;
    await page.evaluate(installInstrumentation);
    if (PROFILE) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    if (TRACE) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu'] });
    const t0 = Date.now();
    await run(page, cx, cy);
    await page.waitForTimeout(SETTLE_MS);
    results[name] = { ...(await page.evaluate(collectInstrumentation)), scriptMs: Date.now() - t0 };
    if (TRACE) results[name].trace = summarizeTrace(JSON.parse((await browser.stopTracing()).toString()));
    if (PROFILE) {
      const { profile } = await cdp.send('Profiler.stop');
      results[name].profile = summarizeProfile(profile);
    }
    await page.waitForTimeout(400);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  results.errors = errors.slice(0, 5);
  await context.close();
  return results;
}

const dataset = makeDataset(EVENT_COUNT, LANES);
const browser = await chromium.launch({ headless: true, args: SOFTWARE ? [] : GPU_ARGS });
const jpeg = await makeJpeg(browser);
const all = {};
for (const target of TARGET === 'both' ? ['vanilla', 'app'] : [TARGET]) {
  all[target] = await runTarget(browser, target, dataset, jpeg);
}
await browser.close();

const cols = ['fps', 'frameP95', 'frameMax', 'slowFrames', 'redraws', 'redrawMean', 'redrawP95', 'redrawShare', 'longTaskMs', 'reactCommits', 'visToggles', 'fadeReversals', 'pops', 'layoutFlips', 'sizeJumps', 'jumps', 'orderChurn', 'retargets', 'sameRow', 'clamped', 'reversals'];
console.log(`\nevents=${EVENT_COUNT} lanes=${LANES} cpuThrottle=${THROTTLE}x`);
for (const scenario of Object.keys(SCENARIOS)) {
  if (ONLY && ONLY !== scenario) continue;
  console.log(`\n== ${scenario}`);
  console.log(['target'.padEnd(8), ...cols.map((c) => c.padStart(Math.max(7, c.length)))].join(' '));
  for (const [target, res] of Object.entries(all)) {
    const r = res[scenario];
    console.log([target.padEnd(8), ...cols.map((c) => String(r[c]).padStart(Math.max(7, c.length)))].join(' '));
  }
  for (const [target, res] of Object.entries(all)) {
    const r = res[scenario];
    console.log(`   ${target} redraw kinds: ${JSON.stringify(r.redrawKinds)}`);
    if (r.jumps) console.log(`   ${target} jump causes: ${JSON.stringify(r.jumpCauses)} ${JSON.stringify(r.jumpKinds)}`);
    if (r.planChanges && Object.keys(r.planChanges).length) console.log(`   ${target} plan changes (frames): ${JSON.stringify(r.planChanges)} deltas: ${JSON.stringify(r.planDeltas)}`);
    if (r.trace) {
      console.log(`   ${target} trace (ms by thread:event):`);
      for (const [k, v] of r.trace) console.log(`      ${String(v).padStart(8)}  ${k}`);
    }
    if (r.profile) {
      console.log(`   ${target} profile (gc ${r.profile.gc}ms) inclusive ms:`);
      for (const [k, v] of r.profile.inclusive) console.log(`      ${String(v).padStart(8)}  ${k}`);
      console.log(`   ${target} profile self ms:`);
      for (const [k, v] of r.profile.self) console.log(`      ${String(v).padStart(8)}  ${k}`);
    }
  }
}
for (const [target, res] of Object.entries(all)) if (res.errors.length) console.log(`\n${target} page errors:`, res.errors);
if (OUT) writeFileSync(OUT, JSON.stringify({ events: EVENT_COUNT, lanes: LANES, throttle: THROTTLE, results: all }, null, 2));
