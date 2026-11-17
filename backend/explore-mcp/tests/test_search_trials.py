"""
test_search_trials — ClinicalTrials.gov fetcher Item-shape test from a fixture.

Asserts kind/source, signal is None, the no-NCT-id drop, briefSummary slicing,
and that no forbidden field appears in output.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Item  # noqa: E402
from sources.clinical_trials import fetch_trials  # noqa: E402
from tools.search_trials import merge_trials  # noqa: E402

_FORBIDDEN = ("email", "transcript", "contact_info")


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json now
        # reads it directly (no getattr fallback), so an unfaithful double
        # fails loudly rather than silently reporting 200.
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


def _assert_no_forbidden(items):
    for it in items:
        blob = json.dumps(it.model_dump(), default=str)
        for field in _FORBIDDEN:
            assert field not in blob


def test_trials_item_shape_and_no_signal():
    client = _FakeClient({"studies": [
        {
            "protocolSection": {
                "identificationModule": {"nctId": "NCT01234567", "briefTitle": "Study of X in Glioblastoma"},
                "statusModule": {"startDateStruct": {"date": "2025-03-01"}, "overallStatus": "RECRUITING"},
                "descriptionModule": {"briefSummary": "A" * 300},   # long, no spaces -> hard cut + ellipsis
            }
        },
        {   # no nctId -> dropped
            "protocolSection": {"identificationModule": {"briefTitle": "No NCT"}}
        },
    ]})
    items = asyncio.run(fetch_trials(client, "glioblastoma", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "clinicaltrials:NCT01234567"
    assert it.kind == "trial"
    assert it.source == "clinicaltrials"
    assert it.title == "Study of X in Glioblastoma"
    assert len(it.summary) <= 220 and it.summary.endswith("…")
    assert it.raw["brief_summary"] == "A" * 300
    assert it.url == "https://clinicaltrials.gov/study/NCT01234567"
    assert it.date_iso == "2025-03-01T00:00:00.000Z"
    assert it.signal is None
    _assert_no_forbidden(items)


def test_trials_empty_summary_falls_back_to_status():
    client = _FakeClient({"studies": [
        {"protocolSection": {
            "identificationModule": {"nctId": "NCT99", "briefTitle": "T"},
            "statusModule": {"overallStatus": "COMPLETED"},
        }}
    ]})
    items = asyncio.run(fetch_trials(client, "x", 10))
    assert items[0].summary == "COMPLETED clinical trial."


def test_trials_condition_only_uses_query_cond_else_query_term():
    cond = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(cond, "glioblastoma", 10, ["RECRUITING"], condition_only=True))
    assert "query.cond=glioblastoma" in cond.urls[0]
    assert "query.term" not in cond.urls[0]
    assert "sort=LastUpdatePostDate:desc" in cond.urls[0]
    assert "filter.overallStatus=RECRUITING" in cond.urls[0]

    term = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(term, "glioblastoma", 10))
    assert "query.term=glioblastoma" in term.urls[0]
    assert "query.cond" not in term.urls[0]


def test_trials_extra_term_sends_both_cond_and_term():
    c = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(c, "pancreatic cancer", 10, ["RECRUITING"], condition_only=True, extra_term="KRAS"))
    assert "query.cond=pancreatic%20cancer" in c.urls[0]
    assert "query.term=KRAS" in c.urls[0]
    assert "filter.overallStatus=RECRUITING" in c.urls[0]

    # extra_term is ignored without condition_only (the term is already query.term)
    t = _FakeClient({"studies": []})
    asyncio.run(fetch_trials(t, "KRAS", 10, extra_term="x"))
    assert t.urls[0].count("query.term") == 1 and "query.cond" not in t.urls[0]


def _trial(nct):
    return Item(
        id=f"clinicaltrials:{nct}", kind="trial", title=nct, summary="s",
        url=f"https://clinicaltrials.gov/study/{nct}", source="clinicaltrials",
        dedupe_key=nct, raw={"nct_id": nct},
    )


def test_merge_trials_gene_matched_first_dedupes_and_fills_to_limit():
    gene = [_trial("NCT1"), _trial("NCT2")]
    cond = [_trial("NCT2"), _trial("NCT3"), _trial("NCT4")]
    merged = merge_trials(gene, cond, 4)
    assert [i.raw["nct_id"] for i in merged] == ["NCT1", "NCT2", "NCT3", "NCT4"]
    assert [i.raw["nct_id"] for i in merge_trials(gene, cond, 3)] == ["NCT1", "NCT2", "NCT3"]


def test_merge_trials_falls_back_to_condition_only_when_gene_search_empty():
    cond = [_trial("NCT3"), _trial("NCT4")]
    assert [i.raw["nct_id"] for i in merge_trials([], cond, 10)] == ["NCT3", "NCT4"]


def test_search_trials_with_gene_runs_both_searches_and_merges():
    import tools.search_trials as st

    calls = []

    async def fake(query, limit=20, status_filter=None, condition_only=False, extra_term=None):
        calls.append((query, status_filter, condition_only, extra_term))
        return [_trial("NCT9")] if extra_term else [_trial("NCT8"), _trial("NCT9")]

    original = st.search_trials_async
    st.search_trials_async = fake
    try:
        merged = asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10, ["RECRUITING"]))
    finally:
        st.search_trials_async = original
    assert [i.raw["nct_id"] for i in merged] == ["NCT9", "NCT8"]
    # Both searches ran (in parallel, so order is not fixed), both with the status filter.
    assert len(calls) == 2
    assert ("pancreatic cancer", ["RECRUITING"], True, None) in calls
    assert ("pancreatic cancer", ["RECRUITING"], True, "KRAS") in calls


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


def _study(nct, summary="", start=None):
    status = {"overallStatus": "RECRUITING"}
    if start is not None:
        status["startDateStruct"] = {"date": start}
    return {"protocolSection": {
        "identificationModule": {"nctId": nct, "briefTitle": f"Trial {nct} in ALS patients"},
        "statusModule": status,
        "descriptionModule": {"briefSummary": summary},
    }}


def test_trial_summary_truncates_at_word_boundary():
    words = ("This study evaluates the safety of an antisense oligonucleotide in adults "
             "with ALS who carry specific mutations in the SOD1 gene and have symptoms "
             "for less than two years, with assessments of function, biomarkers and survival "
             "over the full treatment period.")
    assert len(words) > 220
    client = _FakeClient({"studies": [_study("NCT07290062", words), _study("NCT00000001", "Short summary.")]})
    items = {it.id: it for it in asyncio.run(fetch_trials(client, "als", 10))}

    long_ = items["clinicaltrials:NCT07290062"].summary
    assert len(long_) <= 220
    assert long_.endswith("…")
    body = long_[:-1]
    assert words.startswith(body)
    assert words[len(body)] == " "              # cut falls on a word boundary
    assert items["clinicaltrials:NCT07290062"].raw["brief_summary"] == words
    assert items["clinicaltrials:NCT00000001"].summary == "Short summary."


def test_trial_dates_month_precision_and_missing_is_null():
    client = _FakeClient({"studies": [
        _study("NCT02567136", "x", start="2015-09"),
        _study("NCT07883590", "x"),                 # no start date
        _study("NCT07929792", "x", start="garbage"),
    ]})
    items = {it.id: it for it in asyncio.run(fetch_trials(client, "als", 10))}

    assert items["clinicaltrials:NCT02567136"].date_iso == "2015-09-01T00:00:00.000Z"
    assert items["clinicaltrials:NCT07883590"].date_iso is None
    assert items["clinicaltrials:NCT07929792"].date_iso is None


# ── #61: locations, eligibility, primary outcomes, location filter ───────────

import json as _json  # noqa: E402

import tools.search_trials as st  # noqa: E402


def _rich_study():
    locations = [
        {"facility": f"Site {i}", "city": "Houston", "state": "Texas", "country": "United States",
         "status": "RECRUITING", "contacts": [{"name": "Dr X", "email": "x@example.org"}]}
        for i in range(8)
    ] + [
        {"facility": "University of Alabama at Birmingham", "city": "Birmingham", "state": "Alabama",
         "country": "United States", "status": "RECRUITING"},
        {"facility": "Toronto General", "city": "Toronto", "state": "Ontario", "country": "Canada"},
    ]
    return {"protocolSection": {
        "identificationModule": {"nctId": "NCT02954874", "briefTitle": "TNBC adjuvant trial"},
        "statusModule": {"overallStatus": "RECRUITING"},
        "descriptionModule": {"briefSummary": "Short summary."},
        "designModule": {"phases": ["PHASE2", "PHASE3"]},
        "eligibilityModule": {
            "eligibilityCriteria": "Inclusion Criteria:\n\n* Histologically confirmed triple-negative "
                                   "breast cancer. " + "Adequate organ function is required. " * 20,
            "healthyVolunteers": False, "sex": "ALL", "minimumAge": "18 Years",
        },
        "outcomesModule": {"primaryOutcomes": [
            {"measure": "Invasive disease-free survival (IDFS)", "timeFrame": "Up to 5 years",
             "description": "Long statistical description " * 50},
            {"measure": "Outcome 2"}, {"measure": "Outcome 3"}, {"measure": "Outcome 4"},
        ]},
        "contactsLocationsModule": {
            "centralContacts": [{"name": "Study Contact", "email": "c@example.org", "phone": "555"}],
            "locations": locations,
        },
    }}


def test_trial_raw_has_capped_locations_eligibility_and_outcomes():
    client = _FakeClient({"studies": [_rich_study()]})
    raw = asyncio.run(fetch_trials(client, "tnbc", 10))[0].raw

    assert raw["location_states"] == ["Texas", "Alabama", "Ontario"]
    assert raw["site_count"] == 10
    assert len(raw["sites"]) == 5
    assert raw["sites"][0] == {"facility": "Site 0", "city": "Houston", "state": "Texas",
                               "country": "United States", "status": "RECRUITING"}
    assert raw["phases"] == ["PHASE2", "PHASE3"]

    elig = raw["eligibility"]
    assert elig["min_age"] == "18 Years" and elig["sex"] == "ALL" and elig["healthy_volunteers"] is False
    assert "max_age" not in elig
    excerpt = elig["criteria_excerpt"]
    assert excerpt.startswith("Inclusion Criteria: Histologically confirmed")
    assert len(excerpt) <= 300 and excerpt.endswith(".")      # ends at a sentence

    assert raw["primary_outcomes"] == [
        {"measure": "Invasive disease-free survival (IDFS)", "time_frame": "Up to 5 years"},
        {"measure": "Outcome 2"}, {"measure": "Outcome 3"},
    ]
    blob = _json.dumps(raw)
    assert "email" not in blob and "Study Contact" not in blob and "Dr X" not in blob


def test_trial_location_filter_sends_query_locn_and_lists_matching_sites_first():
    client = _FakeClient({"studies": [_rich_study()]})
    raw = asyncio.run(fetch_trials(client, "tnbc", 10, location="Alabama"))[0].raw
    assert "&query.locn=Alabama" in client.urls[-1]
    assert raw["sites"][0]["facility"] == "University of Alabama at Birmingham"

    asyncio.run(fetch_trials(client, "tnbc", 10))
    assert "query.locn" not in client.urls[-1]


def test_trial_summary_prefers_a_sentence_boundary():
    first = ("This phase 2 study tests whether monthly intrathecal drug X slows functional "
             "decline in adults with ALS who carry SOD1 mutations.")
    text = (first + " "
            "Participants receive monthly intrathecal doses for up to two years, with "
            "assessments of function, biomarkers and survival over the treatment period.")
    assert len(text) > 220
    client = _FakeClient({"studies": [_study("NCT1", text)]})
    summary = asyncio.run(fetch_trials(client, "als", 10))[0].summary
    assert summary == first


def test_search_trials_location_is_forwarded_and_keyed(monkeypatch):
    calls = []

    async def fake_fetch(client, query, limit, status_filter=None, condition_only=False,
                         extra_term=None, location=None):
        calls.append(location)
        return []

    monkeypatch.setattr(st, "fetch_trials", fake_fetch)
    asyncio.run(st.search_trials_async("tnbc", 10))
    asyncio.run(st.search_trials_async("tnbc", 10, location="Alabama"))
    asyncio.run(st.search_trials_async("tnbc", 10, location="alabama "))   # same key, cached
    assert calls == [None, "Alabama"]
