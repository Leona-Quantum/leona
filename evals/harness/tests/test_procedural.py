import ast
import itertools
import math
import re

import numpy as np
import pytest
from scipy.linalg import expm
from majorana_contracts.enums import Framework
from majorana_evals.__main__ import _load_eval_cases
from majorana_evals.procedural import (
    PROCEDURAL_GENERATOR_VERSION,
    PROCEDURAL_SURFACE_VERSION,
    generate_procedural_cases,
)
from majorana_evals.runner import _score_result_expectations


def _by_family(seed: int):
    return {
        case.id.split(f"procedural-{PROCEDURAL_GENERATOR_VERSION}-s{seed}-", 1)[1].rsplit("-", 1)[
            0
        ]: case
        for case in generate_procedural_cases(seed)
    }


def test_procedural_cases_are_reproducible_and_seed_sensitive():
    first = generate_procedural_cases(20260802, cases_per_family=2)
    repeated = generate_procedural_cases(20260802, cases_per_family=2)
    different = generate_procedural_cases(20260803, cases_per_family=2)

    assert [case.model_dump(mode="json") for case in first] == [
        case.model_dump(mode="json") for case in repeated
    ]
    assert [case.prompt for case in first] != [case.prompt for case in different]
    assert len(first) == 46
    assert len({case.id for case in first}) == 46


def test_increasing_case_count_does_not_mutate_existing_seeded_cases():
    one = generate_procedural_cases(91, cases_per_family=1)
    three = generate_procedural_cases(91, cases_per_family=3)
    first_by_family = {case.id.rsplit("-", 1)[0]: case.model_dump(mode="json") for case in one}

    for case in three:
        if case.id.endswith("-01"):
            assert case.model_dump(mode="json") == first_by_family[case.id.rsplit("-", 1)[0]]


def test_surface_variants_preserve_oracles_numbers_and_machine_identifiers():
    base_cases = generate_procedural_cases(20260802)
    varied_cases = generate_procedural_cases(20260802, prompt_variants_per_case=3)

    assert len(varied_cases) == 3 * len(base_cases)
    number_pattern = re.compile(r"(?<![A-Za-z_])-?\d+(?:\.\d+)?(?:e[-+]?\d+)?", re.I)
    identifier_pattern = re.compile(
        r"\b(?:FINAL_CIRCUIT|RESULT|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b"
    )
    for base_index, base_case in enumerate(base_cases):
        original, formal, brief = varied_cases[3 * base_index : 3 * base_index + 3]
        assert original.model_dump(mode="json") == base_case.model_dump(mode="json")
        assert original.semantic_group_id == base_case.id
        assert original.prompt_variant == "base"
        assert formal.id == f"{base_case.id}-{PROCEDURAL_SURFACE_VERSION}-02"
        assert brief.id == f"{base_case.id}-{PROCEDURAL_SURFACE_VERSION}-03"
        assert formal.semantic_group_id == brief.semantic_group_id == base_case.id
        assert formal.prompt_variant == "surface-02"
        assert brief.prompt_variant == "surface-03"
        assert len({original.prompt, formal.prompt, brief.prompt}) == 3
        assert brief.prompt.startswith("Strict implementation brief:")
        assert "\n\nRequirements:\n- " in brief.prompt
        assert brief.prompt.count("\n- ") >= 2
        for variant in (formal, brief):
            base_payload = base_case.model_dump(
                mode="json", exclude={"id", "prompt", "prompt_variant"}
            )
            variant_payload = variant.model_dump(
                mode="json", exclude={"id", "prompt", "prompt_variant"}
            )
            assert variant_payload == base_payload
            assert number_pattern.findall(variant.prompt) == number_pattern.findall(
                base_case.prompt
            )
            assert identifier_pattern.findall(variant.prompt) == identifier_pattern.findall(
                base_case.prompt
            )


def test_procedural_corpus_covers_frameworks_difficulties_and_workloads():
    cases = generate_procedural_cases(7)

    assert {case.framework for case in cases} == {
        Framework.QISKIT,
        Framework.CIRQ,
        Framework.PENNYLANE,
    }
    assert {case.difficulty for case in cases} == {
        "basic",
        "intermediate",
        "advanced",
        "research",
    }
    assert {case.workload for case in cases} == {"educational", "practical", "scientific"}
    assert all(case.split == "holdout" for case in cases)
    assert all(case.expect.saves_artifact for case in cases)


def test_basic_single_qubit_oracle_matches_independent_dense_state():
    case = _by_family(20260802)["single-qubit-state"]
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\).*RZ\(([-0-9.]+)\)", case.prompt).groups()
    ]
    cosine = math.cos(theta / 2.0)
    sine = math.sin(theta / 2.0)
    ry = np.asarray([[cosine, -sine], [sine, cosine]], dtype=complex)
    rz = np.diag([np.exp(-0.5j * phi), np.exp(0.5j * phi)])
    state = rz @ ry @ np.asarray([1.0, 0.0], dtype=complex)
    pauli_x = np.asarray([[0, 1], [1, 0]], dtype=complex)
    pauli_y = np.asarray([[0, -1j], [1j, 0]], dtype=complex)
    pauli_z = np.diag([1, -1]).astype(complex)

    assert case.expect.expected_values == pytest.approx(
        {
            "bloch_x": float(np.vdot(state, pauli_x @ state).real),
            "bloch_y": float(np.vdot(state, pauli_y @ state).real),
            "bloch_z": float(np.vdot(state, pauli_z @ state).real),
            "probability_one": float(abs(state[1]) ** 2),
        },
        abs=1e-15,
    )


