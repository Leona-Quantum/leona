"""Small LLM-facing plan contract for the fixed circuit pipeline.

The durable repository still stores the historical ``majorana_contracts.Plan`` so
old runs remain readable.  The model must not author that legacy object directly:
it carries strict-verifier fields and cross-field validators that the simple path
does not use.  This module is the intentionally smaller translation boundary.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from majorana_contracts.enums import (
    Algorithm,
    ArtifactType,
    Framework,
    MeasurementPolicy,
    Optimizer,
    TopLevelExecution,
    VerificationMethod,
)
from majorana_contracts.plan import (
    ArtifactContract,
    PauliTerm,
    Plan,
    PlanParameters,
    ProblemTerm,
    ReferenceProblem,
    SuccessCriteria,
    VerificationPlan,
)
from majorana_llm import StageOutputError, extract_json
from pydantic import BaseModel, ConfigDict, Field, model_validator


class _SimplePlanModel(BaseModel):
    # Zod objects in namekoQ strip unknown keys by default.  Matching that behavior
    # keeps a harmless legacy field from killing a run while every consumed field
    # remains typed below.
    model_config = ConfigDict(extra="ignore")


class SimpleExpectedRange(_SimplePlanModel):
    min: float | None = None
    max: float | None = None


class SimpleSuccessCriteria(_SimplePlanModel):
    primary_metric: str = Field(min_length=1)
    expected_range: SimpleExpectedRange | None = None
    additional_notes: list[str] | None = None


class SimplePlanParameters(_SimplePlanModel):
    shots: int | None = Field(default=None, ge=1, le=20_000)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    optimizer: Optimizer | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=500)
    custom: dict[str, Any] | None = None


class SimpleArtifactContract(_SimplePlanModel):
    """The artifact shape generation and trusted observation must preserve."""

    artifact_type: ArtifactType = ArtifactType.QUANTUM_CIRCUIT
    entry_point: str | None = None
    expected_return_type: str | None = None
    return_shape: str | None = None
    measurement_policy: MeasurementPolicy = MeasurementPolicy.ONLY_IF_REQUESTED
    top_level_execution: TopLevelExecution = TopLevelExecution.REQUIRED

    def to_durable(self) -> ArtifactContract:
        return ArtifactContract.model_validate(self.model_dump(mode="python"))


# The two checks that compare a reported number against a reference computed from
# data the Plan itself declares. Everything else in VerificationMethod either needs
# evidence this pipeline does not collect or duplicates the basic contract check.
_SUPPORTED_REFERENCE_METHODS = ("exact_diag", "brute_force")


class SimplePauliTerm(_SimplePlanModel):
    coefficient: float
    pauli: str = Field(min_length=1)


class SimpleProblemTerm(_SimplePlanModel):
    i: int = Field(ge=0)
    j: int = Field(ge=0)
    weight: float


class SimpleReferenceProblem(_SimplePlanModel):
    kind: Literal["maxcut", "qubo"]
    num_variables: int = Field(ge=1)
    terms: list[SimpleProblemTerm] = Field(min_length=1)


class SimpleVerificationPlan(_SimplePlanModel):
    """An independent ground truth the planner writes out, not a policy it selects.

    Deliberately only the two checks that compare the run's own reported number
    against a reference computed from data the *plan* declares: `exact_diag`
    diagonalizes a stated Hamiltonian, `brute_force` enumerates a stated
    combinatorial instance.  Neither reads the candidate source, so neither can be
    satisfied by a program that merely agrees with itself.

    This is what `success_criteria.expected_range` alone cannot do.  A range the
    planner guessed and a result the generator produced can both come from the
    same model and the same misconception — live H2 VQE run 019f9763 (2026-07-25)
    reported -1.419 Ha against a range derived from its own fabricated
    Hamiltonian, and every structural check passed.  A declared operator is
    checkable evidence; a declared range is not.
    """

    # Typed as plain strings so an unsupported value normalizes away below instead of
    # killing the run, while json_schema_extra still narrows what schema-guided
    # decoding can emit. Same split, and the same reason, as
    # majorana_contracts.plan.VerificationPlan.methods.
    methods: list[str] = Field(
        default_factory=list,
        json_schema_extra={"items": {"enum": list(_SUPPORTED_REFERENCE_METHODS)}},
    )
    reference_hamiltonian: list[SimplePauliTerm] | None = None
    reference_problem: SimpleReferenceProblem | None = None
    tolerance: float | None = Field(default=None, gt=0)

    def to_durable_verification_plan(
        self,
        *,
        primary_metric: str,
        shots: int | None,
    ) -> VerificationPlan | None:
        """Emit a durable VerificationPlan, or None when nothing checkable remains.

        Drops a method whose reference the planner did not actually supply rather
        than emitting a plan the verifier could only fail. The fixed pipeline has no
        stage that can repair a missing reference — every candidate would fail
        identically — so the honest outcome is the weaker grade, which is exactly
        what the contract's own legacy-shape normalizers settle on.
        """

        methods = [
            method
            for method in dict.fromkeys(self.methods)
            if method in _SUPPORTED_REFERENCE_METHODS
        ]
        if "exact_diag" in methods and not self.reference_hamiltonian:
            methods.remove("exact_diag")
        if "brute_force" in methods and self.reference_problem is None:
            methods.remove("brute_force")
        if not methods:
            return None
        tolerance = self.tolerance
        if "exact_diag" in methods and shots is None and self.reference_hamiltonian:
            # Statevector expectation values have no sampling uncertainty. The
            # verifier's general 2%-of-Hamiltonian-scale optimizer allowance is
            # intentionally permissive for shot-based product runs, but it accepted
            # a live six-qubit VQE 0.067 above the exact energy as research-ready.
            # Tighten exact-expectation Plans to 0.5% of operator L1 scale while
            # retaining a small absolute floor for near-zero normalized operators.
            scale = sum(abs(term.coefficient) for term in self.reference_hamiltonian)
            exact_expectation_tolerance = max(1e-3, 0.005 * scale)
            tolerance = (
                exact_expectation_tolerance
                if tolerance is None
                else min(tolerance, exact_expectation_tolerance)
            )
        return VerificationPlan(
            methods=[VerificationMethod(method) for method in methods],
            reference_hamiltonian=(
                [
                    PauliTerm(coefficient=term.coefficient, pauli=term.pauli)
                    for term in self.reference_hamiltonian
                ]
                if "exact_diag" in methods and self.reference_hamiltonian
                else None
            ),
            reference_problem=(
                ReferenceProblem(
                    kind=self.reference_problem.kind,
                    num_variables=self.reference_problem.num_variables,
                    terms=[
                        ProblemTerm(i=term.i, j=term.j, weight=term.weight)
                        for term in self.reference_problem.terms
                    ],
                )
                if "brute_force" in methods and self.reference_problem is not None
                else None
            ),
            # The worker reads the declared tolerance under the metric-specific key
            # first, so keep the historical `<metric>_error_max` spelling rather than
            # inventing a second convention for the same number.
            thresholds=(
                {f"{primary_metric}_error_max": tolerance} if tolerance is not None else None
            ),
        )


class SimplePlan(_SimplePlanModel):
    """Only the information generation and bounded execution actually consume."""

    domain: str = Field(min_length=2)
    framework: Framework
    algorithm: Algorithm
    problem_summary: str = Field(min_length=5)
    algorithm_rationale: str = Field(min_length=5)
    parameters: SimplePlanParameters = Field(default_factory=SimplePlanParameters)
    qubits_estimate: int = Field(ge=1, le=27)
    # The default sandbox has a hard 120 s ceiling. Reserving 30 s for provider
    # setup/observation makes every Plan executable under the runtime it declares.
    expected_runtime_sec: int = Field(ge=1, le=90)
    success_criteria: SimpleSuccessCriteria
    expected_output_keys: list[str] = Field(min_length=1)
    artifact_contract: SimpleArtifactContract = Field(default_factory=SimpleArtifactContract)
    verification_plan: SimpleVerificationPlan | None = None

    @model_validator(mode="after")
    def _exact_diag_is_only_for_a_ground_state_metric(self) -> "SimplePlan":
        """Reject a reference whose units cannot match the reported metric.

        ``exact_diag`` computes the minimum eigenvalue of the declared Hamiltonian.
        It cannot independently verify a finite-time observable such as
        magnetization, fidelity, or transition probability. Letting such a Plan
        through deterministically sends every correct candidate into code repair,
        because the verifier compares quantities with different units.
        """

        verification = self.verification_plan
        if (
            verification is None
            or "exact_diag" not in verification.methods
            or not verification.reference_hamiltonian
        ):
            return self
        if self.algorithm is Algorithm.VQE:
            return self
        metric = self.success_criteria.primary_metric.strip().lower()
        description = f"{self.problem_summary} {self.algorithm_rationale}".lower()
        energy_metric = any(token in metric for token in ("energy", "eigenvalue"))
        ground_state_claim = any(
            phrase in description
            for phrase in (
                "ground state",
                "ground-state",
                "minimum eigenvalue",
                "lowest eigenvalue",
            )
        )
        if energy_metric and ground_state_claim:
            return self
        raise ValueError(
            "verification_plan.methods includes 'exact_diag', but exact_diag verifies "
            "only a reported Hamiltonian ground-state energy/minimum eigenvalue. It "
            f"cannot verify primary_metric {self.success_criteria.primary_metric!r}. "
            "For time evolution, magnetization, fidelity, or another observable, "
            "drop exact_diag and omit verification_plan unless an independent "
            "same-unit reference is available."
        )

    def to_durable_plan(
        self,
        *,
        selected_framework: Framework,
        requested_shots: int | None,
        requested_seed: int | None,
    ) -> Plan:
        """Translate into the compatible storage model without strict-plan fields."""

        keys = list(dict.fromkeys(key.strip() for key in self.expected_output_keys if key.strip()))
        metric = self.success_criteria.primary_metric.strip()
        if metric not in keys:
            # The simple contract checks RESULT keys after execution.  Normalizing
            # this harmless planner inconsistency is more useful than another model
            # round trip, and the generator sees the normalized durable Plan.
            keys.append(metric)
        parameters = self.parameters.model_dump(mode="python")
        if requested_shots is not None:
            parameters["shots"] = requested_shots
        if requested_seed is not None:
            parameters["seed"] = requested_seed
        expected_range = (
            self.success_criteria.expected_range.model_dump(exclude_none=True)
            if self.success_criteria.expected_range is not None
            else None
        )
        artifact_contract = self.artifact_contract.to_durable()
        promises_distribution = any(
            key.strip().lower() in {"counts", "measurement_counts", "results", "samples"}
            or any(
                token in key.strip().lower()
                for token in ("counts", "distribution", "histogram", "probabilities")
            )
            for key in keys
        )
        if (
            artifact_contract.measurement_policy is MeasurementPolicy.MEASURE_ALL
            and not promises_distribution
        ):
            # A common planner mistake is to demand measurements on a VQE/QAOA
            # ansatz while promising only an expectation value. Retrying the same
            # schema often repeats it and used to consume the whole run. Keep the
            # useful shape contract, but remove the unsupported all-qubit assertion.
            artifact_contract = artifact_contract.model_copy(
                update={"measurement_policy": MeasurementPolicy.ONLY_IF_REQUESTED}
            )
        return Plan(
            domain=self.domain,
            framework=selected_framework,
            algorithm=self.algorithm,
            problem_summary=self.problem_summary,
            algorithm_rationale=self.algorithm_rationale,
            parameters=PlanParameters.model_validate(parameters),
            qubits_estimate=self.qubits_estimate,
            expected_runtime_sec=self.expected_runtime_sec,
            success_criteria=SuccessCriteria(
                primary_metric=metric,
                expected_range=expected_range,
                additional_notes=self.success_criteria.additional_notes,
            ),
            expected_output_keys=keys,
            artifact_contract=artifact_contract,
            verification_plan=(
                self.verification_plan.to_durable_verification_plan(
                    primary_metric=metric,
                    shots=parameters.get("shots"),
                )
                if self.verification_plan is not None
                else None
            ),
        )


def parse_simple_plan(text: str) -> SimplePlan:
    """Parse one tolerant JSON object, leaving typed validation errors intact."""

    raw = extract_json(text)
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise StageOutputError(f"invalid JSON object: {exc}") from exc
    if isinstance(payload, dict):
        criteria = payload.get("success_criteria")
        if isinstance(criteria, dict) and isinstance(criteria.get("additional_notes"), str):
            payload = {
                **payload,
                "success_criteria": {
                    **criteria,
                    "additional_notes": [criteria["additional_notes"]],
                },
            }
    return SimplePlan.model_validate(payload)
