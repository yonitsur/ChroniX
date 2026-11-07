// Which id a re-layered / saved merged (comparison) timeline may keep (B-12). Pure.
//
// Re-layering keeps the current id only when it is safe to write to: an unsaved merge (its id was
// minted locally) or the user's own persisted merged timeline. Someone else's merged timeline
// (a shared link, a Library comparison) gets a new id, so Save creates the user's own copy instead
// of failing with 403 or overwriting a row the user doesn't own.
import { randomHexId } from './randomId.js';

/**
 * `existingId` for mergeTimelines() when re-layering `timeline`, or undefined to mint a new id.
 * `allowLibrary`: an owned Library comparison may keep its id (curation of the published row).
 */
export function resolveMergedLayerId(timeline, { allowLibrary = false } = {}) {
  if (!timeline?.id || timeline._mergedIdForeign) return undefined;
  if (timeline._unsavedMerged) return timeline.id;
  const ownedMerged = timeline.creationSource === 'merged'
    && timeline.isOwner !== false
    && (allowLibrary || !timeline.isLibrary);
  return ownedMerged ? timeline.id : undefined;
}

/** The id to save a merged timeline under: its own id unless that id belongs to someone else. */
export function resolveMergedSaveId(timeline, mint = randomHexId) {
  if (!timeline?.id) return mint();
  const foreign = Boolean(timeline._mergedIdForeign) || (!timeline._unsavedMerged && timeline.isOwner === false);
  return foreign ? mint() : timeline.id;
}