@pytest.mark.parametrize("seed", [0, 2, 5])
def test_finite_shot_pauli_ranges_cover_seeded_sampling_for_every_axis(seed):
    qiskit = pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from qiskit.quantum_info import Statevector
    from qiskit_aer import AerSimulator

    case = _by_family(seed)["finite-shot-pauli"]
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt).groups()
    ]
    observable = re.search(r"Estimate the ([XYZ]) expectation", case.prompt).group(1)
    shots, simulator_seed = [
        int(value)
        for value in re.search(
            r"exactly (\d+) measurement shots with simulator seed (\d+)", case.prompt
        ).groups()
    ]
    unmeasured = qiskit.QuantumCircuit(1)
    unmeasured.ry(theta, 0)
    unmeasured.rz(phi, 0)
    pauli = {
        "X": np.asarray([[0.0, 1.0], [1.0, 0.0]], dtype=complex),
        "Y": np.asarray([[0.0, -1.0j], [1.0j, 0.0]], dtype=complex),
        "Z": np.diag([1.0, -1.0]).astype(complex),
    }[observable]
    exact = float(Statevector.from_instruction(unmeasured).expectation_value(pauli).real)
    measured = qiskit.QuantumCircuit(1, 1)
    measured.compose(unmeasured, inplace=True)
    if observable == "X":
        measured.h(0)
    elif observable == "Y":
        measured.sdg(0)
        measured.h(0)
    measured.measure(0, 0)
    compiled = qiskit.transpile(measured, seed_transpiler=simulator_seed)
    counts = (
        AerSimulator(seed_simulator=simulator_seed).run(compiled, shots=shots).result().get_counts()
    )
    sampled = float((counts.get("0", 0) - counts.get("1", 0)) / shots)
    error = abs(sampled - exact)
    half_width = 2.0 * math.sqrt(math.log(2.0 / 1e-9) / (2.0 * shots))

    assert sum(counts.values()) == shots
    assert case.expect.expected_values == pytest.approx(
        {
            "requested_shots": float(shots),
            "exact_expectation": exact,
            "confidence_half_width": half_width,
        },
        abs=1e-14,
    )
    sampled_range = case.expect.expected_value_ranges["sampled_expectation"]
    error_range = case.expect.expected_value_ranges["absolute_sampling_error"]
    assert sampled_range.minimum <= sampled <= sampled_range.maximum
    assert error_range.minimum <= error <= error_range.maximum


def test_midcircuit_active_reset_oracle_reads_both_displayed_count_bits():
    qiskit = pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from qiskit import qasm3
    from qiskit_aer import AerSimulator

    case = _by_family(20260802)["midcircuit-active-reset"]
    theta = float(re.search(r"Prepare RY\(([-0-9.]+)\)\|0>", case.prompt).group(1))
    shots, simulator_seed = [
        int(value)
        for value in re.search(
            r"Execute exactly (\d+) shots with simulator seed (\d+)", case.prompt
        ).groups()
    ]
    circuit = qiskit.QuantumCircuit(1, 2)
    circuit.ry(theta, 0)
    circuit.measure(0, 0)
    with circuit.if_test((circuit.clbits[0], True)):
        circuit.x(0)
    circuit.measure(0, 1)
    simulator = AerSimulator(seed_simulator=simulator_seed)
    compiled = qiskit.transpile(
        circuit,
        simulator,
        seed_transpiler=simulator_seed,
    )
    raw_counts = simulator.run(compiled, shots=shots).result().get_counts()
    counts = {str(key): int(value) for key, value in raw_counts.items()}
    initial_one = sum(value for key, value in counts.items() if key.replace(" ", "")[1] == "1")
    final_zero = sum(value for key, value in counts.items() if key.replace(" ", "")[0] == "0")
    initial_one_probability = initial_one / shots
    final_zero_probability = final_zero / shots
    exact_initial = math.sin(theta / 2.0) ** 2
    half_width = math.sqrt(math.log(2.0 / 1e-9) / (2.0 * shots))
    result = {
        "counts": counts,
        "requested_shots": shots,
        "exact_initial_one_probability": exact_initial,
        "initial_one_probability": initial_one_probability,
        "final_zero_probability": final_zero_probability,
        "sampling_half_width": half_width,
    }

    assert _score_result_expectations(case.expect, result) == []
    assert sum(counts.values()) == shots
    assert all(key.replace(" ", "")[0] == "0" for key in counts)
    assert abs(initial_one_probability - exact_initial) <= half_width
    assert "if (" in qasm3.dumps(compiled)
    assert case.expect.requires_native_optimization is True


def test_compiled_state_oracle_matches_independent_dense_simulation_and_gate_basis():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import Statevector, state_fidelity

    case = _by_family(20260802)["compiled-state-preparation"]
    qubits = int(re.search(r"unmeasured (\d+)-qubit", case.prompt).group(1))
    first_layer = [
        (int(qubit), float(theta), float(phi))
        for qubit, theta, phi in re.findall(
            r"q(\d+): RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt
        )
    ]
    entanglers = [
        (int(control), int(target))
        for control, target in re.findall(r"CX\(q(\d+)->q(\d+)\)", case.prompt)
    ]
    second_layer = [
        (int(qubit), float(angle))
        for qubit, angle in re.findall(r"q(\d+): RX\(([-0-9.]+)\)", case.prompt)
    ]
    transpiler_seed = int(re.search(r"seed_transpiler=(\d+)", case.prompt).group(1))
    state = np.zeros(1 << qubits, dtype=complex)
    state[0] = 1.0

    def apply_one(vector, gate, qubit):
        result = vector.copy()
        for zero_index in range(len(vector)):
            if (zero_index >> qubit) & 1:
                continue
            one_index = zero_index | (1 << qubit)
            result[zero_index] = gate[0, 0] * vector[zero_index] + gate[0, 1] * vector[one_index]
            result[one_index] = gate[1, 0] * vector[zero_index] + gate[1, 1] * vector[one_index]
        return result

    source = qiskit.QuantumCircuit(qubits)
    for qubit, theta, phi in first_layer:
        source.ry(theta, qubit)
        source.rz(phi, qubit)
        cosine, sine = math.cos(theta / 2.0), math.sin(theta / 2.0)
        state = apply_one(
            state,
            np.asarray([[cosine, -sine], [sine, cosine]], dtype=complex),
            qubit,
        )
        state = apply_one(
            state,
            np.diag([np.exp(-0.5j * phi), np.exp(0.5j * phi)]),
            qubit,
        )
    for control, target in entanglers:
        source.cx(control, target)
        result = np.zeros_like(state)
        for basis_index, amplitude in enumerate(state):
            destination = (
                basis_index ^ (1 << target) if (basis_index >> control) & 1 else basis_index
            )
            result[destination] += amplitude
        state = result
    for qubit, angle in second_layer:
        source.rx(angle, qubit)
        cosine, sine = math.cos(angle / 2.0), math.sin(angle / 2.0)
        state = apply_one(
            state,
            np.asarray(
                [[cosine, -1j * sine], [-1j * sine, cosine]],
                dtype=complex,
            ),
            qubit,
        )

    compiled = qiskit.transpile(
        source,
        basis_gates=["rz", "sx", "x", "cx"],
        optimization_level=1,
        seed_transpiler=transpiler_seed,
    )
    expected = np.asarray(
        [complex(real, imaginary) for real, imaginary in case.expect.expected_native_statevector]
    )
    source_state = Statevector.from_instruction(source)
    compiled_state = Statevector.from_instruction(compiled)

    assert expected == pytest.approx(state, abs=1e-14)
    assert source_state.data == pytest.approx(state, abs=1e-14)
    assert state_fidelity(source_state, compiled_state) == pytest.approx(1.0, abs=1e-14)
    assert set(compiled.count_ops()) <= set(case.expect.allowed_qasm_gate_names)
    assert case.expect.expected_values == {
        "state_fidelity": 1.0,
        "basis_violation_count": 0.0,
    }
    assert case.expect.requires_native_optimization is True


