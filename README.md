# ChroniX

Interactive, AI-powered visual timeline engine. ChroniX transforms topics, queries, voice prompts, photos, raw text, and documents into rich, multi-dimensional timelines featuring parallel swimlanes, synchronized geographic maps, encyclopedic & YouTube media enrichment, AI-generated illustrations, conversational exploration, personal/family timeline builders, a tailored Kids mode, and a 7-game interactive learning hub.

---

## Overview

Traditional timelines flatten history into static, one-dimensional lists. ChroniX renders complex chronological narratives as continuous, interactive canvases powered by the Histropedia rendering engine and Google Gemini AI.

Whether exploring global geopolitical conflicts, scientific revolutions, literary movements, fictional lore, or crafting a personal family saga from memoirs and family photos, ChroniX structures eras into parallel tracks, cross-checks facts via live search grounding, pairs events with verified Wikimedia imagery, YouTube documentaries, and AI illustrations, and maps milestones across the globe.

---

## Core Capabilities

- **AI Chronological Structuring**: Generates multi-era, milestone-accurate timelines with autonomous density calibration (10 to 50+ milestones based on breadth and complexity) and precision ranging from billions of years ago down to the exact minute.
- **Multimodal Timeline Creation (Text, Voice, Photo & Documents)**:
  - **Text & Voice Prompts**: Type any topic or dictate directly via built-in speech-to-text microphone input.
  - **Camera & Photo Prompts**: Snap a photo with your camera or upload an image of an artifact, monument, book cover, artwork, or historical page to generate a timeline around it.
  - **Files, PDFs & Raw Text Extraction**: Upload up to 20 files (PDF documents, scanned pages, `JPG`/`PNG`/`WEBP`/`HEIC` images) or paste raw text (memoirs, diaries, biographies, study notes) to extract events strictly from your source material.
- **Personal & Family Timelines ("Build Your Own")**:
  - Create custom timelines for life stories, family trees, family sagas, or personal projects from a blank canvas or ready-made templates (*Family Story*, *Life Story*, *Family Tree*).
  - Built-in privacy & hallucination safeguards (`subjectStatus: unknown`): when queried about private individuals with no reliable public record, ChroniX never fabricates facts, does not charge daily quota, and invites you to build from your own documents, text, or templates.
- **General & Kids Modes**:
  - Switch between **General** mode (clean Classic design) and **Kids** mode (ages 8–11 reading level in a colorful Playful 3D-toy design), adapting language, narrative tone, and visual presentation end-to-end across AI timelines, chat, event suggestions, quizzes, mystery games, illustrations, podcasts, and curated example prompts.
- **Interactive Timeline Games Hub (7 Built-In Games)**:
  - **Trivia Quiz**: AI-generated multiple-choice questions on causal links and turning points, with instant explanations and one-click focus on the timeline.
  - **Build the Sequence**: Drag-and-drop chronological ordering challenge starting from an anchor event.
  - **Where & When (TimeGuesser)**: Combined year-slider and interactive map pin-drop challenge scored on temporal and spatial accuracy.
  - **What Event Am I?**: AI-generated 5-clue progressive mystery deduction game ordered from hardest to easiest.
  - **Timeline Wordle**: 6-try letter-guessing game for key figures and terms from the timeline (with Hebrew final-letter normalization and hints).
  - **Timeline Puzzle**: Interactive jigsaw tile puzzle using event photos from the timeline or freshly generated AI artwork across Easy, Medium, and Hard difficulties.
  - **Timeline Memory**: Flip-card matching game pairing event photos with their corresponding titles and years (*Smart Match* or *Identical Images*).
- **Encyclopedic Media, AI Image Generation & Galleries**:
  - Automatically fetches public-domain photography, artwork, and article summaries through Wikimedia Commons and Wikipedia REST APIs.
  - **On-Demand & Fallback AI Image Generation**: Generate custom illustrations via Gemini Image models in multiple artistic styles (*Auto*, *Historical*, *Classical Painting*, *Illustration*, *Cinematic*) — ideal for ancient eras, unphotographed milestones, or fictional worlds.
  - Multi-photo event galleries with custom captions, cover selection, and animated GIF playback controls.
- **YouTube Video & Documentary Integration**:
  - Dedicated **Videos** tab inside the Event Details drawer that discovers and embeds relevant documentaries, lectures, and educational explainers via the official YouTube player (backed by a 30-day Supabase & in-memory search cache).
