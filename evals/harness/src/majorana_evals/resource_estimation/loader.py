"""Loads and validates resource-estimation cases from
`evals/resource-estimation-benchmark/cases/*.yaml`.

Unlike the public-benchmarks loaders (which hash-check ONE vendored upstream file against a
pinned constant), this corpus is OUR OWN curated data spread across many small files that get
edited over time as cases are added — so there is no single pinned sha256 constant to check
against. Instead, `dataset_sha256()` computes a hash over the sorted, concatenated bytes of
whatever case files are actually present at load time, and every `BenchmarkReport` records it
(schema.py) — so two reports can be compared for "same case set" without needing a person to
remember which cases existed on which date."""

from __future__ import annotations

import hashlib
from pathlib import Path

import yaml
from pydantic import ValidationError

from majorana_evals.resource_estimation.schema import ResourceEstimationTask

#: evals/resource-estimation-benchmark/cases/
DEFAULT_CASES_DIR = Path(__file__).resolve().parents[4] / "resource-estimation-benchmark" / "cases"


def dataset_sha256(paths: list[Path]) -> str:
    hasher = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.name):
        hasher.update(path.name.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def load_resource_estimation_tasks(
    cases_dir: Path | str = DEFAULT_CASES_DIR,
) -> tuple[list[ResourceEstimationTask], str]:
    """Load every `*.yaml` case, sorted by task_id for determinism.

    Returns `(tasks, dataset_sha256)`. Raises `ValueError` (task_id collision, no cases found)
    or `pydantic.ValidationError` (a malformed case) rather than silently skipping or
    coercing a bad file — a curation mistake should fail the load, not quietly shrink the
    corpus."""

    directory = Path(cases_dir)
    paths = sorted(directory.glob("*.yaml"))
    if not paths:
        raise ValueError(f"no case files found under {directory}")

    tasks: list[ResourceEstimationTask] = []
    seen_ids: dict[str, Path] = {}
    for path in paths:
        raw = yaml.safe_load(path.read_text())
        try:
            task = ResourceEstimationTask.model_validate(raw)
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
        seen_ids[task.task_id] = path
        tasks.append(task)

    tasks.sort(key=lambda t: t.task_id)
    return tasks, dataset_sha256(paths)
