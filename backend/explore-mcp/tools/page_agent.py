"""
tools/page_agent.py — the PAGE agent: the same search -> wiki-note-writing ->
evidence-filing pipeline tools/project_agent.py already runs for a project,
but seeded from a bare TOPIC STRING instead of a project's
name/description/target/indication/modality/stage.

WHY A NEW FILE, NOT A CHANGE TO project_agent.py: this task is additive-only —
tools/project_agent.py and its run_project_agent_async() are left completely
untouched. This module is a thin wrapper: it builds the minimal "goal text"/
"goal summary" a bare topic can support, then calls the exact same building
blocks project_agent.py already exports (build_wiki_notes/file_evidence/
split_unfiled/suggest_missing_notes from tools/wiki_agent.py, and
explore_async from tools/explore.py) so there is exactly one implementation
of "search a goal and write wiki notes for it" in this codebase, not two.

NO CHECKLIST, NO DIGEST, NO RELEVANCE-PASS SELECTION. A page has no
target/indication/modality/stage and nothing analogous to a project's
Resources/Checklist review-and-accept UI — see CLAUDE.md's "IT PROPOSES; THE
FRONTEND PERSISTS" note, which doesn't apply here since a page's frontend
route persists directly (no human review step for a topic-seeded page). This
module skips project_agent.py's step 2 (relevance ranking for a save-review
list) and step 3 (checklist proposal) entirely — a wiki page only needs the
candidate pool for wiki-note-writing and evidence-filing, both of which
operate on the full candidate list, not a ranked top-8.

TOPIC GATE. What there is instead is a plain on-topic check (apply_topic_gate,
below): both the first build and every refresh drop candidates that don't
name the page's gene/drug, disease or topic, before anything is written or
filed. Its counts come back as `topic_gate` / `gate_kept` / `gate_dropped`.
"""

from __future__ import annotations

import logging
import re

from tools.explore import explore_async
from tools.abstracts import enrich_abstracts
from tools.page_notes import build_page_notes
from tools.wiki_agent import curate_evidence_item, file_evidence, split_unfiled, suggest_missing_notes

logger = logging.getLogger(__name__)

# Same cap tools/project_agent.py uses for its own candidate pool, so a page
# seeded from a very broad topic doesn't hand wiki_agent.py an unbounded list.
MAX_CANDIDATES = 60

# Same kind exclusion as project_agent.py's own _AGENT_EXCLUDED_KINDS — see
# that module's docstring for why "episode" specifically is dropped from an
# agent's own candidate pool (podcast-derived wiki pages, not useful as
# evidence for a note).
_AGENT_EXCLUDED_KINDS = {"episode"}


def _page_goal_text(topic: str) -> str:
    """The minimal equivalent of project_agent.py's _project_goal_text() for
    a bare topic — a page has no name/description/target/indication/modality/
    stage to combine, just the raw topic string the caller typed. explore_async
    already treats free text as "name. description"-shaped input (see that
    module's own docstring and tools/project_agent.py's step 1 note); a lone
    topic string satisfies that shape trivially (no second sentence)."""
    return (topic or "").strip()


def _page_goal_summary(topic: str) -> str:
    """The minimal equivalent of project_agent.py's _goal_summary() — one
    line describing what's being researched, used the same way there: to
    justify wiki-note picks against, and to shape the run's own summary
    text."""
    return (topic or "").strip()


def _flatten_candidates(explore_result: dict, max_candidates: int = 0) -> tuple[list[dict], list[str], int]:
    """Same round-robin-across-sections flattening as project_agent.py's own
    _flatten_candidates, minus the excluded_ids drop — a page has no
    "already saved" set to exclude candidates against (no Resources list
    exists for a page). See that function's own docstring for why round-
    robin, not a flat slice, is used here. Returns (items, failed_tool_names,
    timed_out_tool_names, total_found). A timed-out section (explore.py's
    per-tool cap) comes back empty with `timed_out`, not `error`."""
    seen: set[str] = set()
    failed: list[str] = []
    timed_out: list[str] = []

    per_section: list[list[dict]] = []
    for section in explore_result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        if section.get("kind") in _AGENT_EXCLUDED_KINDS:
            continue
        if section.get("error"):
            failed.append(section.get("tool") or section.get("kind") or "unknown")
        if section.get("timed_out"):
            timed_out.append(section.get("tool") or section.get("kind") or "unknown")
        bucket: list[dict] = []
        for item in section.get("items") or []:
            item_id = item.get("id")
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            bucket.append(item)
        if bucket:
            per_section.append(bucket)

    items: list[dict] = []
    row = 0
    while per_section and (max_candidates <= 0 or len(items) < max_candidates):
        advanced = False
        for bucket in per_section:
            if row >= len(bucket):
                continue
            items.append(bucket[row])
            advanced = True
            if 0 < max_candidates <= len(items):
                break
        if not advanced:
            break
        row += 1

    return items, failed, timed_out, len(seen)


