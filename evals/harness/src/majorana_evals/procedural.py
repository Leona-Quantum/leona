"""Deterministic procedural holdouts for cross-instance generalization.

Static corpora remain useful for regression attribution, but repeated development can
eventually expose every fixed coefficient. These cases derive fresh bounded instances
and independent analytic/enumerative oracles from a recorded seed. They never call a
provider and never reuse product verification code.
"""

from __future__ import annotations

import hashlib
import itertools
import math
import random
import re
from collections.abc import Callable

import numpy as np
from majorana_contracts.enums import Framework

from majorana_evals.schema import CorpusCase, Expect

PROCEDURAL_GENERATOR_VERSION = "v3"
PROCEDURAL_SURFACE_VERSION = "surface-v2"
MAX_PROMPT_VARIANTS = 3
_FAMILIES = (
    "single-qubit-state",
    "finite-shot-pauli",
    "midcircuit-active-reset",
    "compiled-state-preparation",
    "entanglement-spectrum",
    "qubo",
    "assignment",
    "qpe",
    "nondyadic-qpe",
    "amplitude-estimation",
    "amplitude-damping",
    "mixed-kraus-channel",
    "lindblad-stinespring",
    "cirq-gradient",
    "quantum-fisher-information",
    "grover",
    "chsh",
    "teleportation",
    "repetition-qec",
    "ordered-trotter",
    "exact-dynamics",
    "linear-system",
    "pennylane-vqe",
)


def _family_rng(seed: int, family: str, index: int) -> random.Random:
    payload = f"{PROCEDURAL_GENERATOR_VERSION}:{seed}:{family}:{index}".encode()
    derived = int.from_bytes(hashlib.sha256(payload).digest()[:16], "big")
    return random.Random(derived)


def _case_id(seed: int, family: str, index: int) -> str:
    return f"procedural-{PROCEDURAL_GENERATOR_VERSION}-s{seed}-{family}-{index + 1:02d}"


def _surface_variant(prompt: str, variant: int) -> str:
    """Apply a semantics-preserving lexical/layout perturbation to one frozen task."""

    if variant == 0:
        return prompt
    if variant == 1:
        replacements = (
            (
                "Return top-level numeric RESULT keys",
                "Place these top-level numeric fields in RESULT:",
            ),
            ("Return top-level RESULT keys", "Place these top-level fields in RESULT:"),
            (
                "return top-level numeric RESULT keys",
                "place these top-level numeric fields in RESULT:",
            ),
            ("return top-level RESULT keys", "place these top-level fields in RESULT:"),
            ("Bind ", "Assign "),
            ("bind ", "assign "),
            (" to FINAL_CIRCUIT", " as FINAL_CIRCUIT"),
            ("Do not ", "Never "),
            ("do not ", "never "),
            ("using exactly ", "with precisely "),
            ("Use exactly ", "Use precisely "),
            ("Compute ", "Calculate "),
            ("compute ", "calculate "),
        )
        transformed = prompt
        for before, after in replacements:
            transformed = transformed.replace(before, after)
        return transformed
    if variant == 2:
        replacements = (
            ("Implement ", "Construct and execute "),
            ("implement ", "construct and execute "),
            ("Build ", "Construct "),
            ("build ", "construct "),
            ("Starting from ", "Begin with "),
            ("starting from ", "begin with "),
            ("Prepare ", "Initialize "),
            ("prepare ", "initialize "),
            ("Return ", "Report "),
            ("return ", "report "),
            ("Bind ", "Set "),
            ("bind ", "set "),
            (" to FINAL_CIRCUIT", " as FINAL_CIRCUIT"),
            ("Do not ", "You must not "),
            ("do not ", "must not "),
            ("exactly", "precisely"),
        )
        transformed = prompt
        for before, after in replacements:
            transformed = transformed.replace(before, after)
        requirements = tuple(
            part.strip()
            for part in re.split(r"(?<=[.!?])\s+(?=[A-Z])", transformed)
            if part.strip()
        )
        if len(requirements) < 2:
            raise RuntimeError("structured surface variant requires at least two sentences")
        return (
            "Strict implementation brief: preserve every supplied number, operation "
            "order, bit convention, and field name.\n\nRequirements:\n- "
            + "\n- ".join(requirements)
        )
    raise ValueError(f"surface variant must be in 0..{MAX_PROMPT_VARIANTS - 1}")


def _single_qubit_state_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "single-qubit-state", index)
    theta = round(rng.uniform(0.08, math.pi - 0.08), 6)
    phi = round(rng.uniform(-math.pi, math.pi), 6)
    return CorpusCase(
        id=_case_id(seed, "single-qubit-state", index),
        category="Procedural — Basic single-qubit state",
        split="holdout",
        difficulty="basic",
        workload="educational",
        framework=Framework.QISKIT,
        prompt=(
            "In Qiskit, prepare one qubit from |0> by applying "
            f"RY({theta}) and then RZ({phi}) in that order. Use the exact unmeasured "
            "statevector to return plain numeric RESULT keys bloch_x, bloch_y, bloch_z, "
            "and probability_one. Bind the same unmeasured circuit to FINAL_CIRCUIT. "
            "Compute the values from the circuit state; do not hard-code the analytic "
            "answer and do not use finite-shot counts."
        ),
        expect=Expect(
            output_keys=["bloch_x", "bloch_y", "bloch_z", "probability_one"],
            expected_values={
                "bloch_x": math.sin(theta) * math.cos(phi),
                "bloch_y": math.sin(theta) * math.sin(phi),
                "bloch_z": math.cos(theta),
                "probability_one": math.sin(theta / 2.0) ** 2,
            },
            expected_value_tolerance=1e-10,
        ),
    )


def _finite_shot_pauli_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "finite-shot-pauli", index)
    theta = round(rng.uniform(0.12, math.pi - 0.12), 6)
    phi = round(rng.uniform(-2.8, 2.8), 6)
    observable = rng.choice(("X", "Y", "Z"))
    shots = rng.choice((4096, 8192, 12000, 16384, 20000))
    simulator_seed = rng.randint(1, 2**31 - 1)
    delta = 1e-9
    exact_expectation = {
        "X": math.sin(theta) * math.cos(phi),
        "Y": math.sin(theta) * math.sin(phi),
        "Z": math.cos(theta),
    }[observable]
    confidence_half_width = 2.0 * math.sqrt(math.log(2.0 / delta) / (2.0 * shots))
    return CorpusCase(
        id=_case_id(seed, "finite-shot-pauli", index),
        category="Procedural — Finite-shot Pauli estimation",
        split="holdout",
        difficulty="intermediate",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            "In Qiskit, prepare one qubit from |0> by applying "
            f"RY({theta}) then RZ({phi}). Estimate the {observable} expectation using "
            f"exactly {shots} measurement shots with simulator seed {simulator_seed}. "
            "Measure in the correct Pauli basis and compute sampled_expectation as "
            "(n_zero-n_one)/shots from the actual counts. Independently compute "
            "exact_expectation from the unmeasured circuit Statevector, then return "
            "absolute_sampling_error=abs(sampled_expectation-exact_expectation) and "
            "confidence_half_width=2*sqrt(log(2/delta)/(2*shots)) for delta=1e-9. "
            "Return top-level RESULT keys counts, requested_shots, exact_expectation, "
            "sampled_expectation, absolute_sampling_error, and confidence_half_width. "
            "Bind the measured circuit that produced counts to FINAL_CIRCUIT. Preserve "
            "sampling honestly: do not substitute the exact value for the sampled one."
        ),
        expect=Expect(
            output_keys=[
                "counts",
                "requested_shots",
                "exact_expectation",
                "sampled_expectation",
                "absolute_sampling_error",
                "confidence_half_width",
            ],
            expected_values={
                "requested_shots": float(shots),
                "exact_expectation": float(exact_expectation),
                "confidence_half_width": float(confidence_half_width),
            },
            expected_value_ranges={
                "sampled_expectation": {
                    "minimum": max(-1.0, exact_expectation - confidence_half_width),
                    "maximum": min(1.0, exact_expectation + confidence_half_width),
                },
                "absolute_sampling_error": {
                    "minimum": 0.0,
                    "maximum": confidence_half_width,
                },
            },
            expected_value_tolerance=1e-12,
        ),
    )


