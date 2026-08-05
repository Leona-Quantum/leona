"""The generation prompt promises the sandbox a runtime. Keep the promise true.

Lives in the worker's tests because the worker is what wires the two together: it
owns both the prompt that makes the promise and the sandbox that must honour it.

`majorana_llm.prompts._RUNTIME_LIMITS` tells the model exactly which packages the
sandbox exposes, and the Qiskit reference template imports `qiskit_aer` directly. The
LOCAL sandbox double executes generated code with the worker's own interpreter, so a
package named in that promise but absent from this environment is not a missing
dependency the model can route around — it is a defect no candidate can repair.

Live local run 019f98fe (2026-07-25) proved the cost: `qiskit_aer` was promised, used
by the template, and installed by nothing. Every one of the eight candidate revisions
died in 1.3 s with ModuleNotFoundError, the intent review never ran once, and the run
burned its whole budget without the agent ever seeing a result to reason about.
"""

from __future__ import annotations

import importlib
import re

import numpy as np
import pytest
from majorana_llm.prompts import (
    INTENT_ROUTER_SYSTEM_PROMPT,
    SIMPLE_GENERATION_SYSTEM_PROMPT,
    simple_generation_system_prompt,
)

# Import name per promised distribution, where the two differ.
_PROMISED = {
    "qiskit": "qiskit",
    "qiskit_aer": "qiskit_aer",
    "numpy": "numpy",
    "scipy": "scipy",
    "sympy": "sympy",
    "networkx": "networkx",
    "Cirq": "cirq",
    "PennyLane": "pennylane",
    "the Amazon Braket SDK with its LocalSimulator": "braket",
}


@pytest.mark.parametrize("promised,module", sorted(_PROMISED.items()))
def test_every_package_the_prompt_promises_is_importable(promised: str, module: str) -> None:
    assert promised in SIMPLE_GENERATION_SYSTEM_PROMPT, (
        f"{promised!r} is no longer named in the generation prompt; drop it here too"
    )
    importlib.import_module(module)


def test_the_promise_itself_has_not_grown_unnoticed() -> None:
    """A package added to the prompt but not to this list would go unchecked."""

    sentence = re.search(
        r"The sandbox exposes (.+?) plus side-effect-free",
        SIMPLE_GENERATION_SYSTEM_PROMPT,
        re.S,
    )
    assert sentence is not None, "the runtime promise sentence changed shape"
    named = {
        token.strip(" ,.\n")
        for token in re.split(r",| and ", sentence.group(1))
        if token.strip(" ,.\n")
    }

    assert named == set(_PROMISED), (
        "the prompt's promised runtime and this test's list have drifted apart"
    )


def test_router_distinguishes_local_capacity_from_artifact_authoring() -> None:
    from majorana_sandbox.spec import DEFAULT_MEMORY_MB
    from majorana_worker.runtime_ports import SandboxCandidateExecutor

    assert SandboxCandidateExecutor._statevector_memory_mb(25) < DEFAULT_MEMORY_MB
    assert SandboxCandidateExecutor._statevector_memory_mb(26) >= DEFAULT_MEMORY_MB
    router = " ".join(INTENT_ROUTER_SYSTEM_PROMPT.split())
    assert "25 qubits the local execution maximum" in router
    assert "execution explicitly marked not_run" in router
    assert "artifact-only form" in router


def test_selected_qiskit_rule_matches_current_statevector_storage_api() -> None:
    from qiskit import QuantumCircuit
    from qiskit.exceptions import QiskitError
    from qiskit_aer import AerSimulator

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum simulation",
        algorithm="other",
        problem_summary="return a statevector",
    )
    circuit = QuantumCircuit(1)
    circuit.h(0)
    simulator = AerSimulator(method="statevector")

    with pytest.raises(QiskitError, match="No statevector"):
        simulator.run(circuit).result().get_statevector()

    circuit.save_statevector()
    observed = np.asarray(simulator.run(circuit).result().get_statevector(circuit))
    assert observed == pytest.approx(np.array([1.0, 1.0]) / np.sqrt(2.0), abs=1e-12)
    assert "does not itself store a statevector" in prompt
    assert "Statevector.from_instruction(circuit)" in prompt


