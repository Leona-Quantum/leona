"""Generate the Phase 7.6 pre-remediation evidence bundle.

This script intentionally records the current, over-broad Phase 7.5 catalog
before S1 changes it.  Runtime reports are local observations, not production
qualification.  Re-running the script replaces only files in this evidence
directory and never mutates the canonical H2 fixture.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from majorana_vqe.standard_catalog import (
    CONTROLLED_COMPARISONS,
    STANDARD_COMPONENTS,
    STANDARD_IMPLEMENTATIONS,
    STANDARD_WORKFLOWS,
)

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g"
MANIFEST_PATH = FIXTURE_DIR / "manifest.json"
CIRCUIT_PATH = FIXTURE_DIR / "canonical_double_excitation_v0.2.json"
COMPONENTS_PATH = FIXTURE_DIR / "executable_components_v0.2.json"

SOURCE_PATHS = (
    Path("uv.lock"),
    Path("runtimes/vqe/Dockerfile"),
    Path("runtimes/vqe/qiskit-current/uv.lock"),
    Path("runtimes/vqe/pennylane-current/uv.lock"),
    Path("docs/atlas/fixtures/h2_sto3g/manifest.json"),
    Path("docs/atlas/fixtures/h2_sto3g/canonical_double_excitation_v0.2.json"),
    Path("docs/atlas/fixtures/h2_sto3g/executable_components_v0.2.json"),
)

RUNTIME_COMMANDS = {
    "qiskit": (
        ROOT / "runtimes" / "vqe" / "qiskit-current",
        ("uv", "run", "--frozen", "python", "spike/h2_actual_vqe_v02.py", "--stdout-only"),
    ),
    "pennylane": (
        ROOT / "runtimes" / "vqe" / "pennylane-current",
        ("uv", "run", "--frozen", "python", "spike/h2_actual_vqe_v02.py", "--stdout-only"),
    ),
}


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _canonical_json(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def _write_json(path: Path, value: Any) -> None:
    path.write_bytes(_canonical_json(value))


def _git(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _run_runtime(framework: str) -> dict[str, Any]:
    cwd, command = RUNTIME_COMMANDS[framework]
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    report = json.loads(completed.stdout)
    if report.get("status") != "succeeded":
        raise RuntimeError(f"{framework} baseline did not succeed")
    if report.get("framework") != framework:
        raise RuntimeError(f"{framework} baseline reported a different framework")
    return report


def _alembic_head() -> str:
    revisions = sorted(
        path.name.split("_", 1)[0]
        for path in (ROOT / "db" / "migrations" / "versions").glob("*.py")
        if path.name[:4].isdigit()
    )
    if not revisions:
        raise RuntimeError("no Alembic revisions found")
    return revisions[-1]


def _claim_inventory() -> dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "interpretation": (
            "Pre-remediation inventory. Counts describe generated Phase 7.5 records, "
            "not independently qualified scientific implementations."
        ),
        "counts": {
            "standard_component_seed_candidates": len(STANDARD_COMPONENTS),
            "generated_implementation_bindings": len(STANDARD_IMPLEMENTATIONS),
            "workflow_templates": len(STANDARD_WORKFLOWS),
            "comparison_specs": len(CONTROLLED_COMPARISONS),
        },
        "component_status_counts": {
            status: sum(item.status.value == status for item in STANDARD_COMPONENTS)
            for status in sorted({item.status.value for item in STANDARD_COMPONENTS})
        },
        "implementation_binding_keys": [
            implementation.binding_key for implementation in STANDARD_IMPLEMENTATIONS
        ],
        "known_overclaim": {
            "kind": "cartesian_workflow_binding_projection",
            "description": (
                "Every executable H2 role was projected onto both Qiskit and PennyLane, "
                "including SciPy, PySCF, dataset, and Atlas-neutral protocol roles."
            ),
            "affected_binding_count": len(STANDARD_IMPLEMENTATIONS),
            "remediation_phase": "7.6-S1",
        },
        "workflow_keys": [workflow.workflow_key for workflow in STANDARD_WORKFLOWS],
        "comparison_keys": [comparison.comparison_key for comparison in CONTROLLED_COMPARISONS],
    }


def _optimizer_swap_protocol() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text())
    circuit = json.loads(CIRCUIT_PATH.read_text())
    components = json.loads(COMPONENTS_PATH.read_text())
    optimizer = components["parameter_optimizer"]
    return {
        "schema_version": "1.0.0",
        "protocol_id": "majorana.h2.fixed_excitation.optimizer_swap.phase76.v1",
        "status": "baseline_frozen",
        "problem": {
            "fixture_id": manifest["fixture_id"],
            "geometry": manifest["geometry"],
            "n_electrons": manifest["electron_orbital_qubit_counts"]["n_electrons"],
            "n_spatial_orbitals": manifest["electron_orbital_qubit_counts"]["n_spatial_orbitals"],
            "n_qubits": manifest["electron_orbital_qubit_counts"]["n_qubits"],
            "nuclear_repulsion_ha": manifest["nuclear_repulsion_ha"],
            "canonical_hamiltonian_term_count": manifest["canonical_hamiltonian"]["term_count"],
            "hamiltonian_digest_kind": "legacy_phase0_sha256",
            "hamiltonian_digest_sha256": manifest["hamiltonian_digest_sha256"],
            "manifest_sha256": _sha256_path(MANIFEST_PATH),
        },
        "reference_state": components["reference_state"],
        "ansatz": components["ansatz"],
        "operator_pool": components["operator_pool"],
        "search_selection": components["search_selection"],
        "growth_batching": components["growth_batching"],
        "measurement": components["measurement"],
        "evaluation": components["evaluation_protocol"],
        "compilation": components["compilation_backend"],
        "baseline_optimizer": optimizer,
        "candidate_optimizer": {
            "algorithm": "scipy_slsqp",
            "provider": "scipy",
            "provider_version": optimizer["provider_version"],
            "status": "not_yet_qualified",
        },
        "comparison_invariants": {
            "changed_component_roles": ["parameter_optimizer"],
            "fixed_component_roles": sorted(
                role for role in components if role != "parameter_optimizer"
            ),
            "same_objective_hard_cap_required": True,
            "same_circuit_digest_required": True,
            "same_resource_protocol_required": True,
        },
        "source_digests": {
            "canonical_circuit_file_sha256": _sha256_path(CIRCUIT_PATH),
            "executable_components_file_sha256": _sha256_path(COMPONENTS_PATH),
            "canonical_circuit_sha256": circuit["canonical_circuit_sha256"],
            "compilation_protocol_sha256": circuit["compilation_protocol_sha256"],
            "common_basis_operation_sequence_sha256": circuit[
                "common_basis_operation_sequence_sha256"
            ],
        },
    }


def generate() -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    source_commit = _git("rev-parse", "HEAD")
    reports = {framework: _run_runtime(framework) for framework in RUNTIME_COMMANDS}
    for framework, report in reports.items():
        _write_json(EVIDENCE_DIR / f"{framework}_bounded_baseline_local.json", report)

    claim_inventory = _claim_inventory()
    protocol = _optimizer_swap_protocol()
    _write_json(EVIDENCE_DIR / "claim_inventory.json", claim_inventory)
    _write_json(EVIDENCE_DIR / "H2_OPTIMIZER_SWAP_PROTOCOL.json", protocol)

    raw_evidence = {
        framework: {
            "path": f"{framework}_bounded_baseline_local.json",
            "sha256": _sha256_path(EVIDENCE_DIR / f"{framework}_bounded_baseline_local.json"),
            "status": report["status"],
            "framework": report["framework"],
            "platform": report["platform"],
            "algorithm": report["optimization"]["algorithm"],
            "best_energy_ha": report["optimization"]["best_energy_ha"],
            "absolute_error_ha": report["optimization"]["absolute_error_ha"],
            "function_evaluations": report["optimization"]["function_evaluations"],
            "circuit_sha256": report["canonical_input"]["canonical_circuit_sha256"],
        }
        for framework, report in reports.items()
    }
    baseline_manifest = {
        "schema_version": "1.0.0",
        "phase": "7.6-S0",
        "source_commit": source_commit,
        "branch": _git("branch", "--show-current"),
        "alembic_head": _alembic_head(),
        "source_file_sha256": {str(path): _sha256_path(ROOT / path) for path in SOURCE_PATHS},
        "evidence_file_sha256": {
            "claim_inventory.json": _sha256_path(EVIDENCE_DIR / "claim_inventory.json"),
            "H2_OPTIMIZER_SWAP_PROTOCOL.json": _sha256_path(
                EVIDENCE_DIR / "H2_OPTIMIZER_SWAP_PROTOCOL.json"
            ),
        },
        "local_runtime_observations": raw_evidence,
        "qualification_boundary": (
            "These runs were observed on the local host. They do not replace the "
            "digest-pinned Linux/x86_64 runtime qualification record."
        ),
    }
    _write_json(EVIDENCE_DIR / "baseline_manifest.json", baseline_manifest)


def check() -> None:
    baseline = json.loads((EVIDENCE_DIR / "baseline_manifest.json").read_text())
    for relative, expected in baseline["source_file_sha256"].items():
        observed = _sha256_path(ROOT / relative)
        if observed != expected:
            raise SystemExit(f"source drift: {relative}: {observed} != {expected}")
    for name, expected in baseline["evidence_file_sha256"].items():
        observed = _sha256_path(EVIDENCE_DIR / name)
        if observed != expected:
            raise SystemExit(f"evidence drift: {name}: {observed} != {expected}")
    protocol = json.loads((EVIDENCE_DIR / "H2_OPTIMIZER_SWAP_PROTOCOL.json").read_text())
    for framework in RUNTIME_COMMANDS:
        report_path = EVIDENCE_DIR / f"{framework}_bounded_baseline_local.json"
        report = json.loads(report_path.read_text())
        if report["canonical_input"]["manifest_sha256"] != protocol["problem"]["manifest_sha256"]:
            raise SystemExit(f"{framework} manifest identity mismatch")
        if (
            report["canonical_input"]["canonical_circuit_sha256"]
            != protocol["source_digests"]["canonical_circuit_sha256"]
        ):
            raise SystemExit(f"{framework} circuit identity mismatch")
        if report["resources"]["common_basis_compiled"]["cnot_count"] != 48:
            raise SystemExit(f"{framework} CNOT protocol mismatch")
        if report["resources"]["common_basis_compiled"]["depth"] != 83:
            raise SystemExit(f"{framework} depth protocol mismatch")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        generate()


if __name__ == "__main__":
    main()
