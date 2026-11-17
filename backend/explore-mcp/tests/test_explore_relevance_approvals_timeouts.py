"""
tests/test_explore_relevance_approvals_timeouts.py — usability-study fixes:

  #59 verbatim abstract excerpts (one batched, cached efetch; OpenAlex abstract
      from the works call) and the "Most relevant" order of typed searches;
  #65 approvals: drug-name lookup, no label search for a pure gene question,
      distinctive tokens boost but never filter, indication first sentence,
      the Drugs@FDA lag note;
  #67 per-source caps and the whole-request deadline, "timed_out" sections,
      the no-LLM popular-topic prewarm;
  #68 GitHub license/language/topics/pushed_at through the egress allow-list,
      and no GEO datasets for a software question without data words.
"""

from __future__ import annotations

import asyncio
import os
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import prewarm  # noqa: E402
import tools.abstracts as abstracts  # noqa: E402
import tools.explore as te  # noqa: E402
from models import Item  # noqa: E402
from response import trim_item  # noqa: E402
from sources.github import fetch_github  # noqa: E402
from sources.openalex import fetch_openalex  # noqa: E402
from sources.openfda import fetch_fda_approvals, first_sentence  # noqa: E402
from tools.search_fda import boost_distinctive  # noqa: E402


def _paper(pid: str, title: str, raw: dict | None = None, summary: str = "Published in J. A, B") -> dict:
    return {"id": pid, "kind": "paper", "title": title, "summary": summary, "raw": raw or {}}


# ── #59 abstract excerpts ─────────────────────────────────────────────────────


def test_excerpt_is_verbatim_whole_sentences_or_a_word_cut():
    text = "First sentence here. " + "Second sentence is long " * 20
    assert abstracts.excerpt(text, 36) == "First sentence here."
    one = "word " * 100
    cut = abstracts.excerpt(one, 50)
    assert cut.endswith("…") and one.startswith(cut[:-1])
    assert abstracts.excerpt("  short  text ") == "short text"
    assert abstracts.excerpt(None) is None and abstracts.excerpt("") is None


def test_excerpts_use_openalex_raw_and_one_batched_efetch(monkeypatch):
    calls: list[list[str]] = []

    async def efetch(pmids):
        calls.append(list(pmids))
        return {"111": "PubMed abstract for one. More text.", "222": "PubMed abstract two."}

    monkeypatch.setattr(abstracts, "_pubmed_abstracts_uncached", efetch)
    latest = [
        _paper("pubmed:222", "B"),
        _paper("openalex:W1", "A", raw={"abstract": "OpenAlex abstract text."}),
        _paper("crossref:x", "C"),
    ]
    key = [_paper("pubmed:111", "D"), _paper("pubmed:222", "B")]
    asyncio.run(abstracts.attach_abstract_excerpts(latest, key))

    assert calls == [["111", "222"]]                     # one call, both ids, sorted
    assert latest[0]["abstract"] == "PubMed abstract two."
    assert latest[1]["abstract"] == "OpenAlex abstract text."
    assert "abstract" not in latest[2]                   # falls back to its summary
    assert latest[2]["summary"] == "Published in J. A, B"
    assert key[0]["abstract"] == "PubMed abstract for one. More text."

    # Same id set again: served from the cache, no second call.
    again = [_paper("pubmed:111", "D"), _paper("pubmed:222", "B")]
    asyncio.run(abstracts.attach_abstract_excerpts(again))
    assert len(calls) == 1 and again[0]["abstract"]


def test_efetch_failure_leaves_the_summary(monkeypatch):
    async def down(pmids):
        raise RuntimeError("eutils down")

    monkeypatch.setattr(abstracts, "_pubmed_abstracts_uncached", down)
    items = [_paper("pubmed:1", "A")]
    asyncio.run(abstracts.attach_abstract_excerpts(items))
    assert "abstract" not in items[0] and items[0]["summary"] == "Published in J. A, B"


class _JsonClient:
    def __init__(self, payload):
        self.payload = payload
        self.urls: list[str] = []

    async def get(self, url, headers=None, timeout=None):
        self.urls.append(url)

        class R:
            status_code = 200
            text = ""

            def json(_self):
                return self.payload

            def raise_for_status(_self):
                return None

        return R()