def test_entanglement_spectrum_oracle_matches_independent_schmidt_matrix():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import Statevector, partial_trace

    case = _by_family(20260802)["entanglement-spectrum"]
    qubits = int(re.search(r"unmeasured (\d+)-qubit", case.prompt).group(1))
    first_layer = [
        (int(qubit), float(theta), float(phi))
        for qubit, theta, phi in re.findall(
            r"q(\d+): RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt
        )
    ]
    entanglers = [
        (int(control), int(target))
        for control, target in re.findall(r"CX\(q(\d+)->q(\d+)\)", case.prompt)
    ]
    final_layer_text = case.prompt.split("Final layer:", 1)[1].split(". Subsystem A", 1)[0]
    second_layer = [
        (int(qubit), float(angle))
        for qubit, angle in re.findall(r"q(\d+): RY\(([-0-9.]+)\)", final_layer_text)
    ]
    kept_qubits, traced_qubits = [
        ast.literal_eval(value)
        for value in re.search(
            r"Subsystem A is the Qiskit qubit set (\[.*?\]); trace out exactly qubits "
            r"(\[.*?\])",
            case.prompt,
        ).groups()
    ]
    state = np.zeros(1 << qubits, dtype=complex)
    state[0] = 1.0

    def apply_one(vector, gate, qubit):
        result = vector.copy()
        for zero_index in range(len(vector)):
            if (zero_index >> qubit) & 1:
                continue
            one_index = zero_index | (1 << qubit)
            result[zero_index] = gate[0, 0] * vector[zero_index] + gate[0, 1] * vector[one_index]
            result[one_index] = gate[1, 0] * vector[zero_index] + gate[1, 1] * vector[one_index]
        return result

    circuit = qiskit.QuantumCircuit(qubits)
    for qubit, theta, phi in first_layer:
        circuit.ry(theta, qubit)
        circuit.rz(phi, qubit)
        cosine, sine = math.cos(theta / 2.0), math.sin(theta / 2.0)
        state = apply_one(
            state,
            np.asarray([[cosine, -sine], [sine, cosine]], dtype=complex),
            qubit,
        )
        state = apply_one(
            state,
            np.diag([np.exp(-0.5j * phi), np.exp(0.5j * phi)]),
            qubit,
        )
    for control, target in entanglers:
        circuit.cx(control, target)
        result = np.zeros_like(state)
        for basis_index, amplitude in enumerate(state):
            destination = (
                basis_index ^ (1 << target) if (basis_index >> control) & 1 else basis_index
            )
            result[destination] += amplitude
        state = result
    for qubit, angle in second_layer:
        circuit.ry(angle, qubit)
        cosine, sine = math.cos(angle / 2.0), math.sin(angle / 2.0)
        state = apply_one(
            state,
            np.asarray([[cosine, -sine], [sine, cosine]], dtype=complex),
            qubit,
        )

    schmidt = np.zeros((1 << len(kept_qubits), 1 << len(traced_qubits)), dtype=complex)
    for basis_index, amplitude in enumerate(state):
        kept_index = sum(
            ((basis_index >> qubit) & 1) << position for position, qubit in enumerate(kept_qubits)
        )
        traced_index = sum(
            ((basis_index >> qubit) & 1) << position for position, qubit in enumerate(traced_qubits)
        )
        schmidt[kept_index, traced_index] = amplitude
    density = schmidt @ schmidt.conj().T
    qiskit_density = np.asarray(
        partial_trace(Statevector.from_instruction(circuit), traced_qubits).data
    )
    eigenvalues = np.clip(np.linalg.eigvalsh(density), 0.0, None)
    eigenvalues /= np.sum(eigenvalues)
    spectrum = sorted((float(value) for value in eigenvalues), reverse=True)
    purity = float(np.sum(eigenvalues**2))
    entropy = float(-sum(value * math.log2(value) for value in eigenvalues if value > 1e-14))

    expected_state = np.asarray(
        [complex(real, imaginary) for real, imaginary in case.expect.expected_native_statevector]
    )
    assert expected_state == pytest.approx(state, abs=1e-14)
    assert np.max(np.abs(density - qiskit_density)) <= 1e-14
    assert case.expect.expected_result_subset["entanglement_spectrum"] == pytest.approx(
        spectrum, abs=1e-14
    )
    assert case.expect.expected_values == pytest.approx(
        {
            "subsystem_purity": purity,
            "von_neumann_entropy_bits": entropy,
            "renyi2_entropy_bits": -math.log2(purity),
            "largest_schmidt_eigenvalue": spectrum[0],
            "schmidt_rank": float(np.count_nonzero(eigenvalues > 1e-12)),
        },
        abs=1e-14,
    )


