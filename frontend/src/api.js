const API_BASE = '/api';

export const getApiKey = () => {
  return localStorage.getItem('gemini_api_key') || '';
};

export const setApiKey = (key) => {
  if (key) {
    localStorage.setItem('gemini_api_key', key.trim());
  } else {
    localStorage.removeItem('gemini_api_key');
  }
};

const getHeaders = () => {
  const headers = {
    'Content-Type': 'application/json',
  };
  const key = getApiKey();
  if (key) {
    headers['X-Gemini-Api-Key'] = key;
  }
  return headers;
};

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend health check failed');
  return res.json();
}

export async function generateTimeline(prompt, detailLevel = 'standard', customFocus = '') {
  const res = await fetch(`${API_BASE}/timeline/generate`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      prompt,
      detail_level: detailLevel,
      custom_focus: customFocus || null,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to generate timeline');
  }
  return res.json();
}

export async function refineTimeline(timeline, instruction) {
  const res = await fetch(`${API_BASE}/timeline/refine`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      timeline,
      instruction,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to refine timeline');
  }
  return res.json();
}

export async function fetchTimelines() {
  const res = await fetch(`${API_BASE}/timelines`);
  if (!res.ok) throw new Error('Failed to load timelines list');
  return res.json();
}

export async function fetchTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${id}`);
  if (!res.ok) throw new Error('Failed to load timeline');
  return res.json();
}

export async function saveTimeline(timeline) {
  const res = await fetch(`${API_BASE}/timelines`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(timeline),
  });
  if (!res.ok) throw new Error('Failed to save timeline');
  return res.json();
}

export async function deleteTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete timeline');
  return res.json();
}

export async function enrichItem(title, context = '', lang = null) {
  const res = await fetch(`${API_BASE}/timeline/enrich-item`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ title, context, lang }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function suggestEventData({ query, timelineTopic = '', timeScale = 'calendar', lanes = [], language = null }) {
  const res = await fetch(`${API_BASE}/timeline/suggest-event`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      query,
      timeline_topic: timelineTopic,
      time_scale: timeScale,
      lanes,
      language,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to suggest event details');
  }
  return res.json();
}

export async function searchWikiCandidates(query, context = '', lang = null) {
  const params = new URLSearchParams({ query });
  if (lang) params.append('lang', lang);
  if (context) params.append('context', context);
  const res = await fetch(`${API_BASE}/timeline/wiki-search?${params.toString()}`);
  if (!res.ok) return [];
  return res.json();
}

