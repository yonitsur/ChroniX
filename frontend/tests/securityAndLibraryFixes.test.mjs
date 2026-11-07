import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { en } from '../src/locales/en.js';
import { he } from '../src/locales/he.js';
import {
  sanitizeHttpUrl,
  escapeCsvCell,
  stripTransientTimelineFields,
  generateTimelineMarkdown,
} from '../src/utils/timelineExport.js';
import {
  mergeTimelines,
  extractSourceTimelines,
  applyHiddenLayersToTimeline,
} from '../src/utils/mergeTimelines.js';

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

test('EN and HE locale trees have 100% key parity and cover all static t(...) calls in src/', () => {
  const enKeys = new Set(flattenKeys(en));
  const heKeys = new Set(flattenKeys(he));

  const missingInHe = [...enKeys].filter((k) => !heKeys.has(k));
  const missingInEn = [...heKeys].filter((k) => !enKeys.has(k));

  assert.deepEqual(missingInHe, []);
  assert.deepEqual(missingInEn, []);

  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const callRe = /\bt\(\s*(['"])([a-zA-Z0-9_.]+)\1/g;
  const missingCalls = [];
  for (const file of collectJsFiles(srcDir)) {
    const src = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = callRe.exec(src)) !== null) {
      const key = match[2];
      if (!key.includes('.')) continue;
      if (getByPath(en, key) === undefined) {
        missingCalls.push(`EN:${path.basename(file)}:${key}`);
      }
      if (getByPath(he, key) === undefined) {
        missingCalls.push(`HE:${path.basename(file)}:${key}`);
      }
    }
  }
  assert.deepEqual(missingCalls, []);
});

test('no frontend module shadows JS built-in constructors (Map, Set, Image, Audio, Date, URL) with unaliased imports', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const builtins = ['Map', 'Set', 'Image', 'Audio', 'Date', 'URL', 'Error', 'File', 'Blob'];
  const collisions = [];
  for (const file of collectJsFiles(srcDir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const b of builtins) {
      const importRe = new RegExp(`import\\s*\\{[^}]*\\b${b}\\b(?!\\s+as\\b)[^}]*\\}`, 'm');
      const useRe = new RegExp(`\\bnew\\s+${b}\\b|\\b${b}\\.(from|createObjectURL|revokeObjectURL|now|parse|UTC)\\b`);
      if (importRe.test(src) && useRe.test(src)) {
        collisions.push(`${path.basename(file)}:${b}`);
      }
    }
  }
  assert.deepEqual(collisions, []);
});

test('sanitizeHttpUrl blocks javascript:/data: XSS schemes and allows http(s)', () => {
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeHttpUrl('  JaVaScRiPt:fetch("//evil") '), '');
  assert.equal(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeHttpUrl('https://en.wikipedia.org/wiki/Apollo_11'), 'https://en.wikipedia.org/wiki/Apollo_11');

  const md = generateTimelineMarkdown({
    title: 'XSS Test',
    articles: [
      {
        id: 'a1',
        title: 'Event 1',
        from: { year: 1969 },
        wikiUrl: 'javascript:alert(document.cookie)',
      },
      {
        id: 'a2',
        title: 'Event 2',
        from: { year: 1970 },
        wikiUrl: 'https://en.wikipedia.org/wiki/Apollo_11',
      },
    ],
  });
  assert.ok(!md.includes('javascript:'));
  assert.ok(md.includes('https://en.wikipedia.org/wiki/Apollo_11'));
});

test('escapeCsvCell neutralizes spreadsheet formula injection while preserving negative years', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("http://evil","Click")'), '"\'=HYPERLINK(""http://evil"",""Click"")"');
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(escapeCsvCell('@cmd'), '"\'@cmd"');
  assert.equal(escapeCsvCell('-cmd'), '"\'-cmd"');
  // Negative historical years (e.g. -44 BCE) remain unprefixed numeric strings inside CSV quotes
  assert.equal(escapeCsvCell(-44), '"-44"');
  assert.equal(escapeCsvCell('-44'), '"-44"');
});

