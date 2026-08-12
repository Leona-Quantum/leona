"""A re-signature has to say what permitted it, and it cannot say so afterwards.

`--re-attest` is the one flag that writes a *human decision* into the corpus. The
row it lands carries the reviewer's user id and the policy's statement, which is
written in the owner's first person — "I attest, as owner of Leona Quantum …".
Nothing else on the row distinguishes two very different events:

- the account holder sat down, read the record, and signed it;
- the account holder authorised the act somewhere else, and something else ran
  the command on their behalf.

The second is the normal case here and it is not the one the row asserts.
`license_assertions` is append-only behind a Postgres trigger (ADR-0020), so the
over-claim cannot be corrected later — only superseded by another row that will
carry the same ambiguity.

So the two flags are paired in both directions. These tests are the pairing, not
the storage: the storage is a dict merge, and what is worth pinning is that
neither flag can be used alone.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

_CLI = (sys.executable, "-m", "majorana_api.catalog_admin")


def run(*args: str) -> subprocess.CompletedProcess[str]:
    """Argument parsing only — every case here exits before touching a database."""
    return subprocess.run([*_CLI, *args], capture_output=True, text=True, timeout=120)


IDS = "vqe-qeom,vqe-natural-gradient"
CITE = "https://github.com/EshMis/ai-ops/issues/12#issuecomment-5266092775 (EshMis, 2026-08-12T11:26:11Z)"


@pytest.mark.parametrize("command", ["attest-bootstrap", "sync-bootstrap"])
def test_re_attest_without_an_authorization_refuses(command: str) -> None:
    """The half that would leave an unamendable over-claim."""
    result = run(command, "--attested-by-standing", "--re-attest", IDS)
    assert result.returncode != 0
    assert "--re-attest requires --authorization" in result.stderr


@pytest.mark.parametrize("command", ["attest-bootstrap", "sync-bootstrap"])
def test_an_authorization_without_a_re_attest_refuses(command: str) -> None:
    """The mirror: a citation stamped on a run that decided nothing."""
    result = run(command, "--attested-by-standing", "--authorization", CITE)
    assert result.returncode != 0
    assert "only means something with --re-attest" in result.stderr


def test_the_pair_together_gets_past_argument_parsing() -> None:
    """Both present is accepted — it fails later, on the database it cannot reach.

    Asserting on the *absence* of the pairing errors rather than on success,
    because there is no database here and there should not be one: the point is
    that argument parsing stops objecting.
    """
    result = run(
        "sync-bootstrap", "--attested-by-standing", "--re-attest", IDS, "--authorization", CITE
    )
    assert "--re-attest requires --authorization" not in result.stderr
    assert "only means something with --re-attest" not in result.stderr


def test_authorization_is_rejected_on_commands_that_never_sign() -> None:
    """`publish-bootstrap` re-evaluates readiness and signs nothing.

    A flag that reads as a decision and reaches no decision is worse than no
    flag — the same reasoning that keeps `--re-attest` off this command.
    """
    result = run("publish-bootstrap", "--attested-by-standing", "--authorization", CITE)
    assert result.returncode != 0
    assert "--authorization applies to" in result.stderr


def test_the_help_text_says_what_the_citation_is_for() -> None:
    """An operator reaching for this flag is mid-signature and will not read a docstring."""
    result = run("--help")
    assert "--authorization" in result.stdout
    assert "REQUIRED with" in result.stdout
