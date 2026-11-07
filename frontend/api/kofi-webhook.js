const normalizeApiBase = (value = '') => {
  const base = value.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const apiBase = normalizeApiBase(process.env.VITE_API_URL || process.env.API_URL || '');
  if (!apiBase || apiBase === '/api') {
    return response.status(503).json({ error: 'Backend API URL is not configured on Vercel (VITE_API_URL)' });
  }

  try {
    let forwardBody;
    let forwardContentType = 'application/json';

    if (typeof request.body === 'string') {
      forwardBody = request.body;
      forwardContentType = request.headers['content-type'] || 'application/x-www-form-urlencoded';
    } else if (request.body && typeof request.body === 'object') {
      forwardBody = JSON.stringify(request.body);
      forwardContentType = 'application/json';
    } else {
      forwardBody = '{}';
    }

    const upstream = await fetch(`${apiBase}/webhooks/kofi`, {
      method: 'POST',
      headers: {
        'Content-Type': forwardContentType,
      },
      body: forwardBody,
    });

    const text = await upstream.text();
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return response.status(upstream.status).send(text);
  } catch (err) {
    return response.status(502).json({ error: 'Failed to forward Ko-fi webhook to backend' });
  }
}