def test_openalex_rebuilds_the_abstract_and_drops_the_inverted_index():
    work = {
        "id": "https://openalex.org/W9", "title": "KRAS mutations in lung cancer", "publication_date": "2025-01-01",
        "abstract_inverted_index": {"KRAS": [0], "drives": [1], "tumours.": [2]},
    }
    client = _JsonClient({"results": [work]})
    items = asyncio.run(fetch_openalex(client, "kras", 5))
    assert "abstract_inverted_index" in client.urls[0]
    assert items[0].raw["abstract"] == "KRAS drives tumours."
    assert "abstract_inverted_index" not in items[0].raw


# ── #59 "Most relevant" ───────────────────────────────────────────────────────


def test_relevance_order_ranks_by_term_overlap_and_drops_nothing():
    latest = [
        _paper("p:1", "Herbal ethnopharmacology"),
        _paper("p:2", "Yeast platforms", raw={"abstract": "A CRISPR screen in yeast."}),
        _paper("p:3", "CRISPR screen for drug target discovery"),
        _paper("p:4", "Zebrafish model"),
    ]
    key = [latest[3], latest[0], latest[1], latest[2]]
    out = te._relevance_order(latest, key, "CRISPR screen drug target discovery papers")
    assert [i["id"] for i in out] == ["p:3", "p:2", "p:4", "p:1"]   # ties keep the Key order
    assert len(out) == len(latest)


def test_papers_section_gets_items_relevant_for_typed_searches_only(monkeypatch):
    async def papers(queries, limit_per_query=10, final_limit=10, since_year=None):
        a = Item(id="openalex:W1", kind="paper", title="Zebrafish", source="openalex", dedupe_key="a")
        b = Item(id="openalex:W2", kind="paper", title="PHGDH in cancer", source="openalex", dedupe_key="b")
        return [a, b], [a, b]

    monkeypatch.setattr(te, "search_papers_multi_dual_async", papers)
    typed = {**te._EMPTY_SCOPE, "genes": ["PHGDH"], "_raw_input": "PHGDH cancer"}
    section = asyncio.run(te._execute(["search_papers"], typed))[0]
    assert [i["title"] for i in section["items"]] == ["Zebrafish", "PHGDH in cancer"]   # default unchanged
    assert [i["title"] for i in section["items_relevant"]] == ["PHGDH in cancer", "Zebrafish"]

    feed = {**te._DEFAULT_SCOPE, "is_default": True}
    section = asyncio.run(te._execute(["search_papers"], feed))[0]
    assert "items_relevant" not in section


# ── #65 approvals ─────────────────────────────────────────────────────────────


def _scope(**kw):
    return {**{k: [] for k in te.SCOPE_KEYS}, **kw}


def test_fda_plan():
    assert te._fda_plan(_scope(assets=["sotorasib"], diseases=["NSCLC"])) == ("drug", "sotorasib")
    assert te._fda_plan(_scope(diseases=["glioblastoma"])) == ("indication", "glioblastoma")
    assert te._fda_plan(_scope(genes=["KRAS"], _raw_input="KRAS G12C inhibitors")) == ("indication", "KRAS G12C")
    assert te._fda_plan(_scope(genes=["PCSK9"], _raw_input="oral PCSK9 inhibitors")) is None


def _approval(title, indication):
    return Item(id=f"openfda:{title}", kind="approval", title=title, source="openfda",
                dedupe_key=title, raw={"indication": indication})


def test_distinctive_tokens_boost_but_never_filter():
    items = [
        _approval("VECTIBIX", "wild-type RAS metastatic colorectal cancer"),
        _approval("KRAZATI", "KRAS G12C-mutated NSCLC"),
        _approval("LUMAKRAS", "KRAS G12C-mutated locally advanced NSCLC"),
    ]
    out = boost_distinctive(items, te._distinctive_tokens("KRAS G12C approvals"))
    assert [i.title for i in out] == ["KRAZATI", "LUMAKRAS", "VECTIBIX"]
    assert boost_distinctive(items, []) == items


class _FdaClient:
    def __init__(self):
        self.urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        self.urls.append(url)

        class R:
            status_code = 200

            def json(_self):
                if "label.json" in url:
                    return {"results": [{
                        "indications_and_usage": [
                            "1 INDICATIONS AND USAGE 1.1 LUMAKRAS is indicated for adults with KRAS "
                            "G12C-mutated NSCLC, as determined by an FDA-approved test. More text."
                        ],
                        "openfda": {"brand_name": ["LUMAKRAS"], "generic_name": ["SOTORASIB"],
                                    "application_number": ["NDA214665"], "manufacturer_name": ["Amgen"]},
                    }]}
                return {"results": [{"application_number": "NDA214665", "sponsor_name": "AMGEN",
                                     "submissions": [{"submission_type": "ORIG", "submission_status": "AP",
                                                      "submission_status_date": "20210528"}]}]}

            def raise_for_status(_self):
                return None

        return R()


