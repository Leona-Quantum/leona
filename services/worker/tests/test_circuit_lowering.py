"""A published circuit runs, and the run says what it actually is.

The defect this closes, stated as a sequence: source from the open repository
binds `FINAL_CIRCUIT` and no `RESULT`, so `check_contract` produced
`RESULT missing key`, whose retry target is GENERATION, so the pipeline sent the
user's own circuit to a language model to be rewritten. It was never a sandbox
failure — the circuit executed perfectly every time.

Three things have to hold together, and each fails differently:

1. A circuit's execution must COLLECT the evidence a result can come from, and a
   program's must not start collecting it (that budget decision is not being
   reversed here — only made conditional on the case that needs it).
2. The contract must stop asking a circuit for a script's output keys, while
   still failing a circuit that produced no evidence at all.
3. The run must not claim the program returned a result it never returned.
"""

from __future__ import annotations

import uuid

import pytest
from majorana_agent import MemoryAgentStore
from majorana_agent.models import CandidateRevision, ExecutionEvidence, PlanRevision
from majorana_agent.simple_pipeline import SimpleRetryTarget
from majorana_contracts.enums import Framework, SemanticReviewDecision, VerificationMethod
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from majorana_frameworks.roles import ProgramRole, classify_source
from majorana_worker.runtime_ports import SandboxCandidateExecutor
from majorana_worker.simple_ports import (
    ProductionSimplePipelinePorts,
    simple_pipeline_verification_summary,
)

CIRCUIT = """from qiskit import QuantumCircuit

FINAL_CIRCUIT = QuantumCircuit(2, 2)
FINAL_CIRCUIT.h(0)
FINAL_CIRCUIT.cx(0, 1)
FINAL_CIRCUIT.measure([0, 1], [0, 1])
"""

PROGRAM = CIRCUIT + '\nRESULT = {"counts": {"00": 512, "11": 512}}\n'


def _plan(**overrides) -> Plan:
    """The same payload shape `test_simple_ports` uses, so the model is the real one."""
    payload = {
        "domain": "quantum information",
        "framework": "qiskit",
        "algorithm": "Bell",
        "problem_summary": "Build and execute a Bell state circuit",
        "algorithm_rationale": "Entanglement implements the requested state",
        "parameters": {"shots": 100, "seed": 7},
        "qubits_estimate": 2,
        "expected_runtime_sec": 10,
        "success_criteria": {"primary_metric": "counts"},
        "expected_output_keys": ["counts"],
        **overrides,
    }
    return Plan.model_validate(payload)


def _candidate(source: str) -> CandidateRevision:
    # `CandidateRevision` validates that the fingerprint really is the
    # framework-native one, so it has to come from `FrameworkProgram` rather than
    # from a bare sha256 of the text.
    program = FrameworkProgram(Framework.QISKIT, source)
    return CandidateRevision(
        candidate_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        tool_call_id="call-1",
        revision=1,
        plan_id=uuid.uuid4(),
        framework=Framework.QISKIT,
        source=program.normalized_source,
        source_fingerprint=program.fingerprint,
    )


class _RecordingSandbox:
    """Captures the spec the executor built. The spec IS the thing under test."""

    provider = "recording"
    environment_id = "local:" + "0" * 64

    def __init__(self) -> None:
        self.spec = None

    async def _execute(self, spec):  # pragma: no cover - exercised via `run`
        from majorana_sandbox.spec import SandboxResult

        self.spec = spec
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=1,
            stdout="",
            stderr="",
            provider=self.provider,
            protected_result={},
        )


async def _spec_for(source: str):
    sandbox = _RecordingSandbox()
    await SandboxCandidateExecutor(sandbox).run_candidate(_candidate(source), _plan())
    assert sandbox.spec is not None
    return sandbox.spec


# --------------------------------------------------------------------------- #
# 1. What the executor asks the sandbox to collect
# --------------------------------------------------------------------------- #


async def test_a_circuit_collects_the_evidence_its_result_will_come_from():
    assert classify_source(CIRCUIT) is ProgramRole.CIRCUIT
    spec = await _spec_for(CIRCUIT)
    assert "_majorana_native_evidence" in spec.trusted_setup
    assert 'result_origin"] = "derived_from_circuit' in spec.trusted_observer


