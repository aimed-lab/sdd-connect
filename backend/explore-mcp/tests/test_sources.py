"""
Per-source Item-shape tests, driven by recorded fixture responses (no network).

Each source fetcher takes an httpx-like client; we pass a fake client that
returns canned JSON, so these assert the URL→Item field mapping deterministically.

Runnable via pytest or directly (python tests/test_sources.py).
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.crossref import fetch_crossref  # noqa: E402
from sources.openalex import fetch_openalex  # noqa: E402
from sources.pubmed import fetch_pubmed  # noqa: E402


# ── Fake httpx client ────────────────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json now
        # reads it directly (no getattr fallback) so an unfaithful double
        # fails loudly (AttributeError) rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Routes GETs to canned payloads. `routes` maps a URL substring -> payload;
    a single non-dict payload answers every URL."""

    def __init__(self, routes):
        self._routes = routes

    async def get(self, url, timeout=None):
        if isinstance(self._routes, dict):
            for needle, payload in self._routes.items():
                if needle in url:
                    return _FakeResponse(payload)
            raise AssertionError(f"no fake route for {url}")
        return _FakeResponse(self._routes)


# ── PubMed ───────────────────────────────────────────────────────────────────


def test_pubmed_item_shape():
    client = _FakeClient({
        "esearch": {"esearchresult": {"idlist": ["111", "222", "333"]}},
        "esummary": {"result": {
            "111": {
                "title": "PHGDH in Alzheimer's",
                "source": "Nature",
                "pubdate": "2024 Oct 15",
                "authors": [{"name": "Doe J"}, {"name": "Roe R"}, {"name": "Poe P"}],
            },
            "222": {"title": "   ", "source": "X", "pubdate": "2023", "authors": []},
            "333": {
                "title": "Serine metabolism review",
                "source": "Cell",
                "pubdate": "2024 Jan",
                "authors": [{"name": "Ng L"}],
                # DOI lives in the articleids array (idtype 'doi')
                "articleids": [
                    {"idtype": "pubmed", "value": "333"},
                    {"idtype": "doi", "value": "10.1016/J.CELL.2024.001"},
                ],
            },
        }},
    })
    items = asyncio.run(fetch_pubmed(client, "PHGDH Alzheimer's", 10))

    assert len(items) == 2  # blank-title record 222 dropped; 111 + 333 survive
    by_id = {it.id: it for it in items}

    it = by_id["pubmed:111"]
    assert it.kind == "paper"
    assert it.source == "pubmed"
    assert it.title == "PHGDH in Alzheimer's"
    assert it.url == "https://pubmed.ncbi.nlm.nih.gov/111/"
    assert it.summary == "Published in Nature. Doe J, Roe R et al."
    assert it.date_iso == "2024-10-15T00:00:00.000Z"
    assert it.signal is None                      # PubMed has no metric
    assert it.doi is None                          # no articleids -> falls back to URL key
    assert it.dedupe_key == "url:pubmed.ncbi.nlm.nih.gov/111/"
    assert it.raw["source"] == "Nature"

    # 333 carries a DOI -> normalized, and the dedupe key is DOI-based (cross-source collapse)
    d = by_id["pubmed:333"]
    assert d.doi == "10.1016/j.cell.2024.001"
    assert d.dedupe_key == "doi:10.1016/j.cell.2024.001"


# ── OpenAlex ─────────────────────────────────────────────────────────────────


def test_openalex_item_shape_with_citation_signal():
    client = _FakeClient({"api.openalex.org": {"results": [
        {
            "id": "https://openalex.org/W123",
            "title": "PHGDH serine synthesis",
            "doi": "https://doi.org/10.1/abc",
            "publication_date": "2024-05-01",
            "cited_by_count": 42,
            "primary_location": {"source": {"display_name": "Cell"}},
            "authorships": [
                {"author": {"display_name": "A One"}},
                {"author": {"display_name": "B Two"}},
                {"author": {"display_name": "C Three"}},
            ],
            "referenced_works": ["https://openalex.org/W1", "https://openalex.org/W2"],
        },
        {"title": "", "cited_by_count": 0},  # blank title dropped
    ]}})
    items = asyncio.run(fetch_openalex(client, "PHGDH", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "openalex:W123"
    assert it.source == "openalex"
    assert it.title == "PHGDH serine synthesis"
    assert it.url == "https://doi.org/10.1/abc"
    assert it.summary == "Published in Cell. A One, B Two et al."
    assert it.date_iso == "2024-05-01T00:00:00.000Z"
    # REAL citation signal set from cited_by_count
    assert it.signal is not None
    assert it.signal.metric == "citations"
    assert it.signal.value == 42.0
    assert it.doi == "10.1/abc"                      # normalized from https://doi.org/10.1/abc
    assert it.dedupe_key == "doi:10.1/abc"
    # referenced_works captured into raw for later citation-graph ranking
    assert it.raw["referenced_works"] == ["https://openalex.org/W1", "https://openalex.org/W2"]


# ── Crossref ─────────────────────────────────────────────────────────────────


def test_crossref_item_shape_and_type_guard():
    client = _FakeClient({"api.crossref.org": {"message": {"items": [
        {
            "title": ["PHGDH in cancer metabolism"],
            "type": "journal-article",
            "DOI": "10.5/xyz",
            "URL": "https://doi.org/10.5/xyz",
            "container-title": ["Journal of X"],
            "issued": {"date-parts": [[2024, 3, 7]]},
        },
        {"title": ["A Whole Book"], "type": "book", "DOI": "10.9/b"},   # non-article -> dropped
        {"title": [""], "type": "journal-article"},                     # blank title -> dropped
        # Supplementary files, reviews, datasets, theses, and a row with no type: dropped.
        {"title": ["PHGDH in cancer metabolism"], "type": "component", "DOI": "10.5/xyz.s001"},
        {"title": ["Review of: PHGDH in cancer metabolism"], "type": "peer-review", "DOI": "10.5/r1"},
        {"title": ["PHGDH inhibitor screen data"], "type": "dataset", "DOI": "10.5/d1"},
        {"title": ["PHGDH inhibitors in cancer"], "type": "dissertation", "DOI": "10.5/t1"},
        {"title": ["PHGDH inhibitors, untyped"], "DOI": "10.5/u1"},
    ]}}})
    items = asyncio.run(fetch_crossref(client, "PHGDH", 10))

    assert len(items) == 1
    it = items[0]
    assert it.id == "crossref:10.5-xyz"
    assert it.source == "crossref"
    assert it.title == "PHGDH in cancer metabolism"
    assert it.summary == "Published in Journal of X."
    assert it.url == "https://doi.org/10.5/xyz"
    assert it.date_iso == "2024-03-07T00:00:00.000Z"
    assert it.signal is None                        # Crossref has no metric
    assert it.doi == "10.5/xyz"
    assert it.dedupe_key == "doi:10.5/xyz"


def test_crossref_keeps_conference_papers_and_preprints():
    client = _FakeClient({"api.crossref.org": {"message": {"items": [
        {"title": ["PHGDH inhibitors in cancer: a conference paper"], "type": "proceedings-article", "DOI": "10.5/p1"},
        {"title": ["PHGDH inhibitors in cancer: a preprint"], "type": "posted-content", "DOI": "10.5/pp1"},
    ]}}})
    items = asyncio.run(fetch_crossref(client, "PHGDH", 10))
    assert sorted(i.doi for i in items) == ["10.5/p1", "10.5/pp1"]
    assert all(i.kind == "paper" for i in items)   # Crossref preprints land in Papers


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