def test_qubo_oracle_is_the_minimum_of_the_written_polynomial():
    case = _by_family(20260802)["qubo"]
    variables = int(re.search(r"explicit (\d+)-variable", case.prompt).group(1))
    terms = [
        (float(weight), tuple(int(index) for index in indices))
        for weight, indices in re.findall(r"\((-?\d+)\)\*(x\d+(?:\*x\d+)?)", case.prompt)
        for indices in [[int(token[1:]) for token in indices.split("*")]]
    ]

    values = []
    for assignment in range(1 << variables):
        bits = [(assignment >> variable) & 1 for variable in range(variables)]
        values.append(
            sum(weight * math.prod(bits[index] for index in indices) for weight, indices in terms)
        )
    expected = case.expect.expected_values
    assert expected["sampled_objective"] == min(values)
    assert expected["exact_objective"] == min(values)
    assert "optimum" not in case.prompt.lower()


def test_qpe_and_grover_oracles_follow_register_arithmetic():
    cases = _by_family(20260802)
    qpe = cases["qpe"]
    width = int(re.search(r"(\d+) counting qubits", qpe.prompt).group(1))
    phase = float(re.search(r"exp\(2\*pi\*i\*([0-9.]+)\)", qpe.prompt).group(1))
    phase_integer = round(phase * (1 << width))
    assert qpe.expect.expected_top_bitstring == format(phase_integer, f"0{width}b")
    assert qpe.expect.expected_values == {
        "phase_integer": float(phase_integer),
        "phase_estimate": phase,
        "peak_probability": 1.0,
    }

    grover = cases["grover"]
    qubits = int(re.search(r"Build a (\d+)-search-qubit", grover.prompt).group(1))
    iterations = int(re.search(r"apply exactly (\d+)", grover.prompt).group(1))
    marked = re.search(r"bitstrings are \[(.*?)\]", grover.prompt).group(1).split(", ")
    marked_count = len(marked)
    theta = math.asin(math.sqrt(marked_count / (1 << qubits)))
    expected_probability = math.sin((2 * iterations + 1) * theta) ** 2
    assert grover.expect.expected_values["marked_probability"] == pytest.approx(
        expected_probability, abs=1e-15
    )
    assert grover.expect.expected_values["marked_probability_spread"] == 0.0


def test_nondyadic_qpe_oracle_matches_independent_dirichlet_distribution():
    case = _by_family(20260802)["nondyadic-qpe"]
    eigenphase = float(re.search(r"exp\(2\*pi\*i\*([-0-9.]+)\)", case.prompt).group(1))
    counting_qubits = int(re.search(r"Use (\d+) counting qubits", case.prompt).group(1))
    register_size = 1 << counting_qubits
    assert not math.isclose(
        eigenphase * register_size,
        round(eigenphase * register_size),
        rel_tol=0.0,
        abs_tol=1e-8,
    )

    def phase_probability(phase_integer: int) -> float:
        delta = eigenphase - phase_integer / register_size
        denominator = math.sin(math.pi * delta)
        if abs(denominator) <= 1e-14:
            return 1.0
        return (math.sin(math.pi * register_size * delta) / (register_size * denominator)) ** 2

    probabilities = [phase_probability(index) for index in range(register_size)]
    normalization = sum(probabilities)
    probabilities = [probability / normalization for probability in probabilities]
    dominant = int(np.argmax(probabilities))

    assert case.expect.expected_values == pytest.approx(
        {
            "dominant_integer": float(dominant),
            "finite_phase_estimate": dominant / register_size,
            "dominant_probability": probabilities[dominant],
        },
        abs=1e-14,
    )
    assert case.expect.expected_result_subset == pytest.approx(
        {"phase_probabilities": probabilities}, abs=1e-14
    )


