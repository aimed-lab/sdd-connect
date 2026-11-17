"""
sources/clinical_trials.py — ClinicalTrials.gov v2 fetcher.

Port of the original TypeScript ClinicalTrials fetcher. Same URL, same field
mapping, same drop of studies with no NCT id (the TS `id !== "ct-"` filter).
Trials expose no ranking metric, so signal stays None.

FIELDS — the v2 API already returns the full study record for every request
(no `fields=` param is sent), so nothing extra is fetched; the earlier version
of this file just never named the extra fields it was throwing away. `raw` is
now a curated, first-party dict of everything the prior-art brief generator
(tools/prior_art_brief.py) needs — overallStatus, whyStopped (quoted verbatim,
never paraphrased, by the brief generator), phase, interventions, sponsor,
completionDate, enrollment, and whether results were posted — same pattern as
GEO/pager's `raw` (see response.py's module docstring): a handful of small
first-party fields with nowhere else to live, not a 150+-key blob like
OpenAlex's. The full study record is NOT kept in `raw` — nothing reads it and
keeping the whole ~5-15KB record per trial in the cache/response would be pure
waste once the fields actually used are named explicitly.

LOCATIONS / ELIGIBILITY / OUTCOMES — read from the same response, capped so the
cached payload stays small: the unique site states (at most 30), at most 5
sites (those matching a `location` filter first), an eligibility excerpt of
about 300 characters ending at a sentence, and at most 3 primary outcomes.
Contacts are deliberately not copied (names, phones and emails).

LOCATION FILTER — `location`, when given, is sent as `query.locn` (e.g.
"Alabama"), which ClinicalTrials.gov matches against site locations.

STATUS FILTER — `status_filter`, when given, is sent as `filter.overallStatus`
(comma-joined for multiple values, e.g. "TERMINATED,WITHDRAWN"), confirmed live
against the v2 API to filter server-side, not fetched-then-discarded client-side.
"""

from __future__ import annotations

import re
from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item

from .base import filter_quality, get_json, to_iso_or_none

_SUMMARY_LIMIT = 220


_ELIGIBILITY_LIMIT = 300
_MAX_SITES = 5
_MAX_STATES = 30
_MAX_OUTCOMES = 3
_OUTCOME_LIMIT = 200