# ── Topic gate ──────────────────────────────────────────────────────────────
# The sources match loosely: PubMed splits "ovarian cancer" into "ovarian" AND
# "cancer" anywhere in the record, and ClinicalTrials.gov's condition search
# also matches a trial's keywords. Without a check, a breast cancer paper that
# mentions "ovarian function suppression", a polycystic ovarian syndrome trial
# and a urothelial basket trial all landed on an "Ovarian Cancer" page. This
# gate keeps an item only when it is plainly about the page's topic, judged
# against the scope explore_async already extracted (no extra LLM call, no
# extra request).
#
# Only scope terms that literally appear in the page's topic text are trusted
# (see gate_terms); then, most specific level first (the first level with such
# a term is used; with none, the scope's disease terms as extracted):
#   1. "entity": scope genes + assets (gene / target / drug / compound). The
#      term must appear as a whole word in the title or the summary.
#   2. "disease": scope diseases. Every word of the term in the TITLE (light
#      stemming, see _stem), or the exact phrase in the summary, or (trials)
#      every word in one entry of the trial's own conditions list when the
#      item carries one (raw["conditions"]; keywords never count).
#   3. "topic": scope topics, judged with the disease rule.
#   No term at any level: no gate, everything is kept (as before the gate).
# Several terms at the chosen level: matching any one passes. With a gate on,
# an item with neither a title nor a summary is dropped.

_GATE_LEVELS = (("entity", ("genes", "assets")), ("disease", ("diseases",)), ("topic", ("topics",)))

# A run that had at least this many candidates and kept none is logged as a
# WARNING: the extracted terms are more likely wrong than the whole pool.
GATE_ALL_DROPPED_WARN_AT = 10

_CANCER_WORDS = {
    "cancer", "cancers", "carcinoma", "carcinomas", "tumor", "tumors", "tumour",
    "tumours", "neoplasm", "neoplasms",
}
# Words inside a disease term that carry no meaning of their own.
_FILLER_WORDS = {"of", "the", "and", "in", "with", "a", "an", "or", "for", "to"}
_WORD_RE = re.compile(r"[a-z0-9]+")
_EDGE_L = r"(?<![A-Za-z0-9])"
_EDGE_R = r"(?![A-Za-z0-9])"


def _stem(word: str) -> str:
    """Light stemming for the disease rule: the cancer synonyms count as one
    word, ovary / ovarian / ovaries as one, and a plain plural "s" is dropped."""
    if word in _CANCER_WORDS:
        return "cancer"
    if word.startswith("ovar"):
        return "ovar"
    if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _stems(text: str) -> set[str]:
    return {_stem(w) for w in _WORD_RE.findall((text or "").lower())}


def _term_words(term: str) -> set[str]:
    return {_stem(w) for w in _WORD_RE.findall(term.lower()) if w not in _FILLER_WORDS}


def _phrase_pattern(term: str, plural: bool) -> str:
    body = r"\s+".join(re.escape(p) for p in term.split())
    return _EDGE_L + body + (r"s?" if plural else "") + _EDGE_R


def _whole_word(term: str, text: str) -> bool:
    """`term` as a whole word (or phrase), case-insensitive. Edge lookarounds
    rather than \\b so "KRAS G12C" or "5-FU" still match cleanly."""
    return re.search(_phrase_pattern(term, False), text or "", re.IGNORECASE) is not None


