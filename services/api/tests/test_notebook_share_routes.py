"""Notebook share links: the DB-free controls.

`test_notebook_share_links_live.py` (authz suite) proves the end-to-end and
cross-tenant behaviour against real Postgres. This file holds what does not
need a database: the gitleaks detection control, the mint/hash round trip, the
NUL-byte guard on the one request body this feature's ANONYMOUS route parses,
and the report-redaction helper as a pure function.
"""

from __future__ import annotations

import hashlib
import re
import tomllib
from pathlib import Path

import majorana_contracts as contracts
import pytest
from majorana_contracts.notebook_shares import SHARE_TOKEN_PREFIX
from majorana_contracts.notebooks import CellRole
from pydantic import ValidationError

from majorana_api.auth.notebook_share_deps import LookupNotebookShareRequest
from majorana_api.repos import notebook_share_links as share_links_repo
from majorana_api.routes.notebook_shares import _redact_report_for_public


def test_the_gitleaks_rule_matches_a_real_share_token():
    """The control for `.gitleaks.toml`'s `leona-notebook-share-token` rule —
    mirrors `test_token_access.py::test_the_gitleaks_rule_matches_a_real_token`
    for the same reason: a detection rule nobody has watched fire may match
    nothing at all."""
    config = tomllib.loads(
        (Path(__file__).resolve().parents[3] / ".gitleaks.toml").read_text(encoding="utf-8")
    )
    [rule] = [r for r in config["rules"] if r["id"] == "leona-notebook-share-token"]
    pattern = re.compile(rule["regex"])

    for _ in range(50):
        minted = share_links_repo.new_token()
        assert pattern.search(minted), f"the gitleaks rule does not match a real token: {minted!r}"

    assert not pattern.search(SHARE_TOKEN_PREFIX)
    assert not pattern.search(f"{SHARE_TOKEN_PREFIX}tooshort")


def test_a_minted_token_hashes_to_what_the_public_lookup_looks_up():
    """`hash_token` must be the plain SHA-256 hex digest 0072's check constraint
    expects — checked against an INDEPENDENT computation (`hashlib` called
    directly here), not against a second call to the same function, which would
    pass even if `hash_token` returned something constant."""
    token = share_links_repo.new_token()
    expected = hashlib.sha256(token.encode("utf-8")).hexdigest()
    assert share_links_repo.hash_token(token) == expected
    # Two distinct tokens must hash to two distinct digests.
    other = share_links_repo.new_token()
    assert share_links_repo.hash_token(other) != expected
    # And the token round-trips through the prefix/tail split `mint` performs.
    secret = token.removeprefix(SHARE_TOKEN_PREFIX)
    assert token == f"{SHARE_TOKEN_PREFIX}{secret}"


def test_the_public_lookup_body_refuses_a_nul_byte():
    """`LookupNotebookShareRequest` lives in `auth/notebook_share_deps.py`, not
    under `routes/`, so `test_request_models_refuse_nul.py`'s generic scanner
    (which only walks `routes/*.py`) does not enumerate it. This is the direct
    equivalent for the one class that scanner cannot see — not a weaker
    guarantee, the same guard, checked by hand instead of by the sweep."""
    with pytest.raises(ValidationError):
        LookupNotebookShareRequest(token="a\u0000b")


# --------------------------------------------------------------------- report redaction


def _spec_with_roles(*roles: CellRole) -> contracts.NotebookSpec:
    cells = []
    for index, role in enumerate(roles):
        if role in (CellRole.SOLUTION,):
            cells.append(
                contracts.Cell(id=f"c{index}", kind="code", role=role, source="secret", stub="stub")
            )
        else:
            cells.append(contracts.Cell(id=f"c{index}", kind="markdown", role=role, source="x"))
    return contracts.NotebookSpec(slug="spec-ab12cd34", title="Spec", cells=cells)


def test_report_redaction_is_a_no_op_when_nothing_is_secret():
    spec = _spec_with_roles(CellRole.OBJECTIVE, CellRole.EXERCISE)
    report = contracts.ExecutionReport(
        notebook_slug="spec-ab12cd34",
        ok=True,
        runner="sandbox",
        cells=[
            contracts.CellResult(id="c0", status="ok"),
            contracts.CellResult(id="c1", status="ok"),
        ],
    )
    redacted = _redact_report_for_public(spec, report)
    assert redacted is report  # unchanged object: nothing to strip


def test_report_redaction_drops_only_the_secret_cells_results():
    spec = _spec_with_roles(CellRole.OBJECTIVE, CellRole.SOLUTION, CellRole.ANSWER)
    report = contracts.ExecutionReport(
        notebook_slug="spec-ab12cd34",
        ok=True,
        runner="sandbox",
        cells=[
            contracts.CellResult(id="c0", status="ok", stdout="fine"),
            contracts.CellResult(id="c1", status="ok", stdout="the real secret answer"),
            contracts.CellResult(id="c2", status="ok", stdout="also secret"),
        ],
    )
    redacted = _redact_report_for_public(spec, report)
    assert redacted is not None
    assert [result.id for result in redacted.cells] == ["c0"]


def test_report_redaction_passes_through_none():
    spec = _spec_with_roles(CellRole.OBJECTIVE)
    assert _redact_report_for_public(spec, None) is None


def _challenge_with_checks():
    """A challenge whose check states the answer, and a report whose verdict repeats the
    solution's circuit (review of PR 1011, blocker 2)."""
    spec = contracts.NotebookSpec.model_validate(
        {
            "slug": "t",
            "title": "GHZ",
            "kind": "challenge",
            "cells": [
                {
                    "id": "c01",
                    "kind": "code",
                    "role": "solution",
                    "stub": "qc = None\n",
                    "source": "qc = build_ghz(3)\n",
                },
                {
                    "id": "k01",
                    "kind": "code",
                    "role": "check",
                    "property": {"kind": "value", "subject": "answer", "value": 0.4375},
                },
            ],
        }
    )
    verdict = contracts.CheckVerdict(
        status="pass",
        basis="circuit",
        checked_against="the 3-qubit GHZ state",
        measure="fidelity 1.0000000",
        subject_qasm="OPENQASM 3.0;\nqubit[3] q;\nh q[0];\ncx q[0], q[1];\n",
    )
    report = contracts.ExecutionReport(
        notebook_slug="t",
        ok=True,
        runner="sandbox",
        cells=[
            contracts.CellResult(id="c01", status="ok"),
            contracts.CellResult(id="k01", status="ok", check=verdict),
        ],
    )
    return spec, report


def test_the_public_report_drops_a_hidden_checks_verdict():
    spec, report = _challenge_with_checks()
    redacted = _redact_report_for_public(spec, report)
    assert redacted is not None
    assert [cell.id for cell in redacted.cells] == []
    assert "GHZ" not in redacted.model_dump_json() and "cx q" not in redacted.model_dump_json()
    assert [cell.id for cell in spec.for_learner().cells] == ["c01"]
