"""
tests/test_explore_stream.py — POST /api/explore/stream (#95).

  * sections arrive in completion order, between one `meta` and one `done`;
  * papers go out whole and preprints only after them, already de-duplicated
    against paper DOIs;
  * a source past the deadline arrives as its normal timed_out section;
  * one section failing to build becomes an error section, and a failure
    anywhere still ends with `done`;
  * the whole-result cache is written only when the stream completes, and a
    hit sends everything at once with no source calls;
  * the HTTP route sends trimmed NDJSON with the no-buffering headers.

No network and no Groq: _prepare (scope + routing) and the source functions
are stubbed.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

import server  # noqa: E402
import tools.explore as te  # noqa: E402
from cache import cache  # noqa: E402
from models import Item  # noqa: E402

SCOPE = {**{k: [] for k in te.SCOPE_KEYS}, "diseases": ["glioblastoma"], "is_default": False, "is_personalized": False}


def _item(kind: str, iid: str, doi: str | None = None, source: str = "europepmc") -> Item:
    return Item(id=iid, kind=kind, title=f"{kind} {iid}", source=source, dedupe_key=iid, doi=doi)


@pytest.fixture
def routed(monkeypatch):
    """Route every search to the given tools without the LLM."""
    chosen: list[str] = []

    async def prepare(input_text, scope_terms, source_filters):
        return {
            "scope": SCOPE, "chosen": list(chosen), "reasoning": "stub",
            "exec_scope": {**SCOPE, "_raw_input": input_text}, "extra": {},
        }

    monkeypatch.setattr(te, "_prepare", prepare)
    return chosen


@pytest.fixture
def sources(monkeypatch):
    """Stub sources with per-source delays. Returns the call log."""
    calls: list[str] = []
    delays = {"papers": 0.0, "preprints": 0.0, "grants": 0.0, "datasets": 0.0}

    async def papers(queries, since_year):
        calls.append("papers")
        await asyncio.sleep(delays["papers"])
        p = {"id": "pubmed:1", "kind": "paper", "title": "P1", "doi": "10.1/SAME", "source": "pubmed"}
        return [p], [p]

    async def preprints(query, limit=20):
        calls.append("preprints")
        await asyncio.sleep(delays["preprints"])
        return [_item("preprint", "pp:dup", doi="10.1/same"), _item("preprint", "pp:new", doi="10.1/new")]

    async def grants(query, limit=20, **kw):
        calls.append("grants")
        await asyncio.sleep(delays["grants"])
        return [_item("grant", "g1", source="grants_gov")]

    async def datasets(query, limit=20):
        calls.append("datasets")
        await asyncio.sleep(delays["datasets"])
        return [_item("dataset", "GSE1", source="geo")]

    monkeypatch.setattr(te, "_papers_with_abstracts", papers)
    monkeypatch.setattr(te, "search_preprints_async", preprints)
    monkeypatch.setattr(te, "search_grants_async", grants)
    monkeypatch.setattr(te, "search_datasets_async", datasets)
    return calls, delays


async def _collect(agen, stop_after: int | None = None) -> list[dict]:
    events = []
    async for e in agen:
        events.append(e)
        if stop_after is not None and len(events) >= stop_after:
            await agen.aclose()
            break
    return events


def _run(**kw) -> list[dict]:
    return asyncio.run(_collect(te.explore_stream(kw.pop("input_text", "glioblastoma"), **kw)))


def _tools(events: list[dict]) -> list[str]:
    return [e["section"]["tool"] for e in events if e["type"] == "section"]


def test_sections_arrive_in_completion_order(routed, sources):
    _calls, delays = sources
    routed[:] = ["search_grants", "search_datasets"]
    delays["grants"] = 0.15

    events = _run()

    assert events[0]["type"] == "meta"
    assert events[0]["tools_called"] == ["search_grants", "search_datasets"]
    assert events[0]["pending_kinds"] == ["grant", "dataset"]
    assert _tools(events) == ["search_datasets", "search_grants"]
    assert events[-1] == {"type": "done", "complete": True, "cached": False}
    assert [e["type"] for e in events].count("done") == 1


def test_preprints_wait_for_papers_and_drop_paper_dois(routed, sources):
    _calls, delays = sources
    routed[:] = ["search_papers", "search_preprints", "search_datasets"]
    delays["papers"] = 0.15          # preprints and datasets finish first

    events = _run()
    tools = _tools(events)

    assert tools.index("search_datasets") < tools.index("search_papers") < tools.index("search_preprints")
    papers = next(e["section"] for e in events if e["type"] == "section" and e["section"]["tool"] == "search_papers")
    assert papers["items"] and papers["items_key"] and "items_relevant" in papers   # whole, one event
    pre = next(e["section"] for e in events if e["type"] == "section" and e["section"]["tool"] == "search_preprints")
    assert [i["id"] for i in pre["items"]] == ["pp:new"]


def test_preprints_without_papers_are_not_held(routed, sources):
    _calls, delays = sources
    routed[:] = ["search_preprints", "search_grants"]
    delays["grants"] = 0.15

    events = _run()

    assert _tools(events) == ["search_preprints", "search_grants"]
    pre = next(e["section"] for e in events if e["type"] == "section" and e["section"]["tool"] == "search_preprints")
    assert len(pre["items"]) == 2


def test_timed_out_source_is_a_normal_section(routed, sources, monkeypatch):
    monkeypatch.setenv("EXPLORE_DEADLINE_SEC", "0.1")
    _calls, delays = sources
    routed[:] = ["search_grants", "search_datasets"]
    delays["grants"] = 0.4

    events = _run()

    grants = next(e["section"] for e in events if e["type"] == "section" and e["section"]["tool"] == "search_grants")
    assert grants["timed_out"] is True and grants["empty_reason"] == "timed_out"
    assert events[-1]["type"] == "done" and events[-1]["complete"] is True


def test_a_section_that_fails_to_build_does_not_end_the_stream(routed, sources, monkeypatch):
    routed[:] = ["search_grants", "search_datasets"]
    real = te._build_section

    def build(tool, kind, query, result, scope):
        if tool == "search_grants":
            raise RuntimeError("bad item")
        return real(tool, kind, query, result, scope)

    monkeypatch.setattr(te, "_build_section", build)
    events = _run()

    by_tool = {e["section"]["tool"]: e["section"] for e in events if e["type"] == "section"}
    assert "RuntimeError" in by_tool["search_grants"]["error"]
    assert by_tool["search_datasets"]["items"]
    assert events[-1]["complete"] is True


def test_a_failure_still_ends_with_done(monkeypatch):
    async def prepare(*a, **k):
        raise RuntimeError("router down")

    monkeypatch.setattr(te, "_prepare", prepare)
    events = _run()

    assert [e["type"] for e in events] == ["meta", "done"]
    assert events[-1]["complete"] is False and "router down" in events[-1]["error"]


def test_cache_written_on_completion_and_a_hit_sends_everything(routed, sources):
    calls, delays = sources
    routed[:] = ["search_grants", "search_datasets"]
    delays["grants"] = 0.05

    first = _run()
    n_calls = len(calls)
    second = _run()

    assert len(calls) == n_calls                       # no source calls on a hit
    assert second[-1] == {"type": "done", "complete": True, "cached": True}
    # The hit is the cached whole result, in _execute's order.
    assert _tools(second) == ["search_grants", "search_datasets"]
    assert sorted(_tools(first)) == sorted(_tools(second))
    # The non-streaming route reads the same entry.
    result = asyncio.run(te.explore_async("glioblastoma"))
    assert [s["tool"] for s in result["sections"]] == ["search_grants", "search_datasets"]
    assert len(calls) == n_calls


def test_leaving_early_writes_no_cache(routed, sources):
    _calls, delays = sources
    routed[:] = ["search_grants", "search_datasets"]
    delays["grants"] = 0.2

    async def body():
        events = await _collect(te.explore_stream("glioblastoma"), stop_after=2)   # meta + datasets
        await asyncio.sleep(0.3)          # the shielded grants fetch still finishes
        return events

    events = asyncio.run(body())
    assert [e["type"] for e in events] == ["meta", "section"]
    key, _ttl, _stale = te._whole_result_key("glioblastoma", [], None, None, "")
    assert asyncio.run(cache.peek(key, lambda: None, 60)) is None


def test_only_kinds_is_sent_whole(monkeypatch):
    async def fake_execute(chosen, scope, since_year=None, status_filter=None, **kwargs):
        return [{"tool": n, "kind": te._KINDS[n], "query": "q", "items": [{"id": "g1", "title": "glioblastoma grant"}]} for n in chosen]

    monkeypatch.setattr(te, "_execute", fake_execute)
    monkeypatch.setenv("EXPLORE_ONLY_SCOPE_LLM", "false")
    events = _run(only_kinds=["grant"])

    assert events[0]["type"] == "meta" and "interpreted" in events[0]
    assert _tools(events) == ["search_grants"]
    assert events[-1]["complete"] is True


class _Request:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def test_http_route_sends_trimmed_ndjson_with_no_buffering_headers(monkeypatch):
    async def fake_stream(**kwargs):
        yield {"type": "meta", "input": kwargs["input_text"], "scope": {}, "tools_called": ["search_papers"], "pending_kinds": ["paper"]}
        paper = {"id": "openalex:W1", "kind": "paper", "title": "T", "source": "openalex",
                 "raw": {"referenced_works": ["W2"] * 200, "prior_signal": 5}}
        yield {"type": "section", "section": {"tool": "search_papers", "kind": "paper", "items": [paper], "items_key": [paper]}}
        yield {"type": "done", "complete": True, "cached": False}

    monkeypatch.setattr(server, "explore_stream", fake_stream)

    async def body():
        response = await server.explore_stream_http(_Request({"input": "kras", "only_kinds": ["nope"]}))
        chunks = [c async for c in response.body_iterator]
        return response, chunks

    response, chunks = asyncio.run(body())
    assert response.media_type == "application/x-ndjson"
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    lines = [json.loads(c) for c in chunks]          # one event per chunk, one line each
    assert all(c.endswith(b"\n") and c.count(b"\n") == 1 for c in chunks)
    assert [e["type"] for e in lines] == ["meta", "section", "done"]
    assert lines[0]["input"] == "kras"
    section = lines[1]["section"]
    assert section["items"][0]["raw"] == {"prior_signal": 5}
    assert section["items_key"][0]["raw"] == {"prior_signal": 5}


def test_explore_args_match_the_existing_route():
    args = server._explore_args({
        "input": "kras", "scope": ["a"], "since_year": "2020", "status_filter": [" RECRUITING ", ""],
        "only_kinds": ["grant", "bogus"], "grant_open_only": True,
    })
    assert args["input_text"] == "kras" and args["scope_terms"] == ["a"]
    assert args["since_year"] == 2020 and args["status_filter"] == ["RECRUITING"]
    assert args["only_kinds"] == ["grant"]
    assert args["source_filters"]["grant_open_only"] is True
    assert server._explore_args("not a dict") == {
        "input_text": "", "scope_terms": None, "since_year": None, "status_filter": None,
    }
