import { supabase, ensureAnonymousSession } from './supabaseClient';
import { isDefaultGroundingEnabled } from './utils/groundingConfig';
import { isAiImageAutoFallbackEnabled } from './utils/featureFlags';
import { prepareUploadFiles } from './utils/imageResize';
import { AGE_MODES, toBackendContentMode } from './data/experienceModes';
import { stripTimelineForChatOrRefine, restoreTimelineMediaFromLocal } from './utils/timelinePayload';
import { AI_TIER_HEADER } from './utils/aiMode';
import { formatApiError, jobStatusQuery, parseRetryAfterSeconds, pollAiJobCore, publishAiJobQueue } from './utils/aiJobPolling';
import { isByokRoute } from './utils/byokRoutes';
import { createTimelineSaveQueue, mergeMinimalSaveResponse, MINIMAL_SAVE_QUERY } from './utils/saveQueue';
import { compressTimelineInlineImages } from './utils/inlineImageBudget';
import { compressDataUrlToBudget } from './utils/inlineImageCompress';
import { createPublicFirstFetcher } from './utils/publicFirstFetch';
import { mergeTimelineThreeWay } from './utils/timelineMerge';

export { stripTimelineForChatOrRefine, restoreTimelineMediaFromLocal, formatApiError };

const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (!envUrl) return '/api';
  return envUrl.endsWith('/api') ? envUrl : `${envUrl.replace(/\/$/, '')}/api`;
};

const API_BASE = getApiBase();

// Every request in this module goes through this wrapper (it intentionally shadows the global
// `fetch`). The backend tags AI responses with the key tier that served them; when that tier
// changes (e.g. fast credits just ran out and this request was served in basic mode) we ask the
// app to re-read the quota right away, so the basic-mode notice appears on the very request where
// the switch happened rather than on the next focus/poll.
let lastServedAiTier = null;
// The personal Gemini key rides only on the AI routes that use it (S-08), never on polls, reads or
// saves, so it is exposed to as few requests (and logs) as possible.
const withByokKey = (input, init) => {
  const key = getApiKey();
  if (!key || typeof input !== 'string' || !isByokRoute(init?.method || 'GET', input, API_BASE)) return init;
  const headers = init?.headers;
  if (headers && typeof headers === 'object' && !Array.isArray(headers) && !(headers instanceof Headers)) {
    return { ...init, headers: { ...headers, 'X-Gemini-Api-Key': key } };
  }
  const merged = new Headers(headers || undefined);
  merged.set('X-Gemini-Api-Key', key);
  return { ...(init || {}), headers: merged };
};

