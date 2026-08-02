"""Plan model — the planner LLM's structured output, verified before execution.
Modernized from the legacy nameko plan-schema (Archive); qubit ceiling is the
27-qubit default sandbox lane (memory/DECISIONS.md 2026-07-09)."""

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator

from .enums import (
    Algorithm,
    ArtifactType,
    Framework,
    MeasurementPolicy,
    Optimizer,
    PlannableVerificationMethod,
    TopLevelExecution,
    VerificationMethod,
)


class _PlanBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


# Key names that promise a measurement distribution in the result dict, and so
# can satisfy a statistical check. The first four mirror
# majorana_verification.methods._COUNTS_FALLBACK_KEYS — the names extract_counts
# looks under after the plan's own keys. They are duplicated rather than imported
# because verification depends on contracts, not the other way round;
# packages/py/verification/tests pins the two lists against drift.
_DISTRIBUTION_KEY_NAMES = frozenset({"counts", "measurement_counts", "results", "samples"})
_DISTRIBUTION_KEY_TOKENS = ("counts", "distribution", "histogram", "probabilities")

# Legacy exact-verifier ceiling, retained while the worker's historical exact helper
# still imports it. New Plans cannot select exact and no Plan field uses this value.
EXACT_MAX_QUBITS = 10

# Ceiling for `exact_diag`, mirroring majorana_verification.hamiltonian's own
# EXACT_DIAG_MAX_QUBITS. Duplicated rather than imported for the same reason as
# _DISTRIBUTION_KEY_NAMES above — verification depends on contracts, not the other
# way round — and packages/py/verification/tests pins the two against drift.
EXACT_DIAG_MAX_QUBITS = 10

# Ceiling for `brute_force`, mirroring majorana_verification.baseline's own
# BRUTE_FORCE_MAX_VARIABLES. Same duplication story and the same drift pin in
# packages/py/verification/tests.
BRUTE_FORCE_MAX_VARIABLES = 16

# Ceiling for the dense exact finite-time reference. This is deliberately lower
# than exact_diag's ceiling: the dynamics check needs eigenvectors and several
# dense matrix-vector products, not only eigenvalues. The verifier pins this
# duplicate against drift.
EXACT_DYNAMICS_MAX_QUBITS = 8

# The Liouvillian acts on a 4**n-dimensional vectorized density matrix. Three
# qubits keeps the exact matrix exponential small (64x64) and deterministic.
EXACT_LINDBLAD_MAX_QUBITS = 3

# Exact dyadic QPE uses only integer arithmetic over the counting register. Sixteen
# bits keeps RESULT counts and integer conversion bounded without excluding normal
# simulator workloads.
EXACT_QPE_MAX_COUNTING_QUBITS = 16

# Dense classical solve used only as an independent baseline for simulator-scale
# quantum linear-system tasks. HHL needs a power-of-two dimension.
EXACT_LINEAR_SYSTEM_MAX_DIMENSION = 8


def _promises_distribution(key: str) -> bool:
    """Whether an expected_output_key names a measurement distribution.

    Name-based by necessity: at plan time there is no result dict to inspect, only
    the keys the plan promises to print.
    """
    normalized = key.strip().lower()
    if normalized in _DISTRIBUTION_KEY_NAMES:
        return True
    return any(token in normalized for token in _DISTRIBUTION_KEY_TOKENS)


class SuccessCriteria(_PlanBase):
    primary_metric: str = Field(
        description="Key extracted from the run's result dict, e.g. ground_state_energy_Ha"
    )
    expected_range: dict[str, float] | None = Field(
        default=None,
        description=(
            "Bound on primary_metric's value, checked with the literal keys "
            '"min" and/or "max", e.g. {"min": 0.99} or {"min": 0.0, "max": 0.15}. '
            "Either key may be omitted to leave that side unbounded; any other "
            "key is ignored by the evaluator, so do not invent named bounds."
        ),
    )
    additional_notes: list[str] | None = None


class PlanParameters(_PlanBase):
    shots: int | None = Field(default=None, ge=1, le=20000)
    seed: int | None = Field(
        default=None,
        ge=0,
        le=2**31 - 1,
        description=(
            "Random seed for sampling. When present, the generated code must seed "
            "the framework's sampler with exactly this value so the run reproduces."
        ),
    )
    optimizer: Optimizer | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=500)
    custom: dict[str, Any] | None = Field(
        default=None,
        description="Domain-specific free parameters, e.g. {molecule: 'H2', bond_length: 0.735}",
    )


class ArtifactContract(_PlanBase):
    artifact_type: ArtifactType
    entry_point: str | None = Field(
        default=None, description="Function/class name to implement, if requested"
    )
    expected_return_type: str | None = Field(
        default=None, description="e.g. QuantumCircuit, dict[str, int], Statevector"
    )
    return_shape: str | None = Field(
        default=None, description="Structural constraints: keys, array length, bitstring format"
    )
    measurement_policy: MeasurementPolicy
    top_level_execution: TopLevelExecution


class PauliTerm(_PlanBase):
    """One `coefficient * PauliString` term of a Hamiltonian, as data.

    The reference for `exact_diag` is declared data, never executable code. A
    Hamiltonian written as framework code would have to run in the sandbox to mean
    anything, which would make model-authored code the ground truth.
    """

    coefficient: float = Field(
        description="Real coefficient. Complex Hamiltonians are not supported; "
        "express them in a real Pauli basis."
    )
    pauli: str = Field(
        min_length=1,
        max_length=EXACT_DIAG_MAX_QUBITS,
        pattern="^[IXYZixyz]+$",
        description=(
            "Pauli string over I, X, Y, Z with one character per qubit, qubit 0 "
            "leftmost. 'ZI' is Z on qubit 0; 'XX' is X on both. Every term in a "
            "Hamiltonian must be the same length."
        ),
    )


class PauliFactor(_PlanBase):
    """One non-identity factor in a sparse Pauli product."""

    qubit: int = Field(
        ge=0,
        lt=EXACT_DYNAMICS_MAX_QUBITS,
        description="0-based qubit index, with q0 the leftmost tensor factor.",
    )
    pauli: Literal["X", "Y", "Z"] = Field(
        description="Non-identity Pauli acting on this qubit. Identity factors are omitted."
    )


