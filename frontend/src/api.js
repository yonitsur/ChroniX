import { supabase } from './supabaseClient';
import { isDefaultGroundingEnabled } from './utils/groundingConfig';
import { isAiImageAutoFallbackEnabled } from './utils/featureFlags';
import { prepareUploadFiles } from './utils/imageResize';
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
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('chronix-api-key-change'));
  } else {
    localStorage.removeItem('gemini_api_key');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('chronix-api-key-change'));
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
  const preparedFiles = await prepareUploadFiles(files);
  const formData = new FormData();
  for (const file of preparedFiles) {
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
  const preparedFiles = await prepareUploadFiles(files);
  const formData = new FormData();
  for (const file of preparedFiles) {
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
    throw new Error(errorData.detail || 'Failed to generate timeline from attached files');
  }

  const { job_id: jobId } = await res.json().catch(() => ({}));
  if (!jobId) throw new Error('Failed to generate timeline from attached files');

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

  return pollAiJob(jobId, signal, 'Failed to generate timeline from attached files');
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

function stripTimelineForTextJob(timeline) {
  if (!timeline || typeof timeline !== 'object') return timeline;
  const { quiz: _q, whoami: _w, podcast: _p, grounding: _g, ...rest } = timeline;
  if (Array.isArray(rest.articles)) {
    rest.articles = rest.articles.map((art) => {
      if (!art || typeof art !== 'object') return art;
      const { imageUrl: _img, additionalImages: _add, videos: _vid, ...artRest } = art;
      return artRest;
    });
  }
  return rest;
}

export async function generateTimelineQuiz(rawTimeline, previousQuestions = [], signal = null, onJobStarted = null, contentMode = null) {
  const timeline = stripTimelineForTextJob(rawTimeline);
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

export async function generateTimelineWhoAmI(rawTimeline, previousEventIds = [], signal = null, onJobStarted = null, contentMode = null) {
  const timeline = stripTimelineForTextJob(rawTimeline);
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

// ---- Podcasts ----------------------------------------------------------------------------
// Episodes live on the server; chapter audio is rendered there once and streamed from an
// immutable, content-addressed URL, so replays and shared links never re-synthesize audio.

const PODCAST_ENGINES = new Set(['edge', 'gcloud', 'gemini']);
const normalizePodcastEngine = (engine) => (PODCAST_ENGINES.has(engine) ? engine : 'edge');

async function podcastRequest(path, { method = 'GET', body, signal, errorFallback = 'Podcast request failed' } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal || undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.detail || errorFallback);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const podcastAudioUrl = (clipKey) => `${API_BASE}/podcast-audio/${clipKey}.mp3`;

export async function fetchPodcastOptions(lang = 'en', format = 'single', gender = 'male') {
  const params = new URLSearchParams({
    lang: String(lang || 'en').slice(0, 10),
    format: format === 'duo' ? 'duo' : 'single',
    gender: gender === 'female' ? 'female' : 'male',
  });
  return podcastRequest(`/podcast/options?${params}`, { errorFallback: 'Failed to load voice options' });
}

export async function fetchVoicePreview({ engine = 'edge', gender = 'male', lang = 'en', format = 'single' } = {}) {
  const params = new URLSearchParams({
    engine: normalizePodcastEngine(engine),
    gender: gender === 'female' ? 'female' : 'male',
    lang: String(lang || 'en').slice(0, 10),
    format: format === 'duo' ? 'duo' : 'single',
  });
  const clip = await podcastRequest(`/podcast/voice-preview?${params}`, { errorFallback: 'Voice preview unavailable' });
  return { ...clip, src: podcastAudioUrl(clip.key) };
}

export async function listTimelinePodcasts(timelineId) {
  const data = await podcastRequest(`/timelines/${encodeURIComponent(timelineId)}/podcasts`, {
    errorFallback: 'Failed to load podcast episodes',
  });
  return data.episodes || [];
}

export async function fetchPodcastEpisode(timelineId, episodeId) {
  return podcastRequest(
    `/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}`,
    { errorFallback: 'Failed to load podcast episode' },
  );
}

export async function generatePodcastEpisode(rawTimeline, options = {}, signal = null, onJobStarted = null, contentMode = null) {
  const timeline = stripTimelineForTextJob(rawTimeline);
  const isHe = /[\u0590-\u05FF]/.test(`${timeline?.title || ''} ${timeline?.description || ''}`)
    || String(timeline?.detectedLanguage || '').trim().toLowerCase().startsWith('he');
  const defaultEngine = isHe ? 'gcloud' : 'edge';
  const { format = 'single', voiceGender = 'male', length = 'focused', engine = defaultEngine } = options || {};
  return startAndPollJob(
    `/timelines/${encodeURIComponent(timeline.id)}/podcasts/start`,
    {
      timeline,
      format: format === 'duo' ? 'duo' : 'single',
      voice_gender: voiceGender === 'female' ? 'female' : 'male',
      length: length === 'full' ? 'full' : 'focused',
      tts_engine: normalizePodcastEngine(engine),
      content_mode: resolveActiveContentMode(contentMode, timeline?.contentMode),
    },
    signal,
    'Failed to generate podcast',
    onJobStarted,
  );
}

// Ensures the whole episode is rendered with `engine`. Premium (Gemini) voices cost one AI
// credit per episode the first time they are unlocked; everyone can then listen for free.
export async function requestPodcastAudio(timelineId, episodeId, engine, voiceGender = null) {
  const body = { engine: normalizePodcastEngine(engine) };
  if (voiceGender === 'male' || voiceGender === 'female') body.voice_gender = voiceGender;
  return podcastRequest(
    `/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}/audio`,
    { method: 'POST', body, errorFallback: 'Failed to prepare audio' },
  );
}

export async function fetchPodcastClip(timelineId, episodeId, segmentId, engine, signal = null, voiceGender = null) {
  const params = new URLSearchParams({ engine: normalizePodcastEngine(engine) });
  if (voiceGender === 'male' || voiceGender === 'female') params.set('gender', voiceGender);
  const clip = await podcastRequest(
    `/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}/segments/${encodeURIComponent(segmentId)}/clip?${params}`,
    { signal, errorFallback: 'Failed to load chapter audio' },
  );
  return { ...clip, src: podcastAudioUrl(clip.key) };
}

// The whole episode as one continuous stream (gapless chapter transitions, even on a locked phone).
// Resolves to `{ ready: false }` until every chapter has been rendered.
export async function fetchPodcastEpisodeAudio(timelineId, episodeId, engine, voiceGender = null, signal = null) {
  const params = new URLSearchParams({ engine: normalizePodcastEngine(engine) });
  if (voiceGender === 'male' || voiceGender === 'female') params.set('gender', voiceGender);
  const data = await podcastRequest(
    `/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}/episode-audio?${params}`,
    { signal, errorFallback: 'Failed to load episode audio' },
  );
  return data?.ready ? { ...data, src: podcastAudioUrl(data.key) } : { ready: false };
}

export async function downloadPodcastEpisode(timelineId, episodeId, engine, voiceGender = null) {
  const params = new URLSearchParams({ engine: normalizePodcastEngine(engine) });
  if (voiceGender === 'male' || voiceGender === 'female') params.set('gender', voiceGender);
  const res = await fetch(
    `${API_BASE}/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}/download?${params}`,
    { headers: await getHeaders() },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.detail || 'Failed to download podcast');
    err.status = res.status;
    throw err;
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const utf8Name = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const filename = utf8Name ? decodeURIComponent(utf8Name) : 'chronix-podcast.mp3';
  return { blob: await res.blob(), filename };
}

export async function deletePodcastEpisode(timelineId, episodeId) {
  return podcastRequest(
    `/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}`,
    { method: 'DELETE', errorFallback: 'Failed to delete episode' },
  );
}

// Fire-and-forget listening analytics. Never throws.
export async function reportPodcastListen(payload = {}) {
  try {
    const headers = await getHeaders();
    if (!headers.Authorization) return;
    const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
    const int = (v, max) => {
      const n = num(v, max);
      return n == null ? null : Math.round(n);
    };
    await fetch(`${API_BASE}/activity/podcast`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        event: payload.event,
        timeline_id: payload.timelineId ? String(payload.timelineId).slice(0, 120) : null,
        episode_id: payload.episodeId ? String(payload.episodeId).slice(0, 120) : null,
        engine: PODCAST_ENGINES.has(payload.engine) ? payload.engine : null,
        content_mode: resolveActiveContentMode(payload.contentMode),
        chapters_total: int(payload.chaptersTotal, 100),
        chapters_completed: int(payload.chaptersCompleted, 100),
        max_chapter_reached: int(payload.maxChapterReached, 100),
        listened_seconds: num(payload.listenedSeconds, 6 * 3600),
        episode_seconds: num(payload.episodeSeconds, 6 * 3600),
        time_to_first_audio_ms: int(payload.timeToFirstAudioMs, 600000),
        buffering_ms: int(payload.bufferingMs, 24 * 3600 * 1000),
        fallback_count: int(payload.fallbackCount, 100),
        is_shared_view: typeof payload.isSharedView === 'boolean' ? payload.isSharedView : null,
        music_enabled: typeof payload.musicEnabled === 'boolean' ? payload.musicEnabled : null,
        music_mood: typeof payload.musicMood === 'string' ? payload.musicMood.slice(0, 32) : null,
      }),
    });
  } catch {
    // ignore
  }
}


