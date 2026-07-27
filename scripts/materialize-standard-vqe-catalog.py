#!/usr/bin/env python3
"""Materialize private standard VQE seeds into an approved disposable database."""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos.system import ensure_system_catalog_authority
from majorana_api.standard_vqe_materializer import (
    materialize_standard_vqe_catalog,
)


async def _run() -> dict[str, object]:
    authority = CatalogAuthority.from_env()
    if not authority.enabled:
        raise RuntimeError("SYSTEM_CATALOG_ENABLED must be true")
    authority.require_configured()
    assert authority.workspace_id is not None
    assert authority.importer_user_id is not None
    assert authority.public_reader_user_id is not None

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            await ensure_system_catalog_authority(
                session,
                workspace_id=authority.workspace_id,
                importer_user_id=authority.importer_user_id,
                public_reader_user_id=authority.public_reader_user_id,
            )
            report = await materialize_standard_vqe_catalog(
                authority.importer_scope(),
                session,
            )
            await session.commit()
            return dataclasses.asdict(report)
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--confirm-disposable",
        action="store_true",
        help="required acknowledgement that DATABASE_URL is a disposable test branch",
    )
    args = parser.parse_args()
    if not args.confirm_disposable:
        raise SystemExit("refusing without --confirm-disposable")
    if os.environ.get("MAJORANA_ENV") == "production":
        raise SystemExit("refusing to materialize seeds in MAJORANA_ENV=production")
    print(json.dumps(asyncio.run(_run()), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