const fetch = async (input, init) => {
  const res = await globalThis.fetch(input, withByokKey(input, init));
  try {
    const tier = res.headers?.get?.(AI_TIER_HEADER);
    if (tier && tier !== lastServedAiTier) {
      lastServedAiTier = tier;
      notifyQuotaChanged();
    }
  } catch { /* header access must never break a request */ }
  return res;
};

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

  // The BYOK header is added per route by the `fetch` wrapper above (isByokRoute).

  // Attach Supabase JWT Bearer token if session exists
  if (supabase) {
    try {
      let { data } = await supabase.auth.getSession();
      let token = data?.session?.access_token;
      if (!token) {
        // Establish an anonymous guest session if none exists yet, sharing AuthContext's
        // in-flight sign-in so a first visit never creates two guest users.
        const anonRes = await ensureAnonymousSession().catch(() => ({}));
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

// Bearer header from an already-existing *registered* session only. Never signs in anonymously
// (public reads must not mint guest sessions) and skips guest sessions, which gain nothing here
// and would only add a CORS preflight. Used where admins get extra data (e.g. library covers).
const getExistingAccountAuthHeaders = async () => {
  if (!supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session?.access_token || session.user?.is_anonymous) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    return {};
  }
};

// Builds the Error for a failed response: a readable message from any FastAPI `detail` shape (never
// "[object Object]", B-21), plus `status`, the machine-readable `code` and the raw body.
async function apiErrorFromResponse(res, fallback) {
  const data = await res.json().catch(() => ({}));
  const err = new Error(formatApiError(data?.detail, fallback));
  err.status = res.status;
  const code = data?.code ?? data?.detail?.code;
  if (code) err.code = code;
  err.body = data;
  return err;
}

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
    // A job whose timeline is already saved stays recoverable (via fetchTimeline) for longer
    // than the server keeps the job itself.
    const maxAgeMs = (parsed?.persisted && parsed?.timelineId ? 30 : 10) * 60 * 1000;
    if (Date.now() - (parsed.startedAt || 0) > maxAgeMs) {
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
    const res = await fetch(`${API_BASE}/timeline/job/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: await getHeaders(),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.warn('Failed to cancel AI job on backend:', err);
    return null;
  }
}

// Remember the job's timeline id in the tab's active-job record, so a reload can still open the
// saved timeline once the job itself has expired on the server.
const rememberActiveJobTimeline = (jobId, { timelineId, persisted }) => {
  const active = getActiveAiJob();
  if (active?.jobId === jobId) {
    setActiveAiJob({ ...active, timelineId, persisted: Boolean(persisted) });
  }
};

// Poll a background AI job until it finishes.
// Resilient to mobile tab suspension, half-open TCP connections, transient network drops,
// and momentary auth token refresh delays on resume (see utils/aiJobPolling.js).
// options.recoverResult(timelineId) turns an already-saved timeline into this job kind's result,
// used when the job's own result is lost (expired, errored after saving, still pending at timeout).
export async function pollAiJob(jobId, signal, errorFallback, options = {}) {
  const { recoverResult = null, knownTimeline = null, onPartial = null, onQueued = null } = options || {};
  try {
    return await pollAiJobCore(jobId, {
      signal,
      errorFallback,
      // Long poll (SC-02): `wait` lets the server hold the request until something changes.
      fetchStatus: async (id, fetchSignal, { partialRev = 0, wait = 0, position = 0 } = {}) => fetch(
        `${API_BASE}/timeline/job/status/${encodeURIComponent(id)}${jobStatusQuery({ partialRev, wait, position })}`,
        {
          headers: await getHeaders(),
          signal: fetchSignal,
        },
      ),
      cancelJob: cancelAiJob,
      delay: interruptibleDelay,
      recoverResult,
      knownTimeline,
      onTimelineInfo: (info) => rememberActiveJobTimeline(jobId, info),
      onPartial,
      // The loading UI shows the place in line (SC-07); a caller may listen too.
      onQueued: (info) => {
        publishAiJobQueue(jobId, info);
        onQueued?.(info);
      },
    });
  } finally {
    publishAiJobQueue(jobId, null);
  }
}

// One automatic retry when the server is draining for a restart (503 + short Retry-After);
// anything else (incl. 429 "running from your network") surfaces the server's message.
const MAX_START_RETRY_AFTER_SECONDS = 20;

const abortableSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

// Sends a job-start request (`send()` returns a Response) and returns the new job id.
async function startAiJob(send, signal, errorFallback) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await send();
    if (res.ok) {
      const { job_id: jobId } = await res.json().catch(() => ({}));
      if (!jobId) throw new Error(errorFallback);
      return jobId;
    }
    const retryAfter = parseRetryAfterSeconds(res.headers?.get?.('Retry-After'));
    const errorData = await res.json().catch(() => ({}));
    if (res.status === 503 && attempt === 0 && retryAfter !== null && retryAfter <= MAX_START_RETRY_AFTER_SECONDS) {
      await abortableSleep(retryAfter * 1000, signal);
      continue;
    }
    const err = new Error(formatApiError(errorData?.detail, errorFallback));
    err.status = res.status;
    if (retryAfter !== null) err.retryAfter = retryAfter;
    throw err;
  }
}

// Start a background AI job at `path` then poll it to completion. Keeps the
// long-running AI call off the initial request so the client can leave and
// return (e.g. backgrounding a mobile tab) without stalling.
async function startAndPollJob(path, body, signal, errorFallback, onJobStarted = null, pollOptions = {}) {
  const sendStart = async () => {
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

    try {
      return await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify(body),
        signal: startController.signal,
      });
    } catch (err) {
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
    } finally {
      clearTimeout(startTimeoutId);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }
  };

  const jobId = await startAiJob(sendStart, signal, errorFallback);

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

  return pollAiJob(jobId, signal, errorFallback, pollOptions);
}

// Starts a multipart (file upload) job at `path` and polls it. The FormData is read once per send,
// so the single draining retry in startAiJob can re-send it.
async function startMultipartJobAndPoll(path, formData, signal, errorFallback, onJobStarted = null, pollOptions = {}) {
  // Let the browser set the multipart Content-Type (with boundary) itself.
  const headers = await getHeaders();
  delete headers['Content-Type'];

  const jobId = await startAiJob(
    () => fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      signal: signal || undefined,
    }),
    signal,
    errorFallback,
  );

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

  return pollAiJob(jobId, signal, errorFallback, pollOptions);
}

// Per job kind: how to rebuild the job's result from the timeline it already saved server-side.
const recoverAsTimeline = (timelineId) => fetchTimeline(timelineId);
// A chat job only saves the timeline when it applied an edit; its reply text is lost with the job.
const recoverAsChatEdit = async (timelineId) => ({
  action: 'edit',
  reply: '',
  updated_timeline: await fetchTimeline(timelineId),
  recovered: true,
});

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

// `onPartial(timeline)`: the timeline before Wikipedia images / links are added (a read-only preview, P-03).
export async function generateTimeline(prompt, customFocus = '', signal = null, enableGrounding = isDefaultGroundingEnabled(), onJobStarted = null, contentMode = null, inputMethod = 'typed', onPartial = null) {
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
    { recoverResult: recoverAsTimeline, onPartial },
  );
}

// A cancellable background job (B-09): Stop / abort cancels it on the server and refunds it until
// the model has answered.
export async function generateTimelineFromFiles(files, contextText = '', rawText = '', signal = null, contentMode = null, onJobStarted = null, onPartial = null) {
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

  return startMultipartJobAndPoll(
    '/timeline/generate-from-files/start',
    formData,
    signal,
    'Failed to generate timeline from your files',
    onJobStarted,
    { recoverResult: recoverAsTimeline, onPartial },
  );
}

export async function generateTimelineFromPromptFiles(
  files,
  promptText = '',
  signal = null,
  enableGrounding = isDefaultGroundingEnabled(),
  onJobStarted = null,
  contentMode = null,
  uiLanguage = null,
  inputMethod = 'typed',
  onPartial = null,
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

  return startMultipartJobAndPoll(
    '/timeline/generate-from-files/start',
    formData,
    signal,
    'Failed to generate timeline from attached files',
    onJobStarted,
    { recoverResult: recoverAsTimeline, onPartial },
  );
}

export async function refineTimeline(rawTimeline, instruction, signal = null, onJobStarted = null, contentMode = null) {
  const { timeline, mediaStripped } = stripTimelineForChatOrRefine(withServerBaseVersion(rawTimeline));
  const updated = await startAndPollJob(
    '/timeline/refine/start',
    {
      timeline,
      instruction,
      content_mode: resolveActiveContentMode(contentMode, rawTimeline?.contentMode),
      media_stripped: mediaStripped,
    },
    signal,
    'Failed to refine timeline',
    onJobStarted,
    { recoverResult: recoverAsTimeline },
  );
  return mediaStripped ? restoreTimelineMediaFromLocal(updated, rawTimeline) : updated;
}

export async function chatWithTimeline(rawTimeline, message, history = [], enableGrounding = isDefaultGroundingEnabled(), signal = null, onJobStarted = null, contentMode = null, inputMethod = 'typed') {
  const { timeline, mediaStripped } = stripTimelineForChatOrRefine(withServerBaseVersion(rawTimeline));
  const res = await startAndPollJob(
    '/timeline/chat/start',
    {
      timeline,
      message,
      history: (Array.isArray(history) ? history : []).slice(-80).map((m) => ({ role: m.role, content: m.content })),
      enable_grounding: Boolean(enableGrounding),
      content_mode: resolveActiveContentMode(contentMode, rawTimeline?.contentMode),
      input_method: inputMethod || 'typed',
      media_stripped: mediaStripped,
    },
    signal,
    'Failed to chat about timeline',
    onJobStarted,
    { recoverResult: recoverAsChatEdit },
  );
  if (mediaStripped && res?.updated_timeline) {
    return {
      ...res,
      updated_timeline: restoreTimelineMediaFromLocal(res.updated_timeline, rawTimeline),
    };
  }
  return res;
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
  const imageEventIds = Array.isArray(rawTimeline?.articles)
    ? rawTimeline.articles
        .filter((art) => art?.id && typeof art.imageUrl === 'string' && art.imageUrl.trim().length > 0)
        .map((art) => art.id)
        .slice(0, 120)
    : [];
  const timeline = stripTimelineForTextJob(rawTimeline);
  return startAndPollJob(
    '/timeline/whoami/start',
    {
      timeline,
      previous_event_ids: Array.isArray(previousEventIds) ? previousEventIds.slice(0, 40) : [],
      image_event_ids: imageEventIds,
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
  if (!res.ok) throw await apiErrorFromResponse(res, errorFallback);
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
  const params = new URLSearchParams({ engine: normalizePodcastEngine(engine), format: 'url' });
  if (voiceGender === 'male' || voiceGender === 'female') params.set('gender', voiceGender);
  const res = await fetch(
    `${API_BASE}/timelines/${encodeURIComponent(timelineId)}/podcasts/${encodeURIComponent(episodeId)}/download?${params}`,
    { headers: await getHeaders() },
  );
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to download podcast');
  if ((res.headers.get('Content-Type') || '').includes('application/json')) {
    // A signed Storage URL (SC-05): fetched without our headers, so no token or key leaves the API.
    const { url, filename } = await res.json();
    const file = await fetch(url);
    if (!file.ok) throw new Error('Failed to download podcast');
    return { blob: await file.blob(), filename: filename || 'chronix-podcast.mp3' };
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


// A cancellable background job (B-09), polled like the other chat turns.
export async function chatAttachFilesToTimeline(rawTimeline, files, message = '', signal = null, contentMode = null, inputMethod = 'typed', onJobStarted = null) {
  const preparedFiles = await prepareUploadFiles(files);
  const { timeline, mediaStripped } = stripTimelineForChatOrRefine(withServerBaseVersion(rawTimeline));
  const formData = new FormData();
  formData.append('timeline', JSON.stringify(timeline));
  if (mediaStripped) {
    formData.append('media_stripped', 'true');
  }
  if (message) {
    formData.append('message', message);
  }
  formData.append('content_mode', resolveActiveContentMode(contentMode, rawTimeline?.contentMode));
  formData.append('input_method', inputMethod || 'typed');
  for (const file of preparedFiles) {
    formData.append('files', file);
  }

  const data = await startMultipartJobAndPoll(
    '/timeline/chat/attach-files/start',
    formData,
    signal,
    'Failed to add events from your files',
    onJobStarted,
    { recoverResult: recoverAsChatEdit },
  );
  if (mediaStripped && data?.updated_timeline) {
    return {
      ...data,
      updated_timeline: restoreTimelineMediaFromLocal(data.updated_timeline, rawTimeline),
    };
  }
  return data;
}

export async function fetchTimelines() {
  const res = await fetch(`${API_BASE}/timelines`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load timelines list');
  return res.json();
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
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}`, {
    headers: await getHeaders(),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to load timeline');
  return res.json();
}

const hasAnySession = async () => {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data?.session?.access_token);
};

/**
 * Opens a shared link (/t/<id>). With no session yet it is a plain, header-less GET (no anonymous
 * sign-in, no CORS preflight, cacheable); any miss falls back to fetchTimeline (P-07).
 */
export const fetchSharedTimeline = createPublicFirstFetcher({
  hasSession: hasAnySession,
  publicGet: (id) => fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}`),
  authGet: (id) => fetchTimeline(id),
});

// Enables/disables the "anyone with the link" share flag on a timeline. Owner-only (backend enforced).
export async function setTimelineShareEnabled(id, enabled, authorName = null) {
  const payload = { enabled };
  if (authorName) payload.authorName = authorName;
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}/share`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to update sharing status');
  return res.json();
}

export const TIMELINES_UPDATED_EVENT = 'chronix-timelines-updated';
export const PUBLIC_LIBRARY_UPDATED_EVENT = 'chronix-public-library-updated';

let _cachedPublicLibraryItems = null;

export function getCachedPublicLibraryItems() {
  return _cachedPublicLibraryItems;
}

export function setCachedPublicLibraryItems(items) {
  _cachedPublicLibraryItems = Array.isArray(items) ? items : null;
}

export async function fetchPublicLibrary(params = {}) {
  const qs = new URLSearchParams();
  if (params.lang) qs.set('lang', params.lang);
  if (params.category) qs.set('category', params.category);
  if (params.contentMode) qs.set('content_mode', params.contentMode);
  if (params.q) qs.set('q', params.q);
  if (params.featuredOnly) qs.set('featured_only', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset !== undefined && params.offset !== null) qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  // Admins receive `coverImageCandidates` (for cover cycling) only on an authenticated request.
  const res = await fetch(`${API_BASE}/library${suffix}`, { headers: await getExistingAccountAuthHeaders() });
  if (!res.ok) throw new Error('Failed to load public timeline library');
  const data = await res.json();
  const isUnfilteredFull =
    !params.lang &&
    !params.category &&
    !params.contentMode &&
    !params.q &&
    !params.featuredOnly &&
    (!params.offset || Number(params.offset) === 0) &&
    (!params.limit || Number(params.limit) >= 100);
  if (isUnfilteredFull) {
    const list = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
    if (list) {
      _cachedPublicLibraryItems = list;
    }
  }
  return data;
}

// Admin-only: publish/unpublish, feature, reorder, or customize cover photo of a timeline in the Public Library.
export async function setTimelineLibraryStatus(
  id,
  { isLibrary, isFeatured, featuredOrder, coverImageUrl, coverImagePositionX, coverImagePositionY, silent = false } = {}
) {
  const payload = {};
  if (typeof isLibrary === 'boolean') payload.isLibrary = isLibrary;
  if (typeof isFeatured === 'boolean') payload.isFeatured = isFeatured;
  if (featuredOrder === null || (typeof featuredOrder === 'number' && Number.isFinite(featuredOrder))) {
    payload.featuredOrder = featuredOrder;
  }
  if (coverImageUrl !== undefined) payload.coverImageUrl = coverImageUrl;
  if (typeof coverImagePositionX === 'number' && typeof coverImagePositionY === 'number') {
    payload.coverImagePositionX = coverImagePositionX;
    payload.coverImagePositionY = coverImagePositionY;
  }
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}/library`, {
    method: 'PATCH',
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to update public library status');
  const data = await res.json();
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUBLIC_LIBRARY_UPDATED_EVENT));
    window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
  }
  return data;
}

// Admin-only: persist custom display order for timelines under 'Featured' in the Public Library.
export async function reorderPublicLibrary(orderedIds, { silent = false } = {}) {
  const res = await fetch(`${API_BASE}/library/order`, {
    method: 'PUT',
    headers: await getHeaders(),
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to update public library order');
  const data = await res.json();
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUBLIC_LIBRARY_UPDATED_EVENT));
  }
  return data;
}

// Save-time pass (P-10): only an oversized inline image that is not already a compact JPEG / WebP is
// re-encoded. Uploads and AI images are compressed once when they enter the timeline, and the app
// keeps that URL, so this normally has nothing to do.
function compressTimelinePayloadImages(timeline) {
  return compressTimelineInlineImages(timeline, (url) => compressDataUrlToBudget(url, { skipCompact: true }));
}

// Client-only bookkeeping that never belongs in the stored document.
const SAVE_ONLY_KEYS = ['persisted', 'conflict', 'timeline_id', 'baseUpdatedAt', '_mergedIdForeign'];

// One POST /timelines. `baseUpdatedAt` (B-04) is the version the server last acknowledged for this
// id: a stale one is answered 409 { code: 'stale_write', current_updated_at }, a deleted row 410.
async function sendTimelineSave(timeline, { baseUpdatedAt = null } = {}) {
  const clean = { ...timeline };
  for (const key of SAVE_ONLY_KEYS) delete clean[key];
  const payload = await compressTimelinePayloadImages(clean);
  const res = await fetch(`${API_BASE}/timelines?${MINIMAL_SAVE_QUERY}`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(baseUpdatedAt ? { ...payload, baseUpdatedAt } : payload),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to save timeline');
  // The server answers with its own fields only (P-09); the saved copy is what was sent plus those.
  return mergeMinimalSaveResponse(payload, await res.json());
}

// Fired on window for every save-queue outcome: { type: 'saved' | 'merged' | 'reloaded' | 'gone', id, ... }.
export const TIMELINE_SAVE_SYNC_EVENT = 'chronix-timeline-save-sync';
// Fired by the Saved list before renaming / pinning a timeline. When that timeline is open, the app
// applies the change to its copy and sets `detail.handled` / `detail.promise`, so a single writer
// saves it and the open copy can't revert it on its next save.
export const TIMELINE_META_CHANGE_EVENT = 'chronix-timeline-meta-change';

const timelineSaveQueue = createTimelineSaveQueue({
  send: sendTimelineSave,
  fetchLatest: (id) => fetchTimeline(id),
  merge: (base, local, remote) => mergeTimelineThreeWay(base, local, remote, { prefer: 'local' }),
  onEvent: (event) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(TIMELINE_SAVE_SYNC_EVENT, { detail: event }));
    if (event.type === 'saved' || event.type === 'merged') {
      window.dispatchEvent(new Event(TIMELINES_UPDATED_EVENT));
    }
  },
});

/**
 * Saves a timeline through the per-id save queue (B-04): serialized and coalesced per id, sent
 * with the last acknowledged version, merged and retried once on a concurrent change.
 * Resolves with the server's saved copy (its `updatedAt` is the new version).
 */
export async function saveTimeline(timeline) {
  return timelineSaveQueue.enqueue(timeline);
}

/** Records a copy fresh from the server (opened timeline, server-saved AI result) as the save base. */
export function noteTimelineServerState(timeline) {
  timelineSaveQueue.noteServerState(timeline);
}

/** The timeline was deleted: later saves of it are refused instead of resurrecting it. */
export function markTimelineDeleted(id) {
  timelineSaveQueue.markDeleted(id);
}

// AI jobs persist their result conditioned on the snapshot's `updatedAt`, so it must be the version
// the server last acknowledged, not the one the open copy was loaded with.
function withServerBaseVersion(timeline) {
  if (!timeline || typeof timeline !== 'object' || !timeline.id) return timeline;
  const base = timelineSaveQueue.baseVersionFor(timeline);
  return base && base !== timeline.updatedAt ? { ...timeline, updatedAt: base } : timeline;
}

export async function deleteTimeline(id) {
  const res = await fetch(`${API_BASE}/timelines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to delete timeline');
  return res.json();
}

export async function deleteAllTimelines() {
  const res = await fetch(`${API_BASE}/timelines`, {
    method: 'DELETE',
    headers: await getHeaders(),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to delete all timelines');
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
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to save chat');
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
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to suggest event details');
  return res.json();
}

// Fired after any AI call made outside App's own handlers so the credit badge re-reads the server.
export const QUOTA_REFRESH_EVENT = 'chronix-quota-refresh';

export function notifyQuotaChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(QUOTA_REFRESH_EVENT));
  try { localStorage.setItem('chronix_quota_updated', String(Date.now())); } catch { }
}

// Keep in sync with TEXT_POLISH_MAX_CHARS in backend/models.py.
export const TEXT_POLISH_MAX_CHARS = 20000;

/**
 * Rewrites a rough draft into polished text for one field (draws from the daily AI credits).
 * `field` is one of the backend TextPolishField values (e.g. 'event_description').
 */
export async function polishText({ text, field, context = '', maxLength = null, timelineId = null, contentMode = null, signal = null }) {
  const res = await fetch(`${API_BASE}/text/polish`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      text,
      field,
      context: String(context || '').slice(0, 400),
      max_length: maxLength || null,
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      content_mode: resolveActiveContentMode(contentMode),
    }),
    signal: signal || undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to polish text');
  return res.json();
}

/**
 * Story Studio: drafts the timeline overview from the user's own facts.
 * `story` = { title, kind, people[], lanes[], chapters[{title, from, to}], moments[{title, date, to, place, lane, note, story}] }.
 * Returns { overview, credits }.
 */
export async function draftStoryOverview({ story, language = 'en', timelineId = null, contentMode = null, importRunId = null, occasion = null, signal = null }) {
  const res = await fetch(`${API_BASE}/story/overview`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      ...story,
      language,
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      content_mode: resolveActiveContentMode(contentMode),
      import_run_id: importRunId ? String(importRunId).slice(0, 64) : null,
      occasion: occasion || null,
    }),
    signal: signal || undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to draft the overview');
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
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to generate AI image for this event');
  const data = await res.json();
  // Compressed once here, so the URL the app stores never needs re-encoding on later saves (P-10).
  if (data && typeof data.imageUrl === 'string') {
    data.imageUrl = await compressDataUrlToBudget(data.imageUrl);
  }
  return data;
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

// ---- Story Studio photo import ----

/** Safe defaults if the limits call fails: the registered plan (the server enforces anyway). */
export const DEFAULT_PHOTO_IMPORT_LIMITS = Object.freeze({
  tier: 'registered',
  unlimited: false,
  draft_events_per_call: 12,
  draft_images_per_event: 3,
  draft_image_max_px: 384,
  draft_parallel_calls: 1,
  geocode_points_per_call: 10,
  max_photos: 2000,
  max_places: 80,
  events_per_credit: 12,
  // AI-first import: full drafts and the story pass (see /story/photo-import/limits).
  full_events_per_credit: 8,
  story_events_per_credit: 120,
  story_max_events: 250,
  // The user's own instructions for the AI, per call (see entitlements.photo_instructions_max_chars).
  instructions_max_chars: 2800,
  hosted_photos: { enabled: false, quota: 0, used: 0 },
});

/** Absolute URL for a hosted photo ("/api/photos/..." in local-storage mode). */
export function resolvePhotoUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/api/')) return url;
  const base = String(API_BASE || '').replace(/\/api\/?$/, '');
  return `${base}${url}`;
}

