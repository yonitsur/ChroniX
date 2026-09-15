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

const buildMetadata = (timeline, shareUrl, origin) => {
  const title = timeline?.title?.trim() || 'Interactive Timeline';
  const description = timeline?.description?.trim()
    || `Explore ${title} as an interactive visual timeline on ChroniX.`;
  const articleImage = timeline?.articles?.find((article) => article?.imageUrl)?.imageUrl;
  const image = articleImage || `${origin}/historical-map-bg.jpg`;
  const pageTitle = `${title} | ChroniX`;

  return `
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ChroniX" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`;
};

export default async function handler(request, response) {
  const timelineId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const origin = `${protocol}://${host}`;

  if (!isValidTimelineId(timelineId)) {
    return response.status(404).send('Timeline not found');
  }

  const shareUrl = `${origin}/t/${encodeURIComponent(timelineId)}`;
  const appFallbackUrl = `/?timeline=${encodeURIComponent(timelineId)}`;
  const apiBase = normalizeApiBase(process.env.VITE_API_URL || process.env.API_URL || '');

  try {
    if (!apiBase || apiBase === '/api') throw new Error('Backend URL is not configured');

    const [timelineResponse, indexResponse] = await Promise.all([
      fetch(`${apiBase}/timelines/${encodeURIComponent(timelineId)}`),
      fetch(`${origin}/index.html`),
    ]);

    if (!timelineResponse.ok) {
      return response.status(404).send('Timeline not found or is no longer shared');
    }

    if (!indexResponse.ok) throw new Error('Unable to load application shell');

    const timeline = await timelineResponse.json();
    const indexHtml = await indexResponse.text();
    const metadata = buildMetadata(timeline, shareUrl, origin);
    const html = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/i, '')
      .replace('</head>', `${metadata}\n  </head>`);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return response.status(200).send(html);
  } catch (error) {
    const fallback = `<!doctype html><html><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ChroniX</title>
      <meta http-equiv="refresh" content="0;url=${escapeHtml(appFallbackUrl)}" />
    </head><body><script>location.replace(${JSON.stringify(appFallbackUrl)})</script></body></html>`;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.status(200).send(fallback);
  }
}

export { buildMetadata, escapeHtml, isValidTimelineId, normalizeApiBase };