async def test_a_program_still_collects_nothing_extra():
    """The budget decision this narrows is not being reversed.

    Native collection was turned off for every candidate to keep runs inside
    their budget. It stays off for programs — which already report a result — and
    is enabled only for circuits, where the alternative is not a cheaper run but a
    generation retry loop.
    """
    assert classify_source(PROGRAM) is ProgramRole.PROGRAM
    spec = await _spec_for(PROGRAM)
    assert "_majorana_native_evidence" not in spec.trusted_setup
    assert "derived_from_circuit" not in spec.trusted_observer


async def test_source_that_is_neither_never_reaches_a_sandbox_at_all():
    """UNKNOWN is not a circuit with a missing result, and it is refused earlier.

    `contract_diagnostics` already rejects source that binds no FINAL_CIRCUIT,
    before any sandbox is created — so lowering never has to decide what to do
    with it. Asserted rather than assumed, because the alternative (falling
    through to a spec with derivation on) would derive nothing, produce a result
    of nothing, and report it as a contract failure two stages later.
    """
    sandbox = _RecordingSandbox()
    output = await SandboxCandidateExecutor(sandbox).run_candidate(_candidate("x = 1\n"), _plan())
    assert sandbox.spec is None, "no sandbox should be created for source with no circuit"
    assert any("FINAL_CIRCUIT" in d for d in output.observation.get("contract_diagnostics", [])), (
        output.observation
    )


# --------------------------------------------------------------------------- #
# 2. The contract
# --------------------------------------------------------------------------- #


def _evidence(candidate: CandidateRevision, *, result: dict, observation: dict):
    return ExecutionEvidence(
        execution_id=uuid.uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        environment_fingerprint="b" * 64,
        sandbox_provider="test",
        exit_code=0,
        duration_ms=1,
        result=result,
        observation=observation,
    )


def _plan_revision(plan: Plan) -> PlanRevision:
    # `plan_fingerprint` is validated against the Plan's own content, so it comes
    # from the model's own function rather than from a literal.
    from majorana_agent.models import _plan_fingerprint

    return PlanRevision(
        plan_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        revision=1,
        plan=plan,
        plan_fingerprint=_plan_fingerprint(plan),
    )


_METRICS = {
    "qubits": 2,
    "depth": 3,
    "gate_count": 2,
    "two_qubit_gate_count": 1,
    "measurement_count": 2,
}


class _NoLLM:
    async def complete(self, _request):  # pragma: no cover - contract check makes no calls
        raise AssertionError("check_contract must not call a model")


def _contract_ports() -> ProductionSimplePipelinePorts:
    """The real port object, with every collaborator it must not use stubbed out.

    `check_contract` is a method of the production ports rather than a free
    function, and testing it through a hand-rolled copy would test the copy.
    Everything it does not touch raises if touched, so a future edit that reaches
    for a model or the store fails loudly here.
    """
    return ProductionSimplePipelinePorts(
        store=MemoryAgentStore(),
        observer=None,
        llm=_NoLLM(),
        executor=None,
        reviewer=None,
        converter=None,
        saver=None,
        task_prompt="prepare a two-qubit Bell state",
        framework=Framework.QISKIT,
    )


async def _check(source: str, *, result: dict, observation: dict, plan: Plan | None = None):
    candidate = _candidate(source)
    outcome = await _contract_ports().check_contract(
        uuid.uuid4(),
        _plan_revision(plan or _plan()),
        candidate,
        _evidence(candidate, result=result, observation=observation),
    )
    assert outcome.value is not None, outcome.failure
    return outcome.value


async def test_a_circuit_is_not_asked_for_a_scripts_output_keys():
    """The line that sent published circuits to a model to be rewritten.

    The plan asks for `energy`, the circuit measured bitstrings. Before this, that
    was `RESULT missing key 'energy'` with retry_target GENERATION.
    """
    contract = await _check(
        CIRCUIT,
        result={"counts": {"00": 1022, "11": 1026}, "shots": 2048},
        observation={
            "resource_metrics": _METRICS,
            "result_origin": "derived_from_circuit",
            "result_evidence": "native_sampled",
        },
        plan=_plan(expected_output_keys=["energy"], success_criteria={"primary_metric": "energy"}),
    )
    assert contract.passed, contract.diagnostics


