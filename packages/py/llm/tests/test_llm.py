import sys
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import Algorithm, Framework, Stage
from majorana_llm import (
    CHAT_SYSTEM_PROMPT,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    RetryingLLM,
    SIMPLE_ARTIFACT_REVIEW_SYSTEM_PROMPT,
    SIMPLE_BUSINESS_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_GENERATION_SYSTEM_PROMPT,
    SIMPLE_LINDBLAD_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_LINEAR_SYSTEM_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_PLAN_SYSTEM_PROMPT,
    SIMPLE_REVIEW_SYSTEM_PROMPT,
    StageOutputError,
    classify_provider_error,
    conversation_request_messages,
    endpoint_for,
    extract_json,
    missing_provider_keys,
    model_for,
    request_messages,
    resolve_provider,
    roles_for_profile,
    simple_generation_system_prompt,
)


def test_artifact_only_review_prompt_demands_deep_static_feedback_without_result_claims():
    prompt = " ".join(SIMPLE_ARTIFACT_REVIEW_SYSTEM_PROMPT.split())

    assert "variable-to-qubit mapping" in prompt
    assert "objective sign and scaling" in prompt
    assert "future-backend readiness" in prompt
    assert "backend-injected entry point" in prompt
    assert "classical baseline that does not solve the same instance" in prompt
    assert "never means executed, verified, optimal" in prompt
    assert "Never fabricate RESULT" in prompt
    assert "suggested_follow_ups" in prompt
    assert "exact request, formulation, generated artifact" in prompt


def test_user_facing_prompts_request_contextual_follow_ups_without_an_extra_call():
    chat = " ".join(CHAT_SYSTEM_PROMPT.split())
    review = " ".join(SIMPLE_REVIEW_SYSTEM_PROMPT.split())

    assert "<!-- majorana-follow-ups:" in chat
    assert "directly grounded in the current request and your answer" in chat
    assert "suggested_follow_ups" in review
    assert "exact request, algorithm, source, observed RESULT" in review


def test_generation_prompt_always_embeds_nameko_style_reference_implementations():
    prompt = SIMPLE_GENERATION_SYSTEM_PROMPT

    assert "Reference implementations (always available)" in prompt
    assert "Example 1 — Qiskit Bell state" in prompt
    assert "Example 2 — Qiskit H2 VQE" in prompt
    assert "Example 3 — Qiskit portfolio QAOA" in prompt
    assert "Example 4 — Qiskit coherent bit/phase-flip QEC" in prompt
    assert '("II", -0.3324043)' in prompt
    assert "TOTAL energies near -1.137 Ha" in prompt
    assert "DiagonalGate(phases)" in prompt
    assert "Never turn that vector into np.diag(...)" in prompt
    assert "13 or more variables" in prompt
    assert "append_qubo_cost_layer" in prompt
    assert "QFTGate(width).inverse()" in prompt
    assert "it has no to_gate() method" in prompt
    assert "pass float(np.real(angle))" in prompt
    assert "DEMO DATA ONLY" in prompt
    assert "partial_trace(recovered_state, [3, 4])" in prompt
    assert "do not convert it with to_operator()" in prompt
    assert "do not trust one optimizer run from only tiny parameters" in prompt
    assert "Powell is often more robust" in prompt
    assert "The request and known_reference override every example." in prompt
    assert "from __future__ import annotations" not in prompt
    assert "minimize the negative" in prompt
    assert (
        "Keep the search energy and the requested business metric as separate functions" in prompt
    )
    assert "select_observed_business_solution" in prompt
    assert 'direction="minimize"' in prompt
    assert "QAOA sampling produced no feasible business solution" in prompt
    assert "never place FINAL_CIRCUIT" in prompt
    assert prompt.count("FINAL_CIRCUIT =") >= 4
    assert prompt.count("RESULT =") >= 4


@pytest.mark.parametrize(
    ("fields", "included", "excluded"),
    [
        (
            {
                "framework": "qiskit",
                "domain": "quantum information",
                "algorithm": "Bell",
                "problem_summary": "prepare entanglement",
            },
            "Example 1 — Qiskit Bell state",
            (
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "quantum information",
                "algorithm": "other",
                "problem_summary": "coherent quantum teleportation",
            },
            "Example — coherent single-qubit teleportation",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
                "bounded explicit-Hamiltonian statevector VQE",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "quantum dynamics",
                "algorithm": "other",
                "problem_summary": "exact Pauli dynamics by explicit matrix exponential",
            },
            "Example — bounded exact indexed-Pauli dynamics",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
                "bounded explicit-Hamiltonian statevector VQE",
                "coherent single-qubit teleportation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "quantum chemistry",
                "algorithm": "VQE",
                "problem_summary": "minimize a Hamiltonian",
            },
            "Example — bounded explicit-Hamiltonian statevector VQE",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "combinatorial optimization",
                "algorithm": "QAOA",
                "problem_summary": "sample a feasible solution",
            },
            "Example 3 — Qiskit portfolio QAOA",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "quantum linear systems",
                "algorithm": "other",
                "problem_summary": "complete HHL circuit",
            },
            "Example — bounded exact-dyadic 2x2 HHL structure",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "phase estimation",
                "algorithm": "QPE",
                "problem_summary": "estimate an exactly representable eigenphase",
            },
            "Example — bounded finite-register phase estimation",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "amplitude estimation",
                "algorithm": "other",
                "problem_summary": "estimate a computational-basis good probability",
            },
            "Example — bounded statevector amplitude estimation",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "unstructured search",
                "algorithm": "Grover",
                "problem_summary": "find any of several marked bitstrings",
            },
            "Example — bounded multi-marked Grover search",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "Example 4 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
            ),
        ),
        (
            {
                "framework": "qiskit",
                "domain": "quantum error correction",
                "algorithm": "other",
                "problem_summary": "coherent phase-flip repetition code",
            },
            "coherent bit/phase-flip QEC and reduced-state fidelity",
            (
                "Example 1 —",
                "Example 2 —",
                "Example 3 —",
                "exact-dyadic 2x2 HHL",
                "bounded finite-register phase estimation",
                "bounded statevector amplitude estimation",
            ),
        ),
    ],
)
def test_generation_prompt_selects_only_the_relevant_verified_family(fields, included, excluded):
    prompt = simple_generation_system_prompt(**fields)

    assert included in prompt
    assert all(marker not in prompt for marker in excluded)
    assert "Current Qiskit statevector rule" in prompt
    assert "Execution contract:" in prompt
    assert len(prompt) < len(SIMPLE_GENERATION_SYSTEM_PROMPT)


