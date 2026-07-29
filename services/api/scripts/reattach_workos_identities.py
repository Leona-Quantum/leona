"""Reattach accounts after a WorkOS environment switch. Dry run by default.

    # what would happen, touching nothing
    WORKOS_API_KEY=sk_... DATABASE_URL=... uv run python \
        services/api/scripts/reattach_workos_identities.py

    # do it
    ... reattach_workos_identities.py --apply

The pairing of email address to new `sub` is pulled from the WorkOS API, which
is the only authoritative source for it. Deriving it from tokens the app has
already accepted would be circular — those tokens are exactly what stopped
resolving.

Read `--apply` twice before typing it. The dry run prints, per person, how many
artifacts and runs they get back and whether the new account it is about to
retire is empty; those numbers are the check that the match is the right human,
and nothing else in the process performs that check.
"""

import argparse
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from majorana_api.db import engine_from_env, session_factory  # noqa: E402
from majorana_api.repos import identity_migration  # noqa: E402

WORKOS_USERS_URL = "https://api.workos.com/user_management/users"


def fetch_workos_identities(api_key: str, *, limit: int = 100) -> dict[str, str]:
    """Every user in the environment the key belongs to, as email -> sub.

    Paginated deliberately rather than assuming one page: seven accounts fit in
    one today, and a silent truncation here would look exactly like "that person
    was not in the new environment", which is the one failure this script cannot
    distinguish from a legitimate no-op.
    """
    identities: dict[str, str] = {}
    after: str | None = None
    while True:
        url = f"{WORKOS_USERS_URL}?limit={limit}"
        if after:
            url += f"&after={after}"
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        for user in payload.get("data", []):
            email = (user.get("email") or "").strip().lower()
            if email and user.get("id"):
                identities[email] = user["id"]
        after = (payload.get("list_metadata") or {}).get("after")
        if not after:
            return identities


def _render(plan: identity_migration.ReattachPlan) -> None:
    width = max((len(m.email) for m in plan.matches), default=10)
    print(f"\n{'address'.ljust(width)}  {'action':<18} artifacts  runs  note")
    print("-" * (width + 52))
    for m in plan.matches:
        print(f"{m.email.ljust(width)}  {m.action:<18} {m.artifacts:>9}  {m.runs:>4}  {m.reason}")
    print(
        f"\n{len(plan.actionable)} to reattach, {len(plan.blocked)} blocked, "
        f"{len(plan.matches) - len(plan.actionable) - len(plan.blocked)} already fine"
    )
    for m in plan.blocked:
        print(f"  BLOCKED {m.email}: {m.reason}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="perform the changes")
    args = parser.parse_args()

    api_key = os.environ.get("WORKOS_API_KEY", "").strip()
    if not api_key:
        print("WORKOS_API_KEY is required (the NEW environment's key)", file=sys.stderr)
        return 2
    try:
        identities = fetch_workos_identities(api_key)
    except urllib.error.HTTPError as exc:
        print(f"WorkOS API refused the key: {exc.code} {exc.reason}", file=sys.stderr)
        return 2
    print(f"WorkOS environment reports {len(identities)} users")
    if not identities:
        # An empty environment plus --apply would be a silent no-op that reads as
        # success. Say so instead: it almost certainly means the wrong key.
        print("nothing to do — is this the key for the NEW environment?", file=sys.stderr)
        return 1

    engine = engine_from_env()
    try:
        async with session_factory(engine)() as session:
            plan = await identity_migration.plan_reattachment(session, identities=identities)
            _render(plan)
            if not args.apply:
                print("\ndry run — nothing was changed. Re-run with --apply.")
                return 0
            applied = await identity_migration.apply_reattachment(session, plan=plan)
            await session.commit()
            print(f"\nreattached {len(applied)} accounts")
            for m in applied:
                print(f"  {m.email}: {m.original_sub} -> {m.new_sub}")
            if plan.blocked:
                # A partial success is still a failure to finish, and the exit
                # code is what a runbook step is allowed to trust.
                return 1
            return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