async def test_a_program_is_still_held_to_every_key_it_declared():
    """The positive control. Nothing about a PROGRAM's contract was loosened."""
    contract = await _check(
        PROGRAM,
        result={"counts": {"00": 512}},
        observation={"resource_metrics": _METRICS},
        plan=_plan(expected_output_keys=["counts", "energy"]),
    )
    assert not contract.passed
    assert any("energy" in d for d in contract.diagnostics)
    assert contract.retry_target is SimpleRetryTarget.GENERATION


async def test_a_circuit_that_produced_no_evidence_still_fails_and_says_why():
    """Lowering must not turn every circuit into an automatic pass.

    Nothing was derived, so there is no result — a real contract failure, with
    the sandbox's own reason carried into the diagnostic rather than replaced by
    a generic one.
    """
    contract = await _check(
        CIRCUIT,
        result={},
        observation={
            "resource_metrics": _METRICS,
            "result_derivation_error": "circuit has no measurements to sample",
        },
    )
    assert not contract.passed
    assert any("no result to report" in d for d in contract.diagnostics)
    assert any("no measurements to sample" in d for d in contract.diagnostics)


async def test_the_qubit_ceiling_still_applies_to_a_lowered_circuit():
    """Every other circuit check survives. Only the output-key check moved."""
    contract = await _check(
        CIRCUIT,
        result={"counts": {"0" * 40: 1}},
        observation={
            "resource_metrics": {**_METRICS, "qubits": 40},
            "result_origin": "derived_from_circuit",
        },
    )
    assert not contract.passed
    assert any("lane ceiling" in d for d in contract.diagnostics)


# --------------------------------------------------------------------------- #
# 3. What the run claims afterwards
# --------------------------------------------------------------------------- #


def test_a_derived_result_does_not_claim_the_program_returned_it():
    """`return_contract` is a statement about what the SOURCE reported.

    A circuit reported nothing. Claiming the check passed would be a false
    statement about source that made no claim at all — and it would be an
    invisible one, since the check name reads the same either way.
    """
    plain = simple_pipeline_verification_summary()
    derived = simple_pipeline_verification_summary(result_derived=True)

    methods = {check["method"] for check in plain["checks"]}
    assert VerificationMethod.RETURN_CONTRACT.value in methods

    derived_methods = {check["method"] for check in derived["checks"]}
    assert VerificationMethod.RETURN_CONTRACT.value not in derived_methods
    # Dropped, not failed. Nothing went wrong; there was no return to contract with.
    assert all(check["result"] == "pass" for check in derived["checks"])
    assert VerificationMethod.STRUCTURAL.value in derived_methods
    assert VerificationMethod.SUCCESS_CRITERIA.value in derived_methods


def test_a_derived_result_withdraws_the_claim_that_would_be_checked_against_itself():
    """The vacuous-check guard, stated where a reader will see it.

    A derived result comes from the same trusted evidence any later agreement
    check would compare it to. That comparison is `f(x) == f(x)`: it cannot fail,
    and a check that cannot fail reported as PASS is worse than no check.
    """
    derived = simple_pipeline_verification_summary(result_derived=True)
    assert any("derived, not returned" in claim for claim in derived["unverified_claims"])
    assert not any(
        "derived" in claim for claim in simple_pipeline_verification_summary()["unverified_claims"]
    )


def test_lowering_changes_nothing_about_the_decision_or_the_grade():
    """It is not a route to a stronger verdict.

    Both stay exactly where they were: INCONCLUSIVE, and PHYSICAL only when the
    plan's own declared reference check ran and passed. A circuit that happens to
    be easy to sample must not out-rank a program that was actually verified.
    """
    for methods in ((), (VerificationMethod.EXACT_DIAG,)):
        plain = simple_pipeline_verification_summary(methods, SemanticReviewDecision.READY)
        derived = simple_pipeline_verification_summary(
            methods, SemanticReviewDecision.READY, result_derived=True
        )
        assert derived["decision"] == plain["decision"] == "inconclusive"
        assert derived["evidence_strength"] == plain["evidence_strength"]
        assert derived["reason_code"] == plain["reason_code"]


@pytest.mark.parametrize("derived", [False, True])
def test_the_summary_stays_a_valid_typed_projection_either_way(derived):
    from majorana_contracts import VerificationSummary

    summary = simple_pipeline_verification_summary(result_derived=derived)
    assert VerificationSummary.model_validate(summary)
