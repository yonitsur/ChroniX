// Two-way bridge between a saved personal timeline and the Story Studio form.
//
// timelineToStoryAnswers(): reads the CURRENT timeline back into Studio answers, so edits made
//   elsewhere (canvas, event editor, Edit panel, chat) show up when the Studio is re-opened.
//   Nothing stale is stored: only the blueprint, people names and hidden-chapter choices live in
//   timeline.storyStudio; everything else is derived from articles / lanes / timeBands.
//
// applyStoryToTimeline(): merges the edited answers back. The Studio only manages a few fields
//   (title, dates, approximate flag, place, lane, summary line, story text) plus the timeline's
//   overview. Everything else on an event - photos, gallery, category, rank, videos,
//   coordinates of unchanged places - is kept.
//   Rows whose date the Studio cannot read (e.g. BCE) are left untouched rather than deleted.
//
// Pure module (no React / import.meta) so it runs under node --test.

import { parseFuzzyDate, formatFuzzyDate } from '../utils/fuzzyDate.js';
import { dropPlaceLinks } from '../utils/personalEnrichment.js';
import {
  getStoryBlueprint, buildStoryTimeline, resolvePeopleNames, fillTemplate, STORY_OCCASIONS,
} from './storyBlueprints.js';

const AUTO_PREFIX = 'auto-';

/** Text the Studio's date field shows for a stored timeline date. '' when there is none. */
export function timelineDateToText(date, circa, lang = 'en') {
  if (!date || !Number.isInteger(date.year)) return '';
  return formatFuzzyDate({ ...date, circa: Boolean(circa) }, lang);
}

const coarsePrecision = (p) => {
  if (p === 'hour' || p === 'minute') return 'day';
  if (p === 'century' || p === 'millennium') return 'year';
  return p || 'year';
};

/** True when two dates mean the same thing at the Studio's resolution (ignores hour/minute). */
export function sameStoryDate(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.year === b.year
    && (a.month || 0) === (b.month || 0)
    && (a.day || 0) === (b.day || 0)
    && coarsePrecision(a.precision) === coarsePrecision(b.precision);
}

/** Can this personal timeline be opened in the Studio? */
export function canOpenInStoryStudio(timeline) {
  return Boolean(timeline && timeline.isPersonal && Array.isArray(timeline.articles) && timeline.timeScale !== 'prehistoric');
}

/**
 * Rebuild Studio answers from a timeline. Timelines not made in the Studio open as the
 * "Something else" blueprint, with their lanes as custom lanes and every event as a moment.
 */
export function timelineToStoryAnswers(timeline, { lang = 'en' } = {}) {
  const meta = timeline?.storyStudio || {};
  const blueprint = getStoryBlueprint(meta.blueprint) || getStoryBlueprint('custom');
  const articles = timeline?.articles || [];
  const lanes = timeline?.lanes || [];
  const bands = timeline?.timeBands || [];

  const people = {};
  for (const p of blueprint.people) people[p.id] = meta.people?.[p.id] || '';
  const names = resolvePeopleNames(blueprint, { people }, lang);

  // Anchors: the first event tagged with each anchor id.
  const anchors = {};
  const anchorArticleIds = new Set();
  for (const a of blueprint.anchors) {
    const art = articles.find((x) => x.storyAnchor === a.id && !anchorArticleIds.has(String(x.id)));
    if (!art) continue;
    anchorArticleIds.add(String(art.id));
    const templateTitle = fillTemplate(a.eventTitle, names, lang);
    anchors[a.id] = {
      articleId: art.id,
      date: timelineDateToText(art.from, art.circa, lang),
      to: timelineDateToText(art.to, art.circa, lang),
      place: art.locationName || '',
      lane: art.lane && art.lane !== a.lane ? art.lane : '',
      title: art.title && art.title !== templateTitle ? art.title : '',
      note: art.subtitle || '',
      story: art.extract || '',
    };
  }

  const moments = articles
    .filter((art) => !anchorArticleIds.has(String(art.id)))
    .map((art) => ({
      id: String(art.id),
      articleId: art.id,
      title: art.title || '',
      date: timelineDateToText(art.from, art.circa, lang),
      to: timelineDateToText(art.to, art.circa, lang),
      place: art.locationName || '',
      lane: art.lane || lanes[0]?.id || '',
      note: art.subtitle || '',
      story: art.extract || '',
    }));

  const blueprintLaneIds = new Set(blueprint.lanes.map((l) => l.id));
  const laneTitles = {};
  for (const l of blueprint.lanes) {
    const current = lanes.find((x) => x.id === l.id);
    if (current && current.title !== fillTemplate(l.title, names, lang)) laneTitles[l.id] = current.title;
  }
  const extraLanes = blueprint.customLanes ? [] : lanes.filter((l) => !blueprintLaneIds.has(l.id)).map((l) => ({ ...l }));
  const customLanes = blueprint.customLanes ? lanes.map((l) => ({ id: l.id, title: l.title || '' })) : [];

  const chapters = bands
    .filter((b) => !String(b.id || '').startsWith(AUTO_PREFIX))
    .map((b) => ({
      id: String(b.id),
      bandId: b.id,
      title: b.title || '',
      from: timelineDateToText(b.from, false, lang),
      to: timelineDateToText(b.to, false, lang),
    }));

  // An auto chapter is hidden if the user hid it in the Studio, or deleted its band elsewhere.
  const presentBandIds = new Set(bands.map((b) => b.id));
  const hidden = new Set(meta.hiddenAutoChapters || []);
  for (const id of meta.autoWritten || []) if (!presentBandIds.has(id)) hidden.add(id);

  const answers = {
    people,
    anchors,
    moments,
    chapters,
    hiddenAutoChapters: [...hidden],
    customLanes: customLanes.length ? customLanes : (blueprint.customLanes ? [{ id: 'lane-1', title: '' }] : []),
    laneTitles,
    extraLanes,
    title: '',
    overview: timeline?.overview || '',
    ...(meta.aiAssisted ? { aiAssisted: true } : {}),
    ...(STORY_OCCASIONS.includes(meta.occasion) ? { occasion: meta.occasion } : {}),
  };
  const suggested = fillTemplate(blueprint.title, names, lang);
  if ((timeline?.title || '') !== suggested) answers.title = timeline?.title || '';
  return { blueprint, answers };
}