- **Listen: AI-Narrated Podcast Tours**:
  - One tap turns a timeline into a narrated audio episode (solo narrator or two hosts, *Highlights* or *Full story*); the timeline, map and event drawer follow each chapter as it plays.
  - Multiple voice options: **Standard** (free Microsoft Edge neural voices — the default), **Google Cloud** (natural WaveNet voices, when configured) and **Premium** (Gemini native audio). Voice samples are available before you generate.
  - Audio is rendered once on the server and cached, so replays, shared `?listen=1` links and MP3 downloads cost nothing extra. Once every chapter is rendered, the episode streams as one continuous file, so chapter transitions are gapless even with the screen off. Synced sentence-level subtitles, lock-screen / headphone controls (Media Session), keyboard shortcuts and listening analytics are built in.
  - **Background music**: an original ambient score composed live in the browser (no audio files or licensing) in a mood the script model picks for the episode (*Epic*, *Mysterious*, *Hopeful*, *Reflective*, *Playful*, *Somber*). It ducks under the voice, swells between chapters, and can be turned off, made louder or quieter, or switched to another mood from the player; MP3 downloads include it.
- **Synchronized Multi-Provider Geo-Mapping**:
  - Interactive Leaflet map tracks historical event coordinates alongside the timeline canvas with marker clustering, chronological journey paths, and global/conceptual event filtering.
  - Supports **Google Maps** and **Esri** (*World Canvas* & *World Atlas*) tile layers across Picture-in-Picture (PiP), Split-Screen, and Full-Screen layouts.
- **Parallel Swimlanes & Thematic Filtering**:
  - Segregates events into parallel lanes (theaters, factions, scientific disciplines, family branches) and color-coded themes with an interactive legend.
- **AI Timeline Refinement & Conversational Chat**:
  - Interrogate historical context, attach files or voice notes, or ask the integrated AI chat assistant to add, remove, split, or reorganize events live on the canvas with one-click Undo.
- **Google Search Grounding**:
  - Switch between **Fast** mode and **Verified** mode (live Google Search Grounding) to cross-reference dates, entities, and recent events with clickable web source citations.
- **Bilingual & RTL Architecture**:
  - Full localization in English and Hebrew with complete bidirectional layout support (`RTL`/`LTR`) and multilingual prompt generation in any language.
- **Responsive Dual-View Architecture**:
  - Desktop offers an expansive widescreen Histropedia canvas with parallel tracks and continuous zoom; mobile viewports provide a touch-friendly vertical Card Feed, Visual Ruler, and bottom sheets.
- **Comprehensive Export & 1-Click Sharing**:
  - Export timelines to high-resolution **PNG** snapshots, printable **PDF** reports, **Markdown (`.md`)**, **Excel / CSV** spreadsheets, **Plain Text (`.txt`)**, **JSON** datasets, or clipboard text.
  - Share public read-only interactive links (`/t/...`) with 1-click sharing to WhatsApp, Telegram, and Email.

---

## Architecture & Tech Stack

### Frontend
- **Framework**: React 19, Vite
- **Styling**: Tailwind CSS, custom CSS token system, Classic & 3D-Toy (Kids) visual themes
- **Canvas Engine**: HistropediaJS
- **Mapping**: Leaflet, Google Maps tiles, Esri World Canvas / World Atlas
- **State & Auth**: React Context API, Supabase Auth (Google OAuth, Google One Tap & Email)

### Backend
- **Framework**: Python 3.10+, FastAPI, Uvicorn
- **AI Engine**: Google Gemini API (Flash series for chronological structuring, multimodal document/image extraction, chat, quizzes & grounding; Gemini Image models for AI illustration generation; autonomous multi-key fallback rotation)
- **Enrichment**: Wikimedia Commons API, Wikipedia REST API, YouTube Data API v3, Nominatim Geocoding
- **Storage**: Supabase PostgreSQL persistence with local filesystem fallback
- **Access Control**: Multi-key paid/free fallback rotation, per-role daily fast-AI quotas, BYOK (Bring Your Own Key) support, sliding-window rate limiting

---

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+
- Google Gemini API key

### 1. Clone the Repository
```bash
git clone https://github.com/yonitsur/ChroniX.git
cd ChroniX
```

