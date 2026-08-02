"""Credential encryption: rotation, failing closed, and never printing a secret.

The three things this module has to get right, in the order they would hurt:

1. **It never stores plaintext.** No configured key must produce a refusal, not
   a fallback.
2. **It can be rotated.** A key that cannot be rotated is a key that will not be
   rotated, and `key_id` on the row is what makes an operator able to tell when
   rotation is finished.
3. **It never puts key material or a secret into a string.** An exception
   message reaches a log aggregator, a Sentry event and a bug report at once.
"""

import pytest

from majorana_api import credential_crypto as crypto

SECRET = "k" * 44


def _env(*keys: str) -> dict[str, str]:
    return {crypto.KEYS_ENV: ",".join(keys)}


def test_a_secret_round_trips():
    env = _env(crypto.generate_key())
    cipher = crypto.load_cipher(env)
    ciphertext, key_id = cipher.encrypt(SECRET)
    assert cipher.decrypt(ciphertext, key_id=key_id) == SECRET


def test_the_ciphertext_does_not_contain_the_plaintext():
    """The most basic property, asserted rather than assumed."""
    cipher = crypto.load_cipher(_env(crypto.generate_key()))
    ciphertext, _ = cipher.encrypt(SECRET)
    assert SECRET not in ciphertext


def test_the_same_secret_encrypts_differently_every_time():
    """Fernet is randomised. Deterministic ciphertext would let anyone holding
    the table tell which two users pasted the same key."""
    cipher = crypto.load_cipher(_env(crypto.generate_key()))
    first, _ = cipher.encrypt(SECRET)
    second, _ = cipher.encrypt(SECRET)
    assert first != second


def test_no_key_configured_refuses_rather_than_falling_back():
    with pytest.raises(crypto.CredentialStorageUnavailable):
        crypto.load_cipher({})
    assert crypto.storage_available({}) is False


def test_a_blank_value_is_not_a_key():
    assert crypto.storage_available({crypto.KEYS_ENV: "   ,  ,"}) is False


def test_a_malformed_key_is_reported_as_unavailable_not_as_a_crash():
    """A raw `ValueError` from cryptography reaching a request handler is a 500
    with no cause, on the one route whose failure an operator has to diagnose."""
    with pytest.raises(crypto.CredentialStorageUnavailable) as excinfo:
        crypto.load_cipher(_env("this-is-not-a-fernet-key"))
    assert crypto.KEYS_ENV in str(excinfo.value)
    assert crypto.storage_available(_env("this-is-not-a-fernet-key")) is False


def test_the_malformed_key_itself_is_never_in_the_message():
    """A malformed key printed into a log is still a key."""
    bad = "SUPERSECRETBUTNOTAFERNETKEY"
    with pytest.raises(crypto.CredentialStorageUnavailable) as excinfo:
        crypto.load_cipher(_env(bad))
    assert bad not in str(excinfo.value)


def test_no_key_configured_names_the_variable_and_the_command():
    """Fail legibly. "KeyError: 'MAJORANA_CREDENTIAL_KEYS'" is a stack trace;
    this is an instruction."""
    with pytest.raises(crypto.CredentialStorageUnavailable) as excinfo:
        crypto.load_cipher({})
    message = str(excinfo.value)
    assert crypto.KEYS_ENV in message
    assert "majorana_api.credential_crypto" in message


# ------------------------------------------------------------------- rotation


def test_a_prepended_key_encrypts_while_the_old_key_still_decrypts():
    """The whole of how rotation happens without a downtime window.

    Old rows keep decrypting under the retiring key; new rows are written under
    the new one. Nothing is re-encrypted and nothing breaks in between.
    """
    old, new = crypto.generate_key(), crypto.generate_key()
    written_before = crypto.load_cipher(_env(old))
    old_ciphertext, old_key_id = written_before.encrypt(SECRET)

    rotated = crypto.load_cipher(_env(new, old))
    assert rotated.decrypt(old_ciphertext, key_id=old_key_id) == SECRET

    fresh_ciphertext, fresh_key_id = rotated.encrypt(SECRET)
    assert fresh_key_id == crypto.key_id_for(new)
    assert fresh_key_id != old_key_id
    # And the row written after rotation must NOT depend on the retiring key.
    assert crypto.load_cipher(_env(new)).decrypt(fresh_ciphertext) == SECRET


def test_dropping_the_key_a_row_needs_is_a_legible_failure_naming_that_row():
    """The rotation done wrong — replaced rather than prepended.

    It has to be diagnosable from the row: `key_id` is on the record precisely
    so an operator can answer "which key does this need" without decrypting
    anything.
    """
    old, new = crypto.generate_key(), crypto.generate_key()
    ciphertext, key_id = crypto.load_cipher(_env(old)).encrypt(SECRET)
    with pytest.raises(crypto.CredentialDecryptionFailed) as excinfo:
        crypto.load_cipher(_env(new)).decrypt(ciphertext, key_id=key_id)
    assert excinfo.value.key_id == key_id
    assert key_id in str(excinfo.value)


def test_a_decryption_failure_does_not_chain_the_library_exception():
    """`InvalidToken` carries no message today. A library's future decision to
    include the token in one must not become our secret in our logs."""
    ciphertext, key_id = crypto.load_cipher(_env(crypto.generate_key())).encrypt(SECRET)
    with pytest.raises(crypto.CredentialDecryptionFailed) as excinfo:
        crypto.load_cipher(_env(crypto.generate_key())).decrypt(ciphertext, key_id=key_id)
    assert excinfo.value.__cause__ is None
    assert ciphertext not in str(excinfo.value)


def test_a_garbage_ciphertext_is_a_decryption_failure_not_a_crash():
    """A corrupted column must not 500 the worker's job loop."""
    cipher = crypto.load_cipher(_env(crypto.generate_key()))
    with pytest.raises(crypto.CredentialDecryptionFailed):
        cipher.decrypt("not-a-fernet-token", key_id="abc12345")


# --------------------------------------------------------------------- key ids


def test_the_key_id_is_stable_short_and_not_key_material():
    """A prefix of the key WOULD be key material, and it would land in every row,
    every log line naming a row, and every operator's terminal."""
    key = crypto.generate_key()
    assert crypto.key_id_for(key) == crypto.key_id_for(key)
    assert len(crypto.key_id_for(key)) == 8
    assert crypto.key_id_for(key) not in key


def test_different_keys_get_different_ids():
    ids = {crypto.key_id_for(crypto.generate_key()) for _ in range(32)}
    assert len(ids) == 32


def test_generate_key_produces_a_key_this_module_can_use():
    """The runbook tells an operator to run a command rather than describing a
    format, so the command's output has to be directly usable."""
    assert crypto.storage_available(_env(crypto.generate_key())) is True