/** Ids of existing items whose Studio row is still present but can't be built (unreadable date / empty title). */
function untouchableIds(blueprint, answers, lang, now) {
  const keepArticles = new Set();
  const keepBands = new Set();
  const unreadable = (text) => Boolean((text || '').trim()) && !parseFuzzyDate(text, { lang, now });
  for (const a of blueprint.anchors) {
    const ans = answers.anchors?.[a.id];
    if (ans?.articleId != null && (unreadable(ans.date) || unreadable(ans.to))) keepArticles.add(String(ans.articleId));
  }
  for (const m of answers.moments || []) {
    if (m.articleId == null) continue;
    const broken = !(m.title || '').trim() || !parseFuzzyDate(m.date, { lang, now }) || unreadable(m.to);
    if (broken) keepArticles.add(String(m.articleId));
  }
  for (const c of answers.chapters || []) {
    if (c.bandId == null) continue;
    const broken = !(c.title || '').trim() || !parseFuzzyDate(c.from, { lang, now }) || !parseFuzzyDate(c.to, { lang, now });
    if (broken) keepBands.add(String(c.bandId));
  }
  return { keepArticles, keepBands };
}

function mergeArticle(existing, built) {
  const next = { ...existing };
  next.title = built.title;
  next.lane = built.lane;
  if (!sameStoryDate(existing.from, built.from)) next.from = built.from;
  if (built.to) {
    if (!sameStoryDate(existing.to, built.to)) next.to = built.to;
  } else if (!existing.isToPresent) {
    delete next.to;
  }
  if (built.isToPresent) next.isToPresent = true;
  // Summary line and story text are edited in the Studio too (read back in timelineToStoryAnswers).
  if ((existing.subtitle || '').trim() !== (built.subtitle || '')) next.subtitle = built.subtitle || '';
  if ((existing.extract || '').trim() !== (built.extract || '')) {
    next.extract = built.extract || '';
    if (built.extract) next.extractIsCustom = true; else delete next.extractIsCustom;
  }
  if (built.circa) next.circa = true; else delete next.circa;
  const oldPlace = (existing.locationName || '').trim();
  const newPlace = (built.locationName || '').trim();
  if (oldPlace !== newPlace) {
    if (newPlace) next.locationName = newPlace; else delete next.locationName;
    // Coordinates belonged to the old place; the caller re-geocodes the new one.
    delete next.lat;
    delete next.lng;
    delete next.googleMapsUrl;
    dropPlaceLinks(next); // the "About <place>" link described the old place too
  }
  return next;
}

/**
 * Merge Studio answers into an existing timeline.
 * Returns { timeline, removedEventIds, changed } - `changed` is false when nothing differs.
 */
