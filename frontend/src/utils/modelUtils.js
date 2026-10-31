/**
 * Utility functions for formatting and displaying AI model names in a discreet, human-friendly way.
 */

/**
 * Formats raw AI model identifiers (e.g., 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash')
 * into human-readable labels.
 *
 * @param {string|null|undefined} rawModel - Raw model name or identifier
 * @returns {string} Formatted label (e.g. 'Gemini 3.8 Flash') or empty string
 */
export function formatAiModelName(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return '';
  const m = rawModel.trim().toLowerCase();

  const tier = m.includes('pro')
    ? 'Pro'
    : m.includes('lite')
      ? 'Flash-Lite'
      : 'Flash';
  const suffix = m.includes('image')
    ? ' Image'
    : m.includes('tts')
      ? ' TTS'
      : '';

  if (m.includes('imagen')) {
    if (m.includes('4')) return 'Imagen 4';
    if (m.includes('3')) return 'Imagen 3';
    return 'Gemini Imagen';
  }
  if (m.includes('3.8') || m.includes('3-8')) return `Gemini 3.8 ${tier}${suffix}`;
  if (m.includes('3.6') || m.includes('3-6')) return `Gemini 3.6 ${tier}${suffix}`;
  if (m.includes('3.1') || m.includes('3-1')) return `Gemini 3.1 ${tier}${suffix}`;
  if (m.includes('3.0') || m.includes('3-0')) return `Gemini 3.0 ${tier}${suffix}`;
  if (m.includes('2.5') || m.includes('2-5')) return `Gemini 2.5 ${tier}${suffix}`;
  if (m.includes('2.0') || m.includes('2-0')) return `Gemini 2.0 ${tier}${suffix}`;
  if (m.includes('1.5') || m.includes('1-5')) return `Gemini 1.5 ${tier}${suffix}`;
  if (m.includes('gemini')) {
    return rawModel
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return rawModel;
}

/**
 * Returns true when a model identifier refers to a paid/Gemini/Imagen model
 * (as opposed to free HF Flux / Pollinations / Edge models).
 *
 * @param {string|null|undefined} rawModel
 * @returns {boolean}
 */
export function isGeminiModel(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return false;
  return /gemini|imagen/i.test(rawModel);
}

/**
 * Formats a USD cost number into clean decimal digits (without the '$' prefix),
 * matching the precision convention across ChroniX (`0.039` for >= $0.01, `0.0018` for < $0.01).
 *
 * @param {number|string|null|undefined} costUsd
 * @returns {string}
 */
export function formatUsdDigits(costUsd) {
  const num = Number(costUsd);
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num < 0.0001) return num.toFixed(5);
  return num < 0.01 ? num.toFixed(4) : num.toFixed(3);
}

/**
 * Builds a localized cost breakdown string (Script + Audio) for a podcast episode,
 * or returns null when no cost metadata is present on the episode.
 *
 * @param {object|null|undefined} episode
 * @param {function} t - Localization function `t(key, vars)`
 * @param {string|null} [activeEngine=null] - Currently selected playback engine (if in player)
 * @returns {string|null}
 */
export function formatPodcastCostBreakdown(episode, t, activeEngine = null) {
  if (!episode || typeof t !== 'function') return null;

  const rawScript = episode.script_cost_usd ?? episode.tokenUsage?.estimatedCostUsd;
  const hasScriptCost = rawScript !== null && rawScript !== undefined && Number.isFinite(Number(rawScript));
  const scriptCost = hasScriptCost ? Number(rawScript) : null;

  const geminiAudio = episode.audio?.gemini || null;
  const hasGeminiAudioCost = Boolean(geminiAudio && Number(geminiAudio.cost_usd) > 0);
  const useGeminiAudio = activeEngine
    ? activeEngine === 'gemini'
    : (episode.default_engine === 'gemini' || Boolean(geminiAudio?.unlocked && (hasGeminiAudioCost || geminiAudio?.status === 'rendering')));

  if (useGeminiAudio) {
    const audioCost = Number(geminiAudio?.cost_usd || 0);
    const isRendering = geminiAudio?.status === 'rendering';
    const done = Number(geminiAudio?.rendered_clips ?? Object.keys(geminiAudio?.clips || {}).length);
    const total = Number(episode.segments?.length || 0);

    if (scriptCost !== null && (scriptCost > 0 || audioCost > 0 || isRendering)) {
      if (isRendering && total > 0 && done < total) {
        return t('podcast.costBreakdownGeminiRendering', {
          scriptCost: formatUsdDigits(scriptCost),
          audioCost: formatUsdDigits(audioCost),
          done,
          total,
        });
      }
      return t('podcast.costBreakdownGemini', {
        scriptCost: formatUsdDigits(scriptCost),
        audioCost: formatUsdDigits(audioCost),
        totalCost: formatUsdDigits(scriptCost + audioCost),
      });
    }

    if (audioCost > 0 || isRendering) {
      return t('podcast.costBreakdownGeminiAudioOnly', {
        audioCost: formatUsdDigits(audioCost),
      });
    }
    return null;
  }

  if (scriptCost !== null && scriptCost > 0) {
    return t('podcast.costBreakdownFreeAudio', {
      scriptCost: formatUsdDigits(scriptCost),
    });
  }

  return null;
}

export const PODCAST_FOCUSED_MAX_EVENTS = 12;

export const DEFAULT_CREDIT_COSTS = Object.freeze({
  text: 1,
  upload_medium: 2,
  upload_heavy: 3,
  gemini_image: 6,
  gemini_audio: 10,
  gemini_audio_full: 20,
});

