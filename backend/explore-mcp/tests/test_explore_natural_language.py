"""
tests/test_explore_natural_language.py — natural-language questions on the
`only_kinds` path (issue #76).

Regression tests built from the 2026-11-17 usability study's failing queries.
Upstreams are stubbed to behave like the real sources did: a strict matcher
that returns nothing (or something unrelated) for a whole sentence and the
right records for the entity. The LLM scope call is stubbed too; by default it
echoes the sentence back as one topic, which is what production returned.
"""

from __future__ import annotations

import asyncio
import datetime
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402
from tools import query_intent as qi  # noqa: E402


class _item:
    def __init__(self, kind: str, title: str, summary: str = "", raw: dict | None = None):
        self._d = {"id": f"{kind}:{title}", "kind": kind, "title": title,
                   "summary": summary, "raw": raw or {}}

    def model_dump(self):
        return dict(self._d)


ALS_TRIAL = _item("trial", "Tofersen in SOD1 ALS", "Amyotrophic lateral sclerosis study")
OCD_TRIAL = _item("trial", "Deep brain stimulation for OCD", "Obsessive-compulsive disorder")
KRAS_TRIAL = _item("trial", "Sotorasib in KRAS G12C NSCLC", "KRAS G12C mutated tumours")
TNBC_TRIAL = _item("trial", "Sacituzumab in TNBC", "Triple-negative breast cancer, metastatic")
PCSK9_TRIAL = _item("trial", "MK-0616 lipid lowering", "An oral PCSK9 inhibitor in hypercholesterolemia")
SURGERY_TRIAL = _item("trial", "Abdominal wall reconstruction", "Hernia repair outcomes")
SOTORASIB = _item("approval", "LUMAKRAS (sotorasib)", "KRAS G12C-mutated NSCLC")
ADMET_TOOL = _item("tool", "admet-ai", "ADMET prediction with graph neural networks")
PAPER = _item("paper", "A paper", "abstract")
OFF_TOPIC_NEWS = _item("news", "Lilly signs obesity deal", "Big pharma news")


@pytest.fixture
def env(monkeypatch):
    """Stub every upstream. `calls` records (source, query, extras)."""
    calls: list[tuple] = []
    extract_calls: list[str] = []

    def echo_scope(text):
        extract_calls.append(text)
        return {"topics": [text], "genes": [], "diseases": [], "assets": [], "methods": []}

    monkeypatch.setattr(te, "_extract_scope", echo_scope)

    def no_routing(*a, **k):
        raise AssertionError("the router must not run for only_kinds")

    monkeypatch.setattr(te, "_choose_tools", no_routing)

    async def trials(query, limit=20, status_filter=None, condition_only=False, **kw):
        calls.append(("trials", query, {"status": status_filter, "cond": condition_only}))
        q = query.lower()
        if q == "amyotrophic lateral sclerosis" and condition_only:
            return [ALS_TRIAL] if status_filter else [ALS_TRIAL, OCD_TRIAL]
        if q == "triple-negative breast cancer" and condition_only:
            return [TNBC_TRIAL]
        if q == "kras g12c" and not condition_only:
            return [KRAS_TRIAL]
        if q == "pcsk9" and not condition_only:
            return [PCSK9_TRIAL, SURGERY_TRIAL]
        if "als" in q.split():
            return [OCD_TRIAL]          # the study's verbatim-sentence result
        return []                       # strict matcher: whole sentences match nothing

    async def trials_with_gene(condition, gene, limit=20, status_filter=None):
        calls.append(("trials_gene", condition, {"gene": gene, "status": status_filter}))
        return await trials(condition, limit, status_filter, condition_only=True)

    async def fda(query, limit=20, by="indication"):
        calls.append(("fda", query, {"by": by}))
        return [SOTORASIB] if query.lower() == "kras g12c" else []

    async def preprints(query, limit=20):
        calls.append(("preprints", query, {}))
        return [_item("preprint", f"preprint on {query}", query)] if len(query.split()) <= 3 else []

    async def papers(queries, limit_per_query=10, final_limit=10, since_year=None):
        calls.append(("papers", tuple(queries), {"since_year": since_year}))
        return [PAPER], [PAPER]

    async def news(query, limit=20, match=True):
        calls.append(("news", query, {}))
        return [OFF_TOPIC_NEWS]

    async def tools_(query, limit=20):
        calls.append(("tools", query, {}))
        return [ADMET_TOOL] if query.lower() == "admet prediction" else []

    async def datasets(query, limit=20):
        calls.append(("datasets", query, {}))
        return []

    monkeypatch.setattr(te, "search_trials_async", trials)
    monkeypatch.setattr(te, "search_trials_with_gene_async", trials_with_gene)
    monkeypatch.setattr(te, "search_fda_async", fda)
    monkeypatch.setattr(te, "search_preprints_async", preprints)
    monkeypatch.setattr(te, "search_papers_multi_dual_async", papers)
    monkeypatch.setattr(te, "search_news_async", news)
    monkeypatch.setattr(te, "search_tools_async", tools_)
    monkeypatch.setattr(te, "search_datasets_async", datasets)
    return {"calls": calls, "extract": extract_calls}


