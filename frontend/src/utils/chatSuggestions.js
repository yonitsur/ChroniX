const clean = (list) =>
  (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);

// Stable per-timeline rotation, so different timelines lead with different edit kinds (add/remove/re-color).
const rotate = (list, seed) => {
  if (list.length < 2 || !seed) return list;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const k = h % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
};

const CONDENSE_MIN_EVENTS = 16;

// AI-written starters for this timeline, falling back to generic localized ones (older timelines).
export function getChatSuggestions(timeline, t) {
  const questions = clean(timeline?.chatQuestions);
  let edits = clean(timeline?.chatEditIdeas);
  if (!edits.length) {
    edits = clean(t('chat.suggest.fallbackEdits'));
    // Index 1 is the generic "remove" example; big timelines get the more useful "narrow it down" one.
    if (edits.length > 1 && (timeline?.articles?.length ?? 0) >= CONDENSE_MIN_EVENTS) {
      edits[1] = t('chat.suggest.condenseEdit');
    }
  }
  return {
    questions: questions.length ? questions : clean(t('chat.suggest.fallbackQuestions')),
    edits: rotate(edits, String(timeline?.id || '')),
  };
}
