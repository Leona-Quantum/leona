"""Every circuit the open repository publishes must actually RUN.

## Why classification was not enough

`test_catalog_bootstrap_manifest.py` proves every published Python variant says
what it built — that it binds `FINAL_CIRCUIT` or `RESULT`, so Leona can tell what
it is instead of handing it to a language model to be rewritten. That is a
statement about the *source text*. It says nothing about whether the source runs.

When that check first went green, four published sources did not execute at all,
against the framework versions this product ships:

* `cluster-state-1d`, `graph-state-ring` — `StabilizerState.stabilizer_string_list`
  has not existed since Qiskit 2.x
* `ecr-gate` — `cirq.MatrixGate` took `num_qubits` in an older Cirq
* `werner-state` — `qiskit.quantum_info` has no `partial_transpose`

plus one that called two functions nobody ever defined. Nothing was checking, so
the drift arrived silently with a dependency bump and sat there. A user copying
one of those into Studio and pressing run got a traceback from Leona's own
catalog.

## Why it lives in the ordinary suite

Measured: 224 variants, ~30 s wall on six workers, ~0.5 s of CPU each. Cheap
enough that gating it behind an env var — the shape that let the live-provider
test rot for weeks — buys nothing. It runs where every other test runs.

The frameworks are workspace dev dependencies, not optional extras, so a missing
one is an ImportError and a red job rather than a skip.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from majorana_api.catalog_bootstrap_manifest import default_manifest_path

COMMITTED = default_manifest_path()
EXECUTABLE_FRAMEWORKS = {"qiskit", "cirq", "pennylane"}
PER_SOURCE_TIMEOUT_SECONDS = 180


def _python_variants() -> list[tuple[str, str, str]]:
    """(identity, framework, code) for every published source Leona would run."""
    manifest = json.loads(COMMITTED.read_text())
    return [
        (
            item["upstream_identity"],
            (variant.get("framework") or "").lower(),
            variant.get("code") or "",
        )
        for item in manifest["items"]
        for variant in json.loads(item["source_blob"]).get("codeVariants", [])
        if (variant.get("framework") or "").lower() in EXECUTABLE_FRAMEWORKS
        and variant.get("language") == "python"
        and variant.get("status") in {"native", "conversion"}
    ]


def _run(row: tuple[str, str, str]) -> tuple[str, str, str] | None:
    identity, framework, code = row
    handle = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False)
    try:
        handle.write(code)
        handle.close()
        try:
            proc = subprocess.run(
                [sys.executable, handle.name],
                capture_output=True,
                text=True,
                timeout=PER_SOURCE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return identity, framework, f"did not finish in {PER_SOURCE_TIMEOUT_SECONDS}s"
        if proc.returncode == 0:
            return None
        # The last stderr line is the exception; the traceback above it is this
        # harness's temp path and tells the reader nothing.
        lines = [line for line in (proc.stderr or "").strip().splitlines() if line.strip()]
        return (
            identity,
            framework,
            lines[-1][:200] if lines else f"exit {proc.returncode}, no stderr",
        )
    finally:
        Path(handle.name).unlink(missing_ok=True)


def test_every_published_source_runs():
    variants = _python_variants()
    assert len(variants) == 224, "executable variants in the published catalog"

    workers = min(8, (os.cpu_count() or 2) + 2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        failures = [result for result in pool.map(_run, variants) if result is not None]

    assert failures == [], "published sources that do not run:\n" + "\n".join(
        f"  {identity} :: {framework} — {error}" for identity, framework, error in failures
    )
