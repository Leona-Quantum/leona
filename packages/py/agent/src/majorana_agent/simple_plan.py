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
    ConstraintTerm,
    ExactDynamicsReference,
    ExactLindbladReference,
    ExactLinearSystemReference,
    ExactPhaseEstimationReference,
    IndexedPauliTerm,
    LinearConstraint,
    PauliFactor,
    PauliTerm,
    Plan,
    PlanParameters,
    ProblemTerm,
    ReferenceProblem,
    SuccessCriteria,
    VerificationPlan,
)
from majorana_llm import StageOutputError, extract_json
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class SimpleBusinessCoefficient(_SimplePlanModel):
    variable: int = Field(ge=0, lt=16)
    coefficient: float = Field(allow_inf_nan=False)


class SimpleBusinessQuadraticCoefficient(_SimplePlanModel):
    left: int = Field(ge=0, lt=16)
    right: int = Field(ge=0, lt=16)
    coefficient: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def _uses_two_distinct_variables(self) -> "SimpleBusinessQuadraticCoefficient":
        if self.left == self.right:
            raise ValueError("quadratic business coefficient must use distinct variables")
        return self


class SimpleBusinessObjective(_SimplePlanModel):
    direction: Literal["minimize", "maximize"]
    constant: float = Field(default=0.0, allow_inf_nan=False)
    linear_coefficients: list[SimpleBusinessCoefficient] = Field(default_factory=list)
    quadratic_coefficients: list[SimpleBusinessQuadraticCoefficient] = Field(default_factory=list)


class SimpleBusinessConstraint(_SimplePlanModel):
    coefficients: list[SimpleBusinessCoefficient] = Field(min_length=1)
    sense: Literal["le", "eq", "ge"]
    rhs: float = Field(allow_inf_nan=False)


class SimpleReferenceProblem(_SimplePlanModel):
    """Business metric and feasible set, never an internal penalty Hamiltonian."""

    num_variables: int = Field(ge=1, le=16)
    business_objective: SimpleBusinessObjective
    business_constraints: list[SimpleBusinessConstraint] = Field(default_factory=list)

    @model_validator(mode="after")
    def _indices_fit_the_declared_business_variables(self) -> "SimpleReferenceProblem":
        objective = self.business_objective
        if not objective.linear_coefficients and not objective.quadratic_coefficients:
            raise ValueError("business objective must contain at least one coefficient")
        indices = [term.variable for term in objective.linear_coefficients]
        indices.extend(
            index for term in objective.quadratic_coefficients for index in (term.left, term.right)
        )
        indices.extend(
            term.variable
            for constraint in self.business_constraints
            for term in constraint.coefficients
        )
        outside = [index for index in indices if index >= self.num_variables]
        if outside:
            raise ValueError(
                f"business coefficient variable {outside[0]} lies outside "
                f"0..{self.num_variables - 1}"
            )
        return self


class SimplePauliFactor(_SimplePlanModel):
    qubit: int = Field(ge=0, lt=8)
    pauli: Literal["X", "Y", "Z"]


class SimpleIndexedPauliTerm(_SimplePlanModel):
    coefficient: float = Field(allow_inf_nan=False)
    factors: list[SimplePauliFactor] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _each_qubit_appears_at_most_once(self) -> "SimpleIndexedPauliTerm":
        indices = [factor.qubit for factor in self.factors]
        if len(indices) != len(set(indices)):
            raise ValueError("indexed Pauli term contains duplicate qubit factors")
        return self


class SimpleExactDynamicsReference(_SimplePlanModel):
    """Narrow data shape for one deterministic finite-time scalar."""

    num_qubits: int = Field(ge=1, le=8)
    hamiltonian: list[SimpleIndexedPauliTerm] = Field(min_length=1)
    initial_basis_state: str = Field(min_length=1)
    evolution_time: float
    result_key: str = Field(min_length=1)
    metric: Literal["survival_probability", "observable_expectation"]
    observable: list[SimpleIndexedPauliTerm] | None = None


