# Book Import: long books, scans and page photos → reviewed personal timeline

## Implementation status (2026-11-06)

**Built** (behind `BOOK_IMPORT_ENABLED` on the backend and the `BOOK_IMPORT` flag on the frontend):
- **Backend:** `backend/services/book_import/` covers sources, stages, store, runner, API, draft operations and timeline build. Also migration `006`, wiring in `main.py`, and tests (`test_book_import_logic.py`, `test_book_import_pipeline.py`).
- **Frontend:** `components/bookImport/` (flow, progress, review workspace), `utils/bookImport/`, book mode in `DocumentImportPanel`, and `StoryStudio` / `App` wiring. Tests: `bookImportDraftModel.test.mjs` (shared vectors with Python) and e2e `bookImport.spec.js`.

**Phase 0 results.** Singer book, `gemini-3.8-flash` for every stage; numbers are from the runs, the eval harness is in `backend/scripts/book_import_spike/`:

| Area | Result |
|---|---|
| Parse | 223 spreads in about 1.1 s. 499 placements, 490 photos after filters. Caption candidates found geometrically for 306 photos (the naive baseline found 265). Clip paths give the visible frame, and the native pixels are cropped to it. Tilted collage photos come out upright. Stacked duplicate placements are collapsed. |
| Read, born-digital | Transcription is exact, including the scrambled RTL/number lines ("וב־7 ביוני 1949"). Caption-to-photo assignment was correct on the sample spreads. Cost about $0.001 and 15 s per spread. Full book: 223 calls, 6.3 min at concurrency 8, **$0.17**, 0 errors. |
| Read, synthetic scans (8 photo-heavy spreads) | 55/57 photos found at IoU ≥ 0.75, precision 55/56, median IoU 0.89–0.99. The two "misses" are in the ground truth: embedded bboxes are larger than the visible clip. |
| Read, synthetic phone photos (rotation, blur, JPEG q70, lighting) | 56/57 found at IoU ≥ 0.5 and 51/57 at IoU ≥ 0.75. The misses at 0.75 are on the tilted collage, where the rotated ground-truth boxes are inflated. |
| Map | 38 people with real names resolved from kinship words, 23 chapters (TOC, intro, recipes and the closing poem marked as skipped), 22 places, 4 lanes (Meir / Judith / the family in Israel / origin families and the Holocaust), 14 anchors. |
| Extract (prompt v2) | 256 events from 25 chunks, 258/266 dated, 91 explicit dates. Direct photo links went from 110 (v1) to 243. 10 chapter albums hold 183 more; 87 photos are left in the tray. |
| Not yet measured | The model's dedupe and photo second pass on the full book: the prepaid Gemini credits ran out (HTTP 402) during that step. Run `run_pipeline.py` again once credits are available. The hand-labeled gold set (event recall/precision) is still to be built. |

**Changes from the plan below:**
- **Photo extraction.** Born-digital photos use the image's native pixels cropped to its clip path, instead of a region render. This gives better resolution, upright collage photos, and no bleed from neighbouring photos.
- **Chapter albums.** Photos with no confident event are grouped into one "Photos: <chapter>" event per chapter, flagged `photo_album` for review. Album chapters (family life, grandchildren) rarely map to single events.
- **Page reordering by printed page numbers** (phone-photo uploads) is not done automatically yet. The upload panel sorts page photos by name and lets the user reorder them. Automatic reordering is deferred to Phase 3.
- **The read stage marks embedded photos with set-of-marks overlays.** Text-layer blocks come from text objects with their effective font size; pdfium's own font size is 1.0 for InDesign files.

## Context
Families have books like `yoni/singer_family_book.pdf`: 223 spread pages (about 446 book pages), Hebrew, with about 480 photos. They are the richest source of personal history there is. Today's Story Studio "From documents" path makes one Gemini call. It caps files at 8 MB and 50 pages, extracts no photos, and gives up after 240 s / 5 min. It cannot take such a book.

**Goal:** upload a born-digital PDF, scanned PDF, DOCX, or a pile of phone photos/scans of pages, plus optional instructions ("focus on Mom", "skip recipes"). The result is a comprehensive draft timeline: events with dates, places and people, and the book's photos cropped and linked to events. The user reviews it in a dedicated workspace, then creates the timeline.

