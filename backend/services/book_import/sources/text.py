"""Plain text / Markdown / pasted text -> section units (no read stage: the text is already logical)."""

from __future__ import annotations

import re
from typing import List

SECTION_CHARS = 4000


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            text = data.decode(enc)
            if enc == "utf-16" and "\x00" in text:
                continue
            return text
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def split_sections(text: str, max_chars: int = SECTION_CHARS) -> List[str]:
    """Splits at blank lines (paragraphs) into sections of about `max_chars`; a heading line
    (Markdown '#', or a short line followed by a blank line) prefers to start a new section."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    sections: List[str] = []
    cur: List[str] = []
    size = 0
    for p in paras:
        is_heading = p.startswith("#") or (len(p) < 80 and "\n" not in p and not p.endswith((".", ",", ":", ";")))
        if cur and (size + len(p) > max_chars or (is_heading and size > max_chars * 0.5)):
            sections.append("\n\n".join(cur))
            cur, size = [], 0
        while len(p) > max_chars:  # a single huge paragraph
            cut = p.rfind(" ", 0, max_chars)
            cut = cut if cut > max_chars // 2 else max_chars
            sections.append(p[:cut].strip())
            p = p[cut:].strip()
        cur.append(p)
        size += len(p)
    if cur:
        sections.append("\n\n".join(cur))
    return sections
