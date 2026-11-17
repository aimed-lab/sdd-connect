"""
tools/search_grants.py — search federal funding opportunities on Grants.gov.

Wraps sources.grants_gov.fetch_grants. kind="grant", source="grants_gov",
signal=None (no ranking metric). The source call is isolated — a failure
degrades to an empty list rather than raising.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from models import Item
from sources.grants_gov import agency_param, fetch_grants, fetch_synopsis, sort_by_deadline

logger = logging.getLogger(__name__)

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


# Filtering by activity_codes (see sources/grants_gov.py) is a POST-fetch
# drop, not a narrower request — it can remove most of a plain keyword
# search's hits (federal listings skew R01/U01/R21-heavy). Fetching only
# `limit` rows and THEN filtering would starve the result down to almost
# nothing, same problem search_papers.py's _DEFAULT_POOL_SIZE fixes for
# papers — so a career-stage-filtered request fetches a much wider
# candidate pool first, then caps to `limit` after filtering.
_ACTIVITY_FILTER_POOL_SIZE = 75

# Synopsis enrichment (eligibility, award ceiling, ...) needs one
# fetchOpportunity call per grant, so it is bounded to the first few results,
# run concurrently, best-effort, and cached per opportunity for a day (a
# synopsis rarely changes).
_SYNOPSIS_TOP_N = 10
TTL_SYNOPSIS = 24 * 60 * 60
STALE_SYNOPSIS = 48 * 60 * 60

# A deadline sort reorders a wider pool, so the soonest deadlines are not
# limited to whatever Grants.gov happened to rank first.
_DEADLINE_POOL_SIZE = 50


async def search_grants_async(
    query: str, limit: int = 20, activity_codes: tuple[str, ...] | None = None,
    must_mention: list[str] | None = None, open_only: bool = False,
    agencies: list[str] | tuple[str, ...] | None = None, sort: str | None = None,
) -> list[Item]:
    """Cached + single-flighted (see _fetch). `activity_codes`, when given,
    is folded into the cache key — a stage-filtered search and an
    unfiltered one for the same query text are genuinely different results
    and must never share a cache entry. `must_mention` (a title-term filter, see
    sources/grants_gov.py) is keyed the same way, as are `open_only` (posted
    only), `agencies` (search2's agency filter) and `sort` ("deadline": soonest
    close date first, none last)."""
    codes_key = "|".join(sorted(c.upper() for c in activity_codes)) if activity_codes else ""
    mention_key = "|".join(sorted({t.strip().lower() for t in must_mention if t.strip()})) if must_mention else ""
    sort = "deadline" if sort == "deadline" else None
    namespace = f"grants:{limit}:{codes_key}:{mention_key}"
    agency_key = agency_param(agencies)
    if open_only or agency_key or sort:
        namespace += f":{'open' if open_only else ''}:{agency_key}:{sort or ''}"
    key = normalize_key(namespace, query)
    return await cache.get_or_compute(
        key,
        lambda: _fetch(query, limit, activity_codes, must_mention, open_only, agencies, sort),
        TTL_SOURCE, STALE_SOURCE,
    )


async def _synopsis(client: httpx.AsyncClient, opportunity_id) -> dict:
    async def compute() -> dict:
        try:
            return await fetch_synopsis(client, opportunity_id)
        except Exception as exc:
            logger.warning(
                "search_grants: fetchOpportunity failed for id=%s: %s", opportunity_id, type(exc).__name__
            )
            return {}
    return await cache.get_or_compute(
        f"grant_synopsis:{opportunity_id}", compute, TTL_SYNOPSIS, STALE_SYNOPSIS
    )


async def _enrich(client: httpx.AsyncClient, items: list[Item]) -> list[Item]:
    """Merge each top grant's synopsis fields into its raw (best-effort)."""
    top = [it for it in items[:_SYNOPSIS_TOP_N] if it.id.split(":", 1)[-1].isdigit()]
    synopses = await asyncio.gather(
        *(_synopsis(client, it.id.split(":", 1)[-1]) for it in top), return_exceptions=True
    )
    extra = {it.id: syn for it, syn in zip(top, synopses) if isinstance(syn, dict) and syn}
    return [
        it.model_copy(update={"raw": {**(it.raw or {}), **extra[it.id]}}) if it.id in extra else it
        for it in items
    ]


async def _fetch(
    query: str, limit: int, activity_codes: tuple[str, ...] | None = None,
    must_mention: list[str] | None = None, open_only: bool = False,
    agencies: list[str] | tuple[str, ...] | None = None, sort: str | None = None,
) -> list[Item]:
    try:
        # Both title filters are post-fetch drops, so fetch a wider pool first.
        filtered = bool(activity_codes or must_mention)
        fetch_cap = _ACTIVITY_FILTER_POOL_SIZE if filtered else limit
        if sort == "deadline":
            fetch_cap = max(fetch_cap, _DEADLINE_POOL_SIZE)
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            items = await fetch_grants(
                client, query, fetch_cap, activity_codes=activity_codes, must_mention=must_mention,
                open_only=open_only, agencies=agencies,
            )
            if sort == "deadline":
                items = sort_by_deadline(items)
            items = items[:limit]
            return await _enrich(client, items)
    except Exception:
        logger.exception("search_grants: grants.gov fetch failed for query=%r", query)
        return []   # per-source isolation


def search_grants(
    query: str, limit: int = 20, activity_codes: tuple[str, ...] | None = None
) -> list[Item]:
    """Search Grants.gov for forecasted/posted federal funding opportunities
    relevant to `query`. Returns up to `limit` Items (kind="grant").
    `activity_codes` (e.g. ("K99","R00","K23","K01","R03")), when given,
    drops any opportunity whose title names an NIH activity code NONE of
    which are in that set — see sources/grants_gov.py's own comment on why
    this can only ever be a positive-signal filter, not a guarantee."""
    return asyncio.run(search_grants_async(query, limit, activity_codes))
