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
- Flexible Export: Export timelines to high-resolution PNG snapshots, structured JSON datasets, or plain-text summaries.
- Multilingual & RTL: Full localization across 11 languages (English, Hebrew, Arabic, Spanish, French, German, Japanese, Korean, Chinese, Portuguese, Hindi) with complete bidirectional layout support.

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
- AI Engine: Google Gemini API (gemini-2.5-flash / gemini-2.5-pro) with Search Grounding
- Enrichment: Wikimedia Commons API, Wikipedia REST API, Nominatim Geocoding
- Storage: Local filesystem persistence with optional Supabase database synchronization
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
GEMINI_API_KEY=your_gemini_api_key_here
PORT=8000
```

Frontend environment configuration (optional, for Supabase sync):
```bash
cp frontend/.env.example frontend/.env
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
│   ├── main.py              # FastAPI server & route handlers
│   ├── models.py            # Pydantic schema definitions
│   ├── requirements.txt     # Python package dependencies
│   ├── services/
│   │   ├── gemini_service.py # Gemini structuring, refinement & chat
│   │   ├── wiki_enricher.py  # Wikipedia extracts & Wikimedia media
│   │   ├── quota_service.py  # API key rotation & usage limits
│   │   └── storage.py        # Timeline data persistence
│   └── tests/               # Backend integration and unit tests
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Root application component
│   │   ├── components/      # Timeline, Map, Modals, Toolbar
│   │   ├── context/         # Auth and Language providers
│   │   ├── data/            # Lane palettes, preset prompts, and templates
│   │   └── locales/         # 11 language translation dictionaries
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
