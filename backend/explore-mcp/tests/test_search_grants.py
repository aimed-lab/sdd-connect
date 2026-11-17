"""
test_search_grants — Grants.gov fetcher Item-shape test from a recorded fixture.

Asserts kind/source, signal is None (no metric — never fabricated), the
missing-number drop, and that no forbidden field appears in output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.grants_gov import fetch_grants  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json/
        # post_json now read it directly (no getattr fallback), so an
        # unfaithful double fails loudly rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    async def post(self, url, timeout=None, json=None, headers=None):
        return _FakeResponse(self._payload)


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


def test_grants_item_shape_and_no_signal():
    client = _FakeClient({"data": {"oppHits": [
        {
            "id": 358123,
            "title": "Glioblastoma Therapeutics Development",
            "number": "RFA-CA-26-001",
            "agencyCode": "HHS-NIH-NCI",
            "agency": "National Cancer Institute",
            "openDate": "2026-06-01",
        },
        {"title": "Missing number opportunity"},          # no number -> dropped
        {"number": "X-1"},                                  # no title  -> dropped
    ]}})
    items = asyncio.run(fetch_grants(client, "glioblastoma", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "grants_gov:358123"
    assert it.kind == "grant"
    assert it.source == "grants_gov"
    assert it.title == "Glioblastoma Therapeutics Development"
    assert it.summary == "HHS-NIH-NCI — National Cancer Institute"
    assert it.url == "https://www.grants.gov/search-results-detail/358123"
    assert it.date_iso == "2026-06-01T00:00:00.000Z"
    assert it.signal is None                # grants expose no ranking metric
    _assert_no_forbidden(items)


_HITS_PANCREATIC = {"data": {"oppHits": [
    {"id": 1, "number": "A-1", "title": "The Role of the Innate Immune System in the Pathogenesis of Type 1 Diabetes"},
    {"id": 2, "number": "A-2", "title": "Immune Tolerance Network"},
    {
        "id": 3, "number": "PAR-26-001", "title": "Pancreatic Cancer Detection Consortium",
        "agencyCode": "HHS-NIH-NCI", "agency": "National Cancer Institute", "oppStatus": "posted",
        "openDate": "2026-05-01", "closeDate": "2026-12-15",
    },
]}}


def test_grants_must_mention_drops_off_topic_titles():
    client = _FakeClient(_HITS_PANCREATIC)
    items = asyncio.run(fetch_grants(client, "pancreatic cancer KRAS", 10, must_mention=["pancreatic cancer", "KRAS"]))
    assert [it.title for it in items] == ["Pancreatic Cancer Detection Consortium"]


def test_grants_must_mention_no_match_returns_empty_not_unfiltered():
    client = _FakeClient(_HITS_PANCREATIC)
    assert asyncio.run(fetch_grants(client, "x", 10, must_mention=["glioblastoma"])) == []


def test_grants_must_mention_is_whole_phrase():
    client = _FakeClient({"data": {"oppHits": [{"id": 9, "number": "B-1", "title": "Nonkrasonic Studies"}]}})
    assert asyncio.run(fetch_grants(client, "x", 10, must_mention=["kras"])) == []


def test_grants_without_must_mention_keeps_everything():
    client = _FakeClient(_HITS_PANCREATIC)
    assert len(asyncio.run(fetch_grants(client, "x", 10))) == 3


def test_grants_raw_is_small_dict_with_close_date():
    client = _FakeClient(_HITS_PANCREATIC)
    items = asyncio.run(fetch_grants(client, "x", 10, must_mention=["pancreatic cancer"]))
    raw = items[0].raw
    assert {k: raw[k] for k in ("number", "agency", "agency_code", "status", "open_date", "close_date")} == {
        "number": "PAR-26-001",
        "agency": "National Cancer Institute",
        "agency_code": "HHS-NIH-NCI",
        "status": "posted",
        "open_date": "2026-05-01",
        "close_date": "2026-12-15",
    }
    assert set(raw) <= {
        "number", "agency", "agency_code", "status", "open_date", "close_date",
        "is_open", "cfda", "activity_codes",
    }


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)


def _grants(*hits):
    return asyncio.run(fetch_grants(_FakeClient({"data": {"oppHits": list(hits)}}), "cancer", 10))


def test_grant_dates_parse_mm_dd_yyyy_open_then_close_else_null():
    items = {it.id: it for it in _grants(
        {"id": 1, "title": "Cancer grant A", "number": "A-1", "openDate": "03/15/2026", "closeDate": "07/01/2026"},
        {"id": 2, "title": "Cancer grant B", "number": "B-1", "openDate": "", "closeDate": "12/05/2026"},
        {"id": 3, "title": "Cancer grant C", "number": "C-1"},
        {"id": 4, "title": "Cancer grant D", "number": "D-1", "openDate": "13/45/2026"},
    )}

    assert items["grants_gov:1"].date_iso == "2026-03-15T00:00:00.000Z"
    assert items["grants_gov:2"].date_iso == "2026-12-05T00:00:00.000Z"
    assert items["grants_gov:3"].date_iso is None
    assert items["grants_gov:4"].date_iso is None
    assert all(it.date_iso != "1970-01-01T00:00:00.000Z" for it in items.values())
    assert items["grants_gov:1"].raw["open_date"] == "03/15/2026"


# ── #60: open-only / agency filters, deadline sort, synopsis fields ──────────

from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402

import tools.search_grants as sg  # noqa: E402
from sources.grants_gov import (  # noqa: E402
    agency_param, is_open, parse_synopsis, sort_by_deadline,
)


class _CapturingClient(_FakeClient):
    def __init__(self, payload):
        super().__init__(payload)
        self.bodies: list[dict] = []

    async def post(self, url, timeout=None, json=None, headers=None):
        self.bodies.append(json)
        return _FakeResponse(self._payload)


def test_agency_param_aliases_and_wildcards_top_level_codes():
    assert agency_param(["NIH", "nsf", "HHS-NIH11", " "]) == "HHS-NIH11|NSF|NSF*"
    assert agency_param(["DOD"]) == "DOD|DOD*"
    assert agency_param(None) == ""


def test_fetch_grants_sends_open_only_and_agencies_server_side():
    c = _CapturingClient({"data": {"oppHits": []}})
    asyncio.run(fetch_grants(c, "drug discovery", 10, open_only=True, agencies=["NIH"]))
    assert c.bodies[-1]["oppStatuses"] == "posted"
    assert c.bodies[-1]["agencies"] == "HHS-NIH11"

    asyncio.run(fetch_grants(c, "drug discovery", 10))
    assert c.bodies[-1]["oppStatuses"] == "forecasted|posted"
    assert "agencies" not in c.bodies[-1]


def test_is_open_needs_posted_and_a_future_or_missing_close_date():
    now = datetime(2026, 11, 17, tzinfo=timezone.utc)
    assert is_open("posted", "03/05/2027", now) is True
    assert is_open("posted", "11/17/2026", now) is True      # closes today
    assert is_open("posted", "01/05/2026", now) is False     # already closed
    assert is_open("posted", None, now) is True
    assert is_open("forecasted", "03/05/2027", now) is False


def test_grant_raw_carries_cfda_activity_codes_and_open_flag():
    items = _grants({
        "id": 360676, "number": "PAR-27-081", "oppStatus": "forecasted", "docType": "forecast",
        "title": "Discovery of in vivo Chemical Probes (R01 Clinical Trial Not Allowed)",
        "cfdaList": ["93.866", "93.242"],
    })
    raw = items[0].raw
    assert raw["cfda"] == ["93.866", "93.242"]
    assert raw["activity_codes"] == ["R01"]
    assert raw["is_open"] is False      # forecasts are kept, but labelled not open


def test_sort_by_deadline_soonest_first_missing_last():
    items = _grants(
        {"id": 1, "number": "A", "title": "Cancer A", "closeDate": "08/18/2027"},
        {"id": 2, "number": "B", "title": "Cancer B"},
        {"id": 3, "number": "C", "title": "Cancer C", "closeDate": "03/05/2027"},
    )
    assert [it.raw["number"] for it in sort_by_deadline(items)] == ["C", "A", "B"]


_FETCH_OPPORTUNITY_DATA = {   # trimmed from a live fetchOpportunity response (id 357529)
    "id": 357529, "opportunityNumber": "PAR-25-297",
    "synopsis": {
        "awardCeiling": "1500000", "awardFloor": "none",
        "applicantEligibilityDesc": "Other Eligible Applicants include the following:\n Alaska Native "
                                    "and Native Hawaiian Serving Institutions.",
        "applicantTypes": [{"id": "00", "description": "State governments"},
                           {"id": "12", "description": "Nonprofits having a 501(c)(3) status"}],
        "fundingInstruments": [{"id": "CA", "description": "Cooperative Agreement"}],
        "synopsisDesc": "<p>The goal of this Notice of Funding Opportunity (NOFO) is to provide "
                        "funding support for the pre-clinical development of novel drug candidates.</p>",
        "agencyContactEmail": "someone@nih.gov",
    },
}


def test_parse_synopsis_keeps_award_eligibility_and_plain_text_description():
    syn = parse_synopsis(_FETCH_OPPORTUNITY_DATA)
    assert syn["award_ceiling"] == 1500000
    assert "award_floor" not in syn                     # "none" is not an amount
    assert syn["eligibility"] == ["State governments", "Nonprofits having a 501(c)(3) status"]
    assert syn["funding_instruments"] == ["Cooperative Agreement"]
    assert syn["description"].startswith("The goal of this Notice")
    assert "<p>" not in syn["description"]
    assert "email" not in json.dumps(syn).lower()       # contacts are never copied
    assert parse_synopsis({"forecast": {"awardCeiling": "250,000"}}) == {"award_ceiling": 250000}
    assert parse_synopsis(None) == {}


@pytest.fixture
def stub_grants(monkeypatch):
    calls: dict = {"fetch": [], "synopsis": []}

    async def fake_fetch(client, term, cap, **kw):
        calls["fetch"].append((term, cap, kw))
        hits = [
            {"id": 100 + i, "number": f"N-{i}", "title": f"Cancer grant {i}",
             "closeDate": f"0{(i % 9) + 1}/01/2027"}
            for i in range(cap)
        ]
        return await fetch_grants(_FakeClient({"data": {"oppHits": hits}}), term, cap)

    async def fake_synopsis(client, opp_id):
        calls["synopsis"].append(opp_id)
        if opp_id == "101":
            raise RuntimeError("upstream down")
        return {"award_ceiling": 500000}

    monkeypatch.setattr(sg, "fetch_grants", fake_fetch)
    monkeypatch.setattr(sg, "fetch_synopsis", fake_synopsis)
    return calls


def test_search_grants_enriches_only_the_top_results_best_effort(stub_grants):
    items = asyncio.run(sg.search_grants_async("cancer", 12))
    assert len(items) == 12
    assert len(stub_grants["synopsis"]) == sg._SYNOPSIS_TOP_N
    assert items[0].raw["award_ceiling"] == 500000
    assert "award_ceiling" not in items[1].raw           # its fetch failed: item kept as is
    assert "award_ceiling" not in items[11].raw          # beyond the top N: not fetched


def test_search_grants_synopsis_is_cached_per_opportunity(stub_grants):
    asyncio.run(sg.search_grants_async("cancer", 3))
    asyncio.run(sg.search_grants_async("other topic", 3))
    # The second search reuses all three cached synopses (101's failure is a
    # short-lived empty entry, re-checked after TTL_EMPTY), so no new calls.
    assert sorted(stub_grants["synopsis"]) == ["100", "101", "102"]


def test_search_grants_filters_reach_the_source_and_split_the_cache(stub_grants):
    asyncio.run(sg.search_grants_async("cancer", 5))
    items = asyncio.run(sg.search_grants_async("cancer", 5, open_only=True, agencies=["NIH"], sort="deadline"))
    assert len(stub_grants["fetch"]) == 2
    _, cap, kw = stub_grants["fetch"][1]
    assert kw["open_only"] is True and kw["agencies"] == ["NIH"]
    assert cap == sg._DEADLINE_POOL_SIZE                  # sort over a wider pool, then cap
    closes = [it.raw["close_date"] for it in items]
    assert closes == sorted(closes, key=lambda d: (d[6:], d[:5]))
    assert len(items) == 5