def test_pennylane_vqe_receives_only_its_framework_native_family_example():
    prompt = simple_generation_system_prompt(
        framework="pennylane",
        domain="variational algorithms",
        algorithm="VQE",
        problem_summary="optimize a three-qubit ansatz",
    )

    assert "Example 1 —" not in prompt
    assert "Example 2 —" not in prompt
    assert "Example 3 —" not in prompt
    assert "Example 4 —" not in prompt
    assert "exact-dyadic 2x2 HHL" not in prompt
    assert "bounded finite-register phase estimation" not in prompt
    assert "bounded explicit-Hamiltonian statevector VQE" not in prompt
    assert "bounded statevector amplitude estimation" not in prompt
    assert "coherent single-qubit teleportation" not in prompt
    assert "bounded exact indexed-Pauli dynamics" not in prompt
    assert "Current Qiskit statevector rule" not in prompt
    assert "bounded PennyLane explicit-Hamiltonian VQE" in prompt
    assert "bounded_pennylane_vqe" in prompt
    normalized = " ".join(prompt.split())
    assert "never pass an ordinary `numpy.ndarray` directly to `qml.grad`" in normalized
    assert "qml.numpy.array(..., requires_grad=True)" in normalized
    assert "PennyLane" in prompt


def test_grover_helper_is_qiskit_and_generation_family_scoped():
    generic_qiskit = simple_generation_system_prompt(
        framework="qiskit",
        domain="search",
        algorithm="other",
        problem_summary="perform amplitude amplification over marked states",
    )
    cirq_grover = simple_generation_system_prompt(
        framework="cirq",
        domain="search",
        algorithm="Grover",
        problem_summary="find marked states",
    )
    qiskit_qpe = simple_generation_system_prompt(
        framework="qiskit",
        domain="phase estimation",
        algorithm="QPE",
        problem_summary="mentions Grover only as an unrelated comparison",
    )

    marker = "Example — bounded multi-marked Grover search"
    assert marker in generic_qiskit
    assert marker not in cirq_grover
    assert marker not in qiskit_qpe


def test_cirq_vqe_and_pennylane_non_vqe_do_not_receive_the_pennylane_vqe_helper():
    cirq_vqe = simple_generation_system_prompt(
        framework="cirq",
        domain="variational algorithms",
        algorithm="VQE",
        problem_summary="optimize a two-qubit Hamiltonian",
    )
    pennylane_bell = simple_generation_system_prompt(
        framework="pennylane",
        domain="quantum information",
        algorithm="Bell",
        problem_summary="prepare entanglement",
    )

    marker = "bounded PennyLane explicit-Hamiltonian VQE"
    assert marker not in cirq_vqe
    assert marker not in pennylane_bell


@pytest.mark.parametrize(
    ("framework", "included", "excluded"),
    [
        (
            Framework.QISKIT,
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "rightmost character is qubit 0",
                "QFTGate(width)",
                "vector = np.asarray(statevector.data, dtype=complex)",
                "overlap=conj(alpha)*beta",
                "append `Kraus([K0, K1, ...])` directly",
                "rho = np.asarray(saved_density_matrix, dtype=complex)",
            ),
            (
                "cirq.Simulator(dtype=np.complex128",
                "PennyLane result values, including numpy scalars",
                "Amazon Braket code uses",
                "Qibo code uses",
                "Qulacs code uses",
            ),
        ),
        (
            Framework.CIRQ,
            ("cirq.Simulator(dtype=np.complex128",),
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "rightmost character is qubit 0",
                "QFTGate(width)",
                "PennyLane result values, including numpy scalars",
                "Amazon Braket code uses",
                "Qibo code uses",
                "Qulacs code uses",
            ),
        ),
        (
            Framework.PENNYLANE,
            ("PennyLane result values, including numpy scalars",),
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "rightmost character is qubit 0",
                "QFTGate(width)",
                "cirq.Simulator(dtype=np.complex128",
                "Amazon Braket code uses",
                "Qibo code uses",
                "Qulacs code uses",
            ),
        ),
        (
            Framework.BRAKET,
            (
                "Amazon Braket code uses",
                "Never import braket.aws",
                "LocalSimulator has no public seed argument",
            ),
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "rightmost character is qubit 0",
                "QFTGate(width)",
                "cirq.Simulator(dtype=np.complex128",
                "PennyLane result values, including numpy scalars",
                "Qibo code uses",
                "Qulacs code uses",
            ),
        ),
        (
            Framework.QIBO,
            (
                "Qibo code uses",
                "only `NumpyBackend` from `qibo.backends`",
                "Do not import qibolab",
            ),
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "cirq.Simulator(dtype=np.complex128",
                "PennyLane result values, including numpy scalars",
                "Amazon Braket code uses",
                "Qulacs code uses",
            ),
        ),
        (
            Framework.QULACS,
            (
                "Qulacs code uses",
                "in-process Qulacs state simulator",
                "state.sampling(shots, seed)",
            ),
            (
                "qiskit_aer.AerSimulator plus transpile/run",
                "cirq.Simulator(dtype=np.complex128",
                "PennyLane result values, including numpy scalars",
                "Amazon Braket code uses",
                "Qibo code uses",
            ),
        ),
    ],
)
def test_generation_prompt_scopes_sdk_rules_across_every_algorithm(framework, included, excluded):
    for algorithm in Algorithm:
        prompt = simple_generation_system_prompt(
            framework=framework.value,
            domain="neutral domain",
            algorithm=algorithm.value,
            problem_summary="neutral task summary",
        )

        assert all(marker in prompt for marker in included), algorithm
        assert all(marker not in prompt for marker in excluded), algorithm


