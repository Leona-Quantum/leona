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

import re
import uuid
from typing import Annotated, Any

import majorana_contracts as contracts
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from leona_notebooks import from_ipynb, to_ipynb
from leona_notebooks.source import render_source
from leona_notebooks.templates import KIND_DESCRIPTIONS, STARTER_BRIEFS, structure_for
from majorana_contracts.enums import Framework, RunMode

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..jobs import NOTEBOOK_GENERATE_JOB_KIND, NOTEBOOK_REVISE_JOB_KIND
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


# -------------------------------------------------------------------------- templates


@router.get("/notebook-templates", response_model=contracts.NotebookTemplates)
async def notebook_templates(scope: CurrentScope) -> contracts.NotebookTemplates:
    kinds = [
        contracts.NotebookTemplateKind(
            id=kind, description=description, structure=structure_for(kind)
        )
        for kind, description in KIND_DESCRIPTIONS.items()
    ]
    starters = [
        contracts.NotebookStarter(
            id=starter["id"],
            kind=contracts.NotebookKind(starter["kind"]),
            title=starter["title"],
            brief=starter["brief"],
        )
        for starter in STARTER_BRIEFS
    ]
    return contracts.NotebookTemplates(kinds=kinds, starters=starters)


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

    notebook, version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug=_slug(body.title or body.brief),
        title=_default_title(body),
        kind=(body.kind or contracts.NotebookKind.LESSON).value,
        summary="",
        language=body.response_locale,
        framework=(body.framework or contracts.NotebookFramework()).model_dump(mode="json"),
        request=body.model_dump(mode="json"),
        run_id=run.id,
    )

    await system.enqueue_job(
        session,
        kind=NOTEBOOK_GENERATE_JOB_KIND,
        payload={
            "run_id": str(run.id),
            "notebook_id": str(notebook.id),
            "version_id": str(version.id),
            "user_id": str(scope.user_id),
            "workspace_id": str(scope.workspace_id),
            "kind": "generate",
            "request": body.model_dump(mode="json"),
            "response_locale": body.response_locale,
        },
        run_id=run.id,
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
    version = await notebooks_repo.get_version_by_seq(scope, session, notebook_id, seq)
    resource = notebooks_repo.version_to_resource(version, full=True)
    assert isinstance(resource, contracts.NotebookVersion)  # full=True always returns this
    return resource


@router.get("/notebooks/{notebook_id}/versions/{seq}/export.ipynb")
async def export_notebook_version(
    notebook_id: uuid.UUID, seq: int, scope: CurrentScope, session: DbSession
) -> JSONResponse:
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    version = await notebooks_repo.get_version_by_seq(scope, session, notebook_id, seq)
    if version.ipynb is not None:
        ipynb = version.ipynb
    elif version.spec is not None:
        ipynb = to_ipynb(contracts.NotebookSpec.model_validate(version.spec))
    else:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "This version has no compiled notebook yet.",
                "reason": "notebook_version_not_compiled",
            },
        )
    filename = f"{notebook.slug}-v{version.seq}.ipynb"
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
    if current is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This notebook has no ready version yet.",
                "reason": "notebook_not_ready",
            },
        )
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
            "base_version_id": str(current.id),
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
    if current is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This notebook has no ready version yet.",
                "reason": "notebook_not_ready",
            },
        )
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
            "base_version_id": str(current.id),
            "response_locale": notebook.language,
        },
        run_id=run.id,
    )
    return contracts.RerunNotebookResponse(
        version=notebooks_repo.version_to_resource(version, full=False), run_id=run.id
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
