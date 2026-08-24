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
from sqlalchemy import and_, func, or_, select
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
) -> tuple[Qapp, QappVersion]:
    """Persist one generated bundle, idempotently by its originating run."""
    require_write(scope)
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


async def reserve_execution_slot(
    scope: Scope,
    session: AsyncSession,
    *,
    since: dt.datetime,
    limit: int,
) -> int:
    """Serialize the per-account safety ceiling before a paid sandbox is queued."""
    require_write(scope)
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
    if used >= limit:
        raise ValueError("Qapp execution safety limit reached")
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
    scope: Scope, session: AsyncSession, execution_id: uuid.UUID
) -> QappExecution:
    require_write(scope)
    row = await get_execution(scope, session, execution_id, for_update=True)
    if row.status == QappExecutionStatus.QUEUED.value:
        row.status = QappExecutionStatus.RUNNING.value
        row.started_at = touched_now()
        row.updated_at = row.started_at
        await session.flush()
    return row


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
