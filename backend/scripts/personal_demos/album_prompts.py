"""
Character Visual Anchors & Historical Album Style Generator for Gemini Image AI.
Defines persistent physical traits for each protagonist across their lifespan,
alongside era-specific photographic mediums (19th-c. albumen, 1930s silver gelatin,
1950s Kodachrome, 1970s warm faded Polaroid, 1990s 35mm snapshot, 2020s natural DSLR).
"""

from typing import Dict, Any, Optional

CHARACTER_ANCHORS = {
    # --- HEBREW TRILOGY ---
    "he-grandpa": {
        "name": "Avraham Alon",
        "features": (
            "A handsome Ashkenazi Jewish man with a lean build, prominent thoughtful dark hazel eyes, "
            "a distinctive straight nose, and dark brown hair with a slight wave at the temple. "
            "In youth (1910s-1920s): clean-shaven or slight shadow, earnest expression. "
            "In middle age (1930s-1940s): weathered pioneer/engineer look, neat mustache. "
            "In later years (1950s-1960s): distinguished gray-streaked hair, thin round wire-rimmed spectacles."
        ),
    },
    "he-grandma": {
        "name": "Ruth Altman (Alon)",
        "features": (
            "An elegant Viennese-born Jewish woman with delicate aristocratic features, expressive deep brown eyes, "
            "gentle smile, and dark wavy hair. "
            "In childhood/youth (1920s-1930s): dark wavy bob or finger waves, white lace collar, delicate hands. "
            "In 1940s-1950s: classic mid-century chignon, linen blouse, subtle silver filigree pendant necklace. "
            "In 1960s: poised concert pianist presence, hair touched with silver, warm maternal demeanor."
        ),
    },
    "he-shared": {
        "couple": "Avraham Alon and Ruth Altman (Alon)",
        "features": (
            "Avraham (tall, lean, dark wavy hair turning silver, thin wire glasses) and Ruth (gentle oval face, "
            "dark brown wavy hair in classic chignon, expressive warm brown eyes, silver filigree necklace). "
            "Their children: Amir (tall, inherits father's wavy dark hair and glasses), "
            "Noga (inherits mother's curly dark hair and bright eyes), "
            "Daniel (youngest, playful smile, brown hair)."
        ),
    },
    # --- HEBREW MILESTONES ---
    "he-wedding": {
        "couple": "Yonatan and Maya",
        "features": (
            "Yonatan: 1995-born Israeli man, athletic build, short textured wavy dark brown hair, warm brown eyes, "
            "friendly broad smile, outdoor hiker aesthetic. "
            "Maya: 1996-born Israeli woman, expressive hazel-green eyes, long voluminous dark curly hair, radiant smile, "
            "artistic architect aesthetic with small silver hoop earrings. "
            "Their dog Waffle: an adorable golden-honey scruffy terrier mix with one floppy ear and one upright ear."
        ),
    },
    "he-life80": {
        "name": "Dr. Dalia Erez",
        "features": (
            "An inspiring Israeli woman doctor and poet with striking intelligent blue-gray eyes, a warm compassionate smile, "
            "and an athletic swimmer's frame. "
            "In youth (1950s-1960s): natural sun-bleached brown wavy hair, barefoot kibbutz style. "
            "In middle age (1970s-1990s): practical doctor's lab coat or linen shirt, stethoscope, cropped brown hair. "
            "In elderhood (2000s-2020s): distinguished short silver-white curls, elegant colorful scarf, radiant 80-year-old grandmother. "
            "Husband Uri: tall, kind face, curly salt-and-pepper hair, outdoor hydrologist look."
        ),
    },
    "he-kids": {
        "name": "Ori",
        "features": (
            "Ori: an inquisitive Israeli boy born 2014, with unruly chestnut-brown hair, sparkling hazel eyes, "
            "a scattering of freckles across his nose, and an infectious adventurous grin (gap-toothed at age 6-7). "
            "Sister Alma (born 2017): cute round face, dark curly pigtails, curious big brown eyes. "
            "Dog Luna: fluffy medium-sized golden-caramel rescue dog with gentle brown eyes and white chest patch."
        ),
    },
    # --- ENGLISH TRILOGY ---
    "en-grandpa": {
        "name": "Samuel 'Sam' Mercier",
        "features": (
            "A thoughtful French-American man with keen observant blue eyes, fine features, and dark chestnut hair. "
            "Clockmaker and civil draftsman hands. Wears a practical tweed vest and rolled sleeves. "
            "Gains silver temples and round horn-rimmed drafting spectacles in the 1950s."
        ),
    },
    "en-grandma": {
        "name": "Astrid Lindqvist",
        "features": (
            "A Swedish-born botanical illustrator with striking Nordic features, high cheekbones, clear sea-green eyes, "
            "and thick blonde hair often braided or gathered with a wooden pin. "
            "Carries a weathered leather field sketchpad and brass watercolor tin."
        ),
    },
    "en-shared": {
        "couple": "Sam Mercier and Astrid Lindqvist",
        "features": (
            "Sam (slender, dark hair turning silver, horn-rimmed glasses, tweed) and Astrid (tall Nordic frame, "
            "braided blonde hair turning silver, clear green eyes). Children: Claire, Erik, and Sophie."
        ),
    },
    "en-wedding": {
        "couple": "Ethan and Claire",
        "features": (
            "Ethan: 1994-born American man, sandy-brown hair, warm hazel eyes, dimpled smile, casual New England style. "
            "Claire: 1995-born American woman, auburn wavy hair, bright blue eyes, freckled porcelain skin, botanical painter aesthetic. "
            "Dog Maple: fluffy golden retriever mix with friendly amber eyes."
        ),
    },
    "en-life80": {
        "name": "Arthur Pendelton",
        "features": (
            "Arthur: 1946-born Vermont master timber architect and wooden boatbuilder. Broad capable shoulders, "
            "crinkling laugh lines around deep blue eyes, thick hair (sandy-blonde in youth, iconic snow-white beard and hair in elderhood). "
            "Wife Evelyn: graceful Korean-American cellist with sleek dark hair, elegant posture, and warm eyes."
        ),
    },
    "en-kids": {
        "name": "Leo",
        "features": (
            "Leo: 2014-born Colorado boy, unruly sandy-blonde hair, inquisitive bright blue eyes, gap-toothed grin at age 6-7, "
            "patches on jeans, astronaut/rover graphic tees. Sister Maya: dark curly hair. "
            "Dog Barnaby: scruffy wirehaired golden-tan terrier mix with green bandana."
        ),
    },
    # --- RV ROAD TRIP (HE & EN) ---
    "rv-trip": {
        "couple": "Omer and Noa",
        "features": (
            "Omer (31-year-old man, short wavy dark brown hair, neat light beard stubble, warm brown eyes, wearing an open plaid flannel shirt or outdoor windbreaker) "
            "and Noa (29-year-old woman, chestnut-brown wavy hair worn half-up or under a knit beanie/cap, hazel-green eyes, subtle freckles, vintage Fujifilm camera strap across her shoulder). "
            "Their RV ('Goldie'): a classic 25-foot cream-white Class-C cab-over motorhome with warm retro desert-orange and mustard-gold horizontal side stripes."
        ),
    },
}


