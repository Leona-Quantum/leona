"""Operator-only provisioning + bootstrap import for the system catalog authority."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from collections.abc import Sequence

from majorana_contracts import Scope
from majorana_contracts.enums import ImportJobStatus, Role
from sqlalchemy import select

from . import orm

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

    Content-only: the 283 records land as private/draft staged artifacts (no
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
    return policy.plan(claims, source.content_digests())


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
        carried = 0
        refused: list[str] = []
        for record in plan.included:
            artifact_id = targets[record.upstream_identity]
            # Owner decision B: a prior human grant binds to a record's new
            # version when the provenance claim is unchanged, and refuses when it
            # changed. A refusal is not a failure to be retried — it is the case
            # that needs a person, so it is collected and reported rather than
            # swept into a 283-record bulk run where nobody would see it.
            async with factory() as session:
                previous_claim = await catalog.latest_license_claim_hash(
                    importer_scope, session, artifact_id, authority=authority
                )
            carries = record.grant_carries_forward(previous_claim)
            if previous_claim is not None and not carries:
                refused.append(record.upstream_identity)
                continue
            if carries:
                carried += 1

            async with factory() as session:
                performed = await catalog.attest_catalog_record(
                    importer_scope,
                    reviewer_scope,
                    session,
                    artifact_id,
                    authority=authority,
                    spdx_id=policy.spdx_id,
                    assertion_kind=policy.assertion_kind,
                    license_scope=policy.license_scope,
                    source_kind=policy.source_kind,
                    evidence_hash=record.evidence_hash,
                    claim_hash=record.claim_hash,
                    repository=None,
                    ref=source.upstream_ref or None,
                    path=record.upstream_identity,
                    retrieval_metadata={
                        "manifest_checksum": source.manifest_checksum,
                        "upstream_identity": record.upstream_identity,
                        "source_kind_claim": record.source_kind_claim,
                        "license_claim": record.license_claim,
                    },
                    attestation_meta={
                        **attestation_meta,
                        "grant_carried_forward": carries,
                        "previous_claim_hash": previous_claim,
                    },
                )
                await session.commit()
            if performed:
                touched += 1

        # One ledger entry for the run itself, so the corpus-level act is
        # auditable without reassembling 283 per-record rows.
        #
        # It must describe what this run actually did, not what it set out to do.
        # Recording len(plan.included) here would claim the whole corpus was
        # attested even when records were refused — and this row commits before
        # the refusal exits, so that claim would be the durable one while the
        # accurate number existed only in a terminal nobody kept.
        async with factory() as session:
            await catalog.record_bulk_attestation(
                reviewer_scope,
                session,
                authority=authority,
                meta={
                    **attestation_meta,
                    "manifest_checksum": source.manifest_checksum,
                    "attested_count": len(plan.included) - len(refused),
                    "carried_forward_count": carried,
                    "excluded": {r.upstream_identity: r.reason for r in plan.excluded},
                    # Named, not counted: "3 records were refused" sends whoever
                    # reads this back to the import to work out which three.
                    "refused_provenance_claim_changed": sorted(refused),
                },
            )
            await session.commit()

        print(
            f"bulk attestation complete: spdx={policy.spdx_id} "
            f"attested={len(plan.included) - len(refused)} changed_this_run={touched} "
            f"carried_forward={carried} needs_signature={len(refused)} "
            f"excluded={len(plan.excluded)} policy={policy.checksum[:12]}"
        )
        for excluded in plan.excluded:
            print(f"  excluded {excluded.upstream_identity}: {excluded.reason}")
        for identity in refused[:20]:
            print(f"  needs a fresh signature (provenance claim changed): {identity}")
        if refused:
            # Fail-closed. These records keep their previous version live and
            # their new version unattested, which is the correct end state for a
            # record whose stated origin moved: it must not reach a visitor under
            # a grant made about something else.
            raise SystemExit(
                f"{len(refused)} records changed their provenance claim and cannot "
                "inherit the existing grant; re-attest them deliberately"
            )
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


async def _sync_bootstrap(attested_by: uuid.UUID) -> None:
    """Import, attest and publish the manifest as one operation.

    This exists because the three steps are not independently safe to leave
    part-done. Staging a new version resets an artifact's review_state from
    ACCEPTED to DRAFT, and the public predicate requires ACCEPTED *and* PUBLIC —
    so between `bootstrap-import` and `attest-bootstrap` every record whose
    content changed is off /repository entirely. Run by hand as three commands,
    that gap is however long the operator takes to type the next one.

    Each step is separately idempotent and each is the same function the
    individual subcommands call, so this is a sequencing guarantee, not a second
    implementation that could drift from them.
    """
    await _bootstrap_import()
    await _attest_bootstrap(attested_by)
    await _publish_bootstrap(attested_by)


_NEEDS_REVIEWER = {"attest-bootstrap", "publish-bootstrap", "sync-bootstrap"}

# A user row whose WorkOS id starts with this is a casualty of the environment
# switch, not an account anybody signs in to. See `_resolve_reviewer_by_email`.
_RETIRED_WORKOS_PREFIX = "retired-workos-env:"


def pick_live_reviewer(email: str, rows: Sequence[tuple[uuid.UUID, str]]) -> uuid.UUID:
    """Which of the ``users`` rows for one email is the live account.

    Separated from the query so the **rule** is testable without a database.
    The rule is the part that was wrong in prose and is the part that grants
    ADMIN; a test that needs Postgres to run is a test that does not run in the
    unit suite, and this rule earns one that does.

    See `_resolve_reviewer_by_email` for why the tiebreak is what it is.
    """
    if not rows:
        raise SystemExit(f"no user row carries the email {email!r}")
    live = [row for row in rows if not row[1].startswith(_RETIRED_WORKOS_PREFIX)]
    if not live:
        raise SystemExit(
            f"every user row for {email!r} carries a {_RETIRED_WORKOS_PREFIX} WorkOS id — "
            "there is no live account to attest as"
        )
    if len(live) > 1:
        raise SystemExit(
            f"{len(live)} live user rows carry {email!r} "
            f"({', '.join(str(row[0]) for row in live)}) — resolve which is the real "
            "account and pass --attested-by explicitly"
        )
    return live[0][0]


async def _resolve_reviewer_by_email(email: str) -> uuid.UUID:
    """The live ``users`` row for an email, by the only signal that says which.

    **D70.2, as code rather than as a runbook paragraph.** The WorkOS
    environment switch minted a second row per account, and the reattachment put
    the live WorkOS id back on the *original* row while renaming the
    duplicate's to ``retired-workos-env:<ts>:<original>``. So two rows can carry
    one email and the live one is the **older** — the opposite of the natural
    "most recently created wins" tiebreak.

    That matters because ``attest-bootstrap`` grants the account it is handed
    ADMIN on the catalog workspace: picking wrong is a real grant on a dead row,
    and nothing in the schema signals which is which. Until now the rule lived
    only in prose, where an operator had to read it, believe it, and hand-copy a
    UUID out of an ad-hoc query against production.

    Ambiguity **refuses** rather than guessing. Two live rows for one email is a
    state nobody has decided how to resolve, and choosing one silently is how a
    grant lands somewhere nobody looked. ``--attested-by`` stays available for
    exactly that case.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            rows = (
                await session.execute(
                    select(orm.User.id, orm.User.workos_user_id).where(orm.User.email == email)
                )
            ).all()
    finally:
        await engine.dispose()

    reviewer = pick_live_reviewer(email, [(row.id, row.workos_user_id) for row in rows])
    print(f"reviewer: {reviewer} (resolved from {email})")
    return reviewer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=(
            "provision",
            "bootstrap-import",
            "attest-bootstrap",
            "publish-bootstrap",
            "sync-bootstrap",
        ),
    )
    parser.add_argument(
        "--attested-by",
        type=uuid.UUID,
        help="user id of the human reviewer making/holding the attestation "
        "(required by attest-bootstrap, publish-bootstrap and sync-bootstrap)",
    )
    parser.add_argument(
        "--attested-by-email",
        help="resolve the reviewer from a user email instead of pasting a UUID. "
        "Refuses if the email is ambiguous; see _resolve_reviewer_by_email (D70.2)",
    )
    args = parser.parse_args()
    if args.attested_by and args.attested_by_email:
        parser.error("pass --attested-by or --attested-by-email, not both")
    if args.command in _NEEDS_REVIEWER and not (args.attested_by or args.attested_by_email):
        parser.error(f"{args.command} requires --attested-by or --attested-by-email")
    if args.command == "provision":
        asyncio.run(_provision())
        return
    if args.command == "bootstrap-import":
        asyncio.run(_bootstrap_import())
        return

    # Resolved once, before any of the three reviewer commands run. Doing it
    # inside each would make `sync-bootstrap` import 283 records and only then
    # discover it cannot name a reviewer — leaving the corpus staged, which is
    # the half-done state `_sync_bootstrap` exists to prevent.
    async def _run() -> None:
        reviewer = (
            args.attested_by
            if args.attested_by
            else await _resolve_reviewer_by_email(args.attested_by_email)
        )
        if args.command == "attest-bootstrap":
            await _attest_bootstrap(reviewer)
        elif args.command == "publish-bootstrap":
            await _publish_bootstrap(reviewer)
        else:
            await _sync_bootstrap(reviewer)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
