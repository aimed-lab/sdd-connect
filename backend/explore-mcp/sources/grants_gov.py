"""
sources/grants_gov.py — Grants.gov search2 fetcher.

Port of the original TypeScript Grants.gov fetcher. POST search2 with the same
body, same field mapping, same drop of hits missing a title or opportunity
number. Grants.gov exposes no ranking metric, so signal stays None.
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone

import httpx

from dedupe import dedupe_key
from models import Item

from .base import filter_quality, post_json, to_iso_or_none

_SEARCH2 = "https://api.grants.gov/v1/api/search2"
_FETCH_OPPORTUNITY = "https://api.grants.gov/v1/api/fetchOpportunity"

# search2's `agencies` matches exact codes ("HHS-NIH11", "NSF"); a top-level
# code also needs its "CODE*" wildcard to reach sub-agencies ("DOD" alone
# returns nothing, "DOD|DOD*" returns DOD-AMRAA, DOD-AFOSR, ...). Confirmed live.
_AGENCY_ALIASES = {"NIH": "HHS-NIH11"}

_EXCERPT_LIMIT = 300


def agency_param(agencies) -> str:
    """User-facing agency names/codes -> search2's pipe-joined `agencies` value."""
    codes: list[str] = []
    for a in agencies or ():
        code = str(a).strip().upper()
        if not code:
            continue
        code = _AGENCY_ALIASES.get(code, code)
        for c in (code,) if "-" in code else (code, f"{code}*"):
            if c not in codes:
                codes.append(c)
    return "|".join(codes)


def is_open(status: str | None, close_date: str | None, now: datetime | None = None) -> bool:
    """Posted and not past its close date (a missing close date counts as open)."""
    if (status or "").lower() != "posted":
        return False
    close_iso = to_iso_or_none(close_date)
    if not close_iso:
        return True
    close = datetime.fromisoformat(close_iso.replace("Z", "+00:00"))
    return close.date() >= (now or datetime.now(timezone.utc)).date()


def sort_by_deadline(items: list[Item]) -> list[Item]:
    """Soonest close date first; no close date (most forecasts) last, in their
    original order."""
    def key(it: Item):
        iso = to_iso_or_none((it.raw or {}).get("close_date"))
        return (iso is None, iso or "")
    return sorted(items, key=key)


