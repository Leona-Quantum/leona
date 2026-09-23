"""Loads and validates paper-to-code cases from
`evals/paper-to-code-benchmark/cases/*.yaml`.

Same convention as `majorana_evals.resource_estimation.loader`: this is our own curated
corpus (not a single pinned upstream file), so `dataset_sha256()` hashes the sorted,
concatenated bytes of whatever case files are present at load time rather than checking a
single constant.

Every case's `scaffold + canonical_solution` is run through the sandbox guard's import
allowlist AT LOAD TIME, not just at grading time: a case whose own reference solution needs
a blocked import is unusable as a task (a model could never pass it either), so this fails
the load loudly rather than silently shipping a case nothing can ever pass."""

from __future__ import annotations

import hashlib
from pathlib import Path

import yaml
from pydantic import ValidationError

from majorana_sandbox.guard import check_python_code

from majorana_evals.paper_to_code.schema import PaperToCodeTask

#: evals/paper-to-code-benchmark/cases/
DEFAULT_CASES_DIR = Path(__file__).resolve().parents[4] / "paper-to-code-benchmark" / "cases"


def dataset_sha256(paths: list[Path]) -> str:
    hasher = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.name):
        hasher.update(path.name.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def load_paper_to_code_tasks(
    cases_dir: Path | str = DEFAULT_CASES_DIR,
) -> tuple[list[PaperToCodeTask], str]:
    """Load every `*.yaml` case, sorted by task_id for determinism.

    Returns `(tasks, dataset_sha256)`. Raises `ValueError` (task_id/filename mismatch,
    duplicate id, no cases found, or a reference solution the sandbox guard blocks) or
    `pydantic.ValidationError` (a malformed case) rather than silently skipping a bad file."""

    directory = Path(cases_dir)
    paths = sorted(directory.glob("*.yaml"))
    if not paths:
        raise ValueError(f"no case files found under {directory}")

    tasks: list[PaperToCodeTask] = []
    seen_ids: dict[str, Path] = {}
    for path in paths:
        raw = yaml.safe_load(path.read_text())
        try:
            task = PaperToCodeTask.model_validate(raw)
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
                f"{path}: reference solution blocked by the sandbox import guard "
                f"({guard.reason}) — a task whose own reference needs a disallowed import "
                "is unusable, since no candidate could ever pass it either"
            )
        seen_ids[task.task_id] = path
        tasks.append(task)

    tasks.sort(key=lambda t: t.task_id)
    return tasks, dataset_sha256(paths)
