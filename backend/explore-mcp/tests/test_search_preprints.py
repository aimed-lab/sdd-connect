"""
test_search_preprints — Europe PMC preprint fetcher, from a mocked response.

Asserts the request (SRC:PPR filter + newest-first sort), field mapping, the
no-title drop, DOI url vs the europepmc.org fallback, the AND-joined explore
query, and that a preprint sharing a DOI with a returned paper is shown once.
"""

from __future__ import annotations

import asyncio
import os
import sys
from urllib.parse import unquote

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Item  # noqa: E402
from sources.europepmc import fetch_preprints  # noqa: E402


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload
        self.urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        self.urls.append(url)
        return _FakeResponse(self._payload)


_PAYLOAD = {"resultList": {"result": [
    {
        "id": "PPR1001", "title": "Temozolomide resistance in glioblastoma",
        "authorString": "Smith J, Doe A.", "firstPublicationDate": "2026-10-12",
        "doi": "10.1101/2026.10.01.123456", "bookOrReportDetails": {"publisher": "bioRxiv"},
    },
    {   # no DOI -> europepmc.org fallback url; no publisher
        "id": "PPR1002", "title": "A preprint without a DOI",
        "authorString": "Lee K", "firstPublicationDate": "2026-10-10",
    },
    {"id": "PPR1003", "title": "   ", "authorString": "Nobody"},     # blank title -> dropped
    {"id": "PPR1004", "authorString": "Nobody"},                      # no title   -> dropped
]}}


def test_request_filters_to_preprints_newest_first():
    c = _FakeClient(_PAYLOAD)
    asyncio.run(fetch_preprints(c, "temozolomide AND glioblastoma", 10))
    url = unquote(c.urls[0])
    assert url.startswith("https://www.ebi.ac.uk/europepmc/webservices/rest/search?")
    assert "query=temozolomide AND glioblastoma AND SRC:PPR" in url
    assert "sort=P_PDATE_D desc" in url
    assert "pageSize=10" in url and "format=json" in url


def test_fields_map_and_untitled_results_are_dropped():
    items = asyncio.run(fetch_preprints(_FakeClient(_PAYLOAD), "x", 10))
    assert [i.title for i in items] == ["Temozolomide resistance in glioblastoma", "A preprint without a DOI"]
    first = items[0]
    assert first.kind == "preprint" and first.source == "europepmc"
    assert first.id == "europepmc:PPR1001"
    assert first.summary == "bioRxiv · Smith J, Doe A."
    assert first.date_iso == "2026-10-12T00:00:00.000Z"
    assert first.doi == "10.1101/2026.10.01.123456"
    assert first.signal is None
    assert first.raw == {"server": "bioRxiv", "authors": "Smith J, Doe A.", "doi": "10.1101/2026.10.01.123456"}


def test_url_is_doi_when_present_else_europepmc_fallback():
    items = asyncio.run(fetch_preprints(_FakeClient(_PAYLOAD), "x", 10))
    assert items[0].url == "https://doi.org/10.1101/2026.10.01.123456"
    assert items[1].url == "https://europepmc.org/article/PPR/PPR1002"
    assert items[1].doi is None
    assert items[1].summary == "Lee K"          # no server -> authors only


def test_explore_query_joins_diseases_and_genes_with_and():
    from tools.explore import _preprints_query
    scope = {"diseases": ["pancreatic cancer"], "genes": ["KRAS"], "topics": ["x"]}
    assert _preprints_query(scope) == '"pancreatic cancer" AND KRAS'
    assert _preprints_query({"diseases": [], "genes": [], "topics": ["drug discovery"]}) == '"drug discovery"'
    assert _preprints_query({"diseases": [], "genes": [], "topics": []}) == ""


def _item(kind, id_, doi):
    return Item(id=id_, kind=kind, title=id_, summary="s", url=f"https://x/{id_}", doi=doi,
                source="europepmc" if kind == "preprint" else "pubmed", dedupe_key=id_)


