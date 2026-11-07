/**
 * Strips heavy stored media/blobs from chat and refine payloads so requests stay small: inline
 * (data: URL) images and additionalImages that hold any, plus the quiz / whoami / podcast /
 * grounding blobs. Hosted image URLs and video lists are small and travel as they are (P-09), so
 * the server rarely has to read the stored row back. Stripped article fields are recorded, so the
 * server (and the client fallback) restore them without resurrecting media the user removed.
 */
const isInlineImage = (value) => typeof value === 'string' && value.startsWith('data:');
const hasInlineImage = (items) => Array.isArray(items) && items.some((im) => isInlineImage(typeof im === 'string' ? im : im?.url));

export function stripTimelineForChatOrRefine(timeline) {
  if (!timeline || typeof timeline !== 'object' || !timeline.id || timeline._unsavedMerged) {
    return { timeline, mediaStripped: false };
  }
  const { quiz: _q, whoami: _w, podcast: _p, grounding: _g, ...rest } = timeline;
  let strippedAny = Boolean(_q || _w || _p || _g);
  if (Array.isArray(rest.articles)) {
    rest.articles = rest.articles.map((art) => {
      if (!art || typeof art !== 'object') return art;
      const strippedFields = [];
      if (isInlineImage(art.imageUrl)) {
        strippedFields.push('imageUrl');
      }
      if (hasInlineImage(art.additionalImages)) {
        strippedFields.push('additionalImages');
      }
      if (strippedFields.length === 0) return art;
      strippedAny = true;
      const artRest = { ...art };
      for (const field of strippedFields) delete artRest[field];
      return { ...artRest, _strippedMediaFields: strippedFields };
    });
  }
  return { timeline: rest, mediaStripped: strippedAny };
}

export function restoreTimelineMediaFromLocal(updatedTimeline, localTimeline) {
  if (!updatedTimeline || typeof updatedTimeline !== 'object' || !localTimeline || typeof localTimeline !== 'object') {
    return updatedTimeline;
  }
  const merged = { ...updatedTimeline };
  for (const key of ['quiz', 'whoami', 'podcast', 'grounding']) {
    if (merged[key] == null && localTimeline[key] != null) {
      merged[key] = localTimeline[key];
    }
  }
  if (Array.isArray(merged.articles) && Array.isArray(localTimeline.articles)) {
    const localById = new Map(
      localTimeline.articles
        .filter((a) => a && typeof a === 'object' && a.id)
        .map((a) => [String(a.id), a])
    );
    merged.articles = merged.articles.map((art) => {
      if (!art || typeof art !== 'object') return art;
      const { _strippedMediaFields: _marker, ...cleanArt } = art;
      const localArt = cleanArt.id ? localById.get(String(cleanArt.id)) : null;
      if (!localArt) return cleanArt;
      if (cleanArt.imageUrl == null && typeof localArt.imageUrl === 'string' && localArt.imageUrl.length > 0) {
        cleanArt.imageUrl = localArt.imageUrl;
      }
      if (!Array.isArray(cleanArt.additionalImages) && Array.isArray(localArt.additionalImages) && localArt.additionalImages.length > 0) {
        cleanArt.additionalImages = localArt.additionalImages;
      }
      if (cleanArt.videos == null && Array.isArray(localArt.videos) && localArt.videos.length > 0) {
        cleanArt.videos = localArt.videos;
      }
      return cleanArt;
    });
  }
  return merged;
}