def get_era_photo_style(year: Optional[int]) -> str:
    """Returns the precise photographic medium, chemical process, and texture for the era."""
    if year is None:
        return "Authentic vintage family album photograph, natural documentary lighting, matte finish"
    if year < 1910:
        return (
            "Authentic late 19th-century / Edwardian sepia albumen cabinet card photograph, "
            "warm brown sepia tones, subtle photographic grain, soft edge vignetting, studio matte print"
        )
    elif year < 1930:
        return (
            "Authentic 1910s-1920s vintage gelatin silver monochrome photograph, warm grayscale tones, "
            "slight chemical grain, vintage lens softness, authentic archival print from a family heirloom album"
        )
    elif year < 1945:
        return (
            "Authentic 1930s-1940s classic black and white 35mm documentary photograph, crisp contrast, "
            "rich mid-tones, natural sunlight, candid Leica photojournalism style, authentic pre-war / wartime family snapshot"
        )
    elif year < 1960:
        return (
            "Authentic 1950s early Kodachrome color film photograph, warm rich analog color palette, "
            "golden highlights, subtle film grain, square medium-format framing, authentic 1950s family scrapbook picture"
        )
    elif year < 1975:
        return (
            "Authentic 1960s-1970s vintage color photograph, classic Kodacolor / Ektachrome tones, "
            "warm nostalgic amber-yellow cast, gentle organic film grain, authentic 1970s family album photo with slight aged border warmth"
        )
    elif year < 1990:
        return (
            "Authentic 1980s color snapshot photograph, 35mm point-and-shoot camera aesthetic, "
            "natural warm indoor/outdoor flash, authentic 1980s Kodak color emulsion, real nostalgic family photo print"
        )
    elif year < 2005:
        return (
            "Authentic 1990s-early 2000s glossy color 35mm family snapshot, natural candid capture, "
            "warm room lighting or bright daylight, authentic 90s family scrapbook photo"
        )
    else:
        return (
            "Authentic contemporary candid DSLR/smartphone family photograph, natural ambient lighting, "
            "crisp clean details, shallow depth of field, genuine unstaged documentary moment"
        )