def test_braket_bell_uses_a_framework_native_reference_only_for_bell():
    bell = simple_generation_system_prompt(
        framework="braket",
        domain="quantum information",
        algorithm="Bell",
        problem_summary="prepare an entangled pair",
    )
    unrelated = simple_generation_system_prompt(
        framework="braket",
        domain="optimization",
        algorithm="QAOA",
        problem_summary="solve a graph partition",
    )

    assert "Amazon Braket Bell-state reference" in bell
    assert "Circuit().h(0).cnot(0, 1).measure([0, 1])" in bell
    assert "from qiskit import QuantumCircuit" not in bell
    assert "Amazon Braket Bell-state reference" not in unrelated


@pytest.mark.parametrize(
    ("framework", "marker", "native_import"),
    [
        ("qibo", "Qibo Bell-state reference", "from qibo import Circuit, gates"),
        ("qulacs", "Qulacs Bell-state reference", "from qulacs import QuantumCircuit"),
    ],
)
def test_new_framework_bell_references_are_native_and_family_scoped(
    framework, marker, native_import
):
    bell = simple_generation_system_prompt(
        framework=framework,
        domain="quantum information",
        algorithm="Bell",
        problem_summary="prepare an entangled pair",
    )
    unrelated = simple_generation_system_prompt(
        framework=framework,
        domain="optimization",
        algorithm="QAOA",
        problem_summary="solve a graph partition",
    )

    assert marker in bell
    assert native_import in bell
    assert "from qiskit import QuantumCircuit" not in bell
    assert marker not in unrelated


def test_lindblad_matrix_exponential_does_not_select_closed_system_dynamics_helper():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="open-system dynamics",
        algorithm="other",
        problem_summary="solve a Lindblad master equation with a matrix exponential",
    )

    assert "bounded exact indexed-Pauli dynamics" not in prompt


def test_open_system_context_does_not_borrow_a_secondary_algorithm_helper():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="open-system dynamics",
        algorithm="Simulation",
        problem_summary=(
            "solve a Lindblad master equation and compare the result with phase estimation"
        ),
    )

    assert "bounded exact indexed-Pauli dynamics" not in prompt
    assert "bounded finite-register phase estimation" not in prompt


def test_replan_prompt_requires_a_materially_different_approach_after_stagnation():
    assert "autonomous replan, not a" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "candidate_not_converging" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "materially different, simpler executable approach" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "Never move or widen an expected_range" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "not independent truth" in SIMPLE_PLAN_SYSTEM_PROMPT


def test_planner_and_reviewer_prompts_prevent_observed_live_false_failures():
    assert "never add `circuit`, `program`, `source`" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "Uncertainty by itself is not a defect" in SIMPLE_REVIEW_SYSTEM_PROMPT
    assert "QFT applied to the default computational state" in SIMPLE_REVIEW_SYSTEM_PROMPT
    assert "decision must be READY" in SIMPLE_REVIEW_SYSTEM_PROMPT
    assert "Never use it to verify finite-time evolution" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "sin(pi*y/2**m)**2" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "cosine-squared" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "aggregate the probabilities of y and 2**m-y before selecting y" in (
        SIMPLE_PLAN_SYSTEM_PROMPT
    )
    assert "single raw peak and folding it afterwards is not equivalent" in (
        SIMPLE_PLAN_SYSTEM_PROMPT
    )
    assert "1e-6 * max(1, sum(abs(Hamiltonian coefficients)))" in SIMPLE_PLAN_SYSTEM_PROMPT


def test_prompts_pin_general_numerical_and_representation_invariants():
    plan = " ".join(SIMPLE_PLAN_SYSTEM_PROMPT.split())
    generation = " ".join(SIMPLE_GENERATION_SYSTEM_PROMPT.split())
    review = " ".join(SIMPLE_REVIEW_SYSTEM_PROMPT.split())

    assert "finite-register estimator" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "discrete output grid" in plan
    assert "rightmost character is qubit 0" in generation
    assert "q_(n-1),...,q_0" in generation
    assert "bridge conventions exactly once" in generation
    assert "one explicit bit-reversal permutation" in generation
    assert "cirq.Simulator(dtype=np.complex128, seed=...)" in generation
    assert "default complex64 state can introduce errors around 1e-7" in generation
    assert "required basis-state or eigenstate map" in generation
    assert "coefficient-time accumulated by every" in generation
    assert "symmetry-related phase peaks" in generation
    assert "trace the proposed change" in review
    assert 'Do not infer that consistency from an "exact" value' in review
    assert "Never recommend moving a Plan range" in review
    assert "leave the subsystem that must change untouched" in review
    assert "business_objective.constant" in plan
    assert "reference_result_key" in plan
    assert "It may differ from success_criteria.primary_metric" in plan
    assert "business_constraints" in plan
    assert "original business problem has at most 16" in plan
    assert "without checking feasibility" in plan
    assert "Never include QAOA energy sign flips" in plan
    assert "Matrix x_row_column variables use row-major indices" in plan


