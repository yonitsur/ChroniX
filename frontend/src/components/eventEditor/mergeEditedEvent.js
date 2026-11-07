// Saving an event from the editor: the form owns some fields, the stored event has more.
//
// `buildArticle()` writes every field the form owns (undefined = cleared by the user). Everything
// else on the stored event (people, source references, provenance, the photo count, the AI badge,
// the Story Studio anchor, place links...) used to be dropped on save because the editor rebuilt the
// event from the form alone. It is now carried over, except fields that describe an owned field the
// user just changed, which would be stale.
import { dropPlaceLinks } from '../../utils/personalEnrichment.js';

const dateKey = (d) => (d
  ? [d.year, d.month, d.day, d.hour, d.minute].map((v) => (v == null || v === '' ? '' : Number(v))).join('|')
  : '');

const sameText = (a, b) => String(a || '').trim() === String(b || '').trim();

/** The event to store: `initialEvent`'s other fields under the form's `saved` fields. */
export function mergeEditedEvent(initialEvent, saved) {
  if (!initialEvent) return saved;
  const out = { ...initialEvent, ...saved };

  // "summer 1944", "c. 1944" and how the date was worked out describe the old date.
  const dateChanged = dateKey(initialEvent.from) !== dateKey(saved.from)
    || dateKey(initialEvent.to) !== dateKey(saved.to)
    || Boolean(initialEvent.isToPresent) !== Boolean(saved.isToPresent);
  if (dateChanged) {
    delete out.dateText;
    delete out.dateBasis;
    delete out.circa;
  }
  // The caption belongs to the cover photo it was written for.
  if (!sameText(initialEvent.imageUrl, saved.imageUrl)) delete out.imageCaption;
  // The English title belongs to the Wikipedia page it was found for.
  if (!sameText(initialEvent.wikiUrl || initialEvent.sourceUrl, saved.wikiUrl || saved.sourceUrl)) delete out.wikiTitleEn;
  // The "About <place>" link describes the old place.
  if (!sameText(initialEvent.locationName, saved.locationName)) dropPlaceLinks(out);
  return out;
}
