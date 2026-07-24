"""Phase 0B scientific spike: H2/STO-3G exact energy on the PennyLane candidate runtime.

Not tracked product code (per docs/atlas/atlas_vqe_mvp_execution_plan_ja.md Phase 0B).
Writes a JSON report of ACTUALLY MEASURED output only -- no value in this file is
hand-typed or assumed. Run with: uv run python spike/h2_sto3g_spike.py
"""

from __future__ import annotations

import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pennylane as qml
import pyscf
from pyscf import fci, gto, scf

GEOMETRY_ATOM_STRING = "H 0 0 0; H 0 0 0.735"
GEOMETRY_UNIT = "angstrom"
GEOMETRY_COORDINATES = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 0.735]])
BASIS = "sto-3g"
CHARGE = 0
MULT = 1  # 2S+1 = 1 -> singlet
OUTPUT_PATH = (
    Path(__file__).resolve().parents[3].parent
    / "docs"
    / "atlas"
    / "fixtures"
    / "h2_sto3g"
    / "raw"
    / "pennylane_current.json"
)


def independent_direct_fci_reference(*, basis: str = BASIS) -> dict:
    """Ground truth computed directly from PySCF integrals, bypassing any qubit
    mapping entirely -- deliberately duplicated from the Qiskit-candidate spike
    rather than shared, so this remains a true independent cross-check of this
    runtime's own PySCF installation.

    `basis` is parameterized (default: the real BASIS constant) purely so
    test_failure_contract.py can pass an invalid basis and exercise the same
    failure path `main()` uses, without mutating module state."""
    mol = gto.M(
        atom=GEOMETRY_ATOM_STRING,
        basis=basis,
        charge=CHARGE,
        spin=MULT - 1,
        unit=GEOMETRY_UNIT,
        verbose=0,
    )
    mf = scf.RHF(mol)
    t0 = time.perf_counter()
    hf_energy = mf.kernel()
    cisolver = fci.FCI(mf)
    fci_energy, _fci_vec = cisolver.kernel()
    wall_time_s = time.perf_counter() - t0
    return {
        "method": "pyscf.fci.FCI(pyscf.scf.RHF(mol)) -- direct, no qubit mapping involved",
        "hf_energy_ha": float(hf_energy),
        "fci_energy_ha": float(fci_energy),
        "nuclear_repulsion_ha": float(mol.energy_nuc()),
        "n_electrons": int(mol.nelectron),
        "n_ao": int(mol.nao_nr()),
        "wall_time_s": wall_time_s,
    }


_PAULI_NAME_TO_LETTER = {
    "PauliX": "X",
    "PauliY": "Y",
    "PauliZ": "Z",
    "Identity": "I",
}


def _term_to_canonical_label(op, num_wires: int) -> str:
    """PennyLane wire index i -> canonical string position i (identical
    left-to-right convention chosen for the Qiskit-candidate spike)."""
    letters = ["I"] * num_wires
    factors = op.operands if hasattr(op, "operands") else [op]
    for factor in factors:
        name = factor.name
        if name == "Identity":
            continue
        letter = _PAULI_NAME_TO_LETTER[name]
        (wire,) = factor.wires
        letters[int(wire)] = letter
    return "".join(letters)


def pennylane_qubit_hamiltonian_exact(*, basis: str = BASIS) -> dict:
    molecule = qml.qchem.Molecule(
        ["H", "H"],
        GEOMETRY_COORDINATES,
        charge=CHARGE,
        mult=MULT,
        basis_name=basis,
        unit=GEOMETRY_UNIT,
    )
    hamiltonian, num_qubits = qml.qchem.molecular_hamiltonian(
        molecule, method="pyscf", mapping="jordan_wigner"
    )
    coeffs, ops = hamiltonian.terms()

    canonical_terms = []
    for coeff, op in zip(coeffs, ops):
        coeff = complex(coeff)
        canonical_terms.append(
            {
                "pauli_qubit0_first": _term_to_canonical_label(op, num_qubits),
                "coeff_re": coeff.real,
                "coeff_im": coeff.imag,
            }
        )
    canonical_terms.sort(key=lambda t: t["pauli_qubit0_first"])

    t0 = time.perf_counter()
    dense_matrix = qml.matrix(hamiltonian, wire_order=list(range(num_qubits)))
    eigenvalues = np.linalg.eigvalsh(dense_matrix)
    wall_time_s = time.perf_counter() - t0
    ground_state_energy = float(eigenvalues[0].real)

    n_electrons = molecule.n_electrons
    n_spin_orbitals = 2 * molecule.n_orbitals
    hf_occupation = qml.qchem.hf_state(n_electrons, n_spin_orbitals)

    return {
        "num_qubits": int(num_qubits),
        "num_particles_active_electrons": int(n_electrons),
        "num_spatial_orbitals": int(molecule.n_orbitals),
        "hartree_fock_bitstring_qubit0_first": "".join(str(int(b)) for b in hf_occupation),
        "qubit_convention": "PennyLane wire index i -> canonical string position i (see _term_to_canonical_label). PennyLane's own molecular_hamiltonian orbital-to-wire assignment is its library default, NOT independently chosen here.",
        "ground_state_total_energy_ha": ground_state_energy,
        "wall_time_s": wall_time_s,
        "canonical_pauli_terms": canonical_terms,
        "term_count": len(canonical_terms),
    }


def run_spike(*, basis: str = BASIS, output_path: Path = OUTPUT_PATH) -> int:
    """Full spike: compute, write the JSON report to `output_path`, return the
    process exit code. Parameterized over `basis`/`output_path` (rather than
    reading OUTPUT_PATH/BASIS directly) so test_failure_contract.py can drive
    the real failure path -- an actually-invalid basis, not a mocked
    exception -- against a throwaway path instead of the real fixture input."""
    try:
        fci_reference = independent_direct_fci_reference(basis=basis)
        qubit_result = pennylane_qubit_hamiltonian_exact(basis=basis)
    except Exception as exc:  # spike harness: report failure honestly, do not swallow
        report = {
            "status": "execution_failed",
            "failure_code": "execution_failed",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2))
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1

    absolute_error_vs_direct_fci_ha = abs(
        qubit_result["ground_state_total_energy_ha"] - fci_reference["fci_energy_ha"]
    )

    report = {
        "status": "ok",
        "runtime_candidate": "pennylane-current",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python_version": sys.version,
        "platform": platform.platform(),
        "package_versions": {
            "pennylane": qml.__version__,
            "pyscf": pyscf.__version__,
            "numpy": np.__version__,
        },
        "geometry": {
            "atom_string": GEOMETRY_ATOM_STRING,
            "unit": GEOMETRY_UNIT,
            "basis": basis,
            "charge": CHARGE,
            "mult": MULT,
        },
        "independent_direct_fci_reference": fci_reference,
        "qubit_hamiltonian_exact_diagonalization": qubit_result,
        "absolute_error_vs_direct_fci_ha": absolute_error_vs_direct_fci_ha,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


def main() -> int:
    return run_spike()


if __name__ == "__main__":
    raise SystemExit(main())
