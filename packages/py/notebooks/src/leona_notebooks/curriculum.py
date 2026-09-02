"""Many notebooks as one course.

A curriculum source directory mirrors the repository it builds:

    curriculum.yaml                 # title, description, units, extras
    week01_qubits_circuits/
        README.md                   # the unit's guide (copied verbatim)
        lab.nb.py                   # kind=lab      -> lab.ipynb
        challenge.nb.py             # kind=challenge -> challenge.ipynb (stubs)
                                    #               -> solutions/week01_qubits_circuits/challenge_solution.ipynb
        CHECKLIST.md                # -> solutions/week01_qubits_circuits/SELF_EVALUATION.md
    static/                         # copied to the build root as-is (pyproject, scripts, tests…)

`build_curriculum` compiles every `.nb.py`, writes the `.ipynb` builds (never with
outputs), copies everything else, and returns a manifest naming every file it produced.
With `execute=True` it also runs each notebook through nbclient and refuses to report
success for one that failed.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import nbformat
import yaml
from pydantic import BaseModel, ConfigDict, Field

from leona_notebooks.execution import ExecutionReport
from leona_notebooks.ipynb import to_ipynb
from leona_notebooks.source import parse_source
from leona_notebooks.spec import NotebookKind, NotebookSpec
from leona_notebooks.templates import check_structure

SOURCE_SUFFIX = ".nb.py"

#: Never copied into a build: environments, caches and checkpoints an author left behind.
SKIPPED_DIRS: frozenset[str] = frozenset(
    {
        ".venv",
        ".venv.nosync",
        "__pycache__",
        ".ipynb_checkpoints",
        ".pytest_cache",
        ".ruff_cache",
        ".git",
    }
)


def _skipped(relative: Path) -> bool:
    return any(part in SKIPPED_DIRS for part in relative.parts)


#: Kinds whose in-place build hides answers and whose full build lands under `solutions/`.
HIDDEN_ANSWER_KINDS: frozenset[NotebookKind] = frozenset(
    {NotebookKind.CHALLENGE, NotebookKind.QUIZ}
)


class CurriculumUnit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    directory: str
    title: str
    topic: str = ""
    key_concepts: list[str] = Field(default_factory=list)
    deliverable: str = ""
    order: int = 0


class CurriculumSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    title: str
    description: str = ""
    audience: str = ""
    framework: str = "qiskit"
    framework_version: str = ">=2.5,<2.6"
    python: str = ">=3.11"
    units: list[CurriculumUnit] = Field(default_factory=list)
    #: Extra directories built like units but outside the week track (certification, bonus).
    extras: list[str] = Field(default_factory=list)
    #: Files at the source root that describe HOW to author the curriculum rather than
    #: forming part of it. They stay out of the build: an authoring guide or the
    #: original brief shipped to the reader is confusing at best and internal at worst.
    source_only: list[str] = Field(
        default_factory=lambda: ["AUTHORING.md", "BRIEF-from-quanmatic.md"]
    )
    solutions_dir: str = "solutions"
    checklist_name: str = "SELF_EVALUATION.md"


@dataclass
class BuiltNotebook:
    source: Path
    outputs: list[Path]
    spec: NotebookSpec
    structure_failures: list[str] = field(default_factory=list)
    reports: dict[str, ExecutionReport] = field(default_factory=dict)


@dataclass
class BuildManifest:
    out_dir: Path
    notebooks: list[BuiltNotebook]
    copied: list[Path]

    @property
    def ok(self) -> bool:
        return all(
            not nb.structure_failures and all(report.ok for report in nb.reports.values())
            for nb in self.notebooks
        )

    def failures(self) -> list[str]:
        lines: list[str] = []
        for nb in self.notebooks:
            for failure in nb.structure_failures:
                lines.append(f"{nb.source}: structure: {failure}")
            for build, report in nb.reports.items():
                if not report.ok:
                    first = report.first_error()
                    where = (
                        f" cell {first.id}: {first.error.ename}: {first.error.evalue[:160]}"
                        if first and first.error
                        else (f" ({report.note})" if report.note else "")
                    )
                    lines.append(f"{nb.source} [{build}]: execution failed{where}")
        return lines


def load_curriculum(source_dir: str | Path) -> CurriculumSpec:
    path = Path(source_dir) / "curriculum.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return CurriculumSpec.model_validate(data)


def notebook_sources(source_dir: str | Path) -> list[Path]:
    root = Path(source_dir)
    return sorted(
        p
        for p in root.rglob(f"*{SOURCE_SUFFIX}")
        if "static" not in p.relative_to(root).parts and not _skipped(p.relative_to(root))
    )


def _write_notebook(path: Path, notebook: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    nbformat.write(nbformat.from_dict(notebook), str(path))


def builds_for(
    spec: NotebookSpec, relative: Path, curriculum: CurriculumSpec
) -> list[tuple[str, Path]]:
    """Which builds a source produces and where. A challenge or quiz yields the
    answer-free notebook in place and the solution under `solutions/<same dir>/`."""
    stem = relative.name[: -len(SOURCE_SUFFIX)]
    in_place = relative.parent / f"{stem}.ipynb"
    if spec.kind in HIDDEN_ANSWER_KINDS:
        solution = Path(curriculum.solutions_dir) / relative.parent / f"{stem}_solution.ipynb"
        return [("challenge", in_place), ("solution", solution)]
    return [("full", in_place)]


def build_curriculum(
    source_dir: str | Path,
    out_dir: str | Path,
    *,
    execute: bool = False,
    timeout_s: int = 300,
    kernel_name: str = "python3",
    clean: bool = False,
) -> BuildManifest:
    source_root = Path(source_dir)
    out_root = Path(out_dir)
    curriculum = load_curriculum(source_root)
    if clean and out_root.exists():
        shutil.rmtree(out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    copied: list[Path] = []
    # 1. static/ → root
    static = source_root / "static"
    if static.is_dir():
        for item in sorted(static.rglob("*")):
            if item.is_file() and not _skipped(item.relative_to(static)):
                target = out_root / item.relative_to(static)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
                copied.append(target)
    # 2. every other non-source file, in place (guides, checklists, data)
    for item in sorted(source_root.rglob("*")):
        rel = item.relative_to(source_root)
        if not item.is_file() or rel.parts[0] == "static" or item.name == "curriculum.yaml":
            continue
        if rel.as_posix() in set(curriculum.source_only):
            continue
        if _skipped(rel):
            continue
        if item.name.endswith(SOURCE_SUFFIX):
            continue
        if item.name == "CHECKLIST.md":
            target = out_root / curriculum.solutions_dir / rel.parent / curriculum.checklist_name
        else:
            target = out_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied.append(target)

    # 3. notebooks
    built: list[BuiltNotebook] = []
    for source in notebook_sources(source_root):
        rel = source.relative_to(source_root)
        slug = "-".join(part for part in rel.with_suffix("").with_suffix("").parts).replace(
            "_", "-"
        )
        spec = parse_source(source.read_text(encoding="utf-8"), slug=slug[:80])
        entry = BuiltNotebook(
            source=source, outputs=[], spec=spec, structure_failures=check_structure(spec)
        )
        for build, target_rel in builds_for(spec, rel, curriculum):
            target = out_root / target_rel
            _write_notebook(target, to_ipynb(spec, build=build, include_outputs=False))  # type: ignore[arg-type]
            entry.outputs.append(target)
            if execute:
                from leona_notebooks.local_runner import execute_with_nbclient

                _, report = execute_with_nbclient(
                    spec,
                    build=build,
                    timeout_s=timeout_s,
                    kernel_name=kernel_name,
                    cwd=target.parent,  # type: ignore[arg-type]
                )
                entry.reports[build] = report
        built.append(entry)
    return BuildManifest(out_dir=out_root, notebooks=built, copied=copied)
