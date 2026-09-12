import { supabase } from './supabaseClient';

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
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
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
      try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch {}
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
    try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch {}
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
    try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch {}
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

// Poll a background AI job until it finishes.
// Resilient to mobile tab suspension, half-open TCP connections, transient network drops,
// and momentary auth token refresh delays on resume.
export async function pollAiJob(jobId, signal, errorFallback) {
  const startedAt = Date.now();
  const maxWaitMs = 5 * 60 * 1000; // give the backend up to 5 minutes to finish
  let consecutive401Count = 0;
  let consecutive404Count = 0;

  while (true) {
    if (signal?.aborted) throw makeAbortError();

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

      // If user explicitly cancelled via the parent signal, rethrow AbortError
      if (signal?.aborted) throw makeAbortError();

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

      // 4. Rate limited (429): wait and retry
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

    let data;
    try {
      data = await res.json();
    } catch {
      // Malformed or empty response on broken connection
      await interruptibleDelay(1500, signal);
      continue;
    }

    if (data.status === 'done') return data.result;
    if (data.status === 'error') throw new Error(data.detail || errorFallback);

    await interruptibleDelay(2000, signal);
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

  // 15 second timeout on the initial job start request
  const startController = new AbortController();
  const startTimeoutId = setTimeout(() => startController.abort(), 15000);
  const onParentAbort = () => startController.abort();
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
    if (signal?.aborted) throw makeAbortError();
    throw new Error(err.message || errorFallback);
  }

  clearTimeout(startTimeoutId);
  if (signal) signal.removeEventListener('abort', onParentAbort);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || errorFallback);
  }

  const { job_id: jobId } = await res.json().catch(() => ({}));
  if (!jobId) throw new Error(errorFallback);

  if (typeof onJobStarted === 'function') {
    try {
      onJobStarted(jobId);
    } catch (cbErr) {
      console.warn('Error in onJobStarted callback:', cbErr);
    }
  }

  return pollAiJob(jobId, signal, errorFallback);
}

export async function generateTimeline(prompt, customFocus = '', signal = null, enableGrounding = true, onJobStarted = null) {
  return startAndPollJob(
    '/timeline/generate/start',
    {
      prompt,
      custom_focus: customFocus || null,
      enable_grounding: Boolean(enableGrounding),
    },
    signal,
    'Failed to generate timeline',
    onJobStarted,
  );
}

export async function refineTimeline(timeline, instruction, signal = null) {
  return startAndPollJob(
    '/timeline/refine/start',
    {
      timeline,
      instruction,
    },
    signal,
    'Failed to refine timeline',
  );
}

export async function chatWithTimeline(timeline, message, history = [], enableGrounding = true, signal = null) {
  return startAndPollJob(
    '/timeline/chat/start',
    {
      timeline,
      message,
      history: (history || []).map((m) => ({ role: m.role, content: m.content })),
      enable_grounding: Boolean(enableGrounding),
    },
    signal,
    'Failed to chat about timeline',
  );
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

export async function enrichItem(title, context = '', lang = null) {
  const res = await fetch(`${API_BASE}/timeline/enrich-item`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ title, context, lang }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function suggestEventData({ query, timelineTopic = '', timeScale = 'calendar', lanes = [], timelineId = null }) {
  const res = await fetch(`${API_BASE}/timeline/suggest-event`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      query,
      timeline_id: timelineId || null,
      timeline_topic: timelineTopic,
      time_scale: timeScale,
      lanes,
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


export async function fetchUserQuota() {
  // no-store + cache-buster so mobile browsers never serve a stale quota count.
  const res = await fetch(`${API_BASE}/user/quota?_t=${Date.now()}`, {
    headers: await getHeaders(),
    cache: 'no-store',
  });
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