def test_amplitude_estimation_oracle_aggregates_the_written_symmetric_phase_pairs():
    case = _by_family(20260802)["amplitude-estimation"]
    system_qubits = int(
        re.search(r"The (\d+)-qubit state-preparation circuit", case.prompt).group(1)
    )
    rotations = [
        (int(qubit), float(angle))
        for qubit, angle in re.findall(r"q(\d+): RY\(([-0-9.]+)\)", case.prompt)
    ]
    good_states = ast.literal_eval(
        re.search(r"integer indices (\[.*?\]) as good states", case.prompt).group(1)
    )
    evaluation_qubits = int(re.search(r"Use (\d+) evaluation qubits", case.prompt).group(1))
    assert [qubit for qubit, _ in rotations] == list(range(system_qubits))

    good_probability = 0.0
    for basis_index in good_states:
        probability = 1.0
        for qubit, angle in rotations:
            excited = math.sin(angle / 2.0) ** 2
            probability *= excited if (basis_index >> qubit) & 1 else 1.0 - excited
        good_probability += probability

    register_size = 1 << evaluation_qubits
    phase = math.asin(math.sqrt(good_probability)) / math.pi

    def phase_probability(phase_value: float, phase_integer: int) -> float:
        delta = phase_value - phase_integer / register_size
        denominator = math.sin(math.pi * delta)
        if abs(denominator) <= 1e-14:
            return 1.0
        return (math.sin(math.pi * register_size * delta) / (register_size * denominator)) ** 2

    raw = [
        0.5
        * (
            phase_probability(phase, phase_integer)
            + phase_probability((-phase) % 1.0, phase_integer)
        )
        for phase_integer in range(register_size)
    ]
    folded = [0.0] * (register_size // 2 + 1)
    for phase_integer, probability in enumerate(raw):
        folded[min(phase_integer, register_size - phase_integer)] += probability
    dominant = int(np.argmax(folded))

    assert sum(raw) == pytest.approx(1.0, abs=1e-12)
    assert case.expect.expected_values == pytest.approx(
        {
            "amplitude_estimate": math.sin(math.pi * dominant / register_size) ** 2,
            "dominant_pair_probability": folded[dominant],
        },
        abs=1e-14,
    )


def test_analytic_channel_gradient_and_chsh_oracles_match_written_inputs():
    cases = _by_family(20260802)
    damping = cases["amplitude-damping"]
    gamma = float(re.search(r"gamma=([-0-9.]+)", damping.prompt).group(1))
    alpha = float(re.search(r"cos\(([-0-9.]+)\)", damping.prompt).group(1))
    phase = float(re.search(r"exp\(i\*([-0-9.]+)\)", damping.prompt).group(1))
    coherence = (
        math.sqrt(1 - gamma)
        * math.cos(alpha)
        * math.sin(alpha)
        * complex(math.cos(-phase), math.sin(-phase))
    )
    expected = damping.expect.expected_values
    assert expected["excited_population"] == pytest.approx(
        (1 - gamma) * math.sin(alpha) ** 2, abs=1e-15
    )
    assert expected["coherence_0_1_real"] == pytest.approx(coherence.real, abs=1e-15)
    assert expected["coherence_0_1_imag"] == pytest.approx(coherence.imag, abs=1e-15)

    gradient = cases["cirq-gradient"]
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\).*RZ\(([-0-9.]+)\)", gradient.prompt).groups()
    ]
    expected = gradient.expect.expected_values
    assert expected["xx_expectation"] == pytest.approx(math.sin(theta) * math.cos(phi))
    assert expected["theta_gradient"] == pytest.approx(math.cos(theta) * math.cos(phi))
    assert expected["phi_gradient"] == pytest.approx(-math.sin(theta) * math.sin(phi))

    chsh = cases["chsh"]
    alpha = float(re.search(r"cos\(([-0-9.]+)\)", chsh.prompt).group(1))
    concurrence = math.sin(2 * alpha)
    assert chsh.expect.expected_values["chsh_value"] == pytest.approx(
        2 * math.sqrt(1 + concurrence**2), abs=1e-15
    )


def test_mixed_kraus_oracle_matches_independent_channel_and_aer_density_matrix():
    qiskit = pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    from qiskit.quantum_info import Kraus
    from qiskit_aer import AerSimulator

    case = _by_family(20260802)["mixed-kraus-channel"]
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt).groups()
    ]
    gamma = float(re.search(r"gamma=([-0-9.]+)", case.prompt).group(1))
    probability = float(re.search(r"with p=(-?\d+(?:\.\d+)?)", case.prompt).group(1))
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
        np.asarray([[1.0, 0.0], [0.0, math.sqrt(1.0 - gamma)]], dtype=complex),
        np.asarray([[0.0, math.sqrt(gamma)], [0.0, 0.0]], dtype=complex),
    )
    density = sum(operator @ density @ operator.conj().T for operator in amplitude_operators)
    pauli_operators = (
        math.sqrt(1.0 - probability) * identity,
        math.sqrt(probability / 3.0) * pauli_x,
        math.sqrt(probability / 3.0) * pauli_y,
        math.sqrt(probability / 3.0) * pauli_z,
    )
    density = sum(operator @ density @ operator.conj().T for operator in pauli_operators)

    circuit = qiskit.QuantumCircuit(1)
    circuit.ry(theta, 0)
    circuit.rz(phi, 0)
    circuit.append(Kraus(list(amplitude_operators)).to_instruction(), [0])
    circuit.append(Kraus(list(pauli_operators)).to_instruction(), [0])
    executed = circuit.copy()
    executed.save_density_matrix()
    observed = np.asarray(
        AerSimulator(method="density_matrix").run(executed).result().data(0)["density_matrix"]
    )

    assert np.max(np.abs(observed - density)) <= 1e-15
    assert case.expect.expected_values == pytest.approx(
        {
            "excited_population": float(density[1, 1].real),
            "bloch_x": float(np.trace(density @ pauli_x).real),
            "bloch_y": float(np.trace(density @ pauli_y).real),
            "bloch_z": float(np.trace(density @ pauli_z).real),
            "density_trace": float(np.trace(density).real),
            "state_purity": float(np.trace(density @ density).real),
        },
        abs=1e-14,
    )


