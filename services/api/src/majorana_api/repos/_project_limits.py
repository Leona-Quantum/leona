"""What a project holds, and whether it is shared — the predicates, once.

Three modules need these and they cannot import each other: the direction is
`artifacts` ← `projects` ← `shares`, so anything all three use has to sit below
all three. That is the only reason this file exists.

## The rule these express (owner, 2026-08-02)

> "same 50-artifact limit applies to projects not shared across the board —
> unlimited non-shared projects can be created, but artifacts in nonshared
> projects count towards the normal artifact count. only artifacts in shared
> projects count towards the specifically shared artifact limit (limited by
> # of shared projects and the 50 artifact limit in each project)"

Read as three separate statements, because they are enforced in three places:

1. **The per-project limit binds every project**, shared or not. Until this it
   was checked in exactly one function — `shares.contribute_artifact`, the path
   a *guest* takes — so the owner of a project could put 55 artifacts into a
   50-artifact project by filing their own, and could do it into a project whose
   limit they had set to 2 and then shared. Both measured before being changed.
2. **The individual artifact allowance counts artifacts NOT in a shared
   project.** `in_a_shared_project` is the predicate that removes them.
3. **The shared bucket needs no counter of its own.** It is the product of the
   two caps above — a person may be in `TierLimits.shared_projects` shared
   projects and each holds at most `project_artifact_limit(project)` — so a
   third number would be a third thing to drift.

## What "shared" means here, and why it is `live`

A project is shared when at least one grant on it is **live**: not expired, in a
workspace that still exists. Expired grants are deliberately excluded, and that
choice has a consequence worth stating out loud — when the last grant on a
project expires, its artifacts return to the individual allowance and can put a
workspace over its cap. Nothing breaks: the allowance is a gate on new writes,
never an invariant over existing rows, so the workspace simply files nothing new
until it is under again. That is the same behaviour as moving down a tier, and
the alternative — counting dead grants — would mean a project shared once in
2026 exempts its artifacts forever.

`MAX_SHARES_PER_PROJECT` counts expired grants and this does not. They are
different questions: that ceiling exists to stop a grant list being used as a
publication channel, so a dead row still has to occupy a slot.
"""

from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import Artifact, Project, ProjectShare, Workspace
from ._base import RepoError

#: Artifacts one project may hold when its owner has not said otherwise. The
#: owner's number. Stored per project (`projects.max_artifacts`) so it can be
#: raised or lowered for one project without moving anybody else's.
DEFAULT_PROJECT_ARTIFACT_LIMIT = 50

#: The ceiling on that per-project number. Mirrors the database's
#: `ck_projects_max_artifacts_range`; `test_project_artifact_limit.py` asserts
#: the two agree rather than trusting that they do.
MAX_PROJECT_ARTIFACT_LIMIT = 500


class ProjectFull(RepoError):
    """This project already holds as many artifacts as its limit allows.

    Carries both numbers and the limit's owner-set-ness for the same reason
    `ArtifactCapReached` carries its two: the sentence a user reads names them,
    and a caller that recounted to build that sentence would be reading outside
    the lock that made the number true.
    """

    def __init__(self, held: int, limit: int) -> None:
        super().__init__(f"project holds {held} of its {limit}-artifact limit")
        self.held = held
        self.limit = limit


def project_artifact_limit(project: Project) -> int:
    """The limit for one project, resolved. Never `None` on the way out.

    `projects.max_artifacts` is nullable and NULL means "the default", not
    "unlimited" — the column was added after projects existed, so every row
    predating it reads NULL and an unlimited reading would exempt exactly the
    oldest projects from the cap.
    """
    limit = project.max_artifacts
    return DEFAULT_PROJECT_ARTIFACT_LIMIT if limit is None else int(limit)


def live_share_predicates() -> list[Any]:
    """What makes a grant currently good. Written once, used by every reader.

    `func.now()` rather than a Python timestamp so the clock that decides is the
    database's — the same clock that stamped `created_at` — and so a caller
    cannot influence it at all. Inside a transaction it is the transaction's
    start time, which is what makes a request that reads twice see one answer.
    """
    return [
        (ProjectShare.expires_at.is_(None)) | (ProjectShare.expires_at > func.now()),
        Workspace.deleted_at.is_(None),
    ]


def kept_artifacts_of(project_id: Any, workspace_id: Any) -> list[Any]:
    """The artifacts that count toward a project's limit — one list, five callers.

    `workspace_id` is in here as well as `project_id`, and it is not redundant:
    `artifacts.project_id` is a plain foreign key, so nothing in the DATABASE
    stops a row in workspace B from pointing at a project in workspace A. Only
    `set_artifact_project` writes that column and it checks both halves — but
    "one function currently gets it right" is not the guarantee to rest a tenant
    boundary on, and the extra predicate lets every one of these queries use
    `ix_artifacts_workspace_project`.

    Kept only, and that is what makes the two enforcement points necessary
    rather than one: an UNKEPT artifact can be filed into a full project without
    spending a slot, so `keep_artifact` has to check the project cap too. Moving
    the predicate to "any artifact" instead would refuse a copy being staged.
    """
    return [
        Artifact.project_id == project_id,
        Artifact.workspace_id == workspace_id,
        Artifact.deleted_at.is_(None),
        Artifact.kept_at.is_not(None),
    ]


async def count_project_artifacts(
    session: AsyncSession, *, project_id: Any, workspace_id: Any
) -> int:
    """How many artifacts a project holds against its limit.

    Takes ids rather than a `Scope` deliberately, and is the one function in this
    layer that does. It is called from two directions that hold different scopes
    for the same project — the owner's own scope, and `shares._elevated` pointing
    at the OWNING workspace — and both pass the workspace id they have already
    proven. Nothing here reads a row a caller could not otherwise reach: the
    count is a number, not a row, and both ids are bound in the statement.
    """
    return int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(*kept_artifacts_of(project_id, workspace_id))
            )
        ).scalar_one()
    )


def in_a_shared_project() -> Any:
    """Correlated EXISTS: this artifact sits in a project with a live grant.

    The one predicate that decides which allowance an artifact spends. Written
    as an EXISTS on the artifact rather than as a join so it can be dropped into
    a count without changing that count's cardinality — a join through
    `project_shares` multiplies a project shared with three people by three, and
    a cap comparing a tripled count to a limit is a cap that refuses at a third
    of its number.

    `Workspace` is joined for `live_share_predicates`' deleted check, and it is
    the OWNING workspace: a project whose workspace is soft-deleted confers
    nothing, so its artifacts go back to counting normally.
    """
    return exists(
        select(ProjectShare.id)
        .select_from(ProjectShare)
        .join(Project, Project.id == ProjectShare.project_id)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .where(ProjectShare.project_id == Artifact.project_id, *live_share_predicates())
        .correlate(Artifact)
    )


async def is_project_shared(session: AsyncSession, project_id: Any) -> bool:
    """Whether this project currently carries any live grant.

    Asked before a move and before a grant, never cached across a statement: the
    answer changes when a grant expires, and `func.now()` inside
    `live_share_predicates` is the transaction's clock, so two reads in one
    transaction agree with each other by construction.
    """
    return bool(
        (
            await session.execute(
                select(
                    exists(
                        select(ProjectShare.id)
                        .select_from(ProjectShare)
                        .join(Project, Project.id == ProjectShare.project_id)
                        .join(Workspace, Workspace.id == Project.workspace_id)
                        .where(ProjectShare.project_id == project_id, *live_share_predicates())
                    )
                )
            )
        ).scalar_one()
    )
