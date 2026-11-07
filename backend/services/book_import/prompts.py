"""System instructions for each book-import stage. Every stage includes the untrusted-source rule."""

from __future__ import annotations

from typing import Optional

from services.gemini_service import UNTRUSTED_UPLOAD_SECURITY_RULE

PRIVATE_SOURCE_NOTE = (
    "This material is a private family book, memoir, letters or photo pages supplied by the user about "
    "their own family. Reading, transcribing and structuring it faithfully is expected and allowed. "
    "Never invent facts, names or dates that are not in the material."
)

READ_SYSTEM = f"""
You read ONE page (or a two-page spread, or a camera photo of a page) of a book and return a structured,
faithful reading of it.

{PRIVATE_SOURCE_NOTE}

{UNTRUSTED_UPLOAD_SECURITY_RULE}

TRANSCRIPTION
- `blocks`: every piece of text on the page in LOGICAL reading order (for right-to-left languages such as
  Hebrew read right-to-left; on a spread read the right-hand page first when the book is right-to-left).
- Copy text verbatim in its original language. Numbers, dates and years must be copied EXACTLY as printed
  and kept in their correct position within the sentence.
- A "text layer hint" may be provided. It comes from the PDF and is often wrong for mixed right-to-left /
  number lines (numbers end up in the wrong place). Use it ONLY to confirm spelling of words; the page image
  is the source of truth for order and for numbers.
- Use `kind` caption for photo captions, heading for titles (with heading_level 1 for chapter titles),
  poem/quote/recipe/list/table/footnote where they apply. Skip printed page numbers, running headers and
  decorative text (put page numbers in `printed_page_numbers`, running headers in `running_header`).
- Text inside a photographed document (a letter, certificate, newspaper clipping) that is legible should
  also be transcribed as blocks.

PICTURES
- Pictures already detected are outlined in magenta and labelled P1, P2, ... Return exactly one `photos`
  entry for every P label, with its `kind` (photo, document, artwork, map, collage, infographic, decoration,
  logo, other). Use decoration/logo for ornaments, frames, flourishes, icons and backgrounds.
- If you see a real picture that has NO magenta outline (e.g. on a scanned page, a camera photo of a page,
  or small photos baked into a graphic), add it with ref N1, N2, ... and a tight `box_2d`
  [ymin, xmin, ymax, xmax] normalized to 0-1000 of the whole image. One box per individual photo; a group
  of separate photos is several boxes, never one box around all of them. Do not box text columns.
- For a skewed photo in a camera shot of a page, also give `corners` (y,x pairs of the four corners).
- `rotation`: clockwise degrees needed to make the picture upright (usually 0).
- `caption`: the verbatim caption that belongs to THIS picture only. If one caption describes several
  pictures, give it to each and list the others in `caption_shared_with`. If two captions were printed
  together, split them correctly. Never invent a caption.
- `caption_date_text`: any year/date written in the caption, verbatim. `people_named`: names written in the
  caption, exactly as written.
- `description`: one short, factual sentence in the book's language describing what the picture shows
  (setting, number of people, occasion). Do not identify people who are not named in the caption, and do
  not comment on bodies or appearance.

STRUCTURE
- `page_type`: the main type of the page. family_tree for genealogy charts (also fill `tree` with
  parent_of / spouse_of / sibling_of relations exactly as drawn, with any years shown).
  infographic_timeline for designed summary graphics with dates (also fill `infographic`).
- `chapter_title` when the page opens a chapter. `continues_from_previous` / `continues_on_next` when a
  paragraph clearly runs across the page boundary.
- `language`: ISO code of the page's main language.
""".strip()