def test_business_reference_extraction_is_independent_and_request_scoped():
    extraction = " ".join(SIMPLE_BUSINESS_REFERENCE_EXTRACTION_SYSTEM_PROMPT.split())

    assert "bounded binary BUSINESS problem" in extraction
    assert "business_objective must evaluate exactly to the RESULT" in extraction
    assert "never an internal Hamiltonian minimization convention" in extraction
    assert "Ignore QAOA, penalty strengths, slack or ancilla variables" in extraction
    assert "more than 16 original binary variables" in extraction
    assert "Never guess missing business data" in extraction


def test_lindblad_reference_extraction_is_bounded_and_request_scoped():
    extraction = " ".join(SIMPLE_LINDBLAD_REFERENCE_EXTRACTION_SYSTEM_PROMPT.split())
    plan = " ".join(SIMPLE_PLAN_SYSTEM_PROMPT.split())

    assert "at most 3 qubits" in extraction
    assert "product initial state" in extraction
    assert "Each jump is an operator SUM" in extraction
    assert "lowering means |0><1|" in extraction
    assert "Preserve the literal multiplier of D[L]" in extraction
    assert "a/b*(Z*rho*Z-rho) has rate=a/b" in extraction
    assert "additional circuit, Stinespring dilation, QASM export" in extraction
    assert "does not make otherwise complete scalar evolution unsupported" in extraction
    assert "Do not solve the equation or invent omitted data" in extraction
    assert "Preserve every requested numeric RESULT key" in plan
    assert "non-product initial state" in plan


def test_linear_system_reference_extraction_does_not_guess_result_semantics():
    extraction = " ".join(SIMPLE_LINEAR_SYSTEM_REFERENCE_EXTRACTION_SYSTEM_PROMPT.split())

    assert "power of two from 2 through 8" in extraction
    assert "normalized_solution_component" in extraction
    assert "Never infer ratio orientation" in extraction
    assert "not the candidate implementation" in extraction
    assert "Do not diagonalize A, solve the system" in extraction


def test_generation_and_review_guard_general_numeric_evidence_failures():
    generation = " ".join(SIMPLE_GENERATION_SYSTEM_PROMPT.split())
    review = " ".join(SIMPLE_REVIEW_SYSTEM_PROMPT.split())

    assert "flat vector of shape (2**n,)" in generation
    assert "Do not reuse a Kronecker helper seeded with a 2-D identity" in generation
    assert "Matrix products act on states from right to left" in generation
    assert "append B's gate before A's gate" in generation
    assert "every RESULT field the request uses as evidence" in review
    assert "correct most-likely label with unexplained off-target support" in review
    assert "lowering matrix |0><1|" in generation
    assert "lowering is |0><1|" in review
    assert "a/b*(Z*rho*Z-rho) as a/b*D[Z]" in review
    assert "exact_phase_estimation_reference" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "phi*2**m is an integer" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "exact_linear_system_reference" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "normalized_solution_component" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "true logical-qubit count" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "execution is explicitly recorded as not run" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "qubits_estimate above 25" in SIMPLE_GENERATION_SYSTEM_PROMPT
    assert "do not fabricate RESULT values" in SIMPLE_GENERATION_SYSTEM_PROMPT
    assert "previous_execution.execution_status is not_run" in SIMPLE_GENERATION_SYSTEM_PROMPT
    assert "lowest-index component among magnitudes tied within 1e-12" in (
        SIMPLE_LINEAR_SYSTEM_REFERENCE_EXTRACTION_SYSTEM_PROMPT
    )


def test_chat_carries_the_same_execution_boundary_as_routing():
    normalized = " ".join(CHAT_SYSTEM_PROMPT.split())

    assert "25 qubits the local execution maximum" in normalized
    assert "execution explicitly marked not_run" in normalized
    assert "target-ready unexecuted artifact" in normalized
    assert "cannot contact a real QPU" in normalized
    assert "package list is exhaustive" in normalized
    assert "switching to Execute creates numerical results" in normalized


def test_model_constants_use_v4_pro_for_all_product_stages_and_are_env_overridable(monkeypatch):
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    assert model_for("chat") == "deepseek-v4-pro"
    assert model_for("route") == "deepseek-v4-pro"
    assert model_for(Stage.PLAN) == "deepseek-v4-pro"
    assert model_for(Stage.GENERATE) == "deepseek-v4-pro"
    assert model_for("audit") == "deepseek-v4-flash"
    assert model_for(Stage.VERIFY) == "deepseek-v4-pro"
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "custom-model")
    assert model_for(Stage.PLAN) == "custom-model"


def _clear_provider_env(monkeypatch):
    for var in ("MAJORANA_LLM_PROVIDER", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_provider_resolution_prefers_owner_confirmed_keys(monkeypatch):
    _clear_provider_env(monkeypatch)
    assert resolve_provider() == "anthropic"  # no keys → safe fallback
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    assert resolve_provider() == "openai"
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "anthropic")
    assert resolve_provider() == "anthropic"  # explicit env wins
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "nonsense")
    with pytest.raises(ValueError):
        resolve_provider()


def test_a_deepseek_only_environment_is_a_complete_openai_profile(monkeypatch):
    """The regression that made this function necessary.

    Three hand-written copies of "is the profile complete" demanded OPENAI_API_KEY
    as well, which was true while gpt-5.5 planned and verified and false from the
    day every role moved to a deepseek model. Both of them refused to run against
    a DeepSeek-only environment that works perfectly.
    """
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    assert missing_provider_keys() == frozenset()


