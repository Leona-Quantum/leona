"""Notebooks: AI-generated Jupyter lessons as a versioned resource.

Generation and revision are `run.execute`-shaped in every way that matters for
admission control: a notebook version costs a sandbox dispatch exactly like an
EXECUTE or Qapp run, so it rides the same `runs` row, the same idempotency
mechanics, and the same abuse/tier gate (`routes.runs._enforce_execute_backstop`,
now also armed for `RunMode.NOTEBOOK` — see that module and `repos/runs.py`'s
`BACKSTOP_COUNTED_MODES`). The worker does the actual work
(`notebook.generate` / `notebook.revise`); this module only creates the queued
row and hands the job off.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from typing import Annotated, Any, Literal

import majorana_contracts as contracts
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from leona_notebooks import from_ipynb, to_ipynb
from leona_notebooks.ipynb import Build as NotebookBuild
from leona_notebooks.ipynb import build_for_kind
from leona_notebooks.courses import COURSE_STARTERS
from leona_notebooks.authoring import (
    AuthoringInputError,
    advisory_structure,
    spec_from_author_request,
)
from leona_notebooks.source import render_source
from leona_notebooks.templates import (
    KIND_DESCRIPTIONS,
    RESEARCH_BRIEFS,
    STARTER_BRIEFS,
    structure_for,
)
from majorana_contracts.enums import Framework, RunMode

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..jobs import (
    NOTEBOOK_GENERATE_JOB_KIND,
    NOTEBOOK_GRADE_JOB_KIND,
    NOTEBOOK_REVISE_JOB_KIND,
)
from ..orm import Notebook as NotebookRow
from ..orm import NotebookVersion as NotebookVersionRow
from ..repos import notebooks as notebooks_repo
from ..repos import runs as runs_repo
from ..repos import system
from ..request_models import RequestModel
from ..settings import Settings
from .runs import CreateRunRequest as _CreateRunRequest
from .runs import _assert_same_request, _enforce_execute_backstop, _idempotency_request_hash

router = APIRouter()


# --------------------------------------------------------------------------- requests
#
# The contracts classes are the wire shape (majorana_contracts.notebooks — shared with
# the TS client via contracts-gen); these subclasses add nothing but the NUL-byte guard
# every request body must inherit (request_models.RequestModel,
# test_request_models_refuse_nul.py). Declared here rather than in contracts because
# RequestModel is services/api-only — contracts must not depend on it.


class CreateNotebookRequest(RequestModel, contracts.CreateNotebookRequest):
    pass


class CreateNotebookTurnRequest(RequestModel, contracts.CreateNotebookTurnRequest):
    pass


class ImportNotebookRequest(RequestModel, contracts.ImportNotebookRequest):
    pass


class AuthorNotebookVersionRequest(RequestModel, contracts.AuthorNotebookVersionRequest):
    pass


class UpdateNotebookRequest(RequestModel, contracts.UpdateNotebookRequest):
    pass


_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")


def _slug(seed: str) -> str:
    """A workspace-unique-enough slug: a readable stem plus eight random hex
    characters. Unlike `repos.qapps._slug`, which embeds the FUTURE row's own
    UUID to make a *globally* unique public-URL slug, `notebooks.slug` is only
    unique per workspace (migration 0058's `uq_notebooks_workspace_slug`) and
    `create_notebook` generates the notebook's id internally — the route never
    has it to embed. Eight hex characters (2**32 values) makes a collision
    inside one workspace's notebooks astronomically unlikely without needing
    the id up front; a collision would surface as a 500 on the unique
    constraint rather than being retried, which is an acceptable gap for a
    first cut and is called out in the lane report.
    """
    stem = _SLUG_STRIP_RE.sub("-", seed.lower()).strip("-")[:60]
    return f"{stem or 'notebook'}-{uuid.uuid4().hex[:8]}"


def _default_title(body: contracts.CreateNotebookRequest) -> str:
    return body.title or body.brief.strip().splitlines()[0][:120] or "Untitled notebook"


def _run_framework(framework: contracts.NotebookFramework | None) -> Framework:
    """`runs.framework` tracks the sandbox execution family (qiskit/pennylane/...);
    `NotebookFramework.name` allows `cudaq`, which the Run enum does not. The Run
    row is bookkeeping for admission control and the job queue, not a promise
    about what the notebook teaches, so an unsupported family falls back to the
    product default rather than failing the whole submission.
    """
    if framework is None:
        return Framework.QISKIT
    try:
        return Framework(framework.name)
    except ValueError:
        return Framework.QISKIT


def _required(value: Any, name: str) -> Any:
    if value is None:
        raise RuntimeError(f"persisted notebook row is missing {name}")
    return value


async def _latest_and_current(
    scope: CurrentScope, session: DbSession, notebook: NotebookRow
) -> tuple[NotebookVersionRow, NotebookVersionRow | None]:
    """The newest version (any status) and, separately, the current (ready) one —
    the two `to_resource` needs to fill in `current_version_seq` exactly, which it
    cannot do from `latest` alone when a revision is in flight. See that
    function's docstring.
    """
    versions = await notebooks_repo.list_versions(scope, session, notebook.id)
    if not versions:
        raise RuntimeError(f"notebook {notebook.id} has no versions")
    latest = versions[-1]
    current = None
    if notebook.current_version_id is not None:
        current = next((v for v in versions if v.id == notebook.current_version_id), None)
    return latest, current


def _working_base(
    latest: NotebookVersionRow, current: NotebookVersionRow | None
) -> NotebookVersionRow:
    """The version a chat turn or a re-run starts from, or a 409 when there is none.

    The current (ready) version when there is one. Otherwise the newest version, if it
    FAILED but still carries a spec: a notebook whose only build failed is still a
    notebook the reader can see, talk to and fix, and refusing every request on it left
    the reader of the 2026-09-24 production failure with a chat that answered 409 to each
    message (plan 10-notebook-ide, rule 2). The pipeline now keeps such builds `ready`
    anyway, so this is for the versions saved `failed` before that, and for any build
    that failed after its cells ran for a reason the pipeline still counts as failure.

    A version still in flight is `_assert_not_in_flight`'s business and is checked after
    this; a failed version with no spec (the draft never parsed, the sandbox never ran)
    has nothing to start from, and says so.
    """
    if current is not None:
        return current
    if latest.status == contracts.NotebookVersionStatus.FAILED.value and latest.spec is not None:
        return latest
    raise HTTPException(
        status_code=409,
        detail={
            "error": "This notebook has no version to work from yet.",
            "reason": "notebook_not_ready",
        },
    )


def _to_resource_exact(
    notebook: NotebookRow, latest: NotebookVersionRow, current
) -> contracts.Notebook:
    resource = notebooks_repo.to_resource(notebook, latest)
    if current is not None and current.id != latest.id:
        resource = resource.model_copy(update={"current_version_seq": current.seq})
    return resource


def _assert_not_in_flight(notebook: NotebookRow, latest: NotebookVersionRow) -> None:
    if latest.status in (
        contracts.NotebookVersionStatus.QUEUED.value,
        contracts.NotebookVersionStatus.RUNNING.value,
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "A version of this notebook is already generating.",
                "reason": "notebook_version_in_flight",
            },
        )


def _attempt_request_hash(notebook_id: uuid.UUID, body: contracts.GradeAttemptRequest) -> str:
    """Fingerprint one submitted attempt, the notebook included.

    `model_dump(mode="json")` over the whole body for the same reason
    `routes.runs._idempotency_request_hash` does it: a field added to
    `GradeAttemptRequest` later is covered without anyone remembering, and the failure
    mode of forgetting — two different attempts hashing the same — is silent.

    The notebook id is in the digest because the key's uniqueness is per WORKSPACE, not
    per notebook: an identical answer submitted to two notebooks under one key would
    otherwise replay the first notebook's verdict onto the second.
    """
    payload = {"notebook_id": str(notebook_id), **body.model_dump(mode="json")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


async def _gate_notebook_run(
    task_prompt: str,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """The same abuse/tier gate `POST /v1/runs` applies to an explicit EXECUTE or
    Qapp submission (`routes.runs._enforce_execute_backstop`), reused rather than
    re-derived: a notebook generation or revision costs one sandbox dispatch the
    same way. `_enforce_execute_backstop` only reads `.mode` and
    `.circuit_optimization` off the body, so a throwaway `CreateRunRequest`
    carrying the real task prompt is enough to drive it.
    """
    probe = _CreateRunRequest(task_prompt=task_prompt, mode=RunMode.NOTEBOOK)
    await _enforce_execute_backstop(probe, scope, session, identity, settings)


async def create_notebook_and_enqueue(
    scope: CurrentScope,
    session: DbSession,
    *,
    request: contracts.CreateNotebookRequest,
    run_id: uuid.UUID,
) -> tuple[NotebookRow, NotebookVersionRow]:
    """Create the notebook + its queued first version and dispatch the generation.

    Everything `POST /v1/notebooks` does after the run exists, factored out because
    `POST /v1/courses/{id}/generate` does exactly the same thing once per module.
    Duplicating it would mean two places that decide what a notebook's slug looks
    like, what its job payload contains and which fields the worker can rely on —
    and the worker validates that payload's `request` as a `CreateNotebookRequest`,
    so a second producer drifting from this one fails at run time, in the worker,
    on the reader's course.

    The caller owns the run: it applies `_gate_notebook_run` and creates the `runs`
    row, because a course dispatches several and each must be gated on its own.
    """
    notebook, version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug=_slug(request.title or request.brief),
        title=_default_title(request),
        kind=(request.kind or contracts.NotebookKind.LESSON).value,
        summary="",
        language=request.response_locale,
        framework=(request.framework or contracts.NotebookFramework()).model_dump(mode="json"),
        request=request.model_dump(mode="json"),
        run_id=run_id,
    )
    await system.enqueue_job(
        session,
        kind=NOTEBOOK_GENERATE_JOB_KIND,
        payload={
            "run_id": str(run_id),
            "notebook_id": str(notebook.id),
            "version_id": str(version.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "generate",
            "request": request.model_dump(mode="json"),
            "response_locale": request.response_locale,
        },
        run_id=run_id,
    )
    return notebook, version


# -------------------------------------------------------------------------- templates


@router.get("/notebook-templates", response_model=contracts.NotebookTemplates)
async def notebook_templates(scope: CurrentScope) -> contracts.NotebookTemplates:
    kinds = [
        contracts.NotebookTemplateKind(
            id=kind, description=description, structure=structure_for(kind)
        )
        for kind, description in KIND_DESCRIPTIONS.items()
    ]
    # Both lists, in one `starters` array: the split between "first circuit" and
    # "reproduce a paper's ansatz" is the audience, which the `level` field carries, not
    # a separate endpoint the client would have to know to call.
    starters = [
        contracts.NotebookStarter(
            id=starter["id"],
            kind=contracts.NotebookKind(starter["kind"]),
            title=starter["title"],
            brief=starter["brief"],
            level=starter.get("level", "engineer"),
        )
        for starter in (*STARTER_BRIEFS, *RESEARCH_BRIEFS)
    ]
    course_starters = [
        contracts.NotebookStarter(
            id=starter["id"],
            kind=contracts.NotebookKind(starter["kind"]),
            title=starter["title"],
            brief=starter["brief"],
        )
        for starter in COURSE_STARTERS
    ]
    return contracts.NotebookTemplates(
        kinds=kinds, starters=starters, course_starters=course_starters
    )


# ---------------------------------------------------------------------------- create


@router.post("/notebooks", response_model=contracts.CreateNotebookResponse, status_code=201)
async def create_notebook(
    body: CreateNotebookRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> contracts.CreateNotebookResponse:
    # `_idempotency_request_hash` is typed for `CreateRunRequest`; it only calls
    # `.model_dump(mode="json")`, which `CreateNotebookRequest` has too — same
    # fingerprint-the-whole-body approach as `POST /v1/runs`, reused rather than
    # redefined so the two can never drift on what "same request" means.
    request_hash = _idempotency_request_hash(body) if idempotency_key else None  # type: ignore[arg-type]
    if idempotency_key:
        existing_run = await runs_repo.find_run_by_idempotency_key(scope, session, idempotency_key)
        if existing_run is not None:
            _assert_same_request(existing_run, request_hash)
            version = await notebooks_repo.get_version_by_run_id(scope, session, existing_run.id)
            if version is None:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": (
                            "A notebook is being created under this Idempotency-Key by "
                            "another request. Retry to receive it."
                        ),
                        "reason": "idempotency_key_in_flight",
                    },
                )
            notebook = await notebooks_repo.get_notebook(scope, session, version.notebook_id)
            return contracts.CreateNotebookResponse(
                notebook=notebooks_repo.to_resource(notebook, version),
                version=notebooks_repo.version_to_resource(version, full=False),
                run_id=existing_run.id,
            )

    await _gate_notebook_run(body.brief, scope, session, identity, settings)

    try:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=body.brief,
            mode=RunMode.NOTEBOOK,
            framework=_run_framework(body.framework),
            idempotency_key=idempotency_key,
            idempotency_request_hash=request_hash,
        )
    except runs_repo.IdempotencyKeyInFlight:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "A run with this Idempotency-Key is being created by another "
                    "request. Retry to receive it."
                ),
                "reason": "idempotency_key_in_flight",
            },
        ) from None
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )

    notebook, version = await create_notebook_and_enqueue(
        scope, session, request=body, run_id=run.id
    )

    return contracts.CreateNotebookResponse(
        notebook=notebooks_repo.to_resource(notebook, version),
        version=notebooks_repo.version_to_resource(version, full=False),
        run_id=run.id,
    )


# ----------------------------------------------------------------------------- list


@router.get("/notebooks", response_model=contracts.NotebookList)
async def list_notebooks(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> contracts.NotebookList:
    limit = min(max(limit, 1), 100)
    rows = await notebooks_repo.list_notebooks(scope, session, cursor=cursor, limit=limit)
    items: list[contracts.Notebook] = []
    for row in rows:
        latest, current = await _latest_and_current(scope, session, row)
        items.append(_to_resource_exact(row, latest, current))
    next_cursor = rows[-1].id if len(rows) == limit else None
    return contracts.NotebookList(items=items, next_cursor=next_cursor)


@router.get("/notebooks/{notebook_id}", response_model=contracts.Notebook)
async def get_notebook(
    notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.Notebook:
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    latest, current = await _latest_and_current(scope, session, notebook)
    return _to_resource_exact(notebook, latest, current)


@router.patch("/notebooks/{notebook_id}", response_model=contracts.Notebook)
async def update_notebook(
    notebook_id: uuid.UUID,
    body: UpdateNotebookRequest,
    scope: CurrentScope,
    session: DbSession,
) -> contracts.Notebook:
    notebook = await notebooks_repo.update_notebook(
        scope, session, notebook_id, title=body.title, summary=body.summary
    )
    latest, current = await _latest_and_current(scope, session, notebook)
    return _to_resource_exact(notebook, latest, current)


@router.delete("/notebooks/{notebook_id}", status_code=204)
async def delete_notebook(notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> None:
    await notebooks_repo.soft_delete_notebook(scope, session, notebook_id)


# --------------------------------------------------------------------------- versions


@router.get("/notebooks/{notebook_id}/versions", response_model=contracts.NotebookVersionList)
async def list_notebook_versions(
    notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.NotebookVersionList:
    versions = await notebooks_repo.list_versions(scope, session, notebook_id)
    return contracts.NotebookVersionList(
        items=[notebooks_repo.version_to_resource(v, full=False) for v in versions]
    )


@router.get(
    "/notebooks/{notebook_id}/versions/{seq}",
    response_model=contracts.NotebookVersion,
)
async def get_notebook_version(
    notebook_id: uuid.UUID, seq: int, scope: CurrentScope, session: DbSession
) -> contracts.NotebookVersion:
    """One version, redacted for everyone but the person who made the notebook.

    Owner ruling ai-ops#260: *"a shared notebook arrives with the answers stripped, and
    only the person who created it sees them."* This is the route that decides it. Until
    now it returned the raw spec to every member of the workspace — `for_learner()`
    existed and had no production caller at all — so a colleague opening someone's quiz
    read the answer key straight out of the response, and so did anyone with the
    browser's network tab open.

    Three fields carry the answer, not one, which is the whole reason this is written out
    rather than done in a line:

    * `spec` — the `answer` keys and the hidden `check` graders;
    * `source` — the `.nb.py` text those were authored in, `check="..."` and
      `answer={...}` markers included, verbatim;
    * `ipynb` — the stored compile, which is the `full` build.

    Redacting only the first would have looked right in a diff and in a test that asserts
    on `spec`, while the same secret went out twice beside it.
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    version = await notebooks_repo.get_version_by_seq(scope, session, notebook_id, seq)
    resource = notebooks_repo.version_to_resource(version, full=True)
    assert isinstance(resource, contracts.NotebookVersion)  # full=True always returns this
    if scope.user_id == notebook.owner_user_id:
        return resource
    learner = resource.spec.for_learner() if resource.spec is not None else None
    return resource.model_copy(
        update={
            "spec": learner,
            "source": render_source(learner) if learner is not None else "",
            "ipynb": to_ipynb(learner, build=build_for_kind(learner.kind), report=resource.report)
            if learner is not None
            else None,
        }
    )


@router.get("/notebooks/{notebook_id}/versions/{seq}/export.ipynb")
async def export_notebook_version(
    notebook_id: uuid.UUID,
    seq: int,
    scope: CurrentScope,
    session: DbSession,
    build: Literal["reader", "solution"] = "reader",
) -> JSONResponse:
    """The `.ipynb` download.

    **Which build, and why it is decided here.** The stored `version.ipynb` is the
    author's complete copy — every solution, every answer — because that is what the
    workspace renders and what a revision reads. Serving it as the download meant the
    button on a quiz handed over the answer key: `build_for_kind` existed, and only the
    CLI called it, so no path a real user could reach ever produced a redacted file.

    So the decision is made at the boundary rather than at write time. `reader` (the
    default) is the copy the notebook's kind implies — a challenge or a quiz redacted,
    everything else whole — and `solution` is the explicit ask for the complete one.

    **`solution` is the author's ask, and only the author's** (owner ruling ai-ops 260,
    option 1). The first version of this route took the parameter from anyone, which
    handed a non-owner the unredacted build for the price of a query string and undid the
    redaction on the route one function above. Greptile caught it on PR 836. A non-owner
    is refused rather than quietly downgraded: they asked for a specific thing and are
    entitled to know they did not get it.

    **And a non-owner gets the learner build whatever the kind.** `build_for_kind` answers
    "what is this notebook FOR", which is why a lesson compiles whole — but the ruling is
    about answers, not about kinds, and a lesson may carry `role=solution` cells with
    stubs and `role=answer` cells just as a quiz does. Deciding by kind alone would have
    left every graded lesson downloadable in full by a colleague, which is the same defect
    in a different costume.
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    version = await notebooks_repo.get_version_by_seq(scope, session, notebook_id, seq)
    is_author = scope.user_id == notebook.owner_user_id
    if build == "solution" and not is_author:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Only the person who created this notebook can download it with its answers.",
                "reason": "notebook_solutions_are_the_authors",
            },
        )
    spec = contracts.NotebookSpec.model_validate(version.spec) if version.spec is not None else None
    if not is_author:
        # `challenge` is the FILE redaction — the same one `for_learner()` performs, plus
        # a typing slot where a solution cell had no stub, which a downloaded notebook
        # needs and a browser build does not. Applied whatever the kind, so it does not
        # depend on `build_for_kind`.
        wanted: NotebookBuild = "challenge"
    elif build == "solution":
        wanted = "full"
    else:
        wanted = build_for_kind(spec.kind) if spec is not None else "full"
    if spec is not None:
        report = (
            contracts.ExecutionReport.model_validate(version.report)
            if version.report is not None
            else None
        )
        ipynb = to_ipynb(spec, build=wanted, report=report, preamble=True)
    elif version.ipynb is not None:
        # An imported notebook: bytes the reader gave us, with no spec to recompile from.
        ipynb = version.ipynb
    else:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "This version has no compiled notebook yet.",
                "reason": "notebook_version_not_compiled",
            },
        )
    suffix = "-solutions" if wanted != "challenge" and build == "solution" else ""
    filename = f"{notebook.slug}-v{version.seq}{suffix}.ipynb"
    return JSONResponse(
        content=ipynb,
        media_type="application/x-ipynb+json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ------------------------------------------------------------------------------ turns


@router.post(
    "/notebooks/{notebook_id}/turns",
    response_model=contracts.CreateNotebookTurnResponse,
    status_code=201,
)
async def create_notebook_turn(
    notebook_id: uuid.UUID,
    body: CreateNotebookTurnRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.CreateNotebookTurnResponse:
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    latest, current = await _latest_and_current(scope, session, notebook)
    base = _working_base(latest, current)
    _assert_not_in_flight(notebook, latest)

    await _gate_notebook_run(body.message, scope, session, identity, settings)

    run = await runs_repo.create_run(
        scope,
        session,
        task_prompt=body.message,
        mode=RunMode.NOTEBOOK,
        framework=_run_framework(contracts.NotebookFramework.model_validate(notebook.framework)),
    )
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )
    turn = await notebooks_repo.append_turn(
        scope,
        session,
        notebook_id,
        role=contracts.NotebookTurnRole.USER.value,
        content=body.message,
        version_id=None,
        run_id=run.id,
    )
    version = await notebooks_repo.create_version(
        scope,
        session,
        notebook_id,
        created_by=contracts.NotebookVersionAuthor.NALA.value,
        message="",
        request={"message": body.message},
        run_id=run.id,
    )
    await system.enqueue_job(
        session,
        kind=NOTEBOOK_REVISE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "notebook_id": str(notebook_id),
            "version_id": str(version.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "revise",
            "request": {"message": body.message},
            "base_version_id": str(base.id),
            "response_locale": notebook.language,
        },
        run_id=run.id,
    )
    turn_resource = contracts.NotebookTurn(
        id=turn.id,
        notebook_id=turn.notebook_id,
        seq=turn.seq,
        role=contracts.NotebookTurnRole(turn.role),
        content=turn.content,
        version_seq=None,
        run_id=turn.run_id,
        created_at=_required(turn.created_at, "created_at"),
    )
    return contracts.CreateNotebookTurnResponse(
        turn=turn_resource,
        version=notebooks_repo.version_to_resource(version, full=False),
        run_id=run.id,
    )


@router.post(
    "/notebooks/{notebook_id}/attempts",
    response_model=contracts.GradeAttemptResponse,
    status_code=202,
)
async def grade_notebook_attempt(
    notebook_id: uuid.UUID,
    body: contracts.GradeAttemptRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> contracts.GradeAttemptResponse:
    """Grade one reader's attempt at this notebook's current version.

    ## Why this is a route rather than something the browser does

    The assertion that decides an exercise, and the key that decides a question, are
    the two things a reader must never receive — a grader in the client is a grader
    the client can read, and then the notebook grades itself. So the reader's work
    comes here, the answer key is joined to it on the server, and only verdicts go
    back. `leaks_answer_key()` is the assertion that the join went the right way.

    ## Why it is not the chat model

    Until this route the workspace's "check my attempt" button sent the reader's code
    to Nala as a message asking it to grade against the intended solution. A model's
    verdict is not reproducible, cannot be argued with, and — on the evidence of every
    grading defect found in this codebase — errs toward telling the reader they were
    right. `assert len(counts) == 2` ends an argument that "the model thought your
    answer was incomplete" starts.

    ## Why it costs a run, and why it takes an Idempotency-Key

    Grading executes the reader's own code in the sandbox. That is the same dispatch
    a re-run is, with the same abuse backstop, the same tier caps and the same
    deny-all egress — `_gate_notebook_run` is applied here exactly as it is on
    `POST /notebooks/{id}/run`, so an attempt cannot be a way around the quota that
    running the notebook would have cost. Nothing new reaches the sandbox: the derived
    spec is the notebook's own cells with the reader's source substituted in.

    Because it costs, a retry must not charge twice. A dropped 202 is the ordinary
    case — the run is already queued and the client never learned its id — and without
    a key the retry buys a second sandbox run and starts a competing grading stream
    against the same cell. Same mechanism as `POST /v1/runs` and `POST /v1/courses`:
    the key is stored on the run, a replay returns the original run id, and a reused
    key describing a DIFFERENT attempt is 409 rather than being handed a verdict on
    code it did not submit.

    No notebook version is created. An attempt is not an edit, and the verdicts arrive
    on the run's event stream as `notebook.grades`.
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    latest, current = await _latest_and_current(scope, session, notebook)
    if current is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This notebook has no ready version yet.",
                "reason": "notebook_not_ready",
            },
        )
    _assert_not_in_flight(notebook, latest)

    spec = contracts.NotebookSpec.model_validate(current.spec or {})
    graded = spec.graded_cells()
    if not graded:
        # 409 rather than an empty 202: a client that got a run id back for a notebook
        # with nothing to grade would wait for verdicts that are never coming, and the
        # honest reading of "no graded cells" is that this request cannot be answered.
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This notebook has no graded exercises.",
                "reason": "notebook_not_graded",
            },
        )
    unknown = sorted((set(body.code) | set(body.answers)) - {cell.id for cell in spec.cells})
    if unknown:
        raise HTTPException(
            status_code=422,
            detail={
                "error": f"No such cell(s) in this notebook version: {', '.join(unknown)}.",
                "reason": "unknown_cell",
            },
        )

    # BEFORE the gate and before the run is created: a replay must cost neither a
    # quota decrement nor a second row.
    request_hash = _attempt_request_hash(notebook_id, body) if idempotency_key else None
    if idempotency_key:
        existing = await runs_repo.find_run_by_idempotency_key(scope, session, idempotency_key)
        if existing is not None:
            _assert_same_request(existing, request_hash)
            return contracts.GradeAttemptResponse(run_id=existing.id, graded_cells=len(graded))

    await _gate_notebook_run(
        f"Grade an attempt at notebook {notebook.slug}", scope, session, identity, settings
    )

    try:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=f"Grade an attempt at notebook {notebook.slug}",
            mode=RunMode.NOTEBOOK,
            framework=_run_framework(
                contracts.NotebookFramework.model_validate(notebook.framework)
            ),
            idempotency_key=idempotency_key,
            idempotency_request_hash=request_hash,
        )
    except runs_repo.IdempotencyKeyInFlight:
        # Two retries can both pass the lookup above before either run is committed.
        # Without this the loser raises out as a generic 500 and the workspace reports
        # that grading FAILED — for an attempt that was accepted and is running, which
        # is the worst of the three possible answers. `POST /v1/courses` handles the
        # same race the same way; I copied the lookup from it and not the catch.
        # Greptile, PR 832.
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "A grading run with this Idempotency-Key is being created by "
                    "another request. Retry to receive it."
                ),
                "reason": "idempotency_key_in_flight",
            },
        ) from None
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )
    await system.enqueue_job(
        session,
        kind=NOTEBOOK_GRADE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "notebook_id": str(notebook_id),
            "version_id": str(current.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "attempt": {"code": dict(body.code), "answers": dict(body.answers)},
        },
        run_id=run.id,
    )
    return contracts.GradeAttemptResponse(run_id=run.id, graded_cells=len(graded))


