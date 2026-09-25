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

from . import (
    CONTRACTS_VERSION,
    circuit_checks,
    comments,
    courses,
    events,
    models,
    notebook_shares,
    notebooks,
    notifications,
    plan,
    presence,
    scope,
    tokens,
    tour_signals,
)

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
    # Proposal 3 (targeted synthesis): a second, target-aware entry point into
    # the same trusted compiler lane CircuitOptimizationRequest/Result serve —
    # SynthesisRequest is the request body, SynthesisResult the assembled
    # per-compiler-candidate answer also carried inside SynthesisResultEvent
    # (hoisted automatically via the RunEvent union above).
    models.SynthesisTarget,
    models.SynthesisRequest,
    models.SynthesisEquivalence,
    models.SynthesisCandidate,
    models.SynthesisResult,
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
    notebooks.GradeReport,
    notebooks.CellGrade,
    notebooks.BlockRef,
    notebooks.GradeAttemptRequest,
    notebooks.GradeAttemptResponse,
    notebooks.NotebookGradesSnapshot,
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
    # Proposal 8. Only the top-level response is listed: the row, entry and
    # module shapes and the visibility enum are referenced by it and get hoisted.
    courses.CourseGradebook,
    models.VerificationRecord,
    models.QpuRunRecord,
    # Proposal 9, first slice (migration 0068). CommentTargetType is an enum and
    # reaches the document as a hoisted $def of Comment and the request body.
    comments.CommentPerson,
    comments.Comment,
    comments.CommentList,
    comments.CommentPeopleList,
    comments.CreateCommentRequest,
    comments.UpdateCommentRequest,
    # Proposal 7 Phase B, personal access tokens (migration 0069). TokenScope is an
    # enum and reaches the document as a hoisted $def of the two shapes that carry it.
    # `MintedToken` is listed even though it is the one response that carries a
    # secret: what reaches the schema is the FIELD, `token: string`, which is exactly
    # what a generated client needs in order to have somewhere to put it — and
    # leaving it out would not hide anything, it would just mean the one response a
    # client must handle carefully is the one with no generated type.
    tokens.PersonalAccessToken,
    tokens.PersonalAccessTokenList,
    tokens.MintedToken,
    tokens.CreateTokenRequest,
    # Proposal 9, second slice (migration 0070). PresenceTargetType is an enum
    # and reaches the document as a hoisted $def of the two shapes below.
    presence.PresenceViewer,
    presence.PresenceList,
    presence.PresenceHeartbeatRequest,
    # ai-ops 326, the guided tours' signal counts (migration 0071, anonymous).
    # TourSignalKind is an enum and reaches the document as a hoisted $def.
    tour_signals.RecordTourSignalRequest,
    # Proposal 7 ("Notebooks and courses for a class"), public read-only notebook
    # share links, ai-ops 349 option 2 (migration 0072).
    notebook_shares.NotebookShareLink,
    notebook_shares.NotebookShareLinkList,
    notebook_shares.MintedNotebookShareLink,
    notebook_shares.CreateNotebookShareLinkRequest,
    notebook_shares.LookupNotebookShareRequest,
    # `PublicNotebookView` is a bare `BaseModel`, not a `models._ResourceBase`
    # subclass (deliberately — see its own docstring), so
    # `test_every_public_resource_model_reaches_the_export` does not REQUIRE it
    # here. It is listed anyway: this hand-maintained list is what
    # `packages/ts/contracts-gen` actually generates the web app's TS types
    # from, and the web app needs `components["schemas"]["PublicNotebookView"]`
    # exactly as much as any `_ResourceBase` type — the export test's `_ResourceBase`
    # filter is a floor on this list, not a ceiling.
    notebook_shares.PublicNotebookView,
    # ai-ops 349, option 2, "Job-finished notifications" (migration 0073).
    # NotificationKind is an enum and reaches the document as a hoisted $def.
    notifications.Notification,
    notifications.NotificationList,
    # ai-ops 382 option 1: the agent connector's `check_circuit` (POST /v1/checks/circuit).
    # CheckProperty and CheckVerdict are hoisted as $defs of these two.
    circuit_checks.CircuitCheckRequest,
    circuit_checks.CircuitCheckResponse,
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
