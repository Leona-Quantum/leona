"""Which `users` row is the live account — the rule that grants ADMIN.

D70.2 lived only in a runbook paragraph, where an operator had to read it,
believe it, and hand-copy a UUID out of an ad-hoc query against production. The
tiebreak it describes is the *opposite* of the obvious one, and `attest-
bootstrap` grants the account it is handed ADMIN on the catalog workspace — so
picking wrong is a real grant on a dead row.

No database here on purpose. The query is one line; the rule is the part that
was wrong in prose, and a test needing Postgres is a test the unit suite does
not run.
"""

from __future__ import annotations

import uuid

import pytest

from majorana_api.catalog_admin import pick_live_reviewer

OWNER = "owner@example.com"
OLD = uuid.UUID("019f5b84-0000-4000-8000-000000000001")
NEW = uuid.UUID("019f9999-0000-4000-8000-000000000002")


def test_the_live_row_is_the_one_without_a_retired_prefix_not_the_newest() -> None:
    """The whole point: created_at gets this backwards.

    The rows are passed newest-first so a "take the last one" or "take the
    first one" implementation cannot pass by accident — only reading the WorkOS
    id does.
    """
    rows = [
        (NEW, f"retired-workos-env:2026-07-30T00:00:00Z:{OLD}"),
        (OLD, "user_01LIVEWORKOSID"),
    ]
    assert pick_live_reviewer(OWNER, rows) == OLD
    # …and in the other order, so the result is the rule rather than the
    # ordering the database happened to return.
    assert pick_live_reviewer(OWNER, list(reversed(rows))) == OLD


def test_one_row_resolves_without_ceremony() -> None:
    assert pick_live_reviewer(OWNER, [(OLD, "user_01LIVE")]) == OLD


def test_an_email_nobody_carries_refuses() -> None:
    with pytest.raises(SystemExit, match="no user row carries"):
        pick_live_reviewer(OWNER, [])


def test_every_row_retired_refuses_rather_than_attesting_as_a_dead_account() -> None:
    """A grant on a retired row is invisible: it succeeds and reaches nobody."""
    with pytest.raises(SystemExit, match="no live account"):
        pick_live_reviewer(
            OWNER,
            [
                (NEW, f"retired-workos-env:2026-07-30T00:00:00Z:{OLD}"),
                (OLD, f"retired-workos-env:2026-07-29T00:00:00Z:{NEW}"),
            ],
        )


def test_two_live_rows_refuse_and_name_both_rather_than_choosing() -> None:
    """Ambiguity is a state nobody has decided how to resolve.

    Choosing one silently is how a grant lands somewhere nobody looked, so the
    refusal names both ids and points at `--attested-by`, which is the escape
    hatch for exactly this case.
    """
    with pytest.raises(SystemExit) as excinfo:
        pick_live_reviewer(OWNER, [(NEW, "user_01A"), (OLD, "user_01B")])
    message = str(excinfo.value)
    assert str(NEW) in message and str(OLD) in message
    assert "--attested-by" in message