def test_drug_name_lookup_and_indication_first_sentence():
    client = _FdaClient()
    items = asyncio.run(fetch_fda_approvals(client, "sotorasib", 10, by="drug"))
    label_url = unquote(client.urls[0])
    assert 'openfda.generic_name:"sotorasib"' in label_url and 'openfda.brand_name:"sotorasib"' in label_url
    assert "indications_and_usage" not in label_url
    assert len(client.urls) == 2                          # one label search + the batched dates
    assert items[0].raw["indication_first_sentence"] == (
        "LUMAKRAS is indicated for adults with KRAS G12C-mutated NSCLC, as determined by an FDA-approved test."
    )


def test_first_sentence_handles_abbreviations_and_length():
    assert first_sentence("Drug is indicated (e.g. adults). Then more.") == "Drug is indicated (e.g. adults)."
    long = "x " * 300
    assert first_sentence(long).endswith("…")
    assert first_sentence(None) is None


def test_approval_section_carries_the_lag_note(monkeypatch):
    async def fda(query, limit=20, by="indication"):
        return []

    monkeypatch.setattr(te, "search_fda_async", fda)
    section = asyncio.run(te._execute(["search_fda"], _scope(diseases=["glioblastoma"])))[0]
    assert "Drugs@FDA" in section["note"]["text"]
    assert section["note"]["url"] == "https://www.accessdata.fda.gov/scripts/cder/daf/"


# ── #67 timeouts and deadline ─────────────────────────────────────────────────


def test_per_source_caps_never_exceed_the_ceiling():
    async def caps():
        return {t: te._cap_for(t) for t in te._SOURCE_TIMEOUTS}

    out = asyncio.run(caps())
    assert all(0 < v <= te._TOOL_TIMEOUT for v in out.values())
    assert out["search_news"] < out["search_papers"]


def test_deadline_marks_slow_sources_timed_out_and_keeps_the_rest(monkeypatch):
    monkeypatch.setenv("EXPLORE_DEADLINE_SEC", "0.1")
    finished: list[str] = []

    async def slow(query, limit=20, **kw):
        await asyncio.sleep(0.4)
        finished.append("grants")
        return []

    async def fast(query, limit=20, **kw):
        return [Item(id="geo:1", kind="dataset", title="GSE1", source="geo", dedupe_key="g")]

    monkeypatch.setattr(te, "search_grants_async", slow)
    monkeypatch.setattr(te, "search_datasets_async", fast)

    async def body():
        te._start_deadline()
        sections = await te._execute(["search_grants", "search_datasets"], _scope(diseases=["glioblastoma"]))
        await asyncio.sleep(0.5)
        return sections

    by_tool = {s["tool"]: s for s in asyncio.run(body())}
    assert by_tool["search_grants"]["timed_out"] is True
    assert by_tool["search_grants"]["empty_reason"] == "timed_out"
    assert by_tool["search_datasets"]["items"][0]["title"] == "GSE1"
    assert finished == ["grants"]                 # the shielded fetch still completed


def test_deadline_env_parsing(monkeypatch):
    monkeypatch.setenv("EXPLORE_DEADLINE_SEC", "nope")
    assert te._explore_deadline_seconds() == te._DEFAULT_DEADLINE
    monkeypatch.setenv("EXPLORE_DEADLINE_SEC", "-3")
    assert te._explore_deadline_seconds() == te._DEFAULT_DEADLINE
    monkeypatch.delenv("EXPLORE_DEADLINE_SEC")
    assert te._explore_deadline_seconds() < 60     # below the proxy's maxDuration


# ── #67 popular-topic prewarm ─────────────────────────────────────────────────


def test_popular_topics_are_capped_and_configurable(monkeypatch):
    monkeypatch.delenv("PREWARM_TOPICS", raising=False)
    assert prewarm.popular_topics() == list(prewarm._DEFAULT_TOPICS)
    monkeypatch.setenv("PREWARM_TOPICS", ",".join(f"t{i}" for i in range(30)) + ",T1")
    assert len(prewarm.popular_topics()) == prewarm._MAX_TOPICS
    monkeypatch.setenv("PREWARM_TOPICS", "off")
    assert prewarm.popular_topics() == []


