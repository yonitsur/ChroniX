from typing import Optional


AUTONOMOUS_CURATOR_GUIDELINE = (
    "AUTONOMOUS EVENT DENSITY & HISTORICAL SCOPE CURATION:\n"
    "As an elite chronological historian and timeline curator, YOU have editorial discretion to determine the optimal event count (typically 10 to 50 events for documented subjects) based on the topic's historical breadth, duration, and factual depth. Honesty overrides every count below: never invent events to reach a range.\n\n"
    "CALIBRATION MATRIX:\n"
    "1. MONUMENTAL SWEEPS, CIVILIZATIONAL SHIFTS & GLOBAL WARS (35 TO 50 EVENTS): Centuries-long eras, global conflicts, scientific revolutions, or multi-lane timelines (12-18 events per lane across 2-4 lanes). Cover precursors, breakthroughs, key publications/debates, turning points, and lasting legacy.\n"
    "2. HISTORICAL ERAS, DECADES & COMPREHENSIVE BIOGRAPHIES (25 TO 35 EVENTS): Multi-year/decade eras or full biographies of iconic figures.\n"
    "3. FOCUSED PERIODS, SPECIFIC CAMPAIGNS & DEFINED SUBJECTS (16 TO 24 EVENTS): Single administrations, reigns, expeditions, regional crises, or inventions.\n"
    "4. COMPACT WINDOWS & SHORT CRISES (10 TO 16 EVENTS): Tight chronological windows (hours, days, or weeks; e.g. a single battle, crisis, or mission).\n"
    "4b. SPARSELY DOCUMENTED, PRIVATE, OR UNRECOGNIZED SUBJECTS (NO MINIMUM — 0 TO A HANDFUL):\n"
    "   - Real subjects with limited public records: include ONLY verified events, even if just 1 to 5 (`subject_status: \"sparse\"`).\n"
    "   - Private or non-notable individuals (relatives, colleagues, managers) or unrecognized names: return ZERO events (`subject_status: \"unknown\"`). Never fabricate a biography.\n"
    "5. USER PHRASING OVERRIDES: 'brief'/'summary'/'top 10'/'concise' -> 10 to 15 events; 'in detail'/'comprehensive'/'deep dive'/'exhaustive' -> 40 to 50 events.\n\n"
    "EDITORIAL QUALITY RULES:\n"
    "- NO ARTIFICIAL CEILINGS & ANTI-PADDING: Rich topics deserve 30-50 verified events; never pad with duplicates or filler.\n"
    "- SUBSTANTIVE SUBTITLES: Calibrate `subtitle` by weight: 3-5 sentences (~60-95 words) for pivotal milestones (ranks 7-10 & bookends) detailing catalyst, action, and lasting significance; 2-3 sentences (~40-65 words) for supporting milestones (ranks 1-6). Each event must be self-contained yet narratively cohesive; never write dry or one-sentence summaries."
)

DOCUMENT_EXTRACTION_GUIDELINE = (
    "DOCUMENT EXTRACTION DENSITY & SCOPE CURATION (NO 50-EVENT CAP):\n"
    "Faithfully extract ALL genuine chronological milestones documented in the source material without forcing an arbitrary count or stopping at 50 events. "
    "Calibrate event density strictly to what the material supports (3-8 for a short document/photo set, 10-25 for an article/chapter, 30-150+ for a comprehensive memoir/book or structured event list). "
    "CRITICAL: If the uploaded document or pasted text already presents a structured list of numbered or bulleted events/milestones (even 80, 100, or 120+ events across multiple sections or lanes), you MUST extract and include EVERY SINGLE ONE of those events without skipping, summarizing, merging, or truncating at 50. "
    "If the document defines multiple timelines/lanes/sections (e.g. 'ציר זמן 1', 'ציר זמן 2', 'ציר זמן 3' or explicit `ציר:` / lane labels per event), create the corresponding parallel `lanes` and assign each event to its matching `lane` ID. "
    "Never invent events or hallucinate details.\n"
    "- SUBTITLES: Provide an informative 2-4 sentence narrative detailing the occurrence, context, and significance (preserving the rich description from the source when provided).\n"
    "- CATEGORIES & TAGS: Assign 1 to 3 curated domain categories from: "
    "[\"History & Politics\", \"Science & Technology\", \"Space & Aviation\", \"Geography & Nations\", \"Arts & Culture\", \"Nature & Evolution\", \"Biographies & Figures\", \"Military & War\", \"Business & Economy\", \"Society & Philosophy\"], and 2 to 5 specific tags."
)