class IndexedPauliTerm(_PlanBase):
    """One real Pauli term written only on the qubits where it acts.

    An empty factor list is the identity term. The worker, rather than the model,
    pads every other qubit with identity before dense evaluation. This removes a
    transcription step that is especially error-prone for sparse operators.
    """

    coefficient: float = Field(allow_inf_nan=False)
    factors: list[PauliFactor] = Field(
        default_factory=list,
        max_length=EXACT_DYNAMICS_MAX_QUBITS,
    )

    @model_validator(mode="after")
    def _each_qubit_appears_at_most_once(self) -> "IndexedPauliTerm":
        indices = [factor.qubit for factor in self.factors]
        if len(indices) != len(set(indices)):
            raise ValueError("indexed Pauli term contains duplicate qubit factors")
        return self


class ExactDynamicsReference(_PlanBase):
    """One scalar from bounded exact Pauli-Hamiltonian time evolution.

    The model transcribes data; the worker independently constructs the dense
    matrices and evolves the declared basis state. This is intentionally narrower
    than general quantum dynamics so unsupported requests fail honestly instead of
    being coerced into a superficially similar metric.
    """

    num_qubits: int = Field(
        ge=1,
        le=EXACT_DYNAMICS_MAX_QUBITS,
        description="Register width shared by the state, Hamiltonian, and observable.",
    )
    hamiltonian: list[IndexedPauliTerm] = Field(
        min_length=1,
        max_length=256,
        description=(
            "Real sparse Pauli decomposition of H in U=exp(-i*t*H). Each term "
            "lists only non-identity factors by qubit index; an empty list is identity."
        ),
    )
    initial_basis_state: str = Field(
        min_length=1,
        max_length=EXACT_DYNAMICS_MAX_QUBITS,
        pattern="^[01]+$",
        description=(
            "Computational-basis state written q0 first, matching the Pauli-string "
            "tensor convention; for example '0101' means |q0 q1 q2 q3>."
        ),
    )
    evolution_time: float = Field(
        allow_inf_nan=False,
        description="Finite real t in U=exp(-i*t*H), in the request's units.",
    )
    result_key: str = Field(
        min_length=1,
        description=(
            "Top-level protected RESULT key this one scalar verifies; it must equal "
            "Plan.success_criteria.primary_metric."
        ),
    )
    metric: Literal["survival_probability", "observable_expectation"]
    observable: list[IndexedPauliTerm] | None = Field(
        default=None,
        min_length=1,
        max_length=256,
        description=(
            "Hermitian real Pauli sum whose expectation is requested after evolution. "
            "Required only for observable_expectation and absent for survival_probability."
        ),
    )

    @model_validator(mode="after")
    def _operators_and_state_share_one_bounded_register(self) -> "ExactDynamicsReference":
        if len(self.initial_basis_state) != self.num_qubits:
            raise ValueError(
                "exact_dynamics_reference.initial_basis_state must contain one bit "
                f"per declared qubit ({self.num_qubits})"
            )
        for name, terms in (
            ("hamiltonian", self.hamiltonian),
            ("observable", self.observable or []),
        ):
            for term in terms:
                outside = [
                    factor.qubit for factor in term.factors if factor.qubit >= self.num_qubits
                ]
                if outside:
                    raise ValueError(
                        f"exact_dynamics_reference.{name} factor q{outside[0]} lies outside "
                        f"the declared {self.num_qubits}-qubit register"
                    )
        if self.metric == "survival_probability":
            if self.observable is not None:
                raise ValueError(
                    "survival_probability does not use exact_dynamics_reference.observable"
                )
            return self
        if not self.observable:
            raise ValueError("observable_expectation requires exact_dynamics_reference.observable")
        return self


class ExactPhaseEstimationReference(_PlanBase):
    """Noiseless QPE reference for a phase exactly representable by the register.

    This is intentionally not a general finite-precision QPE oracle. If the phase is
    not dyadic at the declared width, its sinc-like output distribution needs a
    different statistical specification and this reference must be omitted.
    """

    counting_qubits: int = Field(ge=1, le=EXACT_QPE_MAX_COUNTING_QUBITS)
    eigenphase: float = Field(
        ge=0.0,
        lt=1.0,
        allow_inf_nan=False,
        description="Eigenphase phi in U|psi>=exp(2*pi*i*phi)|psi>.",
    )
    phase_integer_result_key: str = Field(min_length=1)
    phase_estimate_result_key: str = Field(min_length=1)
    peak_probability_result_key: str = Field(min_length=1)
    counts_result_key: str = Field(min_length=1)

    @model_validator(mode="after")
    def _phase_and_result_contract_are_exact(self) -> "ExactPhaseEstimationReference":
        scaled = self.eigenphase * (1 << self.counting_qubits)
        if not math.isclose(scaled, round(scaled), rel_tol=0.0, abs_tol=1e-10):
            raise ValueError(
                "exact_phase_estimation_reference requires an eigenphase exactly "
                "representable by the declared counting register"
            )
        keys = {
            self.phase_integer_result_key,
            self.phase_estimate_result_key,
            self.peak_probability_result_key,
            self.counts_result_key,
        }
        if len(keys) != 4:
            raise ValueError("exact_phase_estimation_reference RESULT keys must be unique")
        return self


