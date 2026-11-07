// Cover selection for Public Library cards. Only admins receive `coverImageCandidates` (for
// cover cycling); everyone else gets a single `coverImageUrl` (string or null).

const isUsableUrl = (url) => typeof url === 'string' && url.trim().length > 0;

/** Usable cover URLs for a card: the admin candidate list, else `[coverImageUrl]`, minus failed ones. */
export function getCoverCandidates(item, failedUrls = null) {
  const raw = Array.isArray(item?.coverImageCandidates) && item.coverImageCandidates.length > 0
    ? item.coverImageCandidates
    : [item?.coverImageUrl];
  return raw.filter((url) => isUsableUrl(url) && !failedUrls?.has?.(url));
}

/** The cover to show: the chosen `coverImageUrl` unless it failed, else the first usable candidate, else null. */
export function pickActiveCover(item, candidates, failedUrls = null) {
  const chosen = item?.coverImageUrl;
  if (isUsableUrl(chosen) && !failedUrls?.has?.(chosen)) return chosen;
  return (Array.isArray(candidates) && candidates[0]) || null;
}

/** True when a library list already carries admin cover candidates (no admin refetch needed). */
export function hasAdminCoverCandidates(items) {
  return Array.isArray(items) && items.some((item) => Array.isArray(item?.coverImageCandidates));
}