def test_prewarm_topic_uses_no_llm_and_skips_github(monkeypatch):
    def llm(*a, **k):
        raise AssertionError("no LLM in prewarm")

    monkeypatch.setattr(te, "_extract_scope", llm)
    monkeypatch.setattr(te, "_choose_tools", llm)
    ran: list[list[str]] = []

    async def execute(chosen, scope, *a, **k):
        ran.append(list(chosen))
        return []

    monkeypatch.setattr(te, "_execute", execute)
    tools = asyncio.run(te.prewarm_topic("ALS"))
    assert ran == [tools] and "search_trials" in tools
    assert set(tools) <= te._PREWARM_TOOLS and "search_tools" not in tools


def test_topic_round_is_sequential_and_records_failures(monkeypatch):
    monkeypatch.setenv("PREWARM_TOPICS", "A,B,C")
    seen: list[str] = []
    active = {"n": 0, "max": 0}

    async def warm(topic):
        active["n"] += 1
        active["max"] = max(active["max"], active["n"])
        await asyncio.sleep(0.01)
        active["n"] -= 1
        seen.append(topic)
        if topic == "B":
            raise RuntimeError("upstream down")
        return []

    monkeypatch.setattr(te, "prewarm_topic", warm)
    before = dict(prewarm._topics_state)
    asyncio.run(prewarm._warm_topics_once())
    assert seen == ["A", "B", "C"] and active["max"] == 1
    assert prewarm._topics_state["failures"] == before["failures"] + 1
    assert prewarm._topics_state["warmed"] == before["warmed"] + 2


# ── #68 tools ─────────────────────────────────────────────────────────────────


def test_github_metadata_passes_the_allow_list():
    repo = {
        "full_name": "ccsb-scripps/AutoDock-Vina", "html_url": "https://github.com/ccsb-scripps/AutoDock-Vina",
        "description": "AutoDock Vina", "stargazers_count": 700, "pushed_at": "2026-10-01T00:00:00Z",
        "license": {"key": "apache-2.0", "spdx_id": "Apache-2.0", "name": "Apache License 2.0"},
        "language": "C++", "topics": ["docking", "drug-discovery"], "owner": {"login": "x"},
        "forks_count": 200,
    }
    client = _JsonClient({"items": [repo, {**repo, "full_name": "a/b", "license": {"spdx_id": "NOASSERTION"}}]})
    items = asyncio.run(fetch_github(client, "molecular docking", 5))
    assert len(client.urls) == 1
    trimmed = trim_item(items[0].model_dump())
    assert trimmed["raw"] == {
        "license_spdx": "Apache-2.0", "language": "C++",
        "topics": ["docking", "drug-discovery"], "pushed_at": "2026-10-01T00:00:00Z",
    }
    assert trim_item(items[1].model_dump())["raw"]["license_spdx"] is None


@pytest.mark.parametrize("text,scope,drop", [
    ("open-source tools for molecular docking", {}, True),
    ("ADMET prediction", {"methods": ["ADMET prediction"]}, True),
    ("single-cell RNA-seq tools", {"methods": ["scRNA-seq"]}, False),
    ("datasets and tools for PHGDH", {"genes": ["PHGDH"]}, False),
    ("PHGDH", {"genes": ["PHGDH"]}, False),
])
def test_tool_query_without_data_words(text, scope, drop):
    assert te._is_tool_query_without_data(text, _scope(**scope)) is drop


def test_routed_tool_query_drops_geo_and_drug_scope_adds_approvals(monkeypatch):
    def extract(text):
        if "docking" in text:
            return _scope(methods=["molecular docking"])
        return _scope(assets=["sotorasib"])

    monkeypatch.setattr(te, "_extract_scope", extract)
    monkeypatch.setattr(te, "_choose_tools", lambda text, scope: (["search_tools", "search_datasets"], "stub"))
    chosen: list[list[str]] = []

    async def execute(tools, scope, *a, **k):
        chosen.append(list(tools))
        return []

    monkeypatch.setattr(te, "_execute", execute)
    asyncio.run(te.explore_async("open-source tools for molecular docking"))
    assert "search_datasets" not in chosen[0] and "search_tools" in chosen[0]
    asyncio.run(te.explore_async("sotorasib"))
    assert "search_fda" in chosen[1]
