"""
tools/trial_landscape.py — competitive-landscape view of ClinicalTrials.gov (#82).

Bounded by design (AI-panel decision on #82): ONE cached registry search per
query, at most MAX_PAGES pages of PAGE_SIZE trials (never more than HARD_CAP),
one upstream call per page, no per-drug fan-out and no LLM call.

The fetched trials are grouped by normalised intervention ("asset"), then by
phase and lead sponsor. Placebo / standard-of-care arms and non-drug
interventions (procedures, devices, behavioural, diagnostic tests, "other")
never become asset rows. A trial with several drugs appears under each of them.

The response carries the registry's own total (`total`) next to how many trials
were fetched and shown, so the page can say "Showing N of M registry trials"
and that the view is not exhaustive.
"""

from __future__ import annotations

import logging
import re

import httpx

from cache import STALE_SOURCE, TTL_SOURCE, cache, normalize_key
from sources.clinical_trials import fetch_trial_landscape_page

logger = logging.getLogger(__name__)

PAGE_SIZE = 25
MAX_PAGES = 2
HARD_CAP = 100
MAX_QUERY_CHARS = 200

_HEADERS = {"Accept": "application/json"}

_ASSET_TYPES = {"DRUG", "BIOLOGICAL", "GENETIC", "COMBINATION_PRODUCT", None}

_NON_ASSET = re.compile(
    r"\b(placebos?|sham|vehicle|standard[\s-]of[\s-]care|soc|best supportive care|supportive care"
    r"|usual care|best available therapy|(physician|investigator)'?s?'? choice|observation"
    r"|no intervention|no treatment|watchful waiting)\b"
)

# Small, hand-checked synonym list: code names and brand names -> INN. Keys are
# in normalised form (see _key).
_SYNONYMS: dict[str, str] = {
    "amg510": "sotorasib", "lumakras": "sotorasib", "lumykras": "sotorasib",
    "mrtx849": "adagrasib", "krazati": "adagrasib",
    "gdc6036": "divarasib", "rg6330": "divarasib",
    "ly3537982": "olomorasib",
    "jab21822": "glecirasib",
    "d1553": "garsorasib",
    "gfh925": "fulzerasib", "ibi351": "fulzerasib",
    "jdq443": "opnurasib",
    "mk1084": "calderasib",
    "rmc6236": "daraxonrasib",
    "vs6766": "avutometinib",
    "mk3475": "pembrolizumab", "keytruda": "pembrolizumab",
    "bms936558": "nivolumab", "ono4538": "nivolumab", "opdivo": "nivolumab",
    "mpdl3280a": "atezolizumab", "tecentriq": "atezolizumab",
    "medi4736": "durvalumab", "imfinzi": "durvalumab",
    "azd9291": "osimertinib", "tagrisso": "osimertinib",
    "azd2281": "olaparib", "lynparza": "olaparib",
    "ds8201": "trastuzumab deruxtecan", "ds8201a": "trastuzumab deruxtecan",
    "t dxd": "trastuzumab deruxtecan", "enhertu": "trastuzumab deruxtecan",
    "erbitux": "cetuximab", "vectibix": "panitumumab",
    "avastin": "bevacizumab", "mvasi": "bevacizumab",
    "taxotere": "docetaxel", "alimta": "pemetrexed",
    "5fu": "fluorouracil", "5 fluorouracil": "fluorouracil", "5 fu": "fluorouracil",
    "folinic acid": "leucovorin", "levofolinate": "leucovorin",
    "levofolinate calcium": "leucovorin", "leucovorin calcium": "leucovorin", "lv": "leucovorin",
    "abraxane": "nab paclitaxel",
}

# Salt / dosage-form words dropped from the end of a name ("Glecirasib Citrate
# Tablets" -> "glecirasib").
_SUFFIX_WORDS = {
    "hydrochloride", "hcl", "mesylate", "dimesylate", "besylate", "tosylate", "maleate", "citrate",
    "sulfate", "sulphate", "phosphate", "tartrate", "fumarate", "succinate", "acetate", "malate",
    "sodium", "potassium", "calcium", "monohydrate", "hydrate", "free base",
    "tablet", "tablets", "capsule", "capsules", "injection", "infusion", "oral", "solution",
    "for injection", "iv", "monotherapy", "regimen", "drug", "dose", "doses",
}

