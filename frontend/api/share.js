const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const normalizeApiBase = (value = '') => {
  const base = value.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
};

const isValidTimelineId = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 200
  && !/[\/\\\x00-\x1F\x7F]/u.test(value)
);

const buildMetadata = (timeline, shareUrl, origin, { listen = false } = {}) => {
  const title = timeline?.title?.trim() || 'Interactive Timeline';
  const description = listen
    ? `Listen to an AI-narrated audio tour of ${title} on ChroniX, synced with an interactive timeline and map.`
    : (timeline?.description?.trim() || `Explore ${title} as an interactive visual timeline on ChroniX.`);

  // Find a non-SVG, valid image if available (WhatsApp/social bots require raster images like JPG/PNG)
  const rawArticleImage = timeline?.articles?.find((article) => {
    const url = article?.imageUrl;
    return typeof url === 'string' && url.trim().length > 0 && !url.toLowerCase().endsWith('.svg');
  })?.imageUrl;

  // The light /meta answer (P-07) carries one picked `coverImageUrl` instead of the events.
  const rawImage = rawArticleImage || timeline?.coverImageUrl;
  let image = typeof rawImage === 'string' ? rawImage.trim() : '';
  if (image && image.startsWith('//')) {
    image = `https:${image}`;
  }
  if (image && !/^https?:\/\//i.test(image)) {
    image = '';
  }
  // WhatsApp drops preview images > 300KB. Use the lightweight brand logo (47KB) instead of heavy background images.
  if (!image) {
    image = `${origin}/chronix_logo_full.png`;
  }

  const pageTitle = `${listen ? '🎧 ' : ''}${title} | ChroniX`;
  const imageType = image.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  return `
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ChroniX" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="${imageType}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`;
};

// The backend (Render free plan) can take 30-60 s to wake; link-preview crawlers give up long
// before that, so after this budget we serve the app shell with its default tags instead.
const DEFAULT_BACKEND_TIMEOUT_MS = 8000;

const DEFAULT_TITLE = 'ChroniX – Interactive Visual Timelines';
const DEFAULT_DESCRIPTION = 'Explore, create, and share interactive historical and personal timelines.';

const buildDefaultMetadata = (shareUrl, origin) => {
  const image = `${origin}/chronix_logo_full.png`;
  return `
    <title>${escapeHtml(DEFAULT_TITLE)}</title>
    <meta name="description" content="${escapeHtml(DEFAULT_DESCRIPTION)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ChroniX" />
    <meta property="og:title" content="${escapeHtml(DEFAULT_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(DEFAULT_DESCRIPTION)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(DEFAULT_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(DEFAULT_DESCRIPTION)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`;
};

// Fetches `url` and reads its body with `read`, all within `timeoutMs`. Resolves to
// { ok, status, body } or null on timeout / network failure; never rejects. The race guards
// against a fetch that ignores the abort signal; the abort frees the socket when it doesn't.
const fetchWithDeadline = (fetchImpl, url, read, timeoutMs, readError = null) => {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const attempt = (async () => {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      const body = readError ? await readError(res).catch(() => null) : null;
      return { ok: false, status: res.status, body };
    }
    return { ok: true, status: res.status, body: await read(res) };
  })().catch(() => null);
  return Promise.race([attempt, deadline]).finally(() => clearTimeout(timer));
};

// FastAPI's answer for an unknown route; the meta endpoint's own 404 says "Timeline not found".
const isMissingRoute = (result) => (
  result && !result.ok && result.status === 404
  && !(result.body && typeof result.body.detail === 'string' && /timeline not found/i.test(result.body.detail))
);

// Link previews need only the title, description and one image: the light /meta endpoint (P-07).
// A backend without it (older deploy) answers 404 for the route itself: then read the full timeline
// within what is left of the time budget.
const fetchPreviewData = async (fetchImpl, apiBase, timelineId, timeoutMs) => {
  const started = Date.now();
  const base = `${apiBase}/timelines/${encodeURIComponent(timelineId)}`;
  const meta = await fetchWithDeadline(fetchImpl, `${base}/meta`, (res) => res.json(), timeoutMs, (res) => res.json());
  if (!isMissingRoute(meta)) return meta;
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining < 500) return null;
  return fetchWithDeadline(fetchImpl, base, (res) => res.json(), remaining);
};

const sendHtml = (response, html, cacheControl) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', cacheControl);
  return response.status(200).send(html);
};

export function createShareHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_BACKEND_TIMEOUT_MS,
} = {}) {
  return async function handler(request, response) {
    const timelineId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const host = request.headers['x-forwarded-host'] || request.headers.host;
    const origin = `${protocol}://${host}`;

    if (!isValidTimelineId(timelineId)) {
      return response.status(404).send('Timeline not found');
    }

    const listenParam = Array.isArray(request.query?.listen) ? request.query.listen[0] : request.query?.listen;
    const listen = listenParam === '1' || listenParam === 'true';
    const shareUrl = `${origin}/t/${encodeURIComponent(timelineId)}${listen ? '?listen=1' : ''}`;
    const appFallbackUrl = `/?timeline=${encodeURIComponent(timelineId)}${listen ? '&listen=1' : ''}`;
    const apiBase = normalizeApiBase(process.env.VITE_API_URL || process.env.API_URL || '');

    try {
      if (!apiBase || apiBase === '/api') throw new Error('Backend URL is not configured');

      const [timelineResult, indexResult] = await Promise.all([
        fetchPreviewData(fetchImpl, apiBase, timelineId, timeoutMs),
        fetchWithDeadline(fetchImpl, `${origin}/index.html`, (res) => res.text(), timeoutMs),
      ]);

      if (!indexResult?.ok) throw new Error('Unable to load application shell');
      const indexHtml = indexResult.body;

      if (!timelineResult?.ok) {
        // Not found via an unauthenticated crawl, or the backend is asleep / slow / down: serve the
        // app shell (its default tags) so the browser can load React, verify the owner's session,
        // or show the rich ChroniX error view. Never cached, so the next crawl gets real tags.
        return sendHtml(response, indexHtml, 'no-store');
      }

      const metadata = buildMetadata(timelineResult.body, shareUrl, origin, { listen });
      const html = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta\s+name=["']description["'][\s\S]*?>/gi, '')
        .replace(/<meta\s+property=["']og:[^"']*["'][\s\S]*?>/gi, '')
        .replace(/<meta\s+name=["']twitter:[^"']*["'][\s\S]*?>/gi, '')
        .replace('</head>', `${metadata}\n  </head>`);

      return sendHtml(response, html, 'public, s-maxage=300, stale-while-revalidate=3600');
    } catch (error) {
      // Redirects with meta refresh only: the CSP allows no inline scripts (S-08).
      const fallback =`<!doctype html><html><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />${buildDefaultMetadata(shareUrl, origin)}
      <meta http-equiv="refresh" content="0;url=${escapeHtml(appFallbackUrl)}" />
    </head><body><a href="${escapeHtml(appFallbackUrl)}">Open in ChroniX</a></body></html>`;
      return sendHtml(response, fallback, 'no-store');
    }
  };
}

export default createShareHandler();

export { buildMetadata, buildDefaultMetadata, escapeHtml, isValidTimelineId, normalizeApiBase, DEFAULT_BACKEND_TIMEOUT_MS };