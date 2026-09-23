"""H2 energy curve: a variational quantum eigensolver (VQE) run at each bond
length in a sweep, compared with Hartree-Fock and with the exact energy in the
same basis.

Everything is computed here, including the molecular integrals: the minimal
STO-3G basis (Hehre, Stewart and Pople, 1969) has closed-form integrals for
s-type Gaussians (Szabo and Ostlund, Modern Quantum Chemistry, Appendix A), so
no chemistry package is needed.

Qubit model. For H2 in a minimal basis the two molecular orbitals are fixed by
symmetry: bonding g = (a + b) / sqrt(2 + 2S) and antibonding u = (a - b) /
sqrt(2 - 2S). The ground state only ever holds the electron pair in one
orbital or the other, so each orbital becomes one qubit (|1> = holds the pair)
and the Hamiltonian is exact on those states:

    H = E_nuc + E_g n_g + E_u n_u + K (X_g X_u + Y_g Y_u) / 2 + W n_g n_u

with n = (1 - Z) / 2, E_g = 2 h_gg + (gg|gg), E_u = 2 h_uu + (uu|uu),
K = (gu|gu) and W = 4 (gg|uu) - 2 (gu|gu).

Runs in the Qapp sandbox, which injects QAPP_INPUTS and reads RESULT.
"""

import math

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector
from scipy.optimize import minimize_scalar

BOHR_PER_ANGSTROM = 1 / 0.529177210903
# STO-3G hydrogen 1s: primitive exponents (for zeta = 1.24) and contraction coefficients.
EXPONENTS = (3.42525091, 0.62391373, 0.16885540)
COEFFICIENTS = (0.15432897, 0.53532814, 0.44463454)

r_min = QAPP_INPUTS.get("r_min", 0.4)
r_max = QAPP_INPUTS.get("r_max", 2.5)
points = QAPP_INPUTS.get("points", 15)
for name, value, low, high in (("r_min", r_min, 0.3, 1.2), ("r_max", r_max, 1.5, 3.5)):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high} angstrom")
if not isinstance(points, int) or isinstance(points, bool) or not 3 <= points <= 30:
    raise ValueError("points must be a whole number from 3 to 30")
if QAPP_MAX_QUBITS < 2:
    raise ValueError("this app needs 2 qubits")


def boys0(t):
    return 1.0 if t < 1e-12 else 0.5 * math.sqrt(math.pi / t) * math.erf(math.sqrt(t))


def ao_integrals(r):
    """Overlap, core Hamiltonian and two-electron integrals over the two 1s
    functions, nuclei at z = 0 and z = r (bohr)."""
    centres = (0.0, r)
    primitives = [
        (centre, alpha, coefficient * (2 * alpha / math.pi) ** 0.75)
        for centre in range(2)
        for alpha, coefficient in zip(EXPONENTS, COEFFICIENTS)
    ]
    overlap = np.zeros((2, 2))
    core = np.zeros((2, 2))
    eri = np.zeros((2, 2, 2, 2))
    for i, a, ca in primitives:
        for j, b, cb in primitives:
            p = a + b
            ab2 = (centres[i] - centres[j]) ** 2
            k_ab = math.exp(-a * b / p * ab2)
            pz = (a * centres[i] + b * centres[j]) / p
            s = (math.pi / p) ** 1.5 * k_ab
            overlap[i, j] += ca * cb * s
            core[i, j] += ca * cb * a * b / p * (3 - 2 * a * b / p * ab2) * s
            for nucleus in centres:
                core[i, j] -= ca * cb * 2 * math.pi / p * k_ab * boys0(p * (pz - nucleus) ** 2)
            for m, c, cc in primitives:
                for n, d, cd in primitives:
                    q = c + d
                    k_cd = math.exp(-c * d / q * (centres[m] - centres[n]) ** 2)
                    qz = (c * centres[m] + d * centres[n]) / q
                    eri[i, j, m, n] += (
                        ca
                        * cb
                        * cc
                        * cd
                        * 2
                        * math.pi**2.5
                        / (p * q * math.sqrt(p + q))
                        * k_ab
                        * k_cd
                        * boys0(p * q / (p + q) * (pz - qz) ** 2)
                    )
    return overlap, core, eri


