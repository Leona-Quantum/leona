"""Seeded AUTO-routing holdouts that do not expose one fixed wording."""

from __future__ import annotations

import hashlib
import random
from collections.abc import Callable

from majorana_evals.schema import IntentCase

INTENT_PROCEDURAL_VERSION = "v1"
_FAMILIES = (
    "canonical-execute",
    "explicit-qubo-execute",
    "explicit-dynamics-execute",
    "bounded-assignment-execute",
    "underspecified-chat",
    "resource-chat",
    "capability-chat",
    "oversized-assignment-chat",
)


def _family_rng(seed: int, family: str, index: int) -> random.Random:
    payload = f"{INTENT_PROCEDURAL_VERSION}:{seed}:{family}:{index}".encode()
    derived = int.from_bytes(hashlib.sha256(payload).digest()[:16], "big")
    return random.Random(derived)


def _case_id(seed: int, family: str, index: int) -> str:
    return f"intent-procedural-{INTENT_PROCEDURAL_VERSION}-s{seed}-{family}-{index + 1:02d}"


def _canonical_execute(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "canonical-execute", index)
    qubits = rng.randint(3, 10)
    shots = rng.choice((512, 1024, 2048, 4096))
    framework = rng.choice(("Qiskit", "Cirq"))
    construction = rng.choice(("GHZ", "W"))
    return IntentCase(
        id=_case_id(seed, "canonical-execute", index),
        split="holdout",
        cohort="procedural-canonical",
        prompt=(
            f"Build and measure a {qubits}-qubit {construction} state in {framework} "
            f"using {shots} shots, and return the counts."
        ),
        expected_mode="execute",
    )


def _explicit_qubo_execute(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "explicit-qubo-execute", index)
    variables = rng.randint(3, 7)
    linear = [rng.randint(-5, 6) for _ in range(variables)]
    quadratic: list[tuple[int, int, int]] = []
    for left in range(variables):
        for right in range(left + 1, variables):
            if rng.random() < 0.4:
                quadratic.append((left, right, rng.choice((-3, -2, -1, 1, 2, 3))))
    if not quadratic:
        quadratic.append((0, 1, rng.choice((-3, -2, -1, 1, 2, 3))))
    expression = " + ".join(
        [f"({coefficient})*x{variable}" for variable, coefficient in enumerate(linear)]
        + [f"({coefficient})*x{left}*x{right}" for left, right, coefficient in quadratic]
    )
    return IntentCase(
        id=_case_id(seed, "explicit-qubo-execute", index),
        split="holdout",
        cohort="procedural-optimization",
        prompt=(
            f"Use Qiskit QAOA to minimize the complete {variables}-binary QUBO "
            f"{expression}, and compare the sampled value with exact enumeration."
        ),
        expected_mode="execute",
    )


def _explicit_dynamics_execute(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "explicit-dynamics-execute", index)
    qubits = rng.randint(2, 5)
    time = round(rng.uniform(0.2, 1.4), 3)
    z_coefficient = round(rng.uniform(-1.1, 1.1), 3)
    x_coefficient = round(rng.uniform(-0.8, 0.8), 3)
    return IntentCase(
        id=_case_id(seed, "explicit-dynamics-execute", index),
        split="holdout",
        cohort="procedural-research",
        prompt=(
            f"Starting from |{'0' * qubits}>, simulate {qubits}-qubit evolution to "
            f"t={time} under H=({z_coefficient})*Z0 + ({x_coefficient})*X0X1 in "
            "Qiskit and return the exact <Z0> expectation."
        ),
        expected_mode="execute",
    )


def _cost_matrix(rng: random.Random, size: int) -> list[list[int]]:
    return [[rng.randint(1, 30) for _ in range(size)] for _ in range(size)]


