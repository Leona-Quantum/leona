"""`majorana_qpu.sweep` — the `qpu_runs.sweep` document (migration 0075).

Pure-Python, no qiskit: these are the same three functions
`test_mitigation.py` exercises for the analogous `zne` shape
(`requested_zne_record`/`zne_requested`/`merged_after_submit`/
`with_folded_counts`), checked against the sweep equivalents.
"""

from __future__ import annotations

from majorana_qpu.sweep import (
    SWEEP_RECORD_VERSION,
    binding_qasms,
    merged_after_submit,
    requested_sweep_record,
    sweep_requested,
    with_binding_counts,
)

BINDINGS = [
    {"label": "0°", "qasm": "OPENQASM 3.0; ... 0"},
    {"label": "90°", "qasm": "OPENQASM 3.0; ... 1.5707963267948966"},
    {"label": "180°", "qasm": "OPENQASM 3.0; ... 3.141592653589793"},
]


def test_requested_sweep_record_carries_every_binding_verbatim():
    document = requested_sweep_record("RX angle (q0)", BINDINGS)
    assert document == {
        "version": SWEEP_RECORD_VERSION,
        "parameter_label": "RX angle (q0)",
        "bindings": BINDINGS,
    }


def test_sweep_requested_is_false_for_none_and_for_an_empty_or_missing_list():
    assert sweep_requested(None) is False
    assert sweep_requested({}) is False
    assert sweep_requested({"bindings": []}) is False
    assert sweep_requested({"version": 1}) is False


def test_sweep_requested_is_true_for_a_real_document():
    assert sweep_requested(requested_sweep_record("angle", BINDINGS)) is True


def test_binding_qasms_returns_every_program_in_order():
    document = requested_sweep_record("angle", BINDINGS)
    assert binding_qasms(document) == tuple(b["qasm"] for b in BINDINGS)


def test_binding_qasms_is_empty_for_a_run_that_did_not_sweep():
    assert binding_qasms(None) == ()
    assert binding_qasms({"version": 1}) == ()


def test_merged_after_submit_adds_the_adapters_report_beside_the_request():
    stored = requested_sweep_record("angle", BINDINGS)
    merged = merged_after_submit(stored, {"two_qubit_gate_counts": [1, 1, 1]})
    assert merged["parameter_label"] == "angle"
    assert merged["bindings"] == BINDINGS
    assert merged["two_qubit_gate_counts"] == [1, 1, 1]
    assert merged["version"] == SWEEP_RECORD_VERSION


def test_merged_after_submit_is_none_when_neither_side_has_anything():
    assert merged_after_submit(None, None) is None
    assert merged_after_submit({}, None) is None


def test_with_binding_counts_writes_every_bindings_counts_including_the_first():
    """Unlike ZNE's `with_folded_counts`, which skips PUB 0 because it is
    already `raw_counts`, a sweep has no privileged point: `counts[i]` must be
    `bindings[i]`'s own counts for every i, so a reader can zip the two lists
    with no off-by-one."""
    stored = requested_sweep_record("angle", BINDINGS)
    pub_counts = [{"0": 10, "1": 90}, {"0": 50, "1": 50}, {"0": 88, "1": 12}]
    document = with_binding_counts(stored, pub_counts)
    assert document["counts"] == pub_counts
    assert len(document["counts"]) == len(BINDINGS)


def test_with_binding_counts_records_an_error_when_fewer_counts_arrive_than_bindings():
    stored = requested_sweep_record("angle", BINDINGS)
    document = with_binding_counts(stored, [{"0": 1}])
    assert "counts" not in document
    assert "fewer usable counts" in document["error"]


def test_with_binding_counts_records_an_error_for_a_binding_with_zero_total_counts():
    """A PUB whose counts sum to zero is no distribution either — the same
    guard `with_folded_counts` applies for ZNE (Greptile P2 on PR 970)."""
    stored = requested_sweep_record("angle", BINDINGS)
    pub_counts = [{"0": 10, "1": 90}, {}, {"0": 88, "1": 12}]
    document = with_binding_counts(stored, pub_counts)
    assert "counts" not in document
    assert "error" in document


def test_with_binding_counts_tolerates_extra_pubs_beyond_the_bindings():
    """A provider result padded with more PUBs than were bindings (should not
    happen, but the reader must not crash on it) is truncated to the request's
    own count rather than trusted."""
    stored = requested_sweep_record("angle", BINDINGS)
    pub_counts = [{"0": 1}, {"0": 1}, {"0": 1}, {"0": 999}]
    document = with_binding_counts(stored, pub_counts)
    assert len(document["counts"]) == len(BINDINGS)
