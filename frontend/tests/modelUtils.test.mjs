import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countEpisodeEventSegments,
  DEFAULT_CREDIT_COSTS,
  formatAiModelName,
  formatPodcastCostBreakdown,
  formatUsdDigits,
  getCreditCosts,
  getPodcastAudioCreditCost,
  getRemainingPaidCredits,
  isGeminiModel,
  isPremiumCreditsExhausted,
  PODCAST_FOCUSED_MAX_EVENTS,
} from '../src/utils/modelUtils.js';

const mockT = (key, vars = {}) => {
  const templates = {
    'podcast.costBreakdownGemini': `Gemini cost — Script: ~$${vars.scriptCost} + Audio: ~$${vars.audioCost} (total ~$${vars.totalCost})`,
    'podcast.costBreakdownGeminiRendering': `Gemini cost — Script: ~$${vars.scriptCost} + Audio: ~$${vars.audioCost} (rendering ${vars.done}/${vars.total}…)`,
    'podcast.costBreakdownGeminiAudioOnly': `Gemini audio cost: ~$${vars.audioCost}`,
    'podcast.costBreakdownFreeAudio': `Generation cost — Script (Gemini): ~$${vars.scriptCost} + Audio: Free ($0)`,
  };
  return templates[key] || key;
};

describe('formatAiModelName', () => {
  it('formats gemini 3.8 flash correctly', () => {
    assert.equal(formatAiModelName('gemini-3.8-flash'), 'Gemini 3.8 Flash');
    assert.equal(formatAiModelName('gemini-3-8-flash'), 'Gemini 3.8 Flash');
  });

  it('formats gemini 3.6 flash correctly', () => {
    assert.equal(formatAiModelName('gemini-3.6-flash'), 'Gemini 3.6 Flash');
    assert.equal(formatAiModelName('gemini-3-6-flash'), 'Gemini 3.6 Flash');
  });

  it('formats gemini 2.5 flash correctly', () => {
    assert.equal(formatAiModelName('gemini-2.5-flash'), 'Gemini 2.5 Flash');
  });

  it('formats image, tts, and imagen models gracefully', () => {
    assert.equal(formatAiModelName('gemini-3.1-flash-image'), 'Gemini 3.1 Flash Image');
    assert.equal(formatAiModelName('gemini-3.8-flash-tts'), 'Gemini 3.8 Flash TTS');
    assert.equal(formatAiModelName('imagen-3.0-generate-002'), 'Imagen 3');
    assert.equal(formatAiModelName('gemini-1.5-pro'), 'Gemini 1.5 Pro');
    assert.equal(formatAiModelName('gemini-custom-model'), 'Gemini Custom Model');
  });

  it('handles null, undefined, and non-string inputs safely', () => {
    assert.equal(formatAiModelName(null), '');
    assert.equal(formatAiModelName(undefined), '');
    assert.equal(formatAiModelName(''), '');
    assert.equal(formatAiModelName(123), '');
  });
});

describe('isGeminiModel & formatUsdDigits', () => {
  it('distinguishes paid Gemini/Imagen models from free image/audio engines', () => {
    assert.equal(isGeminiModel('gemini-3.1-flash-image'), true);
    assert.equal(isGeminiModel('imagen-3.0-generate-002'), true);
    assert.equal(isGeminiModel('gemini:imagen'), true);
    assert.equal(isGeminiModel('FLUX.1-schnell'), false);
    assert.equal(isGeminiModel('pollinations-flux'), false);
    assert.equal(isGeminiModel(null), false);
  });

  it('formats USD precision cleanly', () => {
    assert.equal(formatUsdDigits(0.03912), '0.039');
    assert.equal(formatUsdDigits(0.00184), '0.0018');
    assert.equal(formatUsdDigits(0), '0');
    assert.equal(formatUsdDigits(null), '0');
  });
});

