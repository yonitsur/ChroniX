import { supabase } from './supabaseClient';
import { isDefaultGroundingEnabled } from './utils/groundingConfig';
import { isAiImageAutoFallbackEnabled } from './utils/featureFlags';
import { AGE_MODES, toBackendContentMode } from './data/experienceModes';

const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (!envUrl) return '/api';
  return envUrl.endsWith('/api') ? envUrl : `${envUrl.replace(/\/$/, '')}/api`;
};

const API_BASE = getApiBase();

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

const getHeaders = async () => {
  const headers = {
    'Content-Type': 'application/json',
  };

  const key = getApiKey();
  if (key) {
    headers['X-Gemini-Api-Key'] = key;
  }

  // Attach Supabase JWT Bearer token if session exists
  if (supabase) {
    try {
      let { data } = await supabase.auth.getSession();
      let token = data?.session?.access_token;
      if (!token) {
        // Automatically establish an anonymous guest session if none exists yet
        const anonRes = await supabase.auth.signInAnonymously().catch(() => ({}));
        token = anonRes?.data?.session?.access_token;
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      // ignore auth error
    }
  }

  return headers;
};

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend health check failed');
  return res.json();
}

const makeAbortError = () => {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
};

const ACTIVE_JOB_STORAGE_KEY = 'chronix_active_ai_job';

export const getActiveAiJob = () => {
  try {
    // Check sessionStorage (per-tab isolation) first
    const raw = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (!raw) {
      // Clean up any legacy key from localStorage so it never leaks across tabs
      try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch { }
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.startedAt || 0) > 10 * 60 * 1000) {
      clearActiveAiJob();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const setActiveAiJob = (job) => {
  try {
    // Clean up any legacy key from localStorage
    try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch { }
    if (job) {
      sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(job));
    } else {
      clearActiveAiJob();
    }
  } catch {
    // ignore storage errors
  }
};

export const clearActiveAiJob = () => {
  try {
    sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch { }
  } catch {
    // ignore
  }
};

// Wait `ms`, but resolve when the tab becomes visible or the browser comes online,
// and reject immediately if the request is aborted.
// Includes a small wake-up grace period on mobile so cellular/Wi-Fi radios finish reconnecting.
const interruptibleDelay = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    let wakeTimer = null;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(wakeTimer);
      signal?.removeEventListener('abort', onAbort);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    const scheduleWakeResolve = () => {
      if (wakeTimer) return;
      // 500ms delay to give mobile network radio time to re-establish sockets
      wakeTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 500);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleWakeResolve();
      }
    };
    const onOnline = () => {
      scheduleWakeResolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
  });

