#!/usr/bin/env python3
"""Run the Private Component-First VQE MVP release checks.

Offline mode is deterministic and credential-free. Private-E2E mode is an
operator gate: missing prerequisites are a hard NOT_RUN result, never a skip
that could be mistaken for release evidence.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _run(label: str, command: list[str]) -> None:
    print(f"[RUN] {label}", flush=True)
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode:
        print(f"[FAIL] {label} (exit {result.returncode})", file=sys.stderr)
        raise SystemExit(result.returncode)
    print(f"[PASS] {label}", flush=True)


def _offline() -> None:
    _run(
        "capability manifest is current",
        [sys.executable, "scripts/generate-vqe-private-mvp-manifest.py", "--check"],
    )
    _run(
        "standard catalog projection is current",
        [sys.executable, "scripts/generate-standard-vqe-catalog.py", "--check"],
    )
    _run(
        "VQE scientific and API contract tests",
        [
            sys.executable,
            "-m",
            "pytest",
            "packages/py/vqe/tests/test_standard_catalog.py",
            "packages/py/vqe/tests/test_executable_plan.py",
            "services/api/tests/test_vqe_routes.py",
            "services/api/tests/test_vqe_spec_resolution.py",
            "services/api/tests/test_vqe_runtime_isolation.py",
            "-q",
        ],
    )
    _run("web typecheck", ["pnpm", "--filter", "web", "typecheck"])
    _run(
        "web manifest and proof parsers",
        [
            "node",
            "--experimental-strip-types",
            "--test",
            "apps/web/lib/atlas-vqe/private-mvp-source.test.ts",
            "apps/web/lib/atlas-vqe/standard-source.test.ts",
            "apps/web/lib/vqe-controlled-comparison.test.ts",
            "apps/web/lib/vqe-proof.test.ts",
            "apps/web/lib/vqe-workflow-launch.test.ts",
        ],
    )
    print("[GO] deterministic offline gate passed", flush=True)


def _private_e2e() -> None:
    required = {
        "DATABASE_URL": lambda value: bool(value),
        "MAJORANA_VQE_E2E_WORKFLOW_ID": lambda value: bool(value),
        "MAJORANA_RUN_VQE_PRODUCTION_E2E": lambda value: value == "1",
        "MAJORANA_VQE_RUNTIME_HOST": lambda value: value == "dedicated",
    }
    missing = [name for name, check in required.items() if not check(os.environ.get(name, ""))]
    if missing:
        print(
            "NOT_RUN — GO判定不可: private E2E prerequisites are missing or invalid: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        raise SystemExit(2)
    _run(
        "WorkOS-shaped JWT → disposable PostgreSQL → digest-pinned OCI private E2E",
        [sys.executable, "-m", "pytest", "services/api/tests/test_vqe_production_e2e.py", "-q"],
    )
    print("[GO] private E2E gate passed; publication remains blocked", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("offline", "private-e2e"), default="offline")
    args = parser.parse_args()
    if args.mode == "offline":
        _offline()
    else:
        _private_e2e()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
