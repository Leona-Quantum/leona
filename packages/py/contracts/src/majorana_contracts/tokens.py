"""Personal access tokens: the credential an outside tool holds to act as a person.

Proposal 7 Phase B (`~/Developer/ai-ops/desk/leona/plans/feature-proposals-20260920/
proposal-7-mcp-api-plan.md`), approved as feature 7 of the twelve on ai-ops 349 and
shaped by the owner's ruling on **ai-ops 362, option 1**, quoted:

    "Tokens may read and start verified runs, and expire after at most 90 days;
    hardware jobs come later under their own permission"

Three things in that sentence are load-bearing here and each has a name below:

- **read and start verified runs** — the two original scopes, and until now there was
  no third.
- **at most 90 days** — `MAX_TOKEN_LIFETIME_DAYS`, a ceiling rather than a fixed term,
  so somebody who wants a week can have a week.
- **hardware jobs come later under their own permission** — until now there was
  deliberately no `hardware` member of `TokenScope`, so hardware was refused by there
  being nothing to select rather than by a check somebody had to remember to write.

That deferral is now resolved. **ai-ops 376, option 2**, quoted in full:

    "Add a separate 'hardware' permission a person must tick when creating a token.
    With it, leona_submit in their own Jupyter or VS Code submits directly, priced
    and counted against the same weekly allowance."

`TokenScope.HARDWARE` is the "own permission" ai-ops 362 named, and it is the widening
that ruling asked a security review to be able to follow: a new member of a closed
enum, additive, with the routes it unlocks named one line away in
`auth/token_access.py`. It does not fold into `RUN`, and `RUN` does not fold into it —
see `TokenScope`'s own docstring below for why the two stay independent.

The secret itself appears in exactly one place in this module — `MintedToken.token`,
the response to the one request that creates it — and in no other model, no list, and
no error. Everything else describes a token without being able to present it.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from .models import _ResourceBase

#: The longest a token may live, from the owner's ruling on ai-ops 362. A ceiling,
#: not a term: a caller asks for the lifetime they want and anything past this is
#: refused rather than clamped, because silently handing back a shorter token than
#: was asked for is how an automation ends up expiring in the middle of a night.
MAX_TOKEN_LIFETIME_DAYS = 90

#: The most tokens one person may hold at once, unexpired and unrevoked. Not in the
#: ruling; a bound on how much a single compromised account can mint before anyone
#: notices, and high enough that nobody meets it by working normally.
MAX_TOKENS_PER_USER = 20

#: Every token starts with this. It is public by design: GitHub's secret scanning and
#: `gitleaks` both match on a distinctive prefix, so a token pasted into a commit is
#: recognisable as OUR credential rather than as forty random characters. The repo's
#: own `.gitleaks.toml` carries the matching rule.
TOKEN_PREFIX = "lq_pat_"

#: Characters of the secret kept in the clear, as a tail, so a person can tell two of
#: their own tokens apart and match one against a leak report. Four, as GitHub shows:
#: enough to identify, far too few to narrow a 256-bit search.
TOKEN_TAIL_CHARS = 4


class TokenScope(StrEnum):
    """What a token may do. Closed, and short on purpose.

    `READ` is implied by every token and is what a token with nothing else can do.
    `RUN` and `HARDWARE` are each additive on top of `READ`, and neither implies the
    other. That is enforced at the database (`ck_personal_access_tokens_scopes`) as
    well as here, because a row that reached the table another way must still be
    answerable.

    ## Why `HARDWARE` does not imply `RUN`, and `RUN` does not imply `HARDWARE`

    They are different powers over different things. `RUN` starts Leona's own
    sandboxed, verified runs — generate a notebook, ask Nala a follow-up, execute a
    Qapp — and spends the caller's weekly RUN allowance. `HARDWARE` submits an
    already-built circuit straight to a real quantum provider (`POST
    /qpu/submissions`) and spends the caller's weekly hardware allowance instead. A
    token minted to do only one of those two things is a real, narrower use case —
    the `%nala` CLI driving Leona's own pipeline should not, by that fact alone, also
    be able to spend real provider time, and a token minted only to submit
    pre-built circuits from a person's own code should not, by that fact alone, also
    be able to start arbitrary generation runs. Pricing a circuit
    (`POST /qpu/estimates`) needs neither: it is in `token_access.READ_WRITES`,
    reachable by every token regardless of scope, so a `HARDWARE`-only token can
    still price before it submits.

    There is one `hardware` scope, added ai-ops 376 option 2. See this module's
    docstring for the ruling and why it earns its own member rather than reusing
    `RUN`.
    """

    READ = "read"
    RUN = "run"
    #: Submit a circuit to real hardware, spending the caller's weekly hardware
    #: allowance — ai-ops 376 option 2. See the class and module docstrings for why
    #: it is independent of `RUN`, and `auth/token_access.py` for the one route it
    #: unlocks.
    HARDWARE = "hardware"


TokenName = Annotated[str, StringConstraints(min_length=1, max_length=80, strip_whitespace=True)]


class PersonalAccessToken(_ResourceBase):
    """One token, as its owner sees it in their account settings.

    Carries no secret and no hash — nothing here can be presented to the API. The
    tail is four characters of a 256-bit secret, which is how the person recognises
    which token a row is, and `last_used_at` is how they decide whether revoking one
    will break something.
    """

    id: UUID
    #: Shown as `lq_pat_…AbCd`. The client formats it; this is the tail alone.
    tail: str = Field(min_length=TOKEN_TAIL_CHARS, max_length=TOKEN_TAIL_CHARS)
    name: TokenName
    #: The single workspace this token acts in, fixed when it was minted. A token
    #: does not follow its owner when they switch workspaces on the website: an
    #: automation's reach should not change because a person clicked something.
    workspace_id: UUID
    scopes: list[TokenScope]
    created_at: datetime
    expires_at: datetime
    #: When a request last presented this token, to the minute it was written. `None`
    #: means it has never been used — which is the interesting case when somebody is
    #: deciding whether a token they do not recognise matters.
    last_used_at: datetime | None = None
    #: Set when the owner revoked it. A revoked token is kept and kept visible rather
    #: than deleted, so "this token was used at 03:00 and I killed it at 09:00" stays
    #: answerable afterwards.
    revoked_at: datetime | None = None


class PersonalAccessTokenList(_ResourceBase):
    tokens: list[PersonalAccessToken] = Field(default_factory=list)


class MintedToken(_ResourceBase):
    """The response to `POST /v1/tokens`, and the only object that carries the secret.

    `token` is returned once, on the request that created it. The server stores a
    SHA-256 of it and nothing else, so there is no second read: if it is lost, the
    only remedy is to revoke this one and mint another. That is the property being
    bought, and it is why the creating request is the only one that can show it.
    """

    #: The full credential, `lq_pat_` followed by the secret. Never logged, never
    #: stored in the clear, and present in no other response.
    token: str
    #: The same row `GET /v1/tokens` would list, so a client that just minted one does
    #: not have to re-read the list to render it.
    record: PersonalAccessToken


class CreateTokenRequest(_ResourceBase):
    """Mint a token in the caller's ACTIVE workspace.

    The workspace is not a field. It is read from the caller's own scope, for the same
    reason `auth/deps.py::get_scope` refuses a workspace id from the request: a body
    that names its own tenant is a body that can be edited to name another one.
    """

    name: TokenName
    #: Days from now. `MAX_TOKEN_LIFETIME_DAYS` is the ceiling from the owner's ruling;
    #: anything above it is a 422 rather than a clamp.
    expires_in_days: int = Field(default=MAX_TOKEN_LIFETIME_DAYS, ge=1, le=MAX_TOKEN_LIFETIME_DAYS)
    #: `READ` is added whatever is asked for, so `[]` and `[read]` mean the same thing
    #: and `[run]` means `[read, run]`. Normalised in the repository, not here, so a
    #: row written by any path obeys it.
    scopes: list[TokenScope] = Field(default_factory=lambda: [TokenScope.READ])


__all__ = [
    "MAX_TOKENS_PER_USER",
    "MAX_TOKEN_LIFETIME_DAYS",
    "TOKEN_PREFIX",
    "TOKEN_TAIL_CHARS",
    "CreateTokenRequest",
    "MintedToken",
    "PersonalAccessToken",
    "PersonalAccessTokenList",
    "TokenName",
    "TokenScope",
]
