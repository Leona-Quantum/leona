"""Phase 0B fixture assembly: cross-check the Qiskit-candidate and
PennyLane-candidate H2/STO-3G spikes and freeze the results everyone else
must treat as ground truth (docs/atlas/atlas_vqe_mvp_execution_plan_ja.md
Part III §12).

This script only needs numpy beyond the stdlib (for the independent
full-spectrum matrix cross-check) so it can run under any Python environment
that has numpy, without needing either runtime's own virtual environment.

Usage: python3 generate_fixture.py
"""

from __future__ import annotations

import hashlib
import itertools
import json
import subprocess
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "raw"
QISKIT_REPORT = RAW_DIR / "qiskit_current.json"
PENNYLANE_REPORT = RAW_DIR / "pennylane_current.json"
MANIFEST_PATH = HERE / "manifest.json"

# Exact diagonalization cross-check tolerance from the MVP execution plan §13.
# This governs a single pipeline's eigensolver reproducing ITS OWN frozen
# Hamiltonian's true eigenvalue (both q_err and p_err below satisfy this
# comfortably, at ~1e-13 to 1e-15 Ha).
EXACT_CROSS_CHECK_TOLERANCE_HA = 1e-10
# Separate, looser tolerance for comparing the TWO INDEPENDENTLY SCF-derived
# Hamiltonians (Qiskit-nature's PySCFDriver vs PennyLane's own pyscf-backend
# call) to each other, before either is frozen as canonical. Both use PySCF's
# library-default RHF conv_tol=1e-9 (qiskit-nature passes it explicitly;
# PennyLane's qchem.openfermion_pyscf._pyscf_integrals does not expose a
# conv_tol override, so it also falls back to PySCF's own default) via
# independent SCF solves -- so their derived MO coefficients, and hence the
# assembled Hamiltonians, agree only to that same ~1e-9-1e-10 scale, not to
# machine precision. This is expected numerical noise from two independent
# SCF convergences, not a methodology error; the observed 1.2e-9 Ha spectrum
# gap is consistent with it.
CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA = 1e-6
# VQE-accepted-result tolerance from the same section. Not exercised by this
# spike (no optimizer loop runs in Phase 0) -- recorded here only so the
# fixture states where it came from, not so this script claims to have used it.
VQE_ACCEPTED_TOLERANCE_HA = 1e-5
# Precision at which term coefficients are rounded before hashing, so the
# digest is stable across re-runs despite SCF-convergence-level float jitter
# in the last 1-3 ULPs, while remaining far tighter than any tolerance above.
COEFFICIENT_HASH_PRECISION_DECIMALS = 12


def load(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"missing spike output: {path} -- run its spike/h2_sto3g_spike.py first")
    data = json.loads(path.read_text())
    if data.get("status") != "ok":
        raise SystemExit(f"{path} recorded a failed spike run: {data}")
    return data


def terms_to_dict(terms: list[dict], *, identity_shift: float = 0.0) -> dict[str, complex]:
    d = {}
    for t in terms:
        coeff = complex(t["coeff_re"], t["coeff_im"])
        label = t["pauli_qubit0_first"]
        if identity_shift and set(label) == {"I"}:
            coeff += identity_shift
        d[label] = coeff
    return d


# Local single-qubit Pauli-frame automorphisms that fix Z (Z is never touched
# because the diagonal Z/ZZ terms already, independently, pin down the qubit
# permutation below with no ambiguity -- see the module docstring note in
# `main()`). Each maps (old_char -> (new_char, sign)):
#   id:   X->X,  Y->Y                          (no change)
#   z:    X->-X, Y->-Y                         (conjugation by Z; the RHF
#                                                molecular-orbital-coefficient
#                                                sign gauge)
#   s:    X->Y,  Y->-X                         (conjugation by the S/phase
#                                                gate; a per-qubit complex
#                                                phase convention in how a
#                                                library defines the
#                                                Jordan-Wigner ladder operator
#                                                a_j = (X_j -+ i Y_j)/2)
#   sdag: X->-Y, Y->X                          (conjugation by S^-1)
# These are the only four operations that (a) fix I and Z and (b) map
# {X, Y} to {X, Y} up to sign -- i.e. exactly the local gauge freedom two
# independently-implemented Jordan-Wigner mappings can legitimately differ
# by without representing different physics. This was discovered necessary
# empirically: the two candidates' single-Z and Z*Z terms fix a unique qubit
# permutation on their own (no gauge freedom needed there), but their
# double-excitation (weight-4 X/Y) terms did not match under that permutation
# with a plain sign flip alone -- only after allowing per-qubit S-conjugation
# on two of the four qubits. The full 16-eigenvalue spectra of both operators
# were independently verified identical to 1.2e-9 Ha before this search ran,
# confirming both sides represent the same physical operator and this is a
# labeling/gauge question, not a physics discrepancy.
def _id(c: str) -> tuple[str, int]:
    return (c, 1)