def _midcircuit_active_reset_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "midcircuit-active-reset", index)
    theta = round(rng.uniform(0.25, math.pi - 0.25), 6)
    shots = rng.choice((4096, 8192, 12000, 16384, 20000))
    simulator_seed = rng.randint(1, 2**31 - 1)
    delta = 1e-9
    initial_one_probability = math.sin(theta / 2.0) ** 2
    sampling_half_width = math.sqrt(math.log(2.0 / delta) / (2.0 * shots))
    return CorpusCase(
        id=_case_id(seed, "midcircuit-active-reset", index),
        category="Procedural — Mid-circuit active reset",
        split="holdout",
        difficulty="advanced",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            "Build a one-qubit Qiskit dynamic circuit with two classical bits c0 and "
            f"c1. Prepare RY({theta})|0>, measure q0 into c0, and use the current "
            "Qiskit `with circuit.if_test((circuit.clbits[0], True)):` API to apply X "
            "to q0 only when c0 is one. Then measure q0 into c1. Execute exactly "
            f"{shots} shots with simulator seed {simulator_seed} and a matching "
            "transpiler seed. Qiskit displays each two-bit count key as c1c0: derive "
            "initial_one_probability from the right bit and final_zero_probability "
            "from the left bit of the actual counts. Return top-level RESULT keys "
            "counts, requested_shots, exact_initial_one_probability, "
            "initial_one_probability, final_zero_probability, and "
            "sampling_half_width=sqrt(log(2/delta)/(2*shots)) for delta=1e-9. Bind "
            "the transpiled dynamic circuit that produced the counts to FINAL_CIRCUIT. "
            "Do not replace feed-forward with a coherent unitary or fabricate marginals."
        ),
        expect=Expect(
            output_keys=[
                "counts",
                "requested_shots",
                "exact_initial_one_probability",
                "initial_one_probability",
                "final_zero_probability",
                "sampling_half_width",
            ],
            expected_values={
                "requested_shots": float(shots),
                "exact_initial_one_probability": float(initial_one_probability),
                "final_zero_probability": 1.0,
                "sampling_half_width": float(sampling_half_width),
            },
            expected_value_ranges={
                "initial_one_probability": {
                    "minimum": max(0.0, initial_one_probability - sampling_half_width),
                    "maximum": min(1.0, initial_one_probability + sampling_half_width),
                },
            },
            expected_count_marginals=[
                {
                    "result_key": "counts",
                    "bit_indices": [0],
                    "expected_bits": "0",
                    "probability_range": {"minimum": 1.0, "maximum": 1.0},
                },
                {
                    "result_key": "counts",
                    "bit_indices": [1],
                    "expected_bits": "1",
                    "probability_range": {
                        "minimum": max(0.0, initial_one_probability - sampling_half_width),
                        "maximum": min(1.0, initial_one_probability + sampling_half_width),
                    },
                },
            ],
            expected_value_tolerance=1e-12,
            requires_native_optimization=True,
        ),
    )


_PAULI_MATRICES = {
    "I": np.eye(2, dtype=complex),
    "X": np.asarray([[0, 1], [1, 0]], dtype=complex),
    "Y": np.asarray([[0, -1j], [1j, 0]], dtype=complex),
    "Z": np.diag([1, -1]).astype(complex),
}


def _pauli_label_matrix(label: str) -> np.ndarray:
    matrix = np.asarray([[1.0 + 0.0j]])
    for symbol in label:
        matrix = np.kron(matrix, _PAULI_MATRICES[symbol])
    return matrix


def _apply_single_qubit(state: np.ndarray, gate: np.ndarray, qubit: int) -> np.ndarray:
    result = state.copy()
    for zero_index in range(len(state)):
        if (zero_index >> qubit) & 1:
            continue
        one_index = zero_index | (1 << qubit)
        zero_amplitude = state[zero_index]
        one_amplitude = state[one_index]
        result[zero_index] = gate[0, 0] * zero_amplitude + gate[0, 1] * one_amplitude
        result[one_index] = gate[1, 0] * zero_amplitude + gate[1, 1] * one_amplitude
    return result


def _apply_cnot(state: np.ndarray, control: int, target: int) -> np.ndarray:
    result = np.zeros_like(state)
    for basis_index, amplitude in enumerate(state):
        destination = basis_index ^ (1 << target) if (basis_index >> control) & 1 else basis_index
        result[destination] += amplitude
    return result


def _ry_matrix(angle: float) -> np.ndarray:
    cosine = math.cos(angle / 2.0)
    sine = math.sin(angle / 2.0)
    return np.asarray([[cosine, -sine], [sine, cosine]], dtype=complex)


def _rz_matrix(angle: float) -> np.ndarray:
    return np.diag([np.exp(-0.5j * angle), np.exp(0.5j * angle)])


def _rx_matrix(angle: float) -> np.ndarray:
    cosine = math.cos(angle / 2.0)
    sine = math.sin(angle / 2.0)
    return np.asarray(
        [[cosine, -1j * sine], [-1j * sine, cosine]],
        dtype=complex,
    )


def _hermitian_exponential(matrix: np.ndarray, time: float) -> np.ndarray:
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    return (eigenvectors * np.exp(-1j * time * eigenvalues)) @ eigenvectors.conj().T


def _compiled_state_preparation_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "compiled-state-preparation", index)
    qubits = rng.randint(2, 5)
    first_layer = [
        (round(rng.uniform(-2.8, 2.8), 6), round(rng.uniform(-2.8, 2.8), 6)) for _ in range(qubits)
    ]
    second_layer = [round(rng.uniform(-2.8, 2.8), 6) for _ in range(qubits)]
    path = list(range(qubits))
    rng.shuffle(path)
    entanglers = list(zip(path[:-1], path[1:], strict=True))
    transpiler_seed = rng.randint(1, 2**31 - 1)

    state = np.zeros(1 << qubits, dtype=complex)
    state[0] = 1.0
    for qubit, (theta, phi) in enumerate(first_layer):
        state = _apply_single_qubit(state, _ry_matrix(theta), qubit)
        state = _apply_single_qubit(state, _rz_matrix(phi), qubit)
    for control, target in entanglers:
        state = _apply_cnot(state, control, target)
    for qubit, angle in enumerate(second_layer):
        state = _apply_single_qubit(state, _rx_matrix(angle), qubit)

    first_layer_text = "; ".join(
        f"q{qubit}: RY({theta}) then RZ({phi})" for qubit, (theta, phi) in enumerate(first_layer)
    )
    entangler_text = ", ".join(f"CX(q{control}->q{target})" for control, target in entanglers)
    second_layer_text = "; ".join(
        f"q{qubit}: RX({angle})" for qubit, angle in enumerate(second_layer)
    )
    return CorpusCase(
        id=_case_id(seed, "compiled-state-preparation", index),
        category="Procedural — Native gate-basis compilation",
        split="holdout",
        difficulty="advanced",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            f"Build this unmeasured {qubits}-qubit Qiskit state-preparation circuit "
            f"from |0...0>. First layer: {first_layer_text}. Then apply these gates in "
            f"the written order: {entangler_text}. Final layer: {second_layer_text}. "
            "Transpile that source circuit with basis_gates=['rz','sx','x','cx'], "
            f"optimization_level=1, and seed_transpiler={transpiler_seed}. Bind the "
            "actual transpiled circuit to FINAL_CIRCUIT. From independently simulated "
            "source and transpiled Statevectors, return top-level numeric RESULT keys "
            "state_fidelity, basis_violation_count, source_depth, and compiled_depth. "
            "state_fidelity must compare the two executed states up to global phase, "
            "and basis_violation_count must inspect FINAL_CIRCUIT operations. Do not "
            "bind the uncompiled source or merely claim that compilation occurred."
        ),
        expect=Expect(
            output_keys=[
                "state_fidelity",
                "basis_violation_count",
                "source_depth",
                "compiled_depth",
            ],
            expected_values={
                "state_fidelity": 1.0,
                "basis_violation_count": 0.0,
            },
            expected_value_tolerance=1e-9,
            expected_native_statevector=[
                (float(amplitude.real), float(amplitude.imag)) for amplitude in state
            ],
            native_statevector_tolerance=1e-9,
            allowed_qasm_gate_names=["rz", "sx", "x", "cx"],
            requires_native_optimization=True,
        ),
    )


