"""Open Badges 2.0 hosted assertion for a claimed course certificate.

Spec: https://www.imsglobal.org/sites/default/files/Badges/OBv2p0Final/index.html
(the compact, non-expanded property names; `verification.type: "hosted"`).

A plain dict, not a `majorana_contracts` model — see `majorana_contracts.
certificates`'s module docstring for why: this vocabulary is IMS Global's, not
ours, and it is built the same way `leona_notebooks.courses.export_course_zip`
builds a zip rather than a contracts type.

## What is deliberately NOT here

- **No signature.** `verification.type` is `"hosted"`, never `"signed"` — the
  brief this ships against excludes signed OB 3.0 credentials explicitly, and
  a `"hosted"` assertion's whole trust model is "fetch this URL and see it is
  still there", which `GET /v1/certificates/{id}` is.
- **No hashing.** `PublicCertificateRow.recipient_identity`/`recipient_salt`
  arrive already computed — `repos.certificates.public_assertion_row` is
  where the learner's email is read, and this module never sees it, hashed or
  not.
- **`badge.id` and `issuer.id` are identifier IRIs, not separately fetchable
  endpoints.** Both are embedded here as complete documents rather than
  references a verifier would dereference, which the spec allows (`badge` and
  `issuer` may each be "an IRI or a BadgeClass/Profile document"). A verifier
  that insists on dereferencing them would get a 404; one that reads what this
  assertion already embeds gets everything it needs in one fetch.
"""

from __future__ import annotations

from typing import Any

from .repos.certificates import PublicCertificateRow

#: Printed in `badge.issuer.name` and nowhere else configurable — Leona
#: Quantum is the one issuer this deployment ever mints a certificate as.
ISSUER_NAME = "Leona Quantum"


def build_assertion(row: PublicCertificateRow, *, web_origin: str) -> dict[str, Any]:
    """The hosted assertion for `row`."""
    origin = web_origin.rstrip("/")
    certificate_url = f"{origin}/api/certificates/{row.id}"
    badge_url = f"{certificate_url}/badge"
    issuer_url = f"{origin}/certificates/issuer"
    assertion: dict[str, Any] = {
        "@context": "https://w3id.org/openbadges/v2",
        "id": certificate_url,
        "type": "Assertion",
        "recipient": {
            "type": "email",
            "hashed": True,
            "salt": row.recipient_salt,
            "identity": row.recipient_identity,
        },
        "badge": {
            "id": badge_url,
            "type": "BadgeClass",
            "name": row.course_title,
            "description": (
                f"Completed every graded exercise in “{row.course_title}” on Leona Quantum."
            ),
            "image": f"{origin}/certificate-badge.svg",
            "criteria": {
                "narrative": (f"Passed every graded exercise in the course “{row.course_title}”.")
            },
            "issuer": {
                "id": issuer_url,
                "type": "Issuer",
                "name": ISSUER_NAME,
                "url": origin,
            },
        },
        "issuedOn": row.issued_at.isoformat(),
        "verification": {"type": "hosted"},
        # Not a spec field — a namespaced extension (OBv2.0's own convention
        # for vendor additions) so a reader cannot mistake it for `recipient`,
        # which per spec is the HASHED identity, never a display name.
        "extensions:recipientName": row.recipient_name,
        "revoked": row.revoked_at is not None,
    }
    if row.revoked_at is not None:
        assertion["revocationReason"] = "Revoked by the learner or the course's creator."
    return assertion
