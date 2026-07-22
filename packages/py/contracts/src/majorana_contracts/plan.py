"""Plan model — the planner LLM's structured output, verified before execution.
Modernized from the legacy nameko plan-schema (Archive); qubit ceiling is the
27-qubit default sandbox lane (memory/DECISIONS.md 2026-07-09)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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

# Ceiling for the `exact` method, pinned here so a plan can never ask for a check
# the verifier is forced to fail. The check materializes two 2**n x 2**n complex128
# unitaries (16 * 4**n bytes each): 16 MB apiece at 10 qubits, 256 MB at 12. Ten is
# the last comfortable value in the worker. packages/py/verification keeps its own
# library default of 6; the worker's callsite passes this number explicitly, and
# services/worker/tests pins the two together against drift.
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

    The reference for `exact_diag` is declared, never executed — the same rule
    `reference_qasm` follows. A Hamiltonian written as framework code would have to
    run in the sandbox to mean anything, which would make a second piece of
    model-authored code the ground truth.
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


class ProblemTerm(_PlanBase):
    """One weighted term of a combinatorial instance, as data.

    The reference for `brute_force` is declared, never executed — the rule
    `reference_qasm` and `reference_hamiltonian` already follow, and for the same
    reason: an instance written as framework code would have to run in the
    sandbox to mean anything, making a second piece of model-authored code the
    ground truth.
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
    reference_source: Literal["plan_declared"] | None = Field(
        default=None,
        description=(
            "Where the 'exact' check gets the circuit it compares against. "
            "'plan_declared' means you supply reference_qasm below. Existing artifact "
            "versions are never treated as correctness references."
        ),
    )
    reference_qasm: str | None = Field(
        default=None,
        max_length=20_000,
        description=(
            "OpenQASM 2 or 3 source for the circuit the generated code must match, "
            "required when reference_source is 'plan_declared'. Write the canonical "
            "textbook construction, not a copy of the code you expect. Measurements "
            "are ignored: only the unitary is compared."
        ),
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
        those same rows into hard validation errors — and `PlanRecord.plan` is
        typed `Plan`, so every rehydration of a stored plan re-validates it. A run
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
        into hard validation errors, and `PlanRecord.plan` re-validates on every
        rehydration — a run resuming across this deploy would die on a plan that
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
    def _exact_needs_a_reachable_reference(self) -> "Plan":
        """Reject a plan asking for an `exact` check that cannot be run.

        Same failure shape as the statistical rule below, and the same remedy: a
        check whose precondition the plan itself violates fails identically on
        every regenerated candidate, so the repair loop cannot converge and the run
        burns its whole budget before dying. One planner re-emit is cheaper.

        Four ways a plan can ask for the impossible:

        - A non-circuit artifact. `artifact_type: other` means no trusted observer
          runs, so no `interchange_qasm` is emitted and there is no circuit to
          compare — the check would fail identically on every candidate.
        - No `reference_source`. `verify_exact` compares against something; without
          a nominated source there is nothing to compare against.
        - `plan_declared` with no `reference_qasm`.
        - More qubits than the check supports. `exact_equivalence` RAISES above its
          ceiling and `verify_exact` turns that into a FAIL, so an 18-qubit plan
          asking for `exact` fails a check no repair can fix.

        The QASM is deliberately NOT parsed here. Contracts must not depend on the
        OpenQASM package, and a parse failure is genuine evidence about the plan's
        reference that belongs in the verification record, not a validation error
        that silently re-rolls the planner.
        """
        plan = self.verification_plan
        if plan is None or VerificationMethod.EXACT not in plan.methods:
            return self
        if (
            self.artifact_contract is not None
            and self.artifact_contract.artifact_type is ArtifactType.OTHER
        ):
            raise ValueError(
                "verification_plan.methods includes 'exact', which compares the "
                "circuit the run executed, but artifact_contract.artifact_type is "
                "'other' — a non-circuit artifact gets no trusted observer and emits "
                "no circuit to compare. Drop 'exact', or plan a circuit artifact."
            )
        if plan.reference_source is None:
            raise ValueError(
                "verification_plan.methods includes 'exact', which compares the "
                "executed circuit against a reference circuit, but no "
                "reference_source was named. Set reference_source to "
                "'plan_declared' and supply reference_qasm, or drop 'exact'."
            )
        if plan.reference_source == "plan_declared" and not plan.reference_qasm:
            raise ValueError(
                "verification_plan.reference_source is 'plan_declared' but "
                "reference_qasm is empty. Supply the OpenQASM source of the circuit "
                "the generated code must match, or drop 'exact'."
            )
        if self.qubits_estimate > EXACT_MAX_QUBITS:
            raise ValueError(
                f"verification_plan.methods includes 'exact', which supports at most "
                f"{EXACT_MAX_QUBITS} qubits, but qubits_estimate is "
                f"{self.qubits_estimate}. Drop 'exact' and verify this circuit "
                "statistically, or plan a smaller instance."
            )
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
        if self.success_criteria.primary_metric not in self.expected_output_keys:
            raise ValueError(
                "verification_plan.methods includes 'exact_diag', which reads the "
                "reported energy out of the result under "
                f"success_criteria.primary_metric ('{self.success_criteria.primary_metric}'), "
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
