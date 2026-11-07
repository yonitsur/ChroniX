# Story Studio — Personal Timeline Builder (Spec v1)

Status: **Steps 1–2 prototyped, including re-opening a timeline in the Studio**, behind the
`STORY_STUDIO` feature flag (`?ff_story_studio=1` or `VITE_ENABLE_STORY_STUDIO=true`).
**Photo import (③ Photos) is built** - see §3b; it is on whenever the Studio is (turn it off with
`?ff_photo_import=0` / `VITE_ENABLE_PHOTO_IMPORT=false`). **The AI-first photo import (§3c) is built**
and on by default: AI builds the whole timeline from the photos (turn it off - back to the classic
import of §3b - with `?ff_photo_ai_first=0` / `VITE_ENABLE_PHOTO_AI_FIRST=false`). The rest of
steps 3–6 is designed here, not built.

---

## 1. Why

The Build-Your-Own modal treats a personal timeline like a generated one: fill a form → get a
result. That works when the AI knows the subject. For a personal story, **the user is the only
source of truth**, so the current flow fails in predictable ways:

- Six start options of different kinds (2 AI imports, blank, 3 templates) shown before the user
  has said what story they're telling.
- Templates are fake content (the Rossi bakery) that must be deleted event by event.
- File extraction is one-shot and opaque — no review, no questions, no provenance.
- "Blank canvas" leaves the user facing an empty timeline.
- The library demos (Claire & Ethan, Arthur at 80, the Mercier–Lindqvist trilogy) show lanes per
  person, chapters, rich narratives and places. The gap between that and what the flow produces
  is mostly **content**, and content comes from asking good questions.

## 2. Principles

1. **The AI is the biographer, not the author.** It interviews, organises and polishes. It never
   invents facts about private people.
2. **Every fact has provenance:** `user` · `document:<file>#p3` · `photo:<exif>` · `ai-wording`.
3. **Instant gratification without AI.** A real-looking timeline within ~60 seconds, 0 credits.
   *Photos are the exception (§3c):* there AI is the default path - photos in, a finished draft
   out - and the free manual import stays one click away ("I'll do it myself") and is the automatic
   fallback when AI is unavailable.
4. **Nothing AI-generated lands on the timeline unreviewed.** Inputs produce *candidates* in an
   inbox; the user accepts them. For photos the review is one screen over the whole draft (title,
   overview, chapters, every moment) before **Create**; every AI-written field is marked.
5. **Rough is fine.** "Around 1950", "summer '82" and "the 1960s" are first-class dates.
6. **One engine, two layouts.** All state and logic are layout-free; desktop and mobile are views.
7. **Credits are visible and optional.** Costs are shown before actions, quota exhaustion never
   blocks manual work, and BYOK is offered at the moment of need. The AI-first photo import shows
   its total once, on the ready card ("About 7 credits"), instead of on every button; admins and
   own-key users (free) skip even that - the build starts by itself.

## 3. The flow

```
 ① Story ──► ② Frame ──► ③ Gather ──► ④ Review ──► ⑤ Polish ──► ⑥ Share
 (type)     (anchors,     (interview,   (inbox:       (suggestions,  (link, PDF,
            chapters)     photos, docs) accept/merge) narratives)    podcast, quiz)
   0 credits ───────────┘  └──────────── credits where AI is used ────────────┘
   [built]                  [designed]
```

The user can leave at any step: "Create my timeline" is always available, and the Studio can be
**re-opened on an existing personal timeline** at any time (see §3a).

### ① Story — "What story are you telling?" *(built)*

Eight **blueprints**: Life story · Couple & wedding · Child growing up · Family history ·
A journey or trip · Career or project · In memory · Something else.

A blueprint is **structure, not sample content**: people, lanes, anchor questions, chapter rules
and chapter-name suggestions (`frontend/src/data/storyBlueprints.js`). Each card previews its
lanes ("Partner 1's path · Partner 2's path · Together").

*Designed, not built:* an **occasion** chip row (gift · wedding site · memorial · for the kids ·
just for us) that sets the tone of AI wording in ⑤ and which deliverable ⑥ promotes first.

### ② Frame *(built)*

A short, blueprint-specific form; beside it (lg+) the real ChroniX canvas, with photos. The canvas
shows a snapshot: it refreshes on **Apply** (or Ctrl+Enter) and automatically at natural moments
(picking a story, changing step, a photo import landing, the first dated event, expanding it);
while it is out of date a small "Apply" pill sits on top of it.

