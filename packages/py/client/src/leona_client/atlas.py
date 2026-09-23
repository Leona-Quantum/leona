"""What an Atlas record says, read the way the site reads it.

Pure: no network, no MCP. `catalog.py` fetches rows; `leona_mcp.server` and this
package's own `client.py` turn these functions into tools/methods. Moved here from
`leona_mcp.atlas` in proposal 7 Phase D, unchanged, so `leona-mcp` and a plain
`leona_client.Client` answer Atlas questions identically.

Every rule here is a copy of a TypeScript rule in `apps/web`, and the TypeScript is
the source of truth:

- limit verdicts, stated cost, stated regime: `apps/web/lib/repository/finder.ts`
- problem areas (the "domain" facet) and their definitions:
  `apps/web/lib/repository/topics.ts`
- the fields free text is matched against: `apps/web/lib/repository/search.ts`
- verification tiers and method labels: `apps/web/lib/repository/verification.ts`
- OpenQASM 3 from a portable circuit: `openqasmOperation` and `generateBuilderCode`
  in `apps/web/lib/studio-builder.ts`, reached through `getPublicRepositoryVariant`
  in `apps/web/lib/repository/entry-variant.ts`

`tests/test_mirrors.py` reads those files and fails when a vocabulary copied here
stops matching them.

Two differences from the site, both deliberate:

1. **Free text matches any word, not the whole phrase.** `search.ts` matches the
   whole query as one substring. Here a query is split into words and a record
   matches when any of them appears (or all of them, when the caller asks), because
   an agent's query is usually a phrase that no record contains verbatim. How the
   site should rank matches is an open owner question (ai-ops 358), so nothing here
   ranks: results are sorted by slug.
2. **This reads the full record, not the list projection.** The site's finder
   takes its records from `getRepositoryListEntries()`, which reads
   `/v1/catalog/entries?view=list` when the catalog API is on, and that projection
   keeps only the `resources` row labelled "Qubits"
   (`LIST_VIEW_RESOURCE_LABELS` in `services/api/src/majorana_api/catalog_read_model.py`).
   The "Depth", "Reported cost", "Speedup class (secondary source)", "Primary source
   on the speedup" and "Readiness" rows that `finder.ts` reads are not in it. This
   module applies the same rules to the rows the record actually carries.

Nothing here invents a value. A field the record does not carry is reported as
`NOT_STATED`, and a limit a record does not state never excludes it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

NOT_STATED = "not stated in the record"

SITE_URL = "https://leonaqt.com"

#: The note every full record carries, in the words of the API contract
#: (`PublicCatalogEntry` in packages/py/contracts): the record is a claim from its
#: pinned source, not run evidence.
RECORD_IS_A_CLAIM = (
    "Everything here is quoted from the published Atlas record. The record is a claim "
    "from its cited sources, not a result this server checked or ran."
)

Verdict = Literal["satisfied", "not-stated", "violated"]
HardwareEra = Literal["any", "nisq", "fault-tolerant"]


def record_url(slug: str) -> str:
    return f"{SITE_URL}/repository/{slug}"


@dataclass(frozen=True)
class AtlasRow:
    """One row of `GET /v1/catalog/entries`: the typed envelope plus the record blob."""

    slug: str
    record: Mapping[str, Any]
    execution_state: str | None = None
    updated_at: str | None = None


def parse_rows(payload: object) -> tuple[list[AtlasRow], list[str]]:
    """Rows from a catalog listing, and the slugs of rows that could not be read.

    A row is kept when its `record` is an object with a string `title`. Anything else
    is dropped and named, the same way `parseCatalogEntries` in
    `apps/web/lib/repository/from-catalog.ts` drops a record it cannot trust rather
    than render it half-formed.
    """
    if not isinstance(payload, list):
        return [], ["<payload is not a list>"]
    rows: list[AtlasRow] = []
    rejected: list[str] = []
    for index, item in enumerate(payload):
        slug = item.get("slug") if isinstance(item, dict) else None
        label = slug if isinstance(slug, str) and slug else f"index:{index}"
        record = item.get("record") if isinstance(item, dict) else None
        if (
            not isinstance(slug, str)
            or not slug
            or not isinstance(record, dict)
            or not isinstance(record.get("title"), str)
        ):
            rejected.append(label)
            continue
        rows.append(
            AtlasRow(
                slug=slug,
                record=record,
                execution_state=_str_or_none(item.get("execution_state")),
                updated_at=_str_or_none(item.get("updated_at")),
            )
        )
    return rows, rejected


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _text(record: Mapping[str, Any], key: str) -> str | None:
    value = record.get(key)
    return value if isinstance(value, str) and value.strip() else None


# --------------------------------------------------------------------------------------
# Problem areas. Copied from the `facet: "domain"` members of PUBLIC_REPOSITORY_TOPICS in
# apps/web/lib/repository/topics.ts, in the same order. `finderProblemOptions` in
# finder.ts offers exactly this facet as the finder's problem picker.
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ProblemArea:
    id: str
    label: str
    definition: str


PROBLEM_AREAS: tuple[ProblemArea, ...] = (
    ProblemArea(
        "chemistry",
        "Chemistry",
        "Molecular electronic structure: ground-state energies of molecules.",
    ),
    ProblemArea(
        "materials",
        "Materials & magnetism",
        "Spin models, lattice Hamiltonians, and correlated electrons.",
    ),
    ProblemArea(
        "optimization",
        "Optimization",
        "Combinatorial objectives — cuts, assignments, schedules.",
    ),
    ProblemArea(
        "machine-learning",
        "Machine learning",
        "Classification and regression over encoded classical data.",
    ),
    ProblemArea("finance", "Finance", "Pricing, risk, and Monte-Carlo estimation."),
    ProblemArea(
        "linear-algebra",
        "Linear systems",
        "Solving Ax = b and applying functions of a matrix.",
    ),
    ProblemArea(
        "communication",
        "Communication",
        "Moving information between parties using entanglement.",
    ),
    ProblemArea(
        "metrology",
        "Metrology",
        "Sensing and interferometry beyond the shot-noise limit.",
    ),
    ProblemArea(
        "cryptography",
        "Cryptography",
        "Period finding and factoring — what breaks, and under which assumptions.",
    ),
)

_PROBLEM_AREAS_BY_KEY: dict[str, ProblemArea] = {
    **{area.id: area for area in PROBLEM_AREAS},
    **{area.label.lower(): area for area in PROBLEM_AREAS},
}


def resolve_problem_area(value: str) -> ProblemArea:
    """A problem area by id or label, case-insensitively, or a ValueError naming the choices."""
    area = _PROBLEM_AREAS_BY_KEY.get(value.strip().lower())
    if area is None:
        choices = ", ".join(a.id for a in PROBLEM_AREAS)
        raise ValueError(f"Unknown problem area {value!r}. Use one of: {choices}.")
    return area


def record_topics(record: Mapping[str, Any]) -> list[str]:
    topics = record.get("topics")
    if not isinstance(topics, list):
        return []
    return [topic for topic in topics if isinstance(topic, str)]


def problem_area_counts(rows: Iterable[AtlasRow]) -> list[dict[str, Any]]:
    """Each problem area with how many records carry it, dropping empty ones.

    Mirrors `finderProblemOptions` in finder.ts: a record counts once per topic even if
    it repeats the topic, and an area no record carries is not offered.
    """
    counts: dict[str, int] = {}
    for row in rows:
        for topic in set(record_topics(row.record)):
            counts[topic] = counts.get(topic, 0) + 1
    return [
        {
            "id": area.id,
            "label": area.label,
            "definition": area.definition,
            "records": counts[area.id],
        }
        for area in PROBLEM_AREAS
        if counts.get(area.id, 0) > 0
    ]


# --------------------------------------------------------------------------------------
# Resource rows and the finder's limit verdicts (finder.ts).
# --------------------------------------------------------------------------------------

QUBITS = "Qubits"
DEPTH = "Depth"
REPORTED_COST = "Reported cost"
SPEEDUP_CLASS = "Speedup class (secondary source)"
PRIMARY_SOURCE_ON_SPEEDUP = "Primary source on the speedup"
READINESS = "Readiness"

#: `REPORTED_COST_NOT_STATED` in finder.ts: a "Reported cost" row that says the sources
#: state no cost is not a cost.
_REPORTED_COST_NOT_STATED = re.compile(r"^not stated\b", re.IGNORECASE)

#: `parseLeadingInt` in finder.ts. ASCII digits only, as JavaScript's `\d` is.
_LEADING_INT = re.compile(r"^\s*([0-9]+)")


def resource_value(record: Mapping[str, Any], label: str) -> str | None:
    """The value of the first `resources` row with this exact label, as `resourceValue` reads it."""
    rows = record.get("resources")
    if not isinstance(rows, list):
        return None
    for row in rows:
        if isinstance(row, dict) and row.get("label") == label:
            value = row.get("value")
            return value if isinstance(value, str) else None
    return None


def parse_leading_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = _LEADING_INT.match(value)
    return int(match.group(1)) if match else None


@dataclass(frozen=True)
class Criterion:
    limit: str
    verdict: Verdict
    detail: str

    def as_dict(self) -> dict[str, str]:
        return {"limit": self.limit, "verdict": self.verdict, "detail": self.detail}


def check_numeric_limit(record: Mapping[str, Any], label: str, limit: int) -> Criterion:
    """`checkNumericLimit` in finder.ts, English wording."""
    key = label.lower()
    raw = resource_value(record, label)
    if raw is None:
        return Criterion(key, "not-stated", f"{label}: not stated in the source.")
    parsed = parse_leading_int(raw)
    if parsed is None:
        return Criterion(
            key,
            "not-stated",
            f'{label}: "{raw}" (stated, but not a single number to compare against your limit).',
        )
    if parsed <= limit:
        return Criterion(key, "satisfied", f"{label}: {raw} ≤ {limit}.")
    return Criterion(key, "violated", f"{label}: {raw} exceeds your limit of {limit}.")


def portable_circuit_qubits(record: Mapping[str, Any]) -> object | None:
    """`entry.portableCircuit?.qubitCount ?? null`, as `buildFinderRecord` reads it."""
    circuit = record.get("portableCircuit")
    if not isinstance(circuit, dict):
        return None
    return circuit.get("qubitCount")


def check_hardware(record: Mapping[str, Any], era: HardwareEra) -> Criterion:
    """`checkHardwareEra` in finder.ts, with `estimatesAvailable` false.

    This server does not read the fault-tolerant cost estimator, so "fault-tolerant"
    can only be satisfied by a record that says it needs fault tolerance, and is
    otherwise "not-stated". It never excludes a record, exactly as the site's finder
    behaves when its estimator is not wired in.
    """
    if era == "nisq":
        qubits = portable_circuit_qubits(record)
        if qubits is not None:
            return Criterion(
                "hardware", "satisfied", f"Publishes a runnable {qubits}-qubit circuit."
            )
        return Criterion(
            "hardware", "violated", "No runnable circuit is published for this record."
        )
    readiness = resource_value(record, READINESS)
    if readiness and re.search(r"fault|ftqc", readiness, re.IGNORECASE):
        return Criterion("hardware", "satisfied", f'The record states: "{readiness}".')
    return Criterion(
        "hardware",
        "not-stated",
        "This server does not read the fault-tolerant cost estimator, so the record alone "
        "cannot settle this. The record page shows an estimate when one exists.",
    )


# --------------------------------------------------------------------------------------
# Free text. The haystack is `searchHaystack` in search.ts, field for field.
# --------------------------------------------------------------------------------------

_HAYSTACK_TEXT_FIELDS = (
    "title",
    "titleJa",
    "algorithmFamily",
    "framework",
    "description",
    "descriptionJa",
    "provenance",
)


def query_words(query: str) -> list[str]:
    """The distinct lower-cased words of a query, in the order given."""
    words: list[str] = []
    for word in query.lower().split():
        if word not in words:
            words.append(word)
    return words


def search_haystack(record: Mapping[str, Any]) -> str:
    parts = [record.get(key) for key in _HAYSTACK_TEXT_FIELDS]
    tags = record.get("tags")
    if isinstance(tags, list):
        parts.extend(tags)
    return " ".join(part for part in parts if isinstance(part, str)).lower()


def matched_words(record: Mapping[str, Any], words: Sequence[str]) -> list[str]:
    haystack = search_haystack(record)
    return [word for word in words if word in haystack]


# --------------------------------------------------------------------------------------
# search_methods
# --------------------------------------------------------------------------------------

MAX_RESULTS = 50
DEFAULT_RESULTS = 20
_ONE_LINE_CHARS = 200


@dataclass(frozen=True)
class SearchLimits:
    query: str = ""
    match_all: bool = False
    problem_area: str | None = None
    max_qubits: int | None = None
    max_depth: int | None = None
    hardware: HardwareEra = "any"
    words: tuple[str, ...] = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "words", tuple(query_words(self.query)))


def _one_line(text: str | None) -> str:
    if not text:
        return NOT_STATED
    flat = " ".join(text.split())
    if len(flat) <= _ONE_LINE_CHARS:
        return flat
    cut = flat[:_ONE_LINE_CHARS].rsplit(" ", 1)[0]
    return f"{cut}..."


def _criteria(record: Mapping[str, Any], limits: SearchLimits) -> tuple[list[Criterion], bool]:
    """Every criterion for the limits that were set, and whether a hard filter excludes it.

    Only a "violated" verdict excludes, as in `passesExcept`: guessing a record out of
    the results on a field it never stated is the same fabrication as guessing it in.
    """
    criteria: list[Criterion] = []
    excluded: set[str] = set()
    if limits.problem_area:
        if limits.problem_area in record_topics(record):
            criteria.append(
                Criterion(
                    "problem_area",
                    "satisfied",
                    "Carries this problem area, from the Atlas's own topic vocabulary.",
                )
            )
        else:
            excluded.add("problem_area")
    if limits.words:
        found = matched_words(record, limits.words)
        wanted = len(limits.words) if limits.match_all else 1
        if len(found) >= wanted:
            criteria.append(Criterion("query", "satisfied", "Matches: " + ", ".join(found) + "."))
        else:
            excluded.add("query")
    if limits.max_qubits is not None:
        criterion = check_numeric_limit(record, QUBITS, limits.max_qubits)
        criteria.append(criterion)
        if criterion.verdict == "violated":
            excluded.add("qubits")
    if limits.max_depth is not None:
        criterion = check_numeric_limit(record, DEPTH, limits.max_depth)
        criteria.append(criterion)
        if criterion.verdict == "violated":
            excluded.add("depth")
    if limits.hardware != "any":
        criterion = check_hardware(record, limits.hardware)
        criteria.append(criterion)
        if criterion.verdict == "violated":
            excluded.add("hardware")
    return criteria, excluded


def search(
    rows: Sequence[AtlasRow],
    limits: SearchLimits,
    *,
    max_results: int = DEFAULT_RESULTS,
    offset: int = 0,
) -> dict[str, Any]:
    """Records that pass every limit, sorted by slug, one page of them.

    `excluded_by_only` is `FinderOutcome.excludedByOnly`: for each limit that was set,
    how many records fail that limit alone and would come back if it were relaxed.
    """
    max_results = max(1, min(max_results, MAX_RESULTS))
    offset = max(0, offset)
    matches: list[tuple[AtlasRow, list[Criterion]]] = []
    excluded_by_only: dict[str, int] = {}
    set_limits = [
        name
        for name, is_set in (
            ("problem_area", bool(limits.problem_area)),
            ("query", bool(limits.words)),
            ("qubits", limits.max_qubits is not None),
            ("depth", limits.max_depth is not None),
            ("hardware", limits.hardware != "any"),
        )
        if is_set
    ]
    for name in set_limits:
        excluded_by_only[name] = 0
    for row in rows:
        criteria, excluded = _criteria(row.record, limits)
        if not excluded:
            matches.append((row, criteria))
        elif len(excluded) == 1:
            excluded_by_only[next(iter(excluded))] += 1
    matches.sort(key=lambda match: match[0].slug)
    page = matches[offset : offset + max_results]
    return {
        "total_matches": len(matches),
        "offset": offset,
        "returned": len(page),
        "order": "Sorted by slug. Not ranked: judge relevance yourself.",
        "results": [_summary(row, criteria) for row, criteria in page],
        "excluded_by_only": excluded_by_only,
        "records_searched": len(rows),
    }


def _summary(row: AtlasRow, criteria: Sequence[Criterion]) -> dict[str, Any]:
    record = row.record
    return {
        "slug": row.slug,
        "title": _text(record, "title") or NOT_STATED,
        "description": _one_line(_text(record, "description")),
        "category": _text(record, "categoryLabel") or NOT_STATED,
        "limits": [criterion.as_dict() for criterion in criteria],
        "url": record_url(row.slug),
    }


# --------------------------------------------------------------------------------------
# get_method: stated cost and regime (finder.ts), verification (verification.ts),
# literature, and OpenQASM (studio-builder.ts).
# --------------------------------------------------------------------------------------


def stated_cost(record: Mapping[str, Any]) -> dict[str, str] | str:
    """`statedCost` in finder.ts: the "Reported cost" row, else the Qubits and Depth rows."""
    reported = resource_value(record, REPORTED_COST)
    if reported and not _REPORTED_COST_NOT_STATED.match(reported.strip()):
        return {"value": reported, "from": f'the record\'s "{REPORTED_COST}" row'}
    qubits = resource_value(record, QUBITS)
    depth = resource_value(record, DEPTH)
    if qubits or depth:
        parts = []
        if qubits:
            parts.append(f"{qubits} qubits")
        if depth:
            parts.append(depth)
        return {"value": ", ".join(parts), "from": "the record's Qubits and Depth rows"}
    return NOT_STATED


def stated_regime(record: Mapping[str, Any]) -> dict[str, Any] | str:
    """`statedRegime` in finder.ts, with the recorded check note kept beside the verdict."""
    speedup = resource_value(record, SPEEDUP_CLASS)
    if speedup:
        primary = resource_value(record, PRIMARY_SOURCE_ON_SPEEDUP)
        checked = primary is not None and not re.search("not checked", primary, re.IGNORECASE)
        wording = (
            f"{speedup} (checked against the record's own primary paper)"
            if checked
            else f"{speedup} (from a secondary index; not yet checked against the record's "
            "own primary paper)"
        )
        return {
            "value": wording,
            "speedup_class": speedup,
            "checked_against_primary_paper": checked,
            "primary_source_note": primary if primary is not None else NOT_STATED,
        }
    readiness = resource_value(record, READINESS)
    if readiness:
        return {"value": readiness, "from": f'the record\'s "{READINESS}" row'}
    return NOT_STATED


#: `VERIFICATION_TIERS` in verification.ts.
VERIFICATION_TIERS: dict[int, tuple[str, str]] = {
    1: (
        "Exact & formal",
        "The defining behavior was checked exactly: a mathematical identity, a full "
        "statevector or stabilizer simulation, or an exhaustive basis-state truth table.",
    ),
    2: (
        "Strong empirical",
        "The design was verified by construction plus measured evidence: statistical "
        "re-execution, small-instance analytic agreement, sub-block, echo, or invariant "
        "checks. Scale-specific bugs can still survive.",
    ),
    3: (
        "Attested & literature",
        "The record rests on external authority: peer-reviewed papers, standard textbooks, "
        "expert review, or evidence carried over from related verified entries. Nothing "
        "here was re-executed by this catalog.",
    ),
    4: (
        "Automated & unreviewed",
        "Only automated (LLM-assisted) review or an unreviewed community submission backs "
        "this record so far. Treat it as a starting point, not evidence.",
    ),
}

#: `VERIFICATION_METHODS` in verification.ts: id -> (tier, label).
VERIFICATION_METHODS: dict[str, tuple[int, str]] = {
    "direct_math": (1, "Direct mathematics"),
    "unitary_equivalence": (1, "Unitary / matrix equivalence"),
    "exact_simulation": (1, "Exact statevector simulation"),
    "stabilizer_simulation": (1, "Stabilizer simulation"),
    "truth_table": (1, "Basis-state truth table"),
    "statistical_counts": (2, "Statistical re-execution"),
    "small_instance": (2, "Small-instance agreement"),
    "subblock": (2, "Sub-block verification"),
    "echo_inverse": (2, "Echo / inverse test"),
    "invariant_checks": (2, "Invariant & structural checks"),
    "construction": (2, "Verified by construction"),
    "research_paper": (3, "Peer-reviewed paper"),
    "textbook_citation": (3, "Textbook / standard citation"),
    "expert_review": (3, "Expert review"),
    "tangential": (3, "Tangential evidence"),
    "llm_reviewed": (4, "LLM-assisted review"),
    "community_submission": (4, "Community submission"),
}


def verification(record: Mapping[str, Any]) -> dict[str, Any]:
    """The tier (`strongestTier` over the record's methods), the methods, and the record's prose.

    The site derives methods from prose when a record lists none
    (`deriveVerificationMethods`); every published record lists them, so this does not
    derive anything and reports the tier as not stated when the list is empty.
    """
    raw_methods = record.get("verificationMethods")
    methods = (
        [m for m in raw_methods if isinstance(m, str)] if isinstance(raw_methods, list) else []
    )
    details = record.get("verificationDetails")
    details = details if isinstance(details, dict) else {}
    out: dict[str, Any] = {}
    if methods:
        tier = 4
        for method in methods:
            known = VERIFICATION_METHODS.get(method)
            if known and known[0] < tier:
                tier = known[0]
        name, summary = VERIFICATION_TIERS[tier]
        out["tier"] = tier
        out["tier_name"] = name
        out["tier_meaning"] = summary
        out["methods"] = [
            VERIFICATION_METHODS[m][1] if m in VERIFICATION_METHODS else m for m in methods
        ]
    else:
        out["tier"] = NOT_STATED
        out["methods"] = NOT_STATED
    out["status"] = _text(record, "status") or NOT_STATED
    out["summary"] = _text(record, "verification") or NOT_STATED
    for key in ("method", "result", "caveat"):
        value = details.get(key)
        out[key] = value if isinstance(value, str) and value.strip() else NOT_STATED
    return out


def literature(record: Mapping[str, Any]) -> list[dict[str, str]] | str:
    items = record.get("literature")
    if not isinstance(items, list) or not items:
        return NOT_STATED
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                key: (item[key] if isinstance(item.get(key), str) and item[key] else NOT_STATED)
                for key in ("title", "authors", "year", "url", "relevance")
            }
        )
    return out or NOT_STATED


def primary_source(record: Mapping[str, Any]) -> dict[str, str] | str:
    source = record.get("source")
    if not isinstance(source, dict):
        return NOT_STATED
    return {
        key: (source[key] if isinstance(source.get(key), str) and source[key] else NOT_STATED)
        for key in ("kind", "title", "url", "license")
    }


def resources_as_recorded(record: Mapping[str, Any]) -> list[dict[str, str]] | str:
    rows = record.get("resources")
    if not isinstance(rows, list):
        return NOT_STATED
    out = [
        {"label": row["label"], "value": row["value"]}
        for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("label"), str)
        and isinstance(row.get("value"), str)
    ]
    return out or NOT_STATED


# `openqasmOperation` in studio-builder.ts, for the twelve gates of the portable model
# (`PortableCircuitGate` in apps/web/lib/circuit-frameworks.ts).
_QASM_GATES: dict[str, tuple[str, int, bool]] = {
    "H": ("h", 1, False),
    "X": ("x", 1, False),
    "Y": ("y", 1, False),
    "Z": ("z", 1, False),
    "S": ("s", 1, False),
    "T": ("t", 1, False),
    "RX": ("rx", 1, True),
    "RY": ("ry", 1, True),
    "RZ": ("rz", 1, True),
    "CX": ("cx", 2, False),
    "CZ": ("cz", 2, False),
    "SWAP": ("swap", 2, False),
}

#: An angle this renderer will copy into OpenQASM: numbers, `pi`, arithmetic, brackets.
#: The corpus writes angles as "pi/4" or "3*pi/8"; anything else is not rendered.
_SAFE_ANGLE = re.compile(r"^(?:[0-9.]+|pi|[-+*/() ])+$")


class UnrenderableCircuit(ValueError):
    """The record's portable circuit cannot be written as OpenQASM without guessing."""


def portable_circuit_to_openqasm(circuit: Mapping[str, Any]) -> str:
    """OpenQASM 3 for a portable circuit, line for line what the site's Studio export writes."""
    width = circuit.get("qubitCount")
    steps = circuit.get("steps")
    if not isinstance(width, int) or isinstance(width, bool) or width < 1:
        raise UnrenderableCircuit("the circuit does not state a qubit count")
    if not isinstance(steps, list):
        raise UnrenderableCircuit("the circuit has no step list")
    measured = bool(circuit.get("measure"))
    lines = ["OPENQASM 3.0;", 'include "stdgates.inc";', f"qubit[{width}] q;"]
    if measured:
        lines.append(f"bit[{width}] c;")
    lines.append("")
    for step in steps:
        if not isinstance(step, dict):
            raise UnrenderableCircuit("a step is not an object")
        gate = step.get("gate")
        spec = _QASM_GATES.get(gate) if isinstance(gate, str) else None
        if spec is None:
            raise UnrenderableCircuit(f"gate {gate!r} is outside the portable gate set")
        name, arity, takes_angle = spec
        qubits = step.get("qubits")
        if (
            not isinstance(qubits, list)
            or len(qubits) != arity
            or not all(
                isinstance(q, int) and not isinstance(q, bool) and 0 <= q < width for q in qubits
            )
        ):
            raise UnrenderableCircuit(
                f"a {gate} step addresses qubits {qubits!r} on a {width}-qubit register"
            )
        operands = ", ".join(f"q[{q}]" for q in qubits)
        if takes_angle:
            angle = step.get("param")
            if not isinstance(angle, str) or not _SAFE_ANGLE.match(angle):
                raise UnrenderableCircuit(f"a {gate} step has an angle this cannot copy: {angle!r}")
            lines.append(f"{name}({angle}) {operands};")
        else:
            lines.append(f"{name} {operands};")
    if measured:
        lines.append("c = measure q;")
    return "\n".join(lines)


def openqasm(record: Mapping[str, Any]) -> dict[str, str] | str:
    """The record's OpenQASM 3, in the order `getPublicRepositoryVariant` looks for it.

    First the record's "OpenQASM 3.0" code variant (the first one, as
    `codeVariants.find` takes it), verbatim, when it carries code. Then the record's
    own portable gate list, written out by the same rules the site's export uses.
    The site has two more routes, both of which parse another framework's source
    code (`inferPortableCircuit`, `convertCircuitSource`); neither is copied here, so
    a record that only has, say, Qiskit source reports OpenQASM as not stated.
    """
    variants = record.get("codeVariants")
    if isinstance(variants, list):
        variant = next(
            (v for v in variants if isinstance(v, dict) and v.get("framework") == "OpenQASM 3.0"),
            None,
        )
        if variant is not None and isinstance(variant.get("code"), str) and variant["code"]:
            return {"code": variant["code"], "from": "the record's OpenQASM 3.0 code variant"}
    circuit = record.get("portableCircuit")
    if isinstance(circuit, dict):
        try:
            code = portable_circuit_to_openqasm(circuit)
        except UnrenderableCircuit as exc:
            return f"{NOT_STATED} (the record has a circuit, but {exc})"
        return {
            "code": code,
            "from": (
                "the record's portable gate list, written out with the rules the site's "
                "export uses. Review target-SDK and hardware decomposition before running it."
            ),
        }
    return NOT_STATED


def method_detail(row: AtlasRow) -> dict[str, Any]:
    record = row.record
    topics = record_topics(record)
    related = record.get("relatedSlugs")
    return {
        "slug": row.slug,
        "title": _text(record, "title") or NOT_STATED,
        "url": record_url(row.slug),
        "category": _text(record, "categoryLabel") or NOT_STATED,
        "algorithm_family": _text(record, "algorithmFamily") or NOT_STATED,
        "description": _text(record, "description") or NOT_STATED,
        "introduction": _text(record, "introduction") or NOT_STATED,
        "explanation": _text(record, "explanation") or NOT_STATED,
        "explanation_long": _text(record, "explanationMd") or NOT_STATED,
        "cost_as_recorded": stated_cost(record),
        "speedup_class": stated_regime(record),
        "verification": verification(record),
        "literature": literature(record),
        "primary_source": primary_source(record),
        "resources_as_recorded": resources_as_recorded(record),
        "openqasm": openqasm(record),
        "topics": topics or NOT_STATED,
        "related_slugs": (
            [s for s in related if isinstance(s, str)]
            if isinstance(related, list) and related
            else NOT_STATED
        ),
        "execution_state": row.execution_state or NOT_STATED,
        "updated_at": row.updated_at or NOT_STATED,
        "note": RECORD_IS_A_CLAIM,
    }


_SLUG_FROM_URL = re.compile(r"/repository/([^/?#]+)")


def normalize_slug(value: str) -> str:
    """A bare slug from a slug or a record URL (`https://leonaqt.com/repository/<slug>`)."""
    text = value.strip()
    match = _SLUG_FROM_URL.search(text)
    if match:
        text = match.group(1)
    return text.strip("/")


def similar_slugs(rows: Sequence[AtlasRow], text: str, limit: int = 5) -> list[str]:
    """Slugs containing the given text, sorted. A hint for a miss, not a ranking."""
    needle = text.lower()
    if not needle:
        return []
    return sorted(row.slug for row in rows if needle in row.slug)[:limit]