def _exact_phrase(term: str, text: str) -> bool:
    """The phrase itself, whitespace-tolerant, a plural "s" allowed at the end."""
    return re.search(_phrase_pattern(term, True), text or "", re.IGNORECASE) is not None


def _trial_conditions(item: dict) -> list[str]:
    raw = item.get("raw") if isinstance(item.get("raw"), dict) else {}
    conds = raw.get("conditions") or item.get("conditions") or []
    return [c for c in conds if isinstance(c, str)] if isinstance(conds, list) else []


def _plain_words(text: str) -> list[str]:
    """Lower-cased words with a plain plural "s" dropped, for the topic-text check."""
    out = []
    for w in _WORD_RE.findall((text or "").lower()):
        out.append(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w)
    return out


def _in_topic_text(term: str, topic: str) -> bool:
    """Does `term` literally appear in the page's topic text? Case-insensitive,
    plural "s" ignored, words contiguous and in order."""
    tw, pw = _plain_words(term), _plain_words(topic)
    if not tw:
        return False
    return any(pw[i:i + len(tw)] == tw for i in range(len(pw) - len(tw) + 1))


def _level_terms(scope: dict, level: str, keys: tuple[str, ...]) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for key in keys:
        for t in scope.get(key) or []:
            t = t.strip() if isinstance(t, str) else ""
            if t and t.lower() not in seen and (level == "entity" or _term_words(t)):
                seen.add(t.lower())
                terms.append(t)
    return terms


def gate_terms(scope: dict | None, topic: str) -> tuple[str | None, list[str], list[str]]:
    """(level, terms, ignored) the gate checks; (None, [], ignored) for no gate.

    The scope comes from an LLM extraction, which can add terms the person
    never typed (a gene like BRCA1 for an "Ovarian Cancer" page, which would
    then gate on BRCA1). So at each level only terms that literally appear in
    the page's topic text are trusted, most specific level first. When no
    level has such a term but the scope has disease terms, those are used as
    extracted (the extraction may have normalised the wording, e.g. "NSCLC"
    -> "non-small cell lung cancer"). `ignored` is every scope term left out
    for not being in the topic text."""
    scope = scope or {}
    by_level = [(level, _level_terms(scope, level, keys)) for level, keys in _GATE_LEVELS]
    ignored = [t for _, terms in by_level for t in terms if not _in_topic_text(t, topic)]
    for level, terms in by_level:
        literal = [t for t in terms if _in_topic_text(t, topic)]
        if literal:
            return level, literal, ignored
    diseases = dict(by_level)["disease"]
    if diseases:
        return "disease", diseases, [t for t in ignored if t not in diseases]
    return None, [], ignored


def item_on_topic(item: dict, level: str, terms: list[str]) -> bool:
    """Does this item pass the gate for (level, terms)? See the block comment."""
    title = (item.get("title") or "").strip()
    summary = (item.get("summary") or "").strip()
    if not title and not summary:
        return False
    if level == "entity":
        return any(_whole_word(t, title) or _whole_word(t, summary) for t in terms)
    title_stems = _stems(title)
    conditions = _trial_conditions(item) if item.get("kind") == "trial" else []
    for t in terms:
        words = _term_words(t)
        if words <= title_stems or _exact_phrase(t, summary):
            return True
        if any(words <= _stems(c) for c in conditions):
            return True
    return False


def apply_topic_gate(topic: str, scope: dict | None, items: list[dict], run: str) -> tuple[list[dict], dict]:
    """Keep the on-topic items, order kept. Logs one line per run and returns
    (kept_items, report), report = {level, terms, ignored_terms, candidates,
    kept, dropped}."""
    level, terms, ignored = gate_terms(scope, topic)
    kept = list(items) if level is None else [i for i in items if item_on_topic(i, level, terms)]
    report = {
        "level": level,
        "terms": terms,
        "ignored_terms": ignored,
        "candidates": len(items),
        "kept": len(kept),
        "dropped": len(items) - len(kept),
    }
    msg = ("%s topic gate: topic=%r level=%s terms=%r ignored_not_in_topic=%r "
           "candidates=%d kept=%d dropped=%d")
    args = (run, topic, level or "none", terms, ignored,
            report["candidates"], report["kept"], report["dropped"])
    if level is not None and not kept and len(items) >= GATE_ALL_DROPPED_WARN_AT:
        logger.warning(msg + " (dropped everything; the terms may be wrong)", *args)
    else:
        logger.info(msg, *args)
    return kept, report