def test_selected_coherent_teleportation_reference_preserves_arbitrary_input_states() -> None:
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Pauli, Statevector

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum information",
        algorithm="other",
        problem_summary="coherent quantum teleportation with deferred measurement",
    )
    helper_source = prompt.split("# BEGIN COHERENT_TELEPORTATION_HELPER", 1)[1].split(
        "# END COHERENT_TELEPORTATION_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    preparations = []
    for gates in (
        (),
        (("x", 0.0),),
        (("h", 0.0),),
        (("ry", 0.73), ("rz", -0.41)),
        (("rx", 0.29), ("ry", -1.1), ("rz", 0.84)),
    ):
        preparation = QuantumCircuit(1)
        for name, angle in gates:
            if name in {"x", "h"}:
                getattr(preparation, name)(0)
            else:
                getattr(preparation, name)(angle, 0)
        preparations.append(preparation)

    for preparation in preparations:
        circuit, bloch_x, bloch_y, bloch_z, fidelity = namespace["coherent_teleportation"](
            preparation
        )
        input_state = Statevector.from_instruction(preparation)
        expected_bloch = [
            float(np.real(input_state.expectation_value(Pauli(axis)))) for axis in "XYZ"
        ]

        assert circuit.num_qubits == 3
        assert [bloch_x, bloch_y, bloch_z] == pytest.approx(expected_bloch, abs=1e-12)
        assert fidelity == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize(
    ("num_qubits", "hamiltonian_terms", "basis_state", "time", "observable_terms"),
    [
        (
            5,
            [
                (0.21, {0: "X", 3: "Z"}),
                (-0.17, {1: "Y", 4: "Y"}),
                (0.13, {0: "Z", 2: "Z"}),
                (0.19, {2: "X"}),
                (-0.08, {4: "Z"}),
            ],
            "10110",
            0.63,
            [(0.35, {0: "Z"}), (-0.20, {1: "X"}), (0.15, {3: "Z", 4: "Z"})],
        ),
        (
            4,
            [
                (0.18, {0: "X", 2: "Y"}),
                (-0.16, {1: "Z", 3: "X"}),
                (0.14, {0: "Z", 2: "Z"}),
                (0.09, {1: "X", 2: "X"}),
                (-0.07, {3: "Z"}),
            ],
            "0101",
            0.77,
            [(0.40, {1: "Z"}), (-0.20, {0: "X", 3: "X"}), (0.10, {2: "Y", 3: "Y"})],
        ),
        (
            3,
            [(0.23, {0: "Y"}), (-0.11, {1: "X", 2: "Z"}), (0.17, {0: "Z", 2: "Y"})],
            "110",
            0.42,
            [(0.40, {0: "X", 1: "Y"}), (0.20, {2: "Z"})],
        ),
    ],
)
def test_selected_exact_dynamics_reference_preserves_q0_leftmost_order(
    num_qubits, hamiltonian_terms, basis_state, time, observable_terms
) -> None:
    from qiskit.quantum_info import SparsePauliOp, Statevector
    from scipy.linalg import expm

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum dynamics",
        algorithm="other",
        problem_summary="exact Pauli dynamics with an explicit matrix exponential",
    )
    helper_source = prompt.split("# BEGIN EXACT_PAULI_DYNAMICS_HELPER", 1)[1].split(
        "# END EXACT_PAULI_DYNAMICS_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    def sparse_operator(terms):
        items = []
        for coefficient, factors in terms:
            label = ["I"] * num_qubits
            for qubit, pauli in factors.items():
                label[qubit] = pauli
            items.append(("".join(label), coefficient))
        return SparsePauliOp.from_list(items)

    hamiltonian = np.asarray(sparse_operator(hamiltonian_terms).to_matrix())
    observable = np.asarray(sparse_operator(observable_terms).to_matrix())
    initial = np.zeros(1 << num_qubits, dtype=complex)
    initial[int(basis_state, 2)] = 1.0
    expected_state = expm(-1j * time * hamiltonian) @ initial
    expected_observable = float(np.real(np.vdot(expected_state, observable @ expected_state)))
    expected_survival = float(abs(np.vdot(initial, expected_state)) ** 2)

    circuit, observed_observable, observed_survival = namespace["exact_pauli_dynamics"](
        num_qubits,
        hamiltonian_terms,
        basis_state,
        time,
        observable_terms,
    )
    qiskit_state = np.asarray(Statevector.from_instruction(circuit).data)
    reversal = np.array(
        [int(format(index, f"0{num_qubits}b")[::-1], 2) for index in range(1 << num_qubits)]
    )

    assert qiskit_state[reversal] == pytest.approx(expected_state, abs=1e-12)
    assert observed_observable == pytest.approx(expected_observable, abs=1e-12)
    assert observed_survival == pytest.approx(expected_survival, abs=1e-12)


@pytest.mark.parametrize(
    ("matrix", "rhs", "phase_bits", "phase_scale"),
    [
        ([[0.75, 0.25], [0.25, 0.75]], [1.0, -0.25], 2, 0.5),
        ([[0.5, 0.25], [0.25, 0.5]], [1.0, 0.2], 2, 1.0),
        ([[0.625, 0.125], [0.125, 0.625]], [0.3, 1.0], 3, 1.0),
        ([[0.5, -0.375], [-0.375, 0.5]], [-1.0, 1.0], 3, 1.0),
    ],
)
def test_selected_hhl_reference_code_executes_for_distinct_dyadic_systems(
    matrix, rhs, phase_bits, phase_scale
) -> None:
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum linear systems",
        algorithm="other",
        problem_summary="build an HHL circuit",
    )
    helper_source = prompt.split("# BEGIN EXACT_DYADIC_HHL_HELPER", 1)[1].split(
        "# END EXACT_DYADIC_HHL_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    circuit, observed, success_probability = namespace["exact_dyadic_hhl"](
        np.asarray(matrix, dtype=float),
        np.asarray(rhs, dtype=float),
        phase_bits=phase_bits,
        phase_scale=phase_scale,
    )
    expected = np.linalg.solve(np.asarray(matrix, dtype=float), np.asarray(rhs, dtype=float))
    expected /= np.linalg.norm(expected)
    magnitudes = np.abs(expected)
    pivot = int(
        np.flatnonzero(np.isclose(magnitudes, float(np.max(magnitudes)), rtol=0.0, atol=1e-12))[0]
    )
    if expected[pivot] < 0:
        expected = -expected

    assert circuit.num_qubits == phase_bits + 2
    assert success_probability > 0.0
    assert observed == pytest.approx(expected, abs=1e-10)