test('stripTransientTimelineFields cleans internal merge/ownership flags on export', () => {
  const dirty = {
    id: 'tl-1',
    title: 'Clean Me',
    _unsavedMerged: true,
    isOwner: true,
    isShared: true,
    ownerId: 'secret-user-id',
    articles: [
      {
        id: 'a-1',
        title: 'Art',
        from: { year: 2020 },
        _origCategory: 'Cat',
        _origSubLaneId: 'l1',
        _origSubLaneTitle: 'Lane 1',
      },
    ],
  };
  const clean = stripTransientTimelineFields(dirty);
  assert.equal(clean._unsavedMerged, undefined);
  assert.equal(clean.isOwner, undefined);
  assert.equal(clean.isShared, undefined);
  assert.equal(clean.ownerId, undefined);
  assert.equal(clean.articles[0]._origCategory, undefined);
  assert.equal(clean.articles[0]._origSubLaneId, undefined);
  assert.equal(clean.articles[0].title, 'Art');
});

test('mergeTimelines sanitizes IDs and extractSourceTimelines preserves flags + AI-added events', () => {
  const tl1 = {
    id: 'src-1<"unsafe">',
    title: 'Personal Layer',
    isPersonal: true,
    isFictional: false,
    contentMode: 'kids',
    lanes: [{ id: 'lane-a<"x">', title: 'Childhood', order: 0 }],
    articles: [
      { id: 'ev-1<"bad">', title: 'Born', lane: 'lane-a<"x">', from: { year: 1995 } },
    ],
  };
  const tl2 = {
    id: 'src-2',
    title: 'Fictional World',
    isPersonal: false,
    isFictional: true,
    contentMode: 'classic',
    lanes: [{ id: 'lane-b', title: 'Lore', order: 0 }],
    articles: [
      { id: 'ev-2', title: 'Dragon Awakes', lane: 'lane-b', from: { year: 1998 } },
    ],
  };

  const merged = mergeTimelines([tl1, tl2], { expandSubLanes: true });
  assert.equal(merged.isPersonal, true);
  assert.equal(merged.isFictional, true);
  assert.equal(merged.contentMode, 'kids');

  // Every generated ID respects SafeIdStr (<= 128 chars, no < > " ' `)
  for (const lane of merged.lanes) {
    assert.ok(lane.id.length <= 128);
    assert.ok(!/[<>"'`]/.test(lane.id));
  }
  for (const art of merged.articles) {
    assert.ok(art.id.length <= 128);
    assert.ok(!/[<>"'`]/.test(art.id));
  }

  // Simulate an AI chat or manual event added directly onto the merged timeline
  merged.articles.push({
    id: 'chat-added-event',
    title: 'AI Added Milestone',
    lane: 'custom-lane',
    from: { year: 2001 },
  });

  const extracted = extractSourceTimelines(merged);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].isPersonal, true);
  assert.equal(extracted[1].isFictional, true);
  // The AI-added event is preserved in primary layer instead of being dropped!
  assert.ok(extracted[0].articles.some((a) => a.title === 'AI Added Milestone'));

  // Hiding the first layer hides its lanes and articles cleanly
  const hiddenSet = new Set(merged.mergedSources[0].laneIds);
  const visible = applyHiddenLayersToTimeline(merged, hiddenSet);
  assert.equal(visible.articles.some((a) => a.title === 'Born'), false);
  assert.equal(visible.articles.some((a) => a.title === 'Dragon Awakes'), true);
});

test('Public Library removes Newest sort, wires Admin Featured reordering, and wraps category capsules in HorizontalCapsuleScroller', () => {
  assert.equal(en.library.sortNewest, undefined);
  assert.equal(he.library.sortNewest, undefined);
  assert.equal(typeof en.library.reorderBtn, 'string');
  assert.equal(typeof he.library.reorderBtn, 'string');

  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const modalLibSrc = fs.readFileSync(path.join(srcDir, 'components/ExploreLibraryModal.jsx'), 'utf8');
  const scrollerSrc = fs.readFileSync(path.join(srcDir, 'components/HorizontalCapsuleScroller.jsx'), 'utf8');

  assert.ok(!homeLibSrc.includes("id: 'newest'"));
  assert.ok(!homeLibSrc.includes('library.sortNewest'));
  assert.ok(homeLibSrc.includes('reorderPublicLibrary'));
  assert.ok(homeLibSrc.includes('<HorizontalCapsuleScroller'));
  assert.ok(modalLibSrc.includes('<HorizontalCapsuleScroller'));
  assert.ok(scrollerSrc.includes('ChevronLeft') && scrollerSrc.includes('ChevronRight'));
});

test('Home Public Library mounts its shell immediately with skeleton cards while loading', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');
  const publicPagesCss = fs.readFileSync(path.join(srcDir, 'styles/publicPages.css'), 'utf8');

  assert.ok(homeLibSrc.includes('function LibraryCardSkeleton'));
  assert.ok(homeLibSrc.includes('const isInitialLoading = !loaded;'));
  assert.ok(homeLibSrc.includes('const isSectionVisible = isInitialLoading || safePool.length > 0;'));
  assert.ok(homeLibSrc.includes('aria-busy={isInitialLoading}'));
  assert.ok(appSrc.includes('const [hasHomeLibraryItems, setHasHomeLibraryItems] = useState(true);'));
  assert.ok(publicPagesCss.includes('.home-library-skeleton'));
});

test('Public Library cover images sit on a white background in both light and dark modes for transparent assets', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const modalLibSrc = fs.readFileSync(path.join(srcDir, 'components/ExploreLibraryModal.jsx'), 'utf8');

  assert.ok(homeLibSrc.includes("activeSrc ? 'bg-white' : 'bg-surface-sunken'"));
  assert.ok(homeLibSrc.includes('w-full h-full object-cover bg-white select-none pointer-events-none'));
  assert.ok(modalLibSrc.includes('relative aspect-[16/10] w-full bg-white overflow-hidden shrink-0'));
  assert.ok(modalLibSrc.includes('w-full h-full object-cover bg-white group-hover:scale-105'));
});