def _z(c: str) -> tuple[str, int]:
    return (c, -1) if c in ("X", "Y") else (c, 1)


def _s(c: str) -> tuple[str, int]:
    return {"X": ("Y", 1), "Y": ("X", -1), "Z": ("Z", 1), "I": ("I", 1)}[c]


def _sdag(c: str) -> tuple[str, int]:
    return {"X": ("Y", -1), "Y": ("X", 1), "Z": ("Z", 1), "I": ("I", 1)}[c]


LOCAL_PAULI_FRAME_TRANSFORMS = (_id, _z, _s, _sdag)
LOCAL_PAULI_FRAME_NAMES = ("id", "z", "s", "sdag")


def find_qubit_equivalence(
    reference: dict[str, complex], candidate: dict[str, complex], num_qubits: int, tol: float
):
    """Brute-force all num_qubits! wire permutations combined with all
    len(LOCAL_PAULI_FRAME_TRANSFORMS)**num_qubits per-qubit local gauge
    choices, and return the one under which `candidate`, remapped, matches
    `reference` term-for-term within `tol`. perm[new_position] = old_position.
    Returns (perm, frame_choice, max_abs_diff) or None."""
    best = None
    for perm in itertools.permutations(range(num_qubits)):
        for frame_choice in itertools.product(
            range(len(LOCAL_PAULI_FRAME_TRANSFORMS)), repeat=num_qubits
        ):
            remapped: dict[str, complex] = {}
            for label, coeff in candidate.items():
                new_chars = [None] * num_qubits
                sign = 1
                for new_pos in range(num_qubits):
                    old_pos = perm[new_pos]
                    new_char, s = LOCAL_PAULI_FRAME_TRANSFORMS[frame_choice[old_pos]](
                        label[old_pos]
                    )
                    new_chars[new_pos] = new_char
                    sign *= s
                new_label = "".join(new_chars)
                remapped[new_label] = remapped.get(new_label, 0) + coeff * sign
            if set(remapped.keys()) != set(reference.keys()):
                continue
            max_diff = max(abs(remapped[k] - reference[k]) for k in reference)
            if max_diff <= tol and (best is None or max_diff < best[2]):
                best = (perm, frame_choice, max_diff)
    return best


_PAULI_MATRICES = {
    "I": np.eye(2, dtype=complex),
    "X": np.array([[0, 1], [1, 0]], dtype=complex),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=complex),
    "Z": np.array([[1, 0], [0, -1]], dtype=complex),
}


def build_dense_matrix(terms: dict[str, complex], num_qubits: int) -> np.ndarray:
    dim = 2**num_qubits
    matrix = np.zeros((dim, dim), dtype=complex)
    for label, coeff in terms.items():
        term_matrix = np.array([[1]], dtype=complex)
        for char in label:
            term_matrix = np.kron(term_matrix, _PAULI_MATRICES[char])
        matrix += coeff * term_matrix
    return matrix


def spectrum_cross_check(
    q_terms: dict[str, complex], p_terms: dict[str, complex], num_qubits: int
) -> dict:
    """Independent, convention-agnostic confirmation that both electronic
    Hamiltonians are the same physical operator: the full eigenvalue spectrum
    of a Hermitian operator is invariant under any relabeling/local-basis
    change of its tensor factors, so if the spectra match, both sides
    represent the same operator regardless of whether a discrete
    permutation+gauge correspondence between their Pauli terms has been
    found yet. This runs BEFORE the discrete equivalence search and is what
    justified widening that search to include local Pauli-frame gauges
    instead of concluding the two Hamiltonians were simply different."""
    q_spectrum = np.sort(np.linalg.eigvalsh(build_dense_matrix(q_terms, num_qubits)).real)
    p_spectrum = np.sort(np.linalg.eigvalsh(build_dense_matrix(p_terms, num_qubits)).real)
    max_diff = float(np.max(np.abs(q_spectrum - p_spectrum)))
    return {
        "max_abs_eigenvalue_diff_ha": max_diff,
        "num_eigenvalues": len(q_spectrum),
    }


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip()
    except Exception:
        return "unknown"