def test_missing_provider_keys_follows_the_models_table_rather_than_a_list(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    # Point ONE role at an OpenAI model and OPENAI_API_KEY becomes genuinely
    # required — without anyone editing a list of key names. This is the whole
    # reason the set is derived rather than written down.
    monkeypatch.setenv("MAJORANA_MODEL_AUDIT", "gpt-5.5")
    assert missing_provider_keys() == frozenset({"OPENAI_API_KEY"})
    monkeypatch.setenv("OPENAI_API_KEY", "y")
    assert missing_provider_keys() == frozenset()


def test_missing_provider_keys_covers_every_role_the_product_can_call(monkeypatch):
    """`audit` and `writeback` are real product calls and were in neither list.

    The old copies checked route/plan/generate/verify only. A profile missing the
    key for a role the pipeline reaches later reported itself ready and failed
    mid-run instead of before it.
    """
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "openai")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    monkeypatch.setenv("MAJORANA_MODEL_WRITEBACK", "gpt-5.5")
    assert "OPENAI_API_KEY" in missing_provider_keys()
    assert roles_for_profile() >= {
        "chat",
        "route",
        "plan",
        "generate",
        "audit",
        "verify",
        "writeback",
    }


def test_missing_provider_keys_reports_the_anthropic_profile(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "anthropic")
    assert missing_provider_keys() == frozenset({"ANTHROPIC_API_KEY"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    assert missing_provider_keys() == frozenset()


def test_provider_timeout_is_bounded_and_environment_overridable(monkeypatch):
    from majorana_llm.client import provider_timeout_seconds

    monkeypatch.delenv("MAJORANA_LLM_TIMEOUT_SECONDS", raising=False)
    assert provider_timeout_seconds() == 120.0
    monkeypatch.setenv("MAJORANA_LLM_TIMEOUT_SECONDS", "45.5")
    assert provider_timeout_seconds() == 45.5
    for invalid in ("0", "601", "nan", "not-a-number"):
        monkeypatch.setenv("MAJORANA_LLM_TIMEOUT_SECONDS", invalid)
        assert provider_timeout_seconds() == 120.0


def test_model_defaults_follow_provider_profile(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    assert model_for(Stage.PLAN) == "deepseek-v4-pro"
    assert model_for(Stage.GENERATE) == "deepseek-v4-pro"
    assert model_for("audit") == "deepseek-v4-flash"
    assert model_for(Stage.VERIFY) == "deepseek-v4-pro"


def test_endpoint_routing_by_model_prefix(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_BASE_URL", raising=False)
    base, key_env = endpoint_for("deepseek-v4-pro")
    assert base == "https://api.deepseek.com" and key_env == "DEEPSEEK_API_KEY"
    base, key_env = endpoint_for("gpt-5.5")
    assert base is None and key_env == "OPENAI_API_KEY"


def test_structured_decoding_routes_per_endpoint():
    from majorana_llm.client import decode_params

    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    req = LLMRequest(model="m", system="sys", user="u", response_schema=schema, schema_name="plan")
    # OpenAI: true json_schema, system untouched.
    params, system = decode_params(req, "OPENAI_API_KEY")
    assert params["response_format"]["type"] == "json_schema"
    assert params["response_format"]["json_schema"]["schema"] == schema
    assert system == "sys"
    # DeepSeek rejects json_schema → json_object + schema injected into the system.
    params, system = decode_params(req, "DEEPSEEK_API_KEY")
    assert params["response_format"] == {"type": "json_object"}
    assert params["extra_body"] == {"thinking": {"type": "disabled"}}
    assert '"a"' in system and system.startswith("sys")
    # No schema → no response_format at all.
    params, system = decode_params(LLMRequest(model="m", system="sys", user="u"), "OPENAI_API_KEY")
    assert "response_format" not in params


def test_request_schema_is_optional_on_the_request_model():
    assert LLMRequest(model="m", system="s", user="u").response_schema is None


def test_max_tokens_defaults_to_unset_and_stays_out_of_the_wire_params():
    """No self-imposed cap unless a caller opts in: bench-14 (2026-07-11) found a
    reasoning model burning a fixed max_tokens budget entirely on reasoning, zero
    code out — the cap itself was the failure. Omitted here, the provider's own
    ceiling applies instead (the same choice namekoQ makes throughout)."""
    from majorana_llm.client import decode_params

    req = LLMRequest(model="m", system="sys", user="u")
    assert req.max_tokens is None
    openai_params, _ = decode_params(req, "OPENAI_API_KEY")
    assert "max_completion_tokens" not in openai_params
    deepseek_params, _ = decode_params(req, "DEEPSEEK_API_KEY")
    assert "max_tokens" not in deepseek_params

    capped = LLMRequest(model="m", system="sys", user="u", max_tokens=2048)
    assert decode_params(capped, "OPENAI_API_KEY")[0]["max_completion_tokens"] == 2048
    assert decode_params(capped, "DEEPSEEK_API_KEY")[0]["max_tokens"] == 2048


async def test_openai_compatible_llm_streams_reasoning_and_output(monkeypatch):
    calls: list[dict] = []
    client_options: list[dict] = []

    async def provider_stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content="think ", content=None))
            ],
            usage=None,
        )
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content=None, content="answer"))
            ],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    class RecordingCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return provider_stream()

    class RecordingAsyncOpenAI:
        def __init__(self, **kwargs):
            client_options.append(kwargs)
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.delenv("MAJORANA_LLM_TIMEOUT_SECONDS", raising=False)

    from majorana_llm.client import OpenAICompatibleLLM

    seen: list[tuple[str, str]] = []

    async def on_delta(text: str, kind: str) -> None:
        seen.append((text, kind))

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user"),
        on_delta=on_delta,
    )

    assert response.text == "answer"
    assert response.input_tokens == 3
    assert response.output_tokens == 2
    assert seen == [("think ", "reasoning"), ("answer", "output")]
    assert calls[0]["stream"] is True
    assert calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    assert client_options[0]["max_retries"] == 0
    assert client_options[0]["timeout"] == 120.0