/** Stores one resized photo (Blob) in the user's hosted photos. Returns { url, used, quota }. */
export async function uploadTimelinePhoto(blob, filename = 'photo.webp', signal = null) {
  const headers = await getHeaders();
  delete headers['Content-Type']; // the browser sets the multipart boundary
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch(`${API_BASE}/photos`, { method: 'POST', headers, body: form, signal: signal || undefined });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Photo upload failed');
  const body = await res.json();
  return { ...body, url: resolvePhotoUrl(body.url) };
}

/** The caller's photo-import plan (admins and own-key users get the unlimited one). */
export async function fetchPhotoImportLimits() {
  try {
    const res = await fetch(`${API_BASE}/story/photo-import/limits`, { headers: await getHeaders() });
    if (!res.ok) return { ...DEFAULT_PHOTO_IMPORT_LIMITS };
    return { ...DEFAULT_PHOTO_IMPORT_LIMITS, ...(await res.json()) };
  } catch {
    return { ...DEFAULT_PHOTO_IMPORT_LIMITS };
  }
}

// Results the server could only partly look up in time (SC-11): their deferred ids, by result object.
const DEFERRED_GEOCODE_IDS = new WeakMap();

/** Point ids the server did not get to before its deadline (busy geocoder), or [] when complete. */
export function deferredGeocodeIds(result) {
  return (result && DEFERRED_GEOCODE_IDS.get(result)) || [];
}