def _bounded_assignment_execute(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "bounded-assignment-execute", index)
    size = rng.randint(2, 4)
    costs = _cost_matrix(rng, size)
    return IntentCase(
        id=_case_id(seed, "bounded-assignment-execute", index),
        split="holdout",
        cohort="procedural-practical",
        prompt=(
            f"Assign {size} workers to {size} jobs using one binary qubit x_worker_job "
            f"per pair and cost matrix {costs}. Enforce one job per worker and one worker "
            "per job, run QAOA, and compare the minimum sampled cost with exact classical "
            "enumeration."
        ),
        expected_mode="execute",
    )


def _underspecified_chat(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "underspecified-chat", index)
    template = rng.choice(("vehicles", "nurses", "assets"))
    if template == "vehicles":
        prompt = (
            f"Assign {rng.randint(5, 18)} vehicles to {rng.randint(20, 60)} stops at "
            "minimum total cost and verify it classically."
        )
    elif template == "nurses":
        prompt = (
            f"Schedule {rng.randint(8, 24)} nurses for next month's shifts at minimum "
            "cost with QAOA."
        )
    else:
        prompt = (
            f"Select the best {rng.randint(8, 30)} assets to maximize return at low risk "
            "using QAOA."
        )
    return IntentCase(
        id=_case_id(seed, "underspecified-chat", index),
        split="holdout",
        cohort="procedural-underspecified",
        prompt=prompt,
        expected_mode="chat",
    )


def _resource_chat(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "resource-chat", index)
    qubits = rng.randint(26, 40)
    construction = rng.choice(("GHZ", "W", "random entangled"))
    return IntentCase(
        id=_case_id(seed, "resource-chat", index),
        split="holdout",
        cohort="procedural-resource",
        prompt=(
            f"Create a {qubits}-qubit {construction} circuit and simulate its complete "
            "statevector locally."
        ),
        expected_mode="chat",
    )


def _capability_chat(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "capability-chat", index)
    prompt = rng.choice(
        (
            "Use QuTiP to solve a Lindblad master equation and return the trajectory.",
            "Use OpenFermion with PySCF to derive a BeH2 Hamiltonian and run VQE.",
            "Submit a Bell circuit to an IonQ device through AWS Braket and return counts.",
            "Run a GHZ circuit on real IBM hardware and return the hardware job result.",
        )
    )
    return IntentCase(
        id=_case_id(seed, "capability-chat", index),
        split="holdout",
        cohort="procedural-capability",
        prompt=prompt,
        expected_mode="chat",
    )


def _oversized_assignment_chat(seed: int, index: int) -> IntentCase:
    rng = _family_rng(seed, "oversized-assignment-chat", index)
    size = rng.randint(6, 8)
    costs = _cost_matrix(rng, size)
    return IntentCase(
        id=_case_id(seed, "oversized-assignment-chat", index),
        split="holdout",
        cohort="procedural-resource",
        prompt=(
            f"Assign {size} workers to {size} jobs with complete cost matrix {costs}. "
            "Use exactly one binary qubit x_worker_job for every pair, enforce the two "
            f"one-hot constraint families, run the resulting {size * size}-qubit QAOA "
            "statevector locally, and compare with the classical optimum."
        ),
        expected_mode="chat",
    )


_GENERATORS: dict[str, Callable[[int, int], IntentCase]] = {
    "canonical-execute": _canonical_execute,
    "explicit-qubo-execute": _explicit_qubo_execute,
    "explicit-dynamics-execute": _explicit_dynamics_execute,
    "bounded-assignment-execute": _bounded_assignment_execute,
    "underspecified-chat": _underspecified_chat,
    "resource-chat": _resource_chat,
    "capability-chat": _capability_chat,
    "oversized-assignment-chat": _oversized_assignment_chat,
}


def generate_procedural_intent_cases(seed: int, *, cases_per_family: int = 1) -> list[IntentCase]:
    """Generate balanced execute/chat routing holdouts from a recorded seed."""

    if not 0 <= seed < 2**63:
        raise ValueError("procedural intent seed must be in 0..2**63-1")
    if not 1 <= cases_per_family <= 20:
        raise ValueError("procedural intent cases_per_family must be between one and twenty")
    return [
        _GENERATORS[family](seed, index)
        for family in _FAMILIES
        for index in range(cases_per_family)
    ]