| Section | What it does |
|---|---|
| People | Names for `{p1}`/`{p2}`; used in lanes, questions and event titles. |
| Key moments | 2–6 anchor questions ("When and where did you meet?"). Each has a fuzzy date, optional end date (spans), optional place. Filled anchors turn green. |
| Other moments | Free rows: title + date + place + lane. |
| Chapters | **Auto chapters** derived from anchors (couple: *Before we met → Together → Married*; child: age bands up to today; memorial: *A life*), which the user can hide, plus user chapters with one-click name suggestions. |
| Timeline name | Pre-filled suggestion ("Claire & Ethan"), editable. |

On **Create**, places are geocoded (best-effort, ≤15 distinct places, 3 in parallel, free
Nominatim endpoint), the draft is cleared, and the timeline opens in the normal editor.

### ③a Re-opening a timeline in the Studio *(built)*

Creating a timeline is not a one-way door. **Edit timeline → "Continue in Story Studio"** opens the
Studio in edit mode on the current timeline, for any personal timeline the user owns (timelines not
made in the Studio open as "Something else", with their lanes as custom lanes).

- **Nothing stale is stored.** The form is rebuilt from the *current* timeline each time
  (`storyStudioSync.timelineToStoryAnswers`), so edits made in the canvas, event editor, Edit
  panel or chat show up: new events appear under "Other moments", renamed lanes and moved or
  retitled key moments are kept, deleted auto chapters stay hidden.
- **The Studio manages only a few fields:** title, dates, approximate flag, place and lane of
  events; lane titles; chapters. Saving merges them back (`applyStoryToTimeline`), keeping photos,
  galleries, story text, category, rank, videos and the coordinates of unchanged places. A finer
  date (hour/minute) is kept unless the user actually changes the date.
- **Safe by default.** Rows whose date the Studio can't read (e.g. BCE) are left untouched, not
  deleted. Removing events asks for confirmation. Closing with unsaved changes asks first.
  Saving with no changes is a no-op. A Studio save is one step in the Edit panel's **Undo**.
- Events carrying photos or a story show a small "kept" icon in the form.

### ③b Photo import *(built)*

"Start from your photos" on step ①, or **Add from photos** in the frame (create and edit mode).

1. **Read on the device (free).** `exifr` (lite build, lazy-loaded) reads only the EXIF/TIFF/GPS
   segments: capture time (wall clock + UTC offset when recorded), GPS, orientation. Without EXIF
   the date comes from the filename (`IMG_20230514_…`, `PXL_…`, WhatsApp `IMG-20230514-WA…`,
   `Screenshot …`); the file's modified date is never trusted. HEIC is decoded only when needed
   (`heic-to/csp`, a separate ~800 KB-gzip chunk) - its EXIF is used even if it can't be shown.
2. **Group (free)** - `utils/photoImport/clusterPhotos.js`: time gaps + distance from the event's
   centre, split overnight; three presets (*Fewer / Balanced / More events*). A **home** is
   detected only for long imports (>= 60 days, >= 5 days, >= 30% of photo days in one ~5 km cell);
   small groups at home are "everyday" and hidden by default, consecutive same-place days away
   from home merge, and runs of 2+ days > 80 km from home become suggested **trip chapters**.
3. **Name places (free)** - `POST /api/timeline/reverse-geocode`: one lookup per ~1 km cell
   (coordinates are rounded to 2 decimals in the browser, and again on the server),
   Nominatim's 1 req/s throttle, a week-long cache.
4. **Review** - include/exclude, rename, note, merge with next, split at a photo, move or remove
   photos, pick the cover, undated-photos tray (give a date -> joins that day), "add to an existing
   event" (same day ±1, within 30 km) instead of a duplicate, photos-per-event and a storage meter.
   Apply shows the result on the canvas.
5. **Optional AI drafts** (the classic import; §3c replaces this by default) - `POST /api/story/photo-drafts`: title + one sentence per event from a
   few small photos, the place name and the date (never GPS). Prompt rule: describe only what is
   visible plus place/date/user note; never invent names, relationships or occasions. Drafts never
   overwrite what the user typed.