describe('formatPodcastCostBreakdown', () => {
  it('formats script + Gemini audio cost when ready', () => {
    const ep = {
      default_engine: 'gemini',
      script_cost_usd: 0.0018,
      segments: [{ id: '1' }, { id: '2' }],
      audio: {
        gemini: { status: 'ready', unlocked: true, cost_usd: 0.042, rendered_clips: 2 },
      },
    };
    assert.equal(
      formatPodcastCostBreakdown(ep, mockT, 'gemini'),
      'Gemini cost — Script: ~$0.0018 + Audio: ~$0.042 (total ~$0.044)'
    );
  });

  it('formats live rendering progress while Gemini audio chapters are still being produced', () => {
    const ep = {
      default_engine: 'gemini',
      script_cost_usd: 0.0018,
      segments: [{ id: '1' }, { id: '2' }, { id: '3' }],
      audio: {
        gemini: { status: 'rendering', unlocked: true, cost_usd: 0.014, rendered_clips: 1 },
      },
    };
    assert.equal(
      formatPodcastCostBreakdown(ep, mockT, 'gemini'),
      'Gemini cost — Script: ~$0.0018 + Audio: ~$0.014 (rendering 1/3…)'
    );
  });

  it('formats script cost + free ($0) audio when using free TTS voices', () => {
    const ep = {
      default_engine: 'edge',
      script_cost_usd: 0.0021,
      segments: [{ id: '1' }],
      audio: {
        edge: { status: 'ready', unlocked: true, cost_usd: 0 },
      },
    };
    assert.equal(
      formatPodcastCostBreakdown(ep, mockT, 'edge'),
      'Generation cost — Script (Gemini): ~$0.0021 + Audio: Free ($0)'
    );
  });

  it('returns null for legacy episodes with no cost metadata', () => {
    const ep = {
      default_engine: 'edge',
      segments: [{ id: '1' }],
      audio: { edge: { status: 'ready', unlocked: true } },
    };
    assert.equal(formatPodcastCostBreakdown(ep, mockT, 'edge'), null);
  });
});

describe('isPremiumCreditsExhausted', () => {
  it('never blocks admins or users with a personal Gemini API key', () => {
    const zeroQuota = { is_admin: false, tier: 'free', mode: 'limited', daily_paid_limit: 10, remaining_paid: 0 };
    assert.equal(isPremiumCreditsExhausted(zeroQuota, { isAdmin: true }), false);
    assert.equal(isPremiumCreditsExhausted({ ...zeroQuota, is_admin: true }), false);
    assert.equal(isPremiumCreditsExhausted(zeroQuota, { hasCustomKey: true }), false);
    assert.equal(isPremiumCreditsExhausted(null), false);
  });

  it('blocks when daily paid credits hit 0, server is in free mode, or community pool is exhausted', () => {
    assert.equal(
      isPremiumCreditsExhausted({ tier: 'free', mode: 'limited', daily_paid_limit: 10, remaining_paid: 0 }),
      true,
    );
    assert.equal(
      isPremiumCreditsExhausted({ tier: 'free', mode: 'free', daily_paid_limit: -1, remaining_paid: -1 }),
      true,
    );
    assert.equal(
      isPremiumCreditsExhausted({ tier: 'free', mode: 'unlimited', community_pool_exhausted: true }),
      true,
    );
  });

  it('respects weighted requiredCredits (1 text, 6 Gemini image, 10 Gemini audio, 11 new Gemini podcast)', () => {
    const fiveCreditsLeft = { tier: 'paid', mode: 'limited', daily_paid_limit: 25, remaining_paid: 5 };
    assert.equal(isPremiumCreditsExhausted(fiveCreditsLeft, { requiredCredits: 1 }), false);
    assert.equal(isPremiumCreditsExhausted(fiveCreditsLeft, { requiredCredits: 6 }), true);
    assert.equal(isPremiumCreditsExhausted(fiveCreditsLeft, { requiredCredits: 10 }), true);
    assert.equal(isPremiumCreditsExhausted(fiveCreditsLeft, { requiredCredits: 11 }), true);

    const eightCreditsLeft = { tier: 'paid', mode: 'limited', daily_paid_limit: 25, remaining_paid: 8 };
    assert.equal(isPremiumCreditsExhausted(eightCreditsLeft, { requiredCredits: 6 }), false);
    assert.equal(isPremiumCreditsExhausted(eightCreditsLeft, { requiredCredits: 10 }), true);

    const elevenCreditsLeft = { tier: 'paid', mode: 'limited', daily_paid_limit: 25, remaining_paid: 11 };
    assert.equal(isPremiumCreditsExhausted(elevenCreditsLeft, { requiredCredits: 10 }), false);
    assert.equal(isPremiumCreditsExhausted(elevenCreditsLeft, { requiredCredits: 11 }), false);

    const unlimitedActive = { tier: 'unlimited', mode: 'unlimited', daily_paid_limit: -1, remaining_paid: -1 };
    assert.equal(isPremiumCreditsExhausted(unlimitedActive, { requiredCredits: 11 }), false);
  });
});