**User decisions (final):**
1. Runs inside the existing FastAPI web process, with every stage checkpointed to Supabase so deploys and restarts resume. Built so it can move to a worker later.
2. Unified: "From documents" uses the new pipeline for every upload when the feature is enabled and the user is entitled. Small inputs take a fast lane. The old single-call path stays as the fallback.
3. A dedicated review workspace that scales to about 300 events and 480 photos.
4. Scans and page photos are in v1.

**Evidence from the sample book:**
- **Photos.** InDesign export with a real text layer. 506 image placements are embedded objects with bounding boxes, so no cropping is needed. Captions are small-font blocks next to photos: a naive geometry rule matched 265 of 481.
- **Scrambled text layer.** Mixed RTL/number lines come out wrong. The page shows "וב־7 ביוני 1949 היגרה…" but the text layer gives "…הברית.1949 ביוני7משה". So the rendered page image is ground truth and the text layer is only a spelling hint.
- **Non-photo pages:** backgrounds, an infographic mini-timeline (p9), a vector family tree (p85), collages, recipes and poems.
- **Hard text features:** kinship aliases written from the narrator's view ("אמא"), Hebrew-calendar dates, relative dates, and stories repeated across chapters.

## Architecture
`book_imports` row (state, lease, draft) + private Storage bucket `book-imports` (sources and artifacts) + an in-process **`BookImportRunner`**.

The runner is independent of `_AI_JOBS`. It has no 240 s deadline, no 15-min TTL and no 5-min client poll. `main.py` only mounts the router, starts and stops the runner in `_app_lifespan` (main.py:631), and passes host callbacks (persist timeline, rate limiters, draining flag).

**Statuses:**
- Main path: `awaiting_upload → queued → running → review → finalizing → completed`.
- Side states: `paused` (reason: `needs_key | daily_quota | billing | invalid_key | retry_later`), `failed`, `cancelled`, `expired`.

**Stages:**
- Full lane: `parse → read → map → extract → reconcile` → *user review* → `finalize`.
- Fast lane: `parse → read* → fast_extract → reconcile`. *Read is skipped for text-only input.

**Fast lane criteria:** ≤12 units, ≤40K chars, ≤24 photos, and no table of contents.

**Resuming:**
- Each stage is idempotent, with per-item checkpoints (read per unit, extract per chunk, finalize per photo). Artifacts have deterministic names.
- A stage records a digest of its inputs, so on resume only the missing work runs.
- Claims use a lease with fencing: a SQL `claim_book_import` with `FOR UPDATE SKIP LOCKED`. A sweeper runs every 30 s and renews leases every LEASE/3. This keeps the instance overlap during a Render deploy from processing an import twice.

## Pipeline stages
1. **Parse** (deterministic, on a dedicated 1-thread `book` executor, because pdfium is not thread-safe). Every input becomes ordered **units**.
   - **PDF** (pypdfium2):
     - Classify each page as born-digital, scanned (one image covering ≥85% of the page and <20 chars), or OCR-layered scan. Reject encrypted files and files over the page cap.
     - Render to a local cache (3000 px long edge for spreads, 2200 px for single pages; Phase 0 tunes these). Store a 1200 px review render and a 360 px thumb.
     - **Born-digital photos:** crop by rendering the image's bbox at native scale. This respects clipping frames, CMYK and masks; raw extraction is used only for hashing and rotated placements.
     - **Decoration filter:** drop images whose hash repeats on ≥3 pages, under 120 px, aspect >6, backgrounds with text over ≥60% of them, or near-flat.
     - **Caption candidates** by geometry: font ≤0.75× the body text size, within 14 pt, ≥30% horizontal overlap.
   - **Scans and phone photos:** the uploaded image (native resolution) is the unit.
   - **DOCX** (python-docx, zip-bomb- and macro-safe): walk the body in order (headings, tables, text-box captions, images). Make sections of about 4K chars.
   - **TXT/MD/pasted text:** sections.