6. **Apply** - events become ordinary Studio *moments* (so re-opening the Studio just works);
   their photos are re-encoded in the browser (cover <= 800 px, gallery <= 640 px; EXIF/GPS
   stripped) and attached on Create/Save (`applyPhotoMedia`), with `provenance: 'photo'`,
   `lat/lng` and `photoSource.count`. Photos live only in the open tab until then.

**Sources** (all feed the same grouping and review):

| Source | Dates | Places | Notes |
|---|---|---|---|
| Photos picked on a computer | EXIF / filename | EXIF GPS | Best when they are the original files. |
| **Google Takeout folder** ("Choose a folder", or drop the unzipped folder) | EXIF, else the sidecar's `photoTakenTime` | EXIF, else sidecar `geoData` / `geoDataExif` | Sidecars (`.json`, `.supplemental-metadata.json`, truncated, `(n)` duplicates, `-edited`) are matched per folder (`utils/photoImport/takeout.js`). Tagged **people** and **captions** come along: captions become the default note, people go to the AI as `people_tagged`. Sidecar times are UTC, shown in the browser's time zone. |
| **Google Photos Picker** ("Connect Google Photos") | `createTime` | **none** (Google strips locations) | Google sign-in (GIS token client, scope `photospicker.mediaitems.readonly`) in the browser; sessions, listing and photo downloads go through `/api/google-photos/*` (`services/google_photos.py`) because Google's photo URLs block cross-origin reads. Photos are fetched resized to what each step needs (320 px thumbnails, 384/768 px AI copies, 800/640 px stored copies) - never originals. Max 2,000 per session (Google), capped by the tier's photos-per-import. The token is forwarded per request, never stored. Picked links expire after 60 minutes. |
| Phone browser | EXIF | **iOS:** removed unless the user taps *Options -> Location* in the picker (iOS 17+). **Android:** removed by the system photo picker for websites. | The panel shows the platform's tip before picking and explains missing places after. |

When photos have no places, each event has a **"Where?"** field; typed places are geocoded on create like any Studio place.

**Google Photos setup:** in the Google Cloud project of the OAuth client (`VITE_GOOGLE_PHOTOS_CLIENT_ID`, else the One Tap client `VITE_GOOGLE_CLIENT_ID`): enable the *Photos Picker API*, add the app's origins to the client's *Authorized JavaScript origins*, and add the `photospicker.mediaitems.readonly` scope to the consent screen. While the app is in *Testing*, only listed test users can connect; publishing may require Google's OAuth verification.

**Storage (who keeps how many photos):**
- **Signed-in users (registered and own-key): hosted photos.** Kept photos are uploaded as files to a public Supabase Storage bucket (`timeline-photos`, `services/photo_store.py`) at 1280 px; the timeline stores only their URLs, so an event can keep *all* its photos. Quota: 2,000 photos per user (`REGISTERED_HOSTED_PHOTOS`), admins unlimited. Own-key users get the registered quota: storage is the app owner's cost, not Gemini's. Uploads are re-encoded without metadata when they carry any. Object names are random under a salted-hash owner folder; anyone with a URL can open it (same as a shared timeline). Timelines are soft-deleted, so their photos stay; all of a user's photos are deleted with the account. If the library can't hold a cover per event, or an upload fails, photos fall back to inline.
- **Guests (and fallbacks): inline photos** in the timeline JSON (16 MB request cap), within a ~9 MB budget. `planPhotoAllocation` never drops an event: every event gets a cover (photos shrink normal -> compact -> tiny to fit; only a truly huge import leaves the smallest events without a photo), then the rest of the budget is shared out biggest events first, up to "Photos per event" (default **All**). WebP is used where the browser can encode it (about a third smaller), else JPEG.
- **Everyday moments:** small groups of photos near home become one included event per month ("Everyday moments · May 2023"), instead of being hidden.
- **Duplicates** (Takeout puts a photo in its year folder and in every album; album downloads + Takeout overlap) are skipped: same capture second + same normalised name or same size (`utils/photoImport/dedupe.js`).
- **Date detail:** Day (default) · Day & time (first-last photo, exact minutes, kept on later Studio edits) · Month · Year.
- **AI place guesses:** for events with no location at all, the drafting call also returns `place_guess` + `place_confidence`. High fills "Where?" with an "AI guess" badge, medium is offered as a suggestion, low/none is dropped; generic scenes and private homes are never guessed. Typed or guessed places are geocoded on create.
- **Button:** "Add from Google Photos" uses Google's official icon (`public/brand/google-photos.png`, from gstatic) per the Google Photos UX guidelines (full-color icon on white, #3C4043 label).