export async function chatAttachFilesToTimeline(timeline, files, message = '', signal = null, contentMode = null, inputMethod = 'typed') {
  const preparedFiles = await prepareUploadFiles(files);
  const formData = new FormData();
  formData.append('timeline', JSON.stringify(timeline));
  if (message) {
    formData.append('message', message);
  }
  formData.append('content_mode', resolveActiveContentMode(contentMode, timeline?.contentMode));
  formData.append('input_method', inputMethod || 'typed');
  for (const file of preparedFiles) {
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

export async function findMatchingTimelines(query, contentMode = null, limit = 3, signal = null) {
  const clean = (query || '').trim();
  if (clean.length < 2) return [];
  const params = new URLSearchParams({
    q: clean.slice(0, 300),
    limit: String(limit || 3),
  });
  const mode = resolveActiveContentMode(contentMode);
  if (mode) params.set('content_mode', mode);
  try {
    const res = await fetch(`${API_BASE}/timelines/match?${params.toString()}`, {
      headers: await getHeaders(),
      signal: signal || undefined,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const DEFAULT_COMMUNITY_DONATION_URL = 'https://ko-fi.com/chronixai';

export function getCommunityDonationUrl(quota = null) {
  if (typeof quota === 'string' && quota.trim()) return quota.trim();
  const fromQuota = (quota?.donation_url || quota?.community_pool?.donation_url || '').trim();
  if (fromQuota) return fromQuota;
  const fromEnv = (import.meta.env.VITE_DONATION_URL || '').trim();
  return fromEnv || DEFAULT_COMMUNITY_DONATION_URL;
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

export const TIMELINES_UPDATED_EVENT = 'chronix-timelines-updated';

async function compressDataImageUrl(url, maxLen = 80000, maxDim = 1024, quality = 0.8) {
  if (typeof url !== 'string' || url.length <= maxLen || !url.startsWith('data:image/')) {
    return url;
  }
  if (url.slice(0, 30).toLowerCase().includes('image/gif') || typeof document === 'undefined') {
    return url;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (!width || !height) {
          resolve(url);
          return;
        }
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(url);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed && compressed.length < url.length ? compressed : url);
      } catch {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

async function compressTimelinePayloadImages(timeline) {
  if (!timeline || typeof timeline !== 'object' || !Array.isArray(timeline.articles)) {
    return timeline;
  }
  const hasOversized = timeline.articles.some((art) => {
    if (!art || typeof art !== 'object') return false;
    if (typeof art.imageUrl === 'string' && art.imageUrl.length > 80000 && art.imageUrl.startsWith('data:image/')) {
      return true;
    }
    if (Array.isArray(art.additionalImages)) {
      return art.additionalImages.some((im) => {
        const u = typeof im === 'string' ? im : im?.url;
        return typeof u === 'string' && u.length > 80000 && u.startsWith('data:image/');
      });
    }
    return false;
  });
  if (!hasOversized) return timeline;

  const articles = await Promise.all(
    timeline.articles.map(async (art) => {
      if (!art || typeof art !== 'object') return art;
      let nextArt = art;
      if (typeof art.imageUrl === 'string' && art.imageUrl.length > 80000 && art.imageUrl.startsWith('data:image/')) {
        const compressedUrl = await compressDataImageUrl(art.imageUrl);
        if (compressedUrl !== art.imageUrl) {
          nextArt = { ...nextArt, imageUrl: compressedUrl };
        }
      }
      if (Array.isArray(art.additionalImages) && art.additionalImages.length > 0) {
        const nextAdd = await Promise.all(
          art.additionalImages.map(async (im) => {
            if (typeof im === 'string') {
              return compressDataImageUrl(im);
            }
            if (im && typeof im === 'object' && typeof im.url === 'string') {
              const compressedUrl = await compressDataImageUrl(im.url);
              return compressedUrl !== im.url ? { ...im, url: compressedUrl } : im;
            }
            return im;
          })
        );
        nextArt = { ...nextArt, additionalImages: nextAdd };
      }
      return nextArt;
    })
  );
  return { ...timeline, articles };
}

export async function saveTimeline(timeline) {
  const payload = await compressTimelinePayloadImages(timeline);
  const res = await fetch(`${API_BASE}/timelines`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save timeline');
  const saved = await res.json();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
  }
  return saved;
}

export async function deleteTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${id}`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete timeline');
  return res.json();
}

export async function deleteAllTimelines() {
  const res = await fetch(`${API_BASE}/timelines`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete all timelines');
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
  engine = 'auto',
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
      engine: engine === 'free' || engine === 'premium' ? engine : 'auto',
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

export async function fetchCommunityLedger() {
  const res = await fetch(`${API_BASE}/community/ledger?_t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export const getKofiWebhookUrl = () => {
  if (API_BASE.startsWith('https://')) {
    return `${API_BASE}/webhooks/kofi`;
  }
  if (typeof window !== 'undefined' && window.location.origin.startsWith('https://')) {
    return `${window.location.origin}/api/webhooks/kofi`;
  }
  return 'https://chronix-ai.com/api/webhooks/kofi';
};

export async function updateAdminCommunityLedger(payload) {
  const res = await fetch(`${API_BASE}/admin/community/ledger`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update community ledger');
  }
  const data = await res.json();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chronix-community-ledger-updated', { detail: data }));
  }
  return data;
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


