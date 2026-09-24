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
)


def hints_for(error_name: str, error_value: str) -> tuple[str, ...]:
    """Every hint whose pattern matches this error, in table order."""
    text = f"{error_name}: {error_value}"
    return tuple(hint for pattern, hint in _HINTS if pattern.search(text))


__all__ = ["hints_for"]
