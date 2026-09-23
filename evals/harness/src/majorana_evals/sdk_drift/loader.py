"""Loads and validates SDK-drift cases from `evals/sdk-drift-benchmark/cases/*.yaml`.

Same convention as `paper_to_code.loader` / `resource_estimation.loader`: our own curated
corpus, hashed rather than pinned against a single upstream constant.

The sandbox guard is checked against the CANONICAL solution only at load time (it must be
usable — the whole benchmark is meaningless if even the modern-idiom reference can't run).
The outdated solution is deliberately allowed to use a pre-1.0/pre-2.0 import the guard
might also flag (e.g. `qiskit.providers.aer`, which the allowlist covers only via the
top-level `qiskit` name being allowed regardless of submodule — see `guard.py`'s
`_top_level` extraction) — the guard operates at the top-level-module granularity, so this
in practice only matters if a genuinely different, disallowed top-level package is used,
which would itself be worth flagging; `loader.py` does not special-case it further."""

from __future__ import annotations

import hashlib
from pathlib import Path

import yaml
from pydantic import ValidationError

from majorana_sandbox.guard import check_python_code

from majorana_evals.sdk_drift.prompt_neutrality import leaked_identifiers
from majorana_evals.sdk_drift.schema import SdkDriftTask

#: evals/sdk-drift-benchmark/cases/
DEFAULT_CASES_DIR = Path(__file__).resolve().parents[4] / "sdk-drift-benchmark" / "cases"


def dataset_sha256(paths: list[Path]) -> str:
    hasher = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.name):
        hasher.update(path.name.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def load_sdk_drift_tasks(
    cases_dir: Path | str = DEFAULT_CASES_DIR,
) -> tuple[list[SdkDriftTask], str]:
    """Load every `*.yaml` case, sorted by task_id for determinism.

    Returns `(tasks, dataset_sha256)`. Raises `ValueError` (task_id/filename mismatch,
    duplicate id, no cases found, or a canonical solution the sandbox guard blocks) or
    `pydantic.ValidationError` (a malformed case)."""

    directory = Path(cases_dir)
    paths = sorted(directory.glob("*.yaml"))
    if not paths:
        raise ValueError(f"no case files found under {directory}")

    tasks: list[SdkDriftTask] = []
    seen_ids: dict[str, Path] = {}
    for path in paths:
        raw = yaml.safe_load(path.read_text())
        try:
            task = SdkDriftTask.model_validate(raw)
        except ValidationError as exc:
            raise ValueError(f"{path}: invalid case — {exc}") from exc
        if task.task_id != path.stem:
            raise ValueError(
                f"{path}: task_id {task.task_id!r} does not match filename stem {path.stem!r}"
            )
        if task.task_id in seen_ids:
            raise ValueError(
                f"duplicate task_id {task.task_id!r}: {seen_ids[task.task_id]} and {path}"
            )
        guard = check_python_code(task.scaffold + task.canonical_solution)
        if not guard.ok:
            raise ValueError(
                f"{path}: canonical (modern-idiom) solution blocked by the sandbox import "
                f"guard ({guard.reason}) — unusable as a task"
            )
        leaks = leaked_identifiers(task)
        if leaks:
            raise ValueError(
                f"{path}: prompt names the very API drift it grades ({leaks!r}) — a prompt "
                "that tells the model which idiom to use measures instruction-following, "
                "not SDK currency; see prompt_neutrality.py"
            )
        seen_ids[task.task_id] = path
        tasks.append(task)

    tasks.sort(key=lambda t: t.task_id)
    return tasks, dataset_sha256(paths)