2. **Read** (Gemini vision, one call per unit, in parallel through the AIMD limiter; skipped for text-only units).
   - **Input:** the render with numbered "P1, P2…" boxes drawn over embedded photos (set-of-marks), the text layer marked "may be scrambled, spelling hint only", and the caption candidates.
   - **Output `PageReadOutput`:** `page_type`, `printed_page_numbers`, `chapter_title`, `blocks[]` (verbatim, logical order), `photos[]`, `tree[]` (family-tree relations), `infographic[]`.
   - **Each entry in `photos[]`:** `ref` ("P*" for a marked photo, "N*" for a newly found region with `box_2d` 0–1000), optional `corners`, `kind`, `rotation`, verbatim `caption`, `caption_shared_with`, `caption_date_text`, `people_named` and `description`.
   - **N-boxes** are cropped from the native image, with a Pillow border trim and an optional perspective fix from `corners`.
   - **Page order:** if printed page numbers contradict the upload order (common with phone photos), units are reordered.
3. **Map** (one call over all transcriptions, captions, tree relations and the user's instructions). Output `BookMapOutput`:
   - title, description, overview, language, narrator perspective;
   - `cast[]` (id, name, aliases, birth/death);
   - `alias_scopes[]` (alias → person per chapter, since "אמא" depends on the narrator);
   - `chapters[]` (unit range, include/skip and reason);
   - `lanes[]`, `places[]` (with `geocode_query`), `anchors[]` (key dated facts), `skip_units[]`, `instructions_applied`.
   - **Chunking is done in code**, not by the model: per chapter, ≤12 units or 30K chars, with 1 unit of overlap.
4. **Extract** (one call per chunk, in parallel; the map context comes first so implicit caching applies). Output `ExtractOutput.events[]`:
   - `evidence[{unit, quote}]` and verbatim `date_text`;
   - `title`, `summary` (≤200), `narrative` (≤1500);
   - `start`/`end` as DateParts (year/month/day, precision including season and decade, `circa`), `hebrew_start` parts, `relative_age`, `date_basis` (explicit, hebrew, caption, derived, inferred or unknown);
   - `person_ids`, `unresolved_people`, `place_ids`, `category` (enum), `lane_id`, `importance`;
   - `photos[{photo_id, role, confidence}]`, `cross_reference`, `from_infographic`;
   - plus a list of photos it couldn't link.
5. **Reconcile** (code first, Gemini only for judgment calls):
   - **Dates:** a deterministic gematria parser plus pyluach. A mismatch with the model's answer is flagged. Relative age is resolved to a year; seasons and decades keep their precision; undated events are flagged.
   - **Overlap cleanup:** drop duplicates from chunk overlaps that share the same evidence.
   - **Dedupe:** group candidates in code (Δyear ≤2, shared person or place, token similarity), then Gemini `DedupeOutput` per group (≤40 events). A merge keeps the union of evidence and photos.
   - **Photos:** each photo gets one home event. A second pass, 60 photos per call, covers unlinked photos. Low-confidence photos go to the tray with a suggested event. dHash duplicates are linked once.
   - **Geocoding:** unique places through the Nominatim batch lane, cached. If the model's coordinate is more than 300 km off, keep the model's and flag the place.
   - Then lanes, chapter time bands, ranks, and write the draft (`rev=1`, status `review`).
6. **Finalize** (a background stage, after review):
   - Check the hosted-photo quota and reserve the slots up front (`change_hosted_photo_count`, quota_service.py:3092).
   - Copy accepted photos from the private bucket to `timeline-photos` (`photo_store.new_key`/`put_photo`/`public_url`, :167/:232/:175), recording each copy for idempotency.
   - Build `TimelineData` and persist it (`_persist_timeline_dict`, main.py:2079).
   - Delete sources, renders and unpromoted crops; keep the draft until expiry.

**Gemini call policy** (`gemini_calls.call_structured`):
- Uses `aget_gemini_client` (gemini_service.py:1288) and `_generate_with_retry(max_retries=0)` (:682), which keeps RPM pacing and BYOK verification.
- Has its own retry rules, based on `classify_ai_error` and `retry_after_seconds` (ai_errors.py:267, :296):

| Error | Handling |
|---|---|
| Rate limit | Backoff honoring retry-after; the AIMD limiter cuts concurrency |
| Transient | 3 tries, then the next model |
| Daily quota / billing / invalid key | Pause the import |
| 400 on schema | Retry without the schema, then validate the cleaned JSON |
| Output cut off (MAX_TOKENS) | Split the chunk |

- Usage is logged per stage under the new activity action `book_import`.
- Per-stage model and thinking budget come from env.

**Keys:**
- **Admin:** `BOOK_IMPORT_GEMINI_API_KEY`, else `GEMINI_API_KEY`.
- **BYOK, v1:** the key is kept **in memory only**, which preserves the S-08 minimum-exposure rule. After a restart the import becomes `paused/needs_key`. The open client calls `/resume` automatically with the header; otherwise the "Continue" card asks for it. Encrypted at-rest key storage (AES-GCM, opt-in) is deferred to Phase 3.

## Data contracts
- **Stage outputs** (`book_import/schemas/model_io.py`): flat Pydantic `response_schema` models as described above. Boxes are Gemini-native `box_2d=[ymin,xmin,ymax,xmax]` on a 0–1000 scale. Evidence and verbatim fields come before conclusions.
  - **Checks after each call:** refs must exist, boxes are clamped and must meet a minimum size, an N-box overlapping a P-box (IoU >0.5) is the same photo, unknown ids are dropped, and evidence must be inside the chunk.
- **Artifacts** (`schemas/artifacts.py`):
  - `UnitParse` (text blocks with box and font size, images with box, native size, sha1 and decoration reason, caption candidates).
  - `PhotoRecord` (id like `u0042-p03`, the same on every re-run; box, keys, dhash, caption, description).
- **Draft** (`book_imports.draft` JSONB plus `draft_rev`, about 1–1.5 MB):
  - Top level: `title/description/overview/language/instructionsApplied`, `lanes`, `chapters`, `cast`, `units` (labels like "pp. 82–83").
  - `events[]` fields: `status`, `needsReview`, `flags[]`, `title/summary/narrative`, `dateText/dateBasis/from/to/circa`, `people`, `place{name,lat,lng,source}`, `category`, `lane`, `rank`, `chapterId`, `sourceRefs[{sourceId,unit,printedPage,snippet}]`, `photos[{photoId,role,confidence}]`, `mergedFrom`.
  - `events[].flags[]` values: date_inferred, hebrew_mismatch, undated, possible_duplicate, place_uncertain, low_photo_confidence.
  - `photos[]` fields: status (linked, tray or excluded), `suggestedEventId`, `dupOf`.
  - Page transcriptions are loaded on demand, not stored in the draft.
- **DraftOp union.** Pure `apply_ops` in Python (`draft_ops.py`) and JS (`draftModel.js`), kept identical by shared test vectors. Ops:
  - events: `event.update/setStatus/merge/create`
  - photos: `photo.assign/unassign/exclude/reorder`
  - people: `person.rename/merge/resolveAlias`
  - lanes and chapters: `lane.upsert/delete`, `chapter.rename/setStatus`
  - timeline: `timeline.update`
- **Timeline built at finalize** (`timeline_build.py`):
  - Timeline fields: `isPersonal:true`, `creationSource:"files"` (no new Literal, so a rollback stays safe), and `storyStudio:{blueprint:'custom',version:2,source:'book_import',importId}`.
  - Lanes use `DEFAULT_LANE_PALETTE`; chapters become `timeBands` with ids `ch-*`.
  - Articles: accepted, dated events only, sorted by `date_sort_key`. Ids via `_sanitize_model_id` + `dedupe_article_ids`.
  - Article text: `subtitle=summary`, `extract=narrative`, `extractIsCustom:true`.
  - Article media: `imageUrl` = cover (`imageSource:'upload'`), `additionalImages:[{url,caption}]`.
  - Article extras: `people`, `sourceRefs`, `provenance:"document:<file>#p<n>"`, `circa`, `dateText`, `dateBasis`.
  - Limits: ≤600 articles. Wikipedia enrichment is skipped (`finalize_timeline_from_parsed` is not reused; its helpers are).

## Backend: files
- **New package `backend/services/book_import/`:**
  - `config.py`, `schemas/{model_io,artifacts,draft,api}.py`
  - `store.py`: a store interface with `SupabaseStore` (async httpx to PostgREST and Storage; missing-table detection like enrichment_cache.py) and `LocalStore` (`backend/data/book_imports/`, for dev and tests)
  - `sources/{safety,pdf,docx,images,text}.py`, `photos.py` (filters, caption geometry, dHash, set-of-marks overlay, WebP q82 ≤2048 + thumbs)
  - `hebrew_dates.py`, `geocode.py` (batch Nominatim via `_nominatim_get(lane=NOMINATIM_LANE_BATCH)`, wiki_enricher.py:4727/4607)
  - `prompts.py` (every stage includes `UNTRUSTED_UPLOAD_SECURITY_RULE`, gemini_service.py:2202), `gemini_calls.py`, `chunking.py`, `draft_ops.py`, `timeline_build.py`
  - `stages/{parse,read,map,extract,fast_extract,reconcile,finalize}.py`, `runner.py`, `api.py` (`build_router(host)`)
- **Edits outside the package:**
  - `main.py` (about 40 lines): include the router; runner start and stop in the lifespan (before `_drain_ai_jobs_on_shutdown`); `delete_owner_imports` next to `photo_store.delete_owner_photos` (main.py:7024); host callback for `_persist_timeline_dict`.
  - `executors.py`: add a `book` pool (1 worker).
  - `activity_log.py`: add `book_import` to `AI_ACTIONS`.
  - `requirements.txt`: `pypdfium2>=4.30,<5`, `python-docx>=1.1,<2`, `pyluach>=2.2,<3` (all permissive; no AGPL PyMuPDF).
  - `.gitignore`: `backend/data/book_imports/`, `backend/data/book_eval/`.
- **Helpers reused:**
  - from gemini_service.py: `date_sort_key` (:282), `_sanitize_model_id` (:1905), `new_timeline_id` (:1910), `dedupe_article_ids` (:1886), `DEFAULT_LANE_PALETTE` (:102), `extract_token_metrics` (:760), `log_token_usage_summary` (:872), `clean_json_text` (:406), `extract_response_text` (:394)
  - from elsewhere: `open_image_checked` (image_safety.py:137), `sniff_binary_mime` (upload_security.py), the private-bucket and sign patterns in podcast_store.py (:104, :483), the salted prefix in `photo_store._prefix_for` (:138), and `hosted_photo_quota` (entitlements.py:171)

## Endpoints (registered, non-guest; access set by `BOOK_IMPORT_ACCESS`, v1 = admin + verified BYOK)
| Method & path | Contract |
|---|---|
| `GET /api/book-imports/limits` | enabled, entitled + reason, caps, accept list, active imports |
| `POST /api/book-imports` | `{files[{clientId,name,size,mime}], pastedText≤200k, instructions≤10000, outputLanguage}` → import + signed upload targets. 1 active import per user |
| `POST /{id}/uploads/refresh` | Fresh upload targets for sources not yet uploaded |
| `POST /{id}/start` | Checks the objects exist with the right size and sniffs them → `queued` |
| `GET /{id}` | Status with per-stage `done/total`, counts, `draftRev`, `timelineId`, error |
| `GET /api/book-imports` | List of the user's imports |
| `POST /{id}/resume` | Resume a paused import |
| `POST /{id}/cancel` | Cancel |
| `DELETE /{id}` | Cancel + delete the Storage prefix + soft-delete the row |
| `GET /{id}/draft` | `{rev, draft, assets}`: batch-signed thumb and full URLs, 6 h TTL |
| `POST /{id}/draft/ops` | `{baseRev, ops≤500}` → `{rev}`, or 409 `stale_draft` |
| `GET /{id}/units/{n}` | Review render URL, transcription blocks, photo boxes (source pane) |
| `POST /{id}/finalize` | `{baseRev}` → 202 `finalizing`. 409 when photo quota or event caps are exceeded |
| `PUT /api/book-import-uploads/{id}/{sourceId}` | Local storage backend only. This prefix goes in `_UPLOAD_ROUTE_PREFIXES` (main.py:763); the polling routes must not |

- The BYOK header goes only to limits, create, start and resume: update `frontend/src/utils/byokRoutes.js` and `DEPLOYMENT_STEPS.md`.
- Rate limits use `SimpleRateLimiter`.

## Migration `backend/migrations/006_book_imports.sql` (manual, idempotent, in the style of 003/005)
- **Table `public.book_imports`:**
  - identity and state: id, user_id (cascade), status (CHECK), paused_reason, stage, key_tier, `user_snapshot` jsonb
  - inputs: instructions, output_language, lane (`full`/`fast`), sources jsonb
  - progress: stages jsonb, progress jsonb, usage jsonb, error jsonb
  - draft: draft jsonb, draft_rev, timeline_id
  - scheduling: attempts, not_before, lease_owner, lease_until
  - timestamps: created/updated, expires_at (now + 14 days), deleted_at
- **Indexes:** user, claim, expiry. RLS enabled, service_role only.
- **Functions:** `claim_book_import(owner, lease_s, max_active)` (SKIP LOCKED, respects the global cap), `renew_book_import_lease(id, owner, lease_s)` (returns status, or NULL if the lease was lost), `release_book_import_lease`. Execute granted to service_role only.
- **Rebuild `activity_log_action_check`** to add `book_import`, plus the missing `story_overview` (README.md:286 shows the current list).
- **Bucket `book-imports`:** private, created from code like `podcast_store._ensure_bucket`. Layout: `b/<salted user hash>/<import_id>/{sources,units,photos,extract,reconcile}/…`. Full-resolution renders are kept only in a local temp cache and regenerated when missing.

## Frontend
- **`components/bookImport/`** (lazy-loaded):
  - `BookImportFlow.jsx`: polls, shows progress until review, then the workspace, then finalize progress, then `onOpenTimeline(id)`.
  - `BookImportProgress.jsx`: stage list, paused actions (Resume / Add key / Try later), Cancel, "you can close this window".
  - **`review/`:**
    - `BookReviewWorkspace.jsx`: 3 panes on desktop (chapters, cast and lanes rail | event list | Source/Tray tabs); bottom tabs on mobile.
    - `ReviewToolbar.jsx`: search; filters (needs review, inferred dates, Hebrew dates, undated, duplicates, low-confidence photos, rejected); bulk accept, reject, set lane, merge.
    - `ChapterGroup.jsx`.
    - `EventCard.jsx`: memoized, CSS `content-visibility:auto`. Reuses `FuzzyDateInput` and shows the verbatim `dateText`.
    - `SourcePane.jsx`: review render with an SVG box overlay; transcription with the evidence quote highlighted.
    - `PhotoTray.jsx`: lazy grid, drag plus an "Assign to…" combobox.
    - `CastPanel.jsx`.
    - `FinalizeDialog.jsx`: counts, events still flagged, photo quota.
- **`utils/bookImport/`:**
  - `draftModel.js`: pure ops, selectors and filters, tested in node.
  - `draftSync.js`: 1.5 s debounced op queue; on 409 it reloads and replays.
  - `progressPoller.js`: 3 s while visible, 15 s hidden, no 5-min cap.
  - `uploadPlan.js`: images re-encoded to JPEG ≤3200 px with HEIC decoded, by adding `encodePhotoBlob` to `photoImport/photoFiles.js` (reuses `decodeToBitmap` :197); natural sort plus manual reorder.
  - `useActiveBookImports.js`.
- **`api.js`:** new functions (`fetchBookImportLimits`, `createBookImport`, `uploadBookImportSource` with an XHR PUT and progress, `startBookImport`, `getBookImport`, `listBookImports`, `resumeBookImport`, `cancelBookImport`, `deleteBookImport`, `getBookImportDraft`, `postBookImportDraftOps`, `getBookImportUnit`, `finalizeBookImport`).
  - They must not use `startAiJob`/`recoverResult`, so the source-scanning counts in `aiJobPolling.test.mjs:292-305` and `securityHeadersAndByok.test.mjs` stay valid.
- **Wiring:**
  - `DocumentImportPanel.jsx` gets an optional `onStartBookImport` prop. When present and `limits.entitled`, it switches to book mode:
    - a separate `BOOK_IMPORT_ACCEPT` that adds .docx (`PROMPT_FILE_ACCEPT` is unchanged);
    - server caps;
    - an output-language select and per-file upload progress.
    Otherwise the existing `onGenerate` path is untouched.
  - `StoryStudio.jsx`:
    - lazy `BookImportFlow`, plus `bookImport` state and ref;
    - `showCanvasPane` and the Escape and close guards (:266/:298/:345);
    - "Continue: <name>, ready for review / 45%" cards on the start step;
    - a new `onOpenTimeline` prop.
  - `App.jsx` (StoryStudio mount, about :4812): `onOpenTimeline` closes the Studio and calls `handleSelectTimeline(id)`. `handleGenerateFromDocuments` is untouched, so `partialTimeline.test.mjs:143-157` stays valid.
  - Feature flag `BOOK_IMPORT`: all 4 maps in `featureFlags.js` plus `isBookImportEnabled()`, default off.
  - Locales: a `bookImport` section in `en.js` and `he.js`. RTL-safe logical classes; `dir="auto"` on user text.

## Env and flags
| Variable | Default | Purpose |
|---|---|---|
| `BOOK_IMPORT_ENABLED` | false | Master switch for the routes |
| `BOOK_IMPORT_ACCESS` | `admin_byok` | Who may import |
| `BOOK_IMPORT_RUNNER` | `web` | `off` = the API only enqueues (future worker) |
| `BOOK_IMPORT_MAX_ACTIVE` / `_PER_USER` | 2 / 1 | Running caps |
| `BOOK_IMPORT_GEMINI_CONCURRENCY` / `_GLOBAL_CONCURRENCY` | 8 / 12 | AIMD ceiling per import / global |
| `BOOK_IMPORT_MODEL_{READ,MAP,EXTRACT,RECONCILE}` | `get_gemini_models_to_try()` | Set in Phase 0 |
| `BOOK_IMPORT_THINKING_*` | | Per-stage thinking budget |
| `BOOK_IMPORT_GEMINI_API_KEY` | unset | Dedicated server key for admin runs |
| `BOOK_IMPORT_BUCKET` / `_STORAGE_BACKEND` | | Bucket name / `local` for dev |
| `BOOK_IMPORT_MAX_FILE_MB` / `_MAX_TOTAL_MB` / `_MAX_FILES` / `_MAX_UNITS` | 200 / 600 / 600 / 900 | Caps, subject to the Supabase plan limit |
| `BOOK_IMPORT_RENDER_{SPREAD,PAGE,REVIEW}_PX` | 3000 / 2200 / 1200 | Render sizes |
| `BOOK_IMPORT_LEASE_SECONDS` / `_SWEEP_SECONDS` | 90 / 30 | Lease timing |
| `BOOK_IMPORT_TTL_DAYS` | 14 | Expiry |
| `BOOK_IMPORT_FAST_LANE_*` | 12 / 40000 / 24 | Fast-lane thresholds |
| `BOOK_IMPORT_MAX_USD` | unset | Runaway guard |
| `EXECUTOR_BOOK_WORKERS` | 1 | pdfium serialization |

Frontend: `VITE_ENABLE_BOOK_IMPORT`, `?ff_book_import=1`.

## Phases and exit criteria
0. **Spike and eval harness** (`backend/scripts/book_import_spike/`; outputs go to gitignored `backend/data/book_eval/`). Real Gemini on the Singer book.
   - **Synthetic test sets:**
     - Scans: pages rasterized with the text layer dropped; ground-truth photo boxes come from the embedded bboxes.
     - Phone photos: perspective warp, ±4° rotation, blur, JPEG q70, lighting gradient.
   - **Gold set** in `yoni/book_gold/`: 25 pages of transcriptions and caption↔photo pairs, about 60 events across 4 chapters, a cast of about 25 with alias scopes, and 10 duplicate pairs.
   - **Decides:** models and thinking per stage, render resolution vs. splitting spreads, set-of-marks style.
   - **Verifies:** signed-upload PUT from the browser; the Supabase plan's file-size and storage limits; parse memory and time.
   - **Gates:**
     - Born-digital photo detection ≥0.95 P/R; caption↔photo ≥0.90; body text CER ≤3%, captions ≤6%.
     - Scan boxes: recall ≥0.90 at IoU ≥0.75. Phone photos: IoU ≥0.7 for ≥80%.
     - Event recall ≥0.85 and precision ≥0.90.
     - Dates correct within their precision: ≥0.90 explicit, ≥0.75 derived.
     - People F1 ≥0.85; photo-link accuracy ≥0.80; dedupe precision ≥0.95.
     - Parse: <250 MB peak memory, <5 min.
1. **Backend.**
   - **1a, fast-lane vertical slice:** migration, stores, runner with lease, API, text/DOCX/small PDF/image sources, read, fast_extract, code-only reconcile, draft ops, finalize. Exit: a 2-page letter, a DOCX with images, pasted text and 5 phone photos each complete in under 60 s and open as timelines.
   - **1b, full pipeline:** big-PDF parse, marks, map, chunking, extract, dedupe, photo second pass, geocoding, Hebrew dates. Exit: the Singer book gives ≥250 events, ≥400 linked photos and chapter bands. Killing the process during read or extract resumes with no repeated units. Two processes never double-process an import.
   - **1c, lifecycle:** idempotent finalize, expiry sweeper, account deletion, per-stage activity rows with cost, lease release on shutdown.
2. **Frontend** (can start in parallel with 1b against mocks once the draft and API contracts are frozen).
   - Exit: Playwright green in EN, HE and mobile.
   - Exit: staging run on the Singer book, with no long task over 100 ms when filtering 300 events, and Create opens the timeline with photos and captions.
   - Exit: with the flag off, or for a non-entitled user, everything behaves exactly as today.
3. **Hardening:**
   - TUS resumable uploads;
   - re-run with new instructions (keeps parse and read);
   - canvas preview from the draft via `StudioCanvasPreview`;
   - photo crop editor;
   - encrypted BYOK keys at rest for unattended resume;
   - `worker.py` (`BOOK_IMPORT_RUNNER=off` on web);
   - registered-user access with credits priced by units;
   - admin cost view.

**First implementation steps:**
- Work on a branch `feature/book-import`. The current uncommitted Story Studio documents work (DocumentImportPanel etc.) is the base; ask the user before committing it.
- Copy this plan to `docs/book-import-spec.md`.

## Verification
- **Backend** (`cd backend && ..\.venv\Scripts\python -m pytest tests`). Fixtures come from `tests/fixtures/book_import/make_fixtures.py`, which builds PDFs with pypdfium2 and DOCX files with python-docx.
  - **Unit tests:**
    - Sources: PDF classify, bbox, decoration, caption geometry, encrypted rejection; DOCX order and zip-bomb/macro rejection; image EXIF, perspective, pixel bomb.
    - Hebrew dates: ו׳ באב תש״ד → 1944-07-26, Adar I/II.
    - Logic: reconcile grouping and merge union; `timeline_build` output validates as `TimelineData`.
    - `gemini_calls`: 429, pause, schema fallback, split.
    - Shared draft-op vectors.
  - **Runner tests:** Gemini mocked as in test_backend.py:1814, with `side_effect` keyed by `response_schema`. Covers the full and fast lanes, cancel-and-resume (exactly the missing read calls are made), lease takeover, shutdown release, and `needs_key` after a restart.
  - **Routes:** TestClient + `dependency_overrides`: flag off → 404, guest → 403, stale rev → 409, photo quota → 409.
- **Frontend** (`cd frontend && npm test`, `npm run test:e2e`):
  - `npm test`: draftModel vectors and a 300-event performance check; uploadPlan, progressPoller, draftSync replay; byokRoutes; locale parity; existing source-scanning tests stay green.
  - New `tests/e2e/bookImport.spec.js` (mocks `**/api/**` and `**/storage/v1/**`): upload → progress → review (filters, date edit, assign from the tray, bulk reject) → finalize → timeline visible, in HE/RTL and mobile. `storyStudioStart.spec.js` passes unchanged with the flag off.
- **Manual end-to-end:**
  - Run locally (`start.ps1`) as admin with `BOOK_IMPORT_ENABLED=1` and `?ff_book_import=1`.
  - Import `yoni/singer_family_book.pdf`, a scanned version, 10 phone photos of pages and a DOCX.
  - Review, then Create. Check photos, captions, people, places and source refs in the event drawer.
  - Restart the backend mid-import and confirm it resumes.

## Key risks and mitigations
| Risk | Mitigation |
|---|---|
| Misread Hebrew numbers and tiny captions | Text layer is only a hint; high-resolution renders; eval gates; verbatim `dateText` shown in review |
| Box accuracy on scans and photos | Trim and perspective fix; low-confidence crops go to the tray; crop editor in Phase 3 |
| BYOK rate limits and daily quota | AIMD limiter, a paused state with resume UX, estimated call count shown before start |
| Starving interactive users on the paid key | Global semaphore, optional dedicated key |
| Memory and CPU on a small Render instance | Single-thread pdfium, streamed renders, no full-resolution images in Storage, measured in Phase 0 |
| Deploy overlap double-processing an import | Lease with `SKIP LOCKED` claim, fenced writes |
| Privacy | Private bucket with short-lived signed URLs; deletion after finalize and with the account. Promoted photos are public-but-unguessable like hosted photos today; the finalize dialog says so and lets users exclude photos |
| Prompt injection inside the book | Security rule in every stage, schema-only output, no tools |
| Malicious files | pdfium, size, page and pixel caps; DOCX zip and macro checks |
