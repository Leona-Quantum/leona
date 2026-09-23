"""Course completion certificates (ai-ops 349 proposal 8, certificates slice).

Three authenticated, course-scoped routes (claim, list, revoke) plus one that
is not authenticated at all: `GET /v1/certificates/{id}`, the Open Badges 2.0
hosted assertion — 05-security.md §1a's "new anonymous route". That route's
§2 items:

- **Unguessable id, ≥128 bits.** `repos.certificates.new_certificate_id` — see
  its docstring and migration 0074's.
- **Read-only.** This route only ever selects; see `public_assertion_row`'s
  own docstring on why even that is a named column list.
- **Rate-limited with the existing limiter.** `/v1/certificates` is in
  `rate_limit.LIMITED_PATH_PREFIXES`, the same per-IP fixed-window control
  `/v1/catalog/*` and `/v1/qapps/public/*` already answer to — no new limiter,
  the one this deployment already runs in front of every other anonymous
  surface.
- **Shows only name-as-chosen, course title, issue date, issuer.** No email,
  no score, no workspace id — `certificates_badge.build_assertion` is handed
  exactly `PublicCertificateRow` and nothing wider.
- **A k6 abuse run recorded under `docs/gates/`** — NOT done here; see this
  PR's body for what that leaves unticked and why the route still ships.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

import majorana_contracts as contracts
from ..auth.deps import CurrentScope, DbSession, get_settings
from ..certificates_badge import build_assertion
from ..repos import certificates as certificates_repo
from ..request_models import RequestModel
from ..settings import Settings

router = APIRouter()


class ClaimCertificateRequest(RequestModel, contracts.ClaimCertificateRequest):
    pass


def _revoke_forbidden_detail() -> dict[str, str]:
    return {
        "error": "Only the person this certificate names, or the course's creator, can revoke it.",
        "reason": "course_certificate_revoke_forbidden",
    }


# ------------------------------------------------------------- course-scoped


@router.post(
    "/courses/{course_id}/certificates", response_model=contracts.CourseCertificate, status_code=201
)
async def claim_course_certificate(
    course_id: uuid.UUID, body: ClaimCertificateRequest, scope: CurrentScope, session: DbSession
) -> contracts.CourseCertificate:
    try:
        row = await certificates_repo.claim_certificate(
            scope, session, course_id, recipient_name=body.recipient_name
        )
    except certificates_repo.NotEligible:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "This course still has a graded exercise you have not passed yet.",
                "reason": "course_certificate_not_eligible",
            },
        ) from None
    return certificates_repo.to_resource(row)


@router.get("/courses/{course_id}/certificates", response_model=contracts.CourseCertificateList)
async def list_course_certificates(
    course_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.CourseCertificateList:
    """The creator gets every certificate issued for this course (to find one
    to revoke); anyone else gets only their own, 0 or 1 item."""
    return await certificates_repo.list_certificates(scope, session, course_id)


@router.delete("/courses/{course_id}/certificates/{certificate_id}", status_code=204)
async def revoke_course_certificate(
    course_id: uuid.UUID, certificate_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> None:
    try:
        await certificates_repo.revoke_certificate(scope, session, course_id, certificate_id)
    except certificates_repo.CertificateRevokeForbidden:
        raise HTTPException(status_code=403, detail=_revoke_forbidden_detail()) from None


# --------------------------------------------------------------------- public


@router.get("/certificates/{certificate_id}")
async def public_certificate_assertion(
    certificate_id: uuid.UUID,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> JSONResponse:
    """The Open Badges 2.0 hosted assertion, anonymous, no `Scope` — there is
    no caller to have one. `certificate_id` is the whole credential: nothing
    else identifies which row to read, and `public_assertion_row` picks it
    out of every workspace's certificates, on purpose (see its docstring)."""
    row = await certificates_repo.public_assertion_row(session, certificate_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "Certificate not found."})
    assertion = build_assertion(row, web_origin=settings.web_origin)
    # `application/json`, not `application/ld+json`: Open Badges hosted
    # assertions are read almost universally as plain JSON in practice, and a
    # strict content-type would refuse a checker that never asked for JSON-LD.
    return JSONResponse(content=assertion, media_type="application/json")
