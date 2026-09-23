"""Mint the notebook-share-link fixtures `share-abuse.js` asserts against.

Part of the §1a/§2 k6 abuse run for public notebook share links (ai-ops 349, option
2). `POST /v1/notebooks/shared/lookup` needs a real, minted share link — k6 cannot
mint one itself, minting needs a signed-in creator. This script does what a
notebook's creator does through `POST /notebooks/{id}/share-links`, but through the
same repository functions that route calls (`repos/notebook_share_links.py`), the
same shape `mint_pat_fixtures.py` uses for personal access tokens. It writes the
resulting tokens to a shell-sourceable file for `run-share-abuse.sh` to hand to k6
as environment variables.

Four tokens:

- `VALID_TOKEN` — a live link for the one fixture notebook below. Both the flood
  and the second-address bystander present this SAME token: the ceiling under test
  (`rate_limit.DEFAULT_ANON_LIMIT`) is keyed on the caller's address, not the
  token, so one live token is enough to prove both "the flood is refused past the
  ceiling" and "a different address reading the same link is not".
- `REVOKED_TOKEN` — minted, then revoked before the scenario ever presents it.
- `EXPIRED_TOKEN` — minted with `now` backdated two days and `expires_in_days=1`,
  so its real `expires_at` is one day in the past by construction. No sleep
  needed (contrast `mint_pat_fixtures.py`'s `EXPIRED_TOKEN`, which ages a token
  forward because personal-access-token expiry has a one-day floor measured from
  a real `now`; `notebook_share_links.mint` has no such floor and takes `now`
  directly, so the fixture can be born already-expired).
- `RANDOM_TOKEN` — never minted; `notebook_share_links.SHARE_TOKEN_PREFIX` followed
  by fresh, unrelated entropy. Guaranteed not to hash-match any row.

The fixture notebook itself carries one answer-key sentinel on the two surfaces
`routes/notebook_shares.py` redacts: `SENTINEL` in a `SOLUTION` cell's source (the
`spec` surface `NotebookSpec.for_learner()` redacts) AND in that same cell's
`CellResult.stdout` from a prior run (the `report` surface
`_redact_report_for_public` guards, per that function's own docstring on why a
solution cell's execution output needs a SEPARATE guard). One string, planted on
both surfaces that have needed a fix here before, is a stronger negative control
than either alone.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import secrets
import sys
import uuid

import majorana_contracts as contracts
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.notebook_shares import SHARE_TOKEN_PREFIX

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import notebook_share_links as share_links_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import system

#: Distinctive and greppable — a k6 assertion that finds none of this in a
#: response body is finding the absence of THIS string, not merely "nothing
#: looked wrong". Randomised per run so a stale fixture from a previous run
#: sitting in some other database cannot produce a false negative.
SENTINEL = f"K6-SHARE-ANSWER-KEY-{uuid.uuid4().hex[:12]}"


async def _owner_scope(db) -> Scope:
    stamp = uuid.uuid4().hex[:10]
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"share-abuse-{stamp}",
        email=f"share-abuse-{stamp}@k6.majorana.test",
        display_name="k6 share-abuse fixture owner",
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


def _spec(slug: str) -> contracts.NotebookSpec:
    return contracts.NotebookSpec(
        slug=slug,
        title="k6 share-abuse fixture",
        kind=contracts.NotebookKind.LESSON,
        cells=[
            contracts.Cell(
                id="intro", kind="markdown", role=contracts.CellRole.OBJECTIVE, source="Learn X."
            ),
            contracts.Cell(
                id="exercise1",
                kind="code",
                role=contracts.CellRole.EXERCISE,
                source="",
                stub="def f():\n    ...\n",
                check="assert f() is not None",
            ),
            contracts.Cell(
                id="solution1",
                kind="code",
                role=contracts.CellRole.SOLUTION,
                source=f"def f():\n    return '{SENTINEL}'\n",
                stub="def f():\n    ...\n",
            ),
        ],
    )


async def _fixture_notebook(scope: Scope, db) -> uuid.UUID:
    slug = f"k6-share-abuse-{uuid.uuid4().hex[:10]}"
    notebook, version = await notebooks_repo.create_notebook(
        scope,
        db,
        slug=slug,
        title="k6 share-abuse fixture",
        kind=contracts.NotebookKind.LESSON.value,
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={},
        run_id=None,
        created_by="user",
    )
    report = contracts.ExecutionReport(
        notebook_slug=slug,
        ok=True,
        runner="sandbox",
        cells=[
            contracts.CellResult(id="solution1", status="ok", stdout=f"ran: {SENTINEL}"),
            contracts.CellResult(id="exercise1", status="not_run"),
        ],
    )
    await notebooks_repo.set_version_result(
        scope,
        db,
        version.id,
        status=contracts.NotebookVersionStatus.READY.value,
        spec=_spec(slug).model_dump(mode="json"),
        source="",
        ipynb={"cells": []},
        report=report.model_dump(mode="json"),
        review=None,
        error="",
    )
    return notebook.id


async def _main() -> None:
    engine = engine_from_env()
    factory = session_factory(engine)
    tokens: dict[str, str] = {}
    try:
        async with factory() as db:
            scope = await _owner_scope(db)
            notebook_id = await _fixture_notebook(scope, db)

            tokens["VALID_TOKEN"], _valid_row = await share_links_repo.mint(scope, db, notebook_id)

            revoked_secret, revoked_row = await share_links_repo.mint(scope, db, notebook_id)
            tokens["REVOKED_TOKEN"] = revoked_secret
            await share_links_repo.revoke(scope, db, notebook_id, revoked_row.id)

            # Born already expired: `now` backdated two days, a one-day lifetime,
            # so `expires_at` (moment + 1 day) lands one day in the real past. No
            # sleep, no raw UPDATE — `mint`'s own `now` override does the whole job.
            backdated_moment = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)
            expired_secret, _expired_row = await share_links_repo.mint(
                scope, db, notebook_id, expires_in_days=1, now=backdated_moment
            )
            tokens["EXPIRED_TOKEN"] = expired_secret

            # Never inserted. Real prefix, fresh entropy — guaranteed not to hash
            # to any row `resolve_presented` could find.
            tokens["RANDOM_TOKEN"] = f"{SHARE_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"

            await db.commit()
    finally:
        await engine.dispose()

    out_path = sys.argv[1] if len(sys.argv) > 1 else "bench/k6/out/share-tokens.env"
    with open(out_path, "w") as fh:
        for name, value in tokens.items():
            fh.write(f"{name}={value}\n")
        fh.write(f"SENTINEL={SENTINEL}\n")
    os.chmod(out_path, 0o600)
    print(f"wrote {len(tokens)} tokens + sentinel to {out_path}", file=sys.stderr)
    print(json.dumps({"tokens_minted": len(tokens), "sentinel": SENTINEL}))


if __name__ == "__main__":
    asyncio.run(_main())
