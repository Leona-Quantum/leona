"""Envelope encryption for stored third-party provider credentials.

## Why this is a standalone module and not part of `Settings`

Both the API and the worker need it, and the worker cannot construct `Settings`.
That is not a preference: `tiers.EnvTierSources` carries the measurement —
building `Settings` inside the job loop raised RuntimeError on every AUTO run
that resolved to EXECUTE in production, because the worker's environment carries
none of the web-facing values `Settings` validates, and an allowance check became
an outage. A reader that names one variable and validates that one variable is
the shape something in both services can depend on.

## The key material

`MAJORANA_CREDENTIAL_KEYS` is a comma-separated list of Fernet keys, **newest
first**. They are wrapped in `cryptography.fernet.MultiFernet`, which encrypts
with the first key and decrypts with any of them. That ordering is the whole of
how a key is rotated without a downtime window:

  1. Generate a new key and prepend it, keeping the old one:
     `MAJORANA_CREDENTIAL_KEYS=<new>,<old>`. New writes use `<new>`, existing
     rows still decrypt under `<old>`. Nothing breaks and nothing is re-encrypted.
  2. When every row's `key_id` names `<new>` — users reconnect, or an operator
     re-encrypts — drop `<old>`.

Reversing that order, or replacing rather than prepending, makes every stored
credential undecryptable at once. `key_id` on the row is what lets an operator
tell which state they are in: it is the first eight hex characters of a SHA-256
over the key material, which is stable, non-secret, and enough to distinguish
keys without being enough to attack one.

## Fail closed, and fail legibly

An unset or malformed `MAJORANA_CREDENTIAL_KEYS` raises
`CredentialStorageUnavailable`, which the connect route turns into a 503 with
`{"reason": "credential_storage_unavailable"}` and the status route reports as
`storage_available: false`. It must never fall back to storing plaintext, and it
must never surface as a bare `KeyError` from `os.environ` — a request that dies
on a missing environment variable tells an operator nothing about which variable.

## Nothing here ever puts a secret in a string

No exception raised by this module carries plaintext, ciphertext, or key
material — only the `key_id`, which is a digest. That is deliberate and is
tested: an exception message is the one place a secret reliably ends up in a log
aggregator, a Sentry event, and a bug report, all at once.

## Generating a key

    uv run python -m majorana_api.credential_crypto

prints one new key on stdout. The runbook says to run that rather than
describing the format, because a hand-typed Fernet key that is one character
short fails at the first PUT rather than at deploy.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

#: The one variable this module reads. Named once so the API, the worker, the
#: runbook check and the tests cannot disagree about its spelling.
KEYS_ENV = "MAJORANA_CREDENTIAL_KEYS"

#: Characters of the SHA-256 hex digest kept as the row's `key_id`.
_KEY_ID_CHARS = 8


class CredentialCryptoError(RuntimeError):
    """Anything that stops a credential being encrypted or decrypted."""


class CredentialStorageUnavailable(CredentialCryptoError):
    """No usable encryption key is configured in this process.

    The deployment cannot store or read credentials at all. Distinct from
    `CredentialDecryptionFailed`, which means the keys are fine and this
    particular row is not readable under them — an operator acts differently on
    each, so they are not one exception with a flag.
    """


class CredentialDecryptionFailed(CredentialCryptoError):
    """A stored ciphertext did not decrypt under any configured key.

    Carries the row's `key_id` and nothing else. In practice this means the key
    that wrote the row has been dropped from `MAJORANA_CREDENTIAL_KEYS`, which is
    what a rotation done by replacement rather than by prepending looks like from
    the inside.
    """

    def __init__(self, key_id: str) -> None:
        super().__init__(
            f"stored credential encrypted under key {key_id} did not decrypt under any "
            f"key configured in {KEYS_ENV}"
        )
        self.key_id = key_id


def generate_key() -> str:
    """A new Fernet key, as the string that belongs in `MAJORANA_CREDENTIAL_KEYS`."""
    return Fernet.generate_key().decode("ascii")


def key_id_for(key_material: str) -> str:
    """The short stable identifier stored on a row encrypted with this key.

    A truncated SHA-256 rather than the key's own prefix: a prefix of the key IS
    key material, and it would put the first bytes of a secret into every row,
    every log line that names a row, and every operator's terminal.
    """
    digest = hashlib.sha256(key_material.encode("utf-8")).hexdigest()
    return digest[:_KEY_ID_CHARS]


def _configured_keys(environ: dict[str, str] | None = None) -> list[str]:
    source = os.environ if environ is None else environ
    raw = source.get(KEYS_ENV) or ""
    return [key.strip() for key in raw.split(",") if key.strip()]


@dataclass(frozen=True)
class CredentialCipher:
    """Encrypt with the newest key; decrypt with any configured key."""

    _fernet: MultiFernet
    #: `key_id` of the key that `encrypt` uses, written onto every row it writes.
    key_id: str

    def encrypt(self, plaintext: str) -> tuple[str, str]:
        """`(ciphertext, key_id)` for a secret. The plaintext is not retained."""
        token = self._fernet.encrypt(plaintext.encode("utf-8"))
        return token.decode("ascii"), self.key_id

    def decrypt(self, ciphertext: str, *, key_id: str = "unknown") -> str:
        """The secret behind a stored ciphertext.

        `key_id` is the row's, used only to make the failure legible; it is never
        compared against the configured keys, because MultiFernet is allowed to
        succeed under any of them and a row whose `key_id` has drifted from
        reality should still be readable if some key can read it.
        """
        try:
            return self._fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError, TypeError):
            # Deliberately `from None`: `InvalidToken` carries no message today,
            # but chaining a cryptography exception onto one that will be logged
            # is how a library's future decision to include the token in its
            # message becomes our secret in our logs.
            raise CredentialDecryptionFailed(key_id) from None


def load_cipher(environ: dict[str, str] | None = None) -> CredentialCipher:
    """The cipher for this process, or `CredentialStorageUnavailable`.

    Built per call rather than cached in a module global. Constructing a Fernet
    is a base64 decode and a key split — microseconds — and a cached cipher is a
    process that keeps using a key an operator has already rotated away, in the
    one subsystem where that failure is silent until somebody's credential stops
    decrypting.
    """
    keys = _configured_keys(environ)
    if not keys:
        raise CredentialStorageUnavailable(
            f"{KEYS_ENV} is not set; credential storage is disabled in this deployment. "
            f"Generate a key with: python -m majorana_api.credential_crypto"
        )
    try:
        fernets = [Fernet(key) for key in keys]
    except (ValueError, TypeError):
        # The message names the variable and the count, never a value. A
        # malformed key printed into a log is still a key.
        raise CredentialStorageUnavailable(
            f"{KEYS_ENV} holds {len(keys)} entr{'y' if len(keys) == 1 else 'ies'}, at least "
            "one of which is not a valid Fernet key. Generate one with: "
            "python -m majorana_api.credential_crypto"
        ) from None
    return CredentialCipher(_fernet=MultiFernet(fernets), key_id=key_id_for(keys[0]))


def storage_available(environ: dict[str, str] | None = None) -> bool:
    """Whether this process could store a credential right now.

    A full `load_cipher` rather than a presence check on the variable, because
    "the variable is set to something that is not a Fernet key" and "the variable
    is unset" are the same answer to the caller and a different answer to
    `KEYS_ENV in os.environ`.
    """
    try:
        load_cipher(environ)
    except CredentialStorageUnavailable:
        return False
    return True


if __name__ == "__main__":  # pragma: no cover - operator command
    print(generate_key())
