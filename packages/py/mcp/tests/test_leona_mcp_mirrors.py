"""The vocabularies `atlas.py` copies from the site, checked against the site's source.

`atlas.py` restates rules that live in TypeScript. A copy with nothing checking it
drifts silently: the site gains a problem area or renames a resource label, and the
server keeps answering with the old one while every other test stays green. These
tests read the TypeScript (and one Python file of the API) as text and fail on any
difference.

They need the rest of the repository, which is where CI runs them. A checkout that
is only this package (the `uvx --from git+...#subdirectory=` install ships no tests)
skips them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from leona_mcp import atlas

REPO = Path(__file__).resolve().parents[4]

if not (REPO / "apps" / "web").is_dir():  # pragma: no cover - standalone checkout only
    pytest.skip("apps/web is not in this checkout", allow_module_level=True)


def source(relative: str) -> str:
    path = REPO / relative
    assert path.is_file(), f"{relative} moved; update atlas.py's pointer to it"
    return path.read_text(encoding="utf-8")


def test_problem_areas_match_the_domain_facet_in_topics_ts():
    text = source("apps/web/lib/repository/topics.ts")
    found = re.findall(
        r'id:\s*"([^"]+)",\s*facet:\s*"domain",\s*label:\s*"([^"]+)",\s*labelJa:\s*"[^"]*",'
        r'\s*definition:\s*"([^"]+)"',
        text,
    )
    assert found, "the domain-facet pattern matched nothing; topics.ts changed shape"
    assert [(a.id, a.label, a.definition) for a in atlas.PROBLEM_AREAS] == found


def test_haystack_fields_match_search_ts():
    text = source("apps/web/lib/repository/search.ts")
    body = re.search(r"export function searchHaystack\([^)]*\)[^{]*\{(.*?)\n\}", text, re.S)
    assert body, "searchHaystack not found in search.ts"
    fields = re.findall(r"(\.\.\.)?entry\.(\w+)", body.group(1))
    assert [name for spread, name in fields if not spread] == list(atlas._HAYSTACK_TEXT_FIELDS)
    assert [name for spread, name in fields if spread] == ["tags"]


def test_verification_methods_and_tiers_match_verification_ts():
    text = source("apps/web/lib/repository/verification.ts")
    methods = re.findall(r'id:\s*"(\w+)",\s*tier:\s*(\d),\s*label:\s*"([^"]+)"', text)
    assert {m: (int(t), label) for m, t, label in methods} == atlas.VERIFICATION_METHODS
    tiers = re.findall(r'tier:\s*(\d),\s*name:\s*"([^"]+)",.*?summary:\s*"([^"]+)"', text, re.S)
    assert {int(t): (name, summary) for t, name, summary in tiers} == atlas.VERIFICATION_TIERS


def test_the_resource_labels_and_patterns_the_finder_reads_are_still_there():
    text = source("apps/web/lib/repository/finder.ts")
    for label in (
        atlas.QUBITS,
        atlas.DEPTH,
        atlas.REPORTED_COST,
        atlas.SPEEDUP_CLASS,
        atlas.PRIMARY_SOURCE_ON_SPEEDUP,
        atlas.READINESS,
    ):
        assert f'"{label}"' in text, f"finder.ts no longer reads the {label!r} row"
    for pattern in (
        r"/^not stated\b/i",  # REPORTED_COST_NOT_STATED
        r"/^\s*(\d+)/",  # parseLeadingInt
        r"/not checked/i",  # statedRegime
        r"/fault|ftqc/i",  # checkHardwareEra
    ):
        assert pattern in text, f"finder.ts changed the pattern {pattern}"
    for sentence in (
        "not stated in the source.",
        "(stated, but not a single number to compare against your limit).",
        "exceeds your limit of",
        "No runnable circuit is published for this record.",
        "(checked against the record's own primary paper)",
        "(from a secondary index; not yet checked against the record's own primary paper)",
    ):
        assert sentence in text, f"finder.ts reworded {sentence!r}"


def test_the_openqasm_gate_names_match_studio_builder_ts():
    text = source("apps/web/lib/studio-builder.ts")
    body = re.search(r"function openqasmOperation\(.*?\n\}", text, re.S)
    assert body, "openqasmOperation not found in studio-builder.ts"
    emitted = dict(re.findall(r'case "(\w+)": return `(\w+)[ (]', body.group(0)))
    for gate, (name, _arity, _angle) in atlas._QASM_GATES.items():
        assert emitted.get(gate) == name, f"{gate} is written as {emitted.get(gate)!r} on the site"


def test_the_portable_gate_set_matches_circuit_frameworks_ts():
    text = source("apps/web/lib/circuit-frameworks.ts")
    union = re.search(r"export type PortableCircuitGate\s*=\s*([^;]+);", text)
    assert union, "PortableCircuitGate not found"
    assert set(re.findall(r'"(\w+)"', union.group(1))) == set(atlas._QASM_GATES)


def test_the_list_view_still_drops_the_rows_that_make_this_read_the_full_view():
    # client.py reads the full listing because `?view=list` keeps only the "Qubits"
    # resource row. If that projection widens, the list view (a third of the bytes)
    # may be enough, and this is the reminder to reconsider.
    text = source("services/api/src/majorana_api/catalog_read_model.py")
    assert 'LIST_VIEW_RESOURCE_LABELS: frozenset[str] = frozenset({"Qubits"})' in text