async def test_openai_compatible_llm_fails_fast_with_typed_missing_credentials(monkeypatch):
    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            raise AssertionError("client must not be created without credentials")

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    from majorana_llm.client import OpenAICompatibleLLM

    with pytest.raises(LLMProviderError) as caught:
        await OpenAICompatibleLLM().complete(
            LLMRequest(model="deepseek-v4-pro", system="system", user="user")
        )

    assert caught.value.code == "credentials_missing"
    assert caught.value.provider == "deepseek"
    assert caught.value.retryable is False


async def test_anthropic_provider_errors_use_the_same_typed_contract(monkeypatch):
    class AuthenticationFailure(Exception):
        status_code = 401

    class FailingMessages:
        async def create(self, **_kwargs):
            raise AuthenticationFailure("secret-bearing SDK message")

    class RecordingAsyncAnthropic:
        def __init__(self, **_kwargs):
            self.messages = FailingMessages()

    monkeypatch.setitem(
        sys.modules,
        "anthropic",
        SimpleNamespace(AsyncAnthropic=RecordingAsyncAnthropic),
    )

    from majorana_llm.client import AnthropicLLM

    with pytest.raises(LLMProviderError) as caught:
        await AnthropicLLM(api_key="test-key").complete(
            LLMRequest(model="claude-sonnet-5", system="system", user="user")
        )

    assert caught.value.code == "authentication_failed"
    assert caught.value.provider == "anthropic"
    assert caught.value.retryable is False
    assert "secret-bearing" not in str(caught.value)


def test_provider_error_classification_separates_quota_from_transient_rate_limit():
    class ProviderFailure(Exception):
        def __init__(self, *, status_code, code):
            self.status_code = status_code
            self.code = code

    quota = classify_provider_error(
        ProviderFailure(status_code=429, code="insufficient_quota"),
        provider="openai",
        model="gpt",
    )
    limited = classify_provider_error(
        ProviderFailure(status_code=429, code="rate_limit_exceeded"),
        provider="deepseek",
        model="deepseek-v4-pro",
    )

    assert quota.code == "quota_exhausted"
    assert quota.retryable is False
    assert limited.code == "rate_limited"
    assert limited.retryable is True
    assert quota.safe_details() == {
        "provider": "openai",
        "model": "gpt",
        "provider_code": "quota_exhausted",
        "status_code": 429,
        "retryable": False,
    }


def test_chat_persona_cannot_narrate_results_it_did_not_produce():
    # The chat turn cannot execute anything, so the persona must not let the
    # model narrate results it did not produce.
    assert "never report simulation output" in CHAT_SYSTEM_PROMPT
    assert "Prior Execute output" in CHAT_SYSTEM_PROMPT
    assert "do not present them as a new execution" in CHAT_SYSTEM_PROMPT


def test_qaoa_generation_rule_is_selected_only_for_qaoa_context():
    qaoa = simple_generation_system_prompt(
        framework="qiskit",
        domain="combinatorial optimization",
        algorithm="QAOA",
        problem_summary="minimize a constrained binary business objective",
    )
    bell = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum information",
        algorithm="Bell",
        problem_summary="prepare an entangled state",
    )

    rule = "Keep the search energy and the requested business metric as separate functions"
    assert rule in qaoa
    assert "qaoa_energy(bits)" in qaoa
    assert rule not in bell


@pytest.mark.parametrize(
    ("algorithm", "summary", "included", "excluded"),
    [
        (
            "AmplitudeEstimation",
            "estimate amplitude 0.146 on a prepared state",
            "bounded statevector amplitude estimation",
            "bounded finite-register phase estimation",
        ),
        (
            "QAOA",
            "optimize scheduling data produced by a phase estimation stage",
            "Example 3 — Qiskit portfolio QAOA",
            "bounded finite-register phase estimation",
        ),
        (
            "other",
            "run HHL, including its phase estimation subroutine",
            "exact-dyadic 2x2 HHL",
            "bounded finite-register phase estimation",
        ),
        (
            "Simulation",
            "exact Pauli dynamics, then compare against phase estimation language",
            "bounded exact indexed-Pauli dynamics",
            "bounded finite-register phase estimation",
        ),
    ],
)
def test_typed_algorithm_and_specific_other_context_beat_colliding_keywords(
    algorithm, summary, included, excluded
):
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="research",
        algorithm=algorithm,
        problem_summary=summary,
    )

    assert included in prompt
    assert excluded not in prompt


def test_qpe_prompt_includes_direct_diagonal_basis_specialization():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="phase estimation",
        algorithm="QPE",
        problem_summary="finite-register diagonal target-unitary phase estimation",
    )

    assert "BEGIN DIAGONAL_BASIS_QPE_HELPER" in prompt
    assert "target_basis_index = int(bitstring, 2)" in prompt
    assert "basis_index & (register_size - 1)" in prompt


