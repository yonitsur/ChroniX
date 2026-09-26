# ChroniX

Interactive, AI-powered visual chronology engine. ChroniX transforms unstructured topics and queries into rich, multi-dimensional timelines featuring parallel swimlanes, geographic map synchronization, encyclopedic media enrichment, and conversational exploration.

---

## Overview

Traditional timelines flatten history into static, one-dimensional lists. ChroniX renders complex chronological narratives as continuous, interactive canvases powered by the Histropedia rendering engine and Google Gemini AI.

Whether exploring global geopolitical conflicts, scientific revolutions, literary movements, or fictional lore, ChroniX structures eras into parallel tracks, cross-checks facts via live search grounding, and pairs events with verified Wikimedia imagery and geographic coordinates.

---

## Core Capabilities

- AI Chronological Structuring: Generates multi-era, milestone-accurate timelines with autonomous density calibration (10 to 50 milestones based on historical breadth and complexity).
- Parallel Swimlanes: Segregates events into thematic lanes (theaters, political factions, scientific disciplines, cultural perspectives) for side-by-side comparative analysis.
- Google Search Grounding: Optional live web verification cross-references dates, entities, and facts before events are rendered.
- Synchronized Geo-Mapping: Built-in interactive map tracks historical event coordinates alongside the timeline canvas.
- Encyclopedic Media Enrichment: Automatically fetches public-domain photography, artwork, and article summaries through Wikimedia Commons and Wikipedia APIs.
- AI Timeline Refinement & Chat: Expand timelines on demand, insert specific sub-eras, or interrogate historical context through an integrated timeline chat assistant.
- Bilingual & RTL: Full localization in English and Hebrew with complete bidirectional layout support (RTL/LTR).
- Responsive Dual-View Architecture: Desktop provides an expansive widescreen Histropedia canvas with parallel tracks and continuous zoom; mobile viewports seamlessly default to a clean, touch-friendly vertical Card Feed with instant switching.
- Flexible Export: Export timelines to high-resolution PNG snapshots, structured JSON datasets, or plain-text summaries.

---

## Architecture & Tech Stack

### Frontend
- Framework: React 19, Vite
- Styling: Tailwind CSS, custom CSS token system
- Canvas Engine: HistropediaJS
- Mapping: Leaflet, OpenStreetMap
- State & Auth: React Context API, Supabase Auth

### Backend
- Framework: Python 3.10+, FastAPI, Uvicorn
- AI Engine: Google Gemini API (Flash series with autonomous multi-key fallback rotation and Search Grounding)
- Enrichment: Wikimedia Commons API, Wikipedia REST API, Nominatim Geocoding
- Storage: Supabase PostgreSQL persistence with local filesystem fallback
- Access Control: Multi-key fallback rotation, sliding-window rate limiting, guest quotas

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

# Free tier keys (automatic fallback if paid key budget/quota is depleted, or after quota):
GEMINI_API_KEY_FREE=your_free_tier_gemini_key_here
GEMINI_API_KEY_FREE_1=your_second_free_key_here

PORT=8000
```

Frontend environment configuration (optional, for Supabase sync):
```bash
cp frontend/.env.example frontend/.env
```

### 2b. Supabase schema (required for durable AI quota tracking)

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
│   ├── main.py              # FastAPI server & route handlers
│   ├── models.py            # Pydantic schema definitions
│   ├── requirements.txt     # Python package dependencies
│   ├── prompts/             # Modular AI prompt templates & guidelines
│   │   └── timeline.py      # Structuring, curation & grounding prompts
│   ├── services/
│   │   ├── gemini_service.py # Gemini structuring, refinement & chat
│   │   ├── wiki_enricher.py  # Wikipedia extracts & Wikimedia media
│   │   ├── quota_service.py  # API key rotation & usage limits
│   │   └── storage.py        # Supabase and local filesystem persistence
│   └── tests/               # Backend integration and unit tests
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Root application component
│   │   ├── components/      # Timeline, Map, Modals, Card Feed, Toolbar
│   │   ├── context/         # Auth and Language providers
│   │   ├── data/            # Lane palettes, preset prompts, and templates
│   │   ├── locales/         # Bilingual dictionaries (English & Hebrew)
│   │   └── utils/           # Timeline articles & layout helpers
│   ├── package.json         # Frontend scripts & dependencies
│   └── vite.config.js       # Vite build configuration
├── start.bat                # Windows Batch launcher
└── start.ps1                # Windows PowerShell launcher
```

---

## Attributions & Licenses

- HistropediaJS: Interactive canvas timeline rendering. Subject to the HistropediaJS Non-Commercial Licence Agreement (free for educational and non-commercial use).
- Google Gemini: AI reasoning, chronological structuring, and real-time search grounding.
- Wikimedia Commons & Wikipedia: Encyclopedic extracts and historical media provided via Wikimedia Foundation APIs.
- Leaflet & OpenStreetMap: Geospatial mapping and coordinates visualization.