// Cancel an in-progress background AI job on the backend
export async function cancelAiJob(jobId) {
  if (!jobId) return;
  try {
    const res = await fetch(`${API_BASE}/timeline/job/cancel/${jobId}`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.warn('Failed to cancel AI job on backend:', err);
    return null;
  }
}

// Poll a background AI job until it finishes.
// Resilient to mobile tab suspension, half-open TCP connections, transient network drops,
// and momentary auth token refresh delays on resume.
export async function pollAiJob(jobId, signal, errorFallback) {
  const startedAt = Date.now();
  const maxWaitMs = 5 * 60 * 1000; // give the backend up to 5 minutes to finish
  let consecutive401Count = 0;
  let consecutive404Count = 0;
  let consecutive403Count = 0;

  while (true) {
    if (signal?.aborted) {
      cancelAiJob(jobId);
      throw makeAbortError();
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > maxWaitMs) {
      throw new Error('Request timed out. Please try again.');
    }

    // Individual poll fetch timeout (10 seconds). If mobile network dropped
    // or TCP socket is hung, this aborts the individual fetch rather than hanging.
    const pollController = new AbortController();
    const pollTimeoutId = setTimeout(() => {
      pollController.abort();
    }, 10000);

    const onParentAbort = () => {
      cancelAiJob(jobId);
      pollController.abort();
    };
    if (signal) {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    let res;
    try {
      res = await fetch(`${API_BASE}/timeline/job/status/${jobId}`, {
        headers: await getHeaders(),
        signal: pollController.signal,
      });
    } catch (fetchErr) {
      clearTimeout(pollTimeoutId);
      if (signal) signal.removeEventListener('abort', onParentAbort);

      // If user explicitly cancelled via the parent signal, cancel job and rethrow AbortError
      if (signal?.aborted) {
        cancelAiJob(jobId);
        throw makeAbortError();
      }

      // Transient network error (e.g. mobile tab backgrounded, network reconnecting, or 10s poll timeout)
      console.warn('Transient poll network glitch, retrying...', fetchErr?.message || fetchErr);
      await interruptibleDelay(2000, signal);
      continue;
    }

    clearTimeout(pollTimeoutId);
    if (signal) signal.removeEventListener('abort', onParentAbort);

    if (!res.ok) {
      // 1. Server errors (>= 500): retry until overall timeout
      if (res.status >= 500 && Date.now() - startedAt < maxWaitMs) {
        await interruptibleDelay(2000, signal);
        continue;
      }

      // 2. Auth error (401): when mobile tab wakes up, Supabase may take 1-3 seconds to refresh the session token.
      // Allow up to 15 seconds of 401 retries before treating it as fatal.
      if (res.status === 401 && ++consecutive401Count <= 7 && Date.now() - startedAt < maxWaitMs) {
        console.warn(`Transient 401 during poll (attempt ${consecutive401Count}), retrying after token stabilization...`);
        await interruptibleDelay(2000, signal);
        continue;
      }

      // 3. Job not found (404): allow up to 10 seconds of retries in case of slight replication/job registration delay.
      if (res.status === 404 && ++consecutive404Count <= 5 && Date.now() - startedAt < maxWaitMs) {
        console.warn(`Transient 404 during poll (attempt ${consecutive404Count}), retrying...`);
        await interruptibleDelay(2000, signal);
        continue;
      }

      // 4. Forbidden (403): a guest who signs in mid-job switches user ids; the job is handed to
      // the new account by the guest-claim request that runs right after sign-in. Give it ~8s.
      if (res.status === 403 && ++consecutive403Count <= 4 && Date.now() - startedAt < maxWaitMs) {
        console.warn(`Transient 403 during poll (attempt ${consecutive403Count}), waiting for guest claim...`);
        await interruptibleDelay(2000, signal);
        continue;
      }

      // 5. Rate limited (429): wait and retry
      if (res.status === 429 && Date.now() - startedAt < maxWaitMs) {
        await interruptibleDelay(3000, signal);
        continue;
      }

      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || errorFallback);
    }

    // Reset transient error counters on successful response
    consecutive401Count = 0;
    consecutive404Count = 0;
    consecutive403Count = 0;

    let data;
    try {
      data = await res.json();
    } catch {
      // Malformed or empty response on broken connection
      await interruptibleDelay(1500, signal);
      continue;
    }

    if (data.status === 'done') return data.result;
    if (data.status === 'cancelled') throw makeAbortError();
    if (data.status === 'error') {
      const jobErr = new Error(data.detail || errorFallback);
      if (data.code) {
        jobErr.code = data.code;
        jobErr.subject = data.subject;
      }
      throw jobErr;
    }

    await interruptibleDelay(800, signal);
  }
}

// Start a background AI job at `path` then poll it to completion. Keeps the
// long-running AI call off the initial request so the client can leave and
// return (e.g. backgrounding a mobile tab) without stalling.
async function startAndPollJob(path, body, signal, errorFallback, onJobStarted = null) {
  const fetchOptions = {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(body),
  };
  if (signal) {
    fetchOptions.signal = signal;
  }

  // 60 second timeout on the initial job start request (giving ample time for cold-starts and token verification)
  const startController = new AbortController();
  const startTimeoutId = setTimeout(() => {
    try {
      startController.abort(new DOMException('Starting request timed out', 'TimeoutError'));
    } catch {
      startController.abort();
    }
  }, 60000);
  const onParentAbort = () => {
    try {
      startController.abort(signal?.reason || makeAbortError());
    } catch {
      startController.abort();
    }
  };
  if (signal) signal.addEventListener('abort', onParentAbort, { once: true });

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: startController.signal,
    });
  } catch (err) {
    clearTimeout(startTimeoutId);
    if (signal) signal.removeEventListener('abort', onParentAbort);

    // If cancelled by the user/parent signal, silently propagate AbortError
    if (signal?.aborted) {
      throw makeAbortError();
    }

    // If start timeout fired
    if (startController.signal.aborted || err?.name === 'TimeoutError') {
      throw new Error('Timeline request timed out while starting. Please check your connection and try again.');
    }

    // If it was another abort (e.g. navigation)
    if (err?.name === 'AbortError') {
      throw makeAbortError();
    }

    throw new Error(err?.message || errorFallback);
  }

  clearTimeout(startTimeoutId);
  if (signal) signal.removeEventListener('abort', onParentAbort);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || errorFallback);
  }

  const { job_id: jobId } = await res.json().catch(() => ({}));
  if (!jobId) throw new Error(errorFallback);

  if (signal?.aborted) {
    cancelAiJob(jobId);
    throw makeAbortError();
  }

  if (typeof onJobStarted === 'function') {
    try {
      onJobStarted(jobId);
    } catch (cbErr) {
      console.warn('Error in onJobStarted callback:', cbErr);
    }
  }

  return pollAiJob(jobId, signal, errorFallback);
}