@router.get(
    "/notebooks/{notebook_id}/grades",
    response_model=contracts.NotebookGradesSnapshot | None,
)
async def get_notebook_grades(
    notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.NotebookGradesSnapshot | None:
    """This reader's own last score on this notebook, or `null` if they have none.

    Owner ruling ai-ops 260, option 1 — the score is kept, and this is where a reader
    gets it back. It reads the `notebook.grades` events that grading already writes to
    `run_events` rather than a table of its own: the verdict was durable from the first
    day grading shipped and simply had no reader, so a learner who closed the tab lost a
    score that was sitting in the database the whole time.

    Filtered to the requesting user, not just the workspace. A colleague's pass on the
    same notebook is not this reader's score, and showing it would be worse than showing
    nothing — they would believe they had already done the work.

    `stale` is set when the graded version is no longer the current one. The verdicts are
    still returned, because "you scored 4 of 5 on the previous version" is useful and
    silently dropping it is not, but a client must be able to say so rather than render a
    pass against cells that have since been rewritten.

    `null` rather than a zeroed snapshot when there is no attempt. "Has not tried" and
    "tried and got nothing right" are different facts about a learner, and a client that
    cannot tell them apart greets a first-time reader with a failed scorecard.
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    found = await notebooks_repo.latest_grades_for_reader(scope, session, notebook_id)
    if found is None:
        return None
    version, payload = found
    return contracts.NotebookGradesSnapshot(
        version_seq=version.seq,
        stale=notebook.current_version_id != version.id,
        grades=contracts.GradeReport.model_validate(payload.get("grades") or {}),
        passed=int(payload.get("passed") or 0),
        failed=int(payload.get("failed") or 0),
        attempted=int(payload.get("attempted") or 0),
        note=str(payload.get("note") or ""),
    )


@router.get("/notebooks/{notebook_id}/turns", response_model=contracts.NotebookTurnList)
async def list_notebook_turns(
    notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.NotebookTurnList:
    # `list_turns` and `list_versions` both resolve scoping through their own
    # `get_notebook` call; nothing extra to check here beyond the 404 that
    # gives, so no separate `get_notebook` call is needed.
    turns = await notebooks_repo.list_turns(scope, session, notebook_id)
    versions = await notebooks_repo.list_versions(scope, session, notebook_id)
    seq_by_version_id = {v.id: v.seq for v in versions}
    items = [
        contracts.NotebookTurn(
            id=t.id,
            notebook_id=t.notebook_id,
            seq=t.seq,
            role=contracts.NotebookTurnRole(t.role),
            content=t.content,
            version_seq=seq_by_version_id.get(t.version_id) if t.version_id else None,
            run_id=t.run_id,
            created_at=_required(t.created_at, "created_at"),
        )
        for t in turns
    ]
    return contracts.NotebookTurnList(items=items)


# -------------------------------------------------------------------------------- run


@router.post("/notebooks/{notebook_id}/run", response_model=contracts.RerunNotebookResponse)
async def rerun_notebook(
    notebook_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.RerunNotebookResponse:
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    latest, current = await _latest_and_current(scope, session, notebook)
    base = _working_base(latest, current)
    _assert_not_in_flight(notebook, latest)

    await _gate_notebook_run(f"Re-run notebook {notebook.slug}", scope, session, identity, settings)

    run = await runs_repo.create_run(
        scope,
        session,
        task_prompt=f"Re-run notebook {notebook.slug}",
        mode=RunMode.NOTEBOOK,
        framework=_run_framework(contracts.NotebookFramework.model_validate(notebook.framework)),
    )
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )
    version = await notebooks_repo.create_version(
        scope,
        session,
        notebook_id,
        created_by=contracts.NotebookVersionAuthor.NALA.value,
        message="",
        request={},
        run_id=run.id,
    )
    await system.enqueue_job(
        session,
        kind=NOTEBOOK_REVISE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "notebook_id": str(notebook_id),
            "version_id": str(version.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "rerun",
            "request": {},
            "base_version_id": str(base.id),
            "response_locale": notebook.language,
        },
        run_id=run.id,
    )
    return contracts.RerunNotebookResponse(
        version=notebooks_repo.version_to_resource(version, full=False), run_id=run.id
    )


# ------------------------------------------------------------- author (the editor)


def _authored_spec(
    body: contracts.AuthorNotebookVersionRequest, notebook: NotebookRow
) -> contracts.NotebookSpec:
    """The reader's submission as a spec, or a 400 that says what was wrong with it.

    400 rather than 422 on purpose: these are failures the reader can act on — they
    sent two editors' worth of content, or their `.nb.py` has a bad line — and the
    app's `RequestValidationError` handler answers a message-free "validation failed",
    which an editor cannot show anyone. The `reason` codes are stable so the web can
    branch without parsing prose.
    """
    try:
        spec = spec_from_author_request(
            spec=body.spec,
            source=body.source,
            ipynb=body.ipynb,
            slug=notebook.slug,
        )
    except AuthoringInputError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "reason": "notebook_authoring_input"},
        ) from None
    if body.run_until is not None and not any(cell.id == body.run_until for cell in spec.cells):
        # Caught here rather than left to `compose_notebook_program` in the worker: a
        # job that can only ever fail should not be queued, and the reader finds out
        # now instead of after a run they will be billed a sandbox dispatch for.
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"run_until: this notebook has no cell {body.run_until!r}",
                "reason": "notebook_unknown_cell",
            },
        )
    return spec


@router.post(
    "/notebooks/{notebook_id}/versions",
    response_model=contracts.AuthorNotebookVersionResponse,
    status_code=201,
)
async def author_notebook_version(
    notebook_id: uuid.UUID,
    body: AuthorNotebookVersionRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.AuthorNotebookVersionResponse:
    """A version the READER wrote — from the in-browser editor, a text editor, or
    Jupyter — saved as `created_by=user` and executed by the same sandbox path Nala's
    own builds use, so the version history stays the one truth about this notebook.

    Two shapes, one row either way:

    - `execute=true` (the default) queues `notebook.revise` with `kind: "author"` and
      answers with the run to follow. The job carries the resolved **spec**, never the
      raw source — parsing happened here, where a failure can still be a 400.
    - `execute=false` writes the version `ready` immediately with spec, rendered source
      and compiled `.ipynb`, no report and no run. That is a draft the reader saved,
      not a run that produced nothing.

    The structure check is advisory in both: `advisory_structure` warnings are recorded
    against the version and never refuse the save (`leona_notebooks.authoring`).
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    latest, _current = await _latest_and_current(scope, session, notebook)
    _assert_not_in_flight(notebook, latest)

    spec = _authored_spec(body, notebook)
    request_record = {
        "author": True,
        "message": body.message,
        "execute": body.execute,
        "run_until": body.run_until,
        "input": "spec"
        if body.spec is not None
        else ("source" if body.source is not None else "ipynb"),
    }

    if not body.execute:
        version = await notebooks_repo.create_version(
            scope,
            session,
            notebook_id,
            created_by=contracts.NotebookVersionAuthor.USER.value,
            message=body.message,
            request=request_record,
            run_id=None,
        )
        version = await notebooks_repo.set_version_result(
            scope,
            session,
            version.id,
            status=contracts.NotebookVersionStatus.READY.value,
            spec=spec.model_dump(mode="json"),
            source=render_source(spec),
            ipynb=to_ipynb(spec),
            report=None,
            review=_advisory_review(spec),
            error="",
            message=body.message,
        )
        return contracts.AuthorNotebookVersionResponse(
            version=notebooks_repo.version_to_resource(version, full=False), run_id=None
        )

    await _gate_notebook_run(
        body.message or f"Run notebook {notebook.slug}", scope, session, identity, settings
    )
    run = await runs_repo.create_run(
        scope,
        session,
        task_prompt=body.message or f"Run notebook {notebook.slug}",
        mode=RunMode.NOTEBOOK,
        framework=_run_framework(spec.framework),
    )
    await runs_repo.append_run_event(
        scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
    )
    version = await notebooks_repo.create_version(
        scope,
        session,
        notebook_id,
        created_by=contracts.NotebookVersionAuthor.USER.value,
        message=body.message,
        request=request_record,
        run_id=run.id,
    )
    await system.enqueue_job(
        session,
        kind=NOTEBOOK_REVISE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "notebook_id": str(notebook_id),
            "version_id": str(version.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "author",
            "slug": notebook.slug,
            # The resolved spec, not `body.source`/`body.ipynb`: the worker must never
            # be the place a reader's syntax error is discovered, because there the
            # only thing it can produce is a failed run.
            "request": {"spec": spec.model_dump(mode="json"), "message": body.message},
            "run_until": body.run_until,
            "response_locale": notebook.language,
        },
        run_id=run.id,
    )
    return contracts.AuthorNotebookVersionResponse(
        version=notebooks_repo.version_to_resource(version, full=False), run_id=run.id
    )


def _advisory_review(spec: contracts.NotebookSpec) -> dict[str, Any] | None:
    """The structure check as a stored advisory review, or `None` when it found
    nothing. Not an LLM review — the `author` path makes no model call at all — but the
    same *kind* of object: a verdict plus notes that never block a save. It goes in the
    `review` JSONB because that is where the advisory layer already lives; there is no
    `notebook_versions.warnings` column and adding one is a migration this lane has no
    reason to spend."""
    warnings = advisory_structure(spec)
    if not warnings:
        return None
    return contracts.NotebookReview(verdict="needs-attention", warnings=warnings).model_dump(
        mode="json"
    )


# ------------------------------------------------------------------------------ import


@router.post("/notebooks/import", response_model=contracts.ImportNotebookResponse, status_code=201)
async def import_notebook(
    body: ImportNotebookRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> contracts.ImportNotebookResponse:
    try:
        spec = from_ipynb(body.ipynb, slug=None)
    except Exception as exc:  # pydantic ValidationError or a malformed upload
        raise HTTPException(
            status_code=422,
            detail={"error": f"could not read this .ipynb: {exc}", "reason": "invalid_ipynb"},
        ) from None
    if body.title:
        spec = spec.model_copy(update={"title": body.title})
    source = render_source(spec)

    notebook, version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug=_slug(spec.title),
        title=spec.title,
        kind=spec.kind.value,
        summary=spec.summary,
        language=spec.style.language,
        framework=spec.framework.model_dump(mode="json"),
        request={"import": True, "title": body.title, "execute": body.execute},
        run_id=None,
        created_by=contracts.NotebookVersionAuthor.USER.value,
    )
    version = await notebooks_repo.set_version_result(
        scope,
        session,
        version.id,
        status=contracts.NotebookVersionStatus.READY.value,
        spec=spec.model_dump(mode="json"),
        source=source,
        ipynb=body.ipynb,
        report=None,
        review=None,
        error="",
        message="imported from .ipynb",
    )

    run_id: uuid.UUID | None = None
    if body.execute:
        await _gate_notebook_run(
            f"Re-run imported notebook {notebook.slug}", scope, session, identity, settings
        )
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=f"Re-run imported notebook {notebook.slug}",
            mode=RunMode.NOTEBOOK,
            framework=_run_framework(spec.framework),
        )
        await runs_repo.append_run_event(
            scope, session, run.id, type="run.queued", payload={"mode": str(RunMode.NOTEBOOK)}
        )
        rerun_version = await notebooks_repo.create_version(
            scope,
            session,
            notebook.id,
            created_by=contracts.NotebookVersionAuthor.NALA.value,
            message="",
            request={},
            run_id=run.id,
        )
        await system.enqueue_job(
            session,
            kind=NOTEBOOK_REVISE_JOB_KIND,
            payload={
                "run_id": str(run.id),
                "notebook_id": str(notebook.id),
                "version_id": str(rerun_version.id),
                "user_id": str(scope.user_id),
                "workspace_id": str(scope.workspace_id),
                "kind": "rerun",
                "request": {},
                "base_version_id": str(version.id),
                "response_locale": notebook.language,
            },
            run_id=run.id,
        )
        run_id = run.id

    latest, current = await _latest_and_current(scope, session, notebook)
    return contracts.ImportNotebookResponse(
        notebook=_to_resource_exact(notebook, latest, current),
        version=notebooks_repo.version_to_resource(version, full=False),
        run_id=run_id,
    )