_SPLIT = re.compile(r"\s*(?:\+|/|;|,|\bin combination with\b|\bcombined with\b|\bplus\b|\band\b|\bwith\b)\s*")
_DOSE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg/kg|mg/m2|mg/m²|mg|mcg|µg|ug|g|ml|iu|units?|%)(?=\W|$)")
_CODE = re.compile(r"^[a-z]{1,6}[\s-]?\d[\d-]*[a-z]?$")
_PAREN = re.compile(r"\(([^)]*)\)")


def _strip_suffixes(words: list[str]) -> list[str]:
    while words:
        if len(words) >= 2 and " ".join(words[-2:]).lower() in _SUFFIX_WORDS:
            words = words[:-2]
        elif words[-1].lower() in _SUFFIX_WORDS:
            words = words[:-1]
        else:
            break
    return words


def _key(text: str) -> str:
    """Comparison key: lowercase, no marks, dose / salt / dosage-form words
    dropped, hyphens as spaces; a code name ("AMG 510", "GDC-6036",
    "MRTX849") loses its spaces and hyphens."""
    s = text.lower().replace("®", " ").replace("™", " ")
    s = _DOSE.sub(" ", s)
    s = re.sub(r"[^a-z0-9µ\s-]", " ", s)
    s = " ".join(_strip_suffixes(s.split())).strip(" -")
    if _CODE.match(s):
        return re.sub(r"[\s-]", "", s)
    return " ".join(s.replace("-", " ").split())


def _canonical(part: str) -> tuple[str, str] | None:
    """(key, display) for one drug name, or None for nothing usable."""
    candidates = [_PAREN.sub(" ", part)] + _PAREN.findall(part)
    keys = [k for k in (_key(c) for c in candidates) if k]
    if not keys:
        return None
    for k in keys:
        if k in _SYNONYMS:
            name = _SYNONYMS[k]
            return name, name[:1].upper() + name[1:]
    display = " ".join(_PAREN.sub(" ", part).split())
    display = _DOSE.sub(" ", display)
    display = " ".join(display.split()).strip(" -,")
    trimmed = _strip_suffixes(display.split())
    display = " ".join(trimmed) or display
    return keys[0], display[:1].upper() + display[1:]


def normalise_intervention(name: str | None) -> list[tuple[str, str]]:
    """One registry intervention name -> [(key, display), ...]: split on
    combination wording ("A + B", "A in combination with B"), with placebo /
    standard-of-care parts removed. Empty list = not an asset."""
    if not name or not name.strip():
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for part in _SPLIT.split(_PAREN.sub(lambda m: f"({m.group(1).replace('/', ' ')})", name)):
        if not part or _NON_ASSET.search(part.lower()):
            continue
        canon = _canonical(part)
        if canon is None or canon[0] in seen or len(canon[0]) < 2:
            continue
        seen.add(canon[0])
        out.append(canon)
    return out


_PHASE_RANK = {"PHASE4": 6, "PHASE3": 5, "PHASE2": 3, "PHASE1": 1, "EARLY_PHASE1": 0}


def _phase_rank(phases: list[str]) -> float:
    ranks = [_PHASE_RANK[p] for p in phases if p in _PHASE_RANK]
    return max(ranks) - (0.5 if len(ranks) > 1 else 0) if ranks else -1


def phase_label(phases: list[str]) -> str:
    if not phases:
        return "Not stated"
    if phases == ["NA"]:
        return "Not applicable"
    if phases == ["EARLY_PHASE1"]:
        return "Early phase 1"
    nums = [p.replace("PHASE", "") for p in phases if p.startswith("PHASE")]
    return "Phase " + "/".join(nums) if nums else "Not stated"


