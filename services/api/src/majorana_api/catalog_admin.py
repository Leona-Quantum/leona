"""Operator-only provisioning + bootstrap import for the system catalog authority."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from majorana_contracts import Scope
from majorana_contracts.enums import ImportJobStatus, Role

from .catalog_attestation import AttestationPolicy, AttestedRecord
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


@dataclass(frozen=True)
class ReAttestationPlan:
    """What an attest run will do to each record, decided before anything is written.

    Four dispositions, each an identity list rather than a count, because every
    one of them is a question a later reader asks as "which records?" and a
    number sends them back to the manifest to work it out.

    `re_signed` and `needs_signature` are the two halves of the same population —
    records whose provenance claim moved. The operator's `--re-attest` list is
    what moves an identity from the second to the first, and nothing else does.
    """

    first_signature: tuple[str, ...]
    carried_forward: tuple[str, ...]
    re_signed: tuple[str, ...]
    needs_signature: tuple[str, ...]


def parse_re_attest(raw: str | None) -> frozenset[str] | None:
    """The identities an operator deliberately re-signed, or None if they passed no flag.

    None and the empty set are deliberately different answers. Not passing the
    flag is the normal run; passing `--re-attest ""` is an operator who believes
    they authorised something and did not, and a run that quietly treated the two
    the same would print "0 re-signed" under a command line that says otherwise.

    A repeated identity refuses rather than being deduplicated silently. The list
    is a hand-assembled decision record, and a repeat is the signature of one
    assembled from two sources — where the second source is exactly the stale
    list `plan_re_attestation` exists to catch, one level up.
    """
    if raw is None:
        return None
    parts = [part.strip() for part in raw.split(",")]
    if not any(parts):
        raise SystemExit("--re-attest was given no identities; omit the flag instead")
    if not all(parts):
        raise SystemExit(f"--re-attest has an empty identity in {raw!r}")
    seen: set[str] = set()
    for part in parts:
        if part in seen:
            raise SystemExit(f"--re-attest names {part!r} more than once")
        seen.add(part)
    return frozenset(seen)


def plan_re_attestation(
    records: Sequence[AttestedRecord],
    previous_claims: Mapping[str, str | None],
    requested: frozenset[str] | None,
) -> ReAttestationPlan:
    """Classify every record, and reconcile the operator's list against the refusals.

    Separated from the writes so the **rule** is testable without a database —
    same argument as `pick_live_reviewer`, and the same stakes: this rule is what
    stands between "a human looked at a record whose stated origin moved" and "a
    flag waved 283 records through".

    Why `--re-attest` names identities instead of being `--force`: the guard at
    `AttestedRecord.grant_carries_forward` exists so a person examines each record
    whose provenance claim changed. A blanket override deletes the guard while
    leaving it in the source, which is worse than not having it — the code still
    reads as if someone is checking.

    So the named set must equal the refused set **in both directions**:

    - named but not refused — the operator is working from a list written against
      an earlier state. Whatever they looked at is not what this run is doing.
    - refused but not named — a refusal appeared after the list was written, and
      letting the run continue would attest it on the strength of a decision made
      about other records. This is the direction a `--force` cannot express at
      all, and it is the one that actually protects the corpus.

    Either way nothing is written: the reconciliation runs before the first
    attestation rather than as the loop discovers refusals, so a disagreement
    cannot leave a half-attested corpus behind.

    With no flag (`requested is None`) every changed claim lands in
    `needs_signature` and the caller fails closed exactly as it did before — the
    283-record production run that motivated this stays byte-identical when the
    flag is absent.
    """
    first: list[str] = []
    carried: list[str] = []
    changed: list[str] = []
    for record in records:
        identity = record.upstream_identity
        previous = previous_claims[identity]
        if previous is None:
            first.append(identity)
        elif record.grant_carries_forward(previous):
            carried.append(identity)
        else:
            changed.append(identity)

    if requested is None:
        return ReAttestationPlan(
            first_signature=tuple(sorted(first)),
            carried_forward=tuple(sorted(carried)),
            re_signed=(),
            needs_signature=tuple(sorted(changed)),
        )

    known = {record.upstream_identity for record in records}
    refused = set(changed)
    # A typo and a stale list are both "named but not refused", and the operator's
    # fix differs — one is a re-type, the other is a re-read of the diff. Split so
    # the message says which.
    unknown = sorted(requested - known)
    not_refused = sorted((requested & known) - refused)
    unnamed = sorted(refused - requested)
    if unknown or not_refused or unnamed:
        lines = ["--re-attest does not match what this run refused; nothing was attested."]
        if unknown:
            lines += ["  named but not in the corpus (typo?):", *(f"    {i}" for i in unknown)]
        if not_refused:
            # The most common way to land here is success: a re-attest run that
            # worked leaves nothing refused, so repeating the identical command
            # is now a stale list. Said out loud, because "these claims did not
            # move" alone reads as a bug on the second run of a working command.
            lines += [
                "  named but not refused — these records' claims did not move (or a "
                "previous run already re-signed them, in which case drop the flag):",
                *(f"    {i}" for i in not_refused),
            ]
        if unnamed:
            lines += [
                "  refused but not named — these appeared after the list was written "
                "and would ride through on a decision made about other records:",
                *(f"    {i}" for i in unnamed),
            ]
        # Listed one per line rather than as a ready-to-paste comma string on
        # purpose. The identities have to be here — an operator cannot act on a
        # count — but handing back the exact argument makes "paste and re-run" the
        # cheapest path, and the whole flag exists to buy a look at each record.
        raise SystemExit("\n".join(lines))

    return ReAttestationPlan(
        first_signature=tuple(sorted(first)),
        carried_forward=tuple(sorted(carried)),
        re_signed=tuple(sorted(refused)),
        needs_signature=(),
    )


async def _attest_bootstrap(
    attested_by: uuid.UUID, re_attest: frozenset[str] | None = None
) -> None:
    """Bind provenance + the owner's approved license onto the staged corpus.

    Records the owner's committed attestation (catalog_bootstrap/
    attestation-policy.json) against each covered record: a provenance row, a
    declared license carrying the policy's SPDX id, an approved reviewer
    decision, and review acceptance — the four bindings publication requires.
    The importer and the named reviewer stay distinct principals throughout.

    Nothing is published here. Idempotent: re-running only fills gaps.

    `re_attest` carries the operator's deliberate re-signature of records whose
    provenance claim moved (`--re-attest`); see `plan_re_attestation` for why it
    names identities rather than being a `--force`.
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

        # Read every prior claim BEFORE writing anything. Owner decision B: a
        # prior human grant binds to a record's new version when the provenance
        # claim is unchanged, and refuses when it changed. A refusal is not a
        # failure to be retried — it is the case that needs a person.
        #
        # Deciding the whole corpus up front is what makes `--re-attest`'s
        # both-directions rule enforceable. Classifying inside the write loop
        # would attest records 1..k and only then discover an unnamed refusal at
        # k+1 — so the "refused but not named" half of the rule would fire after
        # the ride-through it exists to prevent had already been committed. Same
        # number of queries either way; only the ordering changes.
        previous_claims: dict[str, str | None] = {}
        for record in plan.included:
            async with factory() as session:
                previous_claims[record.upstream_identity] = await catalog.latest_license_claim_hash(
                    importer_scope,
                    session,
                    targets[record.upstream_identity],
                    authority=authority,
                )
        decision = plan_re_attestation(plan.included, previous_claims, re_attest)
        carried_forward = set(decision.carried_forward)
        re_signed = set(decision.re_signed)
        refused = decision.needs_signature
        skip = set(refused)

        touched = 0
        for record in plan.included:
            identity = record.upstream_identity
            # The override is exactly this: a re-signed identity is not in
            # `refused`, so it is not skipped. It then attests with
            # `record.claim_hash` — the NEW claim — down the same path as every
            # other record, so the assertion it lands states what the record
            # claims *now*. Nothing inherits the old grant's hash, which is the
            # whole difference between a re-signature and a rubber stamp.
            if identity in skip:
                continue
            artifact_id = targets[identity]
            previous_claim = previous_claims[identity]

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
                        "grant_carried_forward": identity in carried_forward,
                        # The field that tells a future reader "a human looked at
                        # this record's moved claim and signed it again" apart
                        # from "the hash matched and nobody was asked".
                        #
                        # In principle derivable — carried_forward False beside a
                        # non-null previous_claim_hash can only mean a
                        # re-signature — but only for a reader who knows that
                        # combination was *impossible* before this flag existed,
                        # because the run exited instead. Stated rather than
                        # inferable-from-the-release-date.
                        "re_signed_after_claim_change": identity in re_signed,
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
                    "carried_forward_count": len(carried_forward),
                    "excluded": {r.upstream_identity: r.reason for r in plan.excluded},
                    # Named, not counted: "3 records were refused" sends whoever
                    # reads this back to the import to work out which three.
                    "refused_provenance_claim_changed": list(refused),  # sorted by the planner
                    # The corpus-level half of the per-record
                    # `re_signed_after_claim_change`. Keyed by identity to the
                    # claim hash the grant moved *from*, mirroring `excluded`'s
                    # {identity: reason} — so this one row answers "which records
                    # did a human re-sign, and what was signed before" without a
                    # join back to the per-record audit rows.
                    "re_signed_after_claim_change": {
                        identity: previous_claims[identity] for identity in decision.re_signed
                    },
                },
            )
            await session.commit()

        print(
            f"bulk attestation complete: spdx={policy.spdx_id} "
            f"attested={len(plan.included) - len(refused)} changed_this_run={touched} "
            f"carried_forward={len(carried_forward)} re_signed={len(re_signed)} "
            f"needs_signature={len(refused)} "
            f"excluded={len(plan.excluded)} policy={policy.checksum[:12]}"
        )
        for excluded in plan.excluded:
            print(f"  excluded {excluded.upstream_identity}: {excluded.reason}")
        # Unsliced, unlike the refusal list below: a re-signature is a human act
        # this run performed, and truncating the record of what someone signed to
        # "and 4 more" is the one list nobody may have to reconstruct.
        for identity in decision.re_signed:
            print(f"  re-signed after a provenance claim change (--re-attest): {identity}")
        for identity in refused[:20]:
            print(f"  needs a fresh signature (provenance claim changed): {identity}")
        if refused:
            # Fail-closed. These records keep their previous version live and
            # their new version unattested, which is the correct end state for a
            # record whose stated origin moved: it must not reach a visitor under
            # a grant made about something else.
            raise SystemExit(
                f"{len(refused)} records changed their provenance claim and cannot "
                "inherit the existing grant. Look at what moved in each, then re-run "
                "naming exactly those identities: --re-attest <identity>,<identity>,…"
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


async def _sync_bootstrap(attested_by: uuid.UUID, re_attest: frozenset[str] | None = None) -> None:
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

    `re_attest` passes straight through to the attest step. It matters most here:
    a refusal in the middle of *this* command is exactly the state that leaves the
    corpus staged-but-unpublished, which is the gap the command exists to close.
    """
    await _bootstrap_import()
    await _attest_bootstrap(attested_by, re_attest)
    await _publish_bootstrap(attested_by)


_NEEDS_REVIEWER = {"attest-bootstrap", "publish-bootstrap", "sync-bootstrap"}

# The two commands that attest. `publish-bootstrap` re-evaluates readiness and
# never signs anything, so accepting --re-attest there would take a list of
# identities the operator had examined and do nothing with it — a flag that reads
# as a decision and is not one.
_ACCEPTS_RE_ATTEST = {"attest-bootstrap", "sync-bootstrap"}

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


def pick_standing_reviewer(
    rows: Sequence[tuple[uuid.UUID, Role, str]],
    *,
    service_ids: frozenset[uuid.UUID],
    signed: Mapping[uuid.UUID, int] | None = None,
) -> uuid.UUID:
    """Which account already holds the catalog reviewer grant.

    This is the rule that lets an **unattended** run attest — the deploy
    pipeline has no operator to type a UUID or an email, and inventing a
    principal for it to attest as would be a new grant made by nobody.

    So it does not name an account: it *continues* one. The only accounts it can
    return are those a human already granted ADMIN on the catalog workspace by
    running `attest-bootstrap` explicitly (`catalog.grant_catalog_reviewer` is
    the sole path to that role). An automated run therefore cannot widen who
    holds the grant, only re-use it — which is why this is safe to reach from CI
    and `--attested-by <arbitrary uuid>` is not.

    Provisioning writes the importer as OWNER and the public reader as VIEWER,
    so ADMIN already excludes them. `service_ids` re-excludes them anyway: that
    separation is an invariant of `ensure_system_catalog_authority` and
    `grant_catalog_reviewer`, and a rule that grants ADMIN should not depend on
    a *different* function's invariant holding. If one of them ever did hold
    ADMIN, the honest outcome is this refusing to find a reviewer, not this
    attesting as the importer.

    Retired rows are excluded for the reason `pick_live_reviewer` excludes them:
    the WorkOS environment switch minted a second `users` row per account, so an
    attestation run done before the reattachment and one done after can have
    granted ADMIN to *both* rows of one person. That is the likeliest way this
    workspace ever carries two reviewer grants, and it is not a real ambiguity —
    one of the two is an account nobody can sign in to. Attesting as it would
    succeed and reach no one.

    A genuine ambiguity — two live accounts — still refuses, same as
    `pick_live_reviewer` and for the same reason: two humans holding the grant is
    a state nobody has decided between, and an unattended run picking one
    silently is how an attestation lands under a name that never looked at it.
    """
    candidates = sorted(
        {
            user_id
            for user_id, role, workos_user_id in rows
            if role == Role.ADMIN
            and user_id not in service_ids
            and not workos_user_id.startswith(_RETIRED_WORKOS_PREFIX)
        }
    )
    if not candidates:
        raise SystemExit(
            "no human account holds the catalog reviewer grant on this workspace, so "
            "there is no standing attestation to continue. Run the first attestation "
            "explicitly — `--attested-by-email <you>` — and this flag works from then on."
        )
    if len(candidates) == 1:
        return candidates[0]

    # More than one grant. Before refusing, ask the stronger question: not who
    # *may* review, but who actually *has*.
    #
    # **This is not a tiebreak invented to get past a refusal — it narrows the
    # candidate set, it never widens it.** A membership says an account holds the
    # permission; `license_assertions.reviewer_user_id` says an account used it.
    # The flag is called `--attested-by-standing` because it continues a standing
    # attestation, and an attestation lives on those rows, not on a membership
    # nobody ever exercised. An ADMIN grant with no signatures is a permission
    # somebody was given and never used, and continuing it would be starting a
    # new line of attestation rather than continuing an existing one.
    #
    # Found in production on this rule's first run: two live accounts held ADMIN
    # on the catalog workspace, neither marked retired, so the duplicate-row
    # exclusion above could not resolve it and the sync parked. If exactly one of
    # them signed the corpus, that account is the answer and always was.
    signatures = signed or {}
    signatories = [user_id for user_id in candidates if signatures.get(user_id, 0) > 0]
    if len(signatories) == 1:
        return signatories[0]

    detail = ", ".join(f"{user_id} ({signatures.get(user_id, 0)} signed)" for user_id in candidates)
    raise SystemExit(
        f"{len(candidates)} accounts hold the catalog reviewer grant ({detail}) and "
        f"{len(signatories)} of them have signed — an unattended run will not choose "
        "between them. Pass --attested-by explicitly."
    )


async def _resolve_standing_reviewer(authority: CatalogAuthority) -> uuid.UUID:
    """The account already holding the grant, read from the workspace itself.

    Deliberately configuration-free. The alternative was a repository variable
    holding the owner's UUID or email, which is one more place for a production
    identity to be stated, to go stale, and to be wrong in a way nothing checks.
    The workspace already knows who the reviewer is; asking it cannot disagree
    with the database the attestation is about to be written to.
    """
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            rows = await system.list_catalog_reviewer_grants(
                session, workspace_id=authority.workspace_id
            )
            # Read in the same session as the grants, so the two answers are
            # about one state of the database rather than two.
            signed = await system.count_catalog_assertions_by_reviewer(
                session, workspace_id=authority.workspace_id
            )
    finally:
        await engine.dispose()

    service_ids = frozenset(
        user_id
        for user_id in (authority.importer_user_id, authority.public_reader_user_id)
        if user_id is not None
    )
    reviewer = pick_standing_reviewer(rows, service_ids=service_ids, signed=signed)
    print(f"reviewer: {reviewer} (standing catalog grant, --attested-by-standing)")
    return reviewer


async def _report_reviewers() -> None:
    """Print who holds the catalog reviewer grant, and what each has signed.

    **Read-only. Writes nothing, attests nothing, and never fails a deploy.**

    It exists because the refusal above hands its reader two bare UUIDs and no
    way to tell them apart. The evidence that separates them is in the database
    the reader is specifically told not to reach from a laptop
    (`docs/runbooks/database.md`), so "decide which of these is the real
    reviewer" was an owner action with no supported way to gather the facts.
    This makes the deploy that reports the problem also report the answer.

    Deliberately prints no email addresses. This runs in CI and its stdout is
    retained, and the decision does not need one: which account signed the
    corpus is the fact, and a UUID is what the operator passes back.
    """
    authority = CatalogAuthority.from_env()
    authority.require_configured()
    service_ids = {authority.importer_user_id, authority.public_reader_user_id}

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            rows = await system.list_catalog_reviewer_grants(
                session, workspace_id=authority.workspace_id
            )
            signed = await system.count_catalog_assertions_by_reviewer(
                session, workspace_id=authority.workspace_id
            )
    finally:
        await engine.dispose()

    admins = [(user_id, workos) for user_id, role, workos in rows if role == Role.ADMIN]
    print(f"catalog reviewer grants: {len(admins)} ADMIN membership(s)")
    for user_id, workos in sorted(admins, key=lambda row: str(row[0])):
        marks = []
        if user_id in service_ids:
            marks.append("SERVICE IDENTITY — never eligible")
        if workos.startswith(_RETIRED_WORKOS_PREFIX):
            marks.append("RETIRED workos id — cannot sign in")
        note = f"  [{'; '.join(marks)}]" if marks else ""
        print(f"  {user_id}  signed={signed.get(user_id, 0)}{note}")
    print(
        "The account with signatures is the standing reviewer "
        "(license_assertions.reviewer_user_id). One eligible signatory means "
        "--attested-by-standing can resolve this on its own."
    )


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
            rows = await system.list_users_by_email(session, email)
    finally:
        await engine.dispose()

    reviewer = pick_live_reviewer(email, rows)
    # The email is deliberately NOT echoed. This runs as a Cloud Run job and its
    # stdout is retained in Cloud Logging, so printing it would write a personal
    # address into log storage on every re-import — for no gain, since the
    # operator just typed it. The UUID is what they need back to check the pick.
    print(f"reviewer: {reviewer} (resolved from --attested-by-email)")
    return reviewer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=(
            "provision",
            "reviewers",
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
    parser.add_argument(
        "--attested-by-standing",
        action="store_true",
        help="continue the attestation grant this catalog workspace already holds, instead "
        "of naming a reviewer. Refuses if no account holds it, or if more than one does. "
        "This is the form the deploy pipeline uses, because it cannot widen who holds the "
        "grant — see pick_standing_reviewer",
    )
    parser.add_argument(
        "--re-attest",
        metavar="IDENTITY,IDENTITY,…",
        help="upstream identities whose provenance claim changed and which you have "
        "looked at and are deliberately re-signing. NOT a --force: the named set must "
        "equal the refused set exactly, in both directions, or the run refuses without "
        "attesting anything. See plan_re_attestation",
    )
    args = parser.parse_args()
    # Three ways to name the reviewer, and they answer the same question, so
    # passing two is an operator who believes two different things about who is
    # attesting. Counted rather than checked pairwise: adding a fourth form
    # should not require remembering to add three more comparisons.
    named = [
        flag
        for flag, given in (
            ("--attested-by", bool(args.attested_by)),
            ("--attested-by-email", bool(args.attested_by_email)),
            ("--attested-by-standing", args.attested_by_standing),
        )
        if given
    ]
    if len(named) > 1:
        parser.error(f"pass exactly one of {', '.join(named)} — they name the same reviewer")
    if args.command in _NEEDS_REVIEWER and not named:
        parser.error(
            f"{args.command} requires --attested-by, --attested-by-email or --attested-by-standing"
        )
    if args.re_attest is not None and args.command not in _ACCEPTS_RE_ATTEST:
        parser.error(
            f"--re-attest applies to {' and '.join(sorted(_ACCEPTS_RE_ATTEST))}, not {args.command}"
        )
    # Parsed before anything connects to a database: a malformed list is an
    # operator typo, and discovering it after a 283-record import is the shape of
    # failure `_sync_bootstrap` and the reviewer resolution above already avoid.
    re_attest = parse_re_attest(args.re_attest)
    if args.command == "provision":
        asyncio.run(_provision())
        return
    if args.command == "bootstrap-import":
        asyncio.run(_bootstrap_import())
        return
    if args.command == "reviewers":
        asyncio.run(_report_reviewers())
        return

    # Resolved once, before any of the three reviewer commands run. Doing it
    # inside each would make `sync-bootstrap` import 283 records and only then
    # discover it cannot name a reviewer — leaving the corpus staged, which is
    # the half-done state `_sync_bootstrap` exists to prevent.
    async def _run() -> None:
        if args.attested_by:
            reviewer = args.attested_by
        elif args.attested_by_standing:
            authority = CatalogAuthority.from_env()
            authority.require_configured()
            reviewer = await _resolve_standing_reviewer(authority)
        else:
            reviewer = await _resolve_reviewer_by_email(args.attested_by_email)
        if args.command == "attest-bootstrap":
            await _attest_bootstrap(reviewer, re_attest)
        elif args.command == "publish-bootstrap":
            await _publish_bootstrap(reviewer)
        else:
            await _sync_bootstrap(reviewer, re_attest)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