class LinearSystemResultSpec(_PlanBase):
    """One scalar derived from an exact real linear-system solution."""

    result_key: str = Field(min_length=1)
    metric: Literal[
        "normalized_solution_component",
        "solution_component",
        "component_ratio",
        "residual_norm",
        "state_fidelity",
    ]
    index: int | None = Field(default=None, ge=0, lt=EXACT_LINEAR_SYSTEM_MAX_DIMENSION)
    numerator_index: int | None = Field(default=None, ge=0, lt=EXACT_LINEAR_SYSTEM_MAX_DIMENSION)
    denominator_index: int | None = Field(default=None, ge=0, lt=EXACT_LINEAR_SYSTEM_MAX_DIMENSION)

    @model_validator(mode="after")
    def _indices_match_the_metric(self) -> "LinearSystemResultSpec":
        if self.metric in {"normalized_solution_component", "solution_component"}:
            if (
                self.index is None
                or self.numerator_index is not None
                or self.denominator_index is not None
            ):
                raise ValueError(f"{self.metric} requires only index")
            return self
        if self.metric == "component_ratio":
            if (
                self.index is not None
                or self.numerator_index is None
                or self.denominator_index is None
            ):
                raise ValueError("component_ratio requires numerator_index and denominator_index")
            return self
        if any(
            value is not None
            for value in (self.index, self.numerator_index, self.denominator_index)
        ):
            raise ValueError(f"{self.metric} does not use component indices")
        return self


class ExactLinearSystemReference(_PlanBase):
    """Bounded real-symmetric linear system checked independently with a dense solve."""

    matrix: list[list[FiniteFloat]] = Field(
        min_length=2,
        max_length=EXACT_LINEAR_SYSTEM_MAX_DIMENSION,
    )
    rhs: list[FiniteFloat] = Field(
        min_length=2,
        max_length=EXACT_LINEAR_SYSTEM_MAX_DIMENSION,
    )
    results: list[LinearSystemResultSpec] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def _shape_symmetry_and_result_indices_are_bounded(self) -> "ExactLinearSystemReference":
        dimension = len(self.matrix)
        if dimension & (dimension - 1):
            raise ValueError("exact_linear_system_reference dimension must be a power of two")
        if len(self.rhs) != dimension or any(len(row) != dimension for row in self.matrix):
            raise ValueError(
                "exact_linear_system_reference matrix must be square and match rhs length"
            )
        for row in range(dimension):
            for column in range(row + 1, dimension):
                if not math.isclose(
                    float(self.matrix[row][column]),
                    float(self.matrix[column][row]),
                    rel_tol=0.0,
                    abs_tol=1e-12,
                ):
                    raise ValueError("exact_linear_system_reference matrix must be symmetric")
        keys = [result.result_key for result in self.results]
        if len(keys) != len(set(keys)):
            raise ValueError("exact_linear_system_reference result keys must be unique")
        for result in self.results:
            indices = [
                index
                for index in (
                    result.index,
                    result.numerator_index,
                    result.denominator_index,
                )
                if index is not None
            ]
            if any(index >= dimension for index in indices):
                raise ValueError(
                    "exact_linear_system_reference result index lies outside the matrix"
                )
        return self


class ComplexCoefficient(_PlanBase):
    """One finite complex scalar represented without JSON-specific conventions."""

    real: float = Field(allow_inf_nan=False)
    imag: float = Field(default=0.0, allow_inf_nan=False)


class LindbladFactor(_PlanBase):
    """One non-identity local factor in a sparse open-system operator."""

    qubit: int = Field(ge=0, lt=EXACT_LINDBLAD_MAX_QUBITS)
    operator: Literal[
        "X",
        "Y",
        "Z",
        "lowering",
        "raising",
        "projector_zero",
        "projector_one",
    ]


class LindbladOperatorTerm(_PlanBase):
    """One complex tensor-product term; an empty factor list is identity."""

    coefficient: ComplexCoefficient
    factors: list[LindbladFactor] = Field(
        default_factory=list,
        max_length=EXACT_LINDBLAD_MAX_QUBITS,
    )

    @model_validator(mode="after")
    def _each_qubit_appears_at_most_once(self) -> "LindbladOperatorTerm":
        indices = [factor.qubit for factor in self.factors]
        if len(indices) != len(set(indices)):
            raise ValueError("Lindblad operator term contains duplicate qubit factors")
        return self


class LindbladOperator(_PlanBase):
    """A finite complex sum of sparse tensor-product operator terms."""

    terms: list[LindbladOperatorTerm] = Field(min_length=1, max_length=64)


class LindbladDissipator(_PlanBase):
    """The literal multiplier of D[L] in a time-independent master equation."""

    rate: float = Field(gt=0, allow_inf_nan=False)
    jump: LindbladOperator


class LindbladResultSpec(_PlanBase):
    """One protected RESULT scalar derived from the evolved density matrix."""

    result_key: str = Field(min_length=1)
    metric: Literal[
        "population",
        "density_element_real",
        "density_element_imag",
        "purity",
        "observable_expectation",
    ]
    basis_state: str | None = Field(default=None, pattern="^[01]+$")
    row_state: str | None = Field(default=None, pattern="^[01]+$")
    column_state: str | None = Field(default=None, pattern="^[01]+$")
    observable: LindbladOperator | None = None

    @model_validator(mode="after")
    def _metric_has_exactly_its_required_target(self) -> "LindbladResultSpec":
        if self.metric == "population":
            if self.basis_state is None or any(
                value is not None for value in (self.row_state, self.column_state, self.observable)
            ):
                raise ValueError("population requires only basis_state")
        elif self.metric in {"density_element_real", "density_element_imag"}:
            if (
                self.row_state is None
                or self.column_state is None
                or self.basis_state is not None
                or self.observable is not None
            ):
                raise ValueError("density element metrics require only row_state and column_state")
        elif self.metric == "observable_expectation":
            if self.observable is None or any(
                value is not None for value in (self.basis_state, self.row_state, self.column_state)
            ):
                raise ValueError("observable_expectation requires only observable")
        elif any(
            value is not None
            for value in (self.basis_state, self.row_state, self.column_state, self.observable)
        ):
            raise ValueError("purity does not use a target field")
        return self