@pytest.mark.parametrize("seed", [0, 2, 5, 7])
def test_lindblad_oracle_matches_independent_liouvillian_and_stinespring_circuit(seed):
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import DensityMatrix, Statevector, partial_trace, state_fidelity

    case = _by_family(seed)["lindblad-stinespring"]
    initial_label = re.search(r"one-qubit \|([+-]i?)> state", case.prompt).group(1)
    evolution_time = float(re.search(r"solve at t=([-0-9.]+)", case.prompt).group(1))
    angular_frequency, amplitude_rate, dephasing_rate = [
        float(value)
        for value in re.search(
            r"-i\*\[\(([-0-9.]+)/2\)\*Z, rho\] \+ ([-0-9.]+)\*D"
            r"\[sigma_minus\]\(rho\) \+ ([-0-9.]+)\*D\[Z\]",
            case.prompt,
        ).groups()
    ]
    state = {
        "+": np.asarray([1.0, 1.0], dtype=complex),
        "-": np.asarray([1.0, -1.0], dtype=complex),
        "+i": np.asarray([1.0, 1.0j], dtype=complex),
        "-i": np.asarray([1.0, -1.0j], dtype=complex),
    }[initial_label] / math.sqrt(2.0)
    rho0 = np.outer(state, state.conj())
    identity = np.eye(2, dtype=complex)
    pauli_z = np.diag([1.0, -1.0]).astype(complex)
    lowering = np.asarray([[0.0, 1.0], [0.0, 0.0]], dtype=complex)
    hamiltonian = 0.5 * angular_frequency * pauli_z

    def dissipator_superoperator(jump: np.ndarray) -> np.ndarray:
        jump_norm = jump.conj().T @ jump
        return (
            np.kron(jump.conj(), jump)
            - 0.5 * np.kron(identity, jump_norm)
            - 0.5 * np.kron(jump_norm.T, identity)
        )

    liouvillian = (
        -1j * (np.kron(identity, hamiltonian) - np.kron(hamiltonian.T, identity))
        + amplitude_rate * dissipator_superoperator(lowering)
        + dephasing_rate * dissipator_superoperator(pauli_z)
    )
    rho = (expm(evolution_time * liouvillian) @ rho0.reshape(-1, order="F")).reshape(
        (2, 2), order="F"
    )

    circuit = qiskit.QuantumCircuit(3)
    circuit.h(0)
    if initial_label == "-":
        circuit.z(0)
    if initial_label == "+i":
        circuit.s(0)
    elif initial_label == "-i":
        circuit.sdg(0)
    amplitude_probability = 1.0 - math.exp(-amplitude_rate * evolution_time)
    circuit.cry(2.0 * math.asin(math.sqrt(amplitude_probability)), 0, 1)
    circuit.cx(1, 0)
    phase_flip_probability = (1.0 - math.exp(-2.0 * dephasing_rate * evolution_time)) / 2.0
    circuit.ry(2.0 * math.asin(math.sqrt(phase_flip_probability)), 2)
    circuit.cz(2, 0)
    circuit.rz(angular_frequency * evolution_time, 0)
    reduced = partial_trace(Statevector.from_instruction(circuit), [1, 2])
    fidelity = float(state_fidelity(reduced, DensityMatrix(rho)))

    assert case.expect.expected_values == pytest.approx(
        {
            "excited_population": float(rho[1, 1].real),
            "coherence_real": float(rho[0, 1].real),
            "coherence_imag": float(rho[0, 1].imag),
            "purity": float(np.trace(rho @ rho).real),
            "stinespring_density_fidelity": fidelity,
        },
        abs=2e-14,
    )
    assert fidelity == pytest.approx(1.0, abs=2e-14)


def test_quantum_fisher_oracle_matches_qiskit_state_and_explicit_pauli_operator():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import SparsePauliOp, Statevector

    case = _by_family(20260802)["quantum-fisher-information"]
    qubits = int(re.search(r"prepare a (\d+)-qubit pure state", case.prompt).group(1))
    rotations = [
        (int(qubit), float(angle), float(phase))
        for qubit, angle, phase in re.findall(
            r"q(\d+): RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt
        )
    ]
    terms = [
        (label, float(coefficient))
        for coefficient, label in re.findall(r"\(([-0-9.]+)\)\*'([IXYZ]+)'", case.prompt)
    ]
    circuit = qiskit.QuantumCircuit(qubits)
    for qubit, angle, phase in rotations:
        circuit.ry(angle, qubit)
        circuit.rz(phase, qubit)
    for qubit in range(qubits - 1):
        circuit.cx(qubit, qubit + 1)
    state = Statevector.from_instruction(circuit)
    generator = SparsePauliOp.from_list(terms)
    mean = float(state.expectation_value(generator).real)
    square_mean = float(state.expectation_value(generator @ generator).real)

    assert case.expect.expected_values == pytest.approx(
        {
            "generator_mean": mean,
            "quantum_fisher_information": 4.0 * (square_mean - mean**2),
        },
        abs=1e-13,
    )


def test_assignment_oracle_enumerates_the_written_cost_matrix():
    case = _by_family(20260802)["assignment"]
    matrix = ast.literal_eval(
        re.search(r"cost matrix (\[\[.*?\]\])\. Enforce", case.prompt).group(1)
    )
    values = [
        sum(matrix[worker][job] for worker, job in enumerate(permutation))
        for permutation in itertools.permutations(range(len(matrix)))
    ]

    assert values.count(min(values)) == 1
    assert case.expect.expected_values == {
        "sampled_assignment_cost": float(min(values)),
        "exact_assignment_cost": float(min(values)),
    }
    assert "not from the classical baseline" in case.prompt


def test_teleportation_oracle_tracks_the_written_arbitrary_state():
    case = _by_family(20260802)["teleportation"]
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\).*RZ\(([-0-9.]+)\)", case.prompt).groups()
    ]

    assert case.expect.expected_values == pytest.approx(
        {
            "receiver_bloch_x": math.sin(theta) * math.cos(phi),
            "receiver_bloch_y": math.sin(theta) * math.sin(phi),
            "receiver_bloch_z": math.cos(theta),
            "teleportation_fidelity": 1.0,
        },
        abs=1e-15,
    )


def test_repetition_qec_oracle_preserves_the_written_complex_logical_state():
    qiskit = pytest.importorskip("qiskit")
    case = _by_family(20260802)["repetition-qec"]
    code_kind = re.search(r"three-qubit (bit-flip|phase-flip)", case.prompt).group(1)
    theta, phi = [
        float(value)
        for value in re.search(r"RY\(([-0-9.]+)\) then RZ\(([-0-9.]+)\)", case.prompt).groups()
    ]
    error_gate = "x" if code_kind == "bit-flip" else "z"

    def encoded_circuit():
        circuit = qiskit.QuantumCircuit(3)
        circuit.ry(theta, 0)
        circuit.rz(phi, 0)
        circuit.cx(0, 1)
        circuit.cx(0, 2)
        if code_kind == "phase-flip":
            circuit.h([0, 1, 2])
        return circuit

    ideal = qiskit.quantum_info.Statevector.from_instruction(encoded_circuit())
    fidelities = []
    for error_qubit in (None, 0, 1, 2):
        recovery = qiskit.QuantumCircuit(5)
        recovery.compose(encoded_circuit(), qubits=[0, 1, 2], inplace=True)
        if error_qubit is not None:
            getattr(recovery, error_gate)(error_qubit)
        if code_kind == "phase-flip":
            recovery.h([0, 1, 2])
        recovery.cx(0, 3)
        recovery.cx(1, 3)
        recovery.cx(1, 4)
        recovery.cx(2, 4)
        recovery.x(4)
        recovery.ccx(3, 4, 0)
        recovery.x(4)
        recovery.ccx(3, 4, 1)
        recovery.x(3)
        recovery.ccx(3, 4, 2)
        recovery.x(3)
        if code_kind == "phase-flip":
            recovery.h([0, 1, 2])
        state = qiskit.quantum_info.Statevector.from_instruction(recovery)
        data = qiskit.quantum_info.partial_trace(state, [3, 4])
        fidelities.append(float(qiskit.quantum_info.state_fidelity(data, ideal)))

    assert min(fidelities) == pytest.approx(1.0, abs=1e-14)
    assert case.expect.expected_values == {"worst_case_fidelity": 1.0}