def test_qpe_diagonal_basis_specialization_executes_with_displayed_order():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="phase estimation",
        algorithm="QPE",
        problem_summary="finite-register diagonal target-unitary phase estimation",
    )
    source = prompt.split("# BEGIN DIAGONAL_BASIS_QPE_HELPER", 1)[1].split(
        "# END DIAGONAL_BASIS_QPE_HELPER", 1
    )[0]
    source = (
        source.replace("requested_target_qubit_count", "1")
        .replace("requested_q_high_to_q0_basis_bitstring", '"1"')
        .replace("requested_eigenphase", "0.854455167")
        .replace("requested_counting_qubit_count", "4")
    )
    namespace: dict[str, object] = {}

    exec(source, namespace)

    result = namespace["RESULT"]
    assert isinstance(result, dict)
    assert result["dominant_integer"] == 14
    assert result["finite_phase_estimate"] == 0.875
    assert result["dominant_probability"] == pytest.approx(0.6923484843945318)
    assert result["phase_probabilities"][13] == pytest.approx(0.16675249761684188)


def test_generic_error_correction_does_not_receive_qpe_or_repetition_code_examples():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="fault-tolerant quantum computing",
        algorithm="ErrorCorrection",
        problem_summary="analyze a surface-code decoder and compare phase estimation noise",
    )

    assert "Current Qiskit statevector rule" in prompt
    assert "bounded finite-register phase estimation" not in prompt
    assert "Example 4 — Qiskit coherent bit-flip QEC" not in prompt


def test_repetition_error_correction_receives_the_bounded_qec_example():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum error correction",
        algorithm="ErrorCorrection",
        problem_summary="coherent three-qubit phase-flip repetition code",
    )

    assert "Example 4 — Qiskit coherent bit/phase-flip QEC" in prompt
    assert "conjugate the physical Z error to X" in prompt


def test_ordered_trotter_receives_order_preserving_helper_not_exact_dynamics():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum dynamics",
        algorithm="Simulation",
        problem_summary="ordered symmetric second-order Trotter product formula",
    )

    assert "ordered symmetric second-order Pauli Trotterization" in prompt
    assert "Preserve the term list order exactly" in prompt
    assert 'f"trotter_z{requested_observable_qubit}"' in prompt
    assert "bounded exact indexed-Pauli dynamics" not in prompt


def test_amplitude_damping_receives_complete_stinespring_map():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="open quantum systems",
        algorithm="Simulation",
        problem_summary="coherent-input amplitude damping Stinespring dilation",
    )

    assert "coherent-input amplitude-damping Stinespring dilation" in prompt
    assert "circuit.cry" in prompt
    assert "circuit.cx(environment, system)" in prompt
    assert "A controlled RY alone" in prompt


def test_lindblad_stinespring_receives_direct_commuting_channel_dilation():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="open quantum systems",
        algorithm="Simulation",
        problem_summary="one-qubit Lindblad amplitude damping and dephasing Stinespring",
    )

    assert "amplitude-damping plus dephasing Lindblad dilation" in prompt
    assert "circuit.cx(amplitude_environment, system)" in prompt
    assert "circuit.cz(dephasing_environment, system)" in prompt
    assert "QR need not preserve" in prompt


@pytest.mark.parametrize(
    ("framework", "required"),
    [
        ("qibo", "circuit.add(gates.RZ(0, requested_phi))"),
        ("qulacs", "circuit.add_gate(RZ(0, -requested_phi))"),
    ],
)
def test_native_one_qubit_rotation_helpers_pin_gate_and_bloch_signs(framework, required):
    prompt = simple_generation_system_prompt(
        framework=framework,
        domain="state preparation",
        algorithm="StatePreparation",
        problem_summary="one-qubit RY then RZ exact statevector",
    )

    assert required in prompt
    assert "overlap = np.conj(alpha) * beta" in prompt
    assert '"bloch_y": float(2.0 * overlap.imag)' in prompt


def test_specific_non_generic_algorithm_does_not_receive_a_context_only_helper():
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum algorithms",
        algorithm="QFT",
        problem_summary="transpile a QFT circuit used before a phase estimation comparison",
    )

    assert "bounded finite-register phase estimation" not in prompt


def test_chat_persona_names_no_surface_the_product_no_longer_has():
    # The Vault was folded into Studio and /library now redirects. The capability
    # list is the one piece of stale copy that would actively instruct a user to
    # open a page that no longer exists, so it is pinned rather than trusted.
    assert "Vault" not in CHAT_SYSTEM_PROMPT
    assert "Studio" in CHAT_SYSTEM_PROMPT


def test_grover_plan_and_review_prompts_pin_general_iteration_arithmetic():
    assert "theta=asin(sqrt(M/N))" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "pi/(4*theta)-1/2" in SIMPLE_PLAN_SYSTEM_PROMPT
    assert "Recompute simple arithmetic instead of trusting a Plan rationale" in (
        SIMPLE_REVIEW_SYSTEM_PROMPT
    )
    assert "return REPLAN" in SIMPLE_REVIEW_SYSTEM_PROMPT


def test_json_extraction_accepts_fences_and_never_echoes_bad_output():
    assert extract_json('prefix ```json\\n{"ok": true}\\n``` suffix') == '{"ok": true}'
    secret = "sensitive-model-output"
    with pytest.raises(StageOutputError) as captured:
        extract_json(secret)
    assert secret not in str(captured.value)


# --- RetryingLLM ---------------------------------------------------------------
#
# `deepseek-reasoner` returned a completely empty completion at the planning stage on
# two production runs (019f7dad-3a24, 019f7de2-a45b) and both dead-lettered before a
# line of code was written. Once the real verification defects were fixed, the provider
# returning nothing became the most common reason a run dies.


class _EmptyThenText:
    def __init__(self, empties: int) -> None:
        self.calls = 0
        self._empties = empties

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        text = "" if self.calls <= self._empties else '{"ok": true}'
        return LLMResponse(text=text, model=request.model, input_tokens=1, output_tokens=1)