def _excerpt(text: str | None, limit: int = _EXCERPT_LIMIT) -> str | None:
    """Plain-text excerpt: tags stripped, ending at a sentence (else word)
    boundary."""
    if not text:
        return None
    plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()
    if not plain:
        return None
    if len(plain) <= limit:
        return plain
    cut = plain[:limit]
    end = max(cut.rfind(". "), cut.rfind("; "))
    if end > limit // 2:
        return cut[: end + 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit // 2 else cut).rstrip(" ,;:-") + "…"


def _amount(value) -> int | None:
    try:
        n = int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def parse_synopsis(data: dict | None) -> dict:
    """fetchOpportunity `data` -> the small synopsis dict merged into a grant's
    raw. Posted opportunities carry `synopsis`, forecasts carry `forecast`;
    both use the same field names. Missing values are left out."""
    data = data or {}
    s = data.get("synopsis") or data.get("forecast") or {}
    out = {
        "award_ceiling": _amount(s.get("awardCeiling")),
        "award_floor": _amount(s.get("awardFloor")),
        "eligibility": [
            t["description"] for t in (s.get("applicantTypes") or [])
            if isinstance(t, dict) and t.get("description")
        ] or None,
        "eligibility_note": _excerpt(s.get("applicantEligibilityDesc")),
        "funding_instruments": [
            t["description"] for t in (s.get("fundingInstruments") or [])
            if isinstance(t, dict) and t.get("description")
        ] or None,
        "description": _excerpt(s.get("synopsisDesc") or s.get("forecastDesc")),
    }
    return {k: v for k, v in out.items() if v is not None}

# CAREER-STAGE / ACTIVITY-CODE SCOPE. Confirmed live against the search2
# API's own `searchParams` echo: grants.gov exposes `eligibilities` (who may
# APPLY — individuals, non-profits, state governments...) and
# `fundingInstruments`/`fundingCategories`/`agencies`, but NOTHING for an
# NIH-style ACTIVITY CODE (K99/R00/K23/K01 vs. R01/U01/R21) — that
# vocabulary is NIH-internal, not part of grants.gov's own cross-agency
# schema, so there is no request parameter to send for it. The one place an
# activity code reliably shows up is inside the opportunity TITLE, in
# parentheses (e.g. "Science Track Award for Research Transition (START)
# Program (R03, Clinical Trial Optional)") — so this is a POST-FETCH
# content filter, not a request parameter, same reasoning as any other
# "the API doesn't expose a structured field for this" case.
_NIH_ACTIVITY_CODE_RE = re.compile(r"\b([A-Z]\d{2})\b")


def _title_activity_codes(title: str) -> set[str]:
    return set(_NIH_ACTIVITY_CODE_RE.findall(title.upper()))


def _mentions_any(title: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(p.search(title) for p in patterns)


async def fetch_grants(
    client: httpx.AsyncClient,
    term: str,
    cap: int,
    activity_codes: tuple[str, ...] | None = None,
    must_mention: list[str] | None = None,
    open_only: bool = False,
    agencies: list[str] | tuple[str, ...] | None = None,
) -> list[Item]:
    # `open_only` asks search2 for posted opportunities only (forecasts have no
    # deadline yet); `agencies` is sent as search2's server-side `agencies`
    # filter (see agency_param).
    # `must_mention`: Grants.gov's keyword search is loose (a "pancreatic cancer
    # KRAS" query returns Type 1 Diabetes and Immune Tolerance opportunities),
    # so when given, keep only grants whose TITLE contains at least one of these
    # terms as a whole phrase, case-insensitive. Nothing passing means an empty
    # list, never a fall back to the unfiltered hits.
    mention_patterns = [
        re.compile(r"\b" + re.escape(t.strip()) + r"\b", re.IGNORECASE)
        for t in (must_mention or [])
        if t and t.strip()
    ]
    body = {"keyword": term, "oppStatuses": "posted" if open_only else "forecasted|posted", "rows": cap}
    agency_codes = agency_param(agencies)
    if agency_codes:
        body["agencies"] = agency_codes
    data = await post_json(client, _SEARCH2, body)

    hits = ((data or {}).get("data") or {}).get("oppHits") or []
    allowed = {c.upper() for c in activity_codes} if activity_codes else None

    items: list[Item] = []
    for h in hits:
        title = h.get("title")
        number = h.get("number")
        if not title or not number:   # blank-title / missing-number drop
            continue

        if mention_patterns and not _mentions_any(title, mention_patterns):
            continue

        if allowed is not None:
            # Drop only when the title POSITIVELY names a mechanism and NONE
            # of the named ones are allowed (e.g. a title says "(R01, R21)"
            # while the caller wants K99/K23/K01 — that opportunity really
            # isn't open to this audience). A title naming NO mechanism at
            # all — most grants.gov titles, including notices, foundation-
            # adjacent announcements, and non-NIH agencies — is left in
            # rather than guessed at; the point is to remove opportunities
            # we can POSITIVELY identify as wrong-stage, not to require
            # every result prove itself right-stage against a vocabulary
            # that's NIH-specific to begin with.
            codes = _title_activity_codes(title)
            if codes and codes.isdisjoint(allowed):
                continue

        opp_id = h.get("id") if h.get("id") is not None else number
        iso_date = (
            to_iso_or_none(h.get("openDate"))
            or to_iso_or_none(h.get("postedDate"))
            or to_iso_or_none(h.get("closeDate"))
        )
        summary = f"{h.get('agencyCode') or '?'} — {h.get('agency') or ''}".strip()
        url = (
            f"https://www.grants.gov/search-results-detail/{h['id']}"
            if h.get("id") is not None
            else "https://www.grants.gov/"
        )

        items.append(
            Item(
                id=f"grants_gov:{opp_id}",
                kind="grant",
                title=title,
                summary=summary,
                url=url,
                doi=None,
                source="grants_gov",
                date_iso=iso_date,
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(url, title),
                # Small first-party dict (response.py lists grants_gov in
                # _INTERNAL_SOURCES) so the deadline reaches the frontend.
                raw={
                    "number": number,
                    "agency": h.get("agency"),
                    "agency_code": h.get("agencyCode"),
                    "status": h.get("oppStatus"),
                    "open_date": h.get("openDate"),
                    "close_date": h.get("closeDate"),
                    "is_open": is_open(h.get("oppStatus"), h.get("closeDate")),
                    **{k: v for k, v in {
                        "cfda": h.get("cfdaList") or None,
                        "activity_codes": sorted(_title_activity_codes(title)) or None,
                    }.items() if v},
                },
            )
        )
    # filter_quality applies the off-domain guard; grants are exempt from the
    # future-date drop (forecasted awards are legitimately future-dated) and from
    # the biomed-anchor requirement (curated funding, not recency-sorted literature).
    return filter_quality(items)


async def fetch_synopsis(client: httpx.AsyncClient, opportunity_id) -> dict:
    """One fetchOpportunity call -> parse_synopsis() dict (eligibility, award
    ceiling/floor, funding instruments, description excerpt)."""
    data = await post_json(client, _FETCH_OPPORTUNITY, {"opportunityId": int(opportunity_id)})
    return parse_synopsis((data or {}).get("data"))