def _run(text, kinds, **kw):
    return asyncio.run(te.explore_async(text, only_kinds=kinds, **kw))


def _section(result, kind):
    return next(s for s in result["sections"] if s["kind"] == kind)


def _queries(calls, source):
    return [c[1] for c in calls if c[0] == source]


# ── the study's failing queries ──────────────────────────────────────────────


def test_als_trials_recruiting_now(env):
    result = _run("ALS clinical trials recruiting now", ["trial"])

    trial = _section(result, "trial")
    assert [i["title"] for i in trial["items"]] == ["Tofersen in SOD1 ALS"]
    assert "empty_reason" not in trial
    assert env["calls"] == [("trials", "amyotrophic lateral sclerosis",
                             {"status": ["RECRUITING", "NOT_YET_RECRUITING"], "cond": True})]
    interp = result["interpreted"]
    assert interp["entities"] == ["amyotrophic lateral sclerosis"]
    assert interp["filters"][0]["key"] == "status" and interp["filters"][0]["from_text"] is True
    assert interp["label"] == "amyotrophic lateral sclerosis · Recruiting"
    assert interp["showing_results_for"] is None


def test_covalent_kras_g12c_competitive_landscape(env):
    result = _run("covalent KRAS G12C inhibitors competitive landscape",
                  ["approval", "trial", "paper", "preprint"])

    trial = _section(result, "trial")
    assert [i["title"] for i in trial["items"]] == ["Sotorasib in KRAS G12C NSCLC"]
    assert trial["fallback_query"] == "KRAS G12C"
    approval = _section(result, "approval")
    assert [i["title"] for i in approval["items"]] == ["LUMAKRAS (sotorasib)"]
    assert _section(result, "paper")["items"]
    assert _section(result, "preprint")["items"]
    assert result["interpreted"]["showing_results_for"] == "KRAS G12C"
    assert result["interpreted"]["entities"] == ["KRAS G12C"]
    # Exactly one fallback per empty section, never a loop.
    assert len(_queries(env["calls"], "trials")) == 2
    assert len(_queries(env["calls"], "fda")) == 1
    assert all("landscape" not in str(c[1]) for c in env["calls"])


def test_admet_prediction_tools_and_databases(env):
    result = _run("ADMET prediction tools and databases", ["tool", "dataset"])

    assert _queries(env["calls"], "tools") == ["ADMET prediction"]
    assert [i["title"] for i in _section(result, "tool")["items"]] == ["admet-ai"]
    # A software question with no data words: GEO is not searched (issue #68).
    dataset = _section(result, "dataset")
    assert dataset["items"] == [] and dataset["empty_reason"] == "tool_query"
    assert _queries(env["calls"], "datasets") == []
    assert "fallback_query" not in dataset   # the entity IS the query; nothing shorter to try


