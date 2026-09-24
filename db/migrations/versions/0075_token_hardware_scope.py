"""Widen personal_access_tokens.scopes to admit `hardware` (ai-ops 376 option 2).

Revision ID: 0075
Revises: 0074

Plan 10-notebook-ide, "Hardware" lane, the token half. The owner's ruling, quoted
in full because the whole migration is one clause of it:

    "Add a separate 'hardware' permission a person must tick when creating a token.
    With it, leona_submit in their own Jupyter or VS Code submits directly, priced
    and counted against the same weekly allowance."

0069's own docstring named this exact constraint as the second half of the
enforcement ai-ops 362's deferral relied on — "there is no `hardware`, and that
absence is the ruling" — so widening it here, deliberately and in a migration a
review can see, is the mechanism 0069 promised: "a later scope needs its own
migration to widen this, which is the review point."

## What changes, and what does not

`ck_personal_access_tokens_scopes` gains one member of its allowed set. Every
other constraint on the table — the hash shape, the tail length, the lifetime
ceiling, the idempotency pairing — is untouched, and no existing row's `scopes`
value is rewritten: a token minted before this migration keeps exactly the scopes
it had, because `hardware` was never in reach for anyone to have asked for it.

`majorana_contracts.tokens.TokenScope` gained the matching `HARDWARE` member in
the same PR (CONTRACTS_VERSION 2.37.0) — the two are meant to move together, the
same pairing 0069 established for `read`/`run`, and `_SCOPES` below is still a
literal tuple rather than an import for the reason 0069 gives: this migration
keeps saying what it said on the day it ran, even after the enum gains a fourth
member later.

## Downgrade

Refuses if any row already carries `hardware` — narrowing the constraint under a
live row that satisfies the wider one would either reject the downgrade outright
(if run as a plain ALTER) or, worse, leave a row on disk that violates the
constraint that is supposed to describe every row in the table. The same
shape 0074 uses for `run_events`.
"""

from __future__ import annotations

from alembic import op

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_personal_access_tokens_scopes"

#: Mirrors `majorana_contracts.tokens.TokenScope` as of CONTRACTS_VERSION 2.30.0.
#: Written out as a literal in 0069 rather than imported, and the same reasoning
#: holds here: a later scope needs its own migration to widen this again.
_SCOPES_OLD = ("read", "run")

#: Mirrors `majorana_contracts.tokens.TokenScope` as of CONTRACTS_VERSION 2.37.0.
_SCOPES_NEW = ("read", "run", "hardware")


def _scopes_check(scopes: tuple[str, ...]) -> str:
    """The exact predicate 0069 wrote, parameterised on the allowed set.

    `array_length(scopes, 1) between 1 and {n}` bounds the length at however many
    distinct scopes exist, `'read' = any(scopes)` keeps `read` mandatory (unchanged
    by this migration — `hardware` does not touch that clause), and `scopes <@
    array[...]` is the closed-alphabet check: every element of the row's array must
    be one of the named literals.
    """
    members = ", ".join(f"'{scope}'" for scope in scopes)
    return (
        f"array_length(scopes, 1) between 1 and {len(scopes)} "
        f"and 'read' = any(scopes) "
        f"and scopes <@ array[{members}]::text[]"
    )


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "personal_access_tokens", type_="check")
    op.create_check_constraint(_CONSTRAINT, "personal_access_tokens", _scopes_check(_SCOPES_NEW))


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (
            select 1 from personal_access_tokens where 'hardware' = any(scopes)
          ) then
            raise exception 'cannot downgrade 0075: a token already carries the hardware scope';
          end if;
        end
        $$;
        """
    )
    op.drop_constraint(_CONSTRAINT, "personal_access_tokens", type_="check")
    op.create_check_constraint(_CONSTRAINT, "personal_access_tokens", _scopes_check(_SCOPES_OLD))