class SimpleVerificationPlan(_SimplePlanModel):
    """An independent ground truth the planner writes out, not a policy it selects.

    Deliberately only bounded checks that compare the run's own reported number
    against a reference computed from data the *plan* declares: `exact_diag`
    diagonalizes a stated Hamiltonian, `brute_force` enumerates a stated
    combinatorial instance, `exact_dynamics_reference` evolves one explicit
    computational-basis state under one small Pauli Hamiltonian, and
    `exact_lindblad_reference` evolves a small typed open system. None reads the
    candidate source, so none can be satisfied merely by printing a convenient value.

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
    reference_result_key: str | None = Field(
        default=None,
        description="RESULT key containing the energy checked by exact_diag",
    )
    reference_problem: SimpleReferenceProblem | None = None
    exact_dynamics_reference: SimpleExactDynamicsReference | None = None
    exact_lindblad_reference: ExactLindbladReference | None = None
    exact_linear_system_reference: ExactLinearSystemReference | None = None
    exact_phase_estimation_reference: ExactPhaseEstimationReference | None = None
    tolerance: float | None = Field(default=None, gt=0)

    @field_validator("tolerance", mode="before")
    @classmethod
    def _zero_tolerance_uses_the_deterministic_default(cls, value):
        # Structured planners commonly spell "no additional allowance" as 0.0.
        # Durable verifiers already derive a numerical floor, so zero cannot make
        # comparison stricter and should not discard an otherwise valid reference.
        # Negative values remain invalid through the field constraint.
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
            return None
        return value

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
        # The reference is optional independent evidence, not part of the requested
        # artifact. A planner can transcribe a valid exact evolution but bind it to a
        # secondary RESULT key while choosing a different primary metric. The durable
        # contract correctly rejects that mismatch, but retrying Plan cannot repair it
        # reliably and used to fail an otherwise executable task before generation.
        # Degrade to the remaining checks instead; never compare different scalars.
        exact_dynamics_reference = self.exact_dynamics_reference
        if (
            exact_dynamics_reference is not None
            and exact_dynamics_reference.result_key != primary_metric
        ):
            exact_dynamics_reference = None
        if "exact_diag" in methods and not self.reference_hamiltonian:
            methods.remove("exact_diag")
        if "brute_force" in methods and self.reference_problem is None:
            methods.remove("brute_force")
        if (
            not methods
            and exact_dynamics_reference is None
            and self.exact_lindblad_reference is None
            and self.exact_linear_system_reference is None
            and self.exact_phase_estimation_reference is None
        ):
            return None
        tolerance = self.tolerance
        if "exact_diag" in methods and shots is None and self.reference_hamiltonian:
            # Statevector expectation values have no sampling uncertainty. A 0.5%
            # Plan allowance still accepted an observed three-qubit VQE 0.007 above
            # exact truth. Use the verifier's scale-aware numerical/termination
            # allowance: one part per million with a unit-scale floor. This is based
            # on execution semantics, not a task instance or expected answer.
            scale = sum(abs(term.coefficient) for term in self.reference_hamiltonian)
            exact_expectation_tolerance = 1e-6 * max(1.0, scale)
            tolerance = (
                exact_expectation_tolerance
                if tolerance is None
                else min(tolerance, exact_expectation_tolerance)
            )
        return VerificationPlan(
            # Exact dynamics/open-system references strengthen the unconditional
            # success-criteria check without adding a VerificationMethod/DB enum or
            # claiming a stronger evidence grade. A durable VerificationPlan still
            # needs one method, so use return-contract when one of these is the only
            # reference.
            methods=(
                [VerificationMethod(method) for method in methods]
                if methods
                else [VerificationMethod.RETURN_CONTRACT]
            ),
            reference_hamiltonian=(
                [
                    PauliTerm(coefficient=term.coefficient, pauli=term.pauli)
                    for term in self.reference_hamiltonian
                ]
                if "exact_diag" in methods and self.reference_hamiltonian
                else None
            ),
            reference_result_key=(self.reference_result_key if "exact_diag" in methods else None),
            exact_dynamics_reference=(
                ExactDynamicsReference(
                    num_qubits=exact_dynamics_reference.num_qubits,
                    hamiltonian=[
                        IndexedPauliTerm(
                            coefficient=term.coefficient,
                            factors=[
                                PauliFactor(qubit=factor.qubit, pauli=factor.pauli)
                                for factor in term.factors
                            ],
                        )
                        for term in exact_dynamics_reference.hamiltonian
                    ],
                    initial_basis_state=exact_dynamics_reference.initial_basis_state,
                    evolution_time=exact_dynamics_reference.evolution_time,
                    result_key=exact_dynamics_reference.result_key,
                    metric=exact_dynamics_reference.metric,
                    observable=(
                        [
                            IndexedPauliTerm(
                                coefficient=term.coefficient,
                                factors=[
                                    PauliFactor(qubit=factor.qubit, pauli=factor.pauli)
                                    for factor in term.factors
                                ],
                            )
                            for term in exact_dynamics_reference.observable
                        ]
                        if exact_dynamics_reference.observable is not None
                        else None
                    ),
                )
                if exact_dynamics_reference is not None
                else None
            ),
            exact_lindblad_reference=self.exact_lindblad_reference,
            exact_linear_system_reference=self.exact_linear_system_reference,
            exact_phase_estimation_reference=self.exact_phase_estimation_reference,
            reference_problem=(
                ReferenceProblem(
                    # The LLM-facing boundary states the reported business metric
                    # directly. The durable enumerator's QUBO form is only a compact
                    # storage/evaluation representation, never a penalty Hamiltonian.
                    kind="qubo",
                    num_variables=self.reference_problem.num_variables,
                    terms=[
                        ProblemTerm(
                            i=term.variable,
                            j=term.variable,
                            weight=term.coefficient,
                        )
                        for term in self.reference_problem.business_objective.linear_coefficients
                    ]
                    + [
                        ProblemTerm(
                            i=term.left,
                            j=term.right,
                            weight=term.coefficient,
                        )
                        for term in (
                            self.reference_problem.business_objective.quadratic_coefficients
                        )
                    ],
                    offset=self.reference_problem.business_objective.constant,
                    objective=self.reference_problem.business_objective.direction,
                    constraints=[
                        LinearConstraint(
                            terms=[
                                ConstraintTerm(
                                    i=term.variable,
                                    weight=term.coefficient,
                                )
                                for term in constraint.coefficients
                            ],
                            sense=constraint.sense,
                            rhs=constraint.rhs,
                        )
                        for constraint in self.reference_problem.business_constraints
                    ],
                )
                if "brute_force" in methods and self.reference_problem is not None
                else None
            ),
            # The worker reads the declared tolerance under the metric-specific key
            # first, so keep the historical `<metric>_error_max` spelling rather than
            # inventing a second convention for the same number.
            thresholds=(
                {f"{self.reference_result_key or primary_metric}_error_max": tolerance}
                if tolerance is not None
                else None
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
        if not verification.reference_result_key:
            raise ValueError(
                "exact_diag requires verification_plan.reference_result_key naming the "
                "RESULT energy scalar"
            )
        if verification.reference_result_key not in self.expected_output_keys:
            raise ValueError(
                "verification_plan.reference_result_key must be one of expected_output_keys"
            )
        metric = verification.reference_result_key.strip().lower()
        description = f"{self.problem_summary} {self.algorithm_rationale}".lower()
        # VQE implementations often call the candidate scalar an expectation rather
        # than an energy. It is still the quantity exact_diag must check. Conversely,
        # a classically diagonalized ground energy is a baseline even when its key
        # omits the word "exact".
        energy_metric = any(token in metric for token in ("energy", "eigenvalue", "expectation"))
        derived_or_baseline_metric = any(
            token in metric
            for token in (
                "error",
                "difference",
                "delta",
                "fidelity",
                "variance",
                "exact",
                "baseline",
                "reference",
                "dense_ground",
                "diagonalized",
                "diagonalised",
                "eigensolver",
                "ground_truth",
            )
        )
        if self.algorithm is Algorithm.VQE and energy_metric and not derived_or_baseline_metric:
            return self
        ground_state_claim = any(
            phrase in description
            for phrase in (
                "ground state",
                "ground-state",
                "minimum eigenvalue",
                "lowest eigenvalue",
            )
        )
        if energy_metric and not derived_or_baseline_metric and ground_state_claim:
            return self
        raise ValueError(
            "verification_plan.methods includes 'exact_diag', but exact_diag verifies "
            "only a reported Hamiltonian ground-state energy/minimum eigenvalue. It "
            f"cannot verify reference_result_key {verification.reference_result_key!r}. "
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