test('Public Library fixes search spinner bobbing, scrolls overflowing titles on hover/mobile first-tap, and removes redundant Open Instantly label', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const modalLibSrc = fs.readFileSync(path.join(srcDir, 'components/ExploreLibraryModal.jsx'), 'utf8');
  const indexCss = fs.readFileSync(path.join(srcDir, 'index.css'), 'utf8');

  // 1. Search spinner never combines animate-spin with -translate-y-1/2 on the same element
  assert.ok(!homeLibSrc.includes('animate-spin absolute top-1/2 -translate-y-1/2'));
  assert.ok(homeLibSrc.includes('absolute inset-y-0 end-3 flex items-center pointer-events-none'));

  // 2. Overflowing titles glide on hover (.group:hover) and mobile first tap (.group.is-armed)
  assert.ok(homeLibSrc.includes('function LibraryCardTitle'));
  assert.ok(homeLibSrc.includes("armedId === item.id ? 'is-armed ' : ''"));
  assert.ok(modalLibSrc.includes('function ModalLibraryCardTitle'));
  assert.ok(modalLibSrc.includes("armedId === item.id ? 'is-armed ' : ''"));
  assert.ok(indexCss.includes('.group:hover .library-card-title-inner.has-overflow'));
  assert.ok(indexCss.includes('.group.is-armed .library-card-title-inner.has-overflow'));

  // 3. Redundant "Open Instantly" label removed from card footers
  assert.ok(!homeLibSrc.includes("t('library.openBtn')"));
  assert.ok(!modalLibSrc.includes("t('library.openNow')"));
});

