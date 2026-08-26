"""Scoped storage for generated Qapps and their sandbox executions.

Private rows are visible only inside ``scope.workspace_id``. A Qapp explicitly
published by its creator may also be read or executed from another scope; every
such query states that public exception alongside the normal tenant predicate.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import QappExecutionStatus, Visibility
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Qapp, QappExecution, QappVersion, Run, User
from ._base import AuthzError, NotFoundError, RepoError, require_write, touched_now
from .audit import record_audit


def _accessible(scope: Scope) -> Any:
    return or_(
        Qapp.workspace_id == scope.workspace_id,
        and_(Qapp.visibility == Visibility.PUBLIC.value, Qapp.deleted_at.is_(None)),
    )


class QappPublicationBlocked(RepoError):
    """The current version has not completed one schema-valid sandbox execution."""


class QappExecutionCeiling(RepoError):
    """A spend ceiling refused this execution. ``scope_name`` says which one.

    Three ceilings guard the same paid sandbox, and which one fired changes what
    the caller should do, so the name travels with the refusal rather than being
    flattened into one message:

    ``account``     this visitor has run too many Qapps this hour; another
                    visitor is unaffected.
    ``qapp``        this *published Qapp* has been run too many times this hour
                    by everyone put together; the visitor may not have run it at
                    all. Bounds one popular — or one hostile — public page.
    ``deployment``  every Qapp on the deployment put together. The last backstop
                    on total spend, and the only one whose ceiling does not rise
                    when accounts are added.
    """

    def __init__(self, scope_name: str) -> None:
        super().__init__(f"Qapp execution ceiling reached: {scope_name}")
        self.scope_name = scope_name


def _slug(title: str, qapp_id: uuid.UUID) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:120]
    # UUIDv7 starts with its timestamp. Qapps generated in the same fraction of
    # a second therefore share the first eight characters, which made repeated
    # prompts collide on the globally unique slug. Keep the complete UUID bits:
    # even a 120-character stem remains within the schema's 160-character cap.
    return f"{stem or 'qapp'}-{qapp_id.hex}"


async def create_generated(
    scope: Scope,
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    title: str,
    description: str,
    framework: str,
    qubits_estimate: int,
    ui_document: str,
    quantum_source: str,
    input_schema: dict[str, Any],
    output_schema: dict[str, Any],
    generation_prompt: str,
    source_artifact_version_id: uuid.UUID | None,
    range_smoke: dict[str, Any] | None = None,
) -> tuple[Qapp, QappVersion]:
    """Persist one generated bundle, idempotently by its originating run."""
    require_write(scope)
    # The 1-27 bound is declared on the parsed model AND on every response model,
    # and enforced by neither of them here: this function takes a plain `int` and
    # the column has no check. An out-of-range row is not a bad card — it is a
    # 500 for the WHOLE public gallery, because `list_public_qapps` builds a
    # `PublicQappSummary` per row and one field failing validation fails the
    # response. Cheaper to refuse the write than to serve a broken list.
    if not QAPP_MIN_QUBITS <= qubits_estimate <= QAPP_MAX_QUBITS:
        raise ValueError(
            f"qubits_estimate must be between {QAPP_MIN_QUBITS} and {QAPP_MAX_QUBITS}, "
            f"got {qubits_estimate}"
        )
    existing = (
        await session.execute(
            select(Qapp).where(
                Qapp.created_by_run_id == run_id,
                Qapp.workspace_id == scope.workspace_id,
                Qapp.owner_user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.current_version_id is None:
            raise RuntimeError("Qapp exists without a current version")
        version = (
            await session.execute(
                select(QappVersion).where(
                    QappVersion.id == existing.current_version_id,
                    QappVersion.qapp_id == existing.id,
                )
            )
        ).scalar_one()
        return existing, version

    run_exists = (
        await session.execute(
            select(Run.id).where(
                Run.id == run_id,
                Run.workspace_id == scope.workspace_id,
                Run.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if run_exists is None:
        raise NotFoundError("run")

    canonical = json.dumps(
        {
            "framework": framework,
            "qubits_estimate": qubits_estimate,
            "ui_document": ui_document,
            "quantum_source": quantum_source,
            "input_schema": input_schema,
            "output_schema": output_schema,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    qapp_id = uuid7()
    qapp = Qapp(
        id=qapp_id,
        workspace_id=scope.workspace_id,
        owner_user_id=scope.user_id,
        slug=_slug(title, qapp_id),
        title=title,
        description=description,
        visibility=Visibility.PRIVATE.value,
        created_by_run_id=run_id,
    )
    version = QappVersion(
        id=uuid7(),
        qapp_id=qapp_id,
        seq=1,
        framework=framework,
        qubits_estimate=qubits_estimate,
        ui_document=ui_document,
        quantum_source=quantum_source,
        input_schema=input_schema,
        output_schema=output_schema,
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        source_artifact_version_id=source_artifact_version_id,
        generation_prompt=generation_prompt,
        # Deliberately OUTSIDE `canonical` above, and so outside the fingerprint.
        # The fingerprint identifies the bundle a visitor executes — framework,
        # source, schemas — and two identical bundles must fingerprint the same
        # whether or not anybody measured their top of range. ai-ops#180.
        range_smoke=range_smoke,
    )
    session.add(qapp)
    session.add(version)
    await session.flush()
    qapp.current_version_id = version.id
    await record_audit(
        scope,
        session,
        action="qapp.created",
        target_kind="qapp",
        target_id=qapp.id,
    )
    await session.flush()
    return qapp, version


async def list_qapps(scope: Scope, session: AsyncSession, *, limit: int = 100) -> list[Qapp]:
    return list(
        (
            await session.execute(
                select(Qapp)
                .where(Qapp.workspace_id == scope.workspace_id, Qapp.deleted_at.is_(None))
                .order_by(Qapp.updated_at.desc(), Qapp.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )


async def list_public_qapps(
    scope: Scope, session: AsyncSession, *, limit: int = 100
) -> list[tuple[Qapp, QappVersion]]:
    """List published Qapps with only their current version available to projection.

    The route turns these rows into a deliberately small public summary. Keeping
    the join here avoids both an N+1 lookup and exposing version source/UI fields
    to callers that only need gallery metadata.
    """
    return list(
        (
            await session.execute(
                select(Qapp, QappVersion)
                .join(
                    QappVersion,
                    and_(
                        QappVersion.qapp_id == Qapp.id,
                        QappVersion.id == Qapp.current_version_id,
                    ),
                )
                .where(
                    _accessible(scope),
                    Qapp.visibility == Visibility.PUBLIC.value,
                    Qapp.published_at.is_not(None),
                    Qapp.deleted_at.is_(None),
                )
                .order_by(Qapp.published_at.desc(), Qapp.id.desc())
                .limit(limit)
            )
        ).all()
    )


async def get_qapp(scope: Scope, session: AsyncSession, qapp_id: uuid.UUID) -> Qapp:
    row = (
        await session.execute(
            select(Qapp).where(
                Qapp.id == qapp_id,
                Qapp.workspace_id == scope.workspace_id,
                Qapp.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp")
    return row


async def get_accessible_by_slug(scope: Scope, session: AsyncSession, slug: str) -> Qapp:
    row = (
        await session.execute(
            select(Qapp).where(Qapp.slug == slug, Qapp.deleted_at.is_(None), _accessible(scope))
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp")
    return row


async def get_current_version(scope: Scope, session: AsyncSession, qapp: Qapp) -> QappVersion:
    if qapp.current_version_id is None:
        raise NotFoundError("qapp version")
    row = (
        await session.execute(
            select(QappVersion)
            .join(Qapp, QappVersion.qapp_id == Qapp.id)
            .where(
                QappVersion.id == qapp.current_version_id,
                QappVersion.qapp_id == qapp.id,
                Qapp.deleted_at.is_(None),
                _accessible(scope),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp version")
    return row


async def set_visibility(
    scope: Scope, session: AsyncSession, qapp_id: uuid.UUID, visibility: Visibility
) -> Qapp:
    require_write(scope)
    qapp = await get_qapp(scope, session, qapp_id)
    if qapp.owner_user_id != scope.user_id:
        raise AuthzError("only the Qapp creator may publish it")
    visibility = Visibility(visibility)
    if visibility is Visibility.PUBLIC:
        succeeded = (
            await session.execute(
                select(QappExecution.id)
                .where(
                    QappExecution.qapp_id == qapp.id,
                    QappExecution.qapp_version_id == qapp.current_version_id,
                    QappExecution.status == QappExecutionStatus.SUCCEEDED.value,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if succeeded is None:
            raise QappPublicationBlocked("run the current Qapp successfully before publishing it")
    now = touched_now()
    qapp.visibility = visibility.value
    qapp.published_at = now if visibility is Visibility.PUBLIC else None
    qapp.updated_at = now
    await record_audit(
        scope,
        session,
        action="qapp.published" if visibility is Visibility.PUBLIC else "qapp.unpublished",
        target_kind="qapp",
        target_id=qapp.id,
    )
    await session.flush()
    return qapp


async def create_execution(
    scope: Scope,
    session: AsyncSession,
    *,
    qapp: Qapp,
    version: QappVersion,
    inputs: dict[str, Any],
) -> QappExecution:
    require_write(scope)
    # Re-check access here so a future caller cannot pass an unscoped ORM row.
    accessible = await get_accessible_by_slug(scope, session, qapp.slug)
    if accessible.id != qapp.id or version.qapp_id != qapp.id:
        raise NotFoundError("qapp")
    execution = QappExecution(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        qapp_id=qapp.id,
        qapp_version_id=version.id,
        status=QappExecutionStatus.QUEUED.value,
        inputs=inputs,
    )
    session.add(execution)
    await session.flush()
    return execution


#: How long a `running` Qapp execution may sit before another delivery may
#: re-claim it. An execution is capped at 120s of sandbox and the job lease at
#: 120s more, so five minutes is comfortably past any live delivery while still
#: short enough that a reader is not left staring at a dead one.
EXECUTION_STALE_AFTER = dt.timedelta(minutes=5)

#: The qubit lane this deployment runs (`majorana_sandbox.spec::DEFAULT_QUBIT_CEILING`,
#: AD-12). Restated here rather than imported because the repository layer must not
#: depend on the sandbox package; `test_qapp_persistence_bound_matches_the_sandbox_lane`
#: asserts the two have not drifted.
QAPP_MIN_QUBITS = 1
QAPP_MAX_QUBITS = 27

#: Key for the transaction-scoped advisory lock that serialises reservations.
#: Arbitrary but fixed, and namespaced by the migration that introduced the
#: counters it protects so a future unrelated advisory lock does not collide.
_PRESSURE_LOCK_KEY = 0x0055_0056


async def reserve_execution_slot(
    scope: Scope,
    session: AsyncSession,
    *,
    since: dt.datetime,
    limit: int,
    qapp_id: uuid.UUID,
    qapp_limit: int,
    deployment_limit: int,
) -> int:
    """Serialize all three spend ceilings before a paid sandbox is queued.

    The per-account ceiling alone is the right bound for a *private* Qapp, where
    the only account that can execute one is the account that owns it. It is not
    a bound at all for a **published** one: `/q/<slug>` is public and runs under
    the *visitor's* account, so per-account x (however many accounts sign up) is
    the real ceiling, and nothing caps how many published Qapps exist. The two
    cross-tenant ceilings are what actually bound spend, and they are read
    through migration 0056's `SECURITY DEFINER` counter rather than a plain
    `count(*)` — see that migration for why an ordinary count here would stop
    bounding anything the day RLS enforcement is switched on.

    One transaction-scoped advisory lock serialises the whole reservation, so
    two concurrent visitors cannot both read a count one below a ceiling and
    both be admitted. It is taken *before* the per-account row lock and never in
    the other order, so the two cannot deadlock against each other.

    A ceiling of `0` disables that one ceiling, matching how `rate_limit.py`
    spells "off" — an unbounded Qapp surface is recoverable and costs money,
    while one refusing every real visitor looks like an outage and cannot be
    diagnosed from the outside.
    """
    require_write(scope)
    await session.execute(select(func.pg_advisory_xact_lock(_PRESSURE_LOCK_KEY)))
    await session.execute(select(User.id).where(User.id == scope.user_id).with_for_update())
    used = int(
        (
            await session.execute(
                select(func.count())
                .select_from(QappExecution)
                .where(
                    QappExecution.user_id == scope.user_id,
                    QappExecution.created_at >= since,
                )
            )
        ).scalar_one()
    )
    if limit and used >= limit:
        raise QappExecutionCeiling("account")
    if qapp_limit or deployment_limit:
        pressure = (
            await session.execute(
                text(
                    "select qapp_count, global_count from qapp_execution_pressure(:since, :qapp_id)"
                ),
                {"since": since, "qapp_id": qapp_id},
            )
        ).one()
        if qapp_limit and int(pressure.qapp_count) >= qapp_limit:
            raise QappExecutionCeiling("qapp")
        if deployment_limit and int(pressure.global_count) >= deployment_limit:
            raise QappExecutionCeiling("deployment")
    return used


async def get_execution(
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID, *, for_update: bool = False
) -> QappExecution:
    stmt = select(QappExecution).where(
        QappExecution.id == execution_id,
        QappExecution.workspace_id == scope.workspace_id,
        QappExecution.user_id == scope.user_id,
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFoundError("qapp execution")
    return row


async def get_execution_source(
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID
) -> tuple[QappExecution, QappVersion]:
    execution = await get_execution(scope, session, execution_id, for_update=True)
    version = (
        await session.execute(
            select(QappVersion).where(
                QappVersion.id == execution.qapp_version_id,
                QappVersion.qapp_id == execution.qapp_id,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError("qapp version")
    return execution, version


async def mark_execution_running(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    stale_after: dt.timedelta = EXECUTION_STALE_AFTER,
) -> bool:
    """Claim an execution for THIS delivery. True only if this call claimed it.

    Returning the row was not enough for the one caller that matters. A job the
    queue redelivers while the first delivery is still working finds the row
    already `running`, and a row is a row whether or not you were the one who
    claimed it — so the worker could not tell "I claimed it" from "someone else
    did" and started a second paid sandbox alongside the first. The boolean is
    the whole answer, and it is decided under the `FOR UPDATE` this already
    takes, so two deliveries racing here cannot both be told yes.

    **`stale_after` is why this is not simply `status == QUEUED`.** Refusing
    every non-queued row closes the double-spend and opens a worse hole in its
    place: `recover_stale_jobs` requeues a job only when its LEASE HAS EXPIRED,
    which means the previous worker died mid-execution. That redelivery would
    then find `running`, decline, and return normally — the queue would count
    the job done and the execution would sit in `running` with no result and no
    error, for ever, while the reader's page polled itself out. Trading a
    double charge for a permanently stuck row is not a fix.

    So a `running` row is re-claimable once it is older than any execution could
    legitimately still be. The window is generous on purpose: an execution is
    capped at 120s of sandbox and a lease at 120s more, so anything past
    `EXECUTION_STALE_AFTER` is not a live delivery, it is a dead one. Inside the
    window the answer stays no, which is the case that was costing money.
    """
    require_write(scope)
    row = await get_execution(scope, session, execution_id, for_update=True)
    if row.status == QappExecutionStatus.RUNNING.value:
        started = row.started_at
        if started is not None and started.tzinfo is None:
            started = started.replace(tzinfo=dt.timezone.utc)
        if started is not None and touched_now() - started < stale_after:
            return False
    elif row.status != QappExecutionStatus.QUEUED.value:
        return False
    row.status = QappExecutionStatus.RUNNING.value
    row.started_at = touched_now()
    row.updated_at = row.started_at
    await session.flush()
    return True


async def finish_execution(
    scope: Scope,
    session: AsyncSession,
    execution_id: uuid.UUID,
    *,
    result: dict[str, Any] | None,
    error_code: str | None,
    sandbox_meta: dict[str, Any] | None,
) -> QappExecution:
    require_write(scope)
    row = await get_execution(scope, session, execution_id, for_update=True)
    if row.status in {
        QappExecutionStatus.SUCCEEDED.value,
        QappExecutionStatus.FAILED.value,
    }:
        return row
    now = touched_now()
    row.status = (
        QappExecutionStatus.SUCCEEDED.value
        if error_code is None
        else QappExecutionStatus.FAILED.value
    )
    row.result = result
    row.error_code = error_code
    row.sandbox_meta = sandbox_meta
    row.finished_at = now
    row.updated_at = now
    await session.flush()
    return row