@pytest.mark.filterwarnings("ignore::scipy.sparse.SparseEfficiencyWarning")
def test_ordered_trotter_oracle_matches_qiskit_product_formula_and_dense_exponential():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.circuit.library import PauliEvolutionGate
    from qiskit.quantum_info import SparsePauliOp, Statevector

    case = _by_family(20260802)["ordered-trotter"]
    initial_bitstring = re.search(r"\|q2q1q0>=([01]{3})", case.prompt).group(1)
    evolution_time = float(re.search(r"evolution to t=([-0-9.]+)", case.prompt).group(1))
    terms = [
        (label, float(coefficient))
        for coefficient, label in re.findall(r"\(([-0-9.]+)\)\*'([IXYZ]+)'", case.prompt)
    ]
    steps = int(re.search(r"using exactly (\d+) symmetric", case.prompt).group(1))
    observable_qubit = int(re.search(r"expectations of Z on q(\d+)", case.prompt).group(1))
    step_time = evolution_time / steps

    circuit = qiskit.QuantumCircuit(3)
    initial_index = int(initial_bitstring, 2)
    for qubit in range(3):
        if (initial_index >> qubit) & 1:
            circuit.x(qubit)
    for _ in range(steps):
        for label, coefficient in terms[:-1]:
            circuit.append(
                PauliEvolutionGate(
                    SparsePauliOp.from_list([(label, coefficient)]),
                    time=step_time / 2.0,
                ),
                range(3),
            )
        label, coefficient = terms[-1]
        circuit.append(
            PauliEvolutionGate(
                SparsePauliOp.from_list([(label, coefficient)]),
                time=step_time,
            ),
            range(3),
        )
        for label, coefficient in reversed(terms[:-1]):
            circuit.append(
                PauliEvolutionGate(
                    SparsePauliOp.from_list([(label, coefficient)]),
                    time=step_time / 2.0,
                ),
                range(3),
            )

    trotter_state = Statevector.from_instruction(circuit)
    hamiltonian = np.asarray(SparsePauliOp.from_list(terms).to_matrix(sparse=False), dtype=complex)
    initial = np.zeros(8, dtype=complex)
    initial[initial_index] = 1.0
    exact_state = expm(-1j * evolution_time * hamiltonian) @ initial
    observable_label = ["I", "I", "I"]
    observable_label[2 - observable_qubit] = "Z"
    observable = np.asarray(
        SparsePauliOp("".join(observable_label)).to_matrix(sparse=False), dtype=complex
    )
    trotter_value = float(np.vdot(trotter_state.data, observable @ trotter_state.data).real)
    exact_value = float(np.vdot(exact_state, observable @ exact_state).real)
    fidelity = float(abs(np.vdot(exact_state, trotter_state.data)) ** 2)

    assert case.expect.expected_values == pytest.approx(
        {
            f"trotter_z{observable_qubit}": trotter_value,
            f"exact_z{observable_qubit}": exact_value,
            "exact_trotter_fidelity": fidelity,
        },
        abs=1e-12,
    )


def test_exact_dynamics_oracle_matches_independent_matrix_exponential():
    case = _by_family(20260802)["exact-dynamics"]
    time = float(re.search(r"for t=([-0-9.]+)", case.prompt).group(1))
    z0, z1, coupling = [
        float(value)
        for value in re.search(
            r"H=\(([-0-9.]+)\)\*Z_0 \+ \(([-0-9.]+)\)\*Z_1 \+ "
            r"\(([-0-9.]+)\)\*X_0 X_1",
            case.prompt,
        ).groups()
    ]
    identity = np.eye(2, dtype=complex)
    pauli_x = np.array([[0, 1], [1, 0]], dtype=complex)
    pauli_z = np.diag([1, -1]).astype(complex)
    hamiltonian = (
        z0 * np.kron(pauli_z, identity)
        + z1 * np.kron(identity, pauli_z)
        + coupling * np.kron(pauli_x, pauli_x)
    )
    initial = np.array([1, 0, 0, 0], dtype=complex)
    evolved = expm(-1j * time * hamiltonian) @ initial
    expected = case.expect.expected_values

    assert expected["survival_probability"] == pytest.approx(abs(evolved[0]) ** 2, abs=1e-14)
    assert expected["z0_expectation"] == pytest.approx(
        float(np.vdot(evolved, np.kron(pauli_z, identity) @ evolved).real), abs=1e-14
    )