@pytest.mark.parametrize(
    ("counting_qubits", "phase_integer", "target_width", "target_basis_index"),
    [
        (3, 5, 1, 1),
        (5, 11, 1, 1),
        (4, 7, 2, 2),
    ],
)
def test_selected_qpe_reference_decodes_distinct_widths_and_target_registers(
    counting_qubits, phase_integer, target_width, target_basis_index
) -> None:
    from qiskit import QuantumCircuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="phase estimation",
        algorithm="QPE",
        problem_summary="estimate an exact dyadic eigenphase",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_QPE_HELPER", 1)[1].split(
        "# END BOUNDED_QPE_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    dimension = 1 << target_width
    unitary = np.eye(dimension, dtype=complex)
    unitary[target_basis_index, target_basis_index] = np.exp(
        2j * np.pi * phase_integer / (1 << counting_qubits)
    )
    preparation = QuantumCircuit(target_width)
    for qubit in range(target_width):
        if (target_basis_index >> qubit) & 1:
            preparation.x(qubit)

    (
        circuit,
        probabilities,
        decoded,
        phase_estimate,
        peak_probability,
        counts,
        sampled_integer,
        sampled_phase_estimate,
        sampled_peak_probability,
    ) = namespace["bounded_phase_estimation"](
        unitary,
        preparation,
        counting_qubits=counting_qubits,
        shots=512,
        simulator_seed=17,
        transpiler_seed=19,
    )

    expected_key = format(phase_integer, f"0{counting_qubits}b")
    assert circuit.num_qubits == counting_qubits + target_width
    assert counts == {expected_key: 512}
    assert decoded == phase_integer
    assert phase_estimate == pytest.approx(phase_integer / (1 << counting_qubits))
    assert peak_probability == 1.0
    assert probabilities[phase_integer] == pytest.approx(1.0, abs=1e-12)
    assert sampled_integer == phase_integer
    assert sampled_phase_estimate == pytest.approx(phase_estimate)
    assert sampled_peak_probability == 1.0


@pytest.mark.parametrize(
    ("counting_qubits", "eigenphase", "target_width"),
    [(5, 0.217, 1), (6, 0.3817, 2), (4, 0.913, 3)],
)
def test_selected_qpe_reference_matches_nondyadic_finite_register_distribution(
    counting_qubits, eigenphase, target_width
) -> None:
    from qiskit import QuantumCircuit, qasm3
    from qiskit.quantum_info import Operator, Statevector

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="phase estimation",
        algorithm="QPE",
        problem_summary="exact statevector probabilities for a non-dyadic eigenphase",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_QPE_HELPER", 1)[1].split(
        "# END BOUNDED_QPE_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    preparation = QuantumCircuit(target_width)
    for qubit in range(target_width):
        preparation.ry(0.31 + 0.17 * qubit, qubit)
        preparation.rz(-0.22 + 0.13 * qubit, qubit)
    for qubit in range(target_width - 1):
        preparation.cx(qubit, qubit + 1)
    eigenvectors = np.asarray(Operator(preparation).data, dtype=complex)
    dimension = 1 << target_width
    phases = np.linspace(0.07, 0.83, dimension)
    phases[0] = eigenphase
    unitary = eigenvectors @ np.diag(np.exp(2j * np.pi * phases)) @ eigenvectors.conj().T

    (
        circuit,
        probabilities,
        dominant_integer,
        finite_phase_estimate,
        dominant_probability,
        counts,
        sampled_integer,
        sampled_phase_estimate,
        sampled_peak_probability,
    ) = namespace["bounded_phase_estimation"](
        unitary,
        preparation,
        counting_qubits=counting_qubits,
        shots=None,
    )

    register_size = 1 << counting_qubits

    def phase_probability(phase_integer: int) -> float:
        delta = eigenphase - phase_integer / register_size
        denominator = float(np.sin(np.pi * delta))
        if abs(denominator) <= 1e-14:
            return 1.0
        numerator = float(np.sin(np.pi * register_size * delta))
        return (numerator / (register_size * denominator)) ** 2

    expected = np.asarray(
        [phase_probability(phase_integer) for phase_integer in range(register_size)]
    )
    expected_integer = int(np.argmax(expected))
    artifact_state = np.asarray(Statevector.from_instruction(circuit).data)
    artifact_probabilities = np.zeros(register_size, dtype=float)
    for basis_index, probability in enumerate(np.abs(artifact_state) ** 2):
        artifact_probabilities[basis_index & (register_size - 1)] += float(probability)

    assert circuit.num_qubits == counting_qubits + target_width
    assert circuit.num_clbits == 0
    assert probabilities == pytest.approx(expected, abs=1e-11)
    assert artifact_probabilities == pytest.approx(expected, abs=1e-11)
    assert qasm3.dumps(circuit).startswith("OPENQASM 3")
    assert dominant_integer == expected_integer
    assert finite_phase_estimate == pytest.approx(expected_integer / register_size)
    assert dominant_probability == pytest.approx(expected[expected_integer], abs=1e-11)
    assert counts is None
    assert sampled_integer is None
    assert sampled_phase_estimate is None
    assert sampled_peak_probability is None


