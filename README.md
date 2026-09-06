# ChroniX
### *AI-Powered Visual Chronologies Across Time and Space*

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React 19](https://img.shields.io/badge/Frontend-React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Bundler-Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5-4285F4?logo=google&logoColor=white)](https://ai.google.dev)
[![HistropediaJS](https://img.shields.io/badge/Canvas-HistropediaJS-FFA500)](https://histropedia.com)
[![Leaflet](https://img.shields.io/badge/Geo-Leaflet-199900?logo=leaflet&logoColor=white)](https://leafletjs.com)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Looking for prompt writing advice, timeline feature walkthroughs, and curated examples?**  
> Check out the comprehensive **[ChroniX User Guide (USER_GUIDE.md)](USER_GUIDE.md)**!

---

## Overview

**ChroniX** transforms any natural language prompt into an interactive, zoomable visual chronology. It synthesizes history, science, biography, and literature using **Google Gemini (`gemini-2.5-flash`)**, renders fluid multi-scale canvases with **HistropediaJS**, plots synchronized historical positions on an interactive **Leaflet** world map, and enriches every milestone with verified photography and encyclopedic extracts from **Wikipedia** and **Wikimedia Commons**.

```
                           ┌───────────────────────────┐
                           │      Natural Language     │
                           │   "Space Race 1955-1975"  │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │   Google Gemini 2.5 AI    │
                           │  • Milestone Extraction   │
                           │  • Swimlanes & Precision  │
                           │  • Lat/Long Coordinates   │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │   Wikipedia REST & Media  │
                           │  • Wikimedia Thumbnails   │
                           │  • Verified Summaries     │
                           │  • Disambiguation Engine  │
                           └─────────────┬─────────────┘
                                         │
                  ┌──────────────────────┴──────────────────────┐
                  ▼                                             ▼
     ┌─────────────────────────┐                   ┌─────────────────────────┐
     │ HistropediaJS Canvas    │ ◀─── Synced ────▶ │ Leaflet Geographic Map  │
     │ • Multi-scale Zoom & Pan│     Events &      │ • PiP, Split & Fullscreen│
     │ • Parallel Swimlanes    │     Coordinates   │ • Swimlane-Coded Pins   │
     └─────────────────────────┘                   └─────────────────────────┘
```

---

## Key Features

- **AI-Powered Chronology Synthesis**:
  - Enter any topic in natural language (e.g. *"The Space Race"*, *"Industrial Revolution"*, *"World War II"*, *"Evolution of the Horse"*).
  - **Global Multilingual Support**: Prompts can be written in **any language** (French, Spanish, German, Arabic, Russian, Japanese, etc.) regardless of the interface language. Generated events, descriptions, and Wikipedia links automatically correspond to the prompt's language and its respective Wikipedia edition, with automatic fallback to English Wikipedia (`en.wikipedia.org`) for missing articles or media.
  - **Localized Interface**: Full UI localization in English and Hebrew with native Right-to-Left (RTL) canvas formatting.
  - Three tailored detail levels: **Overview** (10–15 events), **Standard** (20–30 events), and **Deep Dive** (35–50 events).
- **Synchronized Geographic World Map (Leaflet)**:
  - Explores history across **Time and Space** simultaneously.
  - **4 Display Modes**: Floating Earth quick toggle, Picture-in-Picture (PiP) draggable/resizable overlay, Resizable Split-Screen (with draggable divider and double-click 50/50 reset), and Fullscreen Map.
  - **Bi-directional synchronization**: Clicking a timeline event flies the map camera to its coordinates and opens a popup; clicking any map pin flies the timeline canvas straight to that card.
  - Pins are color-coded to match their respective timeline swimlanes.
- **HistropediaJS Multi-Scale Canvas Engine**:
  - Fluid zooming from billions of years ago (`Ma` prehistoric scales) down to single days and hours.
  - **Parallel Swimlanes**: Organize events into comparative thematic tracks (e.g., NASA vs. Soviet Program, Allied vs. Axis, Carnivores vs. Herbivores).
  - **Time Bands**: Broad historical epochs painted across the canvas with start and end dates.
  - **Fit All Articles**: Instant re-centering of the full timeline span with one click.
- **Automated Wikimedia Commons & Wikipedia Enrichment**:
  - Automatically fetches authentic portraits, photos, license attributions, and encyclopedic extracts across all Wikipedia language editions.
  - **Automatic English Wikipedia Fallback**: Automatically supplements missing articles, portraits, or coordinates from English Wikipedia whenever a local language edition lacks them.
  - **Candidate Disambiguation Picker**: Interactive modal lets you select the exact Wikipedia article if multiple candidates match an event title.
- **In-Canvas Event Studio & AI Auto-Fill**:
  - Full freedom to add (`+`), edit, or remove events.
  - **AI Auto-Fill**: Type an event title and let Gemini auto-fill dates, precision, lane, Wikipedia links, extract, and geographic coordinates.
- **Conversational AI Refine**:
  - Refine active timelines without starting from scratch.
  - Split single-track timelines into parallel swimlanes (e.g., by theater, topic, or opposing factions).
  - Expand specific sub-eras or add cultural/scientific context.
- **Cards List Explorer & Timeline Tabs**:
  - Searchable, chronological slide-over drawer of all events grouped by swimlanes.
  - Quick multi-timeline tab switcher to explore several topics in parallel.
- **Persistence & Cloud Sync**:
  - Automatic cloud library sync via **Supabase**.
  - Export/Import full timeline datasets as JSON.
  - High-resolution canvas snapshot export as PNG.
  - User quota tracking and custom Gemini API key support.

---

## System Architecture & Tech Stack

```
ChroniX/
├── backend/                  # FastAPI REST Service (Python 3.10+)
│   ├── main.py               # API routing, rate limiting & middleware
│   ├── models.py             # Pydantic v2 schema definitions
│   ├── services/
│   │   ├── gemini_service.py # Google GenAI SDK integration (Gemini 2.5 Flash)
│   │   ├── wiki_enricher.py  # Wikipedia REST API & Wikimedia Commons client
│   │   ├── quota_service.py  # User quota & Gemini API key management
│   │   ├── auth_service.py   # Supabase JWT & user validation
│   │   └── storage.py        # Local & Supabase timeline persistence
│   └── tests/                # Pytest test suite
├── frontend/                 # Single-Page Application (React 19 + Vite)
│   ├── src/
│   │   ├── components/       # UI Components (Toolbar, Canvas, GeoMap, Drawers, Modals)
│   │   ├── context/          # LanguageContext, AuthContext, TimelineContext
│   │   ├── data/             # userGuideData.js (Bilingual guide & showcase prompts)
│   │   └── locales/          # English & Hebrew translation dictionaries
│   └── index.html            # Application shell
├── start.bat                 # Windows one-click batch launcher
├── start.ps1                 # Windows PowerShell launcher
├── README.md                 # Installation, architecture & developer guide
└── USER_GUIDE.md             # In-depth user & prompt engineering guide
```

### Technology Matrix

| Layer | Technologies | Key Packages / Tools |
|---|---|---|
| **Backend** | Python 3.10+ | `fastapi`, `uvicorn`, `google-genai`, `pydantic`, `httpx`, `python-dotenv`, `pytest` |
| **Frontend** | React 19, Vite | `histropediajs`, `leaflet`, `tailwindcss`, `lucide-react`, `canvas-confetti`, `html-to-image` |
| **Database & Auth** | Supabase | `@supabase/supabase-js`, PostgreSQL, Row-Level Security, JWT Auth |
| **External APIs** | Google AI, Wikimedia | Google Gemini 2.5 Flash, Wikipedia REST API, Wikimedia Commons API |

---

## Prerequisites

Ensure you have the following installed on your system:
- **Python**: `3.10` or higher (`python --version`)
- **Node.js**: `18.0` or higher (`node -v`) and `npm` (`npm -v`)
- **Git**: For cloning the repository
- **Google Gemini API Key**: Free to obtain from [Google AI Studio](https://aistudio.google.com/app/apikey)
- *(Optional)* **Supabase Project**: If you wish to enable cloud authentication and timeline library storage (local fallback works out of the box).

---

## Quick Start (One-Click)

If you are on Windows, you can start both the backend and frontend development servers simultaneously with a single command:

```powershell
.\start.bat
# or using PowerShell:
.\start.ps1
```

This launches:
- **Backend (FastAPI)** at `http://localhost:8000`
- **Frontend (Vite)** at `http://localhost:5173`

---

## Manual Installation & Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/yonitsur/ChroniX.git
cd ChroniX
```

---

### Step 2: Backend Setup (FastAPI)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # Windows:
   python -m venv .venv
   .\.venv\Scripts\activate

   # macOS / Linux:
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure environment variables:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `backend/.env` with your preferred text editor:
   ```ini
   # Google Gemini API Key (Required for AI generation)
   GEMINI_API_KEY=your_gemini_api_key_here

   # Server Port
   PORT=8000

   # Supabase Configuration (Optional for cloud sync)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

5. Run the FastAPI development server:
   ```bash
   python main.py
   # or with live reload:
   uvicorn main:app --reload --port 8000
   ```
   The backend API is now running at `http://localhost:8000`. You can inspect the interactive OpenAPI documentation at `http://localhost:8000/docs`.

---

### Step 3: Frontend Setup (React + Vite)

1. Open a new terminal window and navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Configure frontend environment variables:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `frontend/.env`:
   ```ini
   # Points to your local backend
   VITE_API_URL=http://localhost:8000

   # Supabase Configuration (Optional - matches backend)
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

4. Start the Vite development server:
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:5173`.

---

## Configuration & Environment Variables

### Backend Configuration (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Recommended | None | Google Gemini API key used by the backend service. If omitted, users can provide their own key in the UI. |
| `PORT` | Optional | `8000` | Port for the Uvicorn server to listen on. |
| `SUPABASE_URL` | Optional | None | Supabase project URL for cloud authentication and timeline persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | None | Supabase service role key for server-side operations and quota management. |
| `SUPABASE_ANON_KEY` | Optional | None | Supabase anonymous public key. |

### Frontend Configuration (`frontend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | Optional | `http://localhost:8000` | URL of the ChroniX FastAPI backend. |
| `VITE_SUPABASE_URL` | Optional | None | Supabase project URL for client-side authentication. |
| `VITE_SUPABASE_ANON_KEY` | Optional | None | Supabase anonymous key for client-side queries. |

### In-App User API Key Configuration
Users can also supply their own Gemini API key directly in the web UI without configuring server environment variables:
1. Click the **Key icon** in the top toolbar.
2. Paste your Google Gemini API key.
3. The key is securely stored in the browser's `localStorage` and sent with requests in the `X-Gemini-Api-Key` header.

---

## API Reference

The FastAPI backend exposes the following RESTful endpoints:

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Health check and server API key status | No |
| `GET` | `/api/user/quota` | Check user daily prompt quota and limits | Yes |
| `POST` | `/api/timeline/generate` | Generate a complete visual timeline from a natural language prompt | Yes / Key |
| `POST` | `/api/timeline/refine` | Refine or restructure an existing timeline using conversational AI | Yes / Key |
| `POST` | `/api/timeline/suggest-event` | AI auto-fill for individual event dates, lanes, Wikipedia link & coordinates | Yes / Key |
| `POST` | `/api/timeline/enrich-item` | Query Wikipedia/Wikimedia for thumbnails, extracts, and candidates | No |
| `GET` | `/api/timelines` | List all saved timelines for the authenticated user | Yes |
| `GET` | `/api/timelines/{id}` | Fetch a specific timeline by ID | No |
| `POST` | `/api/timelines` | Save or update a timeline in storage | Yes |
| `DELETE` | `/api/timelines/{id}` | Delete a timeline from storage | Yes |

> **Interactive Swagger Docs**: When the backend is running, visit `http://localhost:8000/docs` to test endpoints and inspect request/response schemas interactively.

---

## Testing & Verification

### Running Backend Tests
ChroniX includes an automated test suite using `pytest` and `pytest-asyncio`:

```bash
cd backend
pytest tests/ -v
```

### Validating Frontend Production Build
To ensure all JSX, Tailwind styles, and TypeScript definitions compile cleanly:

```bash
cd frontend
npm run build
```

---

## Deployment Guide

### Backend Deployment (e.g. Render / Fly.io / Railway)
- The backend contains a `Procfile` ready for platforms like Render:
  ```text
  web: uvicorn main:app --host 0.0.0.0 --port $PORT
  ```
- Add the required environment variables (`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) in your hosting dashboard.

### Frontend Deployment (e.g. Vercel / Netlify / Cloudflare Pages)
- The frontend includes `vercel.json` for seamless client-side SPA routing:
  ```json
  {
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
  ```
- Set `VITE_API_URL` to your production backend URL (e.g. `https://your-backend.onrender.com`).

---

## Documentation & User Guide

For detailed user instructions, prompt engineering formulas, curated examples, and canvas tips, please read:
**[ChroniX User Guide (USER_GUIDE.md)](USER_GUIDE.md)**

---

## License & Attributions

This project is open-source and free for personal, educational, and non-commercial use.

- **Application Code**: Licensed under the [MIT License](https://opensource.org/licenses/MIT).
- **Timeline Canvas Engine**: Powered by [HistropediaJS](https://histropedia.com/), subject to the [HistropediaJS Non-Commercial Licence Agreement](https://js.histropedia.com/licence) (free for non-commercial use; contact [Histropedia Ltd](https://js.histropedia.com/licence) for commercial inquiries).
- **Geographic Mapping**: Powered by [Leaflet](https://leafletjs.com/) and OpenStreetMap contributors.
- **Content & Media**: Historical portraits, event thumbnails, and encyclopedic extracts are retrieved dynamically via the [Wikipedia REST API](https://www.mediawiki.org/wiki/API:REST_API) and [Wikimedia Commons](https://commons.wikimedia.org/) under Creative Commons licenses (CC BY-SA).
