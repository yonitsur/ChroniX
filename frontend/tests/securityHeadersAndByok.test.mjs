import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isByokRoute, apiRelativePath, BYOK_ROUTES } from '../src/utils/byokRoutes.js';
import { randomHexId } from '../src/utils/randomId.js';
import { STORY_BLUEPRINTS, buildStoryTimeline, emptyStoryAnswers } from '../src/data/storyBlueprints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');

const vercelHeaders = () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, 'vercel.json'), 'utf8'));
  return Object.fromEntries(cfg.headers.flatMap((h) => h.headers || []).map((h) => [h.key, h.value]));
};
const cspDirectives = () => Object.fromEntries(
  vercelHeaders()['Content-Security-Policy'].split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [name, ...vals] = d.split(/\s+/); return [name, vals]; }),
);

test('CSP script-src allows no inline scripts and no blanket https:', () => {
  const csp = cspDirectives();
  const script = csp['script-src'];
  assert.ok(script.includes("'self'"));
  assert.ok(!script.includes("'unsafe-inline'"));
  assert.ok(!script.includes("'unsafe-eval'"));
  assert.ok(!script.includes('https:') && !script.includes('*'));
  assert.ok(script.includes('https://accounts.google.com/gsi/client'));
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
});

test('CSP connect-src is an explicit allow-list without localhost', () => {
  const connect = cspDirectives()['connect-src'];
  for (const banned of ['https:', 'wss:', 'http:', 'ws:']) assert.ok(!connect.includes(banned), banned);
  assert.ok(!connect.some((src) => src.includes('localhost')));
  for (const needed of ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://chronix-cfby.onrender.com', 'data:', 'blob:']) {
    assert.ok(connect.includes(needed), needed);
  }
  assert.ok(!connect.includes('https://*.onrender.com'));
});

test('vercel.json sends HSTS, Permissions-Policy, nosniff, referrer policy and frame protection', () => {
  const h = vercelHeaders();
  assert.match(h['Strict-Transport-Security'], /max-age=\d{8,}/);
  assert.match(h['Permissions-Policy'], /camera=\(self\)/);
  assert.match(h['Permissions-Policy'], /microphone=\(self\)/);
  assert.match(h['Permissions-Policy'], /geolocation=\(\)/);
  assert.match(h['Permissions-Policy'], /fullscreen=\(self "https:\/\/www\.youtube\.com"/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.ok(h['Referrer-Policy']);
  assert.deepEqual(cspDirectives()['frame-ancestors'], ["'self'"]);
});

test('index.html and the share fallback page contain no inline scripts', () => {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc=/, tag);
  assert.ok(fs.existsSync(path.join(FRONTEND_DIR, 'public', 'theme-init.js')));
  const share = fs.readFileSync(path.join(FRONTEND_DIR, 'api', 'share.js'), 'utf8');
  assert.ok(!/<script>/.test(share));
});

test('BYOK header goes only to the AI routes that use it', () => {
  const ai = [
    ['POST', '/api/timeline/generate/start'],
    ['POST', '/api/timeline/generate-from-files/start'],
    ['POST', '/api/timeline/refine/start'],
    ['POST', '/api/timeline/chat/start'],
    ['POST', '/api/timeline/chat/attach-files'],
    ['POST', '/api/timeline/quiz/start'],
    ['POST', '/api/timeline/whoami/start'],
    ['POST', '/api/timeline/suggest-event'],
    ['POST', '/api/timeline/generate-event-image'],
    ['POST', '/api/timeline/reverse-geocode'],
    ['POST', '/api/text/polish'],
    ['POST', '/api/story/overview'],
    ['POST', '/api/story/photo-drafts'],
    ['GET', '/api/story/photo-import/limits'],
    ['POST', '/api/google-photos/sessions'],
    ['GET', '/api/podcast/voice-preview?engine=gemini'],
    ['POST', '/api/timelines/abc-1/podcasts/start'],
    ['POST', '/api/timelines/abc-1/podcasts/ep1/audio'],
    ['GET', '/api/timelines/abc-1/podcasts/ep1/segments/seg-1/clip?engine=edge'],
    ['GET', '/api/timelines/abc%2F1/podcasts/ep1/download?engine=edge'],
  ];
  for (const [method, url] of ai) assert.equal(isByokRoute(method, url, '/api'), true, `${method} ${url}`);
  // Absolute API base (Render) works the same.
  assert.equal(isByokRoute('POST', 'https://api.example.com/api/text/polish', 'https://api.example.com/api'), true);

  const notAi = [
    ['GET', '/api/timeline/job/status/123'],
    ['POST', '/api/timeline/job/cancel/123'],
    ['GET', '/api/timelines'],
    ['GET', '/api/timelines/abc-1'],
    ['POST', '/api/timelines'],
    ['DELETE', '/api/timelines/abc-1'],
    ['PATCH', '/api/timelines/abc-1/share'],
    ['GET', '/api/library?lang=en'],
    ['GET', '/api/user/quota'],
    ['GET', '/api/timelines/abc-1/podcasts'],
    ['GET', '/api/timelines/abc-1/podcasts/ep1'],
    ['GET', '/api/timelines/abc-1/podcasts/ep1/episode-audio'],
    ['POST', '/api/photos'],
    ['GET', '/api/media/youtube-search?q=x'],
    ['GET', '/api/timeline/wiki-search?query=x'],
    ['POST', '/api/activity/game'],
    ['GET', '/api/timeline/quiz/start'],
    ['POST', '/api/timelines/abc-1/podcasts/start/extra'],
    ['POST', 'https://evil.example/elsewhere/text/polish'],
  ];
  for (const [method, url] of notAi) assert.equal(isByokRoute(method, url, '/api'), false, `${method} ${url}`);
  assert.equal(apiRelativePath('/apix/text/polish', '/api'), null);
  assert.ok(BYOK_ROUTES.length >= 20);
});

test('api.js attaches the BYOK key only through the route check', () => {
  const src = fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'api.js'), 'utf8');
  const keyHeaderUses = src.match(/'X-Gemini-Api-Key'/g) || [];
  assert.equal(keyHeaderUses.length, 2); // both inside withByokKey
  const wrapper = src.slice(src.indexOf('const withByokKey'), src.indexOf('const fetch = async'));
  assert.match(wrapper, /isByokRoute\(/);
  const getHeaders = src.slice(src.indexOf('const getHeaders = async'), src.indexOf('const getExistingAccountAuthHeaders'));
  assert.ok(!getHeaders.includes('getApiKey('));
});

test('new local timeline ids carry 128 random bits', () => {
  const ids = new Set(Array.from({ length: 500 }, () => randomHexId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
  const bp = STORY_BLUEPRINTS[0];
  const { timeline } = buildStoryTimeline(bp, { ...emptyStoryAnswers(bp), title: 'My Family' }, { lang: 'en' });
  assert.match(timeline.id, /^[0-9a-f]{32}-my-family$/);
});