def test_linear_system_oracle_matches_independent_dense_solve_and_dyadic_spectrum():
    case = _by_family(20260802)["linear-system"]
    match = re.search(r"for A=(\[\[.*?\]\]) and b=(\[.*?\]), using", case.prompt)
    matrix = np.asarray(ast.literal_eval(match.group(1)), dtype=float)
    rhs = np.asarray(ast.literal_eval(match.group(2)), dtype=float)
    solution = np.linalg.solve(matrix, rhs)
    solution /= np.linalg.norm(solution)
    magnitudes = np.abs(solution)
    maximum_magnitude = float(np.max(magnitudes))
    pivot = next(
        index
        for index, magnitude in enumerate(magnitudes)
        if maximum_magnitude - float(magnitude) <= 1e-12
    )
    if solution[pivot] < 0:
        solution = -solution
    expected = case.expect.expected_values

    assert np.linalg.eigvalsh(matrix) * 8 == pytest.approx(
        np.round(np.linalg.eigvalsh(matrix) * 8), abs=1e-15
    )
    assert expected["solution_x0"] == pytest.approx(solution[0], abs=1e-15)
    assert expected["solution_x1"] == pytest.approx(solution[1], abs=1e-15)
    assert expected["amplitude_ratio_x1_over_x0"] == pytest.approx(
        solution[1] / solution[0], abs=1e-15
    )
    assert expected["solution_fidelity"] == 1.0
    assert expected["classical_residual"] == 0.0


def test_pennylane_vqe_oracle_matches_independent_complex_eigensolve():
    case = _by_family(20260802)["pennylane-vqe"]
    offset, z0, z1, xx, yy, xy = [
        float(value)
        for value in re.search(
            r"H=\(([-0-9.]+)\)\*I \+ \(([-0-9.]+)\)\*Z\(0\) \+ "
            r"\(([-0-9.]+)\)\*Z\(1\) \+ \(([-0-9.]+)\)\*X\(0\)@X\(1\) \+ "
            r"\(([-0-9.]+)\)\*Y\(0\)@Y\(1\) \+ \(([-0-9.]+)\)\*X\(0\)@Y\(1\)",
            case.prompt,
        ).groups()
    ]
    identity = np.eye(2, dtype=complex)
    pauli_x = np.array([[0, 1], [1, 0]], dtype=complex)
    pauli_y = np.array([[0, -1j], [1j, 0]], dtype=complex)
    pauli_z = np.diag([1, -1]).astype(complex)
    hamiltonian = (
        offset * np.kron(identity, identity)
        + z0 * np.kron(pauli_z, identity)
        + z1 * np.kron(identity, pauli_z)
        + xx * np.kron(pauli_x, pauli_x)
        + yy * np.kron(pauli_y, pauli_y)
        + xy * np.kron(pauli_x, pauli_y)
    )
    ground = float(np.linalg.eigvalsh(hamiltonian)[0])

    assert case.expect.expected_values == pytest.approx(
        {
            "variational_energy": ground,
            "exact_energy": ground,
            "energy_gap": 0.0,
        },
        abs=1e-15,
    )


@pytest.mark.parametrize("seed", [-1, 2**63])
def test_procedural_seed_is_bounded(seed):
    with pytest.raises(ValueError, match="procedural seed"):
        generate_procedural_cases(seed)


@pytest.mark.parametrize("count", [0, 21])
def test_procedural_family_count_is_bounded(count):
    with pytest.raises(ValueError, match="cases_per_family"):
        generate_procedural_cases(1, cases_per_family=count)


@pytest.mark.parametrize("count", [0, 4])
def test_procedural_prompt_variant_count_is_bounded(count):
    with pytest.raises(ValueError, match="prompt_variants_per_case"):
        generate_procedural_cases(1, prompt_variants_per_case=count)


def test_cli_case_loader_merges_static_and_procedural_cases(tmp_path):
    (tmp_path / "static.yaml").write_text(
        """\
id: static-case
category: static
prompt: Prepare a Bell state.
framework: qiskit
"""
    )

    cases = _load_eval_cases(
        str(tmp_path),
        procedural_seed=20260802,
        procedural_cases_per_family=1,
    )

    assert len(cases) == 24
    assert cases[0].id == "static-case"
    assert all(
        case.id.startswith(f"procedural-{PROCEDURAL_GENERATOR_VERSION}-s20260802-")
        for case in cases[1:]
    )

    varied = _load_eval_cases(
        str(tmp_path),
        procedural_seed=20260802,
        procedural_cases_per_family=1,
        procedural_prompt_variants=3,
    )
    assert len(varied) == 70
    assert sum(PROCEDURAL_SURFACE_VERSION in case.id for case in varied) == 46


def test_cli_case_loader_combines_multiple_unseen_seeds(tmp_path):
    (tmp_path / "static.yaml").write_text(
        "id: static-case\ncategory: static\nprompt: Prepare a Bell state.\n"
    )

    cases = _load_eval_cases(
        str(tmp_path),
        procedural_seed=[7319426802, 9182746611],
        procedural_cases_per_family=1,
        procedural_prompt_variants=2,
    )

    assert len(cases) == 1 + 2 * 23 * 2
    assert len({case.id for case in cases}) == len(cases)
    assert sum("-s7319426802-" in case.id for case in cases) == 46
    assert sum("-s9182746611-" in case.id for case in cases) == 46


def test_cli_case_loader_rejects_partial_configuration_and_duplicate_ids(tmp_path):
    with pytest.raises(ValueError, match="procedural_seed is required"):
        _load_eval_cases(str(tmp_path), procedural_seed=None, procedural_cases_per_family=1)
    with pytest.raises(ValueError, match="procedural_cases_per_family is required"):
        _load_eval_cases(str(tmp_path), procedural_seed=1, procedural_cases_per_family=0)
    with pytest.raises(ValueError, match="procedural_prompt_variants requires"):
        _load_eval_cases(
            str(tmp_path),
            procedural_seed=None,
            procedural_cases_per_family=0,
            procedural_prompt_variants=2,
        )
    with pytest.raises(ValueError, match="procedural seeds must be unique"):
        _load_eval_cases(
            str(tmp_path),
            procedural_seed=[1, 1],
            procedural_cases_per_family=1,
        )

    duplicate = generate_procedural_cases(1)[0]
    (tmp_path / "duplicate.yaml").write_text(
        f"id: {duplicate.id}\ncategory: duplicate\nprompt: duplicate\n"
    )
    with pytest.raises(ValueError, match="case IDs must be unique"):
        _load_eval_cases(str(tmp_path), procedural_seed=1, procedural_cases_per_family=1)