def _entanglement_spectrum_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "entanglement-spectrum", index)
    qubits = rng.randint(3, 7)
    kept_qubits = sorted(rng.sample(range(qubits), rng.randint(1, min(3, qubits - 1))))
    traced_qubits = [qubit for qubit in range(qubits) if qubit not in kept_qubits]
    first_layer = [
        (round(rng.uniform(-2.7, 2.7), 6), round(rng.uniform(-2.7, 2.7), 6)) for _ in range(qubits)
    ]
    second_layer = [round(rng.uniform(-2.7, 2.7), 6) for _ in range(qubits)]
    path = list(range(qubits))
    rng.shuffle(path)
    entanglers = list(zip(path[:-1], path[1:], strict=True))

    state = np.zeros(1 << qubits, dtype=complex)
    state[0] = 1.0
    for qubit, (theta, phi) in enumerate(first_layer):
        state = _apply_single_qubit(state, _ry_matrix(theta), qubit)
        state = _apply_single_qubit(state, _rz_matrix(phi), qubit)
    for control, target in entanglers:
        state = _apply_cnot(state, control, target)
    for qubit, angle in enumerate(second_layer):
        state = _apply_single_qubit(state, _ry_matrix(angle), qubit)

    schmidt_matrix = np.zeros(
        (1 << len(kept_qubits), 1 << len(traced_qubits)),
        dtype=complex,
    )
    for basis_index, amplitude in enumerate(state):
        kept_index = sum(
            ((basis_index >> qubit) & 1) << position for position, qubit in enumerate(kept_qubits)
        )
        traced_index = sum(
            ((basis_index >> qubit) & 1) << position for position, qubit in enumerate(traced_qubits)
        )
        schmidt_matrix[kept_index, traced_index] = amplitude
    density = schmidt_matrix @ schmidt_matrix.conj().T
    eigenvalues = np.clip(np.linalg.eigvalsh(density), 0.0, None)
    eigenvalues /= np.sum(eigenvalues)
    spectrum = sorted((float(value) for value in eigenvalues), reverse=True)
    purity = float(np.sum(eigenvalues**2))
    von_neumann_entropy = float(
        -sum(value * math.log2(value) for value in eigenvalues if value > 1e-14)
    )
    renyi2_entropy = float(-math.log2(purity))
    schmidt_rank = float(np.count_nonzero(eigenvalues > 1e-12))

    first_layer_text = "; ".join(
        f"q{qubit}: RY({theta}) then RZ({phi})" for qubit, (theta, phi) in enumerate(first_layer)
    )
    entangler_text = ", ".join(f"CX(q{control}->q{target})" for control, target in entanglers)
    second_layer_text = "; ".join(
        f"q{qubit}: RY({angle})" for qubit, angle in enumerate(second_layer)
    )
    return CorpusCase(
        id=_case_id(seed, "entanglement-spectrum", index),
        category="Procedural — Arbitrary-bipartition entanglement spectrum",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"Build this unmeasured {qubits}-qubit Qiskit pure-state circuit from "
            f"|0...0>. First layer: {first_layer_text}. Then apply these gates in the "
            f"written order: {entangler_text}. Final layer: {second_layer_text}. "
            f"Subsystem A is the Qiskit qubit set {kept_qubits}; trace out exactly "
            f"qubits {traced_qubits}. From the reduced density matrix, return top-level "
            "RESULT keys entanglement_spectrum (all eigenvalues in descending order), "
            "subsystem_purity, von_neumann_entropy_bits, renyi2_entropy_bits, "
            "largest_schmidt_eigenvalue, and schmidt_rank using eigenvalue threshold "
            "1e-12. Use log base 2, clip only negligible negative Hermitian-eigensolver "
            "noise, and bind the complete unmeasured circuit to FINAL_CIRCUIT. Respect "
            "Qiskit subsystem indices; do not assume the kept qubits are contiguous or "
            "derive the spectrum from a hand-reversed amplitude axis."
        ),
        expect=Expect(
            output_keys=[
                "entanglement_spectrum",
                "subsystem_purity",
                "von_neumann_entropy_bits",
                "renyi2_entropy_bits",
                "largest_schmidt_eigenvalue",
                "schmidt_rank",
            ],
            expected_values={
                "subsystem_purity": purity,
                "von_neumann_entropy_bits": von_neumann_entropy,
                "renyi2_entropy_bits": renyi2_entropy,
                "largest_schmidt_eigenvalue": spectrum[0],
                "schmidt_rank": schmidt_rank,
            },
            expected_result_subset={"entanglement_spectrum": spectrum},
            expected_value_tolerance=1e-9,
            expected_native_statevector=[
                (float(amplitude.real), float(amplitude.imag)) for amplitude in state
            ],
            native_statevector_tolerance=1e-9,
        ),
    )


def _qubo_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "qubo", index)
    variables = rng.randint(4, 7)
    linear = [rng.randint(-4, 6) for _ in range(variables)]
    quadratic: list[tuple[int, int, int]] = []
    for left in range(variables):
        for right in range(left + 1, variables):
            if rng.random() < 0.45:
                weight = rng.choice((-3, -2, -1, 1, 2, 3))
                quadratic.append((left, right, weight))
    if not quadratic:
        quadratic.append((0, 1, rng.choice((-3, -2, -1, 1, 2, 3))))

    def objective(bits: list[int]) -> float:
        value = sum(weight * bits[variable] for variable, weight in enumerate(linear))
        value += sum(weight * bits[left] * bits[right] for left, right, weight in quadratic)
        return float(value)

    optimum = min(
        objective([(assignment >> variable) & 1 for variable in range(variables)])
        for assignment in range(1 << variables)
    )
    linear_text = " + ".join(f"({weight})*x{variable}" for variable, weight in enumerate(linear))
    quadratic_text = " + ".join(f"({weight})*x{left}*x{right}" for left, right, weight in quadratic)
    expression = f"{linear_text} + {quadratic_text}"
    return CorpusCase(
        id=_case_id(seed, "qubo", index),
        category="Procedural — Explicit QUBO generalization",
        split="holdout",
        difficulty="advanced",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            f"In Qiskit, minimize the explicit {variables}-variable business QUBO "
            f"C(x)={expression}. Build and optimize a QAOA circuit with deterministic "
            "seeds and at least 4096 shots, and independently enumerate every binary "
            "assignment. Return top-level RESULT keys sampled_objective, "
            "exact_objective, selected_bits in x0-first order, and counts. "
            "sampled_objective and selected_bits must come from the same bitstring "
            "actually present in counts; bind the optimized measured circuit to "
            "FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["sampled_objective", "exact_objective", "selected_bits", "counts"],
            expected_values={"sampled_objective": optimum, "exact_objective": optimum},
            expected_value_tolerance=0.0,
        ),
    )


