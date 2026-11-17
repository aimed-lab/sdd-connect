"""
tools/search_fda.py — FDA-approved drugs whose label indication mentions a disease.

Wraps sources.openfda.fetch_fda_approvals. kind="approval", source="openfda",
signal=None. The source call is isolated — a failure degrades to an empty list
rather than raising. Approvals change slowly, so results are cached for hours.
"""

from __future__ import annotations

import asyncio
import logging
import re

import httpx

from cache import cache, normalize_key
from models import Item
from sources.openfda import fetch_fda_approvals

logger = logging.getLogger(__name__)

_TTL_FDA = 6 * 60 * 60
_STALE_FDA = 24 * 60 * 60


async def search_fda_async(query: str, limit: int = 20, by: str = "indication") -> list[Item]:
    """Cached + single-flighted (see _fetch). `by="drug"` looks `query` up as a
    drug name instead of an indication (see fetch_fda_approvals)."""
    by = "drug" if by == "drug" else "indication"
    key = normalize_key(f"fda:{limit}" if by == "indication" else f"fda:drug:{limit}", query)
    return await cache.get_or_compute(key, lambda: _fetch(query, limit, by), _TTL_FDA, _STALE_FDA)


async def _fetch(query: str, limit: int, by: str = "indication") -> list[Item]:
    try:
        async with httpx.AsyncClient() as client:
            return await fetch_fda_approvals(client, query, limit, by=by)
    except Exception:
        logger.exception("search_fda: openfda fetch failed for query=%r", query)
        return []   # per-source isolation


def boost_distinctive(items: list[Item], tokens: list[str]) -> list[Item]:
    """Approvals whose indication names a distinctive token the user typed
    ("G12C") move to the front; the rest keep their order. Nothing is
    removed: a label can describe the same drug without the token."""
    if not tokens:
        return list(items)
    pats = [re.compile(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", re.I) for t in tokens]

    def hits(item: Item) -> int:
        raw = getattr(item, "raw", None)
        raw = raw if isinstance(raw, dict) else {}
        text = " ".join(str(raw.get(k) or "") for k in ("indication", "indication_first_sentence"))
        return sum(1 for p in pats if p.search(text))

    return sorted(items, key=lambda i: -hits(i))


def search_fda(query: str, limit: int = 20) -> list[Item]:
    """FDA-approved (NDA/BLA) drugs whose label indication mentions `query`,
    newest approval first. Returns up to `limit` Items (kind="approval")."""
    return asyncio.run(search_fda_async(query, limit))