KIDS_CURATOR_GUIDELINE = (
    "KIDS MODE (AGES 8-11) — CURATION, TONE & STORYTELLING:\n"
    "You are writing for curious children (ages 8 to 11). Every title, overview, event subtitle, question, and suggestion MUST be tailored for young explorers while remaining 100% factually and chronologically accurate.\n\n"
    "1. VOICE, READABILITY & PUNCTUATION RESTRAINT:\n"
    "   - Write like an inspiring museum guide or favorite science/history storyteller: vivid, clear, engaging, and easy to understand.\n"
    "   - Avoid dense academic jargon, bureaucratic phrasing, or overly complex vocabulary. If an important scientific or historical term is needed, explain it simply right in the sentence.\n"
    "   - Never sound 'babyish', over-hyped, or condescending — aim for the sweet spot (like National Geographic Kids, Horrible Histories, or BrainPOP) that captivates a curious 8- to 11-year-old.\n"
    "   - PUNCTUATION RESTRAINT (NO EXCLAMATION MARK SPAM): Use normal periods (`.`) by default. Let the fascinating facts speak for themselves rather than shouting with `!`. Never put exclamation marks in event `title`s, and use at most 1 or 2 exclamation marks across the entire timeline (or none at all).\n"
    "2. EVENT DENSITY FOR KIDS:\n"
    "   - Select the 12 to 24 most fascinating, memorable, and story-driven milestones for well-documented topics (or 8-12 per lane for multi-lane timelines), unless the user explicitly asks for a different count.\n"
    "   - Focus on big discoveries, turning points, everyday life, surprising inventions, heroic moments, and remarkable facts rather than dry treaties or bureaucratic dates.\n"
    "   - For sparse or unknown subjects, follow the exact same strict honesty rules (0 events for private/unknown individuals; never invent facts).\n"
    "3. KID-FRIENDLY TITLES, SUBTITLES & OVERVIEW:\n"
    "   - `title` & `description`: Clear, inviting, and engaging (no exclamation marks).\n"
    "   - `overview`: 100 to 160 words (1-2 engaging paragraphs) that hook the young reader, explain what makes this subject so cool and important, and invite them to explore the timeline.\n"
    "   - Event `title`: Short, vivid, and easy to grasp at a glance.\n"
    "   - Event `subtitle`: 2 to 3 clear, engaging sentences (~35-65 words) explaining what happened, why it mattered, and a cool detail or relatable comparison, ending with normal periods.\n"
    "4. AGE-APPROPRIATE FRAMING (AGES 8-11):\n"
    "   - Present wars, disasters, and historical injustices honestly and respectfully, focusing on causes, human resilience, courage, and lessons learned — strictly avoiding graphic violence, gore, or disturbing adult details.\n"
    "5. KID-APPEALING SUGGESTIONS:\n"
    "   - `related_prompts`: 3 fun, curiosity-sparking related topics kids would love to explore next.\n"
    "   - `chat_questions`: 3 intriguing, wonder-filled questions a curious kid would love to ask about this timeline (e.g. 'How did they build...', 'What was it like to...', 'Why did...').\n"
    "   - `chat_edit_ideas`: 3 fun, accessible ideas for adding or customizing events on the timeline."
)

KIDS_MODE_SYSTEM_ADDENDUM = (
    "\n\nACTIVE AUDIENCE MODE: KIDS (AGES 8-11).\n"
    "All generated text (timeline title, description, overview, lane titles, event titles, event subtitles, timeband titles, related_prompts, chat_questions, and chat_edit_ideas) MUST be adapted for ages 8-11: clear, vivid, curiosity-sparking, free of dry academic jargon, and age-appropriate, while preserving 100% historical/scientific accuracy and canonical Wikipedia titles. Use normal periods (`.`) and avoid overusing exclamation marks (`!`)."
)

CONTENT_MODES = ("classic", "kids")

AUDIENCE_LABELS = {
    "kids": "KIDS MODE (AGES 8-11)",
}

