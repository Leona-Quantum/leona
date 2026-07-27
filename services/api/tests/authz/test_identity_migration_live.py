"""Reattaching accounts after a WorkOS environment switch, against live Postgres.

This is the one operation in the system that rewrites who an account belongs to,
and it runs once, by hand, over real people's work. So the cases that matter are
the ones where it must REFUSE — the tests below spend more effort on those than
on the happy path, because a merge that declines to run costs an operator an
afternoon and a merge that runs when it should not costs somebody their history.
"""

import uuid

from matrix_helpers import requires_db
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select

from majorana_api.orm import User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import identity_migration, system

pytestmark = requires_db


async def _account(db, email: str, sub: str) -> User:
    user, _ws = await system.get_or_provision_user(db, workos_user_id=sub, email=email)
    return user


def _email(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}@migration.test"


async def _sub_of(db, user_id) -> str:
    return (await db.execute(select(User.workos_user_id).where(User.id == user_id))).scalar_one()


async def test_an_account_that_has_not_signed_in_yet_is_simply_rekeyed(db):
    """The easy majority. Nobody has created a duplicate, so there is nothing to
    retire — the original row takes the new sub directly."""
    email = _email("waiting")
    original = await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"

    plan = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    assert [m.action for m in plan.matches] == ["rekey"]

    await identity_migration.apply_reattachment(db, plan=plan)
    assert await _sub_of(db, original.id) == new_sub


async def test_an_empty_duplicate_is_retired_and_the_history_is_rekeyed(db):
    """The case the switch actually creates: they signed in, got a fresh empty
    account, and their work is on the old row."""
    email = _email("signed-in")
    original = await _account(db, email, f"staging-{uuid.uuid4()}")
    original_id = original.id
    new_sub = f"prod-{uuid.uuid4()}"
    duplicate = await _account(db, email, new_sub)
    duplicate_id = duplicate.id
    assert duplicate_id != original_id

    plan = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    assert [m.action for m in plan.matches] == ["retire_and_rekey"]

    await identity_migration.apply_reattachment(db, plan=plan)
    assert await _sub_of(db, original_id) == new_sub
    retired = await _sub_of(db, duplicate_id)
    assert retired.startswith(identity_migration.RETIRED_PREFIX)
    assert new_sub in retired  # reversible: the operator can read what it was


async def test_the_retired_row_and_its_workspace_still_exist(db):
    """Nothing is deleted. The duplicate keeps its personal workspace, its
    starter artifact and its membership, so the swap can be swapped back."""
    email = _email("intact")
    await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"
    duplicate = await _account(db, email, new_sub)
    duplicate_id = duplicate.id

    plan = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    await identity_migration.apply_reattachment(db, plan=plan)

    still_there = (await db.execute(select(User).where(User.id == duplicate_id))).scalars().first()
    assert still_there is not None
    assert await identity_migration.count_memberships(db, duplicate_id) >= 1


async def test_a_duplicate_that_holds_real_work_blocks_the_merge(db):
    """They signed in and did something before this was run. Re-keying now would
    strand that work under the retired row — the same harm, pointed the other
    way — so it refuses and says what to do."""
    email = _email("busy")
    await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"
    duplicate = await _account(db, email, new_sub)
    _dup_user, dup_ws = await system.get_or_provision_user(db, workos_user_id=new_sub, email=email)
    await artifacts_repo.create_artifact(
        Scope(user_id=duplicate.id, workspace_id=dup_ws.id, role=Role.OWNER),
        db,
        slug=f"dup-work-{uuid.uuid4().hex[:10]}",
        title="Work done under the new identity",
        family="Bell",
        framework="qiskit",
    )
    await db.flush()

    plan = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    assert [m.action for m in plan.matches] == ["blocked"]
    assert "merge by hand" in plan.matches[0].reason
    assert plan.actionable == []


async def test_the_starter_artifact_does_not_count_as_work(db):
    """Every provisioned account is given a Bell circuit without asking. If it
    counted, every duplicate would look busy and the merge would never run —
    which is a script that is safe and useless."""
    email = _email("starter")
    await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"
    await _account(db, email, new_sub)

    plan = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    assert plan.matches[0].duplicate_artifacts == 0
    assert plan.matches[0].action == "retire_and_rekey"


