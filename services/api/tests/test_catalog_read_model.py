"""Pure public-catalog read mapping (Neon cutover Slice C).

The rich presentation fields are recovered from the pinned source blob at read
time, so the mapping must be total: no stored row may raise, and a blob that is
not a catalog record must degrade to record=None rather than fabricating one.
"""

import datetime as dt
import json

from majorana_api.catalog_read_model import (
    LIST_VIEW_RECORD_FIELDS,
    MAX_RECORD_BYTES,
    build_public_catalog_entry,
    parse_source_record,
    project_record_for_list_view,
)

_ENTRY = {
    "slug": "amplitude-amplification",
    "title": "Amplitude Amplification",
    "algorithmFamily": "Grover",
    "category": "algorithms",
    "classicalComparison": {"baseline": "O(N)", "metrics": [{"label": "queries"}]},
    "codeVariants": [{"framework": "Qiskit", "status": "native"}],
    "verificationMethods": ["unitary_equivalence"],
}


def _blob() -> str:
    return json.dumps(_ENTRY)


def test_parse_recovers_the_full_rich_record():
    parsed = parse_source_record(_blob())
    assert parsed == _ENTRY
    # the fields the static frontend needs survive verbatim, nested ones included
    assert parsed["algorithmFamily"] == "Grover"
    assert parsed["classicalComparison"]["metrics"][0]["label"] == "queries"


def test_parse_degrades_to_none_instead_of_raising():
    for value in (None, "", "not json", "[1,2,3]", '"a string"', "42", "null"):
        assert parse_source_record(value) is None


def test_parse_rejects_an_oversized_blob():
    oversized = json.dumps({"padding": "x" * (MAX_RECORD_BYTES + 10)})
    assert len(oversized.encode("utf-8")) > MAX_RECORD_BYTES
    assert parse_source_record(oversized) is None


def test_entry_maps_authoritative_fields_and_provenance():
    updated = dt.datetime(2026, 7, 19, 12, 0, tzinfo=dt.timezone.utc)
    entry = build_public_catalog_entry(
        upstream_identity="amplitude-amplification",
        execution_state="template_only",
        updated_at=updated,
        source_code=_blob(),
        source_blob_sha256="a" * 64,
        import_provider="catalog_bootstrap",
        upstream_ref="deadbeef",
    )
    assert entry.slug == "amplitude-amplification"
    # the honest staged column is surfaced, never upgraded from the record's claims
    assert entry.execution_state == "template_only"
    assert entry.updated_at == updated
    assert entry.provenance.import_provider == "catalog_bootstrap"
    assert entry.provenance.upstream_ref == "deadbeef"
    assert entry.provenance.upstream_identity == "amplitude-amplification"
    assert entry.provenance.source_blob_sha256 == "a" * 64
    assert entry.record["title"] == "Amplitude Amplification"


def test_project_keeps_allowlisted_keys_and_drops_others():
    record = {
        "slug": "amplitude-amplification",
        "title": "Amplitude Amplification",
        "algorithmFamily": "Grover",
        "portableCircuit": {"qasm": "OPENQASM 3.0;"},
        # not on the allowlist: detail-page-only prose
        "classicalComparison": {"baseline": "O(N)", "metrics": [{"label": "queries"}]},
    }
    projected = project_record_for_list_view(record)
    assert projected["slug"] == "amplitude-amplification"
    assert projected["title"] == "Amplitude Amplification"
    assert projected["algorithmFamily"] == "Grover"
    assert projected["portableCircuit"] == {"qasm": "OPENQASM 3.0;"}
    assert "classicalComparison" not in projected


def test_project_never_adds_a_key_absent_from_the_input():
    """`decomposition` is present on only a minority of records; projecting by
    intersection must not fabricate it (or any other allowlisted key) as None."""
    record = {"slug": "some-slug", "title": "Some Title"}
    projected = project_record_for_list_view(record)
    assert "decomposition" not in projected
    assert set(projected) == {"slug", "title"}
    assert set(projected).issubset(LIST_VIEW_RECORD_FIELDS)


def test_project_leaves_none_as_none():
    assert project_record_for_list_view(None) is None


def test_entry_survives_a_non_record_source():
    """A published artifact from a future non-manifest provider stores real
    source code, not a catalog entry; it must still serialize."""
    entry = build_public_catalog_entry(
        upstream_identity="some-slug",
        execution_state="executable",
        updated_at=None,
        source_code="from qiskit import QuantumCircuit\n",
        source_blob_sha256=None,
        import_provider=None,
        upstream_ref=None,
    )
    assert entry.record is None
    assert entry.slug == "some-slug"
    assert entry.updated_at is not None