### 2. Configure Environment Variables

Create the backend environment file:
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your API credentials:
```env
# Primary paid/high-speed key
GEMINI_API_KEY=your_gemini_api_key_here

# Free tier keys (automatic round-robin fallback if paid key quota/budget is reached):
GEMINI_API_KEY_FREE=your_free_tier_gemini_key_here
GEMINI_API_KEY_FREE_1=your_second_free_key_here

# Optional: YouTube Data API v3 key for the Event Drawer's Videos tab
GCLOUD_API_KEY=your_youtube_data_api_key_here

# Optional podcast settings
# PODCAST_STORAGE_BUCKET=podcasts          # private Supabase Storage bucket for episodes & audio (auto-created)
# PODCAST_STORAGE_BACKEND=local            # force local files (backend/data/podcasts) instead of Supabase Storage
# GEMINI_TTS_MODEL=gemini-3.8-flash-tts    # preferred Gemini TTS model for Premium voices

PORT=8000
```

Frontend environment configuration (optional, for Supabase sync & map providers):
```bash
cp frontend/.env.example frontend/.env
```

### 2b. Supabase schema (required for durable AI quota tracking & cloud persistence)

First, ensure the core `public.timelines` table exists (including `is_shared`, `is_library`, and `is_featured` flags for 1-click sharing and the curated Public Library):

```sql
create table if not exists public.timelines (
  id            text        primary key,
  title         text        not null default '',
  description   text        not null default '',
  time_scale    text        not null default 'calendar',
  article_count integer     not null default 0,
  is_personal   boolean     not null default false,
  is_pinned     boolean     not null default false,
  author_name   text,
  data          jsonb       not null default '{}'::jsonb,
  user_id       uuid        references auth.users (id) on delete cascade,
  is_public     boolean     not null default false,
  is_shared     boolean     not null default false,
  is_library    boolean     not null default false,
  is_featured   boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- If upgrading an existing `timelines` table, add missing metadata, sharing & library columns:
alter table public.timelines
  add column if not exists title         text    not null default '',
  add column if not exists description   text    not null default '',
  add column if not exists time_scale    text    not null default 'calendar',
  add column if not exists article_count integer not null default 0,
  add column if not exists is_personal   boolean not null default false,
  add column if not exists is_pinned     boolean not null default false,
  add column if not exists author_name   text,
  add column if not exists is_shared     boolean not null default false,
  add column if not exists is_library    boolean not null default false,
  add column if not exists is_featured   boolean not null default false;

create index if not exists idx_timelines_user_updated
  on public.timelines (user_id, updated_at desc);

create index if not exists idx_timelines_library
  on public.timelines (is_featured desc, updated_at desc)
  where is_library = true;

alter table public.timelines enable row level security;
revoke all on public.timelines from anon, authenticated;
```

Daily AI-usage counters fall back to a local JSON file when Supabase is not configured.
That file lives on the app server's filesystem, which is **ephemeral** on hosts such as
Render or Railway - every redeploy, restart or idle spin-down wipes it and silently resets
everyone's quota. To persist counters securely, run this once in the Supabase SQL Editor:

```sql
create table if not exists public.ai_usage (
  usage_date  date    not null,
  identifier  text    not null,
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (usage_date, identifier)
);

-- Atomic increment/refund so concurrent requests can never lose a count.
-- Explicit search_path + REVOKE FROM PUBLIC/anon/authenticated ensures ONLY the backend's
-- service_role key can invoke this SECURITY DEFINER function.
create or replace function public.increment_ai_usage(
  p_date date, p_identifier text, p_delta integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare new_count integer;
begin
  insert into public.ai_usage (usage_date, identifier, count, updated_at)
  values (p_date, p_identifier, greatest(0, p_delta), now())
  on conflict (usage_date, identifier) do update
    set count = greatest(0, public.ai_usage.count + p_delta),
        updated_at = now()
  returning public.ai_usage.count into new_count;
  return new_count;
end;
$$;

revoke execute on function public.increment_ai_usage(date, text, integer) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(date, text, integer) to service_role;

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
```

The table and RPC function are only ever touched by the backend's `service_role` key, so
direct calls with the public `anon` or user `authenticated` JWTs are completely blocked.
If the table or function is missing the backend logs an error. Outside production it degrades to
the local file, so local development keeps working; in production it fails closed instead (basic
mode for text, 503 for premium features) and never writes the ephemeral file. The optional
`backend/migrations/002_reserve_ai_credits.sql` adds a one-round-trip credit reservation.