describe('getCreditCosts, getPodcastAudioCreditCost & getRemainingPaidCredits', () => {
  it('returns default 1 / 2 / 3 / 6 / 10 / 20 credit weights when quota omits credit_costs', () => {
    assert.deepEqual(getCreditCosts(null), DEFAULT_CREDIT_COSTS);
    assert.deepEqual(getCreditCosts({ daily_paid_limit: 25 }), {
      text: 1,
      upload_medium: 2,
      upload_heavy: 3,
      gemini_image: 6,
      gemini_audio: 10,
      gemini_audio_full: 20,
    });
  });

  it('reads server-configured integer credit weights from quota.credit_costs', () => {
    assert.deepEqual(
      getCreditCosts({
        credit_costs: {
          text: 2,
          upload_medium: 3,
          upload_heavy: 4,
          gemini_image: 5,
          gemini_audio: 12,
          gemini_audio_full: 24,
        },
      }),
      {
        text: 2,
        upload_medium: 3,
        upload_heavy: 4,
        gemini_image: 5,
        gemini_audio: 12,
        gemini_audio_full: 24,
      },
    );
  });

  it('prices Full story at 20 credits only when > 12 events, and protects <= 12-event timelines at 10 credits', () => {
    assert.equal(PODCAST_FOCUSED_MAX_EVENTS, 12);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'focused', eventCount: 20 }), 10);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'full', eventCount: 18 }), 20);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'full', eventCount: 13 }), 20);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'full', eventCount: 12 }), 10);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'full', eventCount: 5 }), 10);
    assert.equal(getPodcastAudioCreditCost(null, { length: 'full', eventCount: null }), 20);
  });

  it('counts event chapters accurately while excluding intro and outro', () => {
    assert.equal(countEpisodeEventSegments(null), null);
    assert.equal(countEpisodeEventSegments({ segments: [] }), null);
    assert.equal(
      countEpisodeEventSegments({
        segments: [
          { id: '1', type: 'intro', event_id: null },
          { id: '2', type: 'event', event_id: 'evt-1' },
          { id: '3', type: 'event', event_id: 'evt-2' },
          { id: '4', type: 'outro', event_id: null },
        ],
      }),
      2,
    );
  });

  it('computes remaining paid credits cleanly across limited, exhausted, unlimited, and null quotas', () => {
    assert.equal(getRemainingPaidCredits(null), null);
    assert.equal(getRemainingPaidCredits({ daily_paid_limit: -1, remaining_paid: -1 }), null);
    assert.equal(getRemainingPaidCredits({ tier: 'free', mode: 'limited', daily_paid_limit: 25, remaining_paid: 0 }), 0);
    assert.equal(getRemainingPaidCredits({ daily_paid_limit: 25, remaining_paid: 7 }), 7);
    assert.equal(getRemainingPaidCredits({ daily_paid_limit: 25, used_today: 19 }), 6);
  });
});
