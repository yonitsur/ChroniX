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
    "DOCUMENT EXTRACTION DENSITY & SCOPE CURATION:\n"
    "Faithfully extract genuine chronological milestones documented in the source material without forcing an arbitrary count. "
    "Calibrate event density strictly to what the material supports (3-8 for a short document/photo set, 10-20 for an article/chapter, 20+ for a memoir/book). "
    "Never invent events or hallucinate details.\n"
    "- SUBTITLES: Provide an informative 2-4 sentence narrative detailing the occurrence, context, and significance.\n"
    "- CATEGORIES & TAGS: Assign 1 to 3 curated domain categories from: "
    "[\"History & Politics\", \"Science & Technology\", \"Space & Aviation\", \"Geography & Nations\", \"Arts & Culture\", \"Nature & Evolution\", \"Biographies & Figures\", \"Military & War\", \"Business & Economy\", \"Society & Philosophy\"], and 2 to 5 specific tags."
)


def build_generation_prompt(prompt: str, custom_focus: Optional[str] = None) -> str:
    focus_instruction = f"Special focus: {custom_focus}\n\n" if custom_focus else ""
    return f"""Create an interactive visual timeline for the topic: "{prompt}".

{focus_instruction}{AUTONOMOUS_CURATOR_GUIDELINE}

Respond in the SAME natural language the prompt above is written in, and provide canonical Wikipedia titles in that language (plus `wikipedia_title_en` when `detected_language` is not 'en').
Maintain exactly ONE single timeline lane for all events unless the prompt or focus explicitly instructs to divide into multiple lanes/swimlanes OR explicitly names 2+ distinct facets, themes, or dimensions to cover in parallel (e.g., "scientific breakthroughs and key life milestones" -> 2 parallel lanes).
Differentiate single-moment milestones from prolonged spans (`to_year` or `is_to_present: true`).
Output compact JSON: omit indentation whitespace and omit any optional field whose value is null, false, or empty string.
"""


def build_grounding_research_prompt(prompt: str) -> str:
    return (
        f"Search Google for accurate chronological milestones, key events, and exact dates for the topic: '{prompt}'. "
        "Prioritize authoritative academic consensus, peer-reviewed historiography, museums, and established encyclopedias, filtering out popular myths, viral misinformation, and unverified internet summaries. "
        "Verify dates strictly without guessing arbitrary days or months if only the year is documented. "
        "Acknowledge any significant scholarly debates or revised chronologies where relevant. "
        "Return a CONCISE bullet list covering the key chronological milestones calibrated dynamically to the topic's natural scope and historical depth (typically 10 to 50 events for well-documented topics) — one bullet per event with its exact verified date (year, month, day if known) and a short factual description. No introductions or prose. "
        "IDENTITY CHECK: if the topic is a person, only report facts about that exact person — never merge results about different people who share or resemble the name. "
        "If the search finds no reliable sources about this exact subject (e.g. a private individual), reply ONLY with the line 'NO RELIABLE PUBLIC INFORMATION FOUND' and do not list any events. "
        "If only a few facts are verifiable, list only those few — never pad the list. "
        "Search in the topic's own language and in English as needed to find the most accurate facts and dates."
    )