def test_recruiting_tnbc_trials_in_alabama(env):
    result = _run("recruiting triple-negative breast cancer trials in Alabama", ["trial"])

    trial = _section(result, "trial")
    assert [i["title"] for i in trial["items"]] == ["Sacituzumab in TNBC"]
    assert env["calls"][0] == ("trials", "triple-negative breast cancer",
                               {"status": ["RECRUITING", "NOT_YET_RECRUITING"], "cond": True})
    interp = result["interpreted"]
    assert interp["not_applied"] == ["location: Alabama"]
    assert interp["label"] == "triple-negative breast cancer · Recruiting"


def test_oral_pcsk9_inhibitors_competitive_landscape(env):
    result = _run("oral PCSK9 inhibitors competitive landscape", ["paper", "trial", "approval", "news"])

    trial = _section(result, "trial")
    # The fallback found two trials; the gate dropped the one that never names PCSK9.
    assert [i["title"] for i in trial["items"]] == ["MK-0616 lipid lowering"]
    assert trial["fallback_query"] == "PCSK9"
    assert trial["filtered_out"] == 1
    # A pure gene/target question runs no label search (issue #65): label
    # indications name diseases, not targets.
    approval = _section(result, "approval")
    assert approval["items"] == [] and approval["empty_reason"] == "no_query"
    assert approval["note"]["url"].startswith("https://www.accessdata.fda.gov/")
    assert _queries(env["calls"], "fda") == []
    news = _section(result, "news")
    assert news["items"] == [] and news["empty_reason"] == "off_topic_filtered"
    assert _section(result, "paper")["items"]          # papers are never gated
    assert result["interpreted"]["entities"] == ["PCSK9"]


# ── behaviour around the fix ─────────────────────────────────────────────────


def test_one_llm_call_per_uncached_question_shared_with_routed_path(env, monkeypatch):
    _run("ALS clinical trials recruiting now", ["trial"])
    _run("ALS clinical trials recruiting now", ["paper"])
    assert env["extract"] == ["ALS clinical trials recruiting now"]

    monkeypatch.setattr(te, "_choose_tools", lambda text, scope: (["search_trials"], "stub"))
    asyncio.run(te.explore_async("ALS clinical trials recruiting now"))
    assert len(env["extract"]) == 1


def test_llm_scope_is_used_and_cleaned(env, monkeypatch):
    def llm_scope(text):
        return {"topics": ["ALS clinical trials"], "genes": [], "diseases": ["ALS"],
                "assets": [], "methods": []}

    monkeypatch.setattr(te, "_extract_scope", llm_scope)
    result = _run("ALS clinical trials recruiting now", ["trial"])
    assert result["interpreted"]["scope_source"] == "llm"
    assert result["scope"]["diseases"] == ["amyotrophic lateral sclerosis"]
    assert result["scope"]["topics"] == []
    assert _queries(env["calls"], "trials") == ["amyotrophic lateral sclerosis"]


def test_llm_failure_falls_back_to_deterministic_parse(env, monkeypatch):
    def down(text):
        raise RuntimeError("groq down")

    monkeypatch.setattr(te, "_extract_scope", down)
    result = _run("ALS clinical trials recruiting now", ["trial"])
    assert result["interpreted"]["scope_source"] == "deterministic"
    assert [i["title"] for i in _section(result, "trial")["items"]] == ["Tofersen in SOD1 ALS"]


def test_slow_llm_is_capped(env, monkeypatch):
    def slow(text):
        time.sleep(0.5)
        return {"topics": [], "genes": ["SOD1"], "diseases": [], "assets": [], "methods": []}

    monkeypatch.setattr(te, "_extract_scope", slow)
    monkeypatch.setattr(te, "_ONLY_SCOPE_TIMEOUT", 0.05)

    async def timed():
        started = time.monotonic()
        out = await te.explore_async("ALS clinical trials recruiting now", only_kinds=["trial"])
        return out, time.monotonic() - started

    # Timed inside the loop: asyncio.run itself waits for the abandoned thread.
    result, elapsed = asyncio.run(timed())
    assert elapsed < 0.45
    assert result["interpreted"]["scope_source"] == "deterministic"