def build_landscape(studies: list[dict]) -> dict:
    """Group fetched trials by asset, then phase and sponsor."""
    assets: dict[str, dict] = {}
    shown: set[str] = set()
    for t in studies:
        trial = {
            "nct_id": t["nct_id"],
            "url": f"https://clinicaltrials.gov/study/{t['nct_id']}",
            "title": t.get("title") or "",
            "status": t.get("status"),
            "start_date": t.get("start_date"),
        }
        phases = list(t.get("phases") or [])
        sponsor = t.get("sponsor") or "Not stated"
        keys_here: set[str] = set()
        for iv in t.get("interventions") or []:
            if (iv.get("type") or None) not in _ASSET_TYPES:
                continue
            parts = normalise_intervention(iv.get("name"))
            for key, display in parts:
                if key in keys_here:
                    continue
                keys_here.add(key)
                a = assets.setdefault(key, {"key": key, "asset": display, "aliases": set(), "rows": {}})
                raw = " ".join((iv.get("name") or "").split())
                if raw and len(parts) == 1 and raw.lower() != display.lower():
                    a["aliases"].add(raw)
                row = a["rows"].setdefault(
                    (phase_label(phases), sponsor),
                    {"phase": phase_label(phases), "phase_rank": _phase_rank(phases), "sponsor": sponsor, "trials": []},
                )
                row["trials"].append(trial)
                shown.add(t["nct_id"])

    groups = []
    for a in assets.values():
        rows = sorted(a["rows"].values(), key=lambda r: (-r["phase_rank"], r["sponsor"].lower()))
        best = rows[0]["phase_rank"] if rows else -1
        for r in rows:
            r["trials"].sort(key=lambda x: x["nct_id"], reverse=True)
            r.pop("phase_rank")
        trial_ids = {x["nct_id"] for r in rows for x in r["trials"]}
        groups.append({
            "asset": a["asset"],
            "key": a["key"],
            "aliases": sorted(a["aliases"])[:5],
            "trial_count": len(trial_ids),
            "rows": rows,
            "_best": best,
        })
    groups.sort(key=lambda g: (-g["trial_count"], -g["_best"], g["asset"].lower()))
    for g in groups:
        g.pop("_best")
    return {"groups": groups, "shown": len(shown), "without_asset": len(studies) - len(shown)}


async def _fetch_studies(
    query: str, status_filter: list[str] | None, location: str | None,
) -> tuple[list[dict], int | None, bool]:
    """Up to MAX_PAGES pages, one request each. A failed first page raises (so
    nothing is cached); a failed later page keeps what was already fetched and
    marks the result partial."""
    studies: list[dict] = []
    total: int | None = None
    partial = False
    token: str | None = None
    cap = min(PAGE_SIZE * MAX_PAGES, HARD_CAP)
    async with httpx.AsyncClient(headers=_HEADERS) as client:
        for page in range(MAX_PAGES):
            try:
                rows, page_total, token = await fetch_trial_landscape_page(
                    client, query, PAGE_SIZE, token, status_filter, location,
                )
            except Exception:
                if page == 0:
                    raise
                logger.exception("trial_landscape: page %d failed for query=%r", page + 1, query)
                partial = True
                break
            if page == 0:
                total = page_total
            studies.extend(rows)
            if not token or len(studies) >= cap:
                break
    seen: set[str] = set()
    unique = []
    for s in studies:
        if s["nct_id"] not in seen:
            seen.add(s["nct_id"])
            unique.append(s)
    return unique[:cap], total, partial


async def _compute(query: str, status_filter: list[str] | None, location: str | None) -> dict:
    studies, total, partial = await _fetch_studies(query, status_filter, location)
    built = build_landscape(studies)
    return {
        "query": query,
        "status_filter": status_filter or [],
        "location": location,
        "total": total,
        "fetched": len(studies),
        "shown": built["shown"],
        "without_asset": built["without_asset"],
        "page_size": PAGE_SIZE,
        "max_pages": MAX_PAGES,
        "partial": partial,
        "exhaustive": False,
        "groups": built["groups"],
    }


def _clean_status(status_filter) -> list[str] | None:
    if not isinstance(status_filter, (list, tuple)):
        return None
    cleaned = sorted({str(s).strip().upper() for s in status_filter if re.fullmatch(r"[A-Za-z_]{2,40}", str(s).strip())})
    return cleaned[:10] or None


async def trial_landscape_async(
    query: str, status_filter: list[str] | None = None, location: str | None = None,
) -> dict:
    """Cached landscape for one query (+ status / location filters)."""
    query = " ".join((query or "").split())[:MAX_QUERY_CHARS]
    if not query:
        return {"query": "", "total": 0, "fetched": 0, "shown": 0, "without_asset": 0,
                "partial": False, "exhaustive": False, "groups": []}
    status_filter = _clean_status(status_filter)
    location = " ".join((location or "").split())[:100] or None
    namespace = f"trial-landscape:v1:{PAGE_SIZE}x{MAX_PAGES}:{','.join(status_filter or [])}"
    if location:
        namespace += f":locn={location.lower()}"
    key = normalize_key(namespace, query)
    result = await cache.get_or_compute(
        key, lambda: _compute(query, status_filter, location), TTL_SOURCE, STALE_SOURCE,
    )
    if result.get("partial"):
        await cache.expire_soon(key)
    return result