export function applyStoryToTimeline(existing, blueprint, answers, { lang = 'en', now = new Date() } = {}) {
  const { timeline: built } = buildStoryTimeline(blueprint, answers, { lang, now, id: existing.id });
  const { keepArticles, keepBands } = untouchableIds(blueprint, answers, lang, now);

  const existingArticles = existing.articles || [];
  const byId = new Map(existingArticles.map((a) => [String(a.id), a]));
  const builtIds = new Set(built.articles.map((a) => String(a.id)));

  const articles = [];
  for (const art of existingArticles) {
    const id = String(art.id);
    if (builtIds.has(id)) continue; // merged below, in Studio order
    if (keepArticles.has(id)) articles.push(art);
  }
  const removedEventIds = existingArticles
    .map((a) => String(a.id))
    .filter((id) => !builtIds.has(id) && !keepArticles.has(id));
  for (const b of built.articles) {
    const prev = byId.get(String(b.id));
    articles.push(prev ? mergeArticle(prev, b) : b);
  }

  const existingLanes = existing.lanes || [];
  const lanes = built.lanes.map((l) => {
    const prev = existingLanes.find((x) => x.id === l.id);
    return prev ? { ...prev, title: l.title } : l;
  });

  const existingBands = existing.timeBands || [];
  const builtBandIds = new Set(built.timeBands.map((b) => String(b.id)));
  const timeBands = [
    ...built.timeBands.map((b) => {
      const prev = existingBands.find((x) => String(x.id) === String(b.id));
      if (!prev) return b;
      return {
        ...prev,
        title: b.title,
        from: sameStoryDate(prev.from, b.from) ? prev.from : b.from,
        to: sameStoryDate(prev.to, b.to) ? prev.to : b.to,
      };
    }),
    ...existingBands.filter((b) => !builtBandIds.has(String(b.id)) && keepBands.has(String(b.id))),
  ];

  const timeline = {
    ...existing,
    title: built.title,
    overview: (existing.overview || '').trim() === built.overview ? existing.overview : built.overview,
    lanes,
    timeBands,
    articles,
    storyStudio: built.storyStudio,
  };
  // AI wrote part of it (photos imported with AI): no longer a hand-authored timeline.
  if (built.storyStudio?.aiAssisted) timeline.isManual = false;
  const changed = JSON.stringify(comparable(timeline)) !== JSON.stringify(comparable(existing));
  return { timeline, removedEventIds, changed };
}

const comparable = (tl) => ({
  title: tl.title,
  occasion: tl.storyStudio?.occasion || '',
  overview: (tl.overview || '').trim(),
  lanes: (tl.lanes || []).map((l) => [l.id, l.title]),
  bands: (tl.timeBands || []).map((b) => [b.id, b.title, b.from, b.to]),
  articles: (tl.articles || [])
    .map((a) => [String(a.id), a.title, a.lane, a.from, a.to, Boolean(a.circa), a.locationName || '', (a.subtitle || '').trim(), (a.extract || '').trim()])
    .sort((x, y) => (x[0] < y[0] ? -1 : 1)),
});

/** Places that need coordinates (new or changed since the last save). */
export function articlesNeedingGeocode(articles) {
  return (articles || []).filter((a) => a.locationName && (a.lat == null || a.lng == null));
}

const clip = (text, max) => String(text || '').trim().slice(0, max);
const dateSortValue = (d) => (d && Number.isInteger(d.year)
  ? d.year + ((d.month || 1) - 1) / 12 + ((d.day || 1) - 1) / 365
  : Number.POSITIVE_INFINITY);

/**
 * The facts the AI overview is written from (see POST /api/story/overview): everything the
 * user entered, in date order, clipped to the server's limits. `kind` is the story type's name.
 */
export function storyOverviewFacts(timeline, { kind = '', people = [], lang = 'en' } = {}) {
  const lanes = timeline?.lanes || [];
  const laneTitle = (id) => lanes.find((l) => l.id === id)?.title || '';
  const moments = (timeline?.articles || [])
    .filter((a) => (a.title || '').trim())
    .slice()
    .sort((a, b) => dateSortValue(a.from) - dateSortValue(b.from))
    .slice(0, 200)
    .map((a) => ({
      title: clip(a.title, 160),
      date: timelineDateToText(a.from, a.circa, lang),
      to: a.isToPresent ? (lang === 'he' ? 'היום' : 'present') : timelineDateToText(a.to, a.circa, lang),
      place: clip(a.locationName, 160),
      lane: lanes.length > 1 ? clip(laneTitle(a.lane), 80) : '',
      note: clip(a.subtitle, 1500),
      story: clip(a.extract, 6000),
    }));
  const chapters = (timeline?.timeBands || [])
    .filter((b) => (b.title || '').trim())
    .slice(0, 40)
    .map((b) => ({ title: clip(b.title, 120), from: timelineDateToText(b.from, false, lang), to: timelineDateToText(b.to, false, lang) }));
  return {
    title: clip(timeline?.title, 160),
    kind: clip(kind, 80),
    people: people.map((p) => clip(p, 60)).filter(Boolean).slice(0, 12),
    lanes: lanes.length > 1 ? lanes.map((l) => clip(l.title, 80)).filter(Boolean).slice(0, 12) : [],
    chapters,
    moments,
  };
}