async def run_page_agent_async(topic: str) -> dict:
    """Run the page pipeline for one bare topic string. Mirrors
    run_project_agent_async's own WIKI NOTES + EVIDENCE FILING stages
    verbatim (same wiki_agent.py functions, same "filed against notes as
    they'll look after this run's create/update proposals land, keyed by
    slug" wiring — see that function's own docstring) — this function exists
    only because a page has no project to read a goal or existing notes
    from, so there is nothing else here to change.

    `existing_notes` is always [] — a brand-new page always starts with no
    notes; there is no "page already exists, refresh it" caller yet (a page
    is created once per POST /api/pages call, see server.py's route below).

    Returns:
      {
        summary: str,
        wiki_notes: [{action, note_id, slug, title, note_type, body}],
        evidence_filings: {slug: [{item, shared_terms}]},
        unfiled_items: [item],
        project_level_items: [item],   # named for parity with the project
                                        # agent's own output shape (a
                                        # grant/trial that matched no note) —
                                        # frontend/lib/server/pages/pageEvidence.ts
                                        # treats it exactly like unfiled_items,
                                        # same as the project flow's own
                                        # persistence does
        missing_note_suggestions: [{term, count, item_ids}],
        candidates_found: int,
        tools_called: [str],
        warnings: [str],
        search_failed: bool,
      }

    Never raises for a normal upstream failure — every step degrades on its
    own, same resilience contract as run_project_agent_async."""
    warnings: list[str] = []
    goal_text = _page_goal_text(topic)
    goal_summary = _page_goal_summary(topic)

    try:
        explore_result = await explore_async(goal_text)
        search_failed = False
    except Exception:
        logger.exception("page_agent: search step failed entirely")
        explore_result = {"sections": [], "tools_called": [], "reasoning": None}
        search_failed = True

    if search_failed:
        warnings.append("The search step failed; no candidates were found.")

    candidates, failed_tools, timed_out_tools, candidates_found = _flatten_candidates(
        explore_result, max_candidates=MAX_CANDIDATES
    )
    if failed_tools:
        warnings.append(f"These sources didn't return results: {', '.join(failed_tools)}.")

    if timed_out_tools:
        warnings.append(f"These sources timed out and were skipped: {', '.join(timed_out_tools)}.")

    # Fill in missing abstracts first (best-effort, never raises).
    enrichment = await enrich_abstracts(candidates) if candidates else None

    # Off-topic items never become page sources or citations: gate the pool
    # before notes are written, with the abstracts just filled in.
    candidates, topic_gate = apply_topic_gate(topic, explore_result.get("scope"), candidates, "page_agent")

    # Numbered-citation note writing (tools/page_notes.py): the model only sees
    # evidence with a title + abstract, cites it as [n], and a code check
    # strips any [n] it wasn't given and drops notes left uncited. Evidence
    # filing is derived from those citations, not from word overlap.
    built = build_page_notes(goal_summary, candidates) if candidates else None
    wiki_notes: list[dict] = built["notes"] if built else []
    references: list[dict] = built["references"] if built else []
    citation_report: dict = built["report"] if built else {"removed_citations": [], "dropped_notes": [], "removed_sentences": []}
    if built and built["fallback"]:
        warnings.append("Couldn't write wiki notes for this topic this run.")
    if built and not built["evidence_given"]:
        warnings.append("No retrieved item had both a title and an abstract, so no notes were written.")

    evidence_filings: dict[str, list[dict]] = {}
    cited_ids: set[str] = set()
    for slug, cited in (built["cited_by_slug"] if built else {}).items():
        evidence_filings[slug] = []
        for n, item in cited:
            cited_ids.add(item["id"])
            evidence_filings[slug].append(
                {"item": curate_evidence_item(item), "shared_terms": [], "rationale": f"Cited as [{n}]"}
            )
    unfiled_all = [curate_evidence_item(c) for c in candidates if c.get("id") not in cited_ids]
    unfiled_items, project_level_items = split_unfiled(unfiled_all)
    missing_note_suggestions = suggest_missing_notes(unfiled_items)

    summary_bits = [f"Searched {len(explore_result.get('tools_called') or [])} sources for “{goal_summary}”."]
    if wiki_notes:
        summary_bits.append(f"Wrote {len(wiki_notes)} wiki note(s).")
    elif not candidates:
        summary_bits.append("Found nothing to write about this topic this run.")

    return {
        "summary": " ".join(summary_bits),
        "wiki_notes": wiki_notes,
        "evidence_filings": evidence_filings,
        "unfiled_items": unfiled_items,
        "project_level_items": project_level_items,
        "missing_note_suggestions": missing_note_suggestions,
        "candidates_found": candidates_found,
        "tools_called": explore_result.get("tools_called") or [],
        "references": references,
        "enrichment": enrichment,
        "candidates_in_pool": len(candidates),
        "citation_report": citation_report,
        "topic_gate": topic_gate,
        "gate_kept": topic_gate["kept"],
        "gate_dropped": topic_gate["dropped"],
        "warnings": warnings,
        "search_failed": search_failed,
    }


