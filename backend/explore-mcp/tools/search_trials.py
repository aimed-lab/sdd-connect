"""
tools/search_trials.py — search ClinicalTrials.gov for studies.

Wraps sources.clinical_trials.fetch_trials. kind="trial", source="clinicaltrials",
signal=None (no ranking metric). A failed fetch RAISES (it is not reported as an
empty list); the caller isolates it, so one source failing never sinks others.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.clinical_trials import fetch_trials

logger = logging.getLogger(__name__)

# NOTE: ClinicalTrials.gov's CDN 403s a custom User-Agent (and even a browser-like
# one), but allows httpx's default UA. So we do NOT override User-Agent here; we
# only ask for JSON explicitly.
_HEADERS = {"Accept": "application/json"}


async def search_trials_async(
    query: str, limit: int = 20, status_filter: list[str] | None = None,
    condition_only: bool = False, extra_term: str | None = None, location: str | None = None,
) -> list[Item]:
    """Cached + single-flighted (see _fetch). `status_filter` (e.g.
    ["TERMINATED", "WITHDRAWN"]) is part of the cache key — a status-filtered
    search and an unfiltered one for the same term are different results and
    must not share a cache entry. `condition_only` (query.cond instead of
    query.term) is keyed the same way, as is `extra_term` (query.cond +
    query.term together), and `location` (query.locn, e.g. a US state)."""
    status_key = ",".join(status_filter) if status_filter else ""
    mode_key = "cond" if condition_only else "term"
    if condition_only and extra_term:
        mode_key += f"+{extra_term.strip().lower()}"
    location = (location or "").strip() or None
    namespace = f"trials:{limit}:{status_key}:{mode_key}"
    if location:
        namespace += f":locn={location.lower()}"
    key = normalize_key(namespace, query)
    return await cache.get_or_compute(
        key, lambda: _fetch(query, limit, status_filter, condition_only, extra_term, location),
        TTL_SOURCE, STALE_SOURCE,
    )


async def _fetch(
    query: str, limit: int, status_filter: list[str] | None = None, condition_only: bool = False,
    extra_term: str | None = None, location: str | None = None,
) -> list[Item]:
    # No catch-all here: a failed fetch raises, so explore marks the section
    # source_error instead of showing "no trials". The cache does not store an
    # exception (it serves a stale value if it has one, else re-raises), and
    # callers isolate per source themselves (explore's gather, project_agent,
    # the /api/explore-source bridge).
    async with httpx.AsyncClient(headers=_HEADERS) as client:
        if location:
            return await fetch_trials(
                client, query, limit, status_filter, condition_only, extra_term, location=location
            )
        return await fetch_trials(client, query, limit, status_filter, condition_only, extra_term)


INCOMPLETE_NOTE = "Some results couldn't be loaded, so this list may be incomplete."


class PartialItems(list):
    """Items from a search made of several calls where at least one call failed
    and at least one succeeded: what came back, flagged `partial`, with the
    failures' messages. Explore shows the items with a quiet "may be incomplete"
    note and does not keep the page for the long cache period. Still a plain
    list to every other caller."""

    partial = True

    def __init__(self, items: list[Item], failed: list[str]):
        super().__init__(items)
        self.failed = failed


def merge_trials(gene_matched: list[Item], condition_only: list[Item], limit: int) -> list[Item]:
    """Gene-matched trials first, then the condition-only ones to fill up to
    `limit`, de-duplicated by NCT id. An empty gene-matched list gives just the
    condition-only list."""
    seen: set[str] = set()
    merged: list[Item] = []
    for it in [*gene_matched, *condition_only]:
        nct = (it.raw or {}).get("nct_id") or it.id
        if nct in seen:
            continue
        seen.add(nct)
        merged.append(it)
        if len(merged) >= limit:
            break
    return merged


async def search_trials_with_gene_async(
    condition: str, gene: str, limit: int = 20, status_filter: list[str] | None = None,
    location: str | None = None,
) -> list[Item]:
    """For a scope with BOTH a disease and a gene: (a) condition + gene as
    term and (b) condition only, in parallel, merged by merge_trials(). The
    status and location filters apply to both.

    The two calls are isolated from each other: if one fails and the other
    succeeds, the trials that came back are returned as PartialItems (shown,
    with a "may be incomplete" note, and not cached for long). Only when BOTH
    fail does this raise, so the section is an error."""
    loc = {"location": location} if location else {}
    results = await asyncio.gather(
        search_trials_async(condition, limit, status_filter, condition_only=True, extra_term=gene, **loc),
        search_trials_async(condition, limit, status_filter, condition_only=True, **loc),
        return_exceptions=True,
    )
    for r in results:
        # A cancellation (the per-source time cap) is not a source failure.
        if isinstance(r, BaseException) and not isinstance(r, Exception):
            raise r
    failed = [r for r in results if isinstance(r, Exception)]
    if len(failed) == len(results):
        raise failed[0]
    gene_matched, condition_only = (r if not isinstance(r, Exception) else [] for r in results)
    merged = merge_trials(gene_matched, condition_only, limit)
    if not failed:
        return merged
    for exc in failed:
        logger.warning(
            "search_trials: one of the two trial calls failed for condition=%r gene=%r: %s",
            condition, gene, exc, exc_info=exc,
        )
    return PartialItems(merged, [f"{type(e).__name__}: {e}" for e in failed])


def search_trials(query: str, limit: int = 20, status_filter: list[str] | None = None) -> list[Item]:
    """Search ClinicalTrials.gov for clinical studies relevant to `query`.
    Returns up to `limit` Items (kind="trial"). `status_filter`, when given, is
    forwarded to the v2 API's `filter.overallStatus` (e.g. ["TERMINATED",
    "WITHDRAWN"]) — filtered server-side, not fetched-then-discarded here."""
    return asyncio.run(search_trials_async(query, limit, status_filter))