def hamiltonian(r_angstrom):
    r = r_angstrom * BOHR_PER_ANGSTROM
    overlap, core, eri = ao_integrals(r)
    s = overlap[0, 1]
    mo = np.array(
        [
            [1 / math.sqrt(2 + 2 * s), 1 / math.sqrt(2 - 2 * s)],
            [1 / math.sqrt(2 + 2 * s), -1 / math.sqrt(2 - 2 * s)],
        ]
    )
    h = mo.T @ core @ mo
    g = np.einsum("pi,qj,pqrs,rk,sl->ijkl", mo, mo, eri, mo, mo)
    e_g = 2 * h[0, 0] + g[0, 0, 0, 0]
    e_u = 2 * h[1, 1] + g[1, 1, 1, 1]
    k = g[0, 1, 0, 1]
    w = 4 * g[0, 0, 1, 1] - 2 * k
    e_nuc = 1 / r
    # Qubit 0 is the bonding orbital g, qubit 1 the antibonding orbital u.
    # Qiskit labels are read right to left, so "IZ" is Z on qubit 0.
    operator = SparsePauliOp.from_list(
        [
            ("II", e_nuc + e_g / 2 + e_u / 2 + w / 4),
            ("IZ", -e_g / 2 - w / 4),
            ("ZI", -e_u / 2 - w / 4),
            ("ZZ", w / 4),
            ("XX", k / 2),
            ("YY", k / 2),
        ]
    ).simplify()
    return operator, e_nuc


def ansatz(theta):
    """cos(theta) |pair in g> + sin(theta) |pair in u>, starting from |00>."""
    circuit = QuantumCircuit(2)
    circuit.ry(2 * theta, 0)
    circuit.cx(0, 1)
    circuit.x(0)
    return circuit


def energy(operator, theta):
    return float(Statevector.from_instruction(ansatz(theta)).expectation_value(operator).real)


def exact_energy(operator):
    # The two states that hold one electron pair: |q1 q0> = |01> (index 1, pair
    # in g) and |10> (index 2, pair in u). The lowest eigenvalue of that block
    # is the exact (full configuration interaction) energy in this basis.
    matrix = operator.to_matrix().real
    return float(np.linalg.eigvalsh(matrix[np.ix_([1, 2], [1, 2])])[0])


curve = []
for r in np.linspace(r_min, r_max, points):
    operator, _ = hamiltonian(float(r))
    found = minimize_scalar(
        lambda t, op=operator: energy(op, t),
        bounds=(-math.pi / 2, math.pi / 2),
        method="bounded",
        options={"xatol": 1e-8},
    )
    curve.append(
        {
            "r_angstrom": round(float(r), 6),
            "hartree_fock": round(energy(operator, 0.0), 8),
            "vqe": round(float(found.fun), 8),
            "exact": round(exact_energy(operator), 8),
            "theta": round(float(found.x), 6),
            "excited_weight": round(math.sin(found.x) ** 2, 6),
        }
    )

# The bond length where the exact energy is lowest, searched over the swept range.
bond = minimize_scalar(
    lambda r: exact_energy(hamiltonian(r)[0]),
    bounds=(r_min, r_max),
    method="bounded",
    options={"xatol": 1e-6},
)
lowest = min(curve, key=lambda row: row["vqe"])

RESULT = {
    "units": "hartree",
    "curve": curve,
    "equilibrium_r_angstrom": round(float(bond.x), 4),
    "equilibrium_energy": round(float(bond.fun), 8),
    # False when the lowest energy sits at an end of the swept range, which means
    # the true minimum lies outside it and the value above is only that end.
    "equilibrium_in_range": bool(r_min + 1e-3 < bond.x < r_max - 1e-3),
    "lowest_sweep_r_angstrom": lowest["r_angstrom"],
    "max_vqe_error_millihartree": round(
        max(abs(row["vqe"] - row["exact"]) for row in curve) * 1000, 6
    ),
    "max_correlation_millihartree": round(
        max(row["hartree_fock"] - row["exact"] for row in curve) * 1000, 6
    ),
}