def main() -> int:
    qiskit_report = load(QISKIT_REPORT)
    pennylane_report = load(PENNYLANE_REPORT)

    q_fci = qiskit_report["independent_direct_fci_reference"]["fci_energy_ha"]
    p_fci = pennylane_report["independent_direct_fci_reference"]["fci_energy_ha"]
    fci_agreement = abs(q_fci - p_fci)
    if fci_agreement > EXACT_CROSS_CHECK_TOLERANCE_HA:
        raise SystemExit(
            f"independent FCI references disagree by {fci_agreement} Ha (> {EXACT_CROSS_CHECK_TOLERANCE_HA}); "
            "the two runtimes' PySCF installs are not computing the same physics -- stop, do not paper over this"
        )

    q_result = qiskit_report["qubit_hamiltonian_exact_diagonalization"]
    p_result = pennylane_report["qubit_hamiltonian_exact_diagonalization"]

    q_err = abs(q_result["ground_state_total_energy_ha"] - q_fci)
    p_err = abs(p_result["ground_state_total_energy_ha"] - p_fci)
    if q_err > EXACT_CROSS_CHECK_TOLERANCE_HA:
        raise SystemExit(
            f"Qiskit qubit-Hamiltonian exact energy disagrees with its own FCI reference by {q_err} Ha"
        )
    if p_err > EXACT_CROSS_CHECK_TOLERANCE_HA:
        raise SystemExit(
            f"PennyLane qubit-Hamiltonian exact energy disagrees with its own FCI reference by {p_err} Ha"
        )

    if q_result["num_qubits"] != p_result["num_qubits"]:
        raise SystemExit(
            "qubit count mismatch between candidates -- cannot compare canonical Hamiltonians"
        )
    num_qubits = q_result["num_qubits"]

    nuclear_repulsion_ha = qiskit_report["independent_direct_fci_reference"]["nuclear_repulsion_ha"]
    # Qiskit-nature's mapped qubit_op is the ELECTRONIC Hamiltonian only (its
    # GroundStateEigensolver adds nuclear repulsion separately when reporting
    # total_energies). PennyLane's molecular_hamiltonian bakes nuclear
    # repulsion directly into the identity-term coefficient. Put both on the
    # same footing -- electronic-only -- before comparing or freezing a
    # canonical form; this was found empirically (see the module note above
    # `find_qubit_equivalence`) by noticing the two 16-eigenvalue spectra were
    # offset by a uniform shift exactly equal to nuclear_repulsion_ha.
    q_terms = terms_to_dict(q_result["canonical_pauli_terms"])
    p_terms = terms_to_dict(p_result["canonical_pauli_terms"], identity_shift=-nuclear_repulsion_ha)

    spectrum_check = spectrum_cross_check(q_terms, p_terms, num_qubits)
    if spectrum_check["max_abs_eigenvalue_diff_ha"] > CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA:
        raise SystemExit(
            "full eigenvalue spectra of the two electronic Hamiltonians disagree by "
            f"{spectrum_check['max_abs_eigenvalue_diff_ha']} Ha (> {CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA}); "
            "these are not the same physical operator under any relabeling -- stop, do not paper over this"
        )

    identity_perm = tuple(range(num_qubits))
    direct_match = (
        set(q_terms) == set(p_terms)
        and max(abs(q_terms[k] - p_terms[k]) for k in q_terms)
        <= CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA
    )

    if direct_match:
        equivalence = {
            "kind": "identical",
            "qubit_permutation_pennylane_to_qiskit": list(identity_perm),
            "local_pauli_frame_pennylane": ["id"] * num_qubits,
        }
    else:
        found = find_qubit_equivalence(
            q_terms, p_terms, num_qubits, tol=CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA
        )
        if found is None:
            raise SystemExit(
                "no qubit permutation + local Pauli-frame choice makes the PennyLane canonical "
                "Hamiltonian (electronic-only) match the Qiskit one -- this is a real discrepancy, "
                "not something to paper over. Stopping without writing a fixture."
            )
        perm, frame_choice, max_diff = found
        equivalence = {
            "kind": "permutation_and_local_pauli_frame_equivalent",
            "qubit_permutation_pennylane_to_qiskit": list(perm),
            "local_pauli_frame_pennylane": [LOCAL_PAULI_FRAME_NAMES[c] for c in frame_choice],
            "max_abs_coefficient_diff_ha": max_diff,
            "note": (
                "perm[new_position] = old_position. Each PennyLane wire (indexed by its OLD position, "
                "before permutation) is first transformed by its listed local_pauli_frame_pennylane "
                "entry (id/z/s/sdag -- see LOCAL_PAULI_FRAME_TRANSFORMS), then relabeled per perm; the "
                "result equals Qiskit's electronic-only canonical string term-for-term. The single-Z "
                "and Z*Z terms alone already fix this permutation uniquely with no gauge freedom "
                "needed (they are gauge-invariant); the local Pauli-frame choice is needed only for "
                "the double-excitation (weight-4 X/Y) terms, and reflects a per-qubit complex-phase "
                "convention difference in how each library defines the Jordan-Wigner ladder operator "
                "-- confirmed benign by an independent full 16-eigenvalue spectrum match (see "
                "spectrum_cross_check below) before this search ran. Discovered by exhaustive search, "
                "not assumed from either library's documentation."
            ),
        }

    # Freeze on Qiskit's canonical convention (qubit0-first, electronic-only,
    # arbitrary but must pick one) as THE fixture's canonical Hamiltonian,
    # rounded for a stable digest. nuclear_repulsion_ha (below) must be added
    # separately to recover the total energy.
    canonical_terms_for_digest = [
        {
            "pauli_qubit0_first": label,
            "coeff_re": round(coeff.real, COEFFICIENT_HASH_PRECISION_DECIMALS),
            "coeff_im": round(coeff.imag, COEFFICIENT_HASH_PRECISION_DECIMALS),
        }
        for label, coeff in sorted(q_terms.items())
    ]
    digest_input = json.dumps(canonical_terms_for_digest, sort_keys=True).encode("utf-8")
    hamiltonian_digest = hashlib.sha256(digest_input).hexdigest()

    manifest = {
        "fixture_id": "h2_sto3g_r0.735A_singlet_jw_no_frozen_core",
        "fixture_generator_version": "0.1.0",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator_git_commit": git_commit(),
        "geometry": qiskit_report["geometry"],
        "nuclear_repulsion_ha": qiskit_report["independent_direct_fci_reference"][
            "nuclear_repulsion_ha"
        ],
        "electron_orbital_qubit_counts": {
            "n_electrons": qiskit_report["independent_direct_fci_reference"]["n_electrons"],
            "n_spatial_orbitals": q_result["num_spatial_orbitals"],
            "n_qubits": num_qubits,
        },
        "independent_direct_fci_reference_ha": q_fci,
        "independent_fci_cross_runtime_agreement_ha": fci_agreement,
        "canonical_hamiltonian": {
            "convention": "Qiskit-candidate qubit0-first ordering (arbitrary choice, fixed as the fixture canonical form)",
            "nuclear_repulsion_convention": (
                "ELECTRONIC-ONLY: nuclear_repulsion_ha (top-level field) is NOT included in the IIII "
                "coefficient below and must be added separately to recover a total energy. This matches "
                "Qiskit-nature's native qubit_op output; PennyLane's molecular_hamiltonian bakes nuclear "
                "repulsion into its identity term natively and was corrected by subtracting "
                "nuclear_repulsion_ha before comparison, purely for this fixture's canonical form."
            ),
            "coefficient_rounding_decimals": COEFFICIENT_HASH_PRECISION_DECIMALS,
            "terms": canonical_terms_for_digest,
            "term_count": len(canonical_terms_for_digest),
        },
        "hamiltonian_digest_sha256": hamiltonian_digest,
        "spectrum_cross_check": spectrum_check,
        "cross_framework_equivalence": equivalence,
        "hartree_fock_bitstrings": {
            "qiskit_current": q_result["hartree_fock_bitstring_qubit0_first"],
            "pennylane_current": p_result["hartree_fock_bitstring_qubit0_first"],
            "note": "Each in its own runtime's native wire order; NOT directly comparable without applying cross_framework_equivalence.qubit_permutation_pennylane_to_qiskit.",
        },
        "exact_diagonalization_results_ha": {
            "qiskit_current": q_result["ground_state_total_energy_ha"],
            "pennylane_current": p_result["ground_state_total_energy_ha"],
            "qiskit_vs_direct_fci_abs_error_ha": q_err,
            "pennylane_vs_direct_fci_abs_error_ha": p_err,
        },
        "acceptance_tolerances": {
            "exact_diagonalization_cross_check_ha": EXACT_CROSS_CHECK_TOLERANCE_HA,
            "vqe_accepted_result_ha": VQE_ACCEPTED_TOLERANCE_HA,
            "source": "docs/atlas/atlas_vqe_mvp_execution_plan_ja.md Part III §13 (initial target values; this fixture run only exercised the exact-diagonalization tolerance, not the VQE-accepted tolerance -- no optimizer loop ran in Phase 0)",
        },
        "ansatz_and_initial_point": {
            "status": "not_defined",
            "note": "Deliberately deferred to Phase 1/5 component schema and owner review. Phase 0 acceptance only requires the exact energy and canonical Hamiltonian, not an approved ansatz or initial point -- fabricating one here would misrepresent it as reviewed when it is not.",
        },
        "review_record": {
            "automated_cross_validation": "PASS -- see cross_framework_equivalence and exact_diagonalization_results_ha above",
            "human_or_owner_review": "PENDING -- not yet performed. Do not treat this fixture as the reviewed golden fixture (plan §12) until an owner has signed off.",
        },
        "source_spike_reports": {
            "qiskit_current": str(QISKIT_REPORT.relative_to(HERE.parent.parent.parent.parent)),
            "pennylane_current": str(
                PENNYLANE_REPORT.relative_to(HERE.parent.parent.parent.parent)
            ),
        },
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