@pytest.mark.parametrize(
    (
        "system_qubits",
        "evaluation_qubits",
        "state_angle",
        "objective_qubit",
        "expected_folded_integer",
        "expected_pair_probability",
    ),
    [
        (1, 4, 0.37, 0, 2, 0.9579953673807876),
        (1, 3, np.pi / 8.0, 0, 1, 1.0),
        (2, 5, 5.0 * np.pi / 32.0, 0, 5, 1.0),
        (3, 5, 7.0 * np.pi / 32.0, 2, 7, 1.0),
    ],
)
def test_selected_amplitude_estimation_reference_folds_distinct_phase_pairs(
    system_qubits,
    evaluation_qubits,
    state_angle,
    objective_qubit,
    expected_folded_integer,
    expected_pair_probability,
) -> None:
    from qiskit import QuantumCircuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="amplitude estimation",
        algorithm="other",
        problem_summary="standard QAE with a computational-basis good predicate",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1)[1].split(
        "# END BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    preparation = QuantumCircuit(system_qubits)
    preparation.ry(2.0 * state_angle, objective_qubit)
    for spectator in range(system_qubits):
        if spectator != objective_qubit:
            preparation.h(spectator)
            preparation.cz(objective_qubit, spectator)
    good_states = [
        basis_index
        for basis_index in range(1 << system_qubits)
        if (basis_index >> objective_qubit) & 1
    ]

    circuit, distribution, raw, folded, estimate, pair_probability = namespace[
        "bounded_amplitude_estimation"
    ](
        preparation,
        good_states,
        evaluation_qubits=evaluation_qubits,
    )

    register_size = 1 << evaluation_qubits
    expected_estimate = np.sin(np.pi * expected_folded_integer / register_size) ** 2
    assert circuit.num_qubits == evaluation_qubits + system_qubits
    assert not circuit.parameters
    assert raw in {expected_folded_integer, (-expected_folded_integer) % register_size}
    assert folded == expected_folded_integer
    assert estimate == pytest.approx(expected_estimate, abs=1e-12)
    assert pair_probability == pytest.approx(expected_pair_probability, abs=1e-12)
    assert sum(distribution.values()) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("amplitude", [0.18, 0.84])
def test_selected_amplitude_estimation_reference_selects_the_dominant_folded_pair(
    amplitude,
) -> None:
    from qiskit import QuantumCircuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="amplitude estimation",
        algorithm="AmplitudeEstimation",
        problem_summary="decode the dominant symmetric phase pair",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1)[1].split(
        "# END BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    preparation = QuantumCircuit(1)
    preparation.ry(2.0 * np.arcsin(np.sqrt(amplitude)), 0)
    _, distribution, raw, folded, estimate, pair_probability = namespace[
        "bounded_amplitude_estimation"
    ](
        preparation,
        [1],
        evaluation_qubits=2,
    )

    register_size = 4
    phase = float(np.arcsin(np.sqrt(amplitude)) / np.pi)

    def phase_probability(phase_value: float, phase_integer: int) -> float:
        delta = phase_value - phase_integer / register_size
        denominator = float(np.sin(np.pi * delta))
        if abs(denominator) <= 1e-14:
            return 1.0
        numerator = float(np.sin(np.pi * register_size * delta))
        return (numerator / (register_size * denominator)) ** 2

    expected_raw = np.asarray(
        [
            0.5
            * (
                phase_probability(phase, phase_integer)
                + phase_probability((-phase) % 1.0, phase_integer)
            )
            for phase_integer in range(register_size)
        ]
    )
    expected_folded = np.asarray(
        [expected_raw[0], expected_raw[1] + expected_raw[3], expected_raw[2]]
    )
    expected_integer = int(np.argmax(expected_folded))
    naive_raw_integer = int(np.argmax(expected_raw))

    actual_raw = np.zeros(register_size, dtype=float)
    for key, probability in distribution.items():
        actual_raw[int(key, 2)] = probability
    assert actual_raw == pytest.approx(expected_raw, abs=1e-12)
    assert min(naive_raw_integer, register_size - naive_raw_integer) != expected_integer
    assert folded == expected_integer == 1
    assert raw in {1, 3}
    assert estimate == pytest.approx(0.5, abs=1e-12)
    assert pair_probability == pytest.approx(expected_folded[expected_integer], abs=1e-12)


@pytest.mark.parametrize(
    ("good_states", "expected_fold", "expected_amplitude"),
    [([], 0, 0.0), ([0, 1, 2, 3], 8, 1.0)],
)
def test_selected_amplitude_estimation_reference_handles_zero_and_one(
    good_states, expected_fold, expected_amplitude
) -> None:
    from qiskit import QuantumCircuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="amplitude estimation",
        algorithm="other",
        problem_summary="boundary amplitude",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1)[1].split(
        "# END BOUNDED_AMPLITUDE_ESTIMATION_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)
    preparation = QuantumCircuit(2)
    preparation.h([0, 1])

    _, _, _, folded, estimate, pair_probability = namespace["bounded_amplitude_estimation"](
        preparation,
        good_states,
        evaluation_qubits=4,
    )

    assert folded == expected_fold
    assert estimate == pytest.approx(expected_amplitude, abs=1e-12)
    assert pair_probability == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize(
    ("terms", "seed"),
    [
        (
            [
                ("IIII", 0.12),
                ("ZIII", -0.31),
                ("IZII", 0.27),
                ("IIZI", -0.22),
                ("IIIZ", 0.19),
                ("XXII", 0.14),
                ("YYII", -0.10),
                ("IXXI", 0.13),
                ("IYYI", -0.09),
                ("IIXX", 0.11),
                ("IIYY", -0.08),
                ("XIZX", 0.07),
            ],
            7300,
        ),
        (
            [
                ("III", 0.10),
                ("ZII", -0.30),
                ("IZI", 0.20),
                ("IIZ", -0.15),
                ("YII", 0.12),
                ("IYI", -0.09),
                ("IIY", 0.07),
                ("XXI", 0.18),
                ("IXX", -0.13),
                ("ZIZ", 0.10),
            ],
            7301,
        ),
    ],
)
def test_selected_vqe_reference_optimizes_distinct_real_and_complex_hamiltonians(
    terms, seed
) -> None:
    from qiskit.quantum_info import SparsePauliOp, Statevector

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="variational algorithms",
        algorithm="VQE",
        problem_summary="explicit statevector Hamiltonian",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_STATEVECTOR_VQE_HELPER", 1)[1].split(
        "# END BOUNDED_STATEVECTOR_VQE_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)
    hamiltonian = SparsePauliOp.from_list(terms)

    circuit, variational, exact, gap, curve, parameters = namespace["bounded_statevector_vqe"](
        hamiltonian,
        seed=seed,
        starts=2,
    )
    circuit_energy = float(
        np.real(Statevector.from_instruction(circuit).expectation_value(hamiltonian))
    )

    assert not circuit.parameters
    assert variational == pytest.approx(circuit_energy, abs=1e-12)
    assert gap == pytest.approx(max(0.0, variational - exact), abs=1e-15)
    assert gap <= 1e-7
    assert curve[-1] == pytest.approx(variational, abs=1e-12)
    assert len(parameters) >= hamiltonian.num_qubits * (hamiltonian.num_qubits + 1)


@pytest.mark.parametrize(
    ("terms", "seed", "starts", "maximum_gap"),
    [
        (
            [("II", -0.15), ("ZI", -0.73), ("IZ", 0.28), ("XX", 0.34)],
            1900,
            2,
            1e-8,
        ),
        (
            [("ZI", -0.52), ("IZ", 0.31), ("XX", -0.27), ("YI", 0.22)],
            1901,
            2,
            1e-8,
        ),
        (
            [("ZII", -1.1), ("IZI", -0.7), ("IIZ", -0.3), ("XXI", 0.4), ("IXX", 0.25)],
            731,
            2,
            1e-7,
        ),
    ],
)
def test_selected_pennylane_vqe_reference_executes_real_and_complex_families(
    terms, seed, starts, maximum_gap
) -> None:
    import pennylane as qml

    prompt = simple_generation_system_prompt(
        framework="pennylane",
        domain="variational algorithms",
        algorithm="VQE",
        problem_summary="explicit statevector Hamiltonian",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_PENNYLANE_VQE_HELPER", 1)[1].split(
        "# END BOUNDED_PENNYLANE_VQE_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    paulis = {
        "I": qml.Identity,
        "X": qml.PauliX,
        "Y": qml.PauliY,
        "Z": qml.PauliZ,
    }
    operators = []
    coefficients = []
    for label, coefficient in terms:
        factors = [paulis[pauli](wire) for wire, pauli in enumerate(label) if pauli != "I"]
        operator = factors[0] if factors else qml.Identity(0)
        for factor in factors[1:]:
            operator = operator @ factor
        operators.append(operator)
        coefficients.append(coefficient)
    hamiltonian = qml.Hamiltonian(coefficients, operators)

    tape, variational, exact, gap, curve, parameters = namespace["bounded_pennylane_vqe"](
        hamiltonian,
        range(len(terms[0][0])),
        seed=seed,
        starts=starts,
    )
    device = qml.device("default.qubit", wires=range(len(terms[0][0])))
    tape_energy = float(getattr(qml, "execute")([tape], device)[0])

    assert isinstance(tape, qml.tape.QuantumScript)
    assert variational == pytest.approx(tape_energy, abs=1e-12)
    assert gap == pytest.approx(max(0.0, variational - exact), abs=1e-15)
    assert gap <= maximum_gap
    assert curve[-1] == pytest.approx(variational, abs=1e-12)
    assert len(parameters) >= len(terms[0][0]) * (len(terms[0][0]) + 1)


def test_pennylane_vqe_reference_crosses_the_real_sandbox_observer_boundary() -> None:
    import json
    import tempfile
    from pathlib import Path

    from majorana_contracts.enums import Framework
    from majorana_frameworks import FrameworkProgram
    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    prompt = simple_generation_system_prompt(
        framework="pennylane",
        domain="variational algorithms",
        algorithm="VQE",
        problem_summary="explicit diagonal two-qubit Hamiltonian",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_PENNYLANE_VQE_HELPER", 1)[1].split(
        "# END BOUNDED_PENNYLANE_VQE_HELPER", 1
    )[0]
    source = (
        helper_source
        + """
hamiltonian = qml.Hamiltonian(
    [-0.15, -0.73, -0.28],
    [qml.Identity(0), qml.PauliZ(0), qml.PauliZ(1)],
)
FINAL_CIRCUIT, variational, exact, gap, _, _ = bounded_pennylane_vqe(
    hamiltonian, [0, 1], seed=1900, starts=1
)
RESULT = {
    "variational_energy": float(variational),
    "exact_energy": float(exact),
    "variational_gap": float(gap),
}
"""
    )
    program = FrameworkProgram(Framework.PENNYLANE, source)
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - execute the real sandbox composition and trusted observer
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(result_path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        observation = json.loads(result_path.read_text())

    assert observation["result"]["variational_gap"] <= 1e-12
    assert observation["resource_metrics"]["qubits"] == 2
    assert observation["resource_metrics"]["measurement_count"] == 0
    assert observation["native_statevector"]["qubits"] == 2
    assert observation["native_sampled"]["shots"] == 2048
    assert "interchange_error" not in observation


@pytest.mark.parametrize(
    ("marked", "expected_iterations"),
    [
        (["10"], 1),
        (["001", "110"], 1),
        (["00011", "10110"], 3),
        (["000101", "101011", "111000"], 3),
        (["00000101", "01011010", "11110000"], 7),
    ],
)
def test_selected_grover_reference_matches_closed_form_for_unseen_marked_sets(
    marked, expected_iterations
) -> None:
    import math

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="unstructured search",
        algorithm="Grover",
        problem_summary="find one of multiple marked basis states",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_GROVER_HELPER", 1)[1].split(
        "# END BOUNDED_GROVER_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    circuit, counts, exact, sampled, spread, iterations = namespace["bounded_grover"](marked)
    search_size = 1 << len(marked[0])
    theta = math.asin(math.sqrt(len(marked) / search_size))
    theory = math.sin((2 * iterations + 1) * theta) ** 2

    assert iterations == expected_iterations
    assert exact == pytest.approx(theory, abs=5e-11)
    assert spread <= 5e-11
    assert counts is None
    assert sampled is None
    assert circuit.num_clbits == 0


def test_selected_grover_reference_samples_marked_states_and_exports_qasm3() -> None:
    from qiskit import qasm3

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="unstructured search",
        algorithm="Grover",
        problem_summary="sample either of two marked basis states",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_GROVER_HELPER", 1)[1].split(
        "# END BOUNDED_GROVER_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    marked = {"00101", "11100"}
    circuit, counts, exact, sampled, spread, iterations = namespace["bounded_grover"](
        sorted(marked),
        shots=4096,
        simulator_seed=812,
        transpiler_seed=913,
    )

    assert iterations == 3
    assert exact == pytest.approx(0.9613189697265625, abs=5e-11)
    assert sampled == pytest.approx(exact, abs=0.04)
    assert spread <= 5e-11
    assert counts is not None
    assert max(counts, key=counts.get) in marked
    assert qasm3.dumps(circuit).startswith("OPENQASM 3")


def test_grover_reference_crosses_the_real_sandbox_observer_boundary() -> None:
    import json
    import tempfile
    from pathlib import Path

    from majorana_contracts.enums import Framework
    from majorana_frameworks import FrameworkProgram
    from majorana_sandbox.spec import ExecutionSpec, compose_execution

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="unstructured search",
        algorithm="Grover",
        problem_summary="sample multiple marked basis states",
    )
    helper_source = prompt.split("# BEGIN BOUNDED_GROVER_HELPER", 1)[1].split(
        "# END BOUNDED_GROVER_HELPER", 1
    )[0]
    source = (
        helper_source
        + """
marked = {"00101", "11100"}
(
    FINAL_CIRCUIT,
    counts,
    exact_marked_probability,
    sampled_marked_probability,
    spread,
    iterations,
) = bounded_grover(
    sorted(marked),
    shots=4096,
    simulator_seed=812,
    transpiler_seed=913,
)
RESULT = {
    "counts": counts,
    "exact_marked_probability": exact_marked_probability,
    "sampled_marked_probability": sampled_marked_probability,
    "spread": spread,
    "iterations": iterations,
}
"""
    )
    program = FrameworkProgram(Framework.QISKIT, source)
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "observation.json"
        exec(  # noqa: S102 - execute the real sandbox composition and trusted observer
            compose_execution(
                ExecutionSpec(
                    code=program.normalized_source,
                    trusted_setup=program.trusted_setup(circuit_expected=True),
                    trusted_observer=program.trusted_observer(circuit_expected=True),
                    protected_result_path=str(result_path),
                    source_fingerprint=program.fingerprint,
                )
            ),
            {},
        )
        observation = json.loads(result_path.read_text())

    result = observation["result"]
    native_counts = observation["native_sampled"]["counts"]
    assert result["exact_marked_probability"] == pytest.approx(0.9613189697265625, abs=5e-11)
    assert result["sampled_marked_probability"] == pytest.approx(
        result["exact_marked_probability"], abs=0.04
    )
    assert max(native_counts, key=native_counts.get) in {"00101", "11100"}
    assert observation["resource_metrics"]["qubits"] == 5
    assert observation["resource_metrics"]["measurement_count"] == 5
    assert observation["native_sampled"]["shots"] == 2048
    assert observation["interchange_qasm"].startswith("OPENQASM 3")
    assert "interchange_error" not in observation


def test_selected_qaoa_qubo_layer_matches_every_binary_cost_up_to_global_phase() -> None:
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Operator

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="combinatorial optimization",
        algorithm="QAOA",
        problem_summary="optimize an explicit quadratic binary cost",
    )
    helper_source = prompt.split("# BEGIN QUBO_COST_LAYER_HELPER", 1)[1].split(
        "# END QUBO_COST_LAYER_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    linear = np.array([1.2, -0.7, 0.4], dtype=float)
    quadratic = [(0, 1, 0.9), (1, 2, -1.1), (2, 2, 0.3)]
    gamma = 0.37
    circuit = QuantumCircuit(3)
    namespace["append_qubo_cost_layer"](circuit, gamma, linear, quadratic)
    unitary = np.asarray(Operator(circuit).data)

    expected = []
    for basis_index in range(8):
        bits = np.array([(basis_index >> qubit) & 1 for qubit in range(3)], dtype=float)
        cost = float(linear @ bits)
        cost += sum(weight * bits[left] * bits[right] for left, right, weight in quadratic)
        expected.append(np.exp(-1j * gamma * cost))
    observed = np.diag(unitary)
    global_phase = observed[0] / expected[0]

    assert np.count_nonzero(unitary - np.diag(observed)) == 0
    assert observed == pytest.approx(global_phase * np.asarray(expected), abs=1e-12)


def test_qaoa_business_selection_is_shared_by_assignment_knapsack_and_maxcut() -> None:
    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="combinatorial optimization",
        algorithm="QAOA",
        problem_summary="sample a constrained business solution",
    )
    helper_source = prompt.split("# BEGIN OBSERVED_BUSINESS_SELECTION_HELPER", 1)[1].split(
        "# END OBSERVED_BUSINESS_SELECTION_HELPER", 1
    )[0]
    namespace: dict[str, object] = {"np": np}
    exec(helper_source, namespace)
    select = namespace["select_observed_business_solution"]

    def count_key(bits):
        return "".join(str(int(bit)) for bit in bits[::-1])

    assignment_costs = np.array([[9.0, 2.0], [3.0, 8.0]])
    assignment_samples = [
        np.array([1, 0, 0, 1]),
        np.array([0, 1, 1, 0]),
        np.array([1, 1, 0, 0]),  # infeasible but observed most often
    ]
    assignment_counts = {
        count_key(bits): count for bits, count in zip(assignment_samples, [5, 7, 900], strict=True)
    }

    def assignment_feasible(bits):
        matrix = bits.reshape(2, 2)
        return bool(np.all(matrix.sum(axis=0) == 1) and np.all(matrix.sum(axis=1) == 1))

    def assignment_value(bits):
        return float(np.sum(assignment_costs * bits.reshape(2, 2)))

    _, assignment_bits, assignment_value_observed = select(
        assignment_counts,
        4,
        assignment_value,
        assignment_feasible,
        direction="minimize",
    )
    assert assignment_bits.tolist() == [0, 1, 1, 0]
    assert assignment_value_observed == 5.0

    weights = np.array([2, 3, 4, 5])
    values = np.array([3, 4, 5, 8])
    knapsack_samples = [
        np.array([1, 1, 0, 0]),
        np.array([0, 0, 0, 1]),
        np.array([1, 0, 0, 1]),  # infeasible and has the largest raw value
    ]
    knapsack_counts = {count_key(bits): 1 for bits in knapsack_samples}
    _, knapsack_bits, knapsack_value = select(
        knapsack_counts,
        4,
        lambda bits: values @ bits,
        lambda bits: weights @ bits <= 5,
        direction="maximize",
    )
    assert knapsack_bits.tolist() == [0, 0, 0, 1]
    assert knapsack_value == 8.0

    edges = [(0, 1, 3.0), (1, 2, 1.5), (0, 2, 2.0)]
    maxcut_samples = [
        np.array([0, 0, 0]),
        np.array([0, 1, 0]),
        np.array([1, 0, 0]),
    ]
    maxcut_counts = {count_key(bits): 1 for bits in maxcut_samples}

    def cut_value(bits):
        return sum(weight for left, right, weight in edges if bits[left] != bits[right])

    selected_key, maxcut_bits, maxcut_value = select(
        maxcut_counts,
        3,
        cut_value,
        lambda _bits: True,
        direction="maximize",
    )
    assert selected_key in maxcut_counts
    assert maxcut_bits.tolist() == [1, 0, 0]
    assert maxcut_value == 5.0