def test_flag_off_skips_the_llm(env, monkeypatch):
    monkeypatch.setenv("EXPLORE_ONLY_SCOPE_LLM", "0")
    result = _run("ALS clinical trials recruiting now", ["trial"])
    assert env["extract"] == []
    assert result["interpreted"]["scope_source"] == "deterministic"


def test_caller_status_filter_wins_over_text(env):
    result = _run("ALS clinical trials recruiting now", ["trial"], status_filter=["COMPLETED"])
    assert env["calls"][0][2]["status"] == ["COMPLETED"]
    assert result["interpreted"]["filters"][0]["from_text"] is False


def test_newest_papers_sets_recency(env):
    result = _run("newest papers on KRAS G12D inhibitors", ["paper", "preprint"])
    since = datetime.date.today().year - 1
    papers_call = next(c for c in env["calls"] if c[0] == "papers")
    assert papers_call[2]["since_year"] == since
    assert all("newest" not in " ".join(c[1]).lower() for c in env["calls"] if c[0] == "papers")
    assert result["interpreted"]["label"] == f"KRAS G12D · Newest (since {since})"


def test_status_words_without_trials_kind_are_reported_not_applied(env):
    result = _run("recruiting ALS studies", ["paper"])
    assert result["interpreted"]["not_applied"] == ["status: Recruiting"]
    assert result["interpreted"]["filters"] == []


def test_response_changes_are_additive(env):
    result = _run("ALS clinical trials recruiting now", ["trial"])
    for key in ("input", "scope", "tools_called", "reasoning", "sections"):
        assert key in result
    assert set(te.SCOPE_KEYS) <= set(result["scope"])
    assert result["scope"]["is_default"] is False
    assert "_raw_input" not in result["scope"]
    for s in result["sections"]:
        assert {"tool", "kind", "query", "items"} <= set(s)


# ── deterministic parser ─────────────────────────────────────────────────────


def test_parser_abbreviations_are_case_sensitive_and_pd1_is_a_gene():
    assert qi.parse("PD-1 inhibitors in NSCLC").scope["genes"] == ["PD-1"]
    assert qi.parse("PD-1 inhibitors in NSCLC").scope["diseases"] == ["non-small cell lung cancer"]
    assert qi.parse("tau in AD").scope["diseases"] == ["Alzheimer's disease"]
    assert qi.parse("ad campaigns").scope["diseases"] == []


def test_parser_reads_status_and_approval_words():
    assert qi.parse("completed trials of semaglutide").status_filter == ["COMPLETED"]
    assert qi.parse("active trials for GBM").status_label == "Active"
    assert qi.parse("biologically active compounds").status_filter == []
    intent = qi.parse("FDA-approved drugs for TNBC")
    assert intent.approved and intent.scope["diseases"] == ["triple-negative breast cancer"]


def test_gate_accepts_aliases():
    intent = qi.parse("ALS trials")
    groups = qi.gate_terms(intent.scope, intent)
    assert qi.mentions_any({"title": "A study in ALS", "summary": ""}, groups)
    assert not qi.mentions_any({"title": "OCD study", "summary": ""}, groups)


@pytest.mark.parametrize("text,expected", [
    ("drug discovery", "drug discovery"),
    ("drug repurposing", "drug repurposing"),
    ("target discovery", "target discovery"),
    ("drug development papers", "drug development"),
    ("recruiting drug discovery trials", "drug discovery"),
    ("KRAS drugs", "KRAS"),
    ("drugs for obesity", "obesity"),
])
def test_parser_keeps_drug_as_part_of_a_field_name(text, expected):
    assert qi.parse(text).core == expected


def test_no_llm_path_searches_drug_discovery_as_typed(env, monkeypatch):
    def down(text):
        raise RuntimeError("groq down")

    monkeypatch.setattr(te, "_extract_scope", down)
    result = _run("drug discovery", ["paper"])
    assert result["interpreted"]["scope_source"] == "deterministic"
    assert result["interpreted"]["entities"] == ["drug discovery"]
    assert _section(result, "paper")["query"] == "drug discovery"
