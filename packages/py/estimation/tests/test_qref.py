"""Tests for QREF import/export.

`test_import_a_hand_written_external_document` is the one that matters most:
it constructs a document this module never produced, in the shape another
QREF-emitting tool plausibly would, to check actual interop rather than only
self-consistency between this module's own export and import.
"""

from __future__ import annotations

import pytest
from majorana_estimation import GIDNEY_2025, LogicalCost, estimate
from majorana_estimation.qref import (
    QREF_SCHEMA_VERSION,
    export_estimate_to_qref,
    export_logical_cost_to_qref,
    import_logical_cost_from_qref,
    validate_qref_document,
)

WORKLOADS = [
    LogicalCost(logical_qubits=4, toffoli_count=100, non_clifford_depth=10),
    LogicalCost(
        logical_qubits=2_196, toffoli_count=6_700_000_000, non_clifford_depth=6_700_000_000
    ),
    LogicalCost(logical_qubits=4, t_count=60, non_clifford_depth=1),
    LogicalCost(logical_qubits=6),  # Clifford-only
    LogicalCost(logical_qubits=1, label="a labelled synthetic workload"),
]


# --- export shape -------------------------------------------------------


def test_export_produces_a_document_that_validates():
    document = export_logical_cost_to_qref(WORKLOADS[0])
    validate_qref_document(document)  # raises on failure; the assertion is that it does not
    assert document["version"] == QREF_SCHEMA_VERSION == "v1"


def test_exported_resources_match_the_documented_convention():
    logical = LogicalCost(logical_qubits=4, toffoli_count=100, t_count=7, non_clifford_depth=10)
    document = export_logical_cost_to_qref(logical)
    resources = {r["name"]: r for r in document["program"]["resources"]}

    assert resources["logical_qubits"] == {"name": "logical_qubits", "type": "qubits", "value": 4}
    assert resources["toffoli_count"] == {"name": "toffoli_count", "type": "additive", "value": 100}
    assert resources["t_count"] == {"name": "t_count", "type": "additive", "value": 7}
    assert resources["non_clifford_depth"] == {
        "name": "non_clifford_depth",
        "type": "additive",
        "value": 10,
    }


# --- round trip -----------------------------------------------------------


@pytest.mark.parametrize("logical", WORKLOADS)
def test_export_then_import_round_trips_exactly(logical):
    document = export_logical_cost_to_qref(logical)
    recovered = import_logical_cost_from_qref(document)
    assert recovered == logical


def test_an_empty_label_round_trips_to_an_empty_label():
    document = export_logical_cost_to_qref(LogicalCost(logical_qubits=1))
    assert document["program"]["meta"]["label"] == ""
    assert import_logical_cost_from_qref(document).label == ""


# --- physics honesty: physical numbers live only in meta -------------------


def test_export_estimate_keeps_physical_numbers_out_of_resources():
    """QREF v1 has no hardware concept (checked against schema_v1.py); the
    physical footprint and runtime must never be smuggled in as a resource,
    which would misrepresent them as QREF's own vocabulary."""
    logical = LogicalCost(logical_qubits=4, toffoli_count=1000, non_clifford_depth=1000)
    result = estimate(logical, GIDNEY_2025)
    document = export_estimate_to_qref(result)

    resource_names = {r["name"] for r in document["program"]["resources"]}
    assert resource_names == {"logical_qubits", "toffoli_count", "t_count", "non_clifford_depth"}

    meta = document["program"]["meta"]
    assert meta["leona_assumption_set"] == result.assumption_set == GIDNEY_2025.identity
    assert meta["leona_total_physical_qubits"] == result.total_physical_qubits
    assert meta["leona_runtime_seconds"] == result.runtime_seconds
    assert meta["leona_code_distance"] == result.distance.code_distance
    # And the logical layer round-trips out of the same document too.
    assert import_logical_cost_from_qref(document) == logical


# --- genuine external interop, not just self round-trip --------------------


def test_import_a_hand_written_external_document():
    """A minimal document in QREF's native shape, as another tool -- not this
    module -- would plausibly emit it: no `meta`, a different but valid
    routine name, and only the resources it happens to state."""
    external_document = {
        "version": "v1",
        "program": {
            "name": "toffoli_oracle",
            "ports": [{"name": "in_0", "direction": "input", "size": 4}],
            "resources": [
                {"name": "logical_qubits", "type": "qubits", "value": 12},
                {"name": "toffoli_count", "type": "additive", "value": 340},
            ],
        },
    }
    logical = import_logical_cost_from_qref(external_document)
    assert logical == LogicalCost(logical_qubits=12, toffoli_count=340)


# --- validation catches a malformed document --------------------------------


def test_import_rejects_the_wrong_schema_version():
    document = {"version": "v2", "program": {"name": "x", "resources": []}}
    with pytest.raises(ValueError, match="schema version"):
        import_logical_cost_from_qref(document)


def test_import_requires_a_logical_qubits_resource():
    document = {"version": "v1", "program": {"name": "x", "resources": []}}
    with pytest.raises(ValueError, match="logical_qubits"):
        import_logical_cost_from_qref(document)


@pytest.mark.parametrize(
    ("document", "match"),
    [
        ({"version": "v1", "program": {"name": "has space", "resources": []}}, "_Name pattern"),
        (
            {
                "version": "v1",
                "program": {
                    "name": "x",
                    "resources": [{"name": "y", "type": "not_a_real_type", "value": 1}],
                },
            },
            "not one of",
        ),
        (
            {
                "version": "v1",
                "program": {
                    "name": "x",
                    "resources": [
                        {"name": "y", "type": "qubits", "value": 1},
                        {"name": "y", "type": "additive", "value": 2},
                    ],
                },
            },
            "named more than once",
        ),
        ({"version": "v1", "program": "not an object"}, "'program' object"),
        ("not even an object", "must be an object"),
    ],
)
def test_validate_qref_document_rejects_malformed_input(document, match):
    with pytest.raises(ValueError, match=match):
        validate_qref_document(document)


def test_import_rejects_a_non_integer_resource_value():
    document = {
        "version": "v1",
        "program": {
            "name": "x",
            "resources": [{"name": "logical_qubits", "type": "qubits", "value": 4.5}],
        },
    }
    with pytest.raises(TypeError, match="whole number"):
        import_logical_cost_from_qref(document)


def test_import_accepts_an_integral_float_resource_value():
    """A JSON encoder may round-trip a Python int as e.g. `4.0`; QREF's
    `_Value` is `int | float | str`, so this must not be rejected."""
    document = {
        "version": "v1",
        "program": {
            "name": "x",
            "resources": [{"name": "logical_qubits", "type": "qubits", "value": 4.0}],
        },
    }
    assert import_logical_cost_from_qref(document).logical_qubits == 4
