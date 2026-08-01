"""What each of the four version writers actually stores, and what a restore costs.

The fixtures below are not invented shapes. Each mirrors one real writer:

  worker         services/worker/src/majorana_worker/simple_ports.py:709
  studio draft   services/api/src/majorana_api/routes/runs.py:84
  import-public  services/api/src/majorana_api/routes/artifacts.py (import_public_artifact)
  starter Bell   services/api/src/majorana_api/repos/system.py (ensure_starter_bell_artifact)

They exist because "restore this version" is only safe to offer if the surface
offering it knows the versions are not interchangeable.
"""

from types import SimpleNamespace

from majorana_api.version_capabilities import (
    LOSS_EXPORT,
    LOSS_QASM,
    LOSS_RESOURCE_ESTIMATES,
    LOSS_VERIFICATION,
    ORIGIN_AGENT_RUN,
    ORIGIN_IMPORTED_REFERENCE,
    ORIGIN_STARTER_EXAMPLE,
    ORIGIN_STUDIO_DRAFT,
    ORIGIN_UNKNOWN,
    CIRCUIT_ROLE,
    PROGRAM_ROLE,
    capabilities_of,
    restore_losses,
)


def _version(**overrides):
    """Every column `capabilities_of` reads, defaulted the way the row defaults.

    `code` is `Mapped[str]` and NOT NULL, so it is never absent on a real row —
    a double that omitted it passed for as long as nothing read it and broke the
    moment something did. The default here is a program, because three of the
    four writers store one; the circuit case is exercised explicitly below.
    """
    row = {
        "qasm": None,
        "artifact_metadata": None,
        "export_status": "unsupported",
        "framework_variants": None,
        "resource_estimates": None,
        "code": 'FINAL_CIRCUIT = build()\nRESULT = {"counts": {}}\n',
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _passing_summary():
    return {
        "decision": "pass",
        "semantic_review_decision": "ready",
        "evidence_strength": "structural",
        "reason_code": "strict_complete",
        "candidate_defect_observed": False,
        "failure_class": None,
        "retry_target": "none",
        "unverified_claims": [],
        "checks": [{"method": "return_contract", "result": "pass"}],
    }


def worker_version(*, qasm=True, decision="pass"):
    summary = _passing_summary()
    summary["decision"] = decision
    return _version(
        qasm="OPENQASM 3.0;" if qasm else None,
        export_status="lossless" if qasm else "unsupported",
        artifact_metadata={
            "source": "simple_pipeline_candidate",
            "source_fingerprint": "a" * 64,
            "verification_summary": summary,
        },
        # The worker writes framework_variants=None unconditionally — the
        # variants column is populated only by import-public.
        framework_variants=None,
        resource_estimates={"qubits": 2, "depth": 2},
    )


def studio_draft_version():
    return _version(
        qasm=None,
        export_status="unsupported",
        artifact_metadata={
            "source": "studio_draft",
            "based_on_version_id": "0" * 36,
            "source_fingerprint": "b" * 64,
            "verification_summary": {
                "verified": False,
                "decision": None,
                "evidence_strength": None,
                "reason_code": "source_changed_pending_verification",
                "stale": True,
            },
        },
    )


def imported_version():
    return _version(
        qasm="OPENQASM 3.0;",
        export_status="download_only",
        artifact_metadata={
            "source": {"kind": "public_repository", "slug": "bell"},
            "verification_summary": {
                "verified": False,
                "decision": None,
                "reason_code": "imported_reference_not_verified",
                "evidence_strength": None,
            },
        },
        framework_variants={"cirq": "..."},
        resource_estimates={"qubits": 2},
    )


def starter_version():
    return _version(
        qasm="OPENQASM 3.0;",
        export_status="lossless",
        # No verification_summary key at all — the starter artifact predates it.
        artifact_metadata={"description": "Two-qubit Bell state preparation.", "starter": True},
        resource_estimates={"qubits": 2, "depth": 2},
    )


def test_each_writer_is_identified_and_none_is_guessed():
    assert capabilities_of(worker_version()).origin == ORIGIN_AGENT_RUN
    assert capabilities_of(studio_draft_version()).origin == ORIGIN_STUDIO_DRAFT
    assert capabilities_of(imported_version()).origin == ORIGIN_IMPORTED_REFERENCE
    assert capabilities_of(starter_version()).origin == ORIGIN_STARTER_EXAMPLE
    # Legacy rows say unknown rather than being sorted into the nearest bucket.
    assert capabilities_of(_version()).origin == ORIGIN_UNKNOWN
    assert capabilities_of(_version(artifact_metadata={"source": "something new"})).origin == (
        ORIGIN_UNKNOWN
    )
    assert capabilities_of(_version(artifact_metadata="corrupt")).origin == ORIGIN_UNKNOWN


def test_a_studio_draft_holds_none_of_what_a_run_holds():
    """This asymmetry is the whole reason restore needs a warning."""
    draft = capabilities_of(studio_draft_version())
    assert (draft.has_qasm, draft.exportable, draft.verified) == (False, False, False)
    assert (draft.has_resource_estimates, draft.has_framework_variants) == (False, False)


def test_capabilities_come_from_the_row_not_from_the_origin():
    """An agent run whose conversion failed has no QASM either.

    Reading capability off `origin` would tell the canvas to render QASM that
    is not there, for exactly the versions the pipeline could not convert.
    """
    unconverted = capabilities_of(worker_version(qasm=False))
    assert unconverted.origin == ORIGIN_AGENT_RUN
    assert unconverted.has_qasm is False
    assert unconverted.exportable is False
    # Still verified: conversion is verdict-neutral (ADR-0022).
    assert unconverted.verified is True


def test_only_a_pass_counts_as_verified():
    assert capabilities_of(worker_version(decision="inconclusive")).verified is False
    assert capabilities_of(worker_version(decision="fail")).verified is False
    # A summary the strict parser rejects is unknown, never a pass.
    assert capabilities_of(imported_version()).verified is False
    # And a row with no summary at all is not verified by omission.
    assert capabilities_of(starter_version()).verified is False


def test_restoring_a_draft_over_a_verified_run_names_every_loss():
    losses = restore_losses(
        capabilities_of(worker_version()), capabilities_of(studio_draft_version())
    )
    assert losses == [LOSS_QASM, LOSS_EXPORT, LOSS_RESOURCE_ESTIMATES, LOSS_VERIFICATION]


def test_a_restore_that_gains_capability_costs_nothing():
    assert (
        restore_losses(capabilities_of(studio_draft_version()), capabilities_of(worker_version()))
        == []
    )


def test_two_bare_drafts_do_not_interrupt_anyone():
    assert (
        restore_losses(capabilities_of(studio_draft_version()), capabilities_of(_version())) == []
    )


def test_losses_are_codes_so_the_web_can_translate_them():
    """A refusal rendered from server English ships English to Japanese users;
    the locale tables are the only thing enforcing parity here."""
    losses = restore_losses(
        capabilities_of(worker_version()), capabilities_of(studio_draft_version())
    )
    assert all(loss.islower() and " " not in loss for loss in losses)


# --------------------------------------------------------------------------- #
# What the version IS, as opposed to who wrote it
# --------------------------------------------------------------------------- #


def test_a_version_says_whether_it_holds_a_circuit_or_a_program():
    """The distinction one `code` column held silently until now.

    A circuit can be transpiled, block-encoded and re-targeted; a program that
    prints a number cannot. Nothing in the product could tell them apart, which
    is why a repository circuit was executed as if it were a script and failed.
    """
    program = _version()
    assert capabilities_of(program).program_role == PROGRAM_ROLE

    circuit = _version(
        code="from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(2)\n"
    )
    assert capabilities_of(circuit).program_role == CIRCUIT_ROLE


def test_the_role_is_read_from_the_code_and_not_from_the_writer():
    """`origin` and `program_role` answer different questions about one row.

    An agent run whose generation stopped after building the circuit is
    `agent_run` AND a circuit. Deriving the role from the origin — the obvious
    shortcut — would call it a program because agents write programs, and the
    lowering that makes it runnable would never happen.
    """
    half_finished = _version(
        artifact_metadata={"source": "simple_pipeline_candidate"},
        code="from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(2)\n",
    )
    caps = capabilities_of(half_finished)
    assert caps.origin == ORIGIN_AGENT_RUN
    assert caps.program_role == CIRCUIT_ROLE


def test_a_legacy_row_with_neither_name_is_unknown_rather_than_a_guess():
    assert capabilities_of(_version(code="print('hi')")).program_role == "unknown"
    assert capabilities_of(_version(code="")).program_role == "unknown"


def test_the_role_is_not_in_the_restore_losses():
    """Restoring a circuit over a program is not a LOSS of capability.

    It is a different kind of thing, and the losses list is for capabilities the
    artifact would stop having. Listing the role there would make every restore
    between the two interrupt the user with a warning about nothing.
    """
    program = capabilities_of(_version())
    circuit = capabilities_of(_version(code="FINAL_CIRCUIT = build()"))
    assert restore_losses(program, circuit) == []
    assert restore_losses(circuit, program) == []
