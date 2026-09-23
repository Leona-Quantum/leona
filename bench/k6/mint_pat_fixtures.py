"""Mint the personal-access-token fixtures `pat-abuse.js` asserts against.

Part of the §2 k6 abuse run for personal access tokens (`plans/rebuild/05-security.md`,
owner ruling ai-ops 362). k6 cannot mint a token itself — minting needs a signed-in
person, and this harness deliberately never goes through WorkOS (`run-pat-abuse.sh`
follows `run-abuse.sh`'s own local-auth pattern). So this script does what a person
minting a token in Account -> Access tokens would do, through the same repository
functions `routes/tokens.py` calls, and writes the six resulting secrets to a
shell-sourceable file for the harness to hand to k6 as environment variables.

Six tokens, one per thing the scenario has to show:

- `FLOOD_TOKEN` — read-only, floods `/v1/me` past its own per-minute ceiling.
- `SECOND_TOKEN` — a DIFFERENT token, read-only, reads `/v1/me` through the flood.
  Proves the ceiling is per-token: two tokens sharing nothing but existing at the same
  time must not affect each other's admission.
- `REVOKED_TOKEN` — minted, then revoked before the scenario ever presents it.
- `EXPIRED_TOKEN` — minted with the shortest lifetime the API allows (one day, since
  `expires_in_days` must be >= 1) and then aged past that instant with a direct
  UPDATE, the same escape the structural test `test_the_ninety_day_ceiling_...` uses
  to reach the database's own constraint rather than the route. The script sleeps
  past the forced expiry before returning, so the harness never has to race it.
- `READONLY_TOKEN` — `read` only. Proves a read-only token cannot start a run.
- `RUNSCOPE_TOKEN` — `read` + `run`, the widest a token can be. Proves a run-scoped
  token CAN start a run, and that even the widest token is refused on the hardware
  submission route — there is no scope that reaches it (`auth/token_access.py`).

Each token belongs to its OWN freshly-provisioned user, on the `k6.majorana.test`
domain `run-abuse.sh` already uses for its throwaway identity — never
`local-dev@majorana.test`, which is in `OPERATOR_IDENTITIES` and unmetered, and not
that either matters here: none of these six scenarios depends on tier metering, only
on the token machinery itself.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import sys
import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TokenScope
from sqlalchemy import update

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import PersonalAccessToken
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system

#: How long past "now" `EXPIRED_TOKEN`'s forced expiry is set, and how long this
#: script sleeps afterwards. Short, because every second here is added to the
#: harness's total runtime, and generous, because the only failure mode of being
#: too short is the whole point of this fixture silently not being expired yet.
_EXPIRY_MARGIN_S = 3


async def _persona(db, tag: str) -> Scope:
    stamp = uuid.uuid4().hex[:10]
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"pat-abuse-{tag}-{stamp}",
        email=f"pat-abuse-{tag}-{stamp}@k6.majorana.test",
        display_name=f"k6 PAT abuse ({tag})",
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _main() -> None:
    engine = engine_from_env()
    factory = session_factory(engine)
    tokens: dict[str, str] = {}
    try:
        async with factory() as db:
            flood_scope = await _persona(db, "flood")
            tokens["FLOOD_TOKEN"], _ = await tokens_repo.mint(
                flood_scope, db, name="k6 flood", scopes=[TokenScope.READ]
            )

            second_scope = await _persona(db, "second")
            tokens["SECOND_TOKEN"], _ = await tokens_repo.mint(
                second_scope, db, name="k6 second reader", scopes=[TokenScope.READ]
            )

            revoked_scope = await _persona(db, "revoked")
            _revoked_secret, revoked_row = await tokens_repo.mint(
                revoked_scope, db, name="k6 revoked", scopes=[TokenScope.READ]
            )
            tokens["REVOKED_TOKEN"] = _revoked_secret
            await tokens_repo.revoke(revoked_scope, db, revoked_row.id)

            expired_scope = await _persona(db, "expired")
            expired_secret, expired_row = await tokens_repo.mint(
                expired_scope, db, name="k6 expired", scopes=[TokenScope.READ], expires_in_days=1
            )
            tokens["EXPIRED_TOKEN"] = expired_secret
            forced_expiry = expired_row.created_at + dt.timedelta(seconds=_EXPIRY_MARGIN_S)
            # Direct UPDATE, not the repository: `mint`'s own ceiling is a floor of one
            # day, so the only way to reach an already-expired row is to go around it,
            # the same way `test_the_ninety_day_ceiling_is_enforced_three_times_over`
            # goes around the repository to reach 0069's own check constraint. Still
            # inside that constraint (`expires_at > created_at`), just by a few seconds
            # rather than a day.
            await db.execute(
                update(PersonalAccessToken)
                .where(PersonalAccessToken.id == expired_row.id)
                .values(expires_at=forced_expiry)
            )

            readonly_scope = await _persona(db, "readonly")
            tokens["READONLY_TOKEN"], _ = await tokens_repo.mint(
                readonly_scope, db, name="k6 read only", scopes=[TokenScope.READ]
            )

            runscope_scope = await _persona(db, "runscope")
            tokens["RUNSCOPE_TOKEN"], _ = await tokens_repo.mint(
                runscope_scope,
                db,
                name="k6 read+run",
                scopes=[TokenScope.READ, TokenScope.RUN],
            )

            await db.commit()

        # Sleeps AFTER commit, so the flood/second/readonly/runscope scenarios (which
        # do not depend on this) are not held up by a wait that is only for the one
        # token that does.
        print(
            f"sleeping {_EXPIRY_MARGIN_S}s past EXPIRED_TOKEN's forced expiry "
            f"({forced_expiry.isoformat()})",
            file=sys.stderr,
        )
        await asyncio.sleep(_EXPIRY_MARGIN_S + 1)
    finally:
        await engine.dispose()

    out_path = sys.argv[1] if len(sys.argv) > 1 else "bench/k6/out/pat-tokens.env"
    with open(out_path, "w") as fh:
        for name, value in tokens.items():
            fh.write(f"{name}={value}\n")
    os.chmod(out_path, 0o600)
    print(f"wrote {len(tokens)} tokens to {out_path}", file=sys.stderr)
    print(json.dumps({"tokens_minted": len(tokens)}))


if __name__ == "__main__":
    asyncio.run(_main())