AUDIENCE_WRITING_STYLES = {
    "kids": "a vivid, clear, warm, curiosity-sparking storytelling style tailored for children aged 8-11 (no complex academic jargon, age-appropriate framing)",
}


def normalize_content_mode(mode: Optional[str]) -> str:
    return mode if mode in CONTENT_MODES else "classic"


def audience_style_note(content_mode: Optional[str], subject: str) -> str:
    """One-line audience instruction for `subject` (e.g. "Write `title` and `subtitle`"), or "" for classic."""
    mode = normalize_content_mode(content_mode)
    if mode == "classic":
        return ""
    return f"{AUDIENCE_LABELS[mode]}: {subject} in {AUDIENCE_WRITING_STYLES[mode]}."


def get_curator_guideline(content_mode: Optional[str]) -> str:
    mode = normalize_content_mode(content_mode)
    if mode == "kids":
        return KIDS_CURATOR_GUIDELINE
    return AUTONOMOUS_CURATOR_GUIDELINE


def get_mode_system_addendum(content_mode: Optional[str]) -> str:
    mode = normalize_content_mode(content_mode)
    if mode == "kids":
        return KIDS_MODE_SYSTEM_ADDENDUM
    return ""


def build_generation_prompt(
    prompt: str,
    custom_focus: Optional[str] = None,
    content_mode: Optional[str] = "classic",
) -> str:
    focus_instruction = f"Special focus: {custom_focus}\n\n" if custom_focus else ""
    mode = normalize_content_mode(content_mode)
    curator_guideline = get_curator_guideline(mode)
    audience_line = (
        "\nIMPORTANT: Adapt all narrative text, titles, subtitles, overview, and suggestions for curious kids (ages 8-11) in a fun, clear, accessible, and engaging storytelling style.\n"
        if mode == "kids"
        else ""
    )
    return f"""Create an interactive visual timeline for the topic: "{prompt}".

{focus_instruction}{curator_guideline}{audience_line}
Respond in the SAME natural language the prompt above is written in, and provide canonical Wikipedia titles in that language (plus `wikipedia_title_en` when `detected_language` is not 'en').
Maintain exactly ONE single timeline lane for all events unless the prompt or focus explicitly instructs to divide into multiple lanes/swimlanes OR explicitly names 2+ distinct facets, themes, or dimensions to cover in parallel (e.g., "scientific breakthroughs and key life milestones" -> 2 parallel lanes).
Differentiate single-moment milestones from prolonged spans (`to_year` or `is_to_present: true`).
Output compact JSON: omit indentation whitespace and omit any optional field whose value is null, false, or empty string.
"""


def build_grounding_research_prompt(prompt: str, content_mode: Optional[str] = "classic") -> str:
    mode = normalize_content_mode(content_mode)
    density_note = (
        "Return a CONCISE bullet list covering the 12 to 24 most fascinating, memorable, and kid-friendly chronological milestones for this topic (calibrated for ages 8-11) — one bullet per event with its exact verified date (year, month, day if known) and a short, clear factual description. No introductions or prose. "
        if mode == "kids"
        else "Return a CONCISE bullet list covering the key chronological milestones calibrated dynamically to the topic's natural scope and historical depth (typically 10 to 50 events for well-documented topics) — one bullet per event with its exact verified date (year, month, day if known) and a short factual description. No introductions or prose. "
    )
    return (
        f"Search Google for accurate chronological milestones, key events, and exact dates for the topic: '{prompt}'. "
        "Prioritize authoritative academic consensus, peer-reviewed historiography, museums, and established encyclopedias, filtering out popular myths, viral misinformation, and unverified internet summaries. "
        "Verify dates strictly without guessing arbitrary days or months if only the year is documented. "
        "Acknowledge any significant scholarly debates or revised chronologies where relevant. "
        + density_note +
        "IDENTITY CHECK: if the topic is a person, only report facts about that exact person — never merge results about different people who share or resemble the name. "
        "If the search finds no reliable sources about this exact subject (e.g. a private individual), reply ONLY with the line 'NO RELIABLE PUBLIC INFORMATION FOUND' and do not list any events. "
        "If only a few facts are verifiable, list only those few — never pad the list. "
        "Search in the topic's own language and in English as needed to find the most accurate facts and dates."
    )