def _clip_words(text: str, limit: int = _SUMMARY_LIMIT) -> str:
    """Shorten to at most `limit` characters, ending at a sentence when one
    ends in the second half of the window, else on a word boundary with an
    ellipsis, so a summary never ends mid-word."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    sentence_end = max(text.rfind(". ", 0, limit), text.rfind("; ", 0, limit))
    if sentence_end > limit // 2:
        return text[: sentence_end + 1]
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:-") + "…"


def _interventions(arms_module: dict) -> list[dict]:
    out = []
    for iv in (arms_module.get("interventions") or []):
        out.append({"type": iv.get("type"), "name": iv.get("name")})
    return out


def _eligibility(module: dict) -> dict | None:
    criteria = (module.get("eligibilityCriteria") or "").replace("*", " ")
    out = {
        "min_age": module.get("minimumAge"),
        "max_age": module.get("maximumAge"),
        "sex": module.get("sex"),
        "healthy_volunteers": module.get("healthyVolunteers"),
        "criteria_excerpt": _clip_words(criteria, _ELIGIBILITY_LIMIT) or None,
    }
    out = {k: v for k, v in out.items() if v is not None}
    return out or None


def _locations(module: dict, location: str | None) -> tuple[list[str] | None, list[dict] | None, int]:
    locs = [l for l in (module.get("locations") or []) if isinstance(l, dict)]
    states: list[str] = []
    for l in locs:
        st = l.get("state")
        if st and st not in states and len(states) < _MAX_STATES:
            states.append(st)
    wanted = (location or "").strip().lower()

    def matches(l: dict) -> bool:
        return bool(wanted) and any(
            wanted in (l.get(k) or "").lower() for k in ("state", "city", "country", "facility")
        )

    ordered = [l for l in locs if matches(l)] + [l for l in locs if not matches(l)]
    sites = [
        {k: v for k, v in {
            "facility": l.get("facility"), "city": l.get("city"), "state": l.get("state"),
            "country": l.get("country"), "status": l.get("status"),
        }.items() if v}
        for l in ordered[:_MAX_SITES]
    ]
    return states or None, sites or None, len(locs)


def _primary_outcomes(module: dict) -> list[dict] | None:
    out = []
    for o in (module.get("primaryOutcomes") or [])[:_MAX_OUTCOMES]:
        if not isinstance(o, dict) or not o.get("measure"):
            continue
        entry = {"measure": _clip_words(o["measure"], _OUTCOME_LIMIT)}
        if o.get("timeFrame"):
            entry["time_frame"] = _clip_words(o["timeFrame"], _OUTCOME_LIMIT)
        out.append(entry)
    return out or None


async def fetch_trials(
    client: httpx.AsyncClient, term: str, cap: int, status_filter: list[str] | None = None,
    condition_only: bool = False, extra_term: str | None = None, location: str | None = None,
) -> list[Item]:
    # `extra_term` (only with condition_only): sent as query.term ALONGSIDE
    # query.cond, e.g. cond=pancreatic cancer + term=KRAS. (Named extra_term
    # because `term` is already the positional search string above.)
    # query.term matches ANY field of the record (eligibility text included), so
    # a disease searched that way pulls in unrelated basket trials. query.cond
    # matches the condition field only; callers pass condition_only=True when
    # the term is known to be a disease/condition name.
    param = "query.cond" if condition_only else "query.term"
    url = (
        "https://clinicaltrials.gov/api/v2/studies"
        f"?{param}={quote(term)}&pageSize={cap}&sort=LastUpdatePostDate:desc"
    )
    if condition_only and extra_term:
        url += f"&query.term={quote(extra_term)}"
    if status_filter:
        url += f"&filter.overallStatus={quote(','.join(status_filter))}"
    if location and location.strip():
        url += f"&query.locn={quote(location.strip())}"
    data = await get_json(client, url)

    items: list[Item] = []
    for s in (data or {}).get("studies") or []:
        proto = s.get("protocolSection") or {}
        ident = proto.get("identificationModule") or {}
        status = proto.get("statusModule") or {}
        desc = proto.get("descriptionModule") or {}
        design = proto.get("designModule") or {}
        arms = proto.get("armsInterventionsModule") or {}
        sponsors = proto.get("sponsorCollaboratorsModule") or {}

        states, sites, site_count = _locations(proto.get("contactsLocationsModule") or {}, location)

        nct_id = ident.get("nctId") or ""
        if not nct_id:   # drop studies with no NCT id
            continue

        iso_date = to_iso_or_none((status.get("startDateStruct") or {}).get("date"))
        full_summary = desc.get("briefSummary") or ""
        brief = _clip_words(full_summary)
        overall_status = status.get("overallStatus") or None
        summary = brief or f"{overall_status or 'Active'} clinical trial."

        items.append(
            Item(
                id=f"clinicaltrials:{nct_id}",
                kind="trial",
                title=ident.get("briefTitle") or "Clinical Trial",
                summary=summary,
                url=f"https://clinicaltrials.gov/study/{nct_id}",
                doi=None,
                source="clinicaltrials",
                date_iso=iso_date,
                signal=None,   # no ranking metric
                dedupe_key=dedupe_key(f"https://clinicaltrials.gov/study/{nct_id}", ident.get("briefTitle") or ""),
                raw={
                    "nct_id": nct_id,
                    "overall_status": overall_status,
                    # Quoted, never paraphrased — see tools/prior_art_brief.py.
                    "why_stopped": status.get("whyStopped") or None,
                    "phase": (design.get("phases") or [None])[0],
                    "interventions": _interventions(arms),
                    "lead_sponsor": (sponsors.get("leadSponsor") or {}).get("name"),
                    "completion_date": (status.get("completionDateStruct") or {}).get("date"),
                    "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
                    "results_posted": bool(status.get("resultsFirstPostDateStruct")),
                    "conditions": proto.get("conditionsModule", {}).get("conditions"),
                    "brief_summary": full_summary or None,
                    "phases": design.get("phases") or None,
                    "eligibility": _eligibility(proto.get("eligibilityModule") or {}),
                    "primary_outcomes": _primary_outcomes(proto.get("outcomesModule") or {}),
                    "location_states": states,
                    "sites": sites,
                    "site_count": site_count,
                },
            )
        )
    return filter_quality(items)


# Landscape mode (tools/trial_landscape.py): only the fields the grouped table
# needs, so two pages stay small.
_LANDSCAPE_FIELDS = (
    "NCTId,BriefTitle,OverallStatus,Phase,LeadSponsorName,"
    "InterventionName,InterventionType,StartDate"
)


async def fetch_trial_landscape_page(
    client: httpx.AsyncClient, term: str, page_size: int, page_token: str | None = None,
    status_filter: list[str] | None = None, location: str | None = None,
) -> tuple[list[dict], int | None, str | None]:
    """One page of a landscape search: (rows, totalCount, nextPageToken).
    Free-text query.term in the registry's relevance order. totalCount is
    requested on the first page only (the API returns it there)."""
    url = (
        "https://clinicaltrials.gov/api/v2/studies"
        f"?query.term={quote(term)}&pageSize={page_size}&fields={_LANDSCAPE_FIELDS}"
    )
    if page_token:
        url += f"&pageToken={quote(page_token)}"
    else:
        url += "&countTotal=true"
    if status_filter:
        url += f"&filter.overallStatus={quote(','.join(status_filter))}"
    if location and location.strip():
        url += f"&query.locn={quote(location.strip())}"
    data = await get_json(client, url) or {}

    rows: list[dict] = []
    for s in data.get("studies") or []:
        proto = s.get("protocolSection") or {}
        ident = proto.get("identificationModule") or {}
        nct_id = ident.get("nctId") or ""
        if not nct_id:
            continue
        status = proto.get("statusModule") or {}
        rows.append({
            "nct_id": nct_id,
            "title": ident.get("briefTitle") or "",
            "status": status.get("overallStatus") or None,
            "phases": (proto.get("designModule") or {}).get("phases") or [],
            "sponsor": ((proto.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}).get("name"),
            "start_date": (status.get("startDateStruct") or {}).get("date"),
            "interventions": _interventions(proto.get("armsInterventionsModule") or {}),
        })
    total = data.get("totalCount")
    return rows, total if isinstance(total, int) else None, data.get("nextPageToken") or None