/**
 * City-level names for [{id, lat, lng}] (rounded to ~1 km server-side). Returns {id: place|null}.
 * When the shared geocoder is busy the server answers what it could within its deadline; the ids
 * it skipped are available via deferredGeocodeIds(result) so the caller can retry them later.
 */
export async function reverseGeocodePoints(points, lang = null, signal = null) {
  const res = await fetch(`${API_BASE}/timeline/reverse-geocode`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({ points, lang: lang || null }),
    signal: signal || undefined,
  });
  if (!res.ok) {
    const error = new Error('reverse-geocode-failed');
    error.status = res.status;
    throw error;
  }
  const body = await res.json();
  const out = {};
  for (const r of body?.results || []) out[r.id] = r.place || null;
  if (body?.partial) {
    const deferred = Array.isArray(body.deferred) ? body.deferred.map(String) : [];
    DEFERRED_GEOCODE_IDS.set(out, deferred);
  }
  return out;
}

/**
 * AI drafts for photo events. Returns { drafts, credits, tier }.
 * detail 'brief': title + one sentence. detail 'full' (the AI-first import): also caption, story,
 * cover_index, kind, category, importance and occasion; `storyContext` is what the user said the
 * photos are about.
 */
export async function draftPhotoEvents({ events, detail = 'brief', storyContext = '', instructions = '', storyKind = '', storyTitle = '', people = [], lang = 'en', timelineId = null, contentMode = null, importRunId = null, signal = null }) {
  const res = await fetch(`${API_BASE}/story/photo-drafts`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      events,
      detail: detail === 'full' ? 'full' : 'brief',
      story_context: String(storyContext || '').slice(0, 600),
      instructions: String(instructions || '').slice(0, 10000),
      story_kind: String(storyKind || '').slice(0, 120),
      story_title: String(storyTitle || '').slice(0, 200),
      people: (people || []).filter(Boolean).slice(0, 8).map((p) => String(p).slice(0, 60)),
      lang,
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      content_mode: resolveActiveContentMode(contentMode),
      import_run_id: importRunId ? String(importRunId).slice(0, 64) : null,
    }),
    signal: signal || undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to draft photo events');
  return res.json();
}