def _assignment_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "assignment", index)
    size = rng.randint(3, 4)
    while True:
        costs = [[rng.randint(1, 15) for _ in range(size)] for _ in range(size)]
        scored = sorted(
            (
                sum(costs[worker][job] for worker, job in enumerate(permutation)),
                permutation,
            )
            for permutation in itertools.permutations(range(size))
        )
        if len(scored) == 1 or scored[0][0] < scored[1][0]:
            break
    optimum = float(scored[0][0])
    return CorpusCase(
        id=_case_id(seed, "assignment", index),
        category="Procedural — Constrained minimum-cost assignment",
        split="holdout",
        difficulty="advanced",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            f"In Qiskit, solve this {size}-worker by {size}-job minimum-cost assignment "
            f"with row-major binary variables x_worker_job and cost matrix {costs!r}. "
            "Enforce exactly one job per worker and exactly one worker per job in a "
            "QAOA cost Hamiltonian, use deterministic seeds and at least 8192 shots, "
            "and decode only assignments actually observed in counts that satisfy all "
            "original constraints. Independently enumerate all job permutations. "
            "Return top-level RESULT keys sampled_assignment_cost, "
            "exact_assignment_cost, jobs_by_worker, and counts. The sampled cost and "
            "jobs must come from the same observed feasible bitstring, not from the "
            "classical baseline. Bind the optimized measured circuit to FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=[
                "sampled_assignment_cost",
                "exact_assignment_cost",
                "jobs_by_worker",
                "counts",
            ],
            expected_values={
                "sampled_assignment_cost": optimum,
                "exact_assignment_cost": optimum,
            },
            expected_value_tolerance=0.0,
        ),
    )


def _qpe_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "qpe", index)
    counting_qubits = rng.randint(3, 6)
    dimension = 1 << counting_qubits
    phase_integer = rng.randint(1, dimension - 1)
    phase = phase_integer / dimension
    top_key = format(phase_integer, f"0{counting_qubits}b")
    return CorpusCase(
        id=_case_id(seed, "qpe", index),
        category="Procedural — Exact dyadic phase estimation",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            "Implement noiseless Qiskit phase estimation for the one-qubit unitary "
            f"U=diag(1, exp(2*pi*i*{phase!r})) with the target in |1>, "
            f"{counting_qubits} counting qubits, deterministic seeds, and at least "
            "4096 shots. Use controlled powers and an inverse QFT. Return top-level "
            "RESULT keys phase_integer, phase_estimate, peak_probability, and counts, "
            "all decoded from the sampled counting register. Bind the complete measured "
            "QPE circuit to FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["phase_integer", "phase_estimate", "peak_probability", "counts"],
            expected_top_bitstring=top_key,
            expected_values={
                "phase_integer": float(phase_integer),
                "phase_estimate": phase,
                "peak_probability": 1.0,
            },
            expected_value_tolerance=0.001,
        ),
    )


def _phase_bin_probability(register_size: int, phase: float, phase_integer: int) -> float:
    delta = phase - phase_integer / register_size
    denominator = math.sin(math.pi * delta)
    if abs(denominator) <= 1e-14:
        return 1.0
    numerator = math.sin(math.pi * register_size * delta)
    return (numerator / (register_size * denominator)) ** 2