test('Returning to Home resets document.title even when useSystemBackNavigation pops its history guard', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');
  const backHookSrc = fs.readFileSync(path.join(srcDir, 'hooks/useSystemBackNavigation.js'), 'utf8');

  // useSystemBackNavigation forces a non-no-op title update across history.back() when disarming the guard
  assert.ok(backHookSrc.includes('const forceDocumentTitleSync = (title) =>'));
  assert.ok(backHookSrc.includes('window.history.back();'));
  assert.ok(backHookSrc.includes('forceDocumentTitleSync(restoreTitle);'));

  // App.jsx declares the document.title effect AFTER useSystemBackNavigation so pushState runs before title mutation
  const backNavIdx = appSrc.indexOf('useSystemBackNavigation(Boolean(currentTimeline)');
  const titleEffectIdx = appSrc.indexOf('applyDocumentTitle(computeAppTitle(currentTimeline, publicRoute))');
  assert.ok(backNavIdx > 0 && titleEffectIdx > backNavIdx);

  // App.jsx popstate handler resets document.title to DEFAULT_APP_TITLE whenever on Home
  assert.ok(appSrc.includes('!currentTimelineRefForUrl.current &&'));
  assert.ok(appSrc.includes('!publicRouteRefForUrl.current'));
  assert.ok(appSrc.includes('applyDocumentTitle(DEFAULT_APP_TITLE);'));
});

test('Personal Library Demos expose dedicated category, badges, overview CTA, and sub-lane expansion guardrails', () => {
  assert.equal(typeof en.library.categories.personal, 'string');
  assert.equal(typeof he.library.categories.personal, 'string');
  assert.equal(typeof en.library.personalDemoBadge, 'string');
  assert.equal(typeof he.library.personalDemoBadge, 'string');
  assert.equal(typeof en.overview.personalDemoCtaBtn, 'string');
  assert.equal(typeof he.overview.personalDemoCtaBtn, 'string');

  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const modalLibSrc = fs.readFileSync(path.join(srcDir, 'components/ExploreLibraryModal.jsx'), 'utf8');
  const badgesSrc = fs.readFileSync(path.join(srcDir, 'components/TimelineModeBadges.jsx'), 'utf8');
  const overviewSrc = fs.readFileSync(path.join(srcDir, 'components/TimelineOverviewPanel.jsx'), 'utf8');
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8');

  assert.ok(homeLibSrc.includes("'personal'"));
  assert.ok(homeLibSrc.includes('onOpenBuildPersonal'));
  assert.ok(modalLibSrc.includes("'personal'"));
  assert.ok(badgesSrc.includes('isPersonalDemo'));
  assert.ok(badgesSrc.includes('mergedLayerCount'));
  assert.ok(overviewSrc.includes('onBuildPersonalTimeline'));
  assert.ok(appSrc.includes('preserveCuratedLibraryMeta'));
  assert.ok(appSrc.includes("t('library.buildYourOwnCta')"));
});

test('Public Library uses two-stage progressive loading and eager cover loading for the first row', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const homeLibSrc = fs.readFileSync(path.join(srcDir, 'components/HomeLibrarySection.jsx'), 'utf8');
  const modalLibSrc = fs.readFileSync(path.join(srcDir, 'components/ExploreLibraryModal.jsx'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(srcDir, 'api.js'), 'utf8');

  assert.ok(apiSrc.includes('getCachedPublicLibraryItems'));
  assert.ok(apiSrc.includes('setCachedPublicLibraryItems'));
  assert.ok(homeLibSrc.includes('limit: INITIAL_PAGE_SIZE'));
  assert.ok(homeLibSrc.includes('setIsLoadingRest(true)'));
  assert.ok(homeLibSrc.includes('eagerLoad={cardIdx < 3}'));
  assert.ok(modalLibSrc.includes('getCachedPublicLibraryItems'));
});