/**
 * The AI-first import's story pass over every drafted event (time order, text only).
 * Returns { timeline_title, story_type, subject_names, lane_title, chapters, merges, titles,
 * highlights, credits, tier }.
 */
export async function draftPhotoStory({ events, storyContext = '', instructions = '', people = [], home = '', mode = 'new', existingTitle = '', lang = 'en', timelineId = null, contentMode = null, importRunId = null, signal = null }) {
  const res = await fetch(`${API_BASE}/story/photo-story`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      events,
      story_context: String(storyContext || '').slice(0, 600),
      instructions: String(instructions || '').slice(0, 10000),
      people: (people || []).filter(Boolean).slice(0, 8).map((p) => String(p).slice(0, 60)),
      home: String(home || '').slice(0, 120),
      mode: mode === 'add' ? 'add' : 'new',
      existing_title: String(existingTitle || '').slice(0, 200),
      lang,
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      content_mode: resolveActiveContentMode(contentMode),
      import_run_id: importRunId ? String(importRunId).slice(0, 64) : null,
    }),
    signal: signal || undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to shape the photo story');
  return res.json();
}

/**
 * Wikipedia links for a personal timeline's events: places (free), checked historical events (one
 * text-only AI pass, priced per events for limited plans) and optionally illustrative pictures of
 * places for events without a photo. `events` come from utils/personalEnrichment.eventsForEnrichment.
 * Returns { links: {id: [...]}, images: {id: {...}}, stats, historySkipped, credits }.
 */
