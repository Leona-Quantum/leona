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


async def _qualify_framework(framework: Framework, repetitions: int) -> dict[str, Any]:
    profile = candidate_runtime_profile(framework)
    image = _inspect_image(profile.local_image_digest)
    runs: list[dict[str, Any]] = []
    for index in range(repetitions):
        raw = await run_candidate_container(profile.binding)
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
            }
        )
    return {
        "framework": framework.value,
        "binding": profile.binding.model_dump(mode="json"),
        "lock_sha256": profile.lock_sha256,
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
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repetitions", type=int, default=10)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 100:
        parser.error("--repetitions must be between 1 and 100")
    if os.environ.get("MAJORANA_ENV") != "development":
        raise RuntimeError("qualification requires MAJORANA_ENV=development")
    candidates = [
        await _qualify_framework(framework, args.repetitions)
        for framework in (Framework.QISKIT, Framework.PENNYLANE)
    ]
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


if __name__ == "__main__":
    asyncio.run(main())