**Plans (`entitlements.photo_import_limits`, `GET /api/story/photo-import/limits`):**

| | Guest | Registered | Admin / own Gemini key |
|---|---|---|---|
| Photos per import | 1,000 | 2,000 | no limit |
| Places named per import | 40 | 80 | no limit |
| AI: events per call | 8 | 12 | 40 (client also keeps each request < 10 MB) |
| AI: photos per event / size | 2 @ 384 px | 3 @ 384 px | 6 @ 768 px |
| AI: parallel calls | 1 | 2 | 3 |
| AI: credits | 1 per 12 events (`PHOTO_DRAFT_EVENTS_PER_CREDIT`); AI-first "full" drafts 1 per 8 (`PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT`) | same | never charged |
| AI-first story pass | up to 150 events, 1 credit per 120 | up to 250, same | up to 600, never charged |
| AI instructions (per call) | 2,800 chars | 2,800 chars | 10,000 chars |
| Rate limit (per min) | 8 calls | 12 calls | x4 with own key, none for admin |

A 12-event call with 36 thumbnails at 384 px costs well under one credit (~$0.005) on Flash. Limited
callers' thumbnails are re-checked and downsized on the server, so the price holds for any client.
When the daily credits run out the drafts continue on the free keys like every text operation.
Every number above can be overridden with `GUEST_*` / `REGISTERED_*` env vars.

### ③c AI-first photo import *(built)*

The default way to start from photos (and to add photos to a story): **the user uploads photos,
AI builds the timeline, the user reviews one screen and creates it.** Everything of §3b - reading,
grouping, places, storage, sources - is reused; what changes is who does the writing.

```
Pick photos ─► Ready card ─────────► Build (watch it fill in) ─────────────► Review ─► Create
              what they're about,    places → moments (vision, batched) →    one       (or "Fine-tune
              who's in them, cost    story (text) → overview (text)          screen     in Story Studio")
```

1. **Ready card** (`photo-ai-ready`). Shown while the photos are read, so it costs no time:
   *What are these photos about?* (one line, ≤ 600 chars) and *Who's in them?* (names). This is
   the main quality lever - the AI may only use names and occasions the user gives (or tagged in
   Google Photos). It shows what was found ("24 moments in 312 photos · 9 places"), the total cost
   (`estimateAutoBuildCredits`), **Build my timeline** and **I'll do it myself** (the classic §3b
   review). Admins and own-key users see "Free with your plan" and a 6-second countdown that
   starts the build by itself; typing or focusing a field pauses it.
   **Grouping scale** (`photo-ai-grouping`): *Fewer · Balanced · More · One per day · One per hour ·
   One per photo*, each with its event count (`countGroupingLevels`) and, on limited plans, its
   credit cost. Gating is by credits only: a level whose build costs more than the credits left
   today is disabled ("needs about N credits - your own key removes this limit"). The three fixed
   levels split by wall-clock bucket with no gap/distance/home rules and no "everyday" months, and
   the story pass may not merge them back (`allowMerges: false`). *Dates* (Day / Day & time /
   Month / Year) sits next to it and switches to Day & time for the hourly / per-photo levels.
   **Instructions for the AI** (optional; 2,800 chars, 10,000 for admin / own key, enforced on the
   server) go to every drafting call and the story pass as the user's own instructions - tone,
   voice, length, focus, what to skip - framed so they never override the facts / people rules.
   Limited plans see a note on what the site's key limits and that a personal key removes it (the
   documents panel shows the same kind of note).
2. **Curation (free, on the device).** Screenshots - screenshot-like names (also Hebrew, German,
   French), or a PNG with no camera and no location (`isLikelyScreenshot`, EXIF Make/Model is now
   read) - go to the "not in any event" tray before anything is sent. Bursts were already skipped
   when choosing each event's photos.