MAP_SYSTEM = f"""
You are building the MAP of a whole family book before its events are extracted. You receive the faithful
transcription of every unit (page/spread) of the book, marked [[U<n> | ...]], plus picture captions,
family-tree relations and the user's instructions.

{PRIVATE_SOURCE_NOTE}

{UNTRUSTED_UPLOAD_SECURITY_RULE}

Return:
- `title`, `subtitle`, `description` (1-2 sentences), `overview` (a warm 150-300 word summary of the whole
  story in Markdown, facts only), `language` (ISO code of the book), `narrator_perspective` (who is writing
  and about whom, e.g. "the children writing about their parents").
- `cast`: EVERY real person who matters to the story (family members across generations, spouses, key
  friends, rabbis or teachers who recur). `id` short and stable (p1, p2, ...). `name` = the most complete
  real name found anywhere in the book (family-tree pages are authoritative for names and relations).
  `aliases` = every other way the book refers to them, including kinship words exactly as written
  (for example "אמא", "סבא יוסף", "Mom") and nicknames, maiden names, English names.
  `relation_to_subjects` in the book's language. Birth/death as written plus a numeric year when known.
  `importance` 1-10.
- `subject_person_ids`: the main subjects of the book.
- `alias_scopes`: for each kinship alias whose meaning depends on who is narrating (for example "אמא"
  in a chapter written by the children, "סבתא" in another), map alias -> person for the chapters where it
  holds (empty chapter_ids = whole book). Include every kinship alias used in the book.
- `chapters`: the book's own chapters/sections in order with their unit ranges (first_unit..last_unit,
  inclusive, using the U numbers), the narrator if it changes, the people in focus, and the era. Mark
  `include=false` with a `skip_reason` for sections that hold no life events (table of contents,
  dedications, poems/psalms, recipes, indexes) OR that the user's instructions exclude. Every unit must
  belong to exactly one chapter.
- `lanes`: 1-6 parallel lanes that fit the story (for example one per parent and a shared family lane),
  honoring the user's instructions; `rule` says what goes in each lane. One lane is fine for one subject.
- `places`: every place where events happen (towns, cities, countries, institutions, camps, kibbutzim),
  with a `geocode_query` in English (modern name + country) and approximate lat/lng when you know them.
- `anchors`: the key dated facts that other dates can be derived from (births, marriages, migrations,
  deaths), with the unit where each is stated.
- `skip_units`: units with nothing to extract (blank, cover, purely decorative).
- `instructions_applied`: one sentence, in the user's language, saying how you applied their instructions
  (or that there were none).
""".strip()


EVENT_RULES = """
WHAT IS AN EVENT
- Every concrete happening in someone's life that can be placed in time: births, deaths, marriages,
  engagements, moves and migrations, escapes, schooling and graduations, army service, jobs and businesses,
  founding or joining communities, births of children, illnesses, trips, celebrations (weddings, bar/bat
  mitzvahs), reunions, notable family moments and turning points. Be COMPREHENSIVE: a long book has
  hundreds of events. Do not merge distinct happenings; do not split one happening into several.
- Undated but clearly sequenced happenings are still events: give the best derived/inferred date and say so.
- Skip pure reflection, praise, recipes, poems, and general descriptions of character with no happening.
- Events only mentioned as "the full story is in chapter X" get `cross_reference=true` (still extract them).
- Events taken only from an infographic/summary graphic get `from_infographic=true`.

EVIDENCE AND DATES
- `evidence`: 1-3 short VERBATIM quotes (with their unit number) that support the event. Copy exactly.
- `date_text`: the date expression exactly as written (for example "ו׳ באב תש״ד, 26.07.1944",
  "בקיץ 1968", "כשהגיעה לגיל תיכון").
- `start`/`end`: Gregorian date parts with the honest `precision` (day, month, season, year, decade,
  century, unknown). Use `circa=true` for approximate dates.
- `hebrew_start`: when the text gives a Hebrew-calendar date, its parts (year as a number, e.g. 5704).
- `relative_age`: when the date is given as an age ("at 18"), the person and age.
- `date_basis`: explicit (date written), hebrew (Hebrew-calendar date only), caption (from a photo
  caption), derived (computed from anchors, e.g. a birth year plus an age), inferred (estimated from
  context), unknown. Put a short explanation for derived/inferred dates in `date_note`.

PEOPLE, PLACES, LANES, PHOTOS
- `person_ids`: cast ids of everyone involved. Resolve kinship words with the alias scopes for THIS
  chapter. People not in the cast go to `unresolved_people` as written.
- `place_ids` from the map; `place_text` as written when the place is not in the map.
- `lane_id` from the map lanes; `category` from the enum; `importance` 1-10 (10 = life-defining: births,
  marriages, deaths, migrations of the subjects).
- `photos`: link pictures (by id) that depict or document THIS event: role depicts (the picture shows the
  event or its people at that time), document (a letter/certificate about it), related (same period and
  people). Use the caption first, then the text next to it. Rate `confidence` honestly. Each picture should
  usually link to one event. ACCOUNT FOR EVERY PICTURE listed in the part: link it to the event it shows
  or belongs to (a photo of the same people in the same period/place as an event is `related` to it), or
  put its id in `unlinked_photo_ids`. A captioned photo with its own date or occasion (for example "at the
  wedding of X, 1975") that matches no event is itself an event: create it (date_basis caption).

WRITING
- `title`: short and specific (3-9 words). `summary`: one or two sentences (max 200 characters).
  `narrative`: the fuller story of this event from the text (max about 1200 characters), faithful to the
  book, in third person with real names (not "Mom").
""".strip()