async def run_page_refresh_async(topic: str, known_item_ids: list[str], notes: list[dict]) -> dict:
    """The daily refresh of one existing page: the same search the page agent
    runs for its seed (explore_async on `topic`), minus everything the page
    already holds (`known_item_ids`, the ids already in page_evidence), with
    what is left filed under the page's EXISTING notes and a suggestion list
    for notes that may be missing.

    `notes` is [{slug, title, body}]. They are only READ, to decide which
    note each new item is evidence for (tools/wiki_agent.file_evidence);
    no note is written or rewritten here, so a human-edited note cannot be
    changed by a refresh. Never raises for an upstream failure: a failed
    search comes back as search_failed=True with no items.

    Returns {new_items, evidence_filings, unfiled_items, project_level_items,
    missing_note_suggestions, candidates_found, tools_called, topic_gate,
    gate_kept, gate_dropped, warnings, search_failed}; new_items are curated
    (curate_evidence_item shape) and have passed the topic gate."""
    warnings: list[str] = []
    try:
        explore_result = await explore_async(_page_goal_text(topic))
        search_failed = False
    except Exception:
        logger.exception("page_refresh: search step failed entirely")
        explore_result = {"sections": [], "tools_called": []}
        search_failed = True
        warnings.append("The search step failed; no candidates were found.")

    # No cap on the flatten: the cap would drop new items that rank below the
    # items the page already has. Cap AFTER removing the known ones.
    candidates, failed_tools, timed_out_tools, candidates_found = _flatten_candidates(explore_result)
    if failed_tools:
        warnings.append(f"These sources didn't return results: {', '.join(failed_tools)}.")
    if timed_out_tools:
        warnings.append(f"These sources timed out and were skipped: {', '.join(timed_out_tools)}.")

    known = set(known_item_ids or [])
    fresh = [c for c in candidates if c.get("id") not in known][:MAX_CANDIDATES]

    if fresh:
        await enrich_abstracts(fresh)  # best-effort, never raises

    # Only on-topic items become new page sources (see apply_topic_gate).
    fresh, topic_gate = apply_topic_gate(topic, explore_result.get("scope"), fresh, "page_refresh")

    usable_notes = [
        {"slug": n["slug"], "title": n.get("title") or "", "body": n.get("body") or ""}
        for n in (notes or [])
        if isinstance(n, dict) and n.get("slug")
    ]
    filings, unfiled_all = file_evidence(fresh, usable_notes)
    filings = {slug: items for slug, items in filings.items() if items}
    unfiled_items, project_level_items = split_unfiled(unfiled_all)

    return {
        "new_items": [curate_evidence_item(c) for c in fresh],
        "evidence_filings": filings,
        "unfiled_items": unfiled_items,
        "project_level_items": project_level_items,
        "missing_note_suggestions": suggest_missing_notes(unfiled_items),
        "candidates_found": candidates_found,
        "tools_called": explore_result.get("tools_called") or [],
        "topic_gate": topic_gate,
        "gate_kept": topic_gate["kept"],
        "gate_dropped": topic_gate["dropped"],
        "warnings": warnings,
        "search_failed": search_failed,
    }