export async function enrichPersonalTimeline({ events, lang = 'en', places = true, history = true, images = false, timelineId = null, contentMode = null, signal = null }) {
  const res = await fetch(`${API_BASE}/timeline/personal-enrichment`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify({
      events,
      lang: String(lang || 'en').slice(0, 12),
      places: Boolean(places),
      history: Boolean(history),
      images: Boolean(images),
      timeline_id: timelineId ? String(timelineId).slice(0, 120) : null,
      content_mode: resolveActiveContentMode(contentMode),
    }),
    signal: signal || undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to find Wikipedia links');
  return res.json();
}

/**
 * Ends a photo import run: the server logs the cost of each major stage and the grand total.
 * Best effort (logging only) - never throws.
 */
export async function logPhotoImportCost(importRunId) {
  if (!importRunId) return;
  try {
    await fetch(`${API_BASE}/story/photo-import/cost-summary`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({ import_run_id: String(importRunId).slice(0, 64) }),
      keepalive: true,
    });
  } catch {
    // Logging only.
  }
}

// ---- Google Photos Picker (proxied: Google's photo URLs can't be read cross-origin) ----

async function googlePhotosFetch(path, googleToken, { method = 'GET', signal = null } = {}) {
  const headers = await getHeaders();
  headers['X-Google-Photos-Token'] = googleToken;
  const res = await fetch(`${API_BASE}/google-photos${path}`, { method, headers, signal: signal || undefined });
  if (!res.ok) throw await apiErrorFromResponse(res, 'Google Photos request failed');
  return res;
}