EXTRACT_SYSTEM = f"""
You extract the life EVENTS from one part of a family book. You receive the book map (cast with ids and
aliases, chapters, lanes, places, key dated anchors), the transcription of this part marked [[U<n> ...]]
and the pictures on these units with their ids, captions and descriptions.

{PRIVATE_SOURCE_NOTE}

{UNTRUSTED_UPLOAD_SECURITY_RULE}

{EVENT_RULES}
""".strip()


FAST_EXTRACT_SYSTEM = f"""
You turn a short personal document (a letter, a few pages, a short memoir, a handful of photographed
pages or pasted text) into timeline events. You receive its transcription marked [[U<n> ...]] and its
pictures.

{PRIVATE_SOURCE_NOTE}

{UNTRUSTED_UPLOAD_SECURITY_RULE}

First fill the light map fields: `title`, `description`, `overview` (60-150 words, facts only),
`language`, `cast` (people with ids p1, p2, ..., real names, aliases as written), `lanes` (usually one),
`places` (with an English `geocode_query`). Then extract `events`:

{EVENT_RULES}
""".strip()


DEDUPE_SYSTEM = f"""
You decide which candidate events describe the SAME real-world happening (told twice in a family book,
for example in a life-story chapter and again in a detailed chapter). You receive groups of candidate
events with ids, dates, people, places, titles, summaries and their source units.

{UNTRUSTED_UPLOAD_SECURITY_RULE}

Return `groups`: for each set of duplicates, `keep_id` (the most complete and precise one) and `merge_ids`.
Only merge when it is truly the same happening (same people, same occasion, compatible dates). Different
occasions of the same kind (two different weddings, two moves) are NOT duplicates. Events that are not
duplicates are simply not listed.
""".strip()


PHOTO_ASSIGN_SYSTEM = f"""
You place family photos on the right event. For each photo you receive its caption, any date in the
caption, the people named, a short description and the unit it is printed on; then candidate events with
ids, dates, people and titles.

{UNTRUSTED_UPLOAD_SECURITY_RULE}

For each photo return `event_id` (or null when no candidate fits), `confidence` (high when the caption
clearly matches the event, medium when people and period match, low otherwise) and a short `reason`.
""".strip()


def read_user_header(unit_number: int, unit_total: int, kind: str, label: str, is_spread: bool) -> str:
    spread = " It is a two-page spread." if is_spread else ""
    kind_note = {
        "born_digital": "a page of a digitally produced book (PDF).",
        "scanned": "a scanned page.",
        "ocr_scan": "a scanned page.",
        "photo": "a camera photo of a page.",
        "docx": "a section of a word-processor document.",
    }.get(kind, "a page.")
    return f"Unit {unit_number} of {unit_total} ({label}): {kind_note}{spread}"


def output_language_rule(output_language: Optional[str], book_language: Optional[str]) -> str:
    if output_language and output_language not in ("auto", ""):
        return f"Write every title, summary, narrative and description in the language with ISO code '{output_language}'. Keep verbatim quotes (evidence, date_text) in the original language."
    lang = book_language or "the book's language"
    return f"Write every title, summary, narrative and description in {lang} (the book's own language). Keep verbatim quotes in the original language."
