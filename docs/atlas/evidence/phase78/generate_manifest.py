"""Validate and summarize private local Phase 7.8 COBYLA evidence.

The two runtime reports are produced by independently pinned Qiskit and
PennyLane environments. This generator does not execute them and never
promotes local macOS evidence to Linux/OCI runtime qualification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

EVIDENCE_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = EVIDENCE_DIR / "manifest.json"
REPORT_PATHS = {
    "qiskit": EVIDENCE_DIR / "qiskit_cobyla_local.json",
    "pennylane": EVIDENCE_DIR / "pennylane_cobyla_local.json",
}
EXPECTED_RESOURCES = {
    "cnot_count": 48,
    "depth": 83,
    "gate_count": 152,
    "parameter_count": 1,
}


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


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validated_result(framework: str, path: Path) -> dict[str, Any]:
    report = json.loads(path.read_text())
    optimization = report["optimization"]
    common = report["resources"]["common_basis_compiled"]

    if report.get("status") != "succeeded" or report.get("framework") != framework:
        raise RuntimeError(f"{framework} report identity or status is invalid")
    if optimization.get("algorithm") != "scipy_cobyla":
        raise RuntimeError(f"{framework} report did not execute COBYLA")
    if optimization["absolute_error_ha"] > 1e-10:
        raise RuntimeError(f"{framework} energy error exceeds the frozen gate")
    if optimization["final_state_fidelity"] < 1 - 1e-10:
        raise RuntimeError(f"{framework} fidelity is below the frozen gate")
    if any(common.get(key) != value for key, value in EXPECTED_RESOURCES.items()):
        raise RuntimeError(f"{framework} common-protocol resources drifted")
    if common.get("adapter_verification") != "passed":
        raise RuntimeError(f"{framework} adapter verification did not pass")
    if common.get("metric_scope") != "ansatz_only":
        raise RuntimeError(f"{framework} metric scope drifted")
    if "macOS" not in report.get("platform", "") or "arm64" not in report["platform"]:
        raise RuntimeError(f"{framework} local evidence platform is not recorded accurately")

    return {
        "report": path.name,
        "report_sha256": _sha256(path),
        "provider_versions": report["provider_versions"],
        "platform": report["platform"],
        "energy_ha": optimization["best_energy_ha"],
        "exact_energy_ha": optimization["exact_energy_ha"],
        "absolute_error_ha": optimization["absolute_error_ha"],
        "final_state_fidelity": optimization["final_state_fidelity"],
        "iterations": optimization["iterations"],
        "energy_evaluations": optimization["function_evaluations"],
        "gradient_evaluations": optimization.get("gradient_evaluations", 0),
        "common_protocol_resources": {
            key: common[key] for key in EXPECTED_RESOURCES
        },
        "compilation_protocol_sha256": common["compilation_protocol_sha256"],
        "operation_sequence_sha256": common["operation_sequence_sha256"],
    }


def generate() -> bytes:
    results = {
        framework: _validated_result(framework, path)
        for framework, path in REPORT_PATHS.items()
    }
    energy_delta = abs(results["qiskit"]["energy_ha"] - results["pennylane"]["energy_ha"])
    if energy_delta > 1e-10:
        raise RuntimeError("provider energy parity exceeds the frozen gate")

    return _canonical_json(
        {
            "schema_version": "1.0.0",
            "phase": "7.8",
            "component_semantic_key": "optimizer.cobyla.v1",
            "optimizer_algorithm": "scipy_cobyla",
            "evidence_scope": "private_local_macos_arm64_adapter_evidence",
            "runtime_qualification": "not_established",
            "human_review": "owner_waived",
            "public_execution": "blocked",
            "performance_claim": "not_made",
            "controlled_change": {
                "role": "parameter_optimizer",
                "baseline": "optimizer.slsqp.v1",
                "candidate": "optimizer.cobyla.v1",
            },
            "fixed_acceptance_gates": {
                "maximum_absolute_error_ha": 1e-10,
                "minimum_fidelity": 1 - 1e-10,
                "maximum_provider_energy_delta_ha": 1e-10,
                "common_protocol_resources": EXPECTED_RESOURCES,
            },
            "observed_provider_energy_delta_ha": energy_delta,
            "results": results,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = generate()
    if args.check:
        if not MANIFEST_PATH.exists() or MANIFEST_PATH.read_bytes() != rendered:
            raise SystemExit("Phase 7.8 evidence manifest is stale")
        return
    MANIFEST_PATH.write_bytes(rendered)


if __name__ == "__main__":
    main()