class ExactLindbladReference(_PlanBase):
    """Bounded exact evolution under one time-independent Lindblad generator."""

    num_qubits: int = Field(ge=1, le=EXACT_LINDBLAD_MAX_QUBITS)
    initial_product_state: list[Literal["zero", "one", "plus", "minus", "plus_i", "minus_i"]] = (
        Field(min_length=1, max_length=EXACT_LINDBLAD_MAX_QUBITS)
    )
    hamiltonian: LindbladOperator | None = None
    dissipators: list[LindbladDissipator] = Field(min_length=1, max_length=32)
    evolution_time: float = Field(ge=0, allow_inf_nan=False)
    results: list[LindbladResultSpec] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def _all_data_uses_the_declared_register(self) -> "ExactLindbladReference":
        if len(self.initial_product_state) != self.num_qubits:
            raise ValueError("initial_product_state must contain one state per qubit")
        keys = [result.result_key for result in self.results]
        if len(keys) != len(set(keys)):
            raise ValueError("exact_lindblad_reference result keys must be unique")
        operators = [dissipator.jump for dissipator in self.dissipators]
        if self.hamiltonian is not None:
            operators.append(self.hamiltonian)
        operators.extend(
            result.observable for result in self.results if result.observable is not None
        )
        for operator in operators:
            for term in operator.terms:
                outside = [
                    factor.qubit for factor in term.factors if factor.qubit >= self.num_qubits
                ]
                if outside:
                    raise ValueError(
                        f"Lindblad factor q{outside[0]} lies outside the declared "
                        f"{self.num_qubits}-qubit register"
                    )
        for result in self.results:
            for state in (result.basis_state, result.row_state, result.column_state):
                if state is not None and len(state) != self.num_qubits:
                    raise ValueError(
                        f"Lindblad result {result.result_key!r} state must contain "
                        f"{self.num_qubits} bits"
                    )
        return self


class ProblemTerm(_PlanBase):
    """One weighted term of a combinatorial instance, as data.

    The reference for `brute_force` is declared data, never executed. An instance
    written as framework code would have to run in the sandbox to mean anything,
    making model-authored code the ground truth.
    """

    i: int = Field(
        ge=0,
        lt=BRUTE_FORCE_MAX_VARIABLES,
        description="First variable index, 0-based.",
    )
    j: int = Field(
        ge=0,
        lt=BRUTE_FORCE_MAX_VARIABLES,
        description=(
            "Second variable index, 0-based. For maxcut this must differ from i "
            "(an edge joins two distinct nodes); for qubo, i == j declares the "
            "linear coefficient of x_i."
        ),
    )
    weight: float = Field(
        allow_inf_nan=False,
        description="Real weight of this edge (maxcut) or coefficient (qubo).",
    )


class ConstraintTerm(_PlanBase):
    """One coefficient of a linear constraint over binary decision variables."""

    i: int = Field(
        ge=0,
        lt=BRUTE_FORCE_MAX_VARIABLES,
        description="Binary variable index, 0-based.",
    )
    weight: float = Field(
        allow_inf_nan=False,
        description="Finite coefficient multiplying x_i in the constraint's left side.",
    )


class LinearConstraint(_PlanBase):
    """A bounded linear condition the brute-force reference applies to assignments."""

    terms: list[ConstraintTerm] = Field(min_length=1, max_length=512)
    sense: Literal["le", "eq", "ge"] = Field(
        description="Comparison between sum(weight_i*x_i) and rhs: <=, ==, or >=."
    )
    rhs: float = Field(allow_inf_nan=False)


class ReferenceProblem(_PlanBase):
    """The combinatorial instance the `brute_force` check enumerates."""

    kind: Literal["maxcut", "qubo"]
    num_variables: int = Field(
        ge=1,
        le=BRUTE_FORCE_MAX_VARIABLES,
        description=(
            "Number of binary variables (graph nodes for maxcut). The check "
            f"enumerates all 2**n assignments, so at most {BRUTE_FORCE_MAX_VARIABLES}."
        ),
    )
    terms: list[ProblemTerm] = Field(
        min_length=1,
        max_length=512,
        description=(
            "maxcut: the weighted edge list; the objective is the MAXIMUM total "
            "weight of edges whose endpoints fall on opposite sides. qubo: the "
            "coefficients of sum(w_ij * x_i * x_j); the objective is the MINIMUM. "
            "Duplicate index pairs add their weights."
        ),
    )
    offset: float = Field(
        default=0.0,
        allow_inf_nan=False,
        description=(
            "Constant added to every objective value. Include constants introduced "
            "when expanding penalties such as P*(sum(x)-k)^2."
        ),
    )
    objective: Literal["minimize", "maximize"] | None = Field(
        default=None,
        description=(
            "Optimization direction. Omit for legacy semantics: maxcut maximizes and "
            "qubo minimizes. Set explicitly when a QUBO-shaped linear/quadratic "
            "objective is reported in maximization units."
        ),
    )
    constraints: list[LinearConstraint] = Field(
        default_factory=list,
        max_length=32,
        description=(
            "Linear feasibility conditions over the declared decision variables. "
            "Use these for capacity, cardinality, budget, and assignment constraints "
            "instead of enumerating an unconstrained surrogate."
        ),
    )


class StatePreparationClaim(_PlanBase):
    """Typed Bell/GHZ target accepted by semantic review before strict checks.

    The Plan records the requested relative phase as data; it is not correctness
    authority by itself. The semantic reviewer owns request-to-Plan alignment,
    then the fixed verifier compares native evidence with this bounded target.
    """

    family: Literal["bell", "ghz"]
    qubits: int = Field(ge=2, le=12)
    relative_phase_radians: float = Field(
        default=0.0,
        allow_inf_nan=False,
        description=(
            "Relative phase phi in (|0...0> + exp(i*phi)|1...1>)/sqrt(2). "
            "Semantic review must confirm that phi reflects the user's request."
        ),
    )
    measurement_binding: Literal["identity_when_present"] = "identity_when_present"


