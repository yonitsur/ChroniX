# ChroniX ⏳✨
### *AI-Powered Visual Chronologies*

**ChroniX** is an AI-powered interactive visual chronology web application. It transforms any natural language topic into an interactive, zoomable visual timeline using **Google Gemini**, **HistropediaJS**, and the **Wikipedia / Wikimedia REST APIs**.

---

## Features

- 🧠 **AI-Powered Chronology**: Enter any topic in natural language (e.g., *"Presidents of the United States"*, *"Dinosaurs & Mesozoic Eras"*, *"World War II Key Events"*, *"Evolution of Early Humans"*, *"History of Computing"*).
- ⚡ **Variable Detail Levels**:
  - **Overview**: 10–15 milestone events.
  - **Standard**: 20–30 balanced events.
  - **Deep Dive**: 35–50 granular events.
- 🎨 **HistropediaJS Canvas Engine**:
  - Full panning & zooming with mouse wheel and drag.
  - **Swimlanes**: Categorize events (e.g. Allied vs Axis powers, Carnivores vs Herbivores, Hardware vs Software).
  - **Time Bands**: Broad historical and geological eras painted across the timeline.
  - **Prehistoric to Modern Scales**: Natively supports dates from billions/millions of years ago (`Ma`) up to exact days.
- 🖼️ **Automated Wikimedia Commons & Wikipedia Enrichment**:
  - Automatically fetches authentic portrait/photo thumbnails and full encyclopedic summary extracts for every event.
- ✏️ **Manual & Conversational Editing**:
  - Click any card to open the event drawer and read the full Wikipedia summary or follow the article link.
  - Add, edit, or delete events manually.
  - **AI Refine**: Converse with AI to expand specific periods (e.g. *"Add more events in the Pacific Theater between 1942 and 1944"*).
- 💾 **Persistence & Export**:
  - Save multiple timelines locally and on the server.
  - Export timeline as JSON or import existing files.
  - Export timeline snapshot image (PNG).
  - Easy Google Gemini API key configuration via UI or `.env`.

---

## Quick Start

### 1. Backend (FastAPI)

```bash
cd backend
python -m pip install -r requirements.txt

# (Optional) Set your Gemini API key in backend/.env:
# GEMINI_API_KEY=your_key_here

python main.py
```
The backend starts at `http://localhost:8000`.

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Setting Up Google Gemini API Key

You can provide your Gemini API key in either of two ways:
1. In `backend/.env`: `GEMINI_API_KEY=AIzaSy...`
2. Directly in the Web UI: Click the **Key** icon in the toolbar, paste your key, and click **Save**. It is securely stored in your browser's `localStorage` and passed to the backend.

You can obtain a free Gemini API key at [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## License & Third-Party Attributions

This project is open-source and free for personal, educational, and non-commercial use.

- **Application Code**: Licensed under the [MIT License](https://opensource.org/licenses/MIT).
- **Timeline Canvas Engine**: Powered by [HistropediaJS](https://histropedia.com/), which is subject to the [HistropediaJS Non-Commercial Licence Agreement](https://js.histropedia.com/licence) (free for non-commercial use; contact [Histropedia Ltd](https://js.histropedia.com/licence) for commercial licensing).
- **Content & Media**: Event images, thumbnails, and summaries are retrieved dynamically via the [Wikipedia REST API](https://www.mediawiki.org/wiki/API:REST_API) and [Wikimedia Commons](https://commons.wikimedia.org/) under respective Creative Commons licenses (CC BY-SA).
