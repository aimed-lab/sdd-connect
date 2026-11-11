"""
test_page_topic_gate — the on-topic check wiki pages apply to new sources
(tools/page_agent.py: gate_terms / item_on_topic / apply_topic_gate), at
creation and on every daily refresh.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tools.page_agent as pa  # noqa: E402

OVARIAN = {"topics": [], "genes": [], "diseases": ["ovarian cancer"], "assets": [], "methods": []}
PHGDH = {"topics": ["PHGDH inhibitors"], "genes": ["PHGDH"], "diseases": [], "assets": [], "methods": []}


def _it(i, kind, title, summary="", **extra):
    return {"id": i, "kind": kind, "title": title, "summary": summary,
            "url": f"https://x/{i}", "source": "s", "date_iso": None, **extra}


_TOPIC = {id(OVARIAN): "Ovarian Cancer", id(PHGDH): "PHGDH inhibitors"}


def _passes(item, scope):
    level, terms, _ = pa.gate_terms(scope, _TOPIC[id(scope)])
    return pa.item_on_topic(item, level, terms)


# ── term choice ──────────────────────────────────────────────────────────────

def test_terms_most_specific_level_first():
    assert pa.gate_terms(PHGDH, "PHGDH inhibitors") == ("entity", ["PHGDH"], [])
    assert pa.gate_terms(OVARIAN, "Ovarian Cancer") == ("disease", ["ovarian cancer"], [])
    assert pa.gate_terms({"topics": ["base editing"], "diseases": []}, "Base editing") == (
        "topic", ["base editing"], [])
    assert pa.gate_terms(
        {"assets": ["olaparib"], "genes": ["BRCA1"], "diseases": ["ovarian cancer"]},
        "BRCA1 and olaparib in ovarian cancer",
    ) == ("entity", ["BRCA1", "olaparib"], [])


def test_only_terms_in_the_topic_text_are_trusted():
    # An extracted gene the person never typed doesn't take over the gate.
    scope = {"genes": ["BRCA1"], "diseases": ["ovarian cancer"], "topics": []}
    assert pa.gate_terms(scope, "Ovarian Cancer") == ("disease", ["ovarian cancer"], ["BRCA1"])

    scope = {"genes": ["KRAS"], "diseases": ["pancreatic cancer"], "topics": ["KRAS signalling"]}
    assert pa.gate_terms(scope, "KRAS in pancreatic cancer") == ("entity", ["KRAS"], ["KRAS signalling"])

    scope = {"genes": ["PHGDH"], "assets": ["NCT-503"], "topics": ["PHGDH inhibitors"], "diseases": []}
    assert pa.gate_terms(scope, "PHGDH inhibitors") == ("entity", ["PHGDH"], ["NCT-503"])


def test_topic_text_match_ignores_case_and_plural_s():
    assert pa._in_topic_text("Ovarian cancer", "ovarian cancers in BRCA carriers")
    assert pa._in_topic_text("PHGDH inhibitor", "PHGDH inhibitors")
    assert not pa._in_topic_text("cancer ovarian", "Ovarian Cancer")   # order matters
    assert not pa._in_topic_text("KRAS", "KRASG12C")                   # whole words only


def test_nothing_in_topic_text_falls_back_to_extracted_diseases():
    scope = {"genes": ["EGFR"], "diseases": ["non-small cell lung cancer"], "topics": ["targeted therapy"]}
    level, terms, ignored = pa.gate_terms(scope, "NSCLC")
    assert (level, terms) == ("disease", ["non-small cell lung cancer"])
    assert ignored == ["EGFR", "targeted therapy"]
    # No disease in the scope either: no gate.
    assert pa.gate_terms({"genes": ["EGFR"], "topics": ["targeted therapy"]}, "NSCLC") == (
        None, [], ["EGFR", "targeted therapy"])


def test_ignored_terms_are_logged_and_reported(caplog):
    scope = {"genes": ["BRCA1"], "diseases": ["ovarian cancer"]}
    with caplog.at_level(logging.INFO, logger=pa.logger.name):
        _, report = pa.apply_topic_gate("Ovarian Cancer", scope, [], "test")
    assert report["ignored_terms"] == ["BRCA1"]
    assert "ignored_not_in_topic=['BRCA1']" in caplog.records[-1].getMessage()


def test_no_terms_means_no_gate():
    assert pa.gate_terms({}, "x") == (None, [], [])
    assert pa.gate_terms(None, "x") == (None, [], [])
    assert pa.gate_terms({"topics": ["  "], "methods": ["CRISPR"]}, "CRISPR") == (None, [], [])
    items = [_it("a", "paper", "Anything"), _it("b", "trial", "", "")]
    kept, report = pa.apply_topic_gate("x", {}, items, "test")
    assert kept == items
    assert report == {"level": None, "terms": [], "ignored_terms": [], "candidates": 2, "kept": 2, "dropped": 0}


# ── "ovarian cancer": the four items that reached the real page ─────────────

def test_ovarian_blocks_the_off_topic_items():
    blocked = [
        _it("pubmed:1", "paper",
            "Time-dependent anti-Mullerian hormone dynamics during GnRHa-based endocrine therapy in young breast cancer survivors",
            "Ovarian function suppression with GnRH agonists is standard in premenopausal breast cancer; "
            "we followed AMH in 120 women."),
        _it("clinicaltrials:NCT07746635", "trial",
            "Fecal Microbiota Transplantation for Obese Women With Polycystic Ovarian Syndrome",
            "Randomised trial of FMT in PCOS.",
            raw={"conditions": ["PCOS (Polycystic Ovary Syndrome)"]}),
        _it("clinicaltrials:NCT01352962", "trial",
            "Gemcitabine, Carboplatin, and Lenalidomide for Treatment of Advanced/Metastatic Urothelial Cancer",
            "Phase I/II study in advanced urothelial and other solid tumors.",
            raw={"conditions": ["Urethral Neoplasms", "Cancer of the Urethra"],
                 "keywords": ["Urethra Cancer", "Ovarian Cancer", "Pancreatic Cancer"]}),
        _it("pubmed:2", "paper",
            "Global longitudinal strain predicts anthracycline cardiomyopathy",
            "Cardiomyopathy after anthracycline therapy in women treated for cancer of the breast or ovary."),
    ]
    for item in blocked:
        assert not _passes(item, OVARIAN), item["title"]


def test_ovarian_keeps_the_real_items():
    kept = [
        _it("clinicaltrials:NCT1", "trial",
            "Olaparib Maintenance in Recurrent Ovarian, Fallopian Tube, or Primary Peritoneal Cancer",
            "Phase III maintenance trial."),
        _it("pubmed:3", "paper", "Ovarian clear cell carcinoma: genomic landscape and ARID1A loss", ""),
        _it("pubmed:4", "paper",
            "PARP inhibitor resistance in high-grade serous carcinoma",
            "Most patients with advanced ovarian cancer relapse after first-line platinum."),
        _it("pubmed:5", "paper", "Tumours of the ovary in adolescents", "A case series."),
    ]
    for item in kept:
        assert _passes(item, OVARIAN), item["title"]


def test_trial_passes_on_its_own_conditions_list_not_its_keywords():
    by_condition = _it("clinicaltrials:NCT2", "trial", "Niraparib Plus Bevacizumab After Surgery",
                       "Phase II.", raw={"conditions": ["Ovarian Carcinoma", "Fallopian Tube Carcinoma"]})
    by_keyword = _it("clinicaltrials:NCT3", "trial", "Niraparib Plus Bevacizumab After Surgery",
                     "Phase II.", raw={"conditions": ["Solid Tumor"], "keywords": ["Ovarian Cancer"]})
    assert _passes(by_condition, OVARIAN)
    assert not _passes(by_keyword, OVARIAN)


def test_split_words_in_the_abstract_are_not_the_phrase():
    item = _it("pubmed:6", "paper", "Endocrine therapy outcomes",
               "Ovarian reserve was measured in women with breast cancer.")
    assert not _passes(item, OVARIAN)
    item["summary"] = "Outcomes in ovarian cancers treated with surgery."
    assert _passes(item, OVARIAN)


# ── "PHGDH inhibitors": gene term, whole word, title or abstract ────────────

def test_phgdh_gene_term():
    assert _passes(_it("pubmed:7", "paper", "PHGDH in cancer: a narrative review"), PHGDH)
    assert _passes(_it("pubmed:8", "paper", "Serine synthesis in glioma",
                       "Knockdown of phgdh slowed growth."), PHGDH)
    assert not _passes(_it("pubmed:9", "paper", "DHODH inhibition in acute myeloid leukemia",
                           "Brequinar blocks pyrimidine synthesis via DHODH."), PHGDH)
    # Whole word only: a longer token that contains the symbol doesn't count.
    assert not _passes(_it("pubmed:10", "paper", "PHGDHL1 variants", ""), PHGDH)


def test_no_title_and_no_abstract_is_dropped_when_gated():
    assert not _passes(_it("x:1", "paper", "", ""), OVARIAN)
    assert not _passes(_it("x:2", "paper", "  ", None), PHGDH)


# ── wiring into the two page runs ───────────────────────────────────────────

def _explore(scope, papers, trials=()):
    return {
        "scope": scope,
        "tools_called": ["search_papers", "search_trials"],
        "sections": [
            {"tool": "search_papers", "kind": "paper", "items": list(papers)},
            {"tool": "search_trials", "kind": "trial", "items": list(trials)},
        ],
    }


def _patch(monkeypatch, result):
    async def fake_explore(text):
        return result

    async def fake_enrich(c):
        return {}

    monkeypatch.setattr(pa, "explore_async", fake_explore)
    monkeypatch.setattr(pa, "enrich_abstracts", fake_enrich)


def test_refresh_drops_off_topic_items_and_reports_counts(monkeypatch, caplog):
    papers = [
        _it("pubmed:a", "paper", "Ovarian clear cell carcinoma outcomes"),
        _it("pubmed:b", "paper", "Breast cancer endocrine therapy", "Ovarian function suppression was used."),
    ]
    trials = [_it("clinicaltrials:c", "trial", "Inositol to Treat Polycystic Ovarian Syndrome", "PCOS.")]
    _patch(monkeypatch, _explore(OVARIAN, papers, trials))
    with caplog.at_level(logging.INFO, logger=pa.logger.name):
        out = asyncio.run(pa.run_page_refresh_async("Ovarian Cancer", [], []))
    assert [i["item_id"] for i in out["new_items"]] == ["pubmed:a"]
    assert out["gate_kept"] == 1 and out["gate_dropped"] == 2
    assert out["topic_gate"]["terms"] == ["ovarian cancer"]
    lines = [r for r in caplog.records if "topic gate" in r.getMessage()]
    assert len(lines) == 1 and lines[0].levelno == logging.INFO
    assert "candidates=3 kept=1 dropped=2" in lines[0].getMessage()


def test_refresh_warns_when_everything_is_dropped(monkeypatch, caplog):
    papers = [_it(f"pubmed:{n}", "paper", f"Cardiomyopathy study {n}") for n in range(10)]
    _patch(monkeypatch, _explore(OVARIAN, papers))
    with caplog.at_level(logging.INFO, logger=pa.logger.name):
        out = asyncio.run(pa.run_page_refresh_async("Ovarian Cancer", [], []))
    assert out["new_items"] == [] and out["gate_dropped"] == 10
    warn = [r for r in caplog.records if "topic gate" in r.getMessage()]
    assert len(warn) == 1 and warn[0].levelno == logging.WARNING


def test_few_candidates_all_dropped_is_not_a_warning(monkeypatch, caplog):
    _patch(monkeypatch, _explore(OVARIAN, [_it("pubmed:z", "paper", "Cardiomyopathy")]))
    with caplog.at_level(logging.INFO, logger=pa.logger.name):
        asyncio.run(pa.run_page_refresh_async("Ovarian Cancer", [], []))
    assert all(r.levelno < logging.WARNING for r in caplog.records if "topic gate" in r.getMessage())


def test_refresh_without_scope_terms_keeps_everything(monkeypatch):
    papers = [_it("pubmed:a", "paper", "Anything at all"), _it("pubmed:b", "paper", "Something else")]
    _patch(monkeypatch, _explore({"topics": [], "genes": [], "diseases": []}, papers))
    out = asyncio.run(pa.run_page_refresh_async("whatever", [], []))
    assert len(out["new_items"]) == 2 and out["gate_dropped"] == 0
    assert out["topic_gate"]["level"] is None


def test_page_creation_gates_sources_before_notes(monkeypatch):
    papers = [
        _it("pubmed:a", "paper", "PHGDH in cancer: a narrative review"),
        _it("pubmed:b", "paper", "DHODH inhibition in AML", "Brequinar and DHODH."),
    ]
    _patch(monkeypatch, _explore(PHGDH, papers))
    seen = {}

    def fake_notes(goal, candidates):
        seen["ids"] = [c["id"] for c in candidates]
        return None

    monkeypatch.setattr(pa, "build_page_notes", fake_notes)
    out = asyncio.run(pa.run_page_agent_async("PHGDH inhibitors"))
    assert seen["ids"] == ["pubmed:a"]
    sources = out["unfiled_items"] + out["project_level_items"]
    assert [s["item_id"] for s in sources] == ["pubmed:a"]
    assert out["gate_kept"] == 1 and out["gate_dropped"] == 1


# ── conditions rule through the real trial item shape ───────────────────────

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

    async def get(self, url, timeout=None, headers=None):
        return _FakeResponse(self._payload)


def _study(nct, title, conditions=None, keywords=None):
    proto = {
        "identificationModule": {"nctId": nct, "briefTitle": title},
        "statusModule": {"overallStatus": "RECRUITING", "startDateStruct": {"date": "2025-01-01"}},
        "descriptionModule": {"briefSummary": "Open-label phase II study."},
    }
    if conditions is not None or keywords is not None:
        proto["conditionsModule"] = {"conditions": conditions or [], "keywords": keywords or []}
    return {"protocolSection": proto}


def _real_trials(studies):
    from sources.clinical_trials import fetch_trials

    items = asyncio.run(fetch_trials(_FakeClient({"studies": studies}), "ovarian cancer", 10, condition_only=True))
    return [i.model_dump() for i in items]


def test_fetch_trials_keeps_conditions_in_raw():
    with_conds, without = _real_trials([
        _study("NCT1", "Niraparib Plus Bevacizumab After Surgery", ["Ovarian Carcinoma"], ["PARP"]),
        _study("NCT2", "No conditions module"),
    ])
    assert with_conds["raw"]["conditions"] == ["Ovarian Carcinoma"]
    assert "keywords" not in with_conds["raw"]
    assert without["raw"]["conditions"] is None


def test_gate_conditions_rule_on_real_trial_items(monkeypatch):
    trials = _real_trials([
        # Vague title, ovarian in its own conditions -> kept.
        _study("NCT10", "Niraparib Plus Bevacizumab After Surgery",
               ["Ovarian Carcinoma", "Fallopian Tube Carcinoma"]),
        # Ovarian Cancer only in keywords (NCT01352962's shape) -> dropped.
        _study("NCT01352962", "Gemcitabine, Carboplatin, and Lenalidomide for Advanced Urothelial Cancer",
               ["Urethral Neoplasms", "Cancer of the Urethra"], ["Ovarian Cancer", "Pancreatic Cancer"]),
        # PCOS -> dropped.
        _study("NCT07746635", "Fecal Microbiota Transplantation for Obese Women With PCOS",
               ["PCOS (Polycystic Ovary Syndrome)"]),
        # No conditions module and a vague title -> dropped (nothing names the disease).
        _study("NCT11", "Niraparib Plus Bevacizumab After Surgery, cohort 2"),
    ])
    _patch(monkeypatch, _explore(OVARIAN, [], trials))
    out = asyncio.run(pa.run_page_refresh_async("Ovarian Cancer", [], []))
    assert [i["item_id"] for i in out["new_items"]] == ["clinicaltrials:NCT10"]
    assert out["gate_kept"] == 1 and out["gate_dropped"] == 3
