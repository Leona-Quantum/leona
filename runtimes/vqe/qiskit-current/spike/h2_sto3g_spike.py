"""Phase 0B scientific spike: H2/STO-3G exact energy on the Qiskit candidate runtime.

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
import pyscf
import qiskit
import qiskit_algorithms
import qiskit_nature
from pyscf import fci, gto, scf
from qiskit.quantum_info import SparsePauliOp
from qiskit_algorithms import NumPyMinimumEigensolver
from qiskit_nature.second_q.algorithms import GroundStateEigensolver
from qiskit_nature.second_q.drivers import PySCFDriver
from qiskit_nature.second_q.mappers import JordanWignerMapper

GEOMETRY_ATOM_STRING = "H 0 0 0; H 0 0 0.735"
GEOMETRY_UNIT = "angstrom"
BASIS = "sto-3g"
CHARGE = 0
SPIN = 0  # 2S = 0 -> singlet
OUTPUT_PATH = (
    Path(__file__).resolve().parents[3].parent
    / "docs"
    / "atlas"
    / "fixtures"
    / "h2_sto3g"
    / "raw"
    / "qiskit_current.json"
)


def independent_direct_fci_reference() -> dict:
    """Ground truth computed directly from PySCF integrals, bypassing any qubit
    mapping entirely. This is the cross-check baseline both qubit-Hamiltonian
    exact-diagonalization results below must agree with."""
    mol = gto.M(
        atom=GEOMETRY_ATOM_STRING,
        basis=BASIS,
        charge=CHARGE,
        spin=SPIN,
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


def qiskit_qubit_hamiltonian_exact() -> dict:
    driver = PySCFDriver(
        atom=GEOMETRY_ATOM_STRING,
        basis=BASIS,
        charge=CHARGE,
        spin=SPIN,
        unit=qiskit_nature_unit(),
    )
    problem = driver.run()
    mapper = JordanWignerMapper()
    second_q_op = problem.hamiltonian.second_q_op()
    qubit_op = mapper.map(second_q_op)
    assert isinstance(qubit_op, SparsePauliOp)

    solver = NumPyMinimumEigensolver()
    gse = GroundStateEigensolver(mapper, solver)
    t0 = time.perf_counter()
    result = gse.solve(problem)
    wall_time_s = time.perf_counter() - t0

    total_energies = [complex(e) for e in result.total_energies]
    assert all(abs(e.imag) < 1e-12 for e in total_energies), "unexpected imaginary energy component"

    canonical_terms = _canonicalize_sparse_pauli_op(qubit_op, num_qubits=qubit_op.num_qubits)

    return {
        "num_qubits": int(qubit_op.num_qubits),
        "num_particles": list(problem.num_particles),
        "num_spatial_orbitals": int(problem.num_spatial_orbitals),
        "nuclear_repulsion_ha": float(problem.hamiltonian.nuclear_repulsion_energy),
        "hartree_fock_bitstring_qubit0_first": _hf_bitstring(problem),
        "qubit_convention": "Qiskit SparsePauliOp label reversed so canonical string index i == qubit i (see _canonicalize_sparse_pauli_op)",
        "ground_state_total_energy_ha": total_energies[0].real,
        "wall_time_s": wall_time_s,
        "canonical_pauli_terms": canonical_terms,
        "term_count": len(canonical_terms),
    }


def qiskit_nature_unit():
    from qiskit_nature.units import DistanceUnit

    return DistanceUnit.ANGSTROM


def _hf_bitstring(problem) -> str:
    from qiskit_nature.second_q.circuit.library import HartreeFock

    mapper = JordanWignerMapper()
    hf_circuit = HartreeFock(
        problem.num_spatial_orbitals,
        problem.num_particles,
        mapper,
    )
    # HartreeFock circuit is a pure X-gate preparation circuit; read the
    # occupied qubits directly off its instruction list rather than simulating.
    occupied = [False] * hf_circuit.num_qubits
    for instruction in hf_circuit.data:
        if instruction.operation.name == "x":
            qubit_index = hf_circuit.find_bit(instruction.qubits[0]).index
            occupied[qubit_index] = True
    # Bitstring index 0 (leftmost char) == qubit 0, matching our canonical convention.
    return "".join("1" if occupied[i] else "0" for i in range(hf_circuit.num_qubits))


def _canonicalize_sparse_pauli_op(op: SparsePauliOp, *, num_qubits: int) -> list[dict]:
    terms = []
    for label, coeff in op.to_list():
        # Qiskit label convention: label[0] is qubit (num_qubits - 1), label[-1] is qubit 0.
        # Reverse so canonical[i] is qubit i, matching our fixed cross-framework convention.
        canonical_label = label[::-1]
        assert len(canonical_label) == num_qubits
        coeff = complex(coeff)
        terms.append(
            {
                "pauli_qubit0_first": canonical_label,
                "coeff_re": coeff.real,
                "coeff_im": coeff.imag,
            }
        )
    terms.sort(key=lambda t: t["pauli_qubit0_first"])
    return terms


def main() -> int:
    try:
        fci_reference = independent_direct_fci_reference()
        qubit_result = qiskit_qubit_hamiltonian_exact()
    except Exception as exc:  # spike harness: report failure honestly, do not swallow
        report = {
            "status": "execution_failed",
            "failure_code": "execution_failed",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(report, indent=2))
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1

    absolute_error_vs_direct_fci_ha = abs(
        qubit_result["ground_state_total_energy_ha"] - fci_reference["fci_energy_ha"]
    )

    report = {
        "status": "ok",
        "runtime_candidate": "qiskit-current",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python_version": sys.version,
        "platform": platform.platform(),
        "package_versions": {
            "qiskit": qiskit.__version__,
            "qiskit_algorithms": qiskit_algorithms.__version__,
            "qiskit_nature": qiskit_nature.__version__,
            "pyscf": pyscf.__version__,
            "numpy": np.__version__,
        },
        "geometry": {
            "atom_string": GEOMETRY_ATOM_STRING,
            "unit": GEOMETRY_UNIT,
            "basis": BASIS,
            "charge": CHARGE,
            "spin_2s": SPIN,
        },
        "independent_direct_fci_reference": fci_reference,
        "qubit_hamiltonian_exact_diagonalization": qubit_result,
        "absolute_error_vs_direct_fci_ha": absolute_error_vs_direct_fci_ha,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