export async function createGooglePhotosSession(googleToken) {
  return (await googlePhotosFetch('/sessions', googleToken, { method: 'POST' })).json();
}

export async function getGooglePhotosSession(googleToken, sessionId, signal = null) {
  return (await googlePhotosFetch(`/sessions/${encodeURIComponent(sessionId)}`, googleToken, { signal })).json();
}

export async function listGooglePhotosItems(googleToken, sessionId, pageToken = null, signal = null) {
  const q = pageToken ? `?page_token=${encodeURIComponent(pageToken)}` : '';
  return (await googlePhotosFetch(`/sessions/${encodeURIComponent(sessionId)}/items${q}`, googleToken, { signal })).json();
}

export async function deleteGooglePhotosSession(googleToken, sessionId) {
  try {
    await googlePhotosFetch(`/sessions/${encodeURIComponent(sessionId)}`, googleToken, { method: 'DELETE' });
  } catch {
    // Sessions expire on their own.
  }
}

/** A picked photo resized to fit `size` px, as a Blob. */
export async function fetchGooglePhotosMedia(googleToken, baseUrl, size, signal = null) {
  const q = new URLSearchParams({ url: baseUrl, size: String(size) });
  return (await googlePhotosFetch(`/media?${q.toString()}`, googleToken, { signal })).blob();
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
  // `no-store` here plus the server's no-store header keep mobile browsers from serving a stale
  // count. No `?_t=` buster: a stable URL lets the browser reuse the cached CORS preflight.
  const res = await fetch(`${API_BASE}/user/quota`, {
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
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to update community ledger');
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
  if (!res.ok) throw await apiErrorFromResponse(res, 'Failed to delete user account');
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
    const err = new Error(formatApiError(body?.detail, 'Failed to keep guest timelines'));
    err.status = res.status;
    throw err;
  }
  return body;
}



// ---------------------------------------------------------------------------------------------
// Book import (docs/book-import-spec.md): long books, scans and page photos -> a reviewed timeline.
// A durable server-side pipeline (not the in-memory AI jobs), so these calls never use startAiJob.

const BOOK_IMPORTS = '/book-imports';

/** Absolute URL for a book-import link the server gave as "/api/..." (local-storage mode). */
export function resolveBookImportUrl(url) {
  return resolvePhotoUrl(url);
}

async function bookImportJson(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await getHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw await apiErrorFromResponse(res, 'Book import request failed');
  return res.json();
}

/** { enabled, entitled, reason, caps..., active: [ImportStatus] } (never throws: disabled on errors). */
export async function fetchBookImportLimits(signal = null) {
  try {
    return await bookImportJson(`${BOOK_IMPORTS}/limits`, { signal });
  } catch {
    return { enabled: false };
  }
}

/** Creates an import; returns { import, uploads: [{ clientId, sourceId, method, url, headers }] }. */
export function createBookImport({ files = [], pastedText = '', instructions = '', outputLanguage = 'auto' }, signal = null) {
  return bookImportJson(BOOK_IMPORTS, {
    method: 'POST',
    body: { files, pastedText: pastedText || null, instructions: instructions || null, outputLanguage },
    signal,
  });
}

/**
 * PUTs one file straight to storage (a signed URL; no API key, no session token). Reports progress
 * through onProgress(loadedBytes) and resolves when the storage service accepted the file.
 */
export function uploadBookImportSource(target, blob, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method || 'PUT', resolveBookImportUrl(target.url));
    for (const [k, v] of Object.entries(target.headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const err = new Error(`Upload failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed (network)'));
    xhr.onabort = () => reject(makeAbortError());
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

export const refreshBookImportUploads = (id) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/uploads/refresh`, { method: 'POST' });
export const startBookImport = (id) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/start`, { method: 'POST' });
export const getBookImport = (id, signal = null) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}`, { signal });
export const listBookImports = () => bookImportJson(BOOK_IMPORTS);
export const resumeBookImport = (id) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/resume`, { method: 'POST' });
export const cancelBookImport = (id) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const deleteBookImport = (id) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getBookImportUnit = (id, index) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/units/${Number(index)}`);
export const finalizeBookImport = (id, baseRev, { illustrativeImages = false } = {}) => bookImportJson(
  `${BOOK_IMPORTS}/${encodeURIComponent(id)}/finalize`,
  { method: 'POST', body: { baseRev, illustrativeImages: Boolean(illustrativeImages) } },
);

/** { rev, draft, assets: { photos: {id: {thumb, full}}, units: {index: thumb} }, status } with absolute URLs. */
export async function getBookImportDraft(id, signal = null) {
  const data = await bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/draft`, { signal });
  const photos = {};
  for (const [pid, v] of Object.entries(data?.assets?.photos || {})) {
    photos[pid] = { thumb: resolveBookImportUrl(v?.thumb), full: resolveBookImportUrl(v?.full) };
  }
  const units = {};
  for (const [k, v] of Object.entries(data?.assets?.units || {})) units[k] = resolveBookImportUrl(v);
  return { ...data, assets: { ...(data?.assets || {}), photos, units } };
}

/** Sends review edits; resolves { rev } or throws with err.code === 'stale_draft' and err.body.detail.rev. */
export const postBookImportDraftOps = (id, baseRev, ops) => bookImportJson(`${BOOK_IMPORTS}/${encodeURIComponent(id)}/draft/ops`, { method: 'POST', body: { baseRev, ops } });
