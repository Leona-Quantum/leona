"""Operator-only provisioning for the empty system catalog authority."""

from __future__ import annotations

import argparse
import asyncio

from .catalog_authority import CatalogAuthority
from .db import engine_from_env, session_factory
from .repos import system


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("provision",))
    args = parser.parse_args()
    if args.command == "provision":
        asyncio.run(_provision())


if __name__ == "__main__":
    main()
