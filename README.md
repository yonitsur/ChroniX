# ChroniX

Interactive, AI-powered visual chronology engine. ChroniX transforms topics, queries, voice prompts, photos, raw text, and documents into rich, multi-dimensional timelines featuring parallel swimlanes, synchronized geographic maps, encyclopedic & YouTube media enrichment, AI-generated illustrations, conversational exploration, personal/family timeline builders, Kids Mode, and a 7-game interactive learning hub.

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
- **Age Groups & Visual Designs**:
  - **Age group** (Kids 8–11, Teens 12–15, General) adapts content and tone end-to-end: AI timelines, chat, event suggestions, quizzes, mystery games, illustrations, and curated example prompts.
  - **Design** (Classic, Playful 3D-toy, Comic, Bento, Journal) changes only the look. Picking an age group applies its default design (Kids → Playful, Teens → Comic, General → Classic); the design can then be changed freely.
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
- **Synchronized Multi-Provider Geo-Mapping**:
  - Interactive Leaflet map tracks historical event coordinates alongside the timeline canvas with marker clustering, chronological journey paths, and global/conceptual event filtering.
  - Supports **Google Maps**, **OpenStreetMap**, and **Esri** (*World Canvas* & *World Atlas*) tile layers across Picture-in-Picture (PiP), Split-Screen, and Full-Screen layouts.
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
- **Mapping**: Leaflet, Google Maps tiles, OpenStreetMap, Esri World Canvas / World Atlas
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
YOUTUBE_API_KEY=your_youtube_data_api_key_here

PORT=8000
```

Frontend environment configuration (optional, for Supabase sync & map providers):
```bash
cp frontend/.env.example frontend/.env
```

### 2b. Supabase schema (required for durable AI quota tracking & cloud persistence)

Daily AI-usage counters fall back to a local JSON file when Supabase is not configured.
That file lives on the app server's filesystem, which is **ephemeral** on hosts such as
Render or Railway - every redeploy, restart or idle spin-down wipes it and silently resets
everyone's quota. To persist counters, run this once in the Supabase SQL Editor:

```sql
create table if not exists public.ai_usage (
  usage_date  date    not null,
  identifier  text    not null,
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (usage_date, identifier)
);

-- Atomic increment/refund so concurrent requests can never lose a count.
create or replace function public.increment_ai_usage(
  p_date date, p_identifier text, p_delta integer
) returns integer
language plpgsql
security definer
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

alter table public.ai_usage enable row level security;
```

The table is only ever touched by the backend's service-role key, so no RLS policies are
needed. If the table or function is missing the backend logs an error and degrades to the
local file, so the app keeps working.

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
                    'generate_whoami', 'suggest_event', 'generate_image', 'game_completed')),
  status          text not null default 'success'
                    check (status in ('success', 'error', 'cancelled', 'no_info')),
  content_mode    text check (content_mode in ('classic', 'kids', 'teens')),
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

If your `activity_log` table was created before the Teens age group existed, allow the new
`teens` content mode once (otherwise Teens activity rows are rejected):

```sql
alter table public.activity_log drop constraint if exists activity_log_content_mode_check;
alter table public.activity_log
  add constraint activity_log_content_mode_check check (content_mode in ('classic', 'kids', 'teens'));
```

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

---

## Project Structure

```
ChroniX/
├── backend/
│   ├── main.py                  # FastAPI server & route handlers
│   ├── models.py                # Pydantic schema definitions
│   ├── requirements.txt         # Python package dependencies
│   ├── prompts/                 # Modular AI prompt templates & guidelines
│   │   └── timeline.py          # Structuring, curation, Kids/Teens audience & grounding prompts
│   ├── services/
│   │   ├── gemini_service.py    # Gemini structuring, multimodal extraction, chat, games & AI images
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
│   │   │   ├── public/          # Public pages (Features, Privacy, Terms, Open Source)
│   │   │   └── timeline/        # Canvas layout planner, focus lens & mobile Card Feed
│   │   ├── context/             # Auth and Language/ContentMode providers
│   │   ├── data/                # Lane palettes, personal templates, preset prompts & public page copy
│   │   ├── hooks/               # Speech recognition, modal animations & navigation hooks
│   │   ├── locales/             # Bilingual dictionaries (English & Hebrew, with Kids & Teens overrides)
│   │   └── utils/               # Timeline articles, multi-format export & layout helpers
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
- **Leaflet, Google Maps, OpenStreetMap & Esri**: Geospatial mapping and coordinate visualization.