class VerificationPlan(_PlanBase):
    methods: list[VerificationMethod] = Field(
        min_length=1,
        description="Verification primitives to run against the generated code",
        # Narrow the *schema* the planner decodes against without narrowing the
        # runtime type: the worker's dispatch loop compares these with `is`
        # against VerificationMethod members, and a member of a different enum —
        # even one with an equal value — would fail every identity check and
        # report every result as "required evidence unavailable".
        json_schema_extra={
            "items": {"enum": [method.value for method in PlannableVerificationMethod]}
        },
    )

    expected_metrics: list[str] | None = Field(
        default=None, description="Metrics the verification result dict must contain"
    )
    thresholds: dict[str, float] | None = Field(
        default=None, description="Pass thresholds per metric, e.g. {fidelity_min: 0.999}"
    )
    reference_method: str | None = Field(
        default=None, description="Independent reference, e.g. exact diagonalization"
    )
    reference_hamiltonian: list[PauliTerm] | None = Field(
        default=None,
        max_length=256,
        description=(
            "The Hamiltonian the 'exact_diag' check diagonalizes, required when "
            "'exact_diag' is listed. Write the operator the task actually names, in "
            "a real Pauli basis, one term per entry — not a transcription of the "
            "code you expect back. success_criteria.primary_metric must name the "
            "result key holding the energy the run reports."
        ),
    )
    reference_result_key: str | None = Field(
        default=None,
        description=(
            "RESULT key compared with the exact ground-state energy. Required for new "
            "exact_diag Plans; legacy stored Plans fall back to success_criteria.primary_metric."
        ),
    )
    reference_problem: ReferenceProblem | None = Field(
        default=None,
        description=(
            "The combinatorial instance the 'brute_force' check enumerates, "
            "required when 'brute_force' is listed. Write the instance the task "
            "actually names — the graph's weighted edges, the QUBO's coefficients "
            "— not a transcription of the code you expect back. "
            "success_criteria.primary_metric must name the result key holding the "
            "objective value the run reports."
        ),
    )
    exact_dynamics_reference: ExactDynamicsReference | None = Field(
        default=None,
        description=(
            "Optional bounded exact-time-evolution reference for success_criteria. "
            "Use only for one explicit real Pauli Hamiltonian, a computational-basis "
            "initial state, exact U=exp(-i*t*H), and either survival probability or "
            "an explicit real-Pauli observable expectation. It is not a general "
            "replacement for echoes, OTOCs, thermal traces, channels, or product formulas."
        ),
    )
    exact_lindblad_reference: ExactLindbladReference | None = Field(
        default=None,
        description=(
            "Optional bounded exact open-system reference. Use only for at most three "
            "qubits, a written product initial state, one time-independent Lindblad "
            "generator, and scalar density-matrix results represented by the typed schema."
        ),
    )
    exact_phase_estimation_reference: ExactPhaseEstimationReference | None = Field(
        default=None,
        description=(
            "Optional bounded exact-QPE reference for a noiseless eigenphase exactly "
            "representable by the declared counting register. It checks the reported "
            "integer, phase, peak probability, and protected count distribution."
        ),
    )
    exact_linear_system_reference: ExactLinearSystemReference | None = Field(
        default=None,
        description=(
            "Optional bounded real-symmetric linear-system reference. The worker "
            "independently solves the declared matrix and rhs and checks bound scalar "
            "components, ratios, residual, or state fidelity."
        ),
    )
    state_preparation_claim: StatePreparationClaim | None = Field(
        default=None,
        description=(
            "Explicit Bell/GHZ target for the fixed native-state property verifier. "
            "Omission means that state-preparation correctness is unsupported, not "
            "that the canonical positive-phase target may be inferred."
        ),
    )
    feedback_policy: str | None = Field(
        default=None, description="What to minimally fix and re-verify on failure"
    )
    forbidden_operations: list[str] | None = Field(
        default=None, description="APIs/side effects the code must not use"
    )
    required_invariants: list[str] | None = Field(
        default=None, description="Invariants that must survive any repair iteration"
    )

    @model_validator(mode="before")
    @classmethod
    def _drop_exact_diag_with_no_reference_at_all(cls, value: Any) -> Any:
        """Legacy shape, and only the legacy shape: `exact_diag` with no Hamiltonian.

        `exact_diag` was in VerificationMethod from migration 0001 but never in the
        planner's schema, so `_drop_unplannable_methods` below normalized it away
        and stored plans carrying it were parsed fine. Making it plannable turns
        those same rows into hard validation errors — and every durable plan
        revision re-validates as `Plan` when it is loaded. A run
        resuming across this deploy would die on a plan that used to parse.

        So the absent case normalizes to yesterday's behaviour: drop the method,
        run without the check. That is a weaker outcome, not a wrong one — the run
        grades exactly as it would have before this feature existed.

        A payload that DOES carry `reference_hamiltonian` has clearly asked for the
        check, and every way of getting it wrong from there stays a hard error with
        a corrective objection: ragged strings, too many qubits, a metric the code
        never prints. That is where the planner retry can actually help, and where
        silently deleting a verification the plan asked for would be the
        `_statistical_needs_distribution_evidence` mistake.
        """
        if not isinstance(value, dict):
            return value
        if value.get("reference_hamiltonian") is not None:
            return value
        methods = value.get("methods")
        if not isinstance(methods, list):
            return value
        if not any(str(item) == VerificationMethod.EXACT_DIAG for item in methods):
            return value
        remaining = [item for item in methods if str(item) != VerificationMethod.EXACT_DIAG]
        # min_length=1 still rejects a genuinely empty list; only a list emptied by
        # this normalization gets the fallback the retired-method path also uses.
        return {
            **value,
            "methods": remaining or [VerificationMethod.RETURN_CONTRACT.value],
        }

    @model_validator(mode="before")
    @classmethod
    def _drop_brute_force_with_no_problem_at_all(cls, value: Any) -> Any:
        """Legacy shape, and only the legacy shape: `brute_force` with no instance.

        The same rehydration hazard `_drop_exact_diag_with_no_reference_at_all`
        exists for: `brute_force` was in VerificationMethod from migration 0001
        but never plannable, so `_drop_unplannable_methods` normalized it away and
        stored plans carrying it parsed fine. Making it plannable turns those rows
        into hard validation errors, and every durable plan revision re-validates
        as `Plan` when loaded — a run resuming across this deploy would die on a plan that
        used to parse. The absent case normalizes to yesterday's behaviour: drop
        the method, run without the check.

        A payload that DOES carry `reference_problem` has clearly asked for the
        check, and every way of getting it wrong from there stays a hard error
        with a corrective objection the planner retry can act on.
        """
        if not isinstance(value, dict):
            return value
        if value.get("reference_problem") is not None:
            return value
        methods = value.get("methods")
        if not isinstance(methods, list):
            return value
        if not any(str(item) == VerificationMethod.BRUTE_FORCE for item in methods):
            return value
        remaining = [item for item in methods if str(item) != VerificationMethod.BRUTE_FORCE]
        return {
            **value,
            "methods": remaining or [VerificationMethod.RETURN_CONTRACT.value],
        }

    @field_validator("methods", mode="before")
    @classmethod
    def _drop_unplannable_methods(cls, value: Any) -> Any:
        """Silently discard retired methods instead of failing the whole run.

        Nothing downstream reads them — the worker's dispatch loop only branches on
        return_contract and statistical, and every other value falls through to an
        automatic "required evidence unavailable" failure. A planner that asks for
        one anyway (or a stored plan from before they were retired) is normalized
        here rather than raising, which is what dead-lettered 11 of 12 failed jobs.
        """
        if not isinstance(value, list):
            return value
        plannable = {method.value for method in PlannableVerificationMethod}
        # Return VerificationMethod members, never PlannableVerificationMethod
        # ones — see the json_schema_extra note above.
        kept = [VerificationMethod(item) for item in value if str(item) in plannable]
        if kept or not value:
            # A genuinely empty list is still a contract violation; min_length
            # rejects it. Only a list emptied by normalization gets a fallback.
            return kept
        # Everything the planner asked for was retired; fall back to the contract
        # check that runs unconditionally anyway rather than emitting an empty list.
        return [VerificationMethod.RETURN_CONTRACT]


