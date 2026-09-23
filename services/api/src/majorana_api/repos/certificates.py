"""Course completion certificates (ai-ops 349 proposal 8, certificates slice).

`course_certificates` resolves its tenant through `courses` for every AUTHENTICATED
operation here, exactly as `course_modules`/`course_cohorts` do. The one exception is
`public_assertion`, which is not authenticated at all — see its own docstring, and
migration 0074's, for the row-level-security escape valve that backs it.

This module depends on `repos.courses` (`get_course`, `course_gradebook`); `repos.courses`
does not import this module back, the same one-directional shape `repos/cohorts.py`
keeps with it.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass

import majorana_contracts as contracts
from majorana_contracts import Scope
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import CourseCertificate as CourseCertificateRow, User
from ._base import AuthzError, NotFoundError, is_unique_violation, require_write, touched_now
from .audit import record_audit
from .courses import course_gradebook, get_course

#: The GUC `migration 0074`'s `public_certificate_read` policy checks — set only
#: by `public_assertion`, immediately before the one SELECT that needs it, the
#: same shape `repos/news.py`'s `leona.news_workspace_id` uses for its own
#: anonymous read path.
_PUBLIC_CERTIFICATE_GUC = "leona.public_certificate_id"

#: The unique index a second concurrent claim for the same member collides on
#: (`uq_course_certificates_course_member`, migration 0074).
_MEMBER_INDEX = "uq_course_certificates_course_member"


def _certificate_salt(certificate_id: uuid.UUID) -> str:
    """A per-certificate salt for the OBv2.0 hashed `recipient`, derived rather
    than stored: it only has to differ per assertion — the same email must not
    hash identically across two different badges, which would let one
    certificate be used to test whether a given email holds another — and the
    certificate's own id already varies per row. HMAC rather than a bare
    concatenation so the salt cannot be turned back into the id by anyone who
    did not already know it."""
    return hmac.new(
        b"leona-certificate-salt", str(certificate_id).encode("utf-8"), "sha256"
    ).hexdigest()


def _recipient_identity_hash(*, email: str, salt: str) -> str:
    """The OBv2.0 hashed-identity string: `"sha256$" + hex(sha256(salt + value))`,
    exactly the form the spec gives for a hashed `email` identity. Computed
    HERE, where `email` is read off `User` for this one query, so the plaintext
    never leaves this function — `public_assertion_row` returns the hash, not
    the address it was made from."""
    digest = hashlib.sha256((salt + email).encode("utf-8")).hexdigest()
    return f"sha256${digest}"


@dataclass(frozen=True)
class PublicCertificateRow:
    """Exactly what `public_assertion_row` may return — a named, closed set of
    fields rather than the ORM row, so a future column added to the table
    cannot reach the public route just by existing. No email, no score, no
    workspace id: `recipient_identity`/`recipient_salt` are the OBv2.0 hashed
    form the learner's email was turned into in `public_assertion_row`, and
    the plaintext itself is never carried past that function."""

    id: uuid.UUID
    recipient_name: str
    recipient_identity: str
    recipient_salt: str
    issued_at: object
    revoked_at: object | None
    course_title: str


def new_certificate_id() -> uuid.UUID:
    """128 bits from the OS CSPRNG, laid into a UUID column with no version or
    variant bits forced.

    Deliberately NOT `ids.uuid7()`: this id is handed back as the public
    credential itself (`GET /v1/certificates/{id}`, no auth — 05-security.md
    §1a's "new anonymous route"), and `uuid7()`'s 74 bits of randomness after
    its sortable, TIME-DERIVED prefix is the wrong shape for a value that
    anyone holding it can use to read the row. See migration 0074's docstring.
    """
    return uuid.UUID(bytes=secrets.token_bytes(16))


class NotEligible(Exception):
    """Not every graded exercise in this course has been passed yet."""


class CertificateRevokeForbidden(AuthzError):
    """Neither the certificate's own learner nor the course's creator asked."""


def _public_path(certificate_id: uuid.UUID) -> str:
    return f"/certificates/{certificate_id}"


def to_resource(row: CourseCertificateRow) -> contracts.CourseCertificate:
    return contracts.CourseCertificate(
        id=row.id,
        course_id=row.course_id,
        user_id=row.user_id,
        recipient_name=row.recipient_name,
        issued_at=row.issued_at,
        revoked_at=row.revoked_at,
        revoked_by_user_id=row.revoked_by_user_id,
        public_url_path=_public_path(row.id),
    )


async def is_eligible(scope: Scope, session: AsyncSession, course_id: uuid.UUID) -> bool:
    """Whether the CALLER — always themselves; there is no "check eligibility
    for someone else" — has passed every graded exercise in this course.

    Built entirely on `courses.course_gradebook`'s own numbers rather than a
    second pass over `run_events`, so a certificate's eligibility can never
    disagree with the row the gradebook already shows this same learner.

    `course_gradebook` returns every member's row when the caller is the
    course's CREATOR (`GradebookVisibility.ALL_MEMBERS`) — a teacher may also
    be enrolled in their own course — so this picks the row matching
    `scope.user_id` explicitly rather than assuming it is first; `book.rows`
    is sorted by name, not by who asked.

    **The rule.** Every module of the course must have a READY notebook
    (`GradebookModule.graded_cells is not None` — a module still `planned` or
    `generating` cannot have been passed, because there is nothing yet to
    attempt). Of those, every module that has at least one graded exercise
    must show a NON-STALE entry with every cell passed
    (`entry.passed == entry.graded_cells`, and `not entry.stale` so a since-
    revised notebook cannot be satisfied by an attempt against an old version).
    A module with zero graded cells — a pure lesson — needs no entry: there is
    nothing in it to pass or fail.

    An empty course (no modules at all) is never eligible; there is no
    "every graded exercise" to have passed.
    """
    book = await course_gradebook(scope, session, course_id)
    if not book.modules:
        return False
    row = next((r for r in book.rows if r.user_id == scope.user_id), None)
    if row is None:
        return False
    ready = [module for module in book.modules if module.graded_cells is not None]
    if len(ready) < len(book.modules):
        return False
    entries = {entry.module_id: entry for entry in row.entries}
    for module in ready:
        if module.graded_cells == 0:
            continue
        entry = entries.get(module.id)
        if entry is None or entry.stale or entry.passed < entry.graded_cells:
            return False
    return True


async def claim_certificate(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, *, recipient_name: str | None
) -> CourseCertificateRow:
    """Get-or-create, for the CALLER'S own membership only.

    Claiming again returns the existing row, at the name it was first claimed
    under, regardless of whether this member is still eligible today (a later
    notebook revision, or a re-attempt that regressed, does not retract a
    certificate already issued — only an explicit revoke does that). Reading
    back an already-claimed certificate needs no write access; MINTING one
    does, so `require_write` gates only the creation branch.
    """
    course = await get_course(scope, session, course_id)
    existing = (
        await session.execute(
            select(CourseCertificateRow).where(
                CourseCertificateRow.course_id == course.id,
                CourseCertificateRow.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    require_write(scope)
    if not await is_eligible(scope, session, course_id):
        raise NotEligible("not every graded exercise in this course has been passed yet")

    name = (recipient_name or "").strip()
    if not name:
        user = await session.get(User, scope.user_id)
        name = ((user.display_name or "").strip() or user.email) if user is not None else ""
    row = CourseCertificateRow(
        id=new_certificate_id(),
        course_id=course.id,
        user_id=scope.user_id,
        recipient_name=name,
        course_title=course.title,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        if not is_unique_violation(exc, _MEMBER_INDEX):
            raise
        # A second concurrent claim (a double-clicked button) beat this one to
        # the insert. Re-read rather than fail: the caller asked to claim their
        # certificate, and by the time this line runs, they have one.
        await session.rollback()
        existing = (
            await session.execute(
                select(CourseCertificateRow).where(
                    CourseCertificateRow.course_id == course.id,
                    CourseCertificateRow.user_id == scope.user_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return existing
    await record_audit(
        scope,
        session,
        action="course_certificate.claimed",
        target_kind="course_certificate",
        target_id=row.id,
    )
    await session.refresh(row)
    return row


async def list_certificates(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID
) -> contracts.CourseCertificateList:
    """Every certificate the caller may see: the creator gets every one issued
    for this course (so they can find one to revoke); anyone else gets only
    their own — 0 or 1 item, a member can hold at most one certificate per
    course (`uq_course_certificates_course_member`)."""
    course = await get_course(scope, session, course_id)
    stmt = select(CourseCertificateRow).where(CourseCertificateRow.course_id == course.id)
    if scope.user_id != course.owner_user_id:
        stmt = stmt.where(CourseCertificateRow.user_id == scope.user_id)
    rows = (await session.execute(stmt.order_by(CourseCertificateRow.issued_at))).scalars().all()
    return contracts.CourseCertificateList(
        course_id=course.id, items=[to_resource(row) for row in rows]
    )


async def revoke_certificate(
    scope: Scope, session: AsyncSession, course_id: uuid.UUID, certificate_id: uuid.UUID
) -> None:
    """Revoke, never delete: the row stays so the public page can say
    "revoked" instead of 404ing, and so the audit trail (who revoked what,
    when) survives. Idempotent — revoking an already-revoked certificate
    changes nothing and raises nothing."""
    require_write(scope)
    course = await get_course(scope, session, course_id)
    row = (
        await session.execute(
            select(CourseCertificateRow).where(
                CourseCertificateRow.id == certificate_id,
                CourseCertificateRow.course_id == course.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("course certificate")
    if scope.user_id not in (row.user_id, course.owner_user_id):
        raise CertificateRevokeForbidden("only the learner or the course creator may revoke this")
    if row.revoked_at is None:
        now = touched_now()
        row.revoked_at = now
        row.revoked_by_user_id = scope.user_id
        row.updated_at = now
        await record_audit(
            scope,
            session,
            action="course_certificate.revoked",
            target_kind="course_certificate",
            target_id=row.id,
        )
        await session.flush()


async def public_assertion_row(
    session: AsyncSession, certificate_id: uuid.UUID
) -> PublicCertificateRow | None:
    """The public, anonymous read (05-security.md §1a). No `Scope`: there is
    none to have — this is reached with no credential at all, by the
    unguessable id itself.

    Deliberately a NAMED COLUMN LIST, never `select(CourseCertificateRow)` —
    a future column added to the table (say, an internal note) must be added
    here on purpose before it can leak through this route. What is read:
    the id (to prove it matches what was asked for), the recipient's CHOSEN
    name, the snapshotted course title, the issue date, the revocation state,
    and — from `users`, which carries no RLS policy at all (it is global, not
    tenant-scoped) — the email, used only to compute the hashed identity below
    and never returned itself.

    Joined to `users` and NOTHING ELSE: `course_certificates.course_title` is
    a snapshot for exactly this reason (see migration 0074's docstring) — a
    join out to `courses` here would need `courses`' own RLS policy to carry a
    matching escape valve, which it does not, and would silently return no
    course under enforcement (off in every deployed environment today, but
    this route should not depend on that staying true to work correctly).

    Sets `leona.public_certificate_id` immediately before the one query that
    needs it — migration 0074's `public_certificate_read` policy is the only
    thing that GUC unlocks, and only for a `SELECT`.
    """
    await session.execute(
        text(f"select set_config('{_PUBLIC_CERTIFICATE_GUC}', :id, true)"),
        {"id": str(certificate_id)},
    )
    row = (
        await session.execute(
            select(
                CourseCertificateRow.id,
                CourseCertificateRow.recipient_name,
                CourseCertificateRow.course_title,
                CourseCertificateRow.issued_at,
                CourseCertificateRow.revoked_at,
                User.email,
            )
            .join(User, User.id == CourseCertificateRow.user_id)
            .where(CourseCertificateRow.id == certificate_id)
        )
    ).one_or_none()
    if row is None:
        return None
    certificate_id_, recipient_name, course_title, issued_at, revoked_at, email = row
    salt = _certificate_salt(certificate_id_)
    return PublicCertificateRow(
        id=certificate_id_,
        recipient_name=recipient_name,
        recipient_identity=_recipient_identity_hash(email=email, salt=salt),
        recipient_salt=salt,
        issued_at=issued_at,
        revoked_at=revoked_at,
        course_title=course_title,
    )