**Chat with Timeline conversations** are stored per user and timeline. Run this once too:

```sql
create table if not exists public.timeline_chats (
  user_id     uuid  not null references auth.users (id) on delete cascade,
  timeline_id text  not null references public.timelines (id) on delete cascade,
  messages    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, timeline_id)
);

create index if not exists idx_timeline_chats_timeline_id
  on public.timeline_chats (timeline_id);

alter table public.timeline_chats enable row level security;
revoke all on public.timeline_chats from anon, authenticated;
```

Conversations are deleted automatically with their timeline or user account. If the table
is missing, chat history stays in the browser's localStorage only.

**YouTube search cache** (optional, for the event drawer's Videos tab) keeps search results
for 30 days so restarts don't spend the YouTube API quota again:

```sql
create table if not exists public.youtube_search_cache (
  cache_key  text  primary key,
  query      text  not null,
  lang       text  not null default '',
  items      jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.youtube_search_cache enable row level security;
revoke all on public.youtube_search_cache from anon, authenticated;
```

Without it, results are cached in server memory only (and saved on each event once found).

**Activity log & timeline modes** (recommended - analytics/monitoring). Every AI action
(timeline generation from a prompt / files / photo, refine, chat, chat file attachments,
quiz & Who-Am-I generation, event suggestion, AI image generation) writes one row - including
failures, cancellations and "not enough info" verdicts - with the content mode (`classic` /
`kids`), search mode (`fast` / `web_search`), key tier, duration, tokens, estimated cost and
AI images produced. Every finished game writes one `game_completed` row with its score.
Prompt-based actions (timeline generation, photo prompt, chat, chat file attachments) also
record `details.input_method`: `typed`, `voice` (microphone dictation) or `url` (a shared
`?prompt=` link).
High-volume or private data is deliberately **not** logged: job polling, quota checks,
Wikipedia/map/YouTube lookups, timeline views/saves, AI answers, chat history, pasted document
text, image bytes and IP addresses. Prompts are truncated to 500 characters.

```sql
-- 1) Append-only activity log (written only by the backend's service-role key).
create table if not exists public.activity_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid references auth.users (id) on delete set null,
  is_guest        boolean not null default false,
  is_admin        boolean not null default false,
  action          text not null check (action in (
                    'generate_timeline', 'generate_from_files', 'generate_from_photo_prompt',
                    'refine_timeline', 'chat', 'chat_attach_files', 'generate_quiz',
                    'generate_whoami', 'generate_podcast', 'podcast_audio', 'suggest_event',
                    'generate_image', 'polish_text', 'story_overview', 'game_completed', 'podcast_listen',
                    'book_import')),
  status          text not null default 'success'
                    check (status in ('success', 'error', 'cancelled', 'no_info')),
  content_mode    text check (content_mode in ('classic', 'kids')),
  search_mode     text check (search_mode in ('fast', 'web_search')),
  key_tier        text,          -- free | paid | admin_paid | custom (user's own key)
  timeline_id     text,          -- no FK: the log must outlive deleted timelines
  prompt          text,
  language        text,
  result_count    integer,       -- events generated / questions / rounds played
  duration_ms     integer,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  thinking_tokens integer,
  cost_usd        numeric(12, 6),
  ai_images       integer,
  error           text,
  details         jsonb          -- action-specific extras (game score, chat edit type, ...)
);

create index if not exists idx_activity_log_created_at on public.activity_log (created_at desc);
create index if not exists idx_activity_log_user       on public.activity_log (user_id, created_at desc);
create index if not exists idx_activity_log_action     on public.activity_log (action, created_at desc);
create index if not exists idx_activity_log_timeline   on public.activity_log (timeline_id) where timeline_id is not null;

alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;

-- 2) Mode columns on saved timelines, derived from the JSON (no backend writes needed).
alter table public.timelines
  add column if not exists content_mode text
    generated always as (coalesce(data->>'contentMode', 'classic')) stored,
  add column if not exists search_mode text
    generated always as (
      case
        when data->>'searchMode' in ('fast', 'web_search') then data->>'searchMode'
        when data->'isManual' = 'true'::jsonb then null
        when jsonb_typeof(data->'grounding') = 'object' then 'web_search'
        else 'fast'
      end
    ) stored,
  add column if not exists creation_source text
    generated always as (
      coalesce(
        data->>'creationSource',
        case when data->'isManual' = 'true'::jsonb then 'manual' end
      )
    ) stored;

create index if not exists idx_timelines_modes on public.timelines (content_mode, search_mode);

-- 3) Ready-made daily summary for dashboards (SQL Editor / Table Editor).
create or replace view public.activity_daily
with (security_invoker = true) as
select
  date_trunc('day', created_at)::date                         as day,
  action,
  content_mode,
  search_mode,
  count(*)                                                    as total,
  count(*) filter (where status = 'success')                  as succeeded,
  count(*) filter (where status = 'error')                    as failed,
  count(*) filter (where status = 'cancelled')                as cancelled,
  count(*) filter (where status = 'no_info')                  as no_info,
  count(distinct user_id)                                     as users,
  count(distinct user_id) filter (where is_guest)             as guest_users,
  round(avg(duration_ms))::integer                            as avg_duration_ms,
  coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(thinking_tokens, 0)), 0) as tokens,
  coalesce(sum(cost_usd), 0)                                  as cost_usd,
  coalesce(sum(ai_images), 0)                                 as ai_images
from public.activity_log
group by 1, 2, 3, 4;

revoke all on public.activity_daily from anon, authenticated;
```

`timelines.search_mode` is backfilled for existing rows from the stored web-search sources
(`grounding`); new timelines carry an explicit `searchMode`/`creationSource` (`prompt`,
`files`, `photo_prompt`, `manual`). If `activity_log` is missing, the backend logs one error
and pauses activity logging for 5 minutes at a time - user requests are never affected.
Set `ACTIVITY_LOG_ENABLED=false` to turn logging off entirely. When a guest signs in and
claims their work, their activity rows are re-attributed to the account (`is_guest` stays
`true` on rows created before sign-up).

If your `activity_log` table was created before podcasts or AI text polishing existed, allow the
newer actions once (otherwise those rows are rejected and activity logging pauses for 5 minutes
after each one):

```sql
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log
  add constraint activity_log_action_check check (action in (
    'generate_timeline', 'generate_from_files', 'generate_from_photo_prompt',
    'refine_timeline', 'chat', 'chat_attach_files', 'generate_quiz',
    'generate_whoami', 'generate_podcast', 'podcast_audio', 'suggest_event',
    'generate_image', 'polish_text', 'story_overview', 'game_completed', 'podcast_listen',
    'book_import'));
```

(Migration `006_book_imports.sql` applies the same list.)

Podcast rows: `generate_podcast` (script; tokens & cost), `podcast_audio` (one per rendered voice
variant: engine, fallbacks, TTS cost) and `podcast_listen` (client analytics: `details.event` is
`play_start` with `time_to_first_audio_ms`, `episode_complete`, or `session_end` with
`listened_seconds`, `completion_ratio`, `chapters_completed`, `buffering_ms`, `fallback_count`,
`music_enabled` and `music_mood`).

### 2c. Podcast storage

Podcast episodes (scripts) and rendered chapter audio are stored in a **private Supabase Storage
bucket** (`PODCAST_STORAGE_BUCKET`, default `podcasts`), which the backend creates on first use with
the service-role key. Audio is content-addressed (a hash of the script text + voice settings), so
each chapter is synthesized once and then streamed from `/api/podcast-audio/<key>.mp3` with long-lived
caching and HTTP Range support. Without Supabase (or with `PODCAST_STORAGE_BACKEND=local`) files are
kept under `backend/data/podcasts/`, which is ephemeral on hosts like Render/Railway.

Text-to-speech engines:
- **Standard** (default) – Microsoft Edge neural voices via the `edge-tts` library (free; unofficial endpoint).
- **Google Cloud** – Google Cloud Text-to-Speech WaveNet voices (offered when a Google Cloud TTS key is configured and within the monthly character cap).
- **Premium** – Gemini native-audio TTS. With Gemini 3.x TTS models the script is sent
  through the Interactions API as a verbatim transcript and the per-audience delivery style is
  passed as `speech_metadata`, so instructions are never read aloud (requires `google-genai>=2.25`);
  Gemini 2.5 fallbacks receive the transcript only. Unlocking it on an episode
  costs one AI credit (refunded automatically if no chapter could be rendered with Gemini); after
  that, anyone the episode is shared with listens for free.
  Every chapter is a separate generation, so to keep one consistent host across the episode:
  the model that renders the first chapter is pinned for the rest of the episode (retried, never
  swapped for another model or engine mid-episode), every chapter gets the same fixed recording
  brief, duo episodes always use the two-speaker setup, and generated speech is loudness-normalized.

All engines output 24 kHz mono 48 kbps MP3 (Gemini/Google Cloud PCM is loudness-normalized and encoded
with `lameenc`), so chapters from any engine can be concatenated. When every chapter of a voice
variant is rendered, the server joins them into one continuous MP3 (stored and streamed like a
chapter) and `GET /api/timelines/<id>/podcasts/<episode>/episode-audio` returns its URL with each
chapter's start offset. The player streams that single file and treats chapters as positions in it,
which avoids the silence mobile browsers insert when switching audio files between chapters; until
it's ready, chapters play one by one and the player switches over at the next chapter boundary.

Background music is never stored or streamed. The script model tags each episode with a
`music_mood`, and `frontend/src/utils/podcastMusic.js` synthesizes a matching score with Web Audio,
planned bar by bar from the episode id so it sounds the same every time. The player keeps it about
19 dB under the voice while someone speaks. With music on, **Download MP3** mixes the chapters and
the same score in the browser (`OfflineAudioContext`) and encodes a 24 kHz stereo MP3 with a
WebAssembly LAME build (`wasm-media-encoders`, loaded only on download); with music off, the
server's voice-only MP3 is downloaded.

### 2d. Book import (long books, scans and page photos)

Story Studio's **From documents** option can run a durable, multi-stage pipeline that turns a whole
family book into a reviewed personal timeline (design: `docs/book-import-spec.md`). It accepts
born-digital PDFs, scanned PDFs, Word (`.docx`), photos/scans of pages (JPG/PNG/WEBP, HEIC converted
in the browser) and pasted text. Stages: parse (pypdfium2 / python-docx, embedded photos extracted
with their clipping frames) → read (Gemini vision per page: transcription in logical order, captions,
photo boxes for scans) → map (cast, aliases per chapter, chapters, lanes, places) → extract (events per
chapter) → reconcile (Hebrew-date checks, duplicate merging, photo placement, geocoding) → **review
workspace** → finalize (photos promoted to hosted photos, timeline saved). Small inputs take a fast lane
(parse → read → one extraction call → reconcile).

Off by default. To enable:

1. Run `backend/migrations/006_book_imports.sql` in the Supabase SQL editor (table `book_imports`,
   lease functions, and the `book_import` activity action).
2. Backend env: `BOOK_IMPORT_ENABLED=true`. Optional: `BOOK_IMPORT_ACCESS` (`admin_byok` default, or
   `admin`), `BOOK_IMPORT_GEMINI_API_KEY` (a dedicated key for admin imports),
   `BOOK_IMPORT_MODEL_READ|MAP|EXTRACT|RECONCILE` (model chains, comma-separated),
   `BOOK_IMPORT_MAX_FILE_MB` (200; also the private bucket's per-file limit - check your Supabase plan),
   `BOOK_IMPORT_MAX_ACTIVE` (2 imports at once per instance), `BOOK_IMPORT_GEMINI_CONCURRENCY` (8),
   `BOOK_IMPORT_TTL_DAYS` (14), `BOOK_IMPORT_MAX_USD` (cost guard per import), `BOOK_IMPORT_GEOCODE`
   (`true`), `BOOK_IMPORT_STORAGE_BACKEND=local` for development without Supabase.
3. Frontend: `VITE_ENABLE_BOOK_IMPORT=true` (or `?ff_book_import=1` for testing).

Files and working artifacts live in the **private** bucket `book-imports` (created on first use) under
a salted per-user folder, reached only through short-lived signed URLs; uploads go straight from the
browser to Storage, so the API's body limits don't apply. Sources and page renders are deleted after the
timeline is created, everything after `BOOK_IMPORT_TTL_DAYS` and with the account. The runner works
inside the web process: every stage is checkpointed and claimed through a fenced lease, so a deploy or
restart resumes an import without repeating finished pages. Imports that use a personal Gemini key keep
the key in memory only; after a restart they pause until the browser resumes them with the key.

Phase 0 tooling (real Gemini, offline): `backend/scripts/book_import_spike/` (`parse_pdf.py`,
`run_read.py` with synthetic scan / phone-photo modes and box scoring, `run_pipeline.py`).

### 3. Run the Application

#### Option A: Quick Launch (Windows)
Run the automated launcher script to start both services:
```powershell
.\start.ps1
```
or execute `start.bat`.

#### Option B: Manual Launch

Start the backend:
```bash
cd backend
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Linux / macOS:
source .venv/bin/activate

pip install -r requirements.txt
python main.py
```
The backend starts at `http://localhost:8000`.

Start the frontend:
```bash
cd frontend
npm install
npm run dev
```
The frontend starts at `http://localhost:5173`.

#### Tests
```bash
cd backend && python -m pytest tests          # backend unit & API tests
cd frontend && npm test                       # frontend unit tests (node:test)
cd frontend && npm run test:e2e               # Playwright smoke tests (mocked backend)
```

---

## Project Structure

```
ChroniX/
├── backend/
│   ├── main.py                  # FastAPI server & route handlers
│   ├── models.py                # Pydantic schema definitions
│   ├── requirements.txt         # Python package dependencies
│   ├── prompts/                 # Modular AI prompt templates & guidelines
│   │   └── timeline.py          # Structuring, curation, Kids audience & grounding prompts
│   ├── services/
│   │   ├── gemini_service.py    # Gemini structuring, multimodal extraction, chat, games, podcast scripts & AI images
│   │   ├── podcast_tts_service.py # TTS providers (Edge / Google Cloud / Gemini) with a shared MP3 output format
│   │   ├── podcast_audio.py     # Content-addressed chapter rendering, episode variants & MP3 downloads
│   │   ├── podcast_store.py     # Supabase Storage / local persistence for podcast episodes & audio
│   │   ├── wiki_enricher.py     # Wikipedia extracts & Wikimedia Commons media matching
│   │   ├── youtube_service.py   # YouTube Data API v3 video discovery & 30-day cache
│   │   ├── auth_service.py      # Supabase JWT verification & user management
│   │   ├── quota_service.py     # Multi-key rotation & daily usage limits
│   │   └── storage.py           # Supabase and local filesystem persistence
│   └── tests/                   # Backend integration and unit tests
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Root application component
│   │   ├── components/          # Timeline, Map, Modals, Chat, Drawer & Toolbar
│   │   │   ├── games/           # 7 interactive timeline games (Trivia, Sequence, TimeGuesser, etc.)
│   │   │   ├── icons/           # Theme-aware Classic & 3D-Toy (Kids Mode) SVG icon system
│   │   │   ├── podcast/         # Podcast studio dialog, floating player bar, synced transcript & music panel
│   │   │   ├── public/          # Public pages (Features, Privacy, Terms, Open Source)
│   │   │   └── timeline/        # Canvas layout planner, focus lens & mobile Card Feed
│   │   ├── context/             # Auth and Language/ContentMode providers
│   │   ├── data/                # Lane palettes, personal templates, preset prompts & public page copy
│   │   ├── hooks/               # Speech recognition, modal animations & navigation hooks
│   │   ├── locales/             # Bilingual dictionaries (English & Hebrew, with Kids Mode overrides)
│   │   └── utils/               # Timeline articles, export, layout, podcast playback & procedural podcast music
│   ├── package.json             # Frontend scripts & dependencies
│   └── vite.config.js           # Vite build configuration
├── start.bat                    # Windows Batch launcher
└── start.ps1                    # Windows PowerShell launcher
```

---

## Attributions & Licenses

- **HistropediaJS**: Interactive canvas timeline rendering. Subject to the HistropediaJS Non-Commercial Licence Agreement (free for educational and non-commercial use).
- **Google Gemini**: AI reasoning, chronological structuring, multimodal extraction, AI image generation, and real-time search grounding.
- **Wikimedia Commons & Wikipedia**: Encyclopedic extracts and historical media provided via Wikimedia Foundation APIs.
- **YouTube API Services**: Educational and documentary video search and playback via the official YouTube embedded player.
- **Leaflet, Google Maps & Esri**: Geospatial mapping and coordinate visualization.
