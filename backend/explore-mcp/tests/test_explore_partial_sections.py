"""
tests/test_explore_partial_sections.py — a section built from several calls where
some fail.

Disease-plus-gene trial searches ("KRAS pancreatic cancer") make two
ClinicalTrials.gov calls (condition + gene, and condition only). They are isolated:
one failing still shows the other's trials, flagged "may be incomplete", and the page
is not kept for the long cache period; only both failing makes the section an error.
The same rule covers the empty-section retry with the broader term: if the retry
fails, the section is not "nothing found" for certain.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import tools.explore as te  # noqa: E402
import tools.search_trials as st  # noqa: E402
from tests.test_explore_target_families import (  # noqa: E402,F401
    GPCR,
    KRAS_PDAC,
    LLM_SCOPES,
    _item,
    _section,
    calls,
)


class _trial:
    def __init__(self, nct: str):
        self.id = f"trial:{nct}"
        self.raw = {"nct_id": nct}

    def model_dump(self):
        return {"id": self.id, "kind": "trial", "title": self.id, "summary": "", "raw": dict(self.raw)}


def _gene_helper(monkeypatch, gene_call, condition_call):
    """Stub the two inner calls of search_trials_with_gene_async; record their args."""
    seen = []

    async def fake(condition, limit, status_filter=None, condition_only=False, extra_term=None, **kw):
        seen.append((condition, limit, status_filter, condition_only, extra_term, kw))
        return await (gene_call() if extra_term else condition_call())

    monkeypatch.setattr(st, "search_trials_async", fake)
    return seen


async def _ok(*ncts):
    return [_trial(n) for n in ncts]


async def _boom():
    raise RuntimeError("ClinicalTrials.gov 503")


# ── the helper ───────────────────────────────────────────────────────────────


def test_both_calls_succeed_a_plain_merged_list(monkeypatch):
    seen = _gene_helper(monkeypatch, lambda: _ok("NCT1", "NCT2"), lambda: _ok("NCT2", "NCT3"))
    out = asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10))
    assert [t.id for t in out] == ["trial:NCT1", "trial:NCT2", "trial:NCT3"]
    assert not getattr(out, "partial", False) and type(out) is list
    # The same two calls as before the change.
    assert seen == [
        ("pancreatic cancer", 10, None, True, "KRAS", {}),
        ("pancreatic cancer", 10, None, True, None, {}),
    ]


def test_one_call_fails_the_other_trials_are_shown_and_flagged(monkeypatch):
    _gene_helper(monkeypatch, _boom, lambda: _ok("NCT7", "NCT8"))
    out = asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10))
    assert [t.id for t in out] == ["trial:NCT7", "trial:NCT8"]
    assert out.partial is True and out.failed == ["RuntimeError: ClinicalTrials.gov 503"]
    assert isinstance(out, list)

    _gene_helper(monkeypatch, lambda: _ok("NCT9"), _boom)
    out = asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10))
    assert [t.id for t in out] == ["trial:NCT9"] and out.partial is True


def test_both_calls_fail_it_raises(monkeypatch):
    _gene_helper(monkeypatch, _boom, _boom)
    with pytest.raises(RuntimeError):
        asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10))


def test_a_cancelled_call_is_not_treated_as_a_failure(monkeypatch):
    async def cancelled():
        raise asyncio.CancelledError()

    _gene_helper(monkeypatch, cancelled, lambda: _ok("NCT1"))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(st.search_trials_with_gene_async("pancreatic cancer", "KRAS", 10))


# ── on the Explore page ──────────────────────────────────────────────────────


def _expiring(monkeypatch):
    keys = []

    async def expire_soon(key, seconds):
        keys.append(key)

    monkeypatch.setattr(te.cache, "expire_soon", expire_soon)
    return keys


def _kras_with_trials(monkeypatch, result):
    async def gene_trials(*a, **k):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(te, "search_trials_with_gene_async", gene_trials)
    return asyncio.run(te.explore_async(KRAS_PDAC))


def test_kras_one_call_failed_shows_trials_with_a_note_and_no_long_cache(calls, monkeypatch):
    keys = _expiring(monkeypatch)
    partial = st.PartialItems([_item("trial", "KRAS trial in PDAC")], ["RuntimeError: 503"])
    result = _kras_with_trials(monkeypatch, partial)
    trial = _section(result, "trial")
    assert [i["title"] for i in trial["items"]] == ["KRAS trial in PDAC"]
    assert trial["incomplete"] == st.INCOMPLETE_NOTE
    assert "error" not in trial
    assert keys, "the page must be expired soon, not kept for the long TTL"


def test_kras_both_calls_failed_is_an_error_section(calls, monkeypatch):
    keys = _expiring(monkeypatch)
    result = _kras_with_trials(monkeypatch, RuntimeError("both failed"))
    trial = _section(result, "trial")
    assert trial["items"] == [] and trial["error"].startswith("RuntimeError")
    assert "incomplete" not in trial
    assert keys


def test_kras_both_calls_succeeded_no_note_and_normal_cache(calls, monkeypatch):
    keys = _expiring(monkeypatch)
    result = _kras_with_trials(monkeypatch, [_item("trial", "KRAS trial in PDAC")])
    trial = _section(result, "trial")
    assert trial["items"] and "incomplete" not in trial and "error" not in trial
    assert keys == []


def test_has_failed_section_counts_an_incomplete_section():
    assert te._has_failed_section({"sections": [{"items": [{"id": 1}], "incomplete": st.INCOMPLETE_NOTE}]})
    assert not te._has_failed_section({"sections": [{"items": [{"id": 1}]}]})


# ── the empty-section retry with the broader term ────────────────────────────


def test_empty_first_search_and_failed_retry_is_incomplete_not_nothing_found(monkeypatch):
    monkeypatch.setattr(te, "_extract_scope", lambda text: dict(LLM_SCOPES[text]))
    keys = _expiring(monkeypatch)
    seen = []

    async def grants(query, limit=20, **kw):
        seen.append(query)
        if len(seen) == 1:
            return []                       # the first search finds nothing
        raise RuntimeError("Grants.gov 502")  # the broader retry fails

    monkeypatch.setattr(te, "search_grants_async", grants)
    result = asyncio.run(te.explore_async(GPCR, only_kinds=["grant"]))
    grant = _section(result, "grant")
    assert len(seen) == 2, seen
    assert grant["items"] == []
    assert grant["incomplete"] == st.INCOMPLETE_NOTE
    assert keys
