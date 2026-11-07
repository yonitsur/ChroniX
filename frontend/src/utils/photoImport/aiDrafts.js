// Planning for AI-drafted titles/descriptions of photo events (pure, testable).
// The server's per-tier plan (fetchPhotoImportLimits) decides batch size, photos per event,
// photo detail and parallelism; this module splits the work and prices it.

// Keep each request well under the server's 16 MB JSON cap.
export const MAX_DRAFT_PAYLOAD_CHARS = 10_000_000;
// Rough base64 size of one AI thumbnail at the plan's resolution.
export const estimateAiImageChars = (maxPx) => (maxPx > 500 ? 130_000 : 40_000);

/** Events that should get an AI draft: included, new (not attached), not named by the user. */
export function eventsNeedingDrafts(events, { includeNamed = false } = {}) {
  return (events || []).filter((e) => e.include && !e.attachTo && (includeNamed || e.titleSource !== 'user'));
}

/**
 * How many events one request may carry under both the plan and the payload cap. Priced 'full'
 * requests on a limited plan are cut to whole credits (12 per call at 8 per credit -> 8), so no
 * call pays for a block it doesn't fill.
 */
export function eventsPerRequest(limits, detail = 'brief') {
  const perCall = Math.max(1, Number(limits?.draft_events_per_call) || 1);
  const imgs = Math.max(0, Number(limits?.draft_images_per_event) || 0);
  const bySize = imgs ? Math.floor(MAX_DRAFT_PAYLOAD_CHARS / (imgs * estimateAiImageChars(limits?.draft_image_max_px || 384))) : perCall;
  const size = Math.max(1, Math.min(perCall, bySize));
  if (detail !== 'full' || limits?.unlimited) return size;
  const perCredit = Math.max(1, Number(limits?.full_events_per_credit) || 8);
  return size >= perCredit ? Math.floor(size / perCredit) * perCredit : size;
}

/** Splits event ids into request-sized batches. */
export function planDraftBatches(eventIds, limits, detail = 'brief') {
  const size = eventsPerRequest(limits, detail);
  const ids = Array.isArray(eventIds) ? eventIds : [];
  const batches = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  return batches;
}

/**
 * Credits the whole run will take: 0 on the unlimited plan, else per batch like the server.
 * detail 'full' (the AI-first import: caption, story, cover...) is priced per `full_events_per_credit`.
 */
export function draftCreditCost(eventCount, limits, detail = 'brief') {
  if (limits?.unlimited) return 0;
  const per = detail === 'full'
    ? Math.max(1, Number(limits?.full_events_per_credit) || 8)
    : Math.max(1, Number(limits?.events_per_credit) || 12);
  return planDraftBatches(Array.from({ length: Math.max(0, eventCount) }, (_, i) => i), limits, detail)
    .reduce((sum, batch) => sum + Math.max(1, Math.ceil(batch.length / per)), 0);
}

// AI kinds that are not timeline moments: the event is left out (the user can include it again).
export const SET_ASIDE_KINDS = new Set(['screenshot', 'document', 'other']);

/**
 * Merges drafts into events without overwriting what the user typed meanwhile.
 * drafts: [{id, title, description, place_guess?, place_confidence?}] - and, for 'full' drafts
 * (the AI-first import), caption, story, cover_index, kind, category, importance, occasion.
 * `sentImages` ({eventId: [photoId...]}, in the order sent) turns cover_index into a cover.
 */
export function applyDrafts(events, drafts, { sentImages = null } = {}) {
  const byId = new Map((drafts || []).map((d) => [String(d.id), d]));
  return (events || []).map((e) => {
    const d = byId.get(String(e.id));
    if (!d) return e;
    const next = { ...e, aiDrafted: true };
    if (e.titleSource !== 'user' && d.title) {
      next.title = d.title;
      next.titleSource = 'ai';
    }
    const caption = d.caption || d.description;
    if ((e.noteSource !== 'user' || !(e.note || '').trim()) && caption) {
      next.note = caption;
      next.noteSource = 'ai';
    }
    if (d.story && (e.storySource !== 'user' || !(e.story || '').trim())) {
      next.story = d.story;
      next.storySource = 'ai';
    }
    const sent = sentImages ? (sentImages[e.id] || sentImages[String(e.id)]) : null;
    if (Number.isInteger(d.cover_index) && Array.isArray(sent) && e.coverSource !== 'user') {
      const pid = sent[d.cover_index];
      if (pid && e.photoIds.includes(pid)) next.coverId = pid;
    }
    if (d.kind) {
      next.aiKind = d.kind;
      if (SET_ASIDE_KINDS.has(d.kind) && e.includeSource !== 'user') {
        next.include = false;
        next.setAside = d.kind;
      }
    }
    if (d.category) next.category = d.category;
    if (Number.isFinite(Number(d.importance)) && d.importance != null) next.importance = Math.max(1, Math.min(10, Math.round(Number(d.importance))));
    if (d.occasion !== undefined) next.occasion = d.occasion || '';
    // Where the AI recognised the place (photos without a location only): a confident guess
    // fills "Where?" (marked as an AI guess), a likely one is offered as a suggestion.
    const hasPlace = Boolean(e.place) || Boolean((e.placeText || '').trim());
    if (d.place_guess && !hasPlace) {
      if (d.place_confidence === 'high') {
        next.placeText = d.place_guess;
        next.placeSource = 'ai';
        next.placeSuggestion = '';
      } else if (d.place_confidence === 'medium') {
        next.placeSuggestion = d.place_guess;
      }
    }
    return next;
  });
}
