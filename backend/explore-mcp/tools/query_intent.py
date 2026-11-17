"""
tools/query_intent.py — deterministic reading of a natural-language question.

No LLM, no network. Used by the `only_kinds` path of tools/explore.py (a user
who picked a scope such as "Trials"), where the typed sentence used to be sent
verbatim to every source: "ALS clinical trials recruiting now" searched
ClinicalTrials.gov for all five words and got back unrelated trials.

`parse()` splits a question into:
  * FILTERS read from a closed word list — "recruiting" -> trial status,
    "newest"/"latest" -> recency, "approved" -> approvals intent. Never inferred
    from anything else, so a wrong strip is visible in `interpreted` and easy to
    reason about.
  * a LOCATION ("in Alabama"), recorded but not applied (no source here filters
    by place yet), so the UI can say so instead of silently dropping it;
  * the CORE text with filler ("competitive landscape", "clinical trials",
    "tools and databases") removed;
  * a deterministic SCOPE (same five keys as explore's LLM scope) built from the
    ABBREVIATIONS table, gene-symbol and variant patterns, drug-name suffixes and
    disease head words. It is the fallback when the LLM scope call is disabled,
    fails or takes longer than its timeout.

`refine_scope()` cleans an LLM scope with the same rules, `entities()` lists the
entities to show and to fall back on, and `mentions_any()` is the relevance gate:
a plain token match on fields the source already returned.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SCOPE_KEYS = ["topics", "genes", "diseases", "assets", "methods"]

# Seed abbreviation / synonym table: (abbreviation as written, expansion, scope
# key, extra aliases). Matched case-SENSITIVELY on whole words, so "AD" expands
# but "ad" does not. Ambiguous short forms (MS, HD, CF, RA, UC, ALL, MM) are left
# out on purpose; add them only with a disambiguating pattern.
ABBREVIATIONS: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("ALS", "amyotrophic lateral sclerosis", "diseases", ()),
    ("TNBC", "triple-negative breast cancer", "diseases", ()),
    ("NSCLC", "non-small cell lung cancer", "diseases", ()),
    ("SCLC", "small cell lung cancer", "diseases", ()),
    ("AD", "Alzheimer's disease", "diseases", ("Alzheimer",)),
    ("PD", "Parkinson's disease", "diseases", ("Parkinson",)),
    ("AML", "acute myeloid leukemia", "diseases", ()),
    ("CLL", "chronic lymphocytic leukemia", "diseases", ()),
    ("CML", "chronic myeloid leukemia", "diseases", ()),
    ("DLBCL", "diffuse large B-cell lymphoma", "diseases", ()),
    ("HCC", "hepatocellular carcinoma", "diseases", ()),
    ("CRC", "colorectal cancer", "diseases", ()),
    ("PDAC", "pancreatic ductal adenocarcinoma", "diseases", ("pancreatic cancer",)),
    ("RCC", "renal cell carcinoma", "diseases", ()),
    ("GBM", "glioblastoma", "diseases", ()),
    ("IPF", "idiopathic pulmonary fibrosis", "diseases", ()),
    ("COPD", "chronic obstructive pulmonary disease", "diseases", ()),
    ("NASH", "nonalcoholic steatohepatitis", "diseases", ("MASH",)),
    ("MASH", "metabolic dysfunction-associated steatohepatitis", "diseases", ("NASH",)),
    ("T2D", "type 2 diabetes", "diseases", ()),
    ("T1D", "type 1 diabetes", "diseases", ()),
    ("DMD", "Duchenne muscular dystrophy", "diseases", ()),
    ("SMA", "spinal muscular atrophy", "diseases", ()),
    ("SLE", "systemic lupus erythematosus", "diseases", ("lupus",)),
    ("IBD", "inflammatory bowel disease", "diseases", ()),
    ("HFpEF", "heart failure with preserved ejection fraction", "diseases", ()),
    ("COVID-19", "COVID-19", "diseases", ("SARS-CoV-2",)),
    ("HIV", "HIV", "diseases", ("human immunodeficiency virus",)),
    ("GLP-1 RA", "GLP-1 receptor agonist", "assets", ("GLP-1", "semaglutide", "tirzepatide", "liraglutide")),
    ("GLP-1", "GLP-1", "assets", ("glucagon-like peptide-1", "semaglutide", "tirzepatide", "liraglutide")),
    ("ADC", "antibody-drug conjugate", "assets", ()),
    ("CAR-T", "CAR T-cell therapy", "assets", ("CAR T", "chimeric antigen receptor")),
    ("scRNA-seq", "single-cell RNA-seq", "methods", ("single-cell",)),
]

# Upper-case words that look like gene symbols but are not.
_NOT_GENES = {
    "FDA", "EMA", "US", "USA", "UK", "EU", "AI", "ML", "NLP", "LLM", "DNA", "RNA",
    "ADMET", "QSAR", "CRISPR", "NGS", "PK", "IC50", "NIH", "NCI", "II", "III", "IV",
    "OR", "AND", "NOT", "THE", "MOA", "SAR", "HTS", "PET", "MRI", "CT", "IND", "NDA",
    "BLA", "ASO", "SIRNA", "PROTAC", "PROTACS", "ADCS", "RCT", "RCTS", "NCT",
}

# Trial-status words -> ClinicalTrials.gov overallStatus values.
_RECRUITING = ["RECRUITING", "NOT_YET_RECRUITING"]
_ACTIVE = ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING"]
_COMPLETED = ["COMPLETED"]

_STATUS_PATTERNS: list[tuple[re.Pattern, list[str], str]] = [
    (re.compile(r"\b(?:currently\s+|now\s+)?(?:recruiting|enrolling)(?:\s+(?:now|currently|patients))?\b", re.I),
     _RECRUITING, "Recruiting"),
    (re.compile(r"\bopen\s+(?=(?:clinical\s+)?(?:trials?|studies)\b)", re.I), _RECRUITING, "Recruiting"),
    (re.compile(r"\b(?:currently\s+)?(?:active|ongoing)\s+(?=(?:clinical\s+)?(?:trials?|studies)\b)", re.I),
     _ACTIVE, "Active"),
    (re.compile(r"\b(?:completed|finished)\s+(?=(?:clinical\s+)?(?:trials?|studies)\b)", re.I), _COMPLETED, "Completed"),
    (re.compile(r"(?<=trials\s)(?:that\s+(?:are|have)\s+)?completed\b", re.I), _COMPLETED, "Completed"),
]
_RECENCY = re.compile(r"\b(?:the\s+)?(?:newest|latest|most\s+recent|recent)\b", re.I)
_APPROVED = re.compile(r"\b(?:FDA[\s-]+)?(?:approved|approvals?)\b(?:\s+by\s+the\s+FDA)?", re.I)

_PLACES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
    "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
    "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
    "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
    "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
    "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming", "the United States",
    "United States", "the US", "the USA", "the UK", "Europe", "Canada", "China", "Japan",
    "Germany", "France", "Australia", "India", "Birmingham",
]
_LOCATION = re.compile(
    r"\b(?:in|near|around|within)\s+(" + "|".join(sorted(map(re.escape, _PLACES), key=len, reverse=True)) + r")\b",
)

# "drug" is filler on its own ("KRAS drugs") but part of the topic in a field
# name ("drug discovery", "drug repurposing"), so it stays before these nouns.
_DRUG_HEAD_NOUNS = (
    r"discovery|repurposing|repositioning|development|design|delivery|resistance|"
    r"screening|safety|targets?|interactions?|combinations?|metabolism|toxicity|response"
)

# Words that describe what kind of result is wanted, not what it is about.
_FILLER = re.compile(
    r"\b(?:competitive\s+landscape|landscape|pipeline|overview|state\s+of\s+the\s+art|"
    r"clinical\s+trials?|trials?|clinical\s+studies|studies|study|"
    r"papers?|articles?|publications?|preprints?|literature|reviews?|research|"
    r"tools?\s+and\s+databases|tools?|databases?|software|resources?|datasets?|"
    r"news|headlines|updates?|drugs?(?![\w-])(?!\s+(?:" + _DRUG_HEAD_NOUNS + r")\b)|"
    r"what\s+are|show\s+me|find\s+me|find|list|search\s+for|look\s+for|"
    r"currently|right\s+now|now|today|this\s+year)\b",
    re.I,
)
_EDGE_WORDS = {"on", "for", "of", "in", "about", "and", "with", "the", "a", "an", "to", "by", "any", "all", "that", "are", "is", "which"}

_VARIANT = re.compile(r"^[A-Z]\d{1,4}(?:[A-Z]|del|ins|fs)$")
_GENE = re.compile(r"^[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]{1,4})?$")
_DRUG_SUFFIX = re.compile(
    r"\b[a-z]{3,}(?:mab|tinib|rafenib|ciclib|lisib|parib|rasib|glutide|enatide|tirzepatide|siran|ersen)\b",
    re.I,
)
_DISEASE_HEADS = (
    "cancer|cancers|carcinoma|adenocarcinoma|tumou?rs?|neoplasms?|disease|syndrome|sclerosis|"
    "leukemia|leukaemia|lymphoma|myeloma|melanoma|glioma|glioblastoma|sarcoma|diabetes|"
    "obesity|fibrosis|dystrophy|atrophy|arthritis|hypertension|hypercholesterolemia|"
    "asthma|dementia|epilepsy|depression|schizophrenia|psoriasis|colitis|hepatitis|"
    "steatohepatitis|infection|failure"
)
_DISEASE_HEAD = re.compile(r"\b(?:" + _DISEASE_HEADS + r")\b", re.I)
_TOKEN = re.compile(r"[a-z0-9]+")
_GATE_STOPWORDS = {"the", "of", "and", "with", "in", "for", "a", "an", "s"}


@dataclass
class Intent:
    text: str
    core: str
    status_filter: list[str] = field(default_factory=list)
    status_label: str | None = None
    recency: bool = False
    approved: bool = False
    location: str | None = None
    scope: dict = field(default_factory=dict)
    # gene symbol -> "GENE VARIANT" phrase seen in the text, e.g. KRAS -> KRAS G12C
    variants: dict = field(default_factory=dict)
    # lower-cased term -> alias list, from the ABBREVIATIONS table
    aliases: dict = field(default_factory=dict)


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _trim_edges(text: str) -> str:
    words = _collapse(text.strip(" ,;:.?!-")).split(" ")
    while words and words[0].lower() in _EDGE_WORDS:
        words.pop(0)
    while words and words[-1].lower() in _EDGE_WORDS:
        words.pop()
    return " ".join(w for w in words if w).strip(" ,;:.?!-")


def strip_filler(phrase: str) -> str:
    """Remove intent, status, location and filler words from a phrase."""
    text = phrase
    for pattern, _status, _label in _STATUS_PATTERNS:
        text = pattern.sub(" ", text)
    text = _RECENCY.sub(" ", text)
    text = _APPROVED.sub(" ", text)
    text = _LOCATION.sub(" ", text)
    text = _FILLER.sub(" ", text)
    return _trim_edges(text)


def _abbr_pattern(abbr: str) -> re.Pattern:
    tail = r"(?![-\w])" if abbr == "PD" else r"(?![\w-])"
    return re.compile(r"(?<![\w-])" + re.escape(abbr) + tail)


_ABBR_PATTERNS = [(_abbr_pattern(a), a, exp, key, aliases) for a, exp, key, aliases in ABBREVIATIONS]
_EXPANSION_PATTERNS = [
    (re.compile(r"\b" + re.escape(exp) + r"\b", re.I), a, exp, key, aliases)
    for a, exp, key, aliases in ABBREVIATIONS if exp.lower() != a.lower()
]


def _add(scope: dict, key: str, term: str) -> None:
    term = _collapse(term or "").strip()
    if term and term.lower() not in {t.lower() for t in scope[key]}:
        scope[key].append(term)


def _record_aliases(aliases: dict, abbr: str, exp: str, extra: tuple[str, ...]) -> None:
    group = [t for t in (abbr, exp, *extra) if t]
    for term in (abbr, exp):
        bucket = aliases.setdefault(term.lower(), [])
        for t in group:
            if t.lower() != term.lower() and t not in bucket:
                bucket.append(t)


def expand_abbreviation(term: str) -> tuple[str, str] | None:
    """(expansion, scope key) when `term` is exactly a known abbreviation."""
    for pattern, abbr, exp, key, _aliases in _ABBR_PATTERNS:
        if term.strip() == abbr:
            return exp, key
    return None


def parse(text: str) -> Intent:
    raw = _collapse(text or "")
    intent = Intent(text=raw, core="", scope={k: [] for k in SCOPE_KEYS})

    for pattern, status, label in _STATUS_PATTERNS:
        if pattern.search(raw):
            intent.status_filter, intent.status_label = list(status), label
            break
    intent.recency = bool(_RECENCY.search(raw))
    intent.approved = bool(_APPROVED.search(raw))
    loc = _LOCATION.search(raw)
    if loc:
        intent.location = loc.group(1)

    core = strip_filler(raw)
    intent.core = core
    scope = intent.scope

    remainder = core
    for pattern, abbr, exp, key, aliases in _ABBR_PATTERNS:
        if pattern.search(remainder):
            _add(scope, key, exp)
            _record_aliases(intent.aliases, abbr, exp, aliases)
            remainder = pattern.sub(" ", remainder)
    for pattern, abbr, exp, key, aliases in _EXPANSION_PATTERNS:
        if pattern.search(remainder):
            _add(scope, key, exp)
            _record_aliases(intent.aliases, abbr, exp, aliases)
            remainder = pattern.sub(" ", remainder)

    words = remainder.split()
    for i, word in enumerate(words):
        token = word.strip(",;:.?!()")
        if not _GENE.match(token) or _VARIANT.match(token) or token in _NOT_GENES:
            continue
        if not re.search(r"[A-Z]{2}|\d", token):
            continue
        _add(scope, "genes", token)
        nxt = words[i + 1].strip(",;:.?!()") if i + 1 < len(words) else ""
        if _VARIANT.match(nxt):
            intent.variants[token] = f"{token} {nxt}"

    for m in _DRUG_SUFFIX.finditer(remainder):
        _add(scope, "assets", m.group(0).lower())

    gene_set = {g.lower() for g in scope["genes"]}
    for m in _DISEASE_HEAD.finditer(remainder):
        before = remainder[: m.start()].split()
        lead: list[str] = []
        for w in reversed(before[-3:]):
            bare = w.strip(",;:.?!()")
            if bare.lower() in _EDGE_WORDS or bare.lower() in gene_set or _VARIANT.match(bare):
                break
            lead.insert(0, bare)
        phrase = " ".join(lead + [m.group(0)])
        if not any(phrase.lower() in d.lower() or d.lower() in phrase.lower() for d in scope["diseases"]):
            _add(scope, "diseases", phrase)

    if core:
        _add(scope, "topics", core)
    return intent


def is_raw_echo(scope: dict, text: str) -> bool:
    """True when an LLM scope found no entity at all (everything empty, or the
    whole question copied into topics)."""
    if any(scope.get(k) for k in ("genes", "diseases", "assets", "methods")):
        return False
    topics = [t.lower() for t in scope.get("topics") or []]
    return not topics or topics == [_collapse(text).lower()]


def refine_scope(llm_scope: dict, intent: Intent) -> dict:
    """Clean an LLM scope with the deterministic rules: expand abbreviations,
    strip filler from free-text phrases, and add the entities the deterministic
    parse found that the LLM missed. An LLM scope that found nothing falls back
    to the deterministic one."""
    if not isinstance(llm_scope, dict) or is_raw_echo(llm_scope, intent.text):
        return {k: list(intent.scope.get(k) or []) for k in SCOPE_KEYS}

    out: dict[str, list[str]] = {k: [] for k in SCOPE_KEYS}
    for key in SCOPE_KEYS:
        for term in llm_scope.get(key) or []:
            term = str(term).strip()
            expanded = expand_abbreviation(term)
            if expanded:
                exp, exp_key = expanded
                _add(out, exp_key, exp)
                continue
            cleaned = strip_filler(term) if key in ("topics", "methods") else term
            expanded = expand_abbreviation(cleaned)
            if expanded:
                _add(out, expanded[1], expanded[0])
            elif cleaned:
                _add(out, key, cleaned)
    for key in ("genes", "diseases", "assets", "methods"):
        for term in intent.scope.get(key) or []:
            _add(out, key, term)

    entity_lower = {t.lower() for k in ("genes", "diseases", "assets", "methods") for t in out[k]}
    abbrs = {a.lower() for a, *_ in ABBREVIATIONS}
    out["topics"] = [t for t in out["topics"] if t.lower() not in entity_lower and t.lower() not in abbrs]
    if not out["topics"] and intent.core and intent.core.lower() not in entity_lower | abbrs:
        out["topics"] = [intent.core]
    return out


def entities(scope: dict, intent: Intent) -> list[str]:
    """What was searched for, in display order: genes (with a variant when one
    was typed), assets, diseases, methods. Falls back to the core text."""
    out: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        if term and term.lower() not in seen:
            seen.add(term.lower())
            out.append(term)

    for gene in scope.get("genes") or []:
        add(intent.variants.get(gene, gene))
    for key in ("assets", "diseases", "methods"):
        for term in scope.get(key) or []:
            add(term)
    if not out and intent.core:
        add(intent.core)
    return out


def shortest_entity(scope: dict, intent: Intent) -> str:
    ents = entities(scope, intent)
    if not ents:
        return ""
    return min(ents, key=lambda t: (len(t.split()), len(t)))


def gate_terms(scope: dict, intent: Intent) -> list[list[str]]:
    """Alias groups for the relevance gate: genes, assets and diseases (not
    methods or free-text topics). [] means no gate."""
    groups: list[list[str]] = []
    for key in ("genes", "assets", "diseases"):
        for term in scope.get(key) or []:
            group = [term, *intent.aliases.get(term.lower(), [])]
            groups.append(group)
    return groups


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(text.lower().replace("'", "")))


def _term_tokens(term: str) -> set[str]:
    return {t for t in _TOKEN.findall(term.lower().replace("'", "")) if t not in _GATE_STOPWORDS}


def item_text(item: dict) -> str:
    parts = [item.get("title") or "", item.get("summary") or ""]
    raw = item.get("raw") or {}
    if isinstance(raw, dict):
        for key in ("interventions", "conditions", "lead_sponsor"):
            value = raw.get(key)
            if isinstance(value, list):
                parts.extend(str(v) for v in value)
            elif value:
                parts.append(str(value))
    return " ".join(parts)


def mentions_any(item: dict, groups: list[list[str]]) -> bool:
    """True when the item's own text names at least one entity (or an alias):
    every word of the term appears in the title/summary/listed fields."""
    if not groups:
        return True
    words = _tokens(item_text(item))
    for group in groups:
        for term in group:
            needed = _term_tokens(term)
            if needed and needed <= words:
                return True
    return False
