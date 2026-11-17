"""
test_trial_landscape — the competitive-landscape view (#82).

No network: the page fetcher is stubbed. Covers the bounds agreed by the AI
panel (25 per page, at most 2 pages, one call per page, cached), the coverage
numbers, intervention normalisation, placebo / standard-of-care exclusion and
the asset -> phase -> sponsor grouping.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.trial_landscape as tl  # noqa: E402
from sources.clinical_trials import fetch_trial_landscape_page  # noqa: E402


def _study(nct, interventions, phases=("PHASE2",), sponsor="Amgen", status="RECRUITING"):
    return {
        "nct_id": nct, "title": f"Trial {nct}", "status": status, "phases": list(phases),
        "sponsor": sponsor, "start_date": "2025-01",
        "interventions": [{"type": t, "name": n} for t, n in interventions],
    }


@pytest.fixture
def pages(monkeypatch):
    """Stub the registry: two full pages of 25 and a third that must never be asked for."""
    calls: list[dict] = []
    book = {
        None: ([_study(f"NCT{i:08d}", [("DRUG", "Sotorasib")]) for i in range(25)], 224, "tok2"),
        "tok2": ([_study(f"NCT{i:08d}", [("DRUG", "AMG 510")]) for i in range(25, 50)], None, "tok3"),
        "tok3": ([_study("NCT99999999", [("DRUG", "never")])], None, None),
    }

    async def fake(client, term, page_size, page_token=None, status_filter=None, location=None):
        calls.append({"term": term, "page_size": page_size, "token": page_token,
                      "status": status_filter, "location": location})
        return book[page_token]

    monkeypatch.setattr(tl, "fetch_trial_landscape_page", fake)
    return calls


def test_one_bounded_fetch_of_two_pages_and_coverage_numbers(pages):
    r = asyncio.run(tl.trial_landscape_async("KRAS G12C"))
    assert len(pages) == 2
    assert all(c["page_size"] == 25 for c in pages)
    assert [c["token"] for c in pages] == [None, "tok2"]
    assert r["total"] == 224 and r["fetched"] == 50 and r["shown"] == 50
    assert r["exhaustive"] is False and r["partial"] is False
    assert tl.PAGE_SIZE * tl.MAX_PAGES <= tl.HARD_CAP == 100


def test_result_is_cached(pages):
    asyncio.run(tl.trial_landscape_async("KRAS G12C"))
    asyncio.run(tl.trial_landscape_async("  kras   g12c "))
    assert len(pages) == 2


def test_filters_are_forwarded_and_keyed_separately(pages):
    asyncio.run(tl.trial_landscape_async("KRAS G12C"))
    asyncio.run(tl.trial_landscape_async("KRAS G12C", ["recruiting"], "Alabama"))
    assert len(pages) == 4
    assert pages[2]["status"] == ["RECRUITING"] and pages[2]["location"] == "Alabama"


def test_bad_status_values_are_dropped(pages):
    asyncio.run(tl.trial_landscape_async("x", ["RECRUITING", "1; drop", ""]))
    assert pages[0]["status"] == ["RECRUITING"]


def test_blank_query_makes_no_call(pages):
    r = asyncio.run(tl.trial_landscape_async("   "))
    assert pages == [] and r["groups"] == []


def test_query_is_bounded(pages):
    asyncio.run(tl.trial_landscape_async("a" * 5000))
    assert len(pages[0]["term"]) == tl.MAX_QUERY_CHARS


def test_code_name_and_inn_group_together(pages):
    r = asyncio.run(tl.trial_landscape_async("KRAS G12C"))
    assert [g["asset"] for g in r["groups"]] == ["Sotorasib"]
    assert r["groups"][0]["trial_count"] == 50
    assert r["groups"][0]["aliases"] == ["AMG 510"]


def test_first_page_failure_is_not_cached(monkeypatch):
    calls = []

    async def boom(*a, **k):
        calls.append(1)
        raise RuntimeError("registry down")

    monkeypatch.setattr(tl, "fetch_trial_landscape_page", boom)
    for _ in range(2):
        with pytest.raises(RuntimeError):
            asyncio.run(tl.trial_landscape_async("KRAS"))
    assert len(calls) == 2


def test_second_page_failure_keeps_first_page_as_partial(monkeypatch):
    async def fake(client, term, page_size, page_token=None, status_filter=None, location=None):
        if page_token:
            raise RuntimeError("timeout")
        return [_study("NCT00000001", [("DRUG", "Adagrasib")])], 80, "tok2"

    monkeypatch.setattr(tl, "fetch_trial_landscape_page", fake)
    r = asyncio.run(tl.trial_landscape_async("KRAS"))
    assert r["partial"] is True and r["fetched"] == 1 and r["total"] == 80


@pytest.mark.parametrize("raw,expected", [
    ("AMG 510", ["sotorasib"]),
    ("Lumakras®", ["sotorasib"]),
    ("MRTX849", ["adagrasib"]),
    ("GDC-6036", ["divarasib"]),
    ("Glecirasib Citrate Tablets", ["glecirasib"]),
    ("Erlotinib Hydrochloride", ["erlotinib"]),
    ("Sotorasib 960 mg", ["sotorasib"]),
    ("HRS-7058 capsule/ HRS-7058 tablet", ["hrs7058"]),
    ("IN10018 in combination with D-1553", ["in10018", "garsorasib"]),
    ("avutometinib (VS-6766) and adagrasib", ["avutometinib", "adagrasib"]),
    ("Dabrafenib+Trametinib", ["dabrafenib", "trametinib"]),
    ("5 Fluorouracil (5FU)", ["fluorouracil"]),
    ("Placebo", []),
    ("Matching placebo", []),
    ("Standard of Care", []),
    ("Best Supportive Care", []),
    ("Investigator's choice chemotherapy", []),
    ("", []),
])
def test_normalise_intervention(raw, expected):
    assert [k for k, _ in tl.normalise_intervention(raw)] == expected


def test_grouping_by_asset_then_phase_and_sponsor_excluding_non_assets():
    studies = [
        _study("NCT1", [("DRUG", "Divarasib"), ("DRUG", "Placebo")], ("PHASE3",), "Roche"),
        _study("NCT2", [("DRUG", "GDC-6036")], ("PHASE1", "PHASE2"), "Roche"),
        _study("NCT3", [("DRUG", "Divarasib")], ("PHASE2",), "Genentech"),
        _study("NCT4", [("DRUG", "Divarasib")], ("PHASE3",), "Roche"),
        _study("NCT5", [("OTHER", "Standard of care"), ("PROCEDURE", "Biopsy")], ("NA",), "NCI"),
        _study("NCT6", [("DEVICE", "Some kit")], (), "Qiagen"),
    ]
    built = tl.build_landscape(studies)
    assert built["shown"] == 4 and built["without_asset"] == 2
    [g] = built["groups"]
    assert g["asset"] == "Divarasib" and g["trial_count"] == 4
    assert [(r["phase"], r["sponsor"]) for r in g["rows"]] == [
        ("Phase 3", "Roche"), ("Phase 2", "Genentech"), ("Phase 1/2", "Roche"),
    ]
    assert [t["nct_id"] for t in g["rows"][0]["trials"]] == ["NCT4", "NCT1"]
    assert g["rows"][0]["trials"][0]["url"] == "https://clinicaltrials.gov/study/NCT4"


def test_phase_labels():
    assert tl.phase_label([]) == "Not stated"
    assert tl.phase_label(["NA"]) == "Not applicable"
    assert tl.phase_label(["EARLY_PHASE1"]) == "Early phase 1"
    assert tl.phase_label(["PHASE2", "PHASE3"]) == "Phase 2/3"


class _FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

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


def test_page_fetcher_url_and_parse():
    client = _FakeClient({"totalCount": 224, "nextPageToken": "abc", "studies": [
        {"protocolSection": {
            "identificationModule": {"nctId": "NCT07541170", "briefTitle": "Divarasib study"},
            "statusModule": {"overallStatus": "RECRUITING", "startDateStruct": {"date": "2025-06"}},
            "designModule": {"phases": ["PHASE3"]},
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Hoffmann-La Roche"}},
            "armsInterventionsModule": {"interventions": [{"type": "DRUG", "name": "Divarasib"}]},
        }},
        {"protocolSection": {"identificationModule": {"briefTitle": "no id"}}},
    ]})
    rows, total, token = asyncio.run(fetch_trial_landscape_page(
        client, "KRAS G12C", 25, status_filter=["RECRUITING"], location="Alabama",
    ))
    url = client.urls[0]
    assert "query.term=KRAS%20G12C" in url and "pageSize=25" in url and "countTotal=true" in url
    assert "filter.overallStatus=RECRUITING" in url and "query.locn=Alabama" in url
    assert "fields=" in url and "pageToken" not in url
    assert total == 224 and token == "abc"
    assert rows == [{
        "nct_id": "NCT07541170", "title": "Divarasib study", "status": "RECRUITING",
        "phases": ["PHASE3"], "sponsor": "Hoffmann-La Roche", "start_date": "2025-06",
        "interventions": [{"type": "DRUG", "name": "Divarasib"}],
    }]

    asyncio.run(fetch_trial_landscape_page(client, "KRAS G12C", 25, page_token="abc"))
    assert "pageToken=abc" in client.urls[1] and "countTotal" not in client.urls[1]


class _Req:
    def __init__(self, body):
        self._body = body

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_http_route_forwards_inputs_and_never_500s(monkeypatch):
    import json

    import server

    seen = {}

    async def fake(query, status_filter=None, location=None):
        seen.update(query=query, status=status_filter, location=location)
        if query == "boom":
            raise RuntimeError("down")
        return {"query": query, "groups": []}

    monkeypatch.setattr(server, "trial_landscape_async", fake)
    resp = asyncio.run(server.trial_landscape_http(_Req(
        {"query": "KRAS G12C", "status_filter": ["RECRUITING"], "trial_location": "Alabama"})))
    assert resp.status_code == 200 and seen == {"query": "KRAS G12C", "status": ["RECRUITING"], "location": "Alabama"}

    resp = asyncio.run(server.trial_landscape_http(_Req({"query": "boom"})))
    assert resp.status_code == 200 and json.loads(resp.body)["groups"] == []

    asyncio.run(server.trial_landscape_http(_Req(ValueError("not json"))))
    assert seen["query"] == ""
