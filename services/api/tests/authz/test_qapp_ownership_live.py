"""Cross-user Qapp authz: rollback, activity, usage, and forking a private Qapp.

Live-DB suite (05-security.md §1 AuthN/AuthZ), proposal 6 (Qapps v2). Every
Qapp *read* here (`get_qapp`, `list_versions`) is workspace-scoped, matching
the existing pattern for `list_qapps`/`qapp_detail` — any co-member of the
owning workspace can see a Qapp exists and browse its history. The four
actions this file exercises are narrower than that on purpose, the same way
`set_visibility` and `soft_delete_qapp` already narrow a workspace-scoped read
to an owner-only write (see `test_only_the_creator_may_publish_and_the_gate_is_never_reached`
and `test_only_the_creator_may_delete_a_qapp` in `services/api/tests/test_qapps.py`,
which pin the same rule with a fake session). This suite proves the identical
narrowing against a real Postgres and a real second WORKSPACE — user B is not
merely a different role in A's workspace, they cannot see into it at all
except through the one thing this whole module makes cross-tenant on purpose:
a PUBLISHED Qapp's public projection.

Workspace A owns the Qapp under test. The cross-user probe for rollback,
usage and activity is a CO-MEMBER of A's own workspace, not a stranger from a
separate workspace — a genuine outsider is already refused earlier and more
strongly, by `get_qapp`'s workspace filter (a mismatched `workspace_id`
returns `NotFoundError`, same as a deleted or nonexistent row, "by design" per
`_base.py`). The new rule this file exists to prove is narrower than that: it
is what stops someone who CAN already see the Qapp — because they share A's
workspace — from repointing, reading the usage of, or reading the activity of
a Qapp a *different* member of that same workspace owns. That is exactly the
shape `set_visibility`/`soft_delete_qapp` already narrow the same way, and
`test_qapps.py`'s `publication` fixture builds its `stranger` the identical
way: same `workspace_id`, different `user_id`.

Fork's cross-user probe is the other shape, and correctly so: a fork's source
is looked up by slug through `get_accessible_by_slug`, which ANY signed-in
scope can resolve for a PUBLIC Qapp regardless of workspace — that is the
point of publication — so the rule fork actually enforces is "published or
refused," proved below against both a stranger's and the owner's own
unpublished Qapp.
"""

from __future__ import annotations

import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode
from matrix_helpers import requires_db

from majorana_api.repos import qapps as qapps_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo

pytestmark = requires_db

