"""SQLAlchemy models mirroring db/migrations/versions/0001_schema_v1.py.

The migration owns constraints, indexes, and server defaults; these mappings
declare only what queries and inserts need. Columns with DB-side defaults
(created_at, ts, status, …) are left unset on insert so Postgres fills them.
"""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import TIMESTAMP, BigInteger, ForeignKey, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_UUID = UUID(as_uuid=True)


class Base(DeclarativeBase):
    type_annotation_map = {
        uuid.UUID: _UUID,
        dict[str, Any]: JSONB,
        str: Text,
        dt.datetime: TIMESTAMP(timezone=True),
    }


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workos_user_id: Mapped[str] = mapped_column(unique=True)
    email: Mapped[str]
    display_name: Mapped[str | None]
    plan: Mapped[str | None] = mapped_column(server_default="free")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str]
    name: Mapped[str]
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    plan: Mapped[str | None] = mapped_column(server_default="free")
    deleted_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Membership(Base):
    __tablename__ = "memberships"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    slug: Mapped[str] = mapped_column(unique=True)
    title: Mapped[str]
    family: Mapped[str]
    framework: Mapped[str]
    visibility: Mapped[str | None] = mapped_column(server_default="private")
    parent_artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artifacts.id"))
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    deleted_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ArtifactVersion(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    artifact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifacts.id"))
    seq: Mapped[int] = mapped_column(Integer)
    ir_version: Mapped[str]
    ir: Mapped[dict[str, Any]]
    code: Mapped[str]
    code_lang: Mapped[str]
    fingerprint: Mapped[str]
    export_status: Mapped[str]
    export_reason: Mapped[str | None]
    qasm: Mapped[str | None]
    resource_estimates: Mapped[dict[str, Any] | None]
    limitations: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    artifact_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    task_prompt: Mapped[str]
    mode: Mapped[str]
    idempotency_key: Mapped[str | None]
    status: Mapped[str | None] = mapped_column(server_default="queued")
    framework: Mapped[str]
    seed: Mapped[int | None] = mapped_column(BigInteger)
    shots: Mapped[int | None] = mapped_column(Integer)
    tolerances: Mapped[dict[str, Any] | None]
    timeout_s: Mapped[int | None] = mapped_column(Integer)
    sandbox_provider: Mapped[str | None]
    sandbox_meta: Mapped[dict[str, Any] | None]
    verifier_decision: Mapped[str | None]
    residual_risks: Mapped[str | None]
    baseline: Mapped[dict[str, Any] | None]
    started_at: Mapped[dt.datetime | None]
    finished_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    seq: Mapped[int] = mapped_column(Integer)
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    type: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VerificationRecord(Base):
    __tablename__ = "verification_records"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    method: Mapped[str]
    params: Mapped[dict[str, Any] | None] = mapped_column(server_default=text("'{}'::jsonb"))
    result: Mapped[str]
    details: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str]
    payload: Mapped[dict[str, Any]]
    status: Mapped[str | None] = mapped_column(server_default="queued")
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"))
    attempts: Mapped[int | None] = mapped_column(Integer, server_default="0")
    locked_by: Mapped[str | None]
    locked_at: Mapped[dt.datetime | None]
    run_after: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    last_error: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str]
    quantity: Mapped[float] = mapped_column(Numeric)
    meta: Mapped[dict[str, Any] | None]
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id"))
    actor_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str]
    target_kind: Mapped[str | None]
    target_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    ip: Mapped[str | None] = mapped_column(INET)
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    meta: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
