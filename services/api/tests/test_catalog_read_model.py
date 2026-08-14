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


def test_the_list_view_keeps_code_variants_but_not_their_code():
    """The largest single item in the list payload, and the cheapest to remove.

    `code` is 82.8% of the `codeVariants` field across the published corpus and
    nothing in the browse list reads it — `getPublicRepositoryVariant()` takes a
    full entry and is reached only from the detail view and the export route.
    """
    record = {
        "slug": "bell-state",
        "title": "Bell state",
        "codeVariants": [
            {
                "framework": "Qiskit",
                "status": "native",
                "code": "from qiskit import QuantumCircuit\n" * 200,
                "filename": "bell.py",
                "language": "python",
                "note": "A note nobody reads in a list.",
            }
        ],
    }
    projected = project_record_for_list_view(record)
    assert projected is not None
    assert projected["codeVariants"] == [{"framework": "Qiskit", "status": "native"}]


def test_the_field_survives_so_width_families_still_fold():
    """Dropping the field entirely would be the tempting version and is wrong.

    `apps/web/lib/repository/families.ts:148` folds
    `codeVariants.map(v => f"{v.framework}:{v.status}")` into the signature that
    decides which records belong to the same width family. Remove the field and
    every record's signature component becomes identical, changing which records
    fold together with nothing failing anywhere.
    """
    record = {
        "slug": "x",
        "codeVariants": [{"framework": "Cirq", "status": "conversion", "code": "x"}],
    }
    projected = project_record_for_list_view(record)
    assert "codeVariants" in projected, "the field itself must survive the projection"
    assert projected["codeVariants"][0]["framework"] == "Cirq"
    assert projected["codeVariants"][0]["status"] == "conversion"


def test_a_record_with_no_variants_is_untouched():
    # Projecting by intersection means an absent key stays absent rather than
    # arriving as an empty list.
    assert "codeVariants" not in project_record_for_list_view({"slug": "x", "title": "t"})
    assert project_record_for_list_view({"slug": "x", "codeVariants": []})["codeVariants"] == []


def test_a_malformed_codeVariants_is_passed_through_rather_than_repaired():
    """A projection must not launder a schema disagreement.

    The web validator refuses a malformed `codeVariants`, which is the behaviour
    that catches an API/web schema drift. If this coerced a string into a
    well-formed empty list, that check would never fire and the disagreement
    would be invisible on both sides.
    """
    assert (
        project_record_for_list_view({"slug": "x", "codeVariants": "nonsense"})["codeVariants"]
        == "nonsense"
    )
    weird = project_record_for_list_view({"slug": "x", "codeVariants": [None, 3]})
    assert weird["codeVariants"] == [None, 3]


def test_the_list_view_keeps_the_qubits_row_and_drops_the_rest_of_the_table():
    """`resources` is 8.7% of the list payload; one row of it is rendered.

    The browse card's lookup is
    `entry.resources.find((r) => r.label === "Qubits")?.value`
    (apps/web/app/repository/repository-browser.tsx:786), and it is the only read
    of `entry.resources` on the browse path. Filtering by the same literal is
    what makes this a projection rather than a behaviour change.
    """
    projected = project_record_for_list_view(
        {
            "slug": "x",
            "resources": [
                {"label": "Qubits", "value": "1 system + 1 ancilla"},
                {"label": "Reported cost", "value": "a long paragraph of prose"},
                {"label": "Primary source on the speedup", "value": "another one"},
            ],
        }
    )
    assert projected["resources"] == [{"label": "Qubits", "value": "1 system + 1 ancilla"}]


def test_a_non_numeric_qubits_value_survives_verbatim():
    """The reason this is a row filter and not a swap to the derived profile.

    `RepositoryProfile.qubits` is `int | None` and is null whenever the record
    has no `portableCircuit`, while these rows are hand-authored prose that does
    not depend on a circuit — several of them are not numbers at all. Reading the
    profile instead would blank the chip on every literature, operator and state
    record.
    """
    for value in ("1 system + 1 ancilla", "1 per mode", "n + 1"):
        projected = project_record_for_list_view(
            {"slug": "x", "resources": [{"label": "Qubits", "value": value}]}
        )
        assert projected["resources"] == [{"label": "Qubits", "value": value}]


def test_a_malformed_resources_is_passed_through_rather_than_repaired():
    """Same terms as `codeVariants`: a projection must not launder a schema
    disagreement into a well-formed empty list, or the web validator's refusal —
    the check that catches API/web drift — never fires."""
    assert (
        project_record_for_list_view({"slug": "x", "resources": "nonsense"})["resources"]
        == "nonsense"
    )
    # A row that is not an object cannot be the one the card looks up, so it is
    # dropped rather than kept. The FIELD's shape is what the validator checks.
    assert project_record_for_list_view({"slug": "x", "resources": [None, 3]})["resources"] == []


def test_metadata_is_no_longer_on_the_browse_list():
    """13.1% of the list payload, rendered by nothing in the browse list.

    Its one consumer is the detail page, which fetches its own full record. This
    asserts the removal rather than trusting the allowlist to stay put: a field
    silently re-added here costs 140 KB across the corpus and nothing else says so.
    """
    assert "metadata" not in LIST_VIEW_RECORD_FIELDS
    projected = project_record_for_list_view(
        {"slug": "x", "metadata": [{"label": "Depth", "value": "O(n)"}]}
    )
    assert "metadata" not in projected
    # And the full record still carries it — only the list view is projected.
    assert parse_source_record(json.dumps({"slug": "x", "metadata": [{"label": "Depth"}]})) == {
        "slug": "x",
        "metadata": [{"label": "Depth"}],
    }
