"""QAOA MaxCut: split the nodes of a small graph into two groups so that as
many edges as possible run between the groups, using the Quantum Approximate
Optimization Algorithm on an ideal simulator.

Runs in the Qapp sandbox, which injects QAPP_INPUTS and reads RESULT.
"""

import math

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
from scipy.optimize import minimize

GRAPHS = {
    "triangle": (3, [(0, 1), (1, 2), (0, 2)]),
    "square": (4, [(0, 1), (1, 2), (2, 3), (0, 3)]),
    "square_with_diagonal": (4, [(0, 1), (1, 2), (2, 3), (0, 3), (0, 2)]),
    "complete_4": (4, [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]),
    "pentagon": (5, [(0, 1), (1, 2), (2, 3), (3, 4), (0, 4)]),
    "bowtie": (5, [(0, 1), (1, 2), (0, 2), (2, 3), (3, 4), (2, 4)]),
    "hexagon": (6, [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (0, 5)]),
    "prism": (6, [(0, 1), (1, 2), (0, 2), (3, 4), (4, 5), (3, 5), (0, 3), (1, 4), (2, 5)]),
}

graph = QAPP_INPUTS.get("graph", "square")
layers = QAPP_INPUTS.get("layers", 1)
optimize = QAPP_INPUTS.get("optimize", True)
gamma = QAPP_INPUTS.get("gamma", 0.8)
beta = QAPP_INPUTS.get("beta", 0.4)
if graph not in GRAPHS:
    raise ValueError("graph must be one of " + ", ".join(GRAPHS))
if not isinstance(layers, int) or isinstance(layers, bool) or not 1 <= layers <= 3:
    raise ValueError("layers must be 1, 2 or 3")
if not isinstance(optimize, bool):
    raise ValueError("optimize must be true or false")
# The same rounded bounds the input form declares, so its largest values are accepted.
for name, value, top in (("gamma", gamma, 3.1416), ("beta", beta, 1.5708)):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= top:
        raise ValueError(f"{name} must be between 0 and {top}")

nodes, edges = GRAPHS[graph]
if nodes > QAPP_MAX_QUBITS:
    raise ValueError(f"this graph needs {nodes} qubits")


def cut_size(index):
    """Edges cut by the assignment whose node i is bit i of `index`."""
    return sum(((index >> u) & 1) != ((index >> v) & 1) for u, v in edges)


cuts = np.array([cut_size(index) for index in range(2**nodes)])
max_cut = int(cuts.max())


def qaoa_state(gammas, betas):
    circuit = QuantumCircuit(nodes)
    circuit.h(range(nodes))
    for g, b in zip(gammas, betas):
        # exp(-i g C) with C = sum over edges of (1 - Z_u Z_v) / 2, up to a global
        # phase, is one RZZ(-g) per edge; the mixer exp(-i b sum X) is RX(2b).
        for u, v in edges:
            circuit.rzz(-g, u, v)
        circuit.rx(2 * b, range(nodes))
    return Statevector.from_instruction(circuit)


def fast_probabilities(gammas, betas):
    """The same state as `qaoa_state`, simulated directly with NumPy for the
    parameter search: the cost layer is diagonal (a phase of -g times the cut
    size on each basis state) and the mixer is one RX(2b) on every qubit."""
    psi = np.full(2**nodes, 2 ** (-nodes / 2), dtype=complex)
    for g, b in zip(gammas, betas):
        psi = psi * np.exp(-1j * g * cuts)
        rx = np.array([[math.cos(b), -1j * math.sin(b)], [-1j * math.sin(b), math.cos(b)]])
        tensor = psi.reshape([2] * nodes)
        for axis in range(nodes):
            tensor = np.moveaxis(np.tensordot(rx, tensor, axes=([1], [axis])), 0, axis)
        psi = tensor.reshape(-1)
    return np.abs(psi) ** 2


def negative_expected_cut(params):
    return -float(fast_probabilities(params[:layers], params[layers:]) @ cuts)


if optimize:
    best = None
    # Ramp-shaped starting schedules (gamma rising, beta falling, as in a slow
    # anneal) at a few scales; the optimizer is local, so more than one start
    # guards against settling in a poor valley.
    ramp = (np.arange(layers) + 1) / layers
    for g0, b0 in ((0.4, 0.6), (0.8, 0.4), (1.2, 0.3), (2.0, 1.0)):
        start = np.concatenate([g0 * ramp, b0 * (1 - ramp + 1 / layers)])
        found = minimize(negative_expected_cut, start, method="L-BFGS-B")
        if best is None or found.fun < best.fun:
            best = found
    params = best.x
else:
    params = np.concatenate([np.full(layers, float(gamma)), np.full(layers, float(beta))])

# The reported numbers come from the Qiskit circuit itself. The NumPy search
# above must describe the same state, and if it ever does not, say so rather
# than report angles that were tuned on a different model.
probabilities = qaoa_state(params[:layers], params[layers:]).probabilities()
if not np.allclose(probabilities, fast_probabilities(params[:layers], params[layers:]), atol=1e-9):
    raise RuntimeError("the circuit and the search simulator disagree")
expected = float(probabilities @ cuts)


def assignment(index):
    """Node 0 first: character i is the group (0 or 1) of node i."""
    return "".join(str((index >> i) & 1) for i in range(nodes))


order = sorted(range(2**nodes), key=lambda index: (-probabilities[index], index))
most_likely = order[0]

RESULT = {
    "graph": graph,
    "nodes": nodes,
    "edges": [{"u": u, "v": v} for u, v in edges],
    "layers": layers,
    "optimized": optimize,
    "gammas": [round(float(value), 6) for value in params[:layers]],
    "betas": [round(float(value), 6) for value in params[layers:]],
    "max_cut": max_cut,
    "expected_cut": round(expected, 6),
    "approximation_ratio": round(expected / max_cut, 6),
    "probability_optimal": round(float(probabilities[cuts == max_cut].sum()), 6),
    "best_assignment": assignment(most_likely),
    "best_assignment_cut": int(cuts[most_likely]),
    "top_outcomes": [
        {
            "assignment": assignment(index),
            "probability": round(float(probabilities[index]), 6),
            "cut": int(cuts[index]),
        }
        for index in order[:8]
    ],
}