def build_coherent_album_prompt(
    timeline_id: str,
    title: str,
    subtitle: str,
    year: Optional[int],
    location_name: Optional[str] = None,
) -> str:
    """Combines character physical anchors, event narrative, and historical photo medium into a master prompt."""
    anchor_key = None
    if "he-grandpa" in timeline_id:
        anchor_key = "he-grandpa"
    elif "he-grandma" in timeline_id:
        anchor_key = "he-grandma"
    elif "he-shared" in timeline_id:
        anchor_key = "he-shared"
    elif "he-wedding" in timeline_id:
        anchor_key = "he-wedding"
    elif "he-life80" in timeline_id:
        anchor_key = "he-life80"
    elif "he-kids" in timeline_id:
        anchor_key = "he-kids"
    elif "en-grandpa" in timeline_id:
        anchor_key = "en-grandpa"
    elif "en-grandma" in timeline_id:
        anchor_key = "en-grandma"
    elif "en-shared" in timeline_id:
        anchor_key = "en-shared"
    elif "en-wedding" in timeline_id:
        anchor_key = "en-wedding"
    elif "en-life80" in timeline_id:
        anchor_key = "en-life80"
    elif "en-kids" in timeline_id:
        anchor_key = "en-kids"
    elif "rv-trip" in timeline_id:
        anchor_key = "rv-trip"

    anchor_info = CHARACTER_ANCHORS.get(anchor_key, {})
    char_desc = anchor_info.get("features", "")
    era_style = get_era_photo_style(year)
    loc_clause = f"in {location_name}" if location_name else ""
    year_clause = f"circa {year}" if year else ""

    prompt = (
        f"A real, authentic family album documentary photograph depicting this milestone {year_clause} {loc_clause}.\n\n"
        f"Scene & Event: {title}. {subtitle}\n\n"
        f"Key Person / Character Consistency: {char_desc}\n\n"
        f"Photographic Style & Medium: {era_style}.\n"
        f"Framing: Horizontal 16:9 composition, perfectly balanced, candid, emotionally genuine.\n"
        f"CRITICAL: Absolutely NO text, letters, words, dates, captions, signs, watermarks, frames, borders, or collage elements. "
        f"A single, seamless photographic frame looking like a real developed photograph from a family archive."
    )
    return prompt
