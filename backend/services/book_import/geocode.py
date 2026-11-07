"""Batch forward geocoding of the book's places through the shared Nominatim scheduler (batch lane,
so interactive lookups in the app go first). The model's own coordinates are the fallback.

The same request asks for OpenStreetMap's extra tags: most towns carry a `wikidata` id, which is what
the place links (services/place_links.py) resolve to a Wikipedia article."""

from __future__ import annotations

import logging
import math
import re
from typing import Dict, Iterable, Optional, Tuple

from .schemas.model_io import MapPlace

logger = logging.getLogger("ChroniXBookImport")

MAX_PLACES = 150
MISMATCH_KM = 300.0
_QID_RE = re.compile(r"^Q[1-9][0-9]{0,11}$")

# (lat, lng, source, wikidata id): source is nominatim, model or none; the id comes only with a
# Nominatim hit that was kept (a hit rejected as too far from the model's guess is a different place).
PlaceCoords = Tuple[Optional[float], Optional[float], str, Optional[str]]


def _km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _wikidata_id(hit: dict) -> Optional[str]:
    raw = str(((hit.get("extratags") or {}).get("wikidata")) or "").strip().upper()
    return raw if _QID_RE.match(raw) else None


async def _lookup(query: str) -> Optional[Tuple[float, float, Optional[str]]]:
    from services import wiki_enricher as we

    params = {"q": query[:200], "format": "jsonv2", "limit": 1, "extratags": 1}
    try:
        resp = await we._nominatim_get(
            "/search", params, dict(we.HEADERS), lane=we.NOMINATIM_LANE_BATCH, timeout=8.0, wait_budget=120.0,
        )
        if resp.status_code != 200:
            return None
        hits = resp.json() or []
        if not hits:
            return None
        return float(hits[0]["lat"]), float(hits[0]["lon"]), _wikidata_id(hits[0])
    except Exception as e:  # NominatimBusyError, network, parse
        logger.info(f"[book_import] geocode failed for {query!r}: {e}")
        return None


async def geocode_places(places: Iterable[MapPlace], cancelled=lambda: False) -> Dict[str, PlaceCoords]:
    """{place_id: (lat, lng, source, wikidata_id)}."""
    out: Dict[str, PlaceCoords] = {}
    for n, p in enumerate(places):
        if cancelled():
            break
        model = (p.lat, p.lng) if p.lat is not None and p.lng is not None else None
        hit = await _lookup(p.geocode_query or p.name) if n < MAX_PLACES and (p.geocode_query or p.name) else None
        if hit and model and _km(hit[:2], model) > MISMATCH_KM:
            out[p.id] = (model[0], model[1], "model", None)
        elif hit:
            out[p.id] = (hit[0], hit[1], "nominatim", hit[2])
        elif model:
            out[p.id] = (model[0], model[1], "model", None)
        else:
            out[p.id] = (None, None, "none", None)
    return out
