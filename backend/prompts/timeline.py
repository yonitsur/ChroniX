from typing import Optional


AUTONOMOUS_CURATOR_GUIDELINE = (
    "AUTONOMOUS EVENT DENSITY & HISTORICAL SCOPE CURATION (10 TO 50 EVENTS):\n"
    "As an elite chronological historian, scholar, and timeline curator, YOU have complete editorial discretion to determine the optimal event count (strictly within 10 to 50 events) based on the topic's authentic historical breadth, chronological duration, and factual depth.\n\n"
    "CALIBRATION MATRIX — EXERCISE SCHOLARLY JUDGMENT:\n"
    "1. MONUMENTAL SWEEPS, CIVILIZATIONAL SHIFTS & GLOBAL WARS (35 TO 50 EVENTS):\n"
    "   - Topics spanning centuries, global theaters, paradigm-shifting revolutions, or multi-lane timelines (e.g. World Wars, Ancient Rome, The Scientific Revolution, The Enlightenment, Industrial Revolution, History of Computing, Evolutionary Milestones):\n"
    "   - DO NOT provide a lazy, surface-level overview of 10-12 famous names. Deliver an expansive, masterclass timeline of 35 to 50 events. Unpack the full historical arc: structural precursors and underlying forces, seminal breakthroughs and key publications, critical debates and correspondence, pivotal turning points across multiple theaters/disciplines, counter-reactions and societal friction, and enduring legacy.\n"
    "   - MULTI-LANE SWIMLANES (35 TO 50 EVENTS TOTAL): When swimlanes are requested (2 to 4 parallel tracks), curate 12 to 18 high-impact events per lane so every track feels robust, rich, and autonomous.\n\n"
    "2. HISTORICAL ERAS, DECADES & COMPREHENSIVE BIOGRAPHIES (25 TO 35 EVENTS):\n"
    "   - Topics spanning years to several decades, or the complete lifespan of iconic historical, scientific, or cultural figures (e.g. The Cold War, The Space Race, American Civil War, Renaissance Masters, Full Life Biographies):\n"
    "   - Curate 25 to 35 substantial milestones spanning formative roots, major developmental turning points, critical achievements, lesser-known pivotal moments, and final impact.\n\n"
    "3. FOCUSED PERIODS, SPECIFIC CAMPAIGNS & DEFINED SUBJECTS (16 TO 24 EVENTS):\n"
    "   - Topics with a defined, moderate scope (e.g. a single administration or reign, a specific expedition, a regional conflict or diplomatic crisis, the development and launch of a specific invention):\n"
    "   - Curate 16 to 24 milestone-rich events capturing every key stage of development without stretching the material.\n\n"
    "4. COMPACT WINDOWS, SHORT CRISES & SPARSELY DOCUMENTED SUBJECTS (10 TO 16 EVENTS):\n"
    "   - Topics with a tight chronological window (hours, days, or weeks; e.g. a single battle, a 13-day crisis, a spaceflight mission) OR subjects with limited public records / private figures:\n"
    "   - Curate 10 to 16 precise, high-confidence authentic milestones. Never invent filler or hallucinate unverified details.\n\n"
    "5. USER PHRASING & INTENT OVERRIDES:\n"
    "   - If the user's prompt explicitly asks for brevity (e.g. 'brief', 'summary', 'overview', 'top 10', 'concise', 'short', 'compact'): Calibrate toward 10 to 15 events.\n"
    "   - If the user's prompt explicitly asks for depth (e.g. 'in detail', 'comprehensive', 'deep dive', 'step by step', 'exhaustive', 'extended'): Calibrate toward the maximum (40 to 50 events).\n\n"
    "EDITORIAL QUALITY RULES:\n"
    "- NO ARTIFICIAL CEILINGS: Rich topics deserve generous, rewarding depth (30-50 events). Never cut a vast topic short out of laziness.\n"
    "- ANTI-PADDING: Every single event must be a verified, meaningful milestone. Never pad with artificial duplicates or trivial filler.\n"
    "- SUBSTANTIVE SUBTITLES: Every event's `subtitle` must be an informative narrative calibrated dynamically to historical weight: 3-5 sentences (~60-95 words) for major turning points / pivotal milestones (ranks 7-10) detailing catalyst, action, and enduring significance; 2-3 sentences (~40-65 words) for supporting milestones (ranks 1-6). Never provide dry, telegraphic, or one-sentence summaries."
)


def build_generation_prompt(prompt: str, custom_focus: Optional[str] = None) -> str:
    focus_instruction = f"Special focus: {custom_focus}" if custom_focus else ""
    return f"""
Create an interactive visual timeline for the topic: "{prompt}".

{AUTONOMOUS_CURATOR_GUIDELINE}

{focus_instruction}
Respond in the SAME natural language the prompt above is written in, and provide canonical Wikipedia titles in that language along with English fallback titles in wikipedia_title_en.

LANE INSTRUCTION: Maintain exactly ONE single timeline lane for all events unless the prompt or focus explicitly instructs to divide into multiple lanes/swimlanes.

TOPIC & COLOR CODING INSTRUCTION:
- Assign EVERY event a concise thematic `category` (1-3 words).
- Reuse a consistent set of 2 to 6 topics across the entire timeline.
- Topic (`category`) determines the event's visual color, independently of its lane.

TIMELINE CATEGORIES & TAGS INSTRUCTION:
- `categories`: Assign 1 to 3 curated categories from this exact list:
  ["History & Politics", "Science & Technology", "Space & Aviation", "Geography & Nations", "Arts & Culture", "Nature & Evolution", "Biographies & Figures", "Military & War", "Business & Economy", "Society & Philosophy"]
- `tags`: Assign 2 to 5 specific, high-value entity, geographic, or topical tags.

DURATION & DATE SPANS INSTRUCTION:
- Differentiate strictly between single-moment milestones and prolonged periods.
- Prolonged events must include start and end dates, or set `is_to_present: true` when ongoing.
- Leave `to_year` null only for instantaneous or single-day events.

EVENT DESCRIPTION & SUBTITLE INSTRUCTION:
- Use 3 to 5 informative sentences for major events and 2 to 3 for supporting events.
- Keep each event independently readable while maintaining narrative continuity.
- Format formulas with standard LaTeX inside $...$ or $$...$$.
- Do not produce one-sentence, laconic, or telegraphic summaries.

Return a structured JSON timeline following the schema.
"""


def build_grounding_research_prompt(prompt: str) -> str:
    return (
        f"Search Google for accurate chronological milestones, key events, and exact dates for the topic: '{prompt}'. "
        "Prioritize authoritative academic consensus, peer-reviewed historiography, museums, and established encyclopedias, filtering out popular myths, viral misinformation, and unverified internet summaries. "
        "Verify dates strictly without guessing arbitrary days or months if only the year is documented. "
        "Acknowledge any significant scholarly debates or revised chronologies where relevant. "
        "Return a CONCISE bullet list covering the key chronological milestones calibrated dynamically to the topic's natural scope and historical depth (between 10 to 50 events) — one bullet per event with its exact verified date (year, month, day if known) and a short factual description. No introductions or prose."
        " Search in the topic's own language and in English as needed to find the most accurate facts and dates."
    )
