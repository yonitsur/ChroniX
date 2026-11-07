"""What a book-import source is (by its bytes, never its name) and safety checks before parsing."""

from __future__ import annotations

import io
import zipfile
from typing import Optional

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ACCEPTED_MIMES = {
    "application/pdf": "pdf",
    DOCX_MIME: "docx",
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "text/plain": "text",
    "text/markdown": "text",
}
ACCEPT_EXTENSIONS = (".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".md", ".markdown")

DOCX_MAX_ENTRIES = 5000
DOCX_MAX_UNCOMPRESSED = 300 * 1024 * 1024
DOCX_MAX_RATIO = 100


class SourceRejected(ValueError):
    pass


def declared_kind(mime: str, name: str) -> Optional[str]:
    mime = (mime or "").split(";")[0].strip().lower()
    if mime in ACCEPTED_MIMES:
        return ACCEPTED_MIMES[mime]
    lower = (name or "").lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".docx"):
        return "docx"
    if lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return "image"
    if lower.endswith((".txt", ".md", ".markdown")):
        return "text"
    return None


def sniff_kind(head: bytes) -> Optional[str]:
    """Kind from the first bytes: pdf | docx (zip) | image | text, or None."""
    from services.upload_security import sniff_binary_mime

    mime = sniff_binary_mime(head)
    if mime == "application/pdf":
        return "pdf"
    if mime in ("image/jpeg", "image/png", "image/webp"):
        return "image"
    if mime in ("image/heic", "image/heif"):
        return "heic"
    if head[:4] == b"PK\x03\x04":
        return "docx"
    try:
        head[:4096].decode("utf-8")
        if b"\x00" not in head[:4096]:
            return "text"
    except UnicodeDecodeError:
        pass
    return None


def check_docx(data: bytes) -> None:
    """Zip-bomb and macro checks: entry count, total and per-entry expansion, no VBA/macro parts."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise SourceRejected("This Word file is damaged.") from e
    with zf:
        infos = zf.infolist()
        if len(infos) > DOCX_MAX_ENTRIES:
            raise SourceRejected("This Word file has too many parts.")
        total = 0
        names = set()
        for info in infos:
            names.add(info.filename.lower())
            total += info.file_size
            if info.compress_size and info.file_size / max(1, info.compress_size) > DOCX_MAX_RATIO and info.file_size > 10 * 1024 * 1024:
                raise SourceRejected("This Word file looks unsafe (compression bomb).")
        if total > DOCX_MAX_UNCOMPRESSED:
            raise SourceRejected("This Word file is too large once unpacked.")
        if "word/document.xml" not in names:
            raise SourceRejected("This is not a Word (.docx) document.")
        if any(n.endswith("vbaproject.bin") for n in names):
            raise SourceRejected("Word files with macros can't be imported. Save it as a regular .docx first.")
        try:
            ctypes = zf.read("[Content_Types].xml").decode("utf-8", errors="ignore").lower()
        except KeyError:
            ctypes = ""
        if "macroenabled" in ctypes or "vbaproject" in ctypes:
            raise SourceRejected("Word files with macros can't be imported. Save it as a regular .docx first.")
