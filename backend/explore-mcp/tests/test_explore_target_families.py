"""
tests/test_explore_target_families.py — target-family searches ("GPCR") and
source errors on Explore.

A family is many targets, not one gene: it goes in scope["families"], turns on
trials, grants and GEO with one OR query over its spellings, and never reaches
ChEMBL / Open Targets as a single target. FDA is not searched for a pure target
query and the section says so. "KRAS pancreatic cancer" must make exactly the
calls it made before this change (pinned below from a run of the previous
code with the same stubs).

The LLM scope and route stubs return what the live service returned for these
searches on 2026-11-18: GPCR filed under topics, never genes.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402
import tools.search_trials as st  # noqa: E402
from tools import query_intent as qi  # noqa: E402

GPCR = "GPCR"
QUESTION = "I have a target that is a GPCR. What companies can serve me today?"
KRAS_PDAC = "KRAS pancreatic cancer"

GPCR_OR = '"G protein-coupled receptor" OR GPCR OR GPCRs OR "G-protein coupled receptor"'

LLM_SCOPES = {
    GPCR: {"topics": ["GPCR"], "genes": [], "diseases": [], "assets": [], "methods": []},
    QUESTION: {"topics": ["GPCR research"], "genes": [], "diseases": [], "assets": [], "methods": []},
    KRAS_PDAC: {"topics": ["KRAS", "pancreatic cancer"], "genes": ["KRAS"], "diseases": ["pancreatic cancer"],
                "assets": [], "methods": []},
    # An LLM that files the family as a gene: must still not reach ChEMBL.
    "GPCR agonists": {"topics": ["GPCR agonists"], "genes": ["GPCR"], "diseases": [], "assets": [], "methods": []},
}
LLM_ROUTES = {
    GPCR: ["search_papers", "search_preprints", "search_opentargets", "search_news"],
    QUESTION: ["search_news", "search_people", "search_lab_resources", "search_papers", "search_preprints"],
    KRAS_PDAC: ["search_papers", "search_preprints", "search_trials", "search_fda", "search_grants",
                "search_datasets", "search_pager", "search_chembl", "search_opentargets",
                "search_people", "search_wiki", "search_lab_resources"],
    "GPCR agonists": ["search_papers", "search_chembl", "search_opentargets"],
}


class _item:
    def __init__(self, kind: str, title: str, summary: str = ""):
        self._d = {"id": f"{kind}:{title}", "kind": kind, "title": title, "summary": summary, "raw": {}}

    def model_dump(self):
        return dict(self._d)


@pytest.fixture
def calls(monkeypatch):
    """Stub the LLM steps and every source; record (source, args, kwargs)."""
    seen: list[tuple] = []
    monkeypatch.setattr(te, "_extract_scope", lambda text: dict(LLM_SCOPES[text]))
    monkeypatch.setattr(te, "_choose_tools", lambda text, scope: (list(LLM_ROUTES[text]), "stub"))

    def recorder(name):
        async def f(*a, **k):
            seen.append((name, a, k))
            return [_item(name, f"{name} hit")]
        return f

    def recorder_sync(name):
        def f(*a, **k):
            seen.append((name, a, k))
            return [_item(name, f"{name} hit")]
        return f

    async def papers(queries, **k):
        seen.append(("papers", tuple(queries), k))
        return [_item("paper", "p")], [_item("paper", "p")]

    async def no_abstracts(*a, **k):
        return None

    for name in ["search_trials_async", "search_trials_with_gene_async", "search_fda_async",
                 "search_grants_async", "search_datasets_async", "search_pager_async",
                 "search_chembl_async", "search_opentargets_async", "search_news_async",
                 "search_tools_async", "search_preprints_async"]:
        monkeypatch.setattr(te, name, recorder(name))
    for name in ["search_lab_resources", "search_people", "search_wiki"]:
        monkeypatch.setattr(te, name, recorder_sync(name))
    monkeypatch.setattr(te, "search_papers_multi_dual_async", papers)
    monkeypatch.setattr(te, "attach_abstract_excerpts", no_abstracts)
    return seen


def _explore(text, **kw):
    return asyncio.run(te.explore_async(text, **kw))


def _called(seen, name):
    return [(a, k) for n, a, k in seen if n == name]


def _section(result, kind):
    return next(s for s in result["sections"] if s["kind"] == kind)


# ── the deterministic reading ────────────────────────────────────────────────


@pytest.mark.parametrize("text", ["GPCR", "gpcrs", "G-protein coupled receptors", "G protein-coupled receptor", QUESTION])
def test_every_gpcr_spelling_is_a_family_never_a_gene(text):
    scope = qi.parse(text).scope
    assert scope["families"] == ["G protein-coupled receptor"]
    assert scope["genes"] == []


def test_ion_channel_is_a_family_and_kinase_is_left_alone():
    assert qi.parse("ion channels in pain").scope["families"] == ["ion channel"]
    scope = qi.parse("BTK kinase inhibitor").scope
    assert scope["families"] == [] and scope["genes"] == ["BTK"]


def test_family_query_quotes_phrases_and_ors_every_spelling():
    assert qi.family_query(["G protein-coupled receptor"]) == GPCR_OR
    assert qi.family_query(["ion channel"]) == '"ion channel" OR "ion channels"'


def test_refine_scope_moves_an_llm_gene_family_out_of_genes_and_keeps_the_topic():
    out = qi.refine_scope(dict(LLM_SCOPES["GPCR agonists"]), qi.parse("GPCR agonists"))
    assert out["genes"] == [] and out["families"] == ["G protein-coupled receptor"]
    assert out["topics"]                       # papers still have something to search


def test_refine_scope_has_no_families_key_without_a_family():
    out = qi.refine_scope(dict(LLM_SCOPES[KRAS_PDAC]), qi.parse(KRAS_PDAC))
    assert "families" not in out


# ── routed Explore: "GPCR" and the full question ─────────────────────────────


@pytest.mark.parametrize("text", [GPCR, QUESTION])
def test_family_search_runs_trials_grants_and_datasets_on_the_or_query(calls, text):
    result = _explore(text)

    assert result["scope"]["families"] == ["G protein-coupled receptor"]
    assert result["scope"]["genes"] == []
    # Trials: free text (no disease), the OR query, no status filter.
    assert _called(calls, "search_trials_async") == [((GPCR_OR, 10), {"status_filter": None, "condition_only": False})]
    # Grants: the OR query with NO title rule (it is for disease/gene names).
    assert _called(calls, "search_grants_async") == [((GPCR_OR, 10), {"must_mention": None})]
    assert _called(calls, "search_datasets_async") == [((GPCR_OR, 10), {})]
    for kind in ("trial", "grant", "dataset"):
        section = _section(result, kind)
        assert section["query"] == GPCR_OR and section["items"]


@pytest.mark.parametrize("text", [GPCR, QUESTION])
def test_family_search_never_looks_the_family_up_as_one_target(calls, text):
    result = _explore(text)
    assert _called(calls, "search_chembl_async") == []
    assert _called(calls, "search_opentargets_async") == []
    assert "search_opentargets" not in result["tools_called"]


def test_an_llm_that_files_gpcr_as_a_gene_still_reaches_no_single_target_source(calls):
    result = _explore("GPCR agonists")
    assert result["scope"]["genes"] == [] and result["scope"]["families"] == ["G protein-coupled receptor"]
    assert _called(calls, "search_chembl_async") == []
    assert _called(calls, "search_opentargets_async") == []


@pytest.mark.parametrize("text", [GPCR, QUESTION])
def test_fda_is_not_searched_for_a_family_and_the_section_says_why(calls, text):
    result = _explore(text)
    assert _called(calls, "search_fda_async") == []
    approval = _section(result, "approval")
    assert approval["items"] == []
    assert approval["empty_reason"] == "not_searched"
    assert approval["not_searched"] == "FDA labels list diseases, not targets"
    assert "error" not in approval


# ── "KRAS pancreatic cancer": exactly as before ──────────────────────────────


def test_kras_pancreatic_cancer_makes_exactly_the_previous_calls(calls):
    result = _explore(KRAS_PDAC)

    assert "families" not in result["scope"]
    assert result["scope"]["genes"] == ["KRAS"]
    assert result["scope"]["diseases"] == ["pancreatic cancer"]
    # Pinned from the previous code run with these same stubs.
    expected = sorted([
        ("papers", (KRAS_PDAC,), {"limit_per_query": 10, "final_limit": 10, "since_year": None}),
        ("search_chembl_async", ("KRAS", 10), {}),
        ("search_datasets_async", ("KRAS", 10), {}),
        ("search_fda_async", ("pancreatic cancer", 10), {"by": "indication"}),
        ("search_grants_async", ("pancreatic cancer KRAS", 10), {"must_mention": ["pancreatic cancer", "KRAS"]}),
        ("search_lab_resources", ("KRAS", None, 20), {}),
        ("search_news_async", (KRAS_PDAC, 10), {"match": True}),
        ("search_opentargets_async", ("KRAS", 10), {"disease": "pancreatic cancer"}),
        ("search_pager_async", ("KRAS", 10), {}),
        ("search_people", ("pancreatic cancer", 20), {}),
        ("search_preprints_async", ('"pancreatic cancer" AND KRAS', 10), {}),
        ("search_trials_with_gene_async", ("pancreatic cancer", "KRAS", 10), {"status_filter": None}),
        ("search_wiki", (KRAS_PDAC, 20), {}),
    ], key=repr)
    assert sorted(calls, key=repr) == expected
    approval = _section(result, "approval")
    assert "not_searched" not in approval and approval["items"]


# ── the relevance gate (only_kinds path) accepts family spellings ────────────


def test_trial_gate_keeps_trials_naming_any_gpcr_spelling(monkeypatch):
    monkeypatch.setattr(te, "_extract_scope", lambda text: dict(LLM_SCOPES[text]))
    named = [
        _item("trial", "GPCR agonist in obesity"),
        _item("trial", "Biased ligands", "Targets G protein-coupled receptors in the gut"),
        _item("trial", "GPCRs and pain"),
    ]
    unrelated = _item("trial", "Hernia repair outcomes", "Abdominal wall reconstruction")
    seen = []

    async def trials(query, limit=20, status_filter=None, condition_only=False, **kw):
        seen.append(query)
        return [*named, unrelated]

    monkeypatch.setattr(te, "search_trials_async", trials)
    result = asyncio.run(te.explore_async(GPCR, only_kinds=["trial"]))

    trial = _section(result, "trial")
    assert seen == [GPCR_OR]
    assert [i["title"] for i in trial["items"]] == [i.model_dump()["title"] for i in named]
    assert trial["filtered_out"] == 1


# ── source errors are reported, not shown as empty ───────────────────────────


def test_a_failing_source_raises_from_its_wrapper_and_is_not_cached(monkeypatch):
    attempts = []

    async def broken(*a, **k):
        attempts.append(1)
        raise RuntimeError("ClinicalTrials.gov 503")

    monkeypatch.setattr(st, "fetch_trials", broken)
    with pytest.raises(RuntimeError):
        asyncio.run(st.search_trials_async("glioblastoma", 5))
    with pytest.raises(RuntimeError):
        asyncio.run(st.search_trials_async("glioblastoma", 5))
    assert len(attempts) == 2                  # the failure was not cached as []


def test_an_empty_result_is_still_cached_briefly(monkeypatch):
    from cache import TTL_EMPTY, cache, normalize_key

    async def nothing(*a, **k):
        return []

    monkeypatch.setattr(st, "fetch_trials", nothing)
    assert asyncio.run(st.search_trials_async("nothing at all", 5)) == []
    entry = asyncio.run(cache._load(normalize_key("trials:5::term", "nothing at all")))
    assert entry is not None and entry.ttl == TTL_EMPTY


def test_a_failing_source_is_a_source_error_section(monkeypatch):
    monkeypatch.setattr(te, "_extract_scope", lambda text: dict(LLM_SCOPES[text]))

    async def broken(*a, **k):
        raise RuntimeError("Grants.gov 502")

    monkeypatch.setattr(te, "search_grants_async", broken)
    result = asyncio.run(te.explore_async(GPCR, only_kinds=["grant"]))
    grant = _section(result, "grant")
    assert grant["items"] == []
    assert grant["error"].startswith("RuntimeError")
    assert grant["empty_reason"] == "source_error"