async def _no_sleep(_delay: float) -> None:
    return None


def _request() -> LLMRequest:
    return LLMRequest(model="deepseek-reasoner", system="s", user="u")


async def test_an_empty_completion_is_retried():
    inner = _EmptyThenText(empties=2)
    response = await RetryingLLM(inner, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == '{"ok": true}'


async def test_retries_are_bounded_and_the_last_empty_reply_is_returned_not_raised():
    """Returned, not raised: the caller's parser reports what was missing, and its
    message already tells an empty completion apart from prose (`len=0, blank=True`)."""
    inner = _EmptyThenText(empties=99)
    response = await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == ""


async def test_a_transport_failure_is_retried_then_re_raised():
    class _AlwaysRaises:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise TimeoutError("connection reset")

    inner = _AlwaysRaises()
    with pytest.raises(TimeoutError):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3


async def test_a_permanent_provider_failure_is_not_retried():
    class _PermanentFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise LLMProviderError(
                provider="deepseek",
                model=request.model,
                code="authentication_failed",
                retryable=False,
                status_code=401,
            )

    inner = _PermanentFailure()
    with pytest.raises(LLMProviderError, match="authentication_failed"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 1


async def test_an_unknown_programming_failure_is_not_retried():
    class _ProgrammingFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise RuntimeError("unexpected adapter defect")

    inner = _ProgrammingFailure()
    with pytest.raises(RuntimeError, match="adapter defect"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 1


async def test_a_transient_provider_failure_uses_only_the_outer_retry_budget():
    class _TransientFailure:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise LLMProviderError(
                provider="deepseek",
                model=request.model,
                code="upstream_unavailable",
                retryable=True,
                status_code=503,
            )

    inner = _TransientFailure()
    with pytest.raises(LLMProviderError, match="upstream_unavailable"):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3


async def test_a_stream_that_already_emitted_is_never_replayed():
    """Retrying after deltas reached the caller would duplicate the run's visible
    output. A response that delivered something is delivered, however short."""

    class _StreamsThenEmpty:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            if on_delta is not None:
                await on_delta("partial", "output")
            return LLMResponse(text="", model=request.model, input_tokens=1, output_tokens=1)

    inner = _StreamsThenEmpty()
    seen: list[str] = []

    async def collect(text: str, _channel: str) -> None:
        seen.append(text)

    await RetryingLLM(inner, sleep=_no_sleep).complete(_request(), on_delta=collect)
    assert inner.calls == 1
    assert seen == ["partial"]


async def test_backoff_grows_between_attempts():
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    await RetryingLLM(_EmptyThenText(empties=99), attempts=3, sleep=record).complete(_request())
    assert delays == [1.0, 2.0]


async def test_response_records_the_model_the_provider_says_it_served(monkeypatch):
    """The stored llm.call is the only durable record of which model ran a stage.

    Echoing the requested name back would make an alias or a silent substitution
    invisible, so "is this really running deepseek-v4-pro?" could never be answered
    from the run's own evidence.
    """

    class RecordingCompletions:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                model="deepseek-v4-pro-2026-07-01",
            )

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user")
    )

    assert response.model == "deepseek-v4-pro-2026-07-01"


async def test_response_falls_back_to_the_requested_model_when_none_is_reported(monkeypatch):
    class RecordingCompletions:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                model=None,
            )

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user")
    )

    assert response.model == "deepseek-v4-pro"


async def test_streamed_response_also_records_the_served_model(monkeypatch):
    async def provider_stream():
        yield SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(reasoning_content=None, content="a"))],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
            model="deepseek-v4-pro-2026-07-01",
        )

    class RecordingCompletions:
        async def create(self, **_kwargs):
            return provider_stream()

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    async def on_delta(_text: str, _kind: str) -> None:
        return None

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-v4-pro", system="system", user="user"),
        on_delta=on_delta,
    )

    assert response.model == "deepseek-v4-pro-2026-07-01"


def test_a_turn_with_no_history_is_the_same_request_either_way():
    """The three callers that build a conversation body used to disagree here:
    chat produced a one-element list, routing and the pipeline produced None.
    Both reach the provider identically only because `request_messages` falls
    back to `request.user` — an agreement between two functions, not a rule.
    This pins it, so the day the fallback changes, one test says so."""
    prompt = "Create and measure a Bell state."

    assert conversation_request_messages([], prompt) is None
    assert request_messages(LLMRequest(model="m", system="s", user=prompt)) == [
        {"role": "user", "content": prompt}
    ]
    assert request_messages(
        LLMRequest(
            model="m", system="s", user=prompt, messages=[{"role": "user", "content": prompt}]
        )
    ) == [{"role": "user", "content": prompt}]


def test_history_puts_the_current_request_last_and_keeps_roles():
    history = [
        {"role": "user", "content": "Partition six suppliers."},
        {"role": "assistant", "content": "That is a weighted MaxCut."},
    ]

    built = conversation_request_messages(history, "Build it now.")

    assert built == [*history, {"role": "user", "content": "Build it now."}]
    # The wire body must match what was built, or the history is decoration.
    assert (
        request_messages(LLMRequest(model="m", system="s", user="Build it now.", messages=built))
        == built
    )


def test_history_is_copied_not_aliased():
    """The pipeline holds one history tuple and spends it on every stage. A
    builder that handed back the caller's own dicts would let one stage's
    mutation reach the next one's prompt."""
    history = [{"role": "user", "content": "original"}]

    built = conversation_request_messages(history, "now")
    built[0]["content"] = "mutated"

    assert history[0]["content"] == "original"
