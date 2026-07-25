"""Trusted task-specific reference data for planning, generation, and verification."""

from __future__ import annotations

import re

# Known-correct physical reference data for tasks whose numbers the model would
# otherwise have to reconstruct from memory and sometimes fabricates instead. A
# live H2 VQE run (019f9763, 2026-07-25) produced a self-consistent but non-
# physical answer, -1.419 Ha rather than the textbook -1.137 Ha, because the
# generated Hamiltonian used ad hoc coefficients with duplicated Pauli terms
# (XX and YY each appeared twice) that no real Jordan-Wigner reduction
# produces. The structural checks (RESULT contains the key, the value is in
# the Plan's own guessed range) cannot catch this: the Plan's "exact" reference
# was computed from the same fabricated Hamiltonian, so nothing independent
# ever checked the physics. Giving the model the real constants up front removes
# this failure mode for the cases covered instead of relying on the model recalling
# them correctly under pressure to look complete.
_H2_EQUILIBRIUM_REFERENCE = """\
For H2 at its equilibrium bond length (~0.735 Å) in the STO-3G minimal basis, \
Jordan-Wigner-mapped and parity-reduced to 2 qubits (Kandala et al., Nature 549, \
242 (2017)), the ELECTRONIC qubit Hamiltonian is exactly:
    ("II", -1.0523732), ("IZ", 0.39793742), ("ZI", -0.39793742),
    ("ZZ", -0.0112801), ("XX", 0.18093119)
Diagonalizing exactly those terms gives -1.8572750 Hartree. The familiar -1.1373061
Hartree is the TOTAL energy: it adds the nuclear repulsion constant 0.7199689. Be
explicit about which of the two your result reports, and keep the operator and the
reported number on the same convention — to report the total energy, fold the
repulsion into the identity coefficient (-1.0523732 + 0.7199689 = -0.3324043) rather
than adding it after the fact, so the operator alone accounts for the value. If the
planned task is this molecule at this bond length, use these exact coefficients
verbatim instead of reconstructing or inventing different ones. For any other
molecule, bond length, or basis, no verified reference is available here: say so in
the Plan or result rather than fabricating coefficients that only look plausible."""

_H2_PATTERN = re.compile(r"(?<![A-Za-z0-9])H(?:2|₂)(?![A-Za-z0-9])", re.IGNORECASE)
_H2_EQUILIBRIUM_PATTERN = re.compile(
    r"(?:0[.,]7350*(?!\d)|equilibrium|平衡(?:結合)?距離)",
    re.IGNORECASE,
)
_EXPLICIT_BOND_LENGTH_PATTERN = re.compile(
    r"\b\d+[.,]\d+\s*(?:å|angstrom|ångström|a\.?u\.?|bohr)\b",
    re.IGNORECASE,
)
_H2_REFERENCE_CONFLICT_PATTERN = re.compile(
    r"(?:non[- ]?equilibrium|非平衡|cc-p|6-31|def2|bravyi|4[- ]?qubit|four[- ]qubit)",
    re.IGNORECASE,
)
_H2_TOTAL_ENERGY_HAMILTONIAN: tuple[tuple[float, str], ...] = (
    (-0.3324043, "II"),
    (0.39793742, "IZ"),
    (-0.39793742, "ZI"),
    (-0.0112801, "ZZ"),
    (0.18093119, "XX"),
)


def known_reference_for_task(task_prompt: str) -> str | None:
    """Return trusted constants only when the request identifies their exact task.

    The old algorithm-keyed lookup attached the equilibrium-H2 constants to every
    VQE request, including other molecules, bond lengths, and bases. Besides wasting
    context, that made an unrelated physical reference look authoritative. Matching
    the task before planning means the planner, generator, and reviewer receive the
    same reference, while unsupported chemistry honestly receives none.
    """

    normalized = task_prompt.strip()
    if (
        _H2_PATTERN.search(normalized)
        and (
            _H2_EQUILIBRIUM_PATTERN.search(normalized)
            or not _EXPLICIT_BOND_LENGTH_PATTERN.search(normalized)
        )
        and not _H2_REFERENCE_CONFLICT_PATTERN.search(normalized)
    ):
        return _H2_EQUILIBRIUM_REFERENCE
    return None


def trusted_hamiltonian_for_task(
    task_prompt: str,
) -> tuple[tuple[float, str], ...] | None:
    """Return machine-checkable trusted data for a catalogued task.

    This is the total-energy convention described in the accompanying prompt text:
    nuclear repulsion is folded into the identity term, so diagonalizing the
    operator alone yields the value the run reports.
    """

    if known_reference_for_task(task_prompt) is None:
        return None
    return _H2_TOTAL_ENERGY_HAMILTONIAN
