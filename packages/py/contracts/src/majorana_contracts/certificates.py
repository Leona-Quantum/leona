"""Course completion certificates (ai-ops 349 proposal 8).

Once a member has passed every graded exercise in a course, they may claim a
certificate. `repos.certificates` defines "passed every graded exercise" and
records the claim; this module is the private, authenticated view of it —
`CourseCertificate`, scoped to the workspace the way every other course
resource is.

The PUBLIC view — the Open Badges 2.0 hosted assertion a claimed certificate is
served as at `GET /v1/certificates/{id}`, no auth — is deliberately NOT a model
here. It is a fixed external vocabulary (`@context`, `type`, `badge`, `verification`
per the OBv2.0 spec), built as a plain dict by
`majorana_api.certificates_badge.build_assertion` the same way `leona_notebooks.
courses.export_course_zip` builds a zip rather than a contracts model: this
package is for OUR cross-boundary types, and the badge's shape belongs to IMS
Global, not to us.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from .models import _ResourceBase

#: The printed name is typed once, at claim time, by the person it names.
MAX_RECIPIENT_NAME_LENGTH = 200


class CourseCertificate(_ResourceBase):
    """A claimed certificate, as its course's workspace sees it (never the
    public/anonymous view — see this module's docstring)."""

    id: UUID
    course_id: UUID
    user_id: UUID
    #: The name on the certificate, chosen at claim time. Independent of the
    #: account's display name, which may change after the certificate is
    #: printed — this field never follows it.
    recipient_name: str = Field(min_length=1, max_length=MAX_RECIPIENT_NAME_LENGTH)
    issued_at: datetime
    revoked_at: datetime | None = None
    revoked_by_user_id: UUID | None = None
    #: The anonymous, unguessable page every certificate is served at
    #: (`/certificates/{id}` on the web app; `GET /v1/certificates/{id}` for the
    #: assertion itself). Included so a claim response can show it without a
    #: second request.
    public_url_path: str


class CourseCertificateList(_ResourceBase):
    course_id: UUID
    items: list[CourseCertificate] = Field(default_factory=list)


class ClaimCertificateRequest(_ResourceBase):
    """`recipient_name` absent (or blank) means "use my account's display name
    today" — resolved server-side, at claim time, so the choice is made once
    and the certificate does not silently reprint if the name is changed
    later."""

    recipient_name: str | None = Field(default=None, max_length=MAX_RECIPIENT_NAME_LENGTH)