3. **Build** (`utils/photoImport/autoBuild.js` → `runAutoBuild`, injected API so it runs in node):
   - **Places** - waits for the reverse-geocoding already running (≤ ~2 min).
   - **Moments** - `POST /api/story/photo-drafts` with `detail: "full"`, batched and in parallel
     per the plan, events in time order (so a batch sees its neighbours); on limited plans a call
     carries whole credits' worth of events (8, not 12). Each event sends its
     place, date, **time of day**, **sequence** ("day 3 of a 12-day trip" - from detected trips, or
     the whole import when there's no home and it spans ≤ 60 days), photo count, the user's note /
     Google captions, tagged people and the plan's photos (cover first, numbered). It returns:

     | AI output | Lands in |
     |---|---|
     | `title` (2–7 words) | event title (`titleSource: 'ai'`; a user's title is never replaced) |
     | `caption` (one sentence) | note → the article's `subtitle` |
     | `story` (one paragraph, 40–140 words, shorter when the photos show little) | story → the article's `extract` (`extractIsCustom`) |
     | `cover_index` (among the photos sent) | the event's cover (unless the user picked one) |
     | `kind`: moment / everyday / screenshot / document / other | screenshot, document, other → left out, badged, one tick to include |
     | `category`, `importance` 1–10 | `category`, `rank` (highlights ≥ 8) |
     | `occasion` - only with clear visual evidence or the user's words | "AI noticed: Birthday - check it's right" on the card |
     | `place_guess` + confidence (photos without a location) | "Where?" as in §3b |

   - **Story** - `POST /api/story/photo-story`, text-only calls over all drafted events in time
     order (one call per `story_max_events` chunk, so a per-photo import is fully covered; each
     chunk is priced on its own and the first names the timeline): `timeline_title`, `story_type` (trip / child / couple / lifeStory / custom),
     `subject_names`, `lane_title`, `chapters` (first/last event ids; ≥ 6 events), `merges` (only
     consecutive events that are one moment split in two), better `titles` (never a user's title)
     and `highlights`. The server checks everything against the events (`normalize_photo_story`):
     chapters ordered and non-overlapping, merges only between neighbours, and **subject names must
     appear in the user's own words** (description, names, tagged people) - except a trip's
     destination. A story type that needs a name it wasn't given falls back to "custom".
     In "add" mode (photos added to an existing story) the title and type are kept.
   - **Overview** - the existing `POST /api/story/overview` over the drafted moments (new
     timelines only), at most 200 moments (the most important) and ≤ 55K chars of facts.
   - Moments fill the list and the Studio canvas as they're written (the canvas follows live
     while building). **Stop** keeps what is done. A failed batch leaves its moments with their
     place/date titles and a "N moments weren't written · Write them" retry; 401/402/403 stop all
     calls; a 429 waits 15 s and retries once. Photos added after the build get "Write them" too.
4. **Review** - one screen: *Your timeline is drafted* with the title, the overview (editable,
   *Redraft with AI*), the named chapters (rename/remove), notices (merged moments with **Undo**,
   left-out items, failures, credits used), then every moment: photos, title, caption, story
   (editable, *Polish with AI*), badges (✦ AI draft, highlight, category, occasion). Grouping,
   date detail, photos per event and lane are folded into *Adjust grouping & photos*.
5. **Create my timeline** builds and saves it directly (`createFromPhotos` in `StoryStudio.jsx`):
   the story type the AI chose when it has the names it needs (`photoImportBlueprint`; couples'
   moments go to the *Together* lane), else the §3b suggestion; title, overview, chapters and the
   lane's name from the AI unless the user typed their own (`photoStoryAnswers`). If something
   required is missing (e.g. a child's name) the user lands in the frame with the reason.
   **Fine-tune in Story Studio** is the classic hand-off to the frame form.

**Fidelity rules** (both prompts): only what is visible plus the place, date, time, sequence, the
user's words and tags; never invent names, relationships, feelings, quotes or backstory; names only
from the user; occasions only with clear evidence (then shown for checking); no descriptions of
bodies, faces, age, ethnicity or clothing; no face recognition of any kind; everything received is
data, not instructions; GPS never leaves the device (place names only).

**AI provenance:** moments drafted by AI carry `aiWritten: true`; the timeline gets
`storyStudio.aiAssisted: true` and `isManual: false` (so its overview opens like any AI timeline
and the "not AI-generated" footer is not shown). Re-opening and saving in the Studio keeps both.

**Cost** (registered; admins and own key: 0). Provisional prices, to be set from real photo sets
with `backend/scripts/photo_story_spike/measure_photo_story.py` (Phase 0 harness: runs the real
prompts on a folder of photos, prints tokens / USD / seconds per call, what the prices charge,
and quality signals, and writes the drafts for review). A smoke run on the test fixtures cost
~$0.0003 per event at 384 px, so 1 credit per 8 full events (~$0.0006/event) has ~2× margin.

| Import | Moments | Story | Overview | Total |
|---|---|---|---|---|
| 4 moments | 1 | 1 | 1 | 3 |
| 25-moment trip | 4 (calls of 8 + 8 + 8 + 1) | 1 | 2 | 7 |
| ~120-moment year | 15 | 1 | 2 | 18 |

When the daily credits run out, calls continue on the free keys like every text operation.

### ③ Gather *(designed)*

Four inputs, all producing **candidates** into one inbox — never writing directly:

1. **Interview.** One question at a time, voice-first (reuse `useSpeechRecognition`).
   - Tier 1 (free): the blueprint's question bank, ordered by what's missing.
   - Tier 2 (AI): gap-driven follow-ups — "Nothing between 1968 and 1975 — what was Arthur doing?",
     "You mentioned the bakery; when did it close?" Free-form answers are turned into dated
     candidates with places. Answers are batched (every ~3 answers or on "Process") to save credits.
2. **Photos.** *Built - see §3b.* Today it writes moments directly after its own review screen;
   when the shared inbox (④) exists it becomes one of its sources.
   ⚠ Some mobile browsers strip GPS from uploaded photos — still to validate on real devices.
3. **Documents.** Existing `/generate-from-files` pipeline with a new **candidates mode**: returns
   events + the source passage for each, instead of a finished timeline.
4. **Quick add.** One line, NL dates ("summer '82 – moved to Haifa") parsed locally.

### ④ Review *(designed)*

Inbox of candidate cards: **Accept · Edit · Merge · Discard**, with:
- provenance badge + source snippet on each card;
- duplicate detection across sources (same wedding from certificate and photos → suggested merge);
- conflict flags ("letter says 1952, you said 1953") — the user picks, nothing is overwritten.

### ⑤ Polish *(designed)*

A **Suggestions** panel computed mostly locally:
- **Gaps:** "No events in the 1970s", "4 events have no place", "No photos before 1990".
- **Write it up (AI):** turn notes into narrative subtitles/extracts using only the user's facts;
  one batched call for all selected events. Marked `ai-wording`.
- **Chapters & overview (AI):** propose time bands and the timeline overview.
- **"The world around them" (AI, optional):** a context lane of public historical events alongside
  the personal story — ChroniX's unique advantage over family-tree apps.
- **Near-misses (free):** two people in the same place within N days before they met (as in the
  Claire & Ethan demo), computed from dates + coordinates.

### ⑥ Share *(reuse)*

Share link, PDF/print, podcast ("Grandpa's life in 15 minutes"), guest quiz (wedding trivia). The
occasion from ① picks the primary call-to-action.

*Later (v3):* **family contributions** — a link where relatives add memories into the owner's
inbox for approval; combined with merge (the trilogy demo) this is how family histories get built.

## 4. Screens (desktop)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [□] Story Studio            (1. Your story)──(2. The frame)   Draft saved ↺ ✕ │
├──────────────────────────────┬────────────────────────────────────────────────┤
│                 What story are you telling?   (full width, no canvas yet)     │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│        │♡ Couple  │ │☺ Child   │ │✈ Trip    │ │…         │                   │
│        └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │
│        ┌ Already have documents? [Import (AI)] [Blank] ┐                     │
└───────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬────────────────────────────────────────────────┐
│ Couple & wedding  [change]   │   ● Changes not shown yet [Apply]        [⤢] │
│ Who is this story about?     │ ┌────────┬──Before we met─────┬Together┬Marr┐ │
│ [Claire      ] [Ethan      ] │ │Together│                 ●  ●──●  ●  ●   │ │
│ Key moments                  │ │Ethan's │ ●                                │ │
│ ✓ When/where was Claire born?│ │Claire's│   ●                              │ │
│   [April 1995] [📍Burlington]│ │        │1995   2000   2005   2010   2015  │ │
│   ✓ April 1995               │ └────────┴───────────────────────────────────┘ │
│ ○ The proposal  [When?] [📍] │                                                │
│ Other moments · Chapters ·   │                                                │
│ Timeline name                │                                                │
├──────────────────────────────┤                                                │
│ ← Back  8 events · 4 chapters│                                                │
│ [Create my timeline]         │  (the real canvas)                             │
└──────────────────────────────┴────────────────────────────────────────────────┘
```

Steps ③–⑤ reuse the same split: workspace on the left (interview thread / inbox / suggestions,
switchable tabs), the canvas on the right, with a credits meter in the workspace footer.

**Mobile (later):** two tabs — *Workspace* | *Timeline* (the existing card feed). The frame form
already wraps to a single column; below `lg` there is no side canvas - "View on canvas" opens it full screen. Voice answers and
camera-roll import are first-class on mobile. Swipe = accept/discard in the inbox (buttons stay).

## 5. Data model

Already in the prototype (stored on `TimelineArticle`, which allows extra fields):

| Field | Meaning |
|---|---|
| `circa: true` | The date is approximate. Preview draws a dashed dot. **TODO:** render "c." in the canvas, drawer and exports. |
| `provenance: 'user'` | Where the fact came from (see principle 2). |
| `storyAnchor` | Which blueprint anchor produced the event. |
| `precision: 'decade'` | Already supported by the model; produced by "the 1960s". |

`TimelineData.storyStudio = { blueprint, version: 2, people, hiddenAutoChapters, autoWritten }`
is written on create and on every Studio save. It is a bounded model field (≤16 KB) and persists
with the timeline. `autoWritten` lists the auto chapters the Studio last wrote, so a chapter band
deleted elsewhere is treated as hidden instead of reappearing.

Planned for ③–⑤:

```
storyStudio: {
  blueprint, version, occasion,
  people: [{ id, name, gender? }],          // gender lets Hebrew templates inflect (נולד / נולדה)
  candidates: [{ id, article, provenance, sourceRef, status: 'new'|'accepted'|'discarded', mergedInto? }],
  sources: [{ id, kind: 'document'|'photo'|'interview', name, keep: bool, snippets: [...] }],
  interview: [{ q, a, askedBy: 'bank'|'ai', processed: bool }],
}
article.people[]      // who an event is about (filters, near-miss detection)
article.sourceRefs[]  // [{ sourceId, snippet }]
```

Drafts: localStorage today (`chronix_story_studio_draft_v1`, answers kept per blueprint).
Server-side drafts arrive with ③ so uploads and interview history survive across devices.

**Storage defaults (decided):** keep photos (they become event media); discard documents after
extraction but keep each event's source passage; "keep original" is an opt-in per document.

## 6. AI & credits

| Action | Where | Cost |
|---|---|---|
| Story, frame, auto chapters, preview, geocoding | ①② | 0 |
| Question bank, gap & near-miss detection, EXIF clustering, quick add | ③⑤ | 0 |
| Interview follow-up / answer processing (batched) | ③ | 1 per batch |
| Document extraction (candidates mode) | ③ | 1–3 by volume (existing `calculate_upload_credit_cost`) |
| Photo drafts (opt-in, classic import) | ③b | 1 per 12 events; free for admin / own key |
| AI-first photo import: moments · story · overview | ③c | 1 per 8 events · 1 per 120 events · 1–2; free for admin / own key |
| Write it up · chapters · overview · world context | ⑤ | 1–2 each, batched |

- Show the cost on every AI button ("Extract 40 pages · 3 credits") and a session meter.
- At 0 credits: nothing breaks; the draft is saved; manual work, photos and review keep working.
  That moment — and only that one — shows **"Keep going with your own Gemini key"**: a 2-minute
  guided flow (Google AI Studio keys have a free tier), framed as "continue now", not a paywall.
  Admin and BYOK are unlimited, per the credit policy.
- Rough estimate (to be measured): a 30-event life story with interview + polish ≈ 15–25 credits,
  about one registered day. Finishing over two sessions should feel normal.

## 7. Access

- Guests may browse step ①; building requires sign-in (drafts and uploads need an account; upload
  generation already requires login).
- The unknown-subject notice ("no reliable information about X") opens the Studio with the name
  pre-filled when the flag is on; its upload/paste buttons still use the classic modal until ③
  exists.

## 8. Rollout

| Version | Scope |
|---|---|
| **v1a — built** | ①②, canvas preview with Apply, fuzzy dates, auto chapters, geocoding on create, local drafts, re-open & edit an existing timeline in the Studio, flag. |
| v1b | Server drafts; ③ documents in candidates mode + ④ inbox; question-bank interview; credit meter + BYOK prompt; "c." rendering everywhere. |
| v1c | ③ photo import (EXIF clustering) **- built**; AI-first photo import (§3c) **- built**; AI interview follow-ups. |
| v2 | ⑤ suggestions: write-it-up, chapters/overview, world-context lane, near-misses; occasion. |
| v3 | Family contributions by link; layered family timelines via merge. |
| Mobile | Two-tab layout over the same engine, after v1b. |

When v1b ships, the flag defaults on and the classic modal is retired (blank canvas stays as a
link inside the Studio).

## 9. Known gaps in the prototype

- Kids content mode uses the classic blueprint wording.
- Hebrew event titles use "נולד/ה"-style forms until people get an optional gender.
- The side canvas is hidden below the `lg` breakpoint (full-screen canvas only; mobile layout pending).

## 10. Code map

| File | Role |
|---|---|
| `frontend/src/data/storyBlueprints.js` | Blueprints + `buildStoryTimeline`, `computeAutoChapters` (pure). |
| `frontend/src/utils/fuzzyDate.js` | `parseFuzzyDate` / `formatFuzzyDate` (EN + HE). |
| `frontend/src/components/storyStudio/StoryStudio.jsx` | The Studio screen (steps ①②). |
| `frontend/src/components/storyStudio/StudioCanvasPreview.jsx` | The real canvas inside the Studio (fed a snapshot on Apply). |
| `frontend/src/components/storyStudio/FuzzyDateInput.jsx` | Date field that echoes what it understood. |
| `frontend/src/data/storyStudioSync.js` | Timeline ⇄ Studio answers: re-open and merge-back (pure). |
| `frontend/src/hooks/useStoryDraft.js` | localStorage draft. |
| `frontend/tests/storyStudio.test.mjs`, `storyStudioSync.test.mjs` | Unit tests for the above. |
| `backend/tests/test_story_studio_meta.py` | `storyStudio` model field. |
| `App.jsx` → `openBuildOwn()` | Routes every Build-Your-Own entry point through the flag. |
| `frontend/src/utils/photoImport/` | Photo import: `photoMeta` (EXIF/filename -> time, GPS), `clusterPhotos` (grouping, home, trips, representatives), `importModel` (review edits, places, budget, -> moments + media), `aiDrafts` (batching, credits), `photoFiles` (browser: exifr, HEIC, thumbnails, encoding). |
| `frontend/src/components/storyStudio/PhotoImportPanel.jsx` | The photo import workspace (AI-first ready card, build, review; and the classic flow). |
| `frontend/src/utils/photoImport/autoBuild.js` | AI-first pipeline (pure): screenshots, look payloads, story pass, chapters, overview facts, cost, `runAutoBuild`, Studio answers. |
| `backend/services/gemini_service.py` → `draft_photo_events(detail="full")`, `draft_photo_story`, `normalize_photo_story` | AI-first prompts and the checks on what they return; endpoints `POST /api/story/photo-drafts`, `POST /api/story/photo-story`. |
| `backend/tests/test_photo_ai_first.py`, `frontend/tests/photoAiFirst.test.mjs`, `frontend/tests/e2e/photoAiFirst.spec.js` | AI-first pricing, plans, normalisation; pipeline; browser end to end. |
| `backend/scripts/photo_story_spike/measure_photo_story.py` | Phase 0: cost / latency / quality on a folder of real photos. |
| `frontend/src/utils/photoImport/takeout.js`, `googlePhotos.js`, `backend/services/google_photos.py` | Google Takeout sidecars; Google Photos Picker (browser + backend proxy). |
| `frontend/src/utils/photoImport/dedupe.js`, `backend/services/photo_store.py` | Duplicate photos; hosted photo storage (`POST /api/photos`, quota in `quota_service.change_hosted_photo_count`). |
| `backend/tests/test_photo_import.py`, `frontend/tests/photoImport.test.mjs`, `frontend/tests/e2e/photoImport.spec.js` | Plans, credits, image checks, reverse geocoding; engine; browser end to end (fixtures in `tests/e2e/fixtures/photos`, made by `make_photo_fixtures.py`). |
| `TimelineEditPanel.jsx` → `onOpenStoryStudio` | "Continue in Story Studio" entry point. |
