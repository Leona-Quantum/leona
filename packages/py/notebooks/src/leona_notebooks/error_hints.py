"""What a Qiskit error message usually means, for the repair prompt and the reader.

Every entry was reproduced on qiskit 2.5.2 on 2026-09-23 (the sandbox image pins 2.5.0,
the same API) before it was written here, with the message copied from the exception
rather than remembered. An entry that is not true of the pinned version sends the repair
model after the wrong cause, which is worse than no hint at all, so an entry changes only
with a new probe.

The table is small on purpose. It exists for the messages whose traceback points
somewhere other than the mistake: `Invalid input data format for Operator` is raised in
`Operator.__init__`, three calls away from the `QuantumCircuit(1).h(0)` that caused it.
"""

from __future__ import annotations

import re

#: (pattern over "ename: evalue", hint). First match wins per hint; several may apply.
_HINTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"Invalid input data format for Operator"),
        "Something that is not a circuit, gate or matrix reached `Operator`, `Statevector.evolve` "
        "or `Statevector(...)`. The usual cause is the RESULT of a gate call, such as "
        "`QuantumCircuit(1).h(0)`, which is an InstructionSet, not the circuit. Build the circuit, "
        "apply gates on their own lines, and pass the circuit variable.",
    ),
    (
        re.compile(r"Cannot apply (instruction|operation) with classical bits"),
        "The circuit has measurements, and a statevector or operator cannot be built from a "
        "measured circuit. Build the state before `measure_all()`, or use "
        "`qc.remove_final_measurements(inplace=False)`.",
    ),
    (
        re.compile(r"'DataBin' object has no attribute"),
        "Sampler results are read by classical register NAME. `measure_all()` creates a register "
        "called `meas` (`.data.meas.get_counts()`); a register created as "
        '`ClassicalRegister(n, "c")` is read as `.data.c.get_counts()`.',
    ),
    (
        re.compile(r"'NoneType' object has no attribute"),
        "A value is None. In Qiskit this is often the result of an in-place method such as "
        "`qc.measure_all()`, which returns None, being used as though it were the circuit.",
    ),
    (
        re.compile(
            r"cannot import name '(execute|Aer|BasicAer|IBMQ)' from 'qiskit'|"
            r"module 'qiskit' has no attribute '(execute|Aer|BasicAer)'"
        ),
        "That name was removed from Qiskit. Run circuits with `StatevectorSampler` from "
        "`qiskit.primitives`, or `AerSimulator` from `qiskit_aer`.",
    ),
    (
        re.compile(r"MissingOptionalLibraryError"),
        'An optional plotting library is missing. `qc.draw("text")` always works; use it '
        'instead of `qc.draw("mpl")` unless the figure is the point of the cell.',
    ),
    # The four packages below are matched on their BARE name, not on the guard's or the
    # linter's wrapping text, because the two paths that can produce this repair context
    # word the violation differently: the sandbox guard's own message is
    # `disallowed_import:qiskit_nature` (`majorana_sandbox.guard.check_python_code`),
    # while the pre-run linter's is "The sandbox does not allow `import qiskit_nature`. ..."
    # (`leona_notebooks.lint`, code `forbidden-import`). Matching the module name plays
    # both wrappings, in `pipeline._first_definite_finding` (before any sandbox run) and
    # in the fallback pipeline builds for a report the guard itself blocked (after a
    # repair reintroduces the import — see `pipeline._guard_blocked_context`). Verified
    # absent from the production sandbox image (`majorana-runner:nbide-local`) 2026-09-23,
    # alongside qiskit 2.5.2, qiskit_aer, numpy, scipy, sympy, networkx, matplotlib,
    # pennylane and cirq, which ARE present.
    (
        re.compile(r"qiskit_nature"),
        "`qiskit_nature` is not installed in this sandbox — no import of it will ever run. "
        "Write the molecular Hamiltonian by hand as a `SparsePauliOp` with published "
        "coefficients instead (for H2 at 0.735 Å in STO-3G after parity mapping with "
        "two-qubit reduction, use the standard 2-qubit Hamiltonian and cite where the "
        "coefficients come from; see the framework facts above). Never re-import "
        "`qiskit_nature` in the fix — that fails the whole notebook again with nothing run.",
    ),
    (
        re.compile(r"qiskit_algorithms"),
        "`qiskit_algorithms` is not installed in this sandbox. Do not import `VQE`, `QAOA` "
        "or any other algorithm object from it. Write the optimisation loop directly: "
        "`StatevectorEstimator` for the expectation value and `scipy.optimize.minimize` to "
        "drive the parameters (see the framework facts above for the exact calls).",
    ),
    (
        re.compile(r"qiskit_ibm_runtime"),
        "`qiskit_ibm_runtime` is not installed in this sandbox — a cell that imports it "
        "cannot run at all. A cell that genuinely needs real hardware is marked "
        "`execute=false` and explained in prose (Leona's own hardware submission path), "
        "never imported and run here. If the point of the cell is to demonstrate the "
        "circuit, run it locally with `StatevectorSampler` or `AerSimulator` instead.",
    ),
    (
        re.compile(r"pyscf"),
        "`pyscf` is not installed in this sandbox. Do not run a classical quantum-chemistry "
        "calculation to derive a Hamiltonian at request time; write the qubit Hamiltonian "
        "as a `SparsePauliOp` with published coefficients and cite the source (see the "
        "framework facts above for the H2/STO-3G example).",
    ),
)


def hints_for(error_name: str, error_value: str) -> tuple[str, ...]:
    """Every hint whose pattern matches this error, in table order."""
    text = f"{error_name}: {error_value}"
    return tuple(hint for pattern, hint in _HINTS if pattern.search(text))


__all__ = ["hints_for"]
