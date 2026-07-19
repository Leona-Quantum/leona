"""Operator-only provisioning + bootstrap import for the system catalog authority."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import ImportJobStatus, Role

from .catalog_attestation import AttestationPolicy
from .catalog_authority import CatalogAuthority
from .catalog_bootstrap_manifest import BootstrapManifestSource
from .db import engine_from_env, session_factory
from .repos import catalog, catalog_import, system
from .repos.catalog import PublicationNotReadyError

# process_import_batch advances every non-terminal item once per call; a bounded
# loop drains any transient RETRY_WAIT items without spinning forever on a bug.
_MAX_IMPORT_PASSES = 10


async def _provision() -> None:
    authority = CatalogAuthority.from_env()
    authority.require_configured()
    assert authority.workspace_id is not None
    assert authority.importer_user_id is not None
    assert authority.public_reader_user_id is not None

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            provisioned = await system.ensure_system_catalog_authority(
                session,
                workspace_id=authority.workspace_id,
                importer_user_id=authority.importer_user_id,
                public_reader_user_id=authority.public_reader_user_id,
            )
            artifact_count = await system.count_workspace_artifacts(
                session, workspace_id=authority.workspace_id
            )
            if artifact_count:
                raise RuntimeError(
                    "Step 2 requires an empty system catalog; artifacts already exist"
                )
            await session.commit()
        print(
            "system catalog authority ready: "
            f"workspace={provisioned.workspace.id} artifacts={artifact_count}"
        )
    finally:
        await engine.dispose()


async def _bootstrap_import() -> None:
    """Import the pinned bootstrap manifest (ADR-0019) into the provisioned
    system catalog via the durable importer.

    Content-only: the 285 records land as private/draft staged artifacts (no
    review/publish here — that is a later, human-gated step). Idempotent: the
    idempotency key is derived from the manifest checksum, so re-running resumes
    the same batch rather than duplicating it. Run `provision` first.
    """
    authority = CatalogAuthority.from_env()
    authority.require_configured()
    scope = authority.importer_scope()
    source = BootstrapManifestSource()
    expected = len(source.identities())

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            job = await catalog_import.create_import_job(
                scope,
                session,
                authority=authority,
                source=source,
                idempotency_key=source.idempotency_key,
            )
            await session.commit()
            job_id = job.id

        final = None
        for _ in range(_MAX_IMPORT_PASSES):
            async with factory() as session:
                final = await catalog_import.process_import_batch(
                    scope, session, job_id, authority=authority, source=source
                )
            if final.status != ImportJobStatus.RUNNING:
                break

        assert final is not None
        print(
            "bootstrap import finished: "
            f"status={final.status} manifest_items={expected} "
            f"accepted={final.accepted_count} rejected={final.rejected_count} "
            f"dead={final.dead_count}"
        )
        if final.status != ImportJobStatus.COMPLETED or final.accepted_count != expected:
            raise SystemExit(
                f"reconciliation incomplete: expected {expected} accepted, "
                f"got {final.accepted_count} (status {final.status})"
            )
    finally:
        await engine.dispose()


async def _staged_targets(factory, *, scope: Scope, authority, source) -> dict[str, uuid.UUID]:
    async with factory() as session:
        return await catalog_import.list_staged_targets(
            scope, session, authority=authority, idempotency_key=source.idempotency_key
        )


def _bootstrap_plan(source: BootstrapManifestSource, policy: AttestationPolicy):
    """Classify every manifest record against the policy (fail-closed)."""
    claims = {
        identity: (json.loads(source.read_bytes(identity)).get("source") or {})
        for identity in source.identities()
    }
    return policy.plan(claims)


async def _attest_bootstrap(attested_by: uuid.UUID) -> None:
    """Bind provenance + the owner's approved license onto the staged corpus.

    Records the owner's committed attestation (catalog_bootstrap/
    attestation-policy.json) against each covered record: a provenance row, a
    declared license carrying the policy's SPDX id, an approved reviewer
    decision, and review acceptance — the four bindings publication requires.
    The importer and the named reviewer stay distinct principals throughout.

    Nothing is published here. Idempotent: re-running only fills gaps.
    """
    authority = CatalogAuthority.from_env()
    authority.require_configured()
    importer_scope = authority.importer_scope()
    reviewer_scope = Scope(
        user_id=attested_by, workspace_id=authority.workspace_id, role=Role.ADMIN
    )
    if attested_by in {authority.importer_user_id, authority.public_reader_user_id}:
        raise SystemExit("--attested-by must be a real human account, not a service identity")

    source = BootstrapManifestSource()
    policy = AttestationPolicy.load()
    plan = _bootstrap_plan(source, policy)

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            await catalog.grant_catalog_reviewer(
                importer_scope, session, authority=authority, user_id=attested_by
            )
            await session.commit()

        targets = await _staged_targets(
            factory, scope=importer_scope, authority=authority, source=source
        )
        missing = sorted(plan.identities - set(targets))
        if missing:
            raise SystemExit(
                f"{len(missing)} attested records are not staged (run bootstrap-import first): "
                + ", ".join(missing[:5])
            )

        attestation_meta = policy.audit_meta()
        touched = 0
        for record in plan.included:
            async with factory() as session:
                performed = await catalog.attest_catalog_record(
                    importer_scope,
                    reviewer_scope,
                    session,
                    targets[record.upstream_identity],
                    authority=authority,
                    spdx_id=policy.spdx_id,
                    assertion_kind=policy.assertion_kind,
                    license_scope=policy.license_scope,
                    source_kind=policy.source_kind,
                    evidence_hash=record.evidence_hash,
                    repository=None,
                    ref=source.upstream_ref or None,
                    path=record.upstream_identity,
                    retrieval_metadata={
                        "manifest_checksum": source.manifest_checksum,
                        "upstream_identity": record.upstream_identity,
                        "source_kind_claim": record.source_kind_claim,
                        "license_claim": record.license_claim,
                    },
                    attestation_meta=attestation_meta,
                )
                await session.commit()
            if performed:
                touched += 1

        # One ledger entry for the run itself, so the corpus-level act is
        # auditable without reassembling 283 per-record rows.
        async with factory() as session:
            await catalog.record_bulk_attestation(
                reviewer_scope,
                session,
                authority=authority,
                meta={
                    **attestation_meta,
                    "manifest_checksum": source.manifest_checksum,
                    "attested_count": len(plan.included),
                    "excluded": {r.upstream_identity: r.reason for r in plan.excluded},
                },
            )
            await session.commit()

        print(
            f"bulk attestation complete: spdx={policy.spdx_id} "
            f"attested={len(plan.included)} changed_this_run={touched} "
            f"excluded={len(plan.excluded)} policy={policy.checksum[:12]}"
        )
        for excluded in plan.excluded:
            print(f"  excluded {excluded.upstream_identity}: {excluded.reason}")
    finally:
        await engine.dispose()


async def _publish_bootstrap(attested_by: uuid.UUID) -> None:
    """Flip every attested record private -> public (reviewer-only, audited).

    publish_catalog_artifact re-evaluates readiness per record and refuses any
    that is missing a binding, so a record the attestation did not cover cannot
    ride along: it is reported as blocked and left private.
    """
    authority = CatalogAuthority.from_env()
    authority.require_configured()
    importer_scope = authority.importer_scope()
    reviewer_scope = Scope(
        user_id=attested_by, workspace_id=authority.workspace_id, role=Role.ADMIN
    )

    source = BootstrapManifestSource()
    policy = AttestationPolicy.load()
    plan = _bootstrap_plan(source, policy)

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        targets = await _staged_targets(
            factory, scope=importer_scope, authority=authority, source=source
        )
        published = 0
        blocked: list[str] = []
        for record in plan.included:
            artifact_id = targets.get(record.upstream_identity)
            if artifact_id is None:
                blocked.append(f"{record.upstream_identity}: not staged")
                continue
            async with factory() as session:
                try:
                    await catalog.publish_catalog_artifact(
                        reviewer_scope, session, artifact_id, authority=authority
                    )
                except PublicationNotReadyError as exc:
                    blocked.append(f"{record.upstream_identity}: {'; '.join(exc.blockers)}")
                    continue
                await session.commit()
            published += 1

        print(f"publish complete: published={published} blocked={len(blocked)}")
        for entry in blocked[:20]:
            print(f"  blocked {entry}")
        if blocked:
            raise SystemExit(f"{len(blocked)} attested records could not be published")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("provision", "bootstrap-import", "attest-bootstrap", "publish-bootstrap"),
    )
    parser.add_argument(
        "--attested-by",
        type=uuid.UUID,
        help="user id of the human reviewer making/holding the attestation "
        "(required by attest-bootstrap and publish-bootstrap)",
    )
    args = parser.parse_args()
    if args.command in {"attest-bootstrap", "publish-bootstrap"} and args.attested_by is None:
        parser.error(f"{args.command} requires --attested-by")
    if args.command == "provision":
        asyncio.run(_provision())
    elif args.command == "bootstrap-import":
        asyncio.run(_bootstrap_import())
    elif args.command == "attest-bootstrap":
        asyncio.run(_attest_bootstrap(args.attested_by))
    elif args.command == "publish-bootstrap":
        asyncio.run(_publish_bootstrap(args.attested_by))


if __name__ == "__main__":
    main()
