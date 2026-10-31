// Mocked ChroniX backend + Supabase guest auth for podcast end-to-end tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MP3 = readFileSync(fileURLToPath(new URL('./fixtures/silence-3s.mp3', import.meta.url)));
const KEY = (n) => String(n).repeat(64).slice(0, 64);

export const timeline = (id, isOwner, articleCount = 2) => ({
  id,
  title: 'Space Race',
  description: 'From Sputnik to the Moon',
  detectedLanguage: 'en',
  timeScale: 'calendar',
  isOwner,
  isShared: true,
  lanes: [],
  articles:
    articleCount === 2
      ? [
          { id: 'evt-1', title: 'Sputnik', from: { year: 1957 }, rank: 8 },
          { id: 'evt-2', title: 'Apollo 11', from: { year: 1969 }, rank: 9 },
        ]
      : Array.from({ length: articleCount }, (_, idx) => ({
          id: `evt-${idx + 1}`,
          title: `Milestone ${idx + 1}`,
          from: { year: 1955 + idx },
          rank: 8,
        })),
});

export const episode = (id, timelineId) => ({
  id,
  timeline_id: timelineId,
  title: 'Race to the Moon',
  format: 'single',
  voice_gender: 'male',
  length: 'focused',
  content_mode: 'classic',
  default_engine: 'edge',
  host1_name: 'Michael',
  host2_name: null,
  detected_language: 'en',
  music_mood: 'sunrise_piano',
  source: 'generated',
  created_at: '2026-10-24T10:00:00Z',
  is_mine: true,
  can_manage: true,
  estimates: {},
  audio: { edge: { status: 'ready', unlocked: true, clips: {}, total_duration: 9 } },
  segments: [
    { id: 'seg-1', type: 'intro', event_id: null, chapter_title: 'Opening', turns: [{ speaker: 'host1', text: 'Welcome aboard. Our journey starts now.' }] },
    { id: 'seg-2', type: 'event', event_id: 'evt-1', chapter_title: 'Beep from orbit', turns: [{ speaker: 'host1', text: 'In 1957 a small sphere changed everything.' }] },
    { id: 'seg-3', type: 'outro', event_id: null, chapter_title: 'Legacy', turns: [{ speaker: 'host1', text: 'Thanks for listening.' }] },
  ],
});

export async function mockBackend(page, { timelineId, isOwner, episodes, quota = null, articleCount = 2 }) {
  const calls = { clips: [], listen: [], start: 0, download: 0 };
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
  // Anonymous guest session (the app signs in anonymously before calling the API).
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated', is_anonymous: true })}.sig`;
  await page.route(/\/auth\/v1\/(signup|token)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user }),
  }));
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === `/timelines/${timelineId}`) return json(timeline(timelineId, isOwner, articleCount));
    if (path === `/timelines/${timelineId}/podcasts`) return json({ episodes });
    if (path === '/podcast/options') {
      return json({ language: 'en', engines: [
        { id: 'edge', tier: 'standard', available: true, reason: null },
        { id: 'gcloud', tier: 'cloud', available: true, reason: null },
        { id: 'gemini', tier: 'premium', available: true, requires_quota: true },
      ] });
    }
    const clipMatch = path.match(/\/podcasts\/([^/]+)\/segments\/(seg-\d)\/clip$/);
    if (clipMatch) {
      const n = Number(clipMatch[2].split('-')[1]);
      calls.clips.push(clipMatch[2]);
      const ep = episodes[0] || episode('ep-new', timelineId);
      const text = ep.segments[n - 1].turns[0].text;
      const [first, ...rest] = text.split('. ');
      return json({
        key: KEY(n),
        url: `/api/podcast-audio/${KEY(n)}.mp3`,
        duration: 3,
        engine: 'edge',
        fallback_from: null,
        turn_starts: [0],
        sentences: [
          { start: 0, end: 1.5, turn: 0, text: rest.length ? `${first}.` : first },
          ...(rest.length ? [{ start: 1.5, end: 3, turn: 0, text: rest.join('. ') }] : []),
        ],
      });
    }
    if (/\/podcasts\/[^/]+\/download$/.test(path)) {
      calls.download += 1;
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: MP3,
        headers: { 'Content-Disposition': "attachment; filename=\"chronix-podcast.mp3\"; filename*=UTF-8''Race%20to%20the%20Moon.mp3" },
      });
    }
    if (path.startsWith('/podcast-audio/')) {
      return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3, headers: { 'Accept-Ranges': 'bytes' } });
    }
    if (path === `/timelines/${timelineId}/podcasts/start`) {
      calls.start += 1;
      return json({ job_id: 'job-1', status: 'pending' });
    }
    if (path === '/timeline/job/status/job-1') {
      return json({ status: 'done', result: { episode: { ...episode('ep-new', timelineId), audio: {} }, notice: null } });
    }
    if (path === '/activity/podcast') {
      calls.listen.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (path === '/user/quota') {
      return json(
        quota || {
          is_admin: false,
          daily_paid_limit: 25,
          used_today: 1,
          remaining_paid: 24,
          tier: 'paid',
          mode: 'limited',
          credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
        },
      );
    }
    if (path === '/guest-policy') {
      return json({
        guest_api_key_mode: 'limited',
        guest_daily_limit: 10,
        credit_costs: { text: 1, gemini_image: 6, gemini_audio: 10, gemini_audio_full: 20 },
      });
    }
    if (path === '/health') return json({ status: 'ok' });
    return json({ detail: 'not mocked' }, 404);
  });
  return calls;
}
