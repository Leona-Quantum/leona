"""Operator-only provisioning + bootstrap import for the system catalog authority."""

from __future__ import annotations

import argparse
import asyncio

from majorana_contracts.enums import ImportJobStatus

from .catalog_authority import CatalogAuthority
from .catalog_bootstrap_manifest import BootstrapManifestSource
from .db import engine_from_env, session_factory
from .repos import catalog_import, system

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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("provision", "bootstrap-import"))
    args = parser.parse_args()
    if args.command == "provision":
        asyncio.run(_provision())
    elif args.command == "bootstrap-import":
        asyncio.run(_bootstrap_import())


if __name__ == "__main__":
    main()