async def test_two_existing_accounts_on_one_address_are_refused(db):
    """`users.email` has no unique constraint, so this is representable. Picking
    one would silently decide which of two histories the person keeps."""
    email = _email("ambiguous")
    await _account(db, email, f"staging-a-{uuid.uuid4()}")
    await _account(db, email, f"staging-b-{uuid.uuid4()}")

    plan = await identity_migration.plan_reattachment(
        db, identities={email: f"prod-{uuid.uuid4()}"}
    )
    assert plan.matches[0].action == "blocked"
    assert "share this address" in plan.matches[0].reason


async def test_an_address_with_no_account_is_a_no_op(db):
    """Somebody who only ever existed in the new environment."""
    plan = await identity_migration.plan_reattachment(
        db, identities={_email("nobody"): f"prod-{uuid.uuid4()}"}
    )
    assert plan.matches[0].action == "none"
    assert plan.actionable == []


async def test_running_it_twice_changes_nothing_the_second_time(db):
    """Idempotent, because an operator who is unsure whether it completed will
    run it again, and that has to be the safe thing to do."""
    email = _email("twice")
    original = await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"
    await _account(db, email, new_sub)

    first = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    await identity_migration.apply_reattachment(db, plan=first)
    after_first = await _sub_of(db, original.id)

    second = await identity_migration.plan_reattachment(db, identities={email: new_sub})
    assert [m.action for m in second.matches] == ["none"]
    await identity_migration.apply_reattachment(db, plan=second)
    assert await _sub_of(db, original.id) == after_first


async def test_the_match_is_case_and_space_insensitive(db):
    """WorkOS is not obliged to hand back the address in the case it was stored
    in, and one mismatched capital would silently skip a person."""
    email = _email("case")
    original = await _account(db, email, f"staging-{uuid.uuid4()}")
    new_sub = f"prod-{uuid.uuid4()}"

    plan = await identity_migration.plan_reattachment(
        db, identities={f"  {email.upper()}  ": new_sub}
    )
    assert plan.matches[0].action == "rekey"
    await identity_migration.apply_reattachment(db, plan=plan)
    assert await _sub_of(db, original.id) == new_sub


async def test_a_plan_reports_what_each_account_stands_to_get_back(db):
    """The dry run is the whole safety mechanism, so it has to be readable: the
    operator decides from these numbers whether the match is the right person."""
    email = _email("counted")
    original = await _account(db, email, f"staging-{uuid.uuid4()}")
    personal = (await system.list_user_workspaces(db, user_id=original.id))[0][0]
    await artifacts_repo.create_artifact(
        Scope(user_id=original.id, workspace_id=personal.id, role=Role.OWNER),
        db,
        slug=f"real-work-{uuid.uuid4().hex[:10]}",
        title="Real work",
        family="Bell",
        framework="qiskit",
    )
    await db.flush()

    plan = await identity_migration.plan_reattachment(
        db, identities={email: f"prod-{uuid.uuid4()}"}
    )
    assert plan.matches[0].artifacts == 1
    assert plan.matches[0].action == "rekey"


async def test_a_blocked_account_is_not_touched_by_apply(db):
    """apply() walks `actionable`, not `matches`. Asserted rather than read off
    the code, because the day those two diverge is the day a refusal stops
    refusing."""
    email = _email("untouched")
    a = await _account(db, email, f"staging-a-{uuid.uuid4()}")
    b = await _account(db, email, f"staging-b-{uuid.uuid4()}")
    before = (await _sub_of(db, a.id), await _sub_of(db, b.id))

    plan = await identity_migration.plan_reattachment(
        db, identities={email: f"prod-{uuid.uuid4()}"}
    )
    applied = await identity_migration.apply_reattachment(db, plan=plan)
    assert applied == []
    assert (await _sub_of(db, a.id), await _sub_of(db, b.id)) == before