def test_preprint_sharing_a_doi_with_a_paper_is_shown_once():
    import tools.explore as te

    paper = _item("paper", "p1", "10.1/shared")
    keep = _item("preprint", "pp-keep", "10.1/other")
    dup = _item("preprint", "pp-dup", "10.1/shared")

    async def fake_papers(*a, **k):
        return [paper], [paper]

    async def fake_preprints(*a, **k):
        return [dup, keep]

    originals = (te.search_papers_multi_dual_async, te.search_preprints_async)
    te.search_papers_multi_dual_async, te.search_preprints_async = fake_papers, fake_preprints
    try:
        scope = {"topics": [], "genes": ["KRAS"], "diseases": ["pancreatic cancer"], "assets": [], "methods": []}
        sections = asyncio.run(te._execute(["search_papers", "search_preprints"], scope))
    finally:
        te.search_papers_multi_dual_async, te.search_preprints_async = originals
    pre = next(s for s in sections if s["tool"] == "search_preprints")
    assert [i["id"] for i in pre["items"]] == ["pp-keep"]
    assert pre["kind"] == "preprint"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except Exception as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)


# ── #66: 'KRAS G12C' returned 0 preprints ────────────────────────────────────

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402
import tools.search_preprints as sp  # noqa: E402
from cache import cache, normalize_key  # noqa: E402
from sources.europepmc import relaxed_query  # noqa: E402


class _SequenceClient:
    """Answers each GET with the next payload in turn."""

    def __init__(self, *payloads):
        self._payloads = list(payloads)
        self.urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        self.urls.append(url)
        return _FakeResponse(self._payloads.pop(0))


_KRAS_HIT = {"hitCount": 150, "resultList": {"result": [{
    "id": "PPR1332966", "title": "KRAS <sup>G12C</sup> Inhibition Remodels the NSCLC Microenvironment",
    "authorString": "Doe A", "firstPublicationDate": "2026-10-02",
    "doi": "10.64898/2026.10.01.756013", "bookOrReportDetails": {"publisher": "bioRxiv"},
}]}}
_NO_HITS = {"hitCount": 0, "resultList": {"result": []}}


def test_relaxed_query_drops_quotes_and_ands_the_words():
    assert relaxed_query('"KRAS G12C"') == "KRAS AND G12C"
    assert relaxed_query('"KRAS G12C" AND "lung cancer"') == "KRAS AND G12C AND lung AND cancer"
    assert relaxed_query("sotorasib") == "sotorasib"


def test_phrase_with_no_hits_is_retried_once_relaxed():
    c = _SequenceClient(_NO_HITS, _KRAS_HIT)
    items = asyncio.run(fetch_preprints(c, '"KRAS G12C"', 10))
    assert [it.id for it in items] == ["europepmc:PPR1332966"]
    assert len(c.urls) == 2
    assert "query=KRAS%20AND%20G12C%20AND%20SRC:PPR" in c.urls[1]


def test_hits_on_the_first_query_make_no_second_call():
    c = _SequenceClient(_KRAS_HIT)
    assert len(asyncio.run(fetch_preprints(c, "KRAS G12C", 10))) == 1
    assert len(c.urls) == 1


def test_single_word_with_no_hits_is_not_retried():
    c = _SequenceClient(_NO_HITS)
    assert asyncio.run(fetch_preprints(c, "sotorasib", 10)) == []
    assert len(c.urls) == 1


def test_upstream_failure_is_retried_then_raised_and_not_cached_as_empty(monkeypatch):
    attempts = []

    async def flaky(client, term, cap):
        attempts.append(term)
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(sp, "fetch_preprints", flaky)
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(sp.search_preprints_async("KRAS G12C", 10))
    assert attempts == ["KRAS G12C", "KRAS G12C"]
    assert asyncio.run(cache._load(normalize_key("preprints:10", "KRAS G12C"))) is None


def test_explore_does_not_pin_a_failed_preprint_section(monkeypatch):
    calls = []

    async def fake(query, limit=20):
        calls.append(query)
        if len(calls) == 1:
            raise httpx.ReadTimeout("slow")
        return [Item(id="europepmc:PPR1", kind="preprint", title="KRAS G12C preprint", summary="bioRxiv",
                     url="https://doi.org/10.1/x", doi=None, source="europepmc", date_iso=None,
                     signal=None, dedupe_key="k")]

    monkeypatch.setattr(te, "search_preprints_async", fake)
    first = asyncio.run(te.explore_async("KRAS G12C", only_kinds=["preprint"]))
    assert first["sections"][0]["items"] == [] and "error" in first["sections"][0]

    key = normalize_key("explore:only:preprint", "KRAS G12C")
    entry = asyncio.run(cache._load(key))
    assert entry.ttl <= 45 and entry.stale_ttl <= 45      # expire_soon, not the 1 h topic TTL