def test_qubo_layer_keeps_four_by_four_assignment_gate_count_polynomial() -> None:
    from qiskit import QuantumCircuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="assignment optimization",
        algorithm="QAOA",
        problem_summary="four by four assignment",
    )
    helper_source = prompt.split("# BEGIN QUBO_COST_LAYER_HELPER", 1)[1].split(
        "# END QUBO_COST_LAYER_HELPER", 1
    )[0]
    namespace: dict[str, object] = {}
    exec(helper_source, namespace)

    costs = np.array([[9, 2, 7, 8], [6, 4, 3, 7], [5, 8, 1, 8], [7, 6, 9, 4]])
    penalty = 20.0
    linear = costs.astype(float).reshape(-1)
    quadratic = []
    groups = [[4 * row + column for column in range(4)] for row in range(4)]
    groups += [[4 * row + column for row in range(4)] for column in range(4)]
    for group in groups:
        linear[group] -= penalty
        for left_offset in range(4):
            for right_offset in range(left_offset + 1, 4):
                quadratic.append((group[left_offset], group[right_offset], 2.0 * penalty))

    circuit = QuantumCircuit(16)
    namespace["append_qubo_cost_layer"](circuit, 0.23, linear, quadratic)

    assert circuit.count_ops() == {"rzz": 48, "rz": 16}
    assert len(circuit.data) == 64


