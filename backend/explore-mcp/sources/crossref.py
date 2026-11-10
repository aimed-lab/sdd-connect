"""
sources/crossref.py — Crossref works fetcher.

Port of the original TypeScript Crossref fetcher. Same URL, same field mapping,
same blank-title drop, and a `type` guard that keeps article-like records only
(see _CROSSREF_ARTICLE_TYPES; everything else is dropped at fetch time). Crossref exposes no ranking metric, so every
Item's `signal` stays None.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from dedupe import dedupe_key, normalize_doi
from models import Item

from .base import filter_quality, get_json, to_iso

# Crossref `type` values kept: journal articles and conference papers. Every
# other type is dropped at fetch time: books and chapters, and also components
# (supplementary files), peer reviews, datasets and dissertations, which carry
# an article's title but usually no date and no authors.
# "posted-content" (preprints) is kept as before; it lands in Papers.
_CROSSREF_ARTICLE_TYPES = {"journal-article", "proceedings-article", "posted-content"}


async def fetch_crossref(
    client: httpx.AsyncClient, term: str, cap: int, since_year: int | None = None
) -> list[Item]:
    # No sort parameter: Crossref then orders by relevance to the query. With
    # sort=published the page was the newest records matching ANY query word.
    url = f"https://api.crossref.org/works?query={quote(term)}&rows={cap}"
    if since_year is not None:
        url += f"&filter=from-pub-date:{since_year}-01-01"
    data = await get_json(client, url)

    items: list[Item] = []
    for w in ((data or {}).get("message") or {}).get("items") or []:
        titles = w.get("title") or []
        if not titles or not titles[0]:   # blank-title drop
            continue
        if (w.get("type") or "").lower() not in _CROSSREF_ARTICLE_TYPES:
            continue

        parts = ((w.get("issued") or {}).get("date-parts") or [[]])[0]
        if parts:
            month = str(parts[1] if len(parts) > 1 else 1).zfill(2)
            day = str(parts[2] if len(parts) > 2 else 1).zfill(2)
            iso_date = to_iso(f"{parts[0]}-{month}-{day}")
        else:
            iso_date = to_iso("")

        title = titles[0]
        venue = (w.get("container-title") or [None])[0]
        doi_raw = w.get("DOI")
        doi = normalize_doi(doi_raw)  # Crossref DOI is already the bare "10.x" form
        url_val = w.get("URL") or (f"https://doi.org/{doi_raw}" if doi_raw else "https://search.crossref.org")
        external_id = (doi_raw or "unknown").replace("/", "-")

        items.append(
            Item(
                id=f"crossref:{external_id}",
                kind="paper",
                title=title,
                summary=f"Published in {venue}." if venue else "Indexed in Crossref.",
                url=url_val,
                doi=doi,
                source="crossref",
                date_iso=iso_date,
                signal=None,  # Crossref gives no ranking metric
                dedupe_key=dedupe_key(url_val, title, doi),
                raw=w,
            )
        )
    return filter_quality(items)
