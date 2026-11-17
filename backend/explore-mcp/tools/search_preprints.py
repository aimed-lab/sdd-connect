"""
tools/search_preprints.py — search preprints (bioRxiv, medRxiv, Research Square,
...) on Europe PMC.

Wraps sources.europepmc.fetch_preprints. kind="preprint", source="europepmc",
signal=None (no ranking metric). A failed Europe PMC call is retried once and
then RAISED, not turned into an empty list: an empty list is cached (and the
whole Explore response with it), so one upstream hiccup used to pin an empty
preprint section for an hour. The one caller, explore, already isolates a
raising source: it marks the section with `error` and expires the page soon.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.europepmc import fetch_preprints

logger = logging.getLogger(__name__)


async def search_preprints_async(query: str, limit: int = 20) -> list[Item]:
    """Cached + single-flighted (see _fetch)."""
    key = normalize_key(f"preprints:{limit}", query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit), TTL_SOURCE, STALE_SOURCE
    )


_ATTEMPTS = 2


async def _fetch(query: str, limit: int) -> list[Item]:
    async with httpx.AsyncClient() as client:
        for attempt in range(1, _ATTEMPTS + 1):
            try:
                return await fetch_preprints(client, query, limit)
            except Exception as exc:
                logger.warning(
                    "search_preprints: europepmc attempt %d/%d failed for query=%r: %s: %s",
                    attempt, _ATTEMPTS, query, type(exc).__name__, exc,
                )
                if attempt == _ATTEMPTS:
                    raise
    return []


def search_preprints(query: str, limit: int = 20) -> list[Item]:
    """Search Europe PMC for preprints relevant to `query`. Returns up to
    `limit` Items (kind="preprint"), newest first."""
    return asyncio.run(search_preprints_async(query, limit))
