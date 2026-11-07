// Wikipedia enrichment of personal timelines, client side (Story Studio templates, photo imports and
// older timelines; document imports are enriched on the server). The server does the lookups and
// checks (backend/services/personal_enrichment.py); this file picks the events to send and applies
// the answer. Links live on events as contextLinks [{ kind: 'place' | 'event', name, title, url, ... }].
import { toEmbeddableWikiUrl } from './wikiEmbedUrl.js';

export const ENRICH_VERSION = 1;
export const MAX_ENRICH_EVENTS = 600;
const TEXT_CHARS = 1200;

const yearOf = (d) => (d && Number.isInteger(d.year) ? d.year : null);

/** The events to send: those never enriched (all of them with `force`). */
export function eventsForEnrichment(articles, { force = false } = {}) {
  const out = [];
  for (const a of Array.isArray(articles) ? articles : []) {
    if (!a || a.id == null || (!force && a.enrichV >= ENRICH_VERSION)) continue;
    const placeLink = (a.contextLinks || []).find((l) => l?.kind === 'place') || null;
    const lat = Number.isFinite(a.lat) ? a.lat : null;
    const lng = Number.isFinite(a.lng) ? a.lng : null;
    out.push({
      id: String(a.id),
      title: String(a.title || '').slice(0, 600),
      text: [a.subtitle, a.extract].filter((s) => typeof s === 'string' && s.trim()).join(' ').slice(0, TEXT_CHARS),
      year: yearOf(a.from),
      to_year: yearOf(a.to),
      place: String(a.locationName || '').slice(0, 400),
      lat,
      lng,
      has_image: Boolean(a.imageUrl),
      place_link: placeLink,
      rank: Number.isInteger(a.rank) && a.rank >= 1 && a.rank <= 10 ? a.rank : 5,
    });
    if (out.length >= MAX_ENRICH_EVENTS) break;
  }
  return out;
}

const isDismissed = (dismissed, eventId, link) => dismissed.has(link.url) || dismissed.has(`${eventId}|${link.url}`);

/**
 * Applies a server answer ({ links, images }) to the events that were sent (`sentIds`).
 * Returns the new articles array, or null when nothing changed. Never replaces a cover.
 */
export function applyEnrichment(articles, result, sentIds, dismissedLinks = []) {
  if (!Array.isArray(articles) || !result) return null;
  const sent = new Set((sentIds || []).map(String));
  const dismissed = new Set(dismissedLinks || []);
  let changed = false;
  const next = articles.map((a) => {
    const id = String(a?.id);
    if (!sent.has(id)) return a;
    const out = { ...a, enrichV: ENRICH_VERSION };
    const existing = Array.isArray(a.contextLinks) ? a.contextLinks : [];
    const seen = new Set(existing.map((l) => l?.url));
    const added = (result.links?.[id] || []).filter((l) => l?.url && !seen.has(l.url) && !isDismissed(dismissed, id, l));
    if (added.length) out.contextLinks = [...existing, ...added];
    const pic = result.images?.[id];
    if (pic?.url && !a.imageUrl) {
      out.imageUrl = pic.url;
      out.imageSource = 'wikimedia';
      out.mediaType = 'image';
      out.imageIllustrative = { url: pic.url, place: pic.place, file: pic.file, fileUrl: pic.fileUrl };
    }
    changed = true;
    return out;
  });
  return changed ? next : null;
}

/** The event's links of one kind that the app can open (plain Wikipedia article URLs). */
export function linksOfKind(article, kind) {
  return (Array.isArray(article?.contextLinks) ? article.contextLinks : []).filter(
    (l) => l && l.kind === kind && typeof l.url === 'string' && l.url.startsWith('https://') && l.title && toEmbeddableWikiUrl(l.url),
  );
}

/** True while the cover is the illustrative Wikimedia picture (not a photo the user added since). */
export function illustrativeCover(article) {
  const ill = article?.imageIllustrative;
  if (!ill || !article.imageUrl || ill.url !== article.imageUrl) return null;
  return typeof ill.fileUrl === 'string' && ill.fileUrl.startsWith('https://commons.wikimedia.org/wiki/File:') ? ill : null;
}

/** Every historical link of the timeline, once, with the events it is on (in time order). */
export function timelineHistoryLinks(timeline) {
  const byUrl = new Map();
  for (const a of timeline?.articles || []) {
    for (const l of linksOfKind(a, 'event')) {
      const entry = byUrl.get(l.url) || { ...l, eventIds: [], firstYear: yearOf(a.from) };
      entry.eventIds.push(a.id);
      const y = yearOf(a.from);
      if (y != null && (entry.firstYear == null || y < entry.firstYear)) entry.firstYear = y;
      byUrl.set(l.url, entry);
    }
  }
  return [...byUrl.values()].sort((x, y) => (x.firstYear ?? 0) - (y.firstYear ?? 0));
}

/** Removes a wrong link: a place link from every event (they share the place), an event link from one. */
export function dismissContextLink(timeline, url, eventId = null) {
  if (!timeline || !url) return null;
  let changed = false;
  const articles = (timeline.articles || []).map((a) => {
    if (!Array.isArray(a?.contextLinks)) return a;
    if (eventId != null && String(a.id) !== String(eventId)) return a;
    const kept = a.contextLinks.filter((l) => l?.url !== url);
    if (kept.length === a.contextLinks.length) return a;
    changed = true;
    const { contextLinks: _drop, ...rest } = a;
    return kept.length ? { ...rest, contextLinks: kept } : rest;
  });
  if (!changed) return null;
  const key = eventId != null ? `${eventId}|${url}` : url;
  const dismissedLinks = [...new Set([...(timeline.dismissedLinks || []), key])].slice(-300);
  return { ...timeline, articles, dismissedLinks };
}

/** Year span and the most frequent places' countries/towns, for the world-events layer prompt. */
export function worldEventsSubject(timeline) {
  let lo = null;
  let hi = null;
  const placeCount = new Map();
  for (const a of timeline?.articles || []) {
    for (const y of [yearOf(a.from), yearOf(a.to)]) {
      if (y == null) continue;
      lo = lo == null ? y : Math.min(lo, y);
      hi = hi == null ? y : Math.max(hi, y);
    }
    const parts = String(a.locationName || '').split(',').map((s) => s.trim()).filter((s) => s && !/\d/.test(s));
    const region = parts.length ? parts[parts.length - 1] : '';
    if (region) placeCount.set(region, (placeCount.get(region) || 0) + 1);
  }
  if (lo == null) return null;
  if (timeline?.articles?.some((a) => a?.isToPresent)) hi = Math.max(hi, new Date().getFullYear());
  const places = [...placeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
  return { from: lo, to: Math.max(hi, lo + 1), places };
}

export function worldEventsPrompt(subject, lang = 'en') {
  if (!subject) return '';
  const span = `${subject.from}–${subject.to}`;
  const where = subject.places.join(', ');
  if (lang === 'he') {
    return where
      ? `אירועים היסטוריים מרכזיים בעולם ובאזורים ${where} בשנים ${span}`
      : `אירועים היסטוריים מרכזיים בעולם בשנים ${span}`;
  }
  return where
    ? `Major world and regional historical events in ${where}, ${span}`
    : `Major world historical events, ${span}`;
}

/** Sets `obj.contextLinks` to its links minus the place ones (deletes it when none are left). */
export function dropPlaceLinks(obj) {
  if (!obj || !Array.isArray(obj.contextLinks)) return obj;
  const kept = obj.contextLinks.filter((l) => l?.kind !== 'place');
  if (kept.length) obj.contextLinks = kept; else delete obj.contextLinks;
  return obj;
}
