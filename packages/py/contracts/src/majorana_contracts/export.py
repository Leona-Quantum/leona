"""Deterministic OpenAPI export: models → components/schemas → openapi.json at the
package root. packages/ts/contracts-gen generates TS types from that file; CI
regenerates both and fails on diff (ADR-0008).

Usage: uv run python -m majorana_contracts.export [--check] [--out PATH]
"""

import argparse
import json
import sys
from pathlib import Path

from pydantic import RootModel
from pydantic.json_schema import models_json_schema

from . import CONTRACTS_VERSION, courses, events, models, notebooks, plan, scope

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "openapi.json"


class RunEvent(RootModel[events.RunEvent]):
    """Discriminated union of all run event types (class name sets the schema id)."""


EXPORTED = [
    RunEvent,
    plan.Plan,
    scope.Scope,
    models.Workspace,
    models.WorkspaceFolder,
    models.WorkspaceInvitation,
    models.WorkspaceMember,
    models.WorkspaceOverview,
    models.WorkspaceSummary,
    models.Project,
    models.ProjectShare,
    models.SharedProject,
    # Exported from the package since they were written, and absent from this
    # list until 2026-08-01 — so neither reached openapi.json or the generated TS.
    # Found by `test_every_public_resource_model_reaches_the_export`, which exists
    # because the test above iterates THIS list and therefore cannot see a name
    # that is not on it.
    models.Conversation,
    models.ConversationTurn,
    models.Artifact,
    models.ArtifactVersion,
    models.CatalogProvenance,
    models.PublicCatalogEntry,
    # E4. Only the two top-level shapes are listed; the layer summaries
    # (AssumptionSetSummary, LogicalCostSummary, CodeDistanceSummary,
    # FootprintSummary, RuntimeSummary, CatalogEstimateSummary) are referenced by
    # these and get hoisted as $defs automatically.
    models.CatalogEntryEstimate,
    models.CatalogEstimateList,
    # R1. Sibling of the two above and deliberately not nested inside them: a
    # profile is a property of the circuit, not of an assumption set.
    models.CatalogEntryProfile,
    models.CatalogProfileList,
    models.CircuitOptimizationRequest,
    models.CircuitOptimizationResult,
    models.Run,
    models.Qapp,
    models.QappVersion,
    models.PublicQapp,
    models.QappExecution,
    notebooks.Notebook,
    notebooks.NotebookVersion,
    notebooks.NotebookVersionSummary,
    notebooks.NotebookTurn,
    notebooks.NotebookList,
    notebooks.NotebookVersionList,
    notebooks.NotebookTurnList,
    notebooks.NotebookTemplates,
    notebooks.CreateNotebookRequest,
    notebooks.CreateNotebookResponse,
    notebooks.CreateNotebookTurnRequest,
    notebooks.CreateNotebookTurnResponse,
    notebooks.ImportNotebookRequest,
    notebooks.ImportNotebookResponse,
    notebooks.RerunNotebookResponse,
    notebooks.AuthorNotebookVersionRequest,
    notebooks.AuthorNotebookVersionResponse,
    notebooks.UpdateNotebookRequest,
    courses.Course,
    courses.CourseSummary,
    courses.CourseModule,
    courses.CourseTurn,
    courses.CourseList,
    courses.CourseTurnList,
    courses.CoursePlan,
    courses.PlannedModule,
    courses.CreateCourseRequest,
    courses.CreateCourseResponse,
    courses.UpdateCourseRequest,
    courses.CourseModulePatch,
    courses.GenerateCourseRequest,
    courses.GenerateCourseResponse,
    courses.CreateCourseTurnRequest,
    courses.CreateCourseTurnResponse,
    models.VerificationRecord,
    models.QpuRunRecord,
]


def build_document() -> dict:
    _, top = models_json_schema(
        [(m, "serialization") for m in EXPORTED],
        ref_template="#/components/schemas/{model}",
    )
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "majorana-contracts",
            "version": CONTRACTS_VERSION,
            "description": "Cross-boundary types only; API paths are owned by services/api.",
        },
        "paths": {},
        "components": {"schemas": top["$defs"]},
    }


def render() -> str:
    return json.dumps(build_document(), indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="majorana_contracts.export")
    parser.add_argument("--check", action="store_true", help="verify openapi.json is current")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    rendered = render()
    if args.check:
        if not args.out.exists() or args.out.read_text() != rendered:
            print(f"STALE: {args.out} does not match the models — run the export", file=sys.stderr)
            return 1
        print(f"OK: {args.out} is current")
        return 0
    args.out.write_text(rendered)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