def test_phase_flip_basis_rule_recovers_every_single_data_qubit_z_error() -> None:
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector, partial_trace, state_fidelity

    def encoded() -> QuantumCircuit:
        circuit = QuantumCircuit(3)
        circuit.ry(0.68, 0)
        circuit.rz(-0.37, 0)
        circuit.cx(0, 1)
        circuit.cx(0, 2)
        circuit.h([0, 1, 2])
        return circuit

    def recovered(error_qubit: int) -> QuantumCircuit:
        circuit = QuantumCircuit(5)
        circuit.compose(encoded(), qubits=[0, 1, 2], inplace=True)
        circuit.z(error_qubit)
        circuit.h([0, 1, 2])
        circuit.cx(0, 3)
        circuit.cx(1, 3)
        circuit.cx(1, 4)
        circuit.cx(2, 4)
        circuit.x(4)
        circuit.ccx(3, 4, 0)
        circuit.x(4)
        circuit.ccx(3, 4, 1)
        circuit.x(3)
        circuit.ccx(3, 4, 2)
        circuit.x(3)
        circuit.h([0, 1, 2])
        return circuit

    prompt = simple_generation_system_prompt(
        framework="qiskit",
        domain="quantum error correction",
        algorithm="other",
        problem_summary="coherent phase-flip repetition code",
    )
    ideal = Statevector.from_instruction(encoded())
    fidelities = []
    for error_qubit in range(3):
        state = Statevector.from_instruction(recovered(error_qubit))
        fidelities.append(float(state_fidelity(partial_trace(state, [3, 4]), ideal)))

    assert "apply CNOT q0->q1" in prompt
    assert "q0->q2 FIRST" in prompt
    assert fidelities == pytest.approx([1.0, 1.0, 1.0], abs=1e-12)
