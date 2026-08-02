"""Per-user third-party provider credentials, encrypted at rest.

Revision ID: 0045
Revises: 0044

## Why the table exists

`MAJORANA_QPU_IBM_TOKEN` was one operator-owned IBM Quantum key that every
account on the platform submitted through. IBM's free Open Plan allowance is ten
minutes of QPU time per 28-day rolling window **per account**, so a single shared
key means the platform's entire user base shares one ten-minute budget, and the
first user of the month spends everybody else's. It also means every hardware job
runs under one identity: the operator's dashboard is where a user's job appears,
and the operator's allowance is what a user's mistake exhausts.

A row here is one person's own provider account, so the allowance, the job
history and the blame all follow the person who owns them.

## Why per USER and not per workspace

A provider account belongs to a PERSON. It follows them into every workspace they
act in, exactly as the weekly run allowance (`runs`, migration 0039) and the
weekly hardware-spend allowance (`qpu_runs`, migration 0044) do — both of those
are keyed on `user_id` for the same reason: a provider bill follows the account,
not the tenant. Keying this table on `workspace_id` would mean a user who
switches workspaces silently loses their own IBM connection, and a user who is
added to somebody else's workspace would be expected to connect a second time.

The consequence for authz is deliberate and is stated in
`repos/provider_credentials.py`: every query in that module is keyed on
`scope.user_id`, which is strictly narrower than the workspace predicate the rest
of the repository layer applies. There is no route by which one user reads
another user's row, because no query in that module admits a user id that is not
the caller's.

## What is stored

`ciphertext` is a Fernet token produced by `majorana_api.credential_crypto` from
`MAJORANA_CREDENTIAL_KEYS`. The plaintext API key is never written to this table
in any column, and no endpoint returns it. `key_id` is the first eight hex
characters of a SHA-256 over the key material that encrypted the row — not a
secret, and not enough of one to shorten an attack on the key; it exists so an
operator rotating keys can tell which rows still need the retiring key, which is
the difference between rotation and an outage.

`instance` is IBM's Service CRN. Qiskit Runtime REST calls carry it in a
`Service-CRN` header, so it is a real second field rather than an optional label,
and it is NOT a secret — it names an instance, it does not authorize anything on
its own, and it is returned by the status endpoint so a user can see what they
pasted.

`last_verified_at` is stamped when IBM's IAM endpoint accepted the key, which
happens before the row is written and never after. `last_used_at` is stamped by
the worker when the credential is actually handed to the provider. They are two
different facts and a user reads them differently: "we checked this and it
worked" versus "something of yours ran with it".

## Reversibility

`downgrade` drops the table, and that destroys the stored ciphertexts. That is
the correct behaviour and not a data-loss hazard worth guarding the way 0034
guards provider-attested runs: a credential is re-creatable by its owner in
about thirty seconds from the IBM dashboard, and a credential that survived a
schema rollback in a table nothing reads would be a secret retained for no
purpose. Nothing else references these rows, so the drop is unconditional.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)

#: The providers a row may name. One today. A CHECK rather than a comment for
#: the reason 0034 gives: the enum lives in code (`majorana_qpu.QpuProviderKey`)
#: and the constraint is what stops a typo becoming a row nothing ever reads.
_PROVIDERS = ("ibm",)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.create_table(
        "provider_credentials",
        sa.Column("id", _UUID, primary_key=True),
        # ON DELETE CASCADE: a deleted account's provider secrets go with it.
        # The alternative — an orphan ciphertext with no owner — is a secret
        # nobody can reach and nobody can revoke.
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("key_id", sa.Text(), nullable=False),
        sa.Column("instance", sa.Text()),
        sa.Column("label", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_verified_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True)),
        # One credential per person per provider. This is also the index every
        # read uses: the status route, the submission gate and the worker all
        # look up exactly (user_id, provider).
        sa.UniqueConstraint("user_id", "provider", name="uq_provider_credentials_user_provider"),
        sa.CheckConstraint(_in("provider", _PROVIDERS), name="ck_provider_credentials_provider"),
        # A row with an empty ciphertext or an empty key_id is a row that cannot
        # be decrypted, and it would fail inside a job rather than at the write.
        sa.CheckConstraint(
            "char_length(ciphertext) > 0", name="ck_provider_credentials_ciphertext"
        ),
        sa.CheckConstraint(
            "char_length(key_id) BETWEEN 1 AND 64", name="ck_provider_credentials_key_id"
        ),
        sa.CheckConstraint(
            "instance IS NULL OR char_length(instance) BETWEEN 1 AND 512",
            name="ck_provider_credentials_instance",
        ),
        sa.CheckConstraint(
            "label IS NULL OR char_length(label) BETWEEN 1 AND 120",
            name="ck_provider_credentials_label",
        ),
    )
    # DELETE is granted here, unlike on `qpu_runs`. An attestation row is a
    # record of something that happened and must not be erasable; a credential
    # is the opposite — "disconnect" has to actually remove the secret, and a
    # soft delete would leave a decryptable key in the database after the user
    # was told it was gone.
    op.execute(
        """
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update, delete on provider_credentials to app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_table("provider_credentials")
