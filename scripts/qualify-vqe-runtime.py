#!/usr/bin/env python3
"""Generate reproducible Phase 5B evidence for the two H2 candidate images.

This is a local qualification harness, not a promotion tool. It never changes
``production_runtime_status`` and cannot assert human review. Every scientific
value is parsed from an actual strict-container run and checked against the
frozen common-basis protocol before the report is written.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_vqe.models import Framework
from majorana_worker.vqe_runtime import build_success_evidence, run_candidate_container

_EXPECTED_COMMON = {
    "two_qubit_gate_count": 48,
    "depth": 83,
    "gate_count": 152,
    "parameter_count": 1,
}
_ROOT = Path(__file__).resolve().parents[1]


def _inspect_image(digest: str) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "/usr/local/bin/docker",
            "image",
            "inspect",
            digest,
            "--format",
            "{{json .}}",
        ],
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "DOCKER_CLI_HINTS": "false"},
    )
    payload = json.loads(completed.stdout)
    if (
        payload.get("Id") != digest
        or payload.get("Architecture") != "amd64"
        or payload.get("Os") != "linux"
    ):
        raise RuntimeError("candidate image identity/platform does not match its profile")
    return {
        "digest": payload["Id"],
        "architecture": payload["Architecture"],
        "os": payload["Os"],
    }


def _check_egress(digest: str) -> dict[str, Any]:
    program = (
        "import socket,sys\n"
        "try:\n socket.create_connection(('1.1.1.1',53),1)\n"
        "except OSError as exc:\n print(type(exc).__name__);sys.exit(0)\n"
        "sys.exit(9)"
    )
    command = [
        "/usr/local/bin/docker",
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "32",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=8m",
        "--user",
        "65532:65532",
        "--entrypoint",
        "/workspace/runtime/.venv/bin/python",
        digest,
        "-c",
        program,
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "DOCKER_CLI_HINTS": "false"},
    )
    if completed.returncode != 0:
        raise RuntimeError("deny-all egress check failed")
    return {
        "network_mode": "none",
        "outbound_connection_blocked": True,
        "exception_class": completed.stdout.strip(),
    }


def _canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"
    ).encode()


def _git_file_bytes(commit: str, path: str) -> bytes:
    completed = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        cwd=_ROOT,
        check=True,
        capture_output=True,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
    )
    return completed.stdout


def _verified_provenance_files(
    framework: Framework,
    profile: Any,
) -> dict[str, str]:
    if profile.source_git_commit is None:
        raise RuntimeError("runtime profile has no source commit")
    profile_dir = f"runtimes/vqe/{framework.value}-current"
    source_files = {
        "dockerfile_sha256": ("runtimes/vqe/Dockerfile", profile.dockerfile_sha256),
        "lock_sha256": (f"{profile_dir}/uv.lock", profile.lock_sha256),
        "entrypoint_sha256": (
            f"{profile_dir}/spike/h2_actual_vqe_v02.py",
            profile.entrypoint_sha256,
        ),
        "fixture_manifest_sha256": (
            "docs/atlas/fixtures/h2_sto3g/manifest.json",
            profile.fixture_manifest_sha256,
        ),
        "canonical_circuit_file_sha256": (
            "docs/atlas/fixtures/h2_sto3g/canonical_double_excitation_v0.2.json",
            profile.canonical_circuit_file_sha256,
        ),
    }
    observed: dict[str, str] = {}
    for field, (path, expected) in source_files.items():
        digest = hashlib.sha256(_git_file_bytes(profile.source_git_commit, path)).hexdigest()
        if digest != expected:
            raise RuntimeError(f"{field} differs from source commit")
        observed[field] = digest

    qualification_digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if qualification_digest != profile.qualification_script_sha256:
        raise RuntimeError("qualification script digest differs from runtime profile")
    observed["qualification_script_sha256"] = qualification_digest

    sbom_path = (
        _ROOT / "docs" / "atlas" / "evidence" / f"phase5b_{framework.value}_runtime_sbom.spdx.json"
    )
    sbom_digest = hashlib.sha256(sbom_path.read_bytes()).hexdigest()
    if sbom_digest != profile.sbom_sha256:
        raise RuntimeError("SBOM digest differs from runtime profile")
    observed["sbom_sha256"] = sbom_digest
    return observed


async def _qualify_framework(
    framework: Framework,
    repetitions: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = candidate_runtime_profile(framework)
    verified_files = _verified_provenance_files(framework, profile)
    image = _inspect_image(profile.local_image_digest)
    runs: list[dict[str, Any]] = []
    first_raw: dict[str, Any] | None = None
    for index in range(repetitions):
        raw = await run_candidate_container(profile.binding)
        if first_raw is None:
            first_raw = raw
        evidence = build_success_evidence(
            raw,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )
        common = next(item for item in evidence.resources if item.stage == "common_basis_compiled")
        observed_common = {
            "two_qubit_gate_count": common.two_qubit_gate_count,
            "depth": common.depth,
            "gate_count": common.gate_count,
            "parameter_count": common.parameter_count,
        }
        if observed_common != _EXPECTED_COMMON:
            raise RuntimeError(f"{framework.value} common-basis resource drift")
        runs.append(
            {
                "repetition": index + 1,
                "best_energy_ha": evidence.best_energy_ha,
                "absolute_error_ha": evidence.absolute_error_ha,
                "final_state_fidelity": evidence.final_state_fidelity,
                "iterations": evidence.iterations,
                "optimizer_work": evidence.optimizer_work.model_dump(mode="json"),
                "common_basis_compiled": observed_common,
                "raw_report_sha256": hashlib.sha256(_canonical_bytes(raw)).hexdigest(),
            }
        )
    if first_raw is None:
        raise RuntimeError("qualification did not execute a runtime")
    return {
        "framework": framework.value,
        "binding": profile.binding.model_dump(mode="json"),
        "lock_sha256": profile.lock_sha256,
        "runtime_provenance": {
            "source_git_commit": profile.source_git_commit,
            "dockerfile_sha256": profile.dockerfile_sha256,
            "entrypoint_sha256": profile.entrypoint_sha256,
            "fixture_manifest_sha256": profile.fixture_manifest_sha256,
            "canonical_circuit_file_sha256": profile.canonical_circuit_file_sha256,
            "canonical_circuit_sha256": profile.canonical_circuit_sha256,
            "compilation_protocol_sha256": profile.compilation_protocol_sha256,
            "common_basis_operation_sequence_sha256": (
                profile.common_basis_operation_sequence_sha256
            ),
            "qualification_script_sha256": profile.qualification_script_sha256,
            "sbom_sha256": profile.sbom_sha256,
            "build_attestation_manifest_sha256": profile.build_attestation_sha256,
            "digest_kind": profile.binding.container_digest_kind,
            "oci_manifest_digest": profile.binding.oci_manifest_digest,
            "complete": profile.provenance_complete,
            "verified_source_and_sbom_files": verified_files,
        },
        "image": image,
        "isolation": _check_egress(profile.local_image_digest),
        "runs": runs,
        "acceptance": {
            "all_runs_succeeded": len(runs) == repetitions,
            "max_absolute_error_ha": max(item["absolute_error_ha"] for item in runs),
            "min_final_state_fidelity": min(item["final_state_fidelity"] for item in runs),
            "common_basis_resources_stable": all(
                item["common_basis_compiled"] == _EXPECTED_COMMON for item in runs
            ),
        },
    }, first_raw


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repetitions", type=int, default=10)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--refresh-raw-fixtures",
        action="store_true",
        help="replace the two raw candidate reports with the first qualified Linux run",
    )
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 100:
        parser.error("--repetitions must be between 1 and 100")
    if os.environ.get("MAJORANA_ENV") != "development":
        raise RuntimeError("qualification requires MAJORANA_ENV=development")
    qualified = [
        await _qualify_framework(framework, args.repetitions)
        for framework in (Framework.QISKIT, Framework.PENNYLANE)
    ]
    candidates = [candidate for candidate, _raw in qualified]
    report = {
        "schema_version": "0.1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "qualification_scope": "local_linux_x86_64_candidate",
        "human_review_state": "unreviewed",
        "production_runtime_status": "unqualified",
        "public_execution": "blocked",
        "promotion_performed": False,
        "candidates": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    if args.refresh_raw_fixtures:
        raw_dir = (
            Path(__file__).resolve().parents[1] / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"
        )
        for framework, (_candidate, raw) in zip(
            (Framework.QISKIT, Framework.PENNYLANE),
            qualified,
            strict=True,
        ):
            (raw_dir / f"{framework.value}_vqe_v0.2.json").write_bytes(_canonical_bytes(raw))


if __name__ == "__main__":
    asyncio.run(main())
