"""Reproducible evidence that the PennyLane-candidate spike's failure contract
actually works: an invalid basis must produce a non-zero exit, a bounded,
well-formed JSON report with status="execution_failed" and a failure_code,
and must NOT write partial/garbage output. Not tracked product code (Phase 0B
spike per docs/atlas/atlas_vqe_mvp_execution_plan_ja.md); exists so this claim
is a re-runnable test rather than a one-off terminal experiment.

Run with: uv run pytest spike/test_failure_contract.py
"""

from __future__ import annotations

import json

from h2_sto3g_spike import run_spike

INVALID_BASIS = "not-a-real-basis-xyz"
MAX_BOUNDED_JSON_BYTES = 2_000


def test_invalid_basis_produces_bounded_failure_contract(tmp_path):
    output_path = tmp_path / "pennylane_current.json"

    exit_code = run_spike(basis=INVALID_BASIS, output_path=output_path)

    assert exit_code == 1, "an invalid basis must fail closed with a non-zero exit code"
    assert output_path.exists(), "the failure contract must still write a JSON report"

    raw = output_path.read_text()
    assert len(raw.encode("utf-8")) <= MAX_BOUNDED_JSON_BYTES, (
        "failure report must be bounded, not an unbounded traceback dump"
    )

    report = json.loads(raw)  # must be well-formed JSON, not truncated/garbage
    assert report["status"] == "execution_failed"
    assert report["failure_code"] == "execution_failed"
    assert isinstance(report["error_type"], str) and report["error_type"]
    assert isinstance(report["error_message"], str) and report["error_message"]
    # The failure contract is intentionally narrow -- it must not leak into a
    # success-shaped report with partial/fabricated numeric fields.
    assert "qubit_hamiltonian_exact_diagonalization" not in report
    assert "independent_direct_fci_reference" not in report


def test_valid_basis_still_succeeds(tmp_path):
    """Companion sanity check: the failure-contract test above only means
    something if the same code path succeeds on valid input."""
    output_path = tmp_path / "pennylane_current.json"

    exit_code = run_spike(output_path=output_path)

    assert exit_code == 0
    report = json.loads(output_path.read_text())
    assert report["status"] == "ok"
    assert report["qubit_hamiltonian_exact_diagonalization"]["term_count"] == 15