class Plan(_PlanBase):
    domain: str = Field(min_length=2, description="Problem domain: chemistry, finance, ...")
    framework: Framework
    algorithm: Algorithm
    problem_summary: str = Field(min_length=5)
    algorithm_rationale: str = Field(min_length=5)
    parameters: PlanParameters
    qubits_estimate: int = Field(
        ge=1, le=27, description="Planned qubit count; 27 is the default sandbox lane ceiling"
    )
    expected_runtime_sec: int = Field(ge=1, le=300)
    success_criteria: SuccessCriteria
    expected_output_keys: list[str] = Field(
        min_length=1, description="Keys the executed code prints in its result dict"
    )
    artifact_contract: ArtifactContract | None = None
    verification_plan: VerificationPlan | None = None

    @model_validator(mode="before")
    @classmethod
    def _drop_retired_baseline_plan(cls, value: Any) -> Any:
        """Accept and discard a `baseline_plan` the planner should not have sent.

        The field is no longer part of the schema the model is shown, and no code
        ever consumed it. Because the model config is extra="forbid", a planner that
        emits it regardless would otherwise fail validation and kill the run, so it
        is dropped here instead.
        """
        if isinstance(value, dict) and "baseline_plan" in value:
            value = {key: item for key, item in value.items() if key != "baseline_plan"}
        return value

    @model_validator(mode="after")
    def _state_preparation_claim_matches_plan(self) -> "Plan":
        verification_plan = self.verification_plan
        claim = verification_plan.state_preparation_claim if verification_plan else None
        if claim is None:
            return self
        expected_family = {
            Algorithm.BELL: "bell",
            Algorithm.GHZ: "ghz",
        }.get(self.algorithm)
        if expected_family is None:
            raise ValueError(
                "state_preparation_claim is supported only when algorithm is Bell or GHZ"
            )
        if claim.family != expected_family:
            raise ValueError(
                f"state_preparation_claim.family must be {expected_family!r} for "
                f"algorithm {self.algorithm.value}"
            )
        if claim.qubits != self.qubits_estimate:
            raise ValueError("state_preparation_claim.qubits must equal Plan.qubits_estimate")
        if claim.family == "bell" and claim.qubits != 2:
            raise ValueError("a Bell state_preparation_claim requires exactly 2 qubits")
        if claim.family == "ghz" and claim.qubits < 3:
            raise ValueError("a GHZ state_preparation_claim requires at least 3 qubits")
        return self

    @model_validator(mode="after")
    def _statistical_needs_distribution_evidence(self) -> "Plan":
        """Reject a plan that asks for a statistical check it cannot possibly satisfy.

        The statistical method compares two measurement-count dicts pulled out of the
        result by extract_counts. When expected_output_keys promises only scalars —
        a 2026-07-20 production QAOA run promised optimal_cut/qaoa_cut/
        approximation_ratio — there is no distribution to extract, so the check
        reports "required evidence unavailable" and fails.

        That failure is a property of the plan, not of the code, so it reproduces
        identically on every regenerated candidate: the repair loop cannot converge
        and the run dies with candidate_budget_exhausted after burning the whole
        budget. Raising here costs one planner re-emit instead.

        Deliberately a hard error rather than the silent normalization used above for
        retired methods: those were dead fields nothing read, whereas dropping
        statistical would quietly delete a verification the plan asked for, which is
        exactly the fail-closed guarantee the verifier exists to make.
        """
        methods = self.verification_plan.methods if self.verification_plan else []
        if VerificationMethod.STATISTICAL not in methods:
            return self
        if any(_promises_distribution(key) for key in self.expected_output_keys):
            return self
        raise ValueError(
            "verification_plan.methods includes 'statistical', which compares two "
            "measurement-count distributions, but expected_output_keys "
            f"({', '.join(self.expected_output_keys)}) promises no distribution. "
            "Either add the result key holding the raw {bitstring: count} mapping "
            "(e.g. 'counts') to expected_output_keys, or drop 'statistical' and "
            "verify the scalars some other way."
        )

    @model_validator(mode="after")
    def _exact_diag_needs_a_diagonalizable_hamiltonian(self) -> "Plan":
        """Reject an `exact_diag` plan the verifier would be forced to fail.

        Same family as the three rules above. `exact_diag` compares a reported
        energy against the true minimum eigenvalue of a declared operator, so it
        needs three things the plan alone can guarantee: the operator, a width the
        diagonalizer can hold, and a result key to read the energy out of. Any of
        them missing fails identically on every candidate, which is the signature
        that says the defect is in the plan.

        The Pauli alphabet and per-term length are already enforced by PauliTerm's
        pattern; what only the whole plan can see is that the terms agree with each
        other and with the keys the run promises to print.
        """
        plan = self.verification_plan
        if plan is None or VerificationMethod.EXACT_DIAG not in plan.methods:
            return self
        terms = plan.reference_hamiltonian
        if not terms:
            raise ValueError(
                "verification_plan.methods includes 'exact_diag', which diagonalizes "
                "a Hamiltonian and compares its ground-state energy against the "
                "reported one, but reference_hamiltonian is empty. Write the operator "
                "as Pauli terms (e.g. [{'coefficient': 0.5, 'pauli': 'ZI'}, "
                "{'coefficient': 0.8, 'pauli': 'XX'}]), or drop 'exact_diag'."
            )
        widths = {len(term.pauli) for term in terms}
        if len(widths) > 1:
            raise ValueError(
                "verification_plan.reference_hamiltonian mixes Pauli strings of "
                f"different lengths ({sorted(widths)}). Every term acts on the same "
                "register, so pad the shorter ones with 'I' — a two-qubit Z on qubit "
                "0 is 'ZI', not 'Z'."
            )
        width = widths.pop()
        if width > EXACT_DIAG_MAX_QUBITS:
            raise ValueError(
                f"verification_plan.reference_hamiltonian acts on {width} qubits, and "
                f"'exact_diag' supports at most {EXACT_DIAG_MAX_QUBITS} — the dense "
                "matrix does not fit. Drop 'exact_diag' and verify this run another "
                "way, or plan a smaller instance."
            )
        result_key = plan.reference_result_key or self.success_criteria.primary_metric
        if result_key not in self.expected_output_keys:
            raise ValueError(
                "verification_plan.methods includes 'exact_diag', which reads the "
                "reported energy out of the result under reference_result_key "
                f"('{result_key}'), "
                f"but expected_output_keys ({', '.join(self.expected_output_keys)}) "
                "does not promise that key. Spell the metric exactly as one of the "
                "keys the code will print."
            )
        return self

    @model_validator(mode="after")
    def _brute_force_needs_an_enumerable_instance(self) -> "Plan":
        """Reject a `brute_force` plan the verifier would be forced to fail.

        Same family as the rules above. `brute_force` enumerates a declared
        instance and compares the reported objective against the true optimum, so
        it needs things only the plan can guarantee: the instance, indices that
        stay inside its variable count, maxcut edges that join two distinct
        nodes, and a result key to read the value out of. Any of them missing
        fails identically on every candidate — the signature that says the defect
        is in the plan.

        Index bounds against BRUTE_FORCE_MAX_VARIABLES and weight finiteness are
        already enforced by ProblemTerm's own fields; what only the whole plan
        can see is that the terms agree with num_variables and with the keys the
        run promises to print.
        """
        plan = self.verification_plan
        if plan is None or VerificationMethod.BRUTE_FORCE not in plan.methods:
            return self
        problem = plan.reference_problem
        if problem is None:
            raise ValueError(
                "verification_plan.methods includes 'brute_force', which enumerates "
                "a declared combinatorial instance and compares the reported "
                "objective against its true optimum, but reference_problem is "
                "missing. Declare the instance (e.g. {'kind': 'maxcut', "
                "'num_variables': 4, 'terms': [{'i': 0, 'j': 1, 'weight': 2.0}]}), "
                "or drop 'brute_force'."
            )
        for term in problem.terms:
            if term.i >= problem.num_variables or term.j >= problem.num_variables:
                raise ValueError(
                    f"verification_plan.reference_problem term ({term.i}, {term.j}) "
                    f"names a variable outside 0..{problem.num_variables - 1}; "
                    "raise num_variables or fix the term's indices."
                )
            if problem.kind == "maxcut" and term.i == term.j:
                raise ValueError(
                    f"verification_plan.reference_problem term ({term.i}, {term.j}) "
                    "is a self-loop, which no cut can sever. MaxCut edges join two "
                    "distinct variables; if the instance really has a constant "
                    "offset, fold it into the reported metric instead."
                )
        if problem.kind == "maxcut" and problem.objective not in {None, "maximize"}:
            raise ValueError(
                "verification_plan.reference_problem kind 'maxcut' has fixed "
                "maximize semantics; objective may be omitted or set to 'maximize'."
            )
        for constraint in problem.constraints:
            for term in constraint.terms:
                if term.i >= problem.num_variables:
                    raise ValueError(
                        "verification_plan.reference_problem constraint term "
                        f"{term.i} names a variable outside "
                        f"0..{problem.num_variables - 1}; raise num_variables or fix "
                        "the constraint."
                    )
        if self.success_criteria.primary_metric not in self.expected_output_keys:
            raise ValueError(
                "verification_plan.methods includes 'brute_force', which reads the "
                "reported objective out of the result under "
                f"success_criteria.primary_metric ('{self.success_criteria.primary_metric}'), "
                f"but expected_output_keys ({', '.join(self.expected_output_keys)}) "
                "does not promise that key. Spell the metric exactly as one of the "
                "keys the code will print."
            )
        return self

    @model_validator(mode="after")
    def _exact_dynamics_reference_matches_the_reported_metric(self) -> "Plan":
        verification = self.verification_plan
        reference = verification.exact_dynamics_reference if verification else None
        if reference is None:
            return self
        metric = self.success_criteria.primary_metric
        if reference.result_key != metric:
            raise ValueError(
                "verification_plan.exact_dynamics_reference.result_key "
                f"({reference.result_key!r}) must equal success_criteria.primary_metric "
                f"({metric!r})"
            )
        if metric not in self.expected_output_keys:
            raise ValueError(
                "verification_plan.exact_dynamics_reference checks the result under "
                f"success_criteria.primary_metric ({metric!r}), but expected_output_keys "
                f"({', '.join(self.expected_output_keys)}) does not promise that key"
            )
        width = reference.num_qubits
        if width > self.qubits_estimate:
            raise ValueError(
                "verification_plan.exact_dynamics_reference acts on "
                f"{width} qubits but Plan.qubits_estimate is {self.qubits_estimate}"
            )
        return self

    @model_validator(mode="after")
    def _exact_lindblad_reference_matches_the_promised_results(self) -> "Plan":
        verification = self.verification_plan
        reference = verification.exact_lindblad_reference if verification else None
        if reference is None:
            return self
        result_keys = {result.result_key for result in reference.results}
        primary = self.success_criteria.primary_metric
        if primary not in result_keys:
            raise ValueError(
                "verification_plan.exact_lindblad_reference must include "
                f"success_criteria.primary_metric ({primary!r})"
            )
        unpromised = sorted(result_keys - set(self.expected_output_keys))
        if unpromised:
            raise ValueError(
                "verification_plan.exact_lindblad_reference checks unpromised RESULT "
                f"keys: {', '.join(unpromised)}"
            )
        if reference.num_qubits > self.qubits_estimate:
            raise ValueError(
                "verification_plan.exact_lindblad_reference acts on "
                f"{reference.num_qubits} system qubits but Plan.qubits_estimate is "
                f"{self.qubits_estimate}"
            )
        return self

    @model_validator(mode="after")
    def _exact_qpe_reference_matches_the_promised_results(self) -> "Plan":
        verification = self.verification_plan
        reference = verification.exact_phase_estimation_reference if verification else None
        if reference is None:
            return self
        if self.algorithm is not Algorithm.QPE:
            raise ValueError(
                "verification_plan.exact_phase_estimation_reference requires algorithm QPE"
            )
        promised = set(self.expected_output_keys)
        reference_keys = {
            reference.phase_integer_result_key,
            reference.phase_estimate_result_key,
            reference.peak_probability_result_key,
            reference.counts_result_key,
        }
        unpromised = sorted(reference_keys - promised)
        if unpromised:
            raise ValueError(
                "verification_plan.exact_phase_estimation_reference checks unpromised "
                f"RESULT keys: {', '.join(unpromised)}"
            )
        numeric_keys = reference_keys - {reference.counts_result_key}
        if self.success_criteria.primary_metric not in numeric_keys:
            raise ValueError(
                "exact QPE success_criteria.primary_metric must be one of the declared "
                "numeric phase RESULT keys"
            )
        total_qubits = reference.counting_qubits + 1
        if total_qubits > self.qubits_estimate:
            raise ValueError(
                "exact_phase_estimation_reference requires at least one target qubit: "
                f"{reference.counting_qubits} counting qubits need qubits_estimate >= "
                f"{total_qubits}"
            )
        return self

    @model_validator(mode="after")
    def _exact_linear_system_reference_matches_the_promised_results(self) -> "Plan":
        verification = self.verification_plan
        reference = verification.exact_linear_system_reference if verification else None
        if reference is None:
            return self
        result_keys = {result.result_key for result in reference.results}
        primary = self.success_criteria.primary_metric
        if primary not in result_keys:
            raise ValueError(
                "verification_plan.exact_linear_system_reference must include "
                f"success_criteria.primary_metric ({primary!r})"
            )
        unpromised = sorted(result_keys - set(self.expected_output_keys))
        if unpromised:
            raise ValueError(
                "verification_plan.exact_linear_system_reference checks unpromised "
                f"RESULT keys: {', '.join(unpromised)}"
            )
        required_system_qubits = (len(reference.matrix) - 1).bit_length()
        if required_system_qubits > self.qubits_estimate:
            raise ValueError(
                "exact_linear_system_reference matrix dimension requires at least "
                f"{required_system_qubits} system qubits"
            )
        return self

    @model_validator(mode="after")
    def _measure_all_needs_a_distribution_to_show_for_it(self) -> "Plan":
        """Reject `measure_all` on a plan whose output holds no distribution.

        Third member of the same family as the two rules above, and found the same
        way — a live run that burned its whole budget on correct code.

        `measurement_policy: measure_all` is checked against FINAL_CIRCUIT: the
        verifier requires `measurement_count >= observed_qubits` on the published
        circuit. For a variational algorithm that is the wrong circuit to ask. VQE
        estimates an energy from SEPARATE per-basis measurement circuits and
        publishes the bare parameterized ansatz, which carries no measurement at
        all — so the check reads 0 measurements against 2 qubits and fails.

        Production VQE run 019f7f2d-9504 died exactly that way. Its one candidate
        that executed cleanly bound `FINAL_CIRCUIT = ansatz(optimal_params)` and
        estimated the energy from two measured copies of the ansatz. That is the
        textbook construction and the right artifact to publish; the plan's
        `measure_all` failed it, and because the policy is fixed at plan time the
        repair loop had nowhere to go but add measurements the algorithm does not
        want. Every candidate after it failed too, and the run ended
        `candidate_budget_exhausted`.

        The rule is the honest generalization: if every qubit of the published
        circuit is measured, the run's own output should have the resulting
        distribution in it. A plan that measures everything and reports no
        distribution has declared a policy nothing in its result reflects.

        Deliberately narrow. It does not mention VQE or QAOA — a QAOA plan that
        really does publish a measured circuit and report `counts` passes, and a
        chemistry plan that reports only an energy is steered to a policy that fits.
        The cost of being wrong here is one planner re-emit onto `specified`, which
        the verifier accepts for any measurement count; the cost of the status quo
        was a whole run.
        """
        contract = self.artifact_contract
        if contract is None or contract.measurement_policy is not MeasurementPolicy.MEASURE_ALL:
            return self
        if any(_promises_distribution(key) for key in self.expected_output_keys):
            return self
        raise ValueError(
            "artifact_contract.measurement_policy is 'measure_all', which asserts "
            "that every qubit of the published FINAL_CIRCUIT is measured, but "
            f"expected_output_keys ({', '.join(self.expected_output_keys)}) promises "
            "no measurement distribution to show for it. If this run reports a "
            "distribution, add the result key holding the raw {bitstring: count} "
            "mapping (e.g. 'counts'). If the published artifact is a variational "
            "ansatz whose expectation values are estimated from separate measurement "
            "circuits, FINAL_CIRCUIT carries no measurement and the policy is 'none'. "
            "If some qubits are measured and some are not, the policy is 'specified'."
        )