// ---- Editing an event in the Studio preview's details drawer ----
// The drawer saves a whole article. Fields the Studio form owns go back into the form row (so the
// form stays the single source of truth for them); everything else (photos, category, links,
// picked coordinates...) is kept as per-event "extras" layered on top of the built article.
const STUDIO_OWNED_KEYS = new Set([
  'id', 'title', 'subtitle', 'extract', 'extractIsCustom', 'from', 'to', 'circa', 'lane', 'newLane',
  'locationName', 'storyAnchor', 'provenance', 'isEdited', 'editedAt', 'isToPresent',
]);
const COORD_KEYS = ['lat', 'lng', 'googleMapsUrl'];

/** Which form row built this article: { kind: 'anchor', id } | { kind: 'moment', id } | null. */
export function findStoryRow(blueprint, answers, articleId) {
  const id = String(articleId);
  for (const a of blueprint?.anchors || []) {
    const ans = answers?.anchors?.[a.id];
    if (ans && String(ans.articleId || `ss-${a.id}`) === id) return { kind: 'anchor', id: a.id };
  }
  for (const m of answers?.moments || []) {
    if (String(m.articleId || `ss-m-${m.id}`) === id) return { kind: 'moment', id: m.id };
  }
  return null;
}

/**
 * Apply an article saved in the preview drawer. `built` is the article as the preview showed it.
 * Returns { answers, extras } (extras: the non-Studio fields to keep for this event), or null when
 * the article doesn't come from a form row.
 */
export function applyEventEditToAnswers(blueprint, answers, edited, built, { lang = 'en' } = {}) {
  const row = findStoryRow(blueprint, answers, built?.id ?? edited?.id);
  if (!row || !edited) return null;
  const laneIds = new Set((buildStoryTimeline(blueprint, answers, { lang }).timeline.lanes || []).map((l) => l.id));
  const dateText = (next, prev, prevText) => (sameStoryDate(next, prev) ? prevText : timelineDateToText(next, built?.circa, lang));

  const patchRow = (current, { defaultLane = '', templateTitle = null } = {}) => {
    const next = { ...current };
    const title = (edited.title || '').trim();
    next.title = templateTitle != null && title === templateTitle ? '' : title;
    next.date = dateText(edited.from, built?.from, current.date || '');
    next.to = edited.to ? dateText(edited.to, built?.to, current.to || '') : '';
    next.place = (edited.locationName || '').trim();
    if (edited.lane && laneIds.has(edited.lane)) next.lane = edited.lane === defaultLane ? '' : edited.lane;
    next.note = (edited.subtitle || '').trim();
    next.story = (edited.extract || '').trim();
    return next;
  };

  let nextAnswers;
  if (row.kind === 'anchor') {
    const anchor = blueprint.anchors.find((a) => a.id === row.id);
    const names = resolvePeopleNames(blueprint, answers, lang);
    const patched = patchRow(answers.anchors[row.id] || {}, { defaultLane: anchor.lane, templateTitle: fillTemplate(anchor.eventTitle, names, lang) });
    nextAnswers = { ...answers, anchors: { ...answers.anchors, [row.id]: patched } };
  } else {
    nextAnswers = {
      ...answers,
      moments: answers.moments.map((m) => {
        if (m.id !== row.id) return m;
        const patched = patchRow(m);
        if (!patched.lane) patched.lane = m.lane;
        return patched;
      }),
    };
  }

  const extras = {};
  for (const [key, value] of Object.entries(edited)) {
    if (STUDIO_OWNED_KEYS.has(key) || value === undefined) continue;
    extras[key] = value;
  }
  // Coordinates belong to the place they were picked for (dropped if the place changes later).
  extras.placeForCoords = (edited.locationName || '').trim();
  return { answers: nextAnswers, extras };
}

/** Remove the form row behind an article deleted in the preview drawer. */
export function removeStoryRow(blueprint, answers, articleId) {
  const row = findStoryRow(blueprint, answers, articleId);
  if (!row) return answers;
  if (row.kind === 'anchor') return { ...answers, anchors: { ...answers.anchors, [row.id]: {} } };
  return { ...answers, moments: answers.moments.filter((m) => m.id !== row.id) };
}

/** Layer the drawer extras ({ [articleId]: extras }) onto built articles. */
export function applyEventExtras(articles, extrasById) {
  if (!extrasById || !Object.keys(extrasById).length) return articles;
  return (articles || []).map((a) => {
    const ex = extrasById[String(a.id)];
    if (!ex) return a;
    const { placeForCoords, ...rest } = ex;
    if ((a.locationName || '').trim() !== placeForCoords) {
      for (const k of COORD_KEYS) delete rest[k];
      dropPlaceLinks(rest);
    }
    return { ...a, ...rest };
  });
}