def _nondyadic_qpe_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "nondyadic-qpe", index)
    counting_qubits = rng.randint(3, 7)
    target_qubits = rng.randint(1, 3)
    target_dimension = 1 << target_qubits
    target_basis_index = rng.randrange(target_dimension)
    register_size = 1 << counting_qubits
    lower_integer = rng.randrange(register_size - 1)
    fractional_offset = rng.uniform(0.12, 0.45)
    if rng.random() < 0.5:
        fractional_offset = 1.0 - fractional_offset
    eigenphase = round((lower_integer + fractional_offset) / register_size, 9)
    probabilities = [
        _phase_bin_probability(register_size, eigenphase, phase_integer)
        for phase_integer in range(register_size)
    ]
    probability_sum = sum(probabilities)
    probabilities = [probability / probability_sum for probability in probabilities]
    dominant_integer = max(
        range(register_size), key=lambda candidate: (probabilities[candidate], -candidate)
    )
    target_bitstring = format(target_basis_index, f"0{target_qubits}b")
    return CorpusCase(
        id=_case_id(seed, "nondyadic-qpe", index),
        category="Procedural — Non-dyadic finite-register QPE",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            "Implement noiseless Qiskit phase estimation for a diagonal "
            f"{target_qubits}-qubit target unitary. Prepare the target computational "
            f"basis state |q{target_qubits - 1}...q0>={target_bitstring}; that basis "
            f"state has eigenvalue exp(2*pi*i*{eigenphase}), while every other target "
            f"basis state has eigenvalue 1. Use {counting_qubits} counting qubits, "
            "controlled powers, and an inverse QFT. From the complete unmeasured circuit "
            "Statevector, return dominant_integer, finite_phase_estimate, "
            "dominant_probability, and the JSON-compatible list phase_probabilities in "
            f"displayed integer order 0 through {register_size - 1}. Bind the complete "
            "unmeasured QPE circuit to FINAL_CIRCUIT. Report the finite-register result "
            "and actual probability distribution; do not substitute the continuous input "
            "phase or add measurements."
        ),
        expect=Expect(
            output_keys=[
                "dominant_integer",
                "finite_phase_estimate",
                "dominant_probability",
                "phase_probabilities",
            ],
            expected_values={
                "dominant_integer": float(dominant_integer),
                "finite_phase_estimate": float(dominant_integer / register_size),
                "dominant_probability": float(probabilities[dominant_integer]),
            },
            expected_result_subset={
                "phase_probabilities": [float(probability) for probability in probabilities]
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _amplitude_estimation_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "amplitude-estimation", index)
    system_qubits = rng.randint(1, 3)
    evaluation_qubits = rng.randint(2, 6)
    angles = [round(rng.uniform(0.18, 2.82), 6) for _ in range(system_qubits)]
    phases = [round(rng.uniform(-2.7, 2.7), 6) for _ in range(system_qubits)]
    dimension = 1 << system_qubits
    good_count = rng.randint(1, dimension - 1) if dimension > 2 else 1
    good_states = sorted(rng.sample(range(dimension), good_count))

    good_probability = 0.0
    for basis_index in good_states:
        probability = 1.0
        for qubit, angle in enumerate(angles):
            excited_probability = math.sin(angle / 2.0) ** 2
            probability *= (
                excited_probability if (basis_index >> qubit) & 1 else 1.0 - excited_probability
            )
        good_probability += probability

    register_size = 1 << evaluation_qubits
    phase = math.asin(math.sqrt(good_probability)) / math.pi
    raw_probabilities = [
        0.5
        * (
            _phase_bin_probability(register_size, phase, phase_integer)
            + _phase_bin_probability(register_size, (-phase) % 1.0, phase_integer)
        )
        for phase_integer in range(register_size)
    ]
    folded_probabilities = [0.0] * (register_size // 2 + 1)
    for phase_integer, probability in enumerate(raw_probabilities):
        folded_probabilities[min(phase_integer, register_size - phase_integer)] += probability
    folded_phase_integer = max(
        range(len(folded_probabilities)),
        key=lambda candidate: (folded_probabilities[candidate], -candidate),
    )
    amplitude_estimate = math.sin(math.pi * folded_phase_integer / register_size) ** 2
    rotations = ", ".join(
        f"q{qubit}: RY({angle}) then RZ({phase_angle})"
        for qubit, (angle, phase_angle) in enumerate(zip(angles, phases, strict=True))
    )
    return CorpusCase(
        id=_case_id(seed, "amplitude-estimation", index),
        category="Procedural — Finite-register amplitude estimation",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            "Implement standard statevector quantum amplitude estimation in Qiskit. "
            f"The {system_qubits}-qubit state-preparation circuit A starts in all-zero "
            f"and applies these gates in the written order: {rotations}. Treat the "
            f"Qiskit computational-basis integer indices {good_states} as good states. "
            f"Use {evaluation_qubits} evaluation qubits, construct the Grover iterate "
            "from A and the good-state reflection, apply controlled powers and an inverse "
            "QFT, and obtain exact statevector probabilities. Fold each phase integer y "
            f"with {register_size}-y and add each symmetric pair's probabilities before "
            "selecting the dominant folded integer. Return the corresponding "
            "sin(pi*y/2**m)^2 value as amplitude_estimate and the selected pair's total "
            "probability as dominant_pair_probability. Bind the complete estimation "
            "circuit to FINAL_CIRCUIT. Do not substitute the directly computed good-state "
            "probability or a hard-coded finite-register answer."
        ),
        expect=Expect(
            output_keys=["amplitude_estimate", "dominant_pair_probability"],
            expected_values={
                "amplitude_estimate": float(amplitude_estimate),
                "dominant_pair_probability": float(folded_probabilities[folded_phase_integer]),
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _amplitude_damping_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "amplitude-damping", index)
    gamma = round(rng.uniform(0.12, 0.78), 6)
    alpha = round(rng.uniform(0.22, 1.18), 6)
    phase = round(rng.uniform(-2.4, 2.4), 6)
    cosine = math.cos(alpha)
    sine = math.sin(alpha)
    excited = (1.0 - gamma) * sine**2
    coherence = math.sqrt(1.0 - gamma) * cosine * sine * complex(math.cos(-phase), math.sin(-phase))
    rho00 = cosine**2 + gamma * sine**2
    purity = rho00**2 + excited**2 + 2.0 * abs(coherence) ** 2
    return CorpusCase(
        id=_case_id(seed, "amplitude-damping", index),
        category="Procedural — Coherent-input amplitude damping",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            "Implement a unitary two-qubit Qiskit Stinespring dilation for amplitude "
            f"damping with gamma={gamma!r} on a system initially in "
            f"cos({alpha!r})|0> + exp(i*{phase!r})*sin({alpha!r})|1>, with an "
            "environment initially in |0>. Trace out the environment and return "
            "top-level numeric RESULT keys excited_population, coherence_0_1_real, "
            "coherence_0_1_imag, and state_purity in basis |0>,|1>. Bind the complete "
            "dilation circuit to FINAL_CIRCUIT and derive all values from its reduced "
            "simulated state."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=[
                "excited_population",
                "coherence_0_1_real",
                "coherence_0_1_imag",
                "state_purity",
            ],
            expected_values={
                "excited_population": excited,
                "coherence_0_1_real": float(coherence.real),
                "coherence_0_1_imag": float(coherence.imag),
                "state_purity": purity,
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _mixed_kraus_channel_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "mixed-kraus-channel", index)
    theta = round(rng.uniform(0.12, math.pi - 0.12), 6)
    phi = round(rng.uniform(-2.8, 2.8), 6)
    amplitude_probability = round(rng.uniform(0.03, 0.76), 6)
    pauli_error_probability = round(rng.uniform(0.02, 0.55), 6)

    state = np.asarray(
        [math.cos(theta / 2.0), np.exp(1j * phi) * math.sin(theta / 2.0)],
        dtype=complex,
    )
    density = np.outer(state, state.conj())
    identity = np.eye(2, dtype=complex)
    pauli_x = np.asarray([[0.0, 1.0], [1.0, 0.0]], dtype=complex)
    pauli_y = np.asarray([[0.0, -1.0j], [1.0j, 0.0]], dtype=complex)
    pauli_z = np.diag([1.0, -1.0]).astype(complex)
    amplitude_operators = (
        np.asarray(
            [[1.0, 0.0], [0.0, math.sqrt(1.0 - amplitude_probability)]],
            dtype=complex,
        ),
        np.asarray(
            [[0.0, math.sqrt(amplitude_probability)], [0.0, 0.0]],
            dtype=complex,
        ),
    )
    density = sum(operator @ density @ operator.conj().T for operator in amplitude_operators)
    pauli_operators = (
        math.sqrt(1.0 - pauli_error_probability) * identity,
        math.sqrt(pauli_error_probability / 3.0) * pauli_x,
        math.sqrt(pauli_error_probability / 3.0) * pauli_y,
        math.sqrt(pauli_error_probability / 3.0) * pauli_z,
    )
    density = sum(operator @ density @ operator.conj().T for operator in pauli_operators)
    return CorpusCase(
        id=_case_id(seed, "mixed-kraus-channel", index),
        category="Procedural — Mixed-state Kraus-channel execution",
        split="holdout",
        difficulty="advanced",
        workload="practical",
        framework=Framework.QISKIT,
        prompt=(
            "In Qiskit, prepare one qubit by applying "
            f"RY({theta}) then RZ({phi}) to |0>. Apply an amplitude-damping Kraus "
            f"channel with gamma={amplitude_probability}, using K0=[[1,0],"
            "[0,sqrt(1-gamma)]] and K1=[[0,sqrt(gamma)],[0,0]]. Then apply the "
            "explicit Pauli-mixture channel E(rho)=(1-p)*rho + (p/3)*(X*rho*X + "
            f"Y*rho*Y + Z*rho*Z), with p={pauli_error_probability}. Execute the "
            "non-unitary circuit with AerSimulator(method='density_matrix') and return "
            "top-level numeric RESULT keys excited_population, bloch_x, bloch_y, "
            "bloch_z, density_trace, and state_purity from the simulated density "
            "matrix. Bind the same channel circuit, without replacing its channels by "
            "an ideal unitary, to FINAL_CIRCUIT. OpenQASM or a pure statevector is not "
            "required for this non-unitary artifact; do not report either as evidence."
        ),
        expect=Expect(
            output_keys=[
                "excited_population",
                "bloch_x",
                "bloch_y",
                "bloch_z",
                "density_trace",
                "state_purity",
            ],
            expected_values={
                "excited_population": float(density[1, 1].real),
                "bloch_x": float(np.trace(density @ pauli_x).real),
                "bloch_y": float(np.trace(density @ pauli_y).real),
                "bloch_z": float(np.trace(density @ pauli_z).real),
                "density_trace": float(np.trace(density).real),
                "state_purity": float(np.trace(density @ density).real),
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _lindblad_stinespring_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "lindblad-stinespring", index)
    initial_name = rng.choice(("plus", "minus", "plus_i", "minus_i"))
    initial_label = {
        "plus": "+",
        "minus": "-",
        "plus_i": "+i",
        "minus_i": "-i",
    }[initial_name]
    amplitude_rate = round(rng.uniform(0.03, 1.1), 6)
    dephasing_rate = round(rng.uniform(0.02, 0.7), 6)
    angular_frequency = round(rng.uniform(-1.5, 1.5), 6)
    evolution_time = round(rng.uniform(0.05, 1.8), 6)
    initial_coherence = {
        "plus": 0.5 + 0.0j,
        "minus": -0.5 + 0.0j,
        "plus_i": -0.5j,
        "minus_i": 0.5j,
    }[initial_name]
    excited_population = 0.5 * math.exp(-amplitude_rate * evolution_time)
    coherence = initial_coherence * np.exp(
        (-amplitude_rate / 2.0 - 2.0 * dephasing_rate - 1j * angular_frequency) * evolution_time
    )
    purity = (1.0 - excited_population) ** 2 + excited_population**2 + 2.0 * abs(coherence) ** 2
    return CorpusCase(
        id=_case_id(seed, "lindblad-stinespring", index),
        category="Procedural — Lindblad evolution with Stinespring witness",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"Starting from the one-qubit |{initial_label}> state, solve at t="
            f"{evolution_time} the time-independent master equation d rho/dt = "
            f"-i*[({angular_frequency}/2)*Z, rho] + {amplitude_rate}*D[sigma_minus](rho) "
            f"+ {dephasing_rate}*D[Z](rho), where D[L](rho)=L*rho*L^dagger"
            "-0.5*{L^dagger*L,rho}, sigma_minus=|0><1|, and basis order is |0>,|1>. "
            "Return top-level numeric RESULT keys excited_population=rho[1,1], "
            "coherence_real=Re(rho[0,1]), coherence_imag=Im(rho[0,1]), purity, and "
            "stinespring_density_fidelity. Also bind to FINAL_CIRCUIT a unitary Qiskit "
            "Stinespring circuit with q0 as system, q1 as the amplitude-damping "
            "environment, and q2 as the dephasing environment whose reduced q0 state "
            "implements the same finite-time channel. Compute the fidelity between that "
            "reduced circuit state and the independently solved density matrix; do not "
            "hard-code it or replace the open-system evolution with a pure-state result."
        ),
        expect=Expect(
            output_keys=[
                "excited_population",
                "coherence_real",
                "coherence_imag",
                "purity",
                "stinespring_density_fidelity",
            ],
            expected_values={
                "excited_population": float(excited_population),
                "coherence_real": float(coherence.real),
                "coherence_imag": float(coherence.imag),
                "purity": float(purity),
                "stinespring_density_fidelity": 1.0,
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _cirq_gradient_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "cirq-gradient", index)
    theta = round(rng.uniform(-1.3, 1.3), 6)
    phi = round(rng.uniform(-1.3, 1.3), 6)
    expectation = math.sin(theta) * math.cos(phi)
    theta_gradient = math.cos(theta) * math.cos(phi)
    phi_gradient = -math.sin(theta) * math.sin(phi)
    return CorpusCase(
        id=_case_id(seed, "cirq-gradient", index),
        category="Procedural — Entangled Cirq parameter shifts",
        split="holdout",
        difficulty="intermediate",
        workload="educational",
        framework=Framework.CIRQ,
        prompt=(
            f"In Cirq, start from |00>, apply RY({theta!r}) to q0, CNOT q0->q1, "
            f"and RZ({phi!r}) to q1. Evaluate the exact X0 X1 expectation and both "
            "parameter derivatives using independent plus/minus pi/2 shifted circuit "
            "simulations. Return top-level RESULT keys xx_expectation, theta_gradient, "
            "and phi_gradient. Bind the unshifted resolved Cirq circuit to "
            "FINAL_CIRCUIT; do not substitute analytic derivatives."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["xx_expectation", "theta_gradient", "phi_gradient"],
            expected_values={
                "xx_expectation": expectation,
                "theta_gradient": theta_gradient,
                "phi_gradient": phi_gradient,
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _quantum_fisher_information_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "quantum-fisher-information", index)
    qubits = rng.randint(3, 5)
    angles = [round(rng.uniform(0.1, math.pi - 0.1), 6) for _ in range(qubits)]
    phases = [round(rng.uniform(-math.pi, math.pi), 6) for _ in range(qubits)]
    labels: list[str] = []
    while len(labels) < qubits + 1:
        label = "".join(rng.choice("IXYZ") for _ in range(qubits))
        if label != "I" * qubits and label not in labels:
            labels.append(label)
    coefficients = []
    for _ in labels:
        coefficient = round(rng.uniform(-1.4, 1.4), 6)
        if abs(coefficient) < 0.12:
            coefficient = 0.12 if coefficient >= 0 else -0.12
        coefficients.append(coefficient)

    state = np.zeros(1 << qubits, dtype=complex)
    state[0] = 1.0
    for qubit, (angle, phase) in enumerate(zip(angles, phases, strict=True)):
        state = _apply_single_qubit(state, _ry_matrix(angle), qubit)
        state = _apply_single_qubit(state, _rz_matrix(phase), qubit)
    for qubit in range(qubits - 1):
        state = _apply_cnot(state, qubit, qubit + 1)

    dimension = 1 << qubits
    generator = sum(
        (
            coefficient * _pauli_label_matrix(label)
            for label, coefficient in zip(labels, coefficients, strict=True)
        ),
        np.zeros((dimension, dimension), dtype=complex),
    )
    generator_mean = float(np.vdot(state, generator @ state).real)
    generator_square_mean = float(np.vdot(state, generator @ generator @ state).real)
    qfi = 4.0 * (generator_square_mean - generator_mean**2)
    rotations = ", ".join(
        f"q{qubit}: RY({angle}) then RZ({phase})"
        for qubit, (angle, phase) in enumerate(zip(angles, phases, strict=True))
    )
    entanglers = ", ".join(f"CNOT q{qubit}->q{qubit + 1}" for qubit in range(qubits - 1))
    terms = ", ".join(
        f"({coefficient})*'{label}'"
        for label, coefficient in zip(labels, coefficients, strict=True)
    )
    return CorpusCase(
        id=_case_id(seed, "quantum-fisher-information", index),
        category="Procedural — General Pauli-generator QFI",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"In Qiskit, prepare a {qubits}-qubit pure state from all-zero by applying "
            f"these gates in order: {rotations}; then {entanglers}. Construct the "
            f"Hermitian generator G as the SparsePauliOp sum [{terms}], where each label "
            f"has Qiskit order q{qubits - 1}...q0 (q0 is the rightmost character). From "
            "the exact Statevector, return the plain numeric RESULT keys generator_mean "
            "for <G> and quantum_fisher_information for 4*(<G^2>-<G>^2). Bind the state-"
            "preparation circuit to FINAL_CIRCUIT. Compute both moments from the circuit "
            "state and explicit operator; do not insert a GHZ/graph-state formula or a "
            "hard-coded answer."
        ),
        expect=Expect(
            output_keys=["generator_mean", "quantum_fisher_information"],
            expected_values={
                "generator_mean": generator_mean,
                "quantum_fisher_information": float(qfi),
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _grover_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "grover", index)
    qubits = rng.randint(3, 6)
    search_space = 1 << qubits
    marked_count = rng.randint(1, min(3, search_space // 8))
    marked = sorted(rng.sample(range(search_space), marked_count))
    marked_keys = [format(value, f"0{qubits}b") for value in marked]
    theta = math.asin(math.sqrt(marked_count / search_space))
    ideal_iterations = math.pi / (4.0 * theta) - 0.5
    iterations = max(1, int(math.floor(ideal_iterations + 0.5)))
    marked_probability = math.sin((2 * iterations + 1) * theta) ** 2
    return CorpusCase(
        id=_case_id(seed, "grover", index),
        category="Procedural — Multi-solution Grover amplification",
        split="holdout",
        difficulty="advanced",
        workload="educational",
        framework=Framework.QISKIT,
        prompt=(
            f"Build a {qubits}-search-qubit Qiskit Grover circuit whose marked "
            f"q{qubits - 1}...q0 bitstrings are {marked_keys}. Start uniformly and "
            f"apply exactly {iterations} complete oracle-plus-diffusion iterations. "
            "Use an exact Statevector to return top-level numeric RESULT keys "
            "marked_probability and marked_probability_spread, where the latter is "
            "max minus min probability among the marked states. Bind the complete "
            "unmeasured circuit to FINAL_CIRCUIT; derive both values from it."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["marked_probability", "marked_probability_spread"],
            expected_values={
                "marked_probability": marked_probability,
                "marked_probability_spread": 0.0,
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _chsh_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "chsh", index)
    alpha = round(rng.uniform(0.24, 0.72), 6)
    concurrence = math.sin(2.0 * alpha)
    beta = math.atan(concurrence)
    zz_component = math.cos(beta)
    xx_component = math.sin(beta) * concurrence
    chsh = 2.0 * math.sqrt(1.0 + concurrence**2)
    return CorpusCase(
        id=_case_id(seed, "chsh", index),
        category="Procedural — Partially entangled CHSH",
        split="holdout",
        difficulty="intermediate",
        workload="educational",
        framework=Framework.QISKIT,
        prompt=(
            f"In Qiskit, prepare cos({alpha!r})|00>+sin({alpha!r})|11>. Evaluate "
            "the exact Statevector CHSH expression S=E(A0,B0)+E(A0,B1)+E(A1,B0)"
            f"-E(A1,B1), with A0=Z, A1=X, beta={beta!r}, "
            "B0=cos(beta)Z+sin(beta)X, and B1=cos(beta)Z-sin(beta)X. Return "
            "top-level numeric RESULT keys correlator_a0b0, correlator_a0b1, "
            "correlator_a1b0, correlator_a1b1, and chsh_value=abs(S). Bind the state "
            "preparation circuit to FINAL_CIRCUIT and derive every correlator from it."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=[
                "correlator_a0b0",
                "correlator_a0b1",
                "correlator_a1b0",
                "correlator_a1b1",
                "chsh_value",
            ],
            expected_values={
                "correlator_a0b0": zz_component,
                "correlator_a0b1": zz_component,
                "correlator_a1b0": xx_component,
                "correlator_a1b1": -xx_component,
                "chsh_value": chsh,
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _teleportation_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "teleportation", index)
    theta = round(rng.uniform(0.15, 2.95), 6)
    phi = round(rng.uniform(-2.8, 2.8), 6)
    return CorpusCase(
        id=_case_id(seed, "teleportation", index),
        category="Procedural — Coherent arbitrary-state teleportation",
        split="holdout",
        difficulty="intermediate",
        workload="educational",
        framework=Framework.QISKIT,
        prompt=(
            "In Qiskit, prepare an input qubit with RY("
            f"{theta!r}) followed by RZ({phi!r}) on |0>, then coherently teleport it "
            "through a Bell pair using unitary syndrome extraction and coherent X/Z "
            "corrections without mid-circuit measurement. Derive the receiver's "
            "reduced state from the complete Statevector and return top-level numeric "
            "RESULT keys receiver_bloch_x, receiver_bloch_y, receiver_bloch_z, and "
            "teleportation_fidelity. Bind the complete three-qubit circuit to "
            "FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=[
                "receiver_bloch_x",
                "receiver_bloch_y",
                "receiver_bloch_z",
                "teleportation_fidelity",
            ],
            expected_values={
                "receiver_bloch_x": math.sin(theta) * math.cos(phi),
                "receiver_bloch_y": math.sin(theta) * math.sin(phi),
                "receiver_bloch_z": math.cos(theta),
                "teleportation_fidelity": 1.0,
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _repetition_qec_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "repetition-qec", index)
    code_kind = rng.choice(("bit-flip", "phase-flip"))
    error_gate = "X" if code_kind == "bit-flip" else "Z"
    theta = round(rng.uniform(0.12, math.pi - 0.12), 6)
    phi = round(rng.uniform(-2.8, 2.8), 6)
    artifact_error_qubit = rng.randrange(3)
    return CorpusCase(
        id=_case_id(seed, "repetition-qec", index),
        category="Procedural — Coherent repetition-code QEC",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"Implement the coherent three-qubit {code_kind} repetition code in Qiskit "
            f"for the arbitrary complex logical state prepared by RY({theta}) then "
            f"RZ({phi}) on data qubit 0 before encoding. Coherently extract the two "
            "parity syndromes into ancillas and correct every possible single-qubit "
            f"{error_gate} error. Evaluate encoded-state fidelity separately for no error "
            f"and {error_gate} errors on data qubits 0, 1, and 2. Return their minimum as "
            "the top-level numeric RESULT key worst_case_fidelity, and bind the complete "
            f"data-qubit-{artifact_error_qubit} error-and-recovery circuit to "
            "FINAL_CIRCUIT. Keep syndrome extraction and correction coherent; do not "
            "replace the recovery or fidelity calculation with a hard-coded result."
        ),
        expect=Expect(
            output_keys=["worst_case_fidelity"],
            expected_values={"worst_case_fidelity": 1.0},
            expected_value_tolerance=1e-9,
        ),
    )


def _ordered_trotter_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "ordered-trotter", index)
    labels = ["IXX", "YYI", "ZII"]
    rng.shuffle(labels)
    coefficients = []
    for _ in labels:
        coefficient = round(rng.uniform(-0.9, 0.9), 6)
        if abs(coefficient) < 0.12:
            coefficient = 0.12 if coefficient >= 0 else -0.12
        coefficients.append(coefficient)
    evolution_time = round(rng.uniform(0.3, 1.3), 6)
    steps = rng.randint(3, 10)
    initial_index = rng.randrange(8)
    initial_bitstring = format(initial_index, "03b")
    observable_qubit = rng.randrange(3)
    observable_label = ["I", "I", "I"]
    observable_label[2 - observable_qubit] = "Z"
    observable = _pauli_label_matrix("".join(observable_label))

    terms = [
        coefficient * _pauli_label_matrix(label)
        for label, coefficient in zip(labels, coefficients, strict=True)
    ]
    hamiltonian = sum(terms, np.zeros((8, 8), dtype=complex))
    initial = np.zeros(8, dtype=complex)
    initial[initial_index] = 1.0
    step_time = evolution_time / steps
    step_unitary = np.eye(8, dtype=complex)
    for term in terms[:-1]:
        step_unitary = _hermitian_exponential(term, step_time / 2.0) @ step_unitary
    step_unitary = _hermitian_exponential(terms[-1], step_time) @ step_unitary
    for term in reversed(terms[:-1]):
        step_unitary = _hermitian_exponential(term, step_time / 2.0) @ step_unitary
    trotter_state = np.linalg.matrix_power(step_unitary, steps) @ initial
    exact_state = _hermitian_exponential(hamiltonian, evolution_time) @ initial
    trotter_observable = float(np.vdot(trotter_state, observable @ trotter_state).real)
    exact_observable = float(np.vdot(exact_state, observable @ exact_state).real)
    fidelity = float(abs(np.vdot(exact_state, trotter_state)) ** 2)
    written_terms = ", ".join(
        f"({coefficient})*'{label}'"
        for label, coefficient in zip(labels, coefficients, strict=True)
    )
    trotter_key = f"trotter_z{observable_qubit}"
    exact_key = f"exact_z{observable_qubit}"
    return CorpusCase(
        id=_case_id(seed, "ordered-trotter", index),
        category="Procedural — Ordered second-order Pauli Trotterization",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"With Qiskit Pauli-label order q2q1q0 and q0 rightmost, start from "
            f"|q2q1q0>={initial_bitstring} and approximate evolution to t={evolution_time} "
            f"under the ordered Hamiltonian terms [{written_terms}] using exactly {steps} "
            "symmetric second-order product-formula steps. In each step apply half "
            "evolutions for the first and second written terms in order, the full third "
            "term, then the second and first half evolutions in reverse order. "
            f"Independently compute the exact matrix exponential. Return {trotter_key} "
            f"and {exact_key} for the two exact Statevector expectations of Z on q"
            f"{observable_qubit}, plus exact_trotter_fidelity for the squared state "
            "overlap. Bind the complete Trotter circuit, not the exact unitary, to "
            "FINAL_CIRCUIT. Do not change the written term order or substitute exact "
            "evolution for the product formula."
        ),
        expect=Expect(
            output_keys=[trotter_key, exact_key, "exact_trotter_fidelity"],
            expected_values={
                trotter_key: trotter_observable,
                exact_key: exact_observable,
                "exact_trotter_fidelity": fidelity,
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _exact_dynamics_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "exact-dynamics", index)
    z0 = round(rng.uniform(-1.1, 1.1), 6)
    z1 = round(rng.uniform(-1.1, 1.1), 6)
    coupling = round(rng.choice((-1.0, 1.0)) * rng.uniform(0.18, 0.82), 6)
    time = round(rng.uniform(0.25, 1.55), 6)
    diagonal = z0 + z1
    frequency = math.sqrt(diagonal**2 + coupling**2)
    transition = (coupling / frequency) ** 2 * math.sin(frequency * time) ** 2
    survival = 1.0 - transition
    return CorpusCase(
        id=_case_id(seed, "exact-dynamics", index),
        category="Procedural — Exact indexed-Pauli dynamics",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            "Using the mathematical tensor order q0 then q1, exactly evolve |00> "
            f"for t={time!r} under H=({z0!r})*Z_0 + ({z1!r})*Z_1 + "
            f"({coupling!r})*X_0 X_1 by an explicit matrix exponential. Convert the "
            "resulting unitary once into the correct Qiskit qubit order, derive all "
            "numbers from the final circuit Statevector, and return top-level numeric "
            "RESULT keys survival_probability and z0_expectation. Bind the complete "
            "unmeasured evolution circuit to FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["survival_probability", "z0_expectation"],
            expected_values={
                "survival_probability": survival,
                "z0_expectation": 1.0 - 2.0 * transition,
            },
            expected_value_tolerance=1e-9,
        ),
    )


def _linear_system_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "linear-system", index)
    first_key, second_key = rng.sample((1, 3, 5, 7), 2)
    first_eigenvalue = first_key / 8.0
    second_eigenvalue = second_key / 8.0
    diagonal = (first_eigenvalue + second_eigenvalue) / 2.0
    off_diagonal = (first_eigenvalue - second_eigenvalue) / 2.0
    while True:
        rhs = [rng.choice((-3, -2, -1, 1, 2, 3)) for _ in range(2)]
        determinant = diagonal**2 - off_diagonal**2
        raw_x0 = (diagonal * rhs[0] - off_diagonal * rhs[1]) / determinant
        raw_x1 = (-off_diagonal * rhs[0] + diagonal * rhs[1]) / determinant
        norm = math.hypot(raw_x0, raw_x1)
        solution = [raw_x0 / norm, raw_x1 / norm]
        magnitudes = [abs(value) for value in solution]
        maximum = max(magnitudes)
        pivot = next(
            position
            for position, magnitude in enumerate(magnitudes)
            if math.isclose(magnitude, maximum, rel_tol=0.0, abs_tol=1e-12)
        )
        if solution[pivot] < 0:
            solution = [-value for value in solution]
        if abs(solution[0]) >= 0.15:
            break
    ratio = solution[1] / solution[0]
    matrix = [[diagonal, off_diagonal], [off_diagonal, diagonal]]
    return CorpusCase(
        id=_case_id(seed, "linear-system", index),
        category="Procedural — Exact-dyadic HHL linear system",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.QISKIT,
        prompt=(
            f"Implement a complete HHL-style Qiskit circuit for A={matrix!r} and "
            f"b={rhs!r}, using U=exp(2*pi*i*A), three phase qubits, exact controlled "
            "powers, reciprocal rotation, and exact phase-register uncomputation. "
            "Postselect the success ancilla from the circuit Statevector. Return "
            "top-level numeric RESULT keys solution_x0, solution_x1, "
            "amplitude_ratio_x1_over_x0, solution_fidelity, and classical_residual. "
            "The signed normalized components and x1/x0 ratio must come from the "
            "postselected circuit. Fix the state's arbitrary global sign by making "
            "the lowest-index component among magnitudes tied within 1e-12 of the "
            "largest magnitude positive; use a dense classical solve only for "
            "comparison. "
            "Bind the complete HHL circuit to FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=[
                "solution_x0",
                "solution_x1",
                "amplitude_ratio_x1_over_x0",
                "solution_fidelity",
                "classical_residual",
            ],
            expected_values={
                "solution_x0": solution[0],
                "solution_x1": solution[1],
                "amplitude_ratio_x1_over_x0": ratio,
                "solution_fidelity": 1.0,
                "classical_residual": 0.0,
            },
            expected_value_tolerance=1e-8,
        ),
    )


def _pennylane_vqe_case(seed: int, index: int) -> CorpusCase:
    rng = _family_rng(seed, "pennylane-vqe", index)
    offset = round(rng.uniform(-0.35, 0.35), 6)
    z0 = round(rng.uniform(-1.0, 1.0), 6)
    z1 = round(rng.uniform(-1.0, 1.0), 6)
    xx = round(rng.uniform(-0.65, 0.65), 6)
    yy = round(rng.uniform(-0.65, 0.65), 6)
    xy = round(rng.choice((-1.0, 1.0)) * rng.uniform(0.12, 0.55), 6)
    even_radius = math.sqrt((z0 + z1) ** 2 + (xx - yy) ** 2 + xy**2)
    odd_radius = math.sqrt((z0 - z1) ** 2 + (xx + yy) ** 2 + xy**2)
    ground_energy = offset - max(even_radius, odd_radius)
    return CorpusCase(
        id=_case_id(seed, "pennylane-vqe", index),
        category="Procedural — Complex PennyLane VQE",
        split="holdout",
        difficulty="research",
        workload="scientific",
        framework=Framework.PENNYLANE,
        prompt=(
            "In PennyLane, minimize the explicit two-qubit Hamiltonian "
            f"H=({offset!r})*I + ({z0!r})*Z(0) + ({z1!r})*Z(1) + "
            f"({xx!r})*X(0)@X(1) + ({yy!r})*Y(0)@Y(1) + "
            f"({xy!r})*X(0)@Y(1) with a trainable statevector VQE ansatz that can "
            "represent complex amplitudes, exact gradients, multiple deterministic "
            "starts, and a bounded optimizer. Return top-level numeric RESULT keys "
            "variational_energy, exact_energy, and energy_gap. exact_energy may use "
            "dense diagonalization only as a comparison; variational_energy must be "
            "recomputed from the optimized circuit. Bind the optimized native "
            "PennyLane tape to FINAL_CIRCUIT."
        ),
        expect=Expect(
            terminal_reason=None,
            output_keys=["variational_energy", "exact_energy", "energy_gap"],
            expected_values={
                "variational_energy": ground_energy,
                "exact_energy": ground_energy,
                "energy_gap": 0.0,
            },
            expected_value_tolerance=2e-5,
        ),
    )


_GENERATORS: dict[str, Callable[[int, int], CorpusCase]] = {
    "single-qubit-state": _single_qubit_state_case,
    "finite-shot-pauli": _finite_shot_pauli_case,
    "midcircuit-active-reset": _midcircuit_active_reset_case,
    "compiled-state-preparation": _compiled_state_preparation_case,
    "entanglement-spectrum": _entanglement_spectrum_case,
    "qubo": _qubo_case,
    "assignment": _assignment_case,
    "qpe": _qpe_case,
    "nondyadic-qpe": _nondyadic_qpe_case,
    "amplitude-estimation": _amplitude_estimation_case,
    "amplitude-damping": _amplitude_damping_case,
    "mixed-kraus-channel": _mixed_kraus_channel_case,
    "lindblad-stinespring": _lindblad_stinespring_case,
    "cirq-gradient": _cirq_gradient_case,
    "quantum-fisher-information": _quantum_fisher_information_case,
    "grover": _grover_case,
    "chsh": _chsh_case,
    "teleportation": _teleportation_case,
    "repetition-qec": _repetition_qec_case,
    "ordered-trotter": _ordered_trotter_case,
    "exact-dynamics": _exact_dynamics_case,
    "linear-system": _linear_system_case,
    "pennylane-vqe": _pennylane_vqe_case,
}


def generate_procedural_cases(
    seed: int,
    *,
    cases_per_family: int = 1,
    prompt_variants_per_case: int = 1,
) -> list[CorpusCase]:
    """Generate stable, provider-free holdouts and their independent oracles."""

    if not 0 <= seed < 2**63:
        raise ValueError("procedural seed must be in 0..2**63-1")
    if not 1 <= cases_per_family <= 20:
        raise ValueError("cases_per_family must be between one and twenty")
    if not 1 <= prompt_variants_per_case <= MAX_PROMPT_VARIANTS:
        raise ValueError(f"prompt_variants_per_case must be between one and {MAX_PROMPT_VARIANTS}")
    base_cases = [
        _GENERATORS[family](seed, index)
        for family in _FAMILIES
        for index in range(cases_per_family)
    ]
    cases: list[CorpusCase] = []
    for base_case in base_cases:
        semantic_group_id = base_case.id
        cases.append(
            base_case.model_copy(
                update={
                    "semantic_group_id": semantic_group_id,
                    "prompt_variant": "base",
                }
            )
        )
        for variant in range(1, prompt_variants_per_case):
            transformed = _surface_variant(base_case.prompt, variant)
            if transformed == base_case.prompt:
                raise RuntimeError(f"surface variant {variant} did not change {base_case.id}")
            cases.append(
                base_case.model_copy(
                    update={
                        "id": (f"{base_case.id}-{PROCEDURAL_SURFACE_VERSION}-{variant + 1:02d}"),
                        "prompt": transformed,
                        "semantic_group_id": semantic_group_id,
                        "prompt_variant": f"surface-{variant + 1:02d}",
                    }
                )
            )
    return cases