/**
 * Resolves the active integer credit weights from `/api/user/quota` (falling back to defaults:
 * 1 for text/voice/light uploads, 2-3 for larger uploads, 6 for Gemini image,
 * 10 for Highlights/short Gemini podcast audio, 20 for Full-story Gemini podcast audio).
 *
 * @param {object|null|undefined} quota
 * @returns {{ text: number, upload_medium: number, upload_heavy: number, gemini_image: number, gemini_audio: number, gemini_audio_full: number }}
 */
export function getCreditCosts(quota) {
  const c = quota?.credit_costs;
  const text = Number(c?.text);
  const uploadMedium = Number(c?.upload_medium);
  const uploadHeavy = Number(c?.upload_heavy);
  const geminiImage = Number(c?.gemini_image);
  const geminiAudio = Number(c?.gemini_audio);
  const geminiAudioFull = Number(c?.gemini_audio_full);
  return {
    text: Number.isFinite(text) && text > 0 ? Math.round(text) : DEFAULT_CREDIT_COSTS.text,
    upload_medium:
      Number.isFinite(uploadMedium) && uploadMedium > 0
        ? Math.round(uploadMedium)
        : DEFAULT_CREDIT_COSTS.upload_medium,
    upload_heavy:
      Number.isFinite(uploadHeavy) && uploadHeavy > 0
        ? Math.round(uploadHeavy)
        : DEFAULT_CREDIT_COSTS.upload_heavy,
    gemini_image:
      Number.isFinite(geminiImage) && geminiImage > 0
        ? Math.round(geminiImage)
        : DEFAULT_CREDIT_COSTS.gemini_image,
    gemini_audio:
      Number.isFinite(geminiAudio) && geminiAudio > 0
        ? Math.round(geminiAudio)
        : DEFAULT_CREDIT_COSTS.gemini_audio,
    gemini_audio_full:
      Number.isFinite(geminiAudioFull) && geminiAudioFull > 0
        ? Math.round(geminiAudioFull)
        : DEFAULT_CREDIT_COSTS.gemini_audio_full,
  };
}

/**
 * Counts timeline-event chapters in a podcast episode (excluding intro/outro).
 * Returns `null` when segment metadata is unavailable.
 *
 * @param {object|null|undefined} episode
 * @returns {number|null}
 */
export function countEpisodeEventSegments(episode) {
  const segs = episode?.segments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  let count = 0;
  for (const seg of segs) {
    if (seg && (seg.type === 'event' || Boolean(seg.event_id))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Resolves the Gemini TTS audio credit cost for a podcast episode/configuration:
 * - 'focused' ("Highlights") OR short timelines/episodes (<= 12 events) -> `gemini_audio` (10)
 * - 'full' ("Full story") with > 12 events -> `gemini_audio_full` (20)
 *
 * @param {object|null|undefined} quota
 * @param {object} [options]
 * @param {string} [options.length='focused']
 * @param {number|null} [options.eventCount=null]
 * @returns {number}
 */
export function getPodcastAudioCreditCost(
  quota,
  { length = 'focused', eventCount = null } = {},
) {
  const costs = getCreditCosts(quota);
  const normLength = String(length || 'focused').trim().toLowerCase();
  const numericEvents =
    eventCount !== null && eventCount !== undefined && Number.isFinite(Number(eventCount))
      ? Number(eventCount)
      : null;
  if (
    normLength === 'focused' ||
    (numericEvents !== null && numericEvents <= PODCAST_FOCUSED_MAX_EVENTS)
  ) {
    return costs.gemini_audio;
  }
  return costs.gemini_audio_full;
}

/**
 * Returns the user's finite remaining daily premium AI credits (0 when exhausted/free mode,
 * positive integer in limited mode, or `null` when quota is loading / unlimited / admin).
 *
 * @param {object|null|undefined} quota
 * @returns {number|null}
 */
export function getRemainingPaidCredits(quota) {
  if (!quota || typeof quota !== 'object' || quota.is_admin === true) return null;
  if (
    quota.tier === 'free' ||
    quota.mode === 'free' ||
    quota.community_pool_exhausted === true ||
    quota.community_pool?.exhausted === true
  ) {
    return 0;
  }
  const limit = Number(quota.daily_paid_limit);
  const remaining = Number(quota.remaining_paid);
  if (Number.isFinite(limit) && limit > 0) {
    if (Number.isFinite(remaining)) {
      return Math.max(0, Math.floor(remaining));
    }
    const used = Number(quota.used_today);
    if (Number.isFinite(used)) {
      return Math.max(0, Math.floor(limit - used));
    }
  }
  return null;
}

/**
 * Returns true when the current user has no personal Gemini API key, is not an admin,
 * and does not have enough server-side premium AI credits (`requiredCredits`, default 1)
 * to run a premium Gemini image or audio generation.
 *
 * Returns false while `quota` is null/undefined (still loading) so controls don't flash locked.
 *
 * @param {object|null|undefined} quota - Quota payload from `/api/user/quota`
 * @param {object} [options]
 * @param {boolean} [options.isAdmin=false]
 * @param {boolean} [options.hasCustomKey=false]
 * @param {number} [options.requiredCredits=1]
 * @returns {boolean}
 */
export function isPremiumCreditsExhausted(
  quota,
  { isAdmin = false, hasCustomKey = false, requiredCredits = 1 } = {},
) {
  if (isAdmin || hasCustomKey || quota?.is_admin === true) return false;
  if (!quota || typeof quota !== 'object') return false;

  if (
    quota.tier === 'free' ||
    quota.mode === 'free' ||
    quota.community_pool_exhausted === true ||
    quota.community_pool?.exhausted === true
  ) {
    return true;
  }

  const limit = Number(quota.daily_paid_limit);
  const remaining = Number(quota.remaining_paid);
  if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
    return remaining < Math.max(1, Number(requiredCredits) || 1);
  }

  return false;
}
