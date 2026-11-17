"""
tests/test_explore_only_kinds.py — the optional `only_kinds` restriction on explore.

A user who picks a scope ("Grants") must get THAT source queried with their text,
even when the LLM router would not have chosen it. No network, no Groq: the
per-source functions are stubbed, the router is made to explode if it is ever
reached, and the scope extraction raises (a Groq outage), so these also cover the
deterministic fallback.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402


class _item:
    """Minimal stand-in for a source item: the fan-out only calls model_dump()."""

    def __init__(self, kind: str, title: str):
        self._d = {"id": f"{kind}-1", "kind": kind, "title": title}

    def model_dump(self):
        return dict(self._d)


@pytest.fixture
def stubs(monkeypatch):
    calls: list[tuple[str, str]] = []

    def make(name, kind):
        async def fn(query, *args, **kwargs):
            calls.append((name, query))
            return [_item(kind, f"{kind} for {query}")]
        return fn

    monkeypatch.setattr(te, "search_grants_async", make("search_grants", "grant"))
    monkeypatch.setattr(te, "search_preprints_async", make("search_preprints", "preprint"))
    monkeypatch.setattr(te, "search_fda_async", make("search_fda", "approval"))
    monkeypatch.setattr(te, "search_tools_async", make("search_tools", "tool"))
    monkeypatch.setattr(te, "search_datasets_async", make("search_datasets", "dataset"))

    def outage(*a, **k):
        raise RuntimeError("LLM unavailable")

    def boom(*a, **k):
        raise AssertionError("routing must not run for only_kinds")

    monkeypatch.setattr(te, "_extract_scope", outage)
    monkeypatch.setattr(te, "_choose_tools", boom)
    return calls


def test_normalize_drops_unknown_and_sorts():
    assert te.normalize_only_kinds(["grant", "bogus", " paper ", "grant"]) == ["grant", "paper"]
    assert te.normalize_only_kinds([]) == []
    assert te.normalize_only_kinds(None) == []
    assert te.normalize_only_kinds("grant") == []


def test_only_grants_queries_grants_with_the_typed_text(stubs):
    result = asyncio.run(te.explore_async("AI in health", only_kinds=["grant"]))

    assert stubs == [("search_grants", "AI in health")]
    assert result["tools_called"] == ["search_grants"]
    assert [s["kind"] for s in result["sections"]] == ["grant"]
    assert result["sections"][0]["items"][0]["title"] == "grant for AI in health"
    assert result["scope"]["topics"] == ["AI in health"]


def test_only_preprints_and_fda_are_reachable(stubs):
    result = asyncio.run(te.explore_async("KRAS lung cancer", only_kinds=["preprint", "approval"]))

    assert sorted(c[0] for c in stubs) == ["search_fda", "search_preprints"]
    assert sorted(s["kind"] for s in result["sections"]) == ["approval", "preprint"]


def test_pure_gene_question_runs_no_fda_label_search(stubs):
    result = asyncio.run(te.explore_async("KRAS lung", only_kinds=["preprint", "approval"]))

    assert [c[0] for c in stubs] == ["search_preprints"]
    approval = next(s for s in result["sections"] if s["kind"] == "approval")
    assert approval["items"] == [] and approval["empty_reason"] == "no_query"


def test_tools_and_datasets_scope_runs_both(stubs):
    result = asyncio.run(te.explore_async("single cell", only_kinds=["tool", "dataset"]))

    assert sorted(s["kind"] for s in result["sections"]) == ["dataset", "tool"]


def test_unknown_kinds_fall_back_to_normal_routing(monkeypatch):
    seen = {}

    async def fake_uncached(input_text, scope_terms, since_year, status_filter):
        seen["normal"] = True
        return {"input": input_text, "scope": {}, "tools_called": [], "sections": []}

    monkeypatch.setattr(te, "_explore_uncached", fake_uncached)
    asyncio.run(te.explore_async("unknown-kind query", only_kinds=["nope"]))
    assert seen == {"normal": True}


def test_blank_input_ignores_only_kinds(monkeypatch):
    seen = {}

    async def fake_uncached(input_text, scope_terms, since_year, status_filter):
        seen["landing"] = True
        return {"input": "", "scope": {}, "tools_called": [], "sections": []}

    monkeypatch.setattr(te, "_explore_uncached", fake_uncached)
    asyncio.run(te.explore_async("", only_kinds=["grant"]))
    assert seen == {"landing": True}


def test_different_kind_sets_are_cached_separately(stubs):
    asyncio.run(te.explore_async("cache probe topic", only_kinds=["grant"]))
    asyncio.run(te.explore_async("cache probe topic", only_kinds=["preprint"]))
    assert sorted(c[0] for c in stubs) == ["search_grants", "search_preprints"]


# ── per-source filters (#60 grants, #61 trials) ──────────────────────────────


def test_normalize_source_filters_keeps_only_valid_values():
    assert te.normalize_source_filters({
        "grant_open_only": True, "grant_agencies": ["nih", " NSF ", ""], "grant_sort": "deadline",
        "trial_location": "  Alabama ", "input": "ignored",
    }) == {"grant_open_only": True, "grant_agencies": ["NIH", "NSF"], "grant_sort": "deadline",
           "trial_location": "Alabama"}
    assert te.normalize_source_filters({
        "grant_open_only": "yes", "grant_agencies": 5, "grant_sort": "relevance", "trial_location": "  ",
    }) == {}
    assert te.normalize_source_filters({"grant_agencies": "NIH"}) == {"grant_agencies": ["NIH"]}
    assert te.normalize_source_filters(None) == {}


@pytest.fixture
def kw_stubs(monkeypatch):
    calls: list[tuple[str, str, dict]] = []

    def make(name, kind):
        async def fn(query, *args, **kwargs):
            calls.append((name, query, kwargs))
            return [_item(kind, f"{kind} for {query}")]
        return fn

    def outage(*a, **k):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(te, "search_grants_async", make("search_grants", "grant"))
    monkeypatch.setattr(te, "search_trials_async", make("search_trials", "trial"))
    monkeypatch.setattr(te, "_extract_scope", outage)
    return calls


def _filter_kwargs(kwargs: dict) -> dict:
    return {k: v for k, v in kwargs.items() if k in ("open_only", "agencies", "sort", "location")}


def test_only_grants_with_filters_forwards_them(kw_stubs):
    asyncio.run(te.explore_async(
        "drug discovery", only_kinds=["grant"],
        source_filters={"grant_open_only": True, "grant_agencies": ["NIH"], "grant_sort": "deadline"},
    ))
    assert [(n, q, _filter_kwargs(k)) for n, q, k in kw_stubs] == [
        ("search_grants", "drug discovery", {"open_only": True, "agencies": ["NIH"], "sort": "deadline"})]


def test_only_trials_with_location_forwards_it(kw_stubs):
    asyncio.run(te.explore_async("tnbc", only_kinds=["trial"], source_filters={"trial_location": "Alabama"}))
    assert kw_stubs[0][2]["location"] == "Alabama"


def test_filtered_and_unfiltered_searches_are_cached_separately(kw_stubs):
    asyncio.run(te.explore_async("filter cache probe", only_kinds=["grant"]))
    asyncio.run(te.explore_async("filter cache probe", only_kinds=["grant"],
                                 source_filters={"grant_open_only": True}))
    asyncio.run(te.explore_async("filter cache probe", only_kinds=["grant"],
                                 source_filters={"grant_open_only": True}))
    assert [_filter_kwargs(c[2]) for c in kw_stubs] == [{}, {"open_only": True}]


def test_routed_search_passes_filters_to_grants_and_trials(monkeypatch):
    seen = {}

    async def fake_grants(query, limit=20, **kwargs):
        seen["grants"] = kwargs
        return []

    async def fake_trials(query, limit=20, **kwargs):
        seen["trials"] = kwargs
        return []

    monkeypatch.setattr(te, "search_grants_async", fake_grants)
    monkeypatch.setattr(te, "search_trials_async", fake_trials)
    scope = {**te._EMPTY_SCOPE, "diseases": ["breast cancer"]}
    asyncio.run(te._execute(
        ["search_grants", "search_trials"], scope,
        source_filters={"grant_open_only": True, "trial_location": "Alabama"},
    ))
    assert seen["grants"]["open_only"] is True
    assert seen["trials"]["location"] == "Alabama"