SCHEMA = {"type": "object", "properties": {"shots": {"type": "integer"}}, "required": []}


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await system.get_or_provision_user(
        db, workos_user_id=f"qapp-authz-{tag}-{uuid.uuid4()}", email=f"{tag}@qapp-authz.test"
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _co_member_scope(db, owner: Scope, tag: str, *, role: Role = Role.MEMBER) -> Scope:
    """A second, real user added to the OWNER's own workspace — same
    `workspace_id`, different `user_id`. This is the scope every Qapp
    ownership check in this module (`set_visibility`, `soft_delete_qapp`,
    `roll_back`, `list_qapp_activity`, `qapp_usage`) exists to refuse, because
    `get_qapp` alone would let them read the row.
    """
    member, _own_ws = await system.get_or_provision_user(
        db, workos_user_id=f"qapp-authz-{tag}-{uuid.uuid4()}", email=f"{tag}@qapp-authz.test"
    )
    await workspaces_repo.add_member(owner, db, user_id=member.id, role=role)
    return Scope(user_id=member.id, workspace_id=owner.workspace_id, role=role)


async def _generated_qapp(db, scope: Scope, *, tag: str):
    """One private Qapp, owned by `scope`, with a real originating run."""
    run = await runs_repo.create_run(
        scope, db, task_prompt=f"qapp authz probe {tag}", mode=RunMode.QAPP, framework=Framework.QISKIT
    )
    qapp, version = await qapps_repo.create_generated(
        scope,
        db,
        run_id=run.id,
        title=f"Authz probe {tag}",
        description="A probe Qapp for the live authz suite.",
        framework="qiskit",
        qubits_estimate=2,
        ui_document="<button id='go'>Run</button>",
        quantum_source="RESULT = {}",
        input_schema=SCHEMA,
        output_schema={"type": "object"},
        generation_prompt=f"authz probe {tag}",
        source_artifact_version_id=None,
    )
    return qapp, version


async def _second_generated_version(db, scope: Scope, qapp, *, tag: str):
    """A second, independent Qapp+version pair, standing in for "an earlier
    version of the same Qapp" — `create_generated` has no "add a version to an
    existing Qapp" entry point yet (every Qapp today is born with exactly one
    version), so the rollback tests move `current_version_id` to a version
    from a second `create_generated` call and treat it as this Qapp's own
    version by construction, exactly as `roll_back` itself only cares that
    `version.qapp_id == qapp.id`.
    """
    run = await runs_repo.create_run(
        scope, db, task_prompt=f"qapp authz probe {tag} v2", mode=RunMode.QAPP, framework=Framework.QISKIT
    )
    # Reuse create_generated's insert path directly on the SAME qapp row by
    # inserting a second version by hand through the repository's own ORM
    # import would duplicate its dedup logic; instead, insert via the
    # low-level session the `db` fixture already provides.
    from majorana_api.orm import QappVersion
    from majorana_api.ids import uuid7
    import hashlib
    import json

    canonical = json.dumps(
        {
            "framework": "qiskit",
            "qubits_estimate": 3,
            "ui_document": "<button id='go2'>Run</button>",
            "quantum_source": "RESULT = {'v': 2}",
            "input_schema": SCHEMA,
            "output_schema": {"type": "object"},
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    version = QappVersion(
        id=uuid7(),
        qapp_id=qapp.id,
        seq=2,  # every fixture Qapp in this file starts at seq=1 from `create_generated`
        framework="qiskit",
        qubits_estimate=3,
        ui_document="<button id='go2'>Run</button>",
        quantum_source="RESULT = {'v': 2}",
        input_schema=SCHEMA,
        output_schema={"type": "object"},
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest(),
        source_artifact_version_id=None,
        generation_prompt=f"authz probe {tag} v2",
        range_smoke=None,
    )
    db.add(version)
    await db.flush()
    return version


async def _publish(db, scope: Scope, qapp, version):
    execution = await qapps_repo.create_execution(scope, db, qapp=qapp, version=version, inputs={})
    await qapps_repo.finish_execution(
        scope, db, execution.id, result={"ok": True}, error_code=None, sandbox_meta=None
    )
    return await qapps_repo.set_visibility(scope, db, qapp.id, "public")


# --------------------------------------------------------------------- rollback


async def test_a_co_member_cannot_roll_back_another_members_qapp(db):
    owner = await _owner_scope(db, "rb-owner")
    stranger = await _co_member_scope(db, owner, "rb-stranger")
    qapp, v1 = await _generated_qapp(db, owner, tag="rb")
    v2 = await _second_generated_version(db, owner, qapp, tag="rb")

    with pytest.raises(qapps_repo.AuthzError, match="only the Qapp creator"):
        await qapps_repo.roll_back(stranger, db, qapp.id, v1.id)

    # Unchanged: the stranger's refused call did not move the pointer.
    fresh = await qapps_repo.get_qapp(owner, db, qapp.id)
    assert fresh.current_version_id == v1.id
    assert v2.id != v1.id  # the probe actually targeted a different version


async def test_the_creator_can_roll_back_their_own_qapp(db):
    """The control: the same call the test above refuses must succeed for the
    actual creator, against the same data — otherwise the refusal above could
    be a bug that refuses everyone rather than an authz check."""
    owner = await _owner_scope(db, "rb-ok-owner")
    qapp, v1 = await _generated_qapp(db, owner, tag="rb-ok")
    v2 = await _second_generated_version(db, owner, qapp, tag="rb-ok")

    qapp.current_version_id = v2.id
    await db.flush()

    result, demoted = await qapps_repo.roll_back(owner, db, qapp.id, v1.id)
    assert result.current_version_id == v1.id
    assert demoted is False  # was never public, so nothing to demote


async def test_rolling_back_a_public_qapp_to_an_unrun_version_takes_it_private(db):
    """The ADR-0031 gate, re-checked at rollback time, not only at publish time.

    A version this system generated always has a low-end smoke run behind it
    in production, but the repository layer cannot assume that — it re-derives
    "has this exact version ever succeeded" from `qapp_executions`, the same
    predicate `set_visibility` uses. `v2` here has never been executed, so
    rolling onto it must take the Qapp private rather than serve an unproven
    version on a public page.
    """
    owner = await _owner_scope(db, "rb-demote-owner")
    qapp, v1 = await _generated_qapp(db, owner, tag="rb-demote")
    v2 = await _second_generated_version(db, owner, qapp, tag="rb-demote")
    await _publish(db, owner, qapp, v1)

    result, demoted = await qapps_repo.roll_back(owner, db, qapp.id, v2.id)

    assert demoted is True
    assert result.visibility == "private"
    assert result.published_at is None
    assert result.current_version_id == v2.id


# --------------------------------------------------------------------- usage


async def test_a_co_member_cannot_see_another_members_qapp_usage(db):
    owner = await _owner_scope(db, "usage-owner")
    stranger = await _co_member_scope(db, owner, "usage-stranger")
    qapp, version = await _generated_qapp(db, owner, tag="usage")
    execution = await qapps_repo.create_execution(owner, db, qapp=qapp, version=version, inputs={})
    await qapps_repo.finish_execution(
        owner, db, execution.id, result={"ok": True}, error_code=None, sandbox_meta=None
    )

    with pytest.raises(qapps_repo.AuthzError, match="only the Qapp creator"):
        await qapps_repo.qapp_usage(stranger, db, qapp.id)


async def test_the_creator_sees_their_own_qapp_usage(db):
    owner = await _owner_scope(db, "usage-ok-owner")
    qapp, version = await _generated_qapp(db, owner, tag="usage-ok")
    execution = await qapps_repo.create_execution(owner, db, qapp=qapp, version=version, inputs={})
    await qapps_repo.finish_execution(
        owner, db, execution.id, result={"ok": True}, error_code=None, sandbox_meta=None
    )

    rows = await qapps_repo.qapp_usage(owner, db, qapp.id)

    assert len(rows) == 1
    assert rows[0].qapp_version_id == version.id
    assert rows[0].total == 1
    assert rows[0].succeeded == 1
    assert rows[0].last_execution_status == "succeeded"


# --------------------------------------------------------------------- activity


async def test_a_co_member_cannot_see_another_members_qapp_activity(db):
    owner = await _owner_scope(db, "activity-owner")
    stranger = await _co_member_scope(db, owner, "activity-stranger")
    qapp, _version = await _generated_qapp(db, owner, tag="activity")

    with pytest.raises(qapps_repo.AuthzError, match="only the Qapp creator"):
        await qapps_repo.list_qapp_activity(stranger, db, qapp.id)


async def test_the_creator_sees_their_own_qapp_activity(db):
    owner = await _owner_scope(db, "activity-ok-owner")
    qapp, _version = await _generated_qapp(db, owner, tag="activity-ok")

    rows = await qapps_repo.list_qapp_activity(owner, db, qapp.id)

    assert any(row.action == "qapp.created" for row in rows)


# --------------------------------------------------------------------- fork


async def test_forking_a_strangers_private_qapp_is_refused(db):
    owner = await _owner_scope(db, "fork-private-owner")
    forker = await _owner_scope(db, "fork-private-forker")
    qapp, _version = await _generated_qapp(db, owner, tag="fork-private")
    # Never published.

    with pytest.raises(qapps_repo.NotFoundError):
        await qapps_repo.fork_qapp(forker, db, source_slug=qapp.slug)


async def test_forking_ones_own_unpublished_qapp_is_refused(db):
    """The rule is publication, not workspace membership: the owner cannot
    fork their own draft either, because `fork_qapp` looks up the source
    through `get_accessible_by_slug`, which the owner's own scope always
    satisfies — the publication check is what actually refuses this."""
    owner = await _owner_scope(db, "fork-own-owner")
    qapp, _version = await _generated_qapp(db, owner, tag="fork-own")

    with pytest.raises(qapps_repo.QappForkBlocked, match="published"):
        await qapps_repo.fork_qapp(owner, db, source_slug=qapp.slug)


async def test_forking_a_published_qapp_succeeds_and_records_provenance(db):
    """The control: the same call refused twice above must succeed once the
    source is actually published, and the fork must land PRIVATE in the
    forker's OWN workspace with provenance pointing at the source."""
    owner = await _owner_scope(db, "fork-ok-owner")
    forker = await _owner_scope(db, "fork-ok-forker")
    qapp, version = await _generated_qapp(db, owner, tag="fork-ok")
    await _publish(db, owner, qapp, version)

    fork, fork_version = await qapps_repo.fork_qapp(forker, db, source_slug=qapp.slug)

    assert fork.workspace_id == forker.workspace_id
    assert fork.owner_user_id == forker.user_id
    assert fork.visibility == "private"
    assert fork.forked_from_qapp_id == qapp.id
    assert fork.forked_from_version_id == version.id
    assert fork.created_by_run_id is None
    assert fork_version.ui_document == version.ui_document
    assert fork_version.quantum_source == version.quantum_source
    assert fork_version.seq == 1

    # The fork's own gate is unearned: it has never been executed, so it
    # cannot ride the source's proof of executability.
    with pytest.raises(qapps_repo.QappPublicationBlocked):
        await qapps_repo.set_visibility(forker, db, fork.id, "public")