function resolveActiveContentMode(explicitMode = null, fallbackTimelineMode = null) {
  if (AGE_MODES.includes(explicitMode)) return toBackendContentMode(explicitMode);
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('chronix_content_mode') : null;
    if (AGE_MODES.includes(saved)) return toBackendContentMode(saved);
  } catch {
    // ignore storage errors
  }
  if (AGE_MODES.includes(fallbackTimelineMode)) return fallbackTimelineMode;
  return 'classic';
}

export async function generateTimeline(prompt, customFocus = '', signal = null, enableGrounding = isDefaultGroundingEnabled(), onJobStarted = null, contentMode = null, inputMethod = 'typed') {
  return startAndPollJob(
    '/timeline/generate/start',
    {
      prompt,
      custom_focus: customFocus || null,
      enable_grounding: Boolean(enableGrounding),
      content_mode: resolveActiveContentMode(contentMode),
      enable_ai_fallback_images: Boolean(isAiImageAutoFallbackEnabled()),
      input_method: inputMethod || 'typed',
    },
    signal,
    'Failed to generate timeline',
    onJobStarted,
  );
}

export async function generateTimelineFromFiles(files, contextText = '', rawText = '', signal = null, contentMode = null) {
  const formData = new FormData();
  for (const file of files || []) {
    formData.append('files', file);
  }
  if (contextText) {
    formData.append('context', contextText);
  }
  if (rawText) {
    formData.append('text', rawText);
  }
  formData.append('content_mode', resolveActiveContentMode(contentMode));

  // Let the browser set the multipart Content-Type (with boundary) itself.
  const headers = await getHeaders();
  delete headers['Content-Type'];

  const res = await fetch(`${API_BASE}/timeline/generate-from-files`, {
    method: 'POST',
    headers,
    body: formData,
    signal: signal || undefined,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to generate timeline from your files');
  }

  return res.json();
}

export async function generateTimelineFromPromptFiles(
  files,
  promptText = '',
  signal = null,
  enableGrounding = isDefaultGroundingEnabled(),
  onJobStarted = null,
  contentMode = null,
  uiLanguage = null,
  inputMethod = 'typed'
) {
  const formData = new FormData();
  for (const file of files || []) {
    formData.append('files', file);
  }
  if (promptText && promptText.trim()) {
    formData.append('context', promptText.trim());
  }
  formData.append('prompt_mode', 'true');
  formData.append('enable_grounding', String(Boolean(enableGrounding)));
  formData.append('content_mode', resolveActiveContentMode(contentMode));
  formData.append('enable_ai_fallback_images', String(Boolean(isAiImageAutoFallbackEnabled())));
  formData.append('input_method', inputMethod || 'typed');

  let resolvedLang = uiLanguage;
  if (!resolvedLang) {
    try {
      resolvedLang = typeof localStorage !== 'undefined' ? (localStorage.getItem('chronix_lang') || document?.documentElement?.lang) : null;
    } catch {
      resolvedLang = null;
    }
  }
  if (resolvedLang) {
    formData.append('ui_language', resolvedLang);
  }

  const headers = await getHeaders();
  delete headers['Content-Type'];

  const res = await fetch(`${API_BASE}/timeline/generate-from-files/start`, {
    method: 'POST',
    headers,
    body: formData,
    signal: signal || undefined,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to generate timeline from photo');
  }

  const { job_id: jobId } = await res.json().catch(() => ({}));
  if (!jobId) throw new Error('Failed to generate timeline from photo');

  if (signal?.aborted) {
    cancelAiJob(jobId);
    throw makeAbortError();
  }

  if (typeof onJobStarted === 'function') {
    try {
      onJobStarted(jobId);
    } catch (cbErr) {
      console.warn('Error in onJobStarted callback:', cbErr);
    }
  }

  return pollAiJob(jobId, signal, 'Failed to generate timeline from photo');
}

export async function refineTimeline(timeline, instruction, signal = null, onJobStarted = null, contentMode = null) {
  return startAndPollJob(
    '/timeline/refine/start',
    {
      timeline,
      instruction,
      content_mode: resolveActiveContentMode(contentMode, timeline?.contentMode),
    },
    signal,
    'Failed to refine timeline',
    onJobStarted,
  );
}

export async function chatWithTimeline(timeline, message, history = [], enableGrounding = isDefaultGroundingEnabled(), signal = null, onJobStarted = null, contentMode = null, inputMethod = 'typed') {
  return startAndPollJob(
    '/timeline/chat/start',
    {
      timeline,
      message,
      history: (history || []).map((m) => ({ role: m.role, content: m.content })),
      enable_grounding: Boolean(enableGrounding),
      content_mode: resolveActiveContentMode(contentMode, timeline?.contentMode),
      input_method: inputMethod || 'typed',
    },
    signal,
    'Failed to chat about timeline',
    onJobStarted,
  );
}

export async function generateTimelineQuiz(timeline, previousQuestions = [], signal = null, onJobStarted = null, contentMode = null) {
  return startAndPollJob(
    '/timeline/quiz/start',
    {
      timeline,
      previous_questions: Array.isArray(previousQuestions) ? previousQuestions.slice(0, 40) : [],
      content_mode: resolveActiveContentMode(contentMode, timeline?.contentMode),
    },
    signal,
    'Failed to generate timeline quiz',
    onJobStarted,
  );
}

export async function generateTimelineWhoAmI(timeline, previousEventIds = [], signal = null, onJobStarted = null, contentMode = null) {
  return startAndPollJob(
    '/timeline/whoami/start',
    {
      timeline,
      previous_event_ids: Array.isArray(previousEventIds) ? previousEventIds.slice(0, 40) : [],
      content_mode: resolveActiveContentMode(contentMode, timeline?.contentMode),
    },
    signal,
    'Failed to generate timeline mystery game',
    onJobStarted,
  );
}


export async function chatAttachFilesToTimeline(timeline, files, message = '', signal = null, contentMode = null, inputMethod = 'typed') {
  const formData = new FormData();
  formData.append('timeline', JSON.stringify(timeline));
  if (message) {
    formData.append('message', message);
  }
  formData.append('content_mode', resolveActiveContentMode(contentMode, timeline?.contentMode));
  formData.append('input_method', inputMethod || 'typed');
  for (const file of files || []) {
    formData.append('files', file);
  }

  // Let the browser set the multipart Content-Type (with boundary) itself.
  const headers = await getHeaders();
  delete headers['Content-Type'];

  const res = await fetch(`${API_BASE}/timeline/chat/attach-files`, {
    method: 'POST',
    headers,
    body: formData,
    signal: signal || undefined,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to add events from your files');
  }

  return res.json();
}

export async function fetchTimelines() {
  const res = await fetch(`${API_BASE}/timelines`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load timelines list');
  return res.json();
}

// Admin-only: every saved timeline across all users (backend enforces admin check).
export async function fetchAllTimelinesAdmin() {
  const res = await fetch(`${API_BASE}/timelines?all=true`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load all timelines');
  return res.json();
}

// Admin-only: registered users (incl. guests) with signup/last-login timestamps.
export async function fetchAdminUsers() {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
}

export async function fetchTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${id}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load timeline');
  return res.json();
}

// Enables/disables the "anyone with the link" share flag on a timeline. Owner-only (backend enforced).
export async function setTimelineShareEnabled(id, enabled, authorName = null) {
  const payload = { enabled };
  if (authorName) payload.authorName = authorName;
  const res = await fetch(`${API_BASE}/timelines/${id}/share`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update sharing status');
  return res.json();
}

export async function saveTimeline(timeline) {
  const res = await fetch(`${API_BASE}/timelines`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(timeline),
  });
  if (!res.ok) throw new Error('Failed to save timeline');
  return res.json();
}

export async function deleteTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${id}`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete timeline');
  return res.json();
}

// The signed-in user's saved "Chat with Timeline" conversation. `messages` is null when
// the server-side store is unavailable (e.g. local dev without Supabase).
export async function fetchTimelineChat(id) {
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}/chat`, {
    headers: await getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to load chat');
  return res.json();
}

export async function saveTimelineChat(id, messages) {
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}/chat`, {
    method: 'PUT',
    headers: await getHeaders(),
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error('Failed to save chat');
  return res.json();
}


// Fire-and-forget analytics report for a finished game. Never throws — a failed report
// must not affect the game UI. Only sent for signed-in (incl. guest) sessions.
export async function reportGameCompleted({
  game,
  timelineId = null,
  contentMode = null,
  correct = null,
  total = null,
  points = null,
  ratio = null,
  stars = null,
  durationMs = null,
  difficulty = null,
}) {
  try {
    const headers = await getHeaders();
    if (!headers.Authorization) return;
    const clampRatio = typeof ratio === 'number' && Number.isFinite(ratio)
      ? Math.min(1, Math.max(0, ratio))
      : null;
    const toInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    await fetch(`${API_BASE}/activity/game`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        game,
        timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
        content_mode: resolveActiveContentMode(contentMode),
        correct: toInt(correct),
        total: toInt(total),
        points: typeof points === 'number' && Number.isFinite(points) && points >= 0 ? points : null,
        ratio: clampRatio,
        stars: toInt(stars),
        duration_ms: toInt(durationMs),
        difficulty: difficulty || null,
      }),
    });
  } catch {
    // ignore
  }
}

export async function enrichItem(title, context = '', lang = null) {
  const res = await fetch(`${API_BASE}/timeline/enrich-item`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ title, context, lang }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function suggestEventData({ query, timelineTopic = '', timeScale = 'calendar', lanes = [], timelineId = null, contentMode = null }) {
  const res = await fetch(`${API_BASE}/timeline/suggest-event`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      query,
      timeline_id: timelineId || null,
      timeline_topic: timelineTopic,
      time_scale: timeScale,
      lanes,
      content_mode: resolveActiveContentMode(contentMode),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to suggest event details');
  }
  return res.json();
}

export async function generateEventImage({
  title,
  subtitle = '',
  year = null,
  timeScale = 'calendar',
  timelineTopic = '',
  locationName = null,
  isFictional = false,
  customPrompt = null,
  style = 'auto',
  contentMode = null,
  timelineId = null,
  source = null,
  signal = null,
}) {
  const parsedYear =  year !== '' && year !== null && year !== undefined && !isNaN(Number(year))
    ? Number(year)
    : null;
  const res = await fetch(`${API_BASE}/timeline/generate-event-image`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      title: (title || '').trim(),
      subtitle: (subtitle || '').trim(),
      year: parsedYear,
      time_scale: timeScale || 'calendar',
      timeline_topic: timelineTopic || '',
      location_name: locationName ? String(locationName).trim() : null,
      is_fictional: Boolean(isFictional),
      custom_prompt: customPrompt && String(customPrompt).trim() ? String(customPrompt).trim() : null,
      style: style || 'auto',
      content_mode: resolveActiveContentMode(contentMode),
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      source: source || null,
    }),
    signal: signal || undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate AI image for this event');
  }
  return res.json();
}

export async function searchWikiCandidates(query, context = '', lang = null) {
  const params = new URLSearchParams({ query });
  if (lang) params.append('lang', lang);
  if (context) params.append('context', context);
  const res = await fetch(`${API_BASE}/timeline/wiki-search?${params.toString()}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function searchGeocodeCandidates(query, lang = null) {
  const params = new URLSearchParams({ query });
  if (lang) params.append('lang', lang);
  const res = await fetch(`${API_BASE}/timeline/geocode-search?${params.toString()}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function searchEventVideos(query, lang = null, signal, context = null) {
  const params = new URLSearchParams({ q: query });
  if (lang) params.append('lang', lang);
  if (context) params.append('context', context);
  const res = await fetch(`${API_BASE}/media/youtube-search?${params.toString()}`, {
    headers: await getHeaders(),
    signal,
  });
  if (!res.ok) return { configured: true, items: [], error: 'unavailable' };
  return res.json();
}


export async function fetchUserQuota() {
  // no-store + cache-buster so mobile browsers never serve a stale quota count.
  const res = await fetch(`${API_BASE}/user/quota?_t=${Date.now()}`, {
    headers: await getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

// Public, no-auth guest policy config - usable before any session exists (e.g. the login screen).
export async function fetchGuestPolicy() {
  const res = await fetch(`${API_BASE}/guest-policy`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteUserAccount() {
  const res = await fetch(`${API_BASE}/user/account`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete user account');
  }
  return res.json();
}

// Takes the token explicitly: it runs from an auth-state listener, where awaiting
// supabase.auth.getSession() can deadlock.
export async function claimGuestWork(accessToken, guestAccessToken, guestRefreshToken) {
  const res = await fetch(`${API_BASE}/user/claim-guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ guestAccessToken, guestRefreshToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.detail || 'Failed to keep guest timelines');
    err.status = res.status;
    throw err;
  }
  return body;
}


