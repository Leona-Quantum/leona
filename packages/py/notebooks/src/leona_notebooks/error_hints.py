"""What a Qiskit error message usually means, for the repair prompt and the reader.

Every entry was reproduced on qiskit 2.5.2 (the sandbox image pins 2.5.0, the same API)
before it was written here, with the message copied from the exception rather than
remembered — the entries added 2026-09-23 on 2026-09-23, the `c_if`/`QFTGate`/InstructionSet
entries added 2026-09-24 on 2026-09-24, in this worktree (`uv run python -c ...`; see each
entry's own comment where the probe found something a single exception message could not
carry, such as the `if_test`-then-`StatevectorSampler` trap). An entry that is not true of
the pinned version sends the repair model after the wrong cause, which is worse than no hint
at all, so an entry changes only with a new probe.

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
        "Sampler results are read by classical register NAME, not by a fixed field. "
        '`measure_all()` creates a register literally called "meas" (`.data.meas.get_counts()`). '
        "A circuit built as `QuantumCircuit(n, m)` and measured with plain `.measure(...)` gets "
        'the DEFAULT register instead — verified on qiskit 2.5.2: its name is "c" '
        "(`.data.c.get_counts()`), whether or not `.measure(...)` is even called explicitly. "
        "Do not guess the name from the circuit's SHAPE; read it off `qc.cregs[0].name` if "
        "unsure, or switch to `measure_all()` if a `meas`-named field is what the rest of the "
        "cell expects.",
    ),
    (
        re.compile(r"'InstructionSet' object has no attribute"),
        "A circuit method that APPENDS a gate — `.h(...)`, `.x(...)`, `.measure(...)`, and "
        "every other gate call — returns an `InstructionSet`, not the circuit. Verified public "
        "API of `InstructionSet` on qiskit 2.5.2 (`dir(InstructionSet)`): only `add`, `cargs`, "
        "`instructions`, `inverse` and `qargs` — no `.num_qubits`, `.qubits`, `.clbits`, "
        "`.c_if`, `.compose`, `.draw`, or any other circuit method or attribute. Chaining "
        "anything else onto a gate call's return value, or passing that return value into a "
        "function expecting a circuit (`.compose(...)`, `Statevector.evolve(...)`, "
        "`Operator(...)`), raises this. Build the circuit first (`qc = QuantumCircuit(1)`), "
        "call the gate on its own line (`qc.h(0)`), then use `qc` — never the gate call's "
        "own return value — everywhere after.",
    ),
    (
        re.compile(r"has no attribute 'c_if'|StatevectorSampler cannot handle ControlFlowOp"),
        "`.c_if(clbit, value)` was removed from `InstructionSet` in Qiskit 2 — verified: "
        "`AttributeError: 'InstructionSet' object has no attribute 'c_if'` on qiskit 2.5.2. "
        "The replacement is a context manager: `with qc.if_test((clbit, value)): qc.x(target)` "
        "(a bare `int` clbit index works, exactly like the old `.c_if(index, value)` did). "
        "But a circuit that uses `if_test` cannot run on `StatevectorSampler` — verified: "
        "`QiskitError: StatevectorSampler cannot handle ControlFlowOp`. Run it with "
        "`AerSimulator` instead: `from qiskit_aer import AerSimulator; "
        "AerSimulator().run(qc, shots=...).result().get_counts()` — verified to run the same "
        "circuit and return counts. Swapping `.c_if` for `if_test` while still calling "
        "`StatevectorSampler` only trades one failure for the next one.",
    ),
    (
        re.compile(r"QFTGate\.__init__\(\) got an unexpected keyword argument"),
        "`QFTGate.__init__` takes only `num_qubits` on qiskit 2.5.2 (verified: "
        "`inspect.signature(QFTGate.__init__)` is `(self, num_qubits: int)`). For the inverse "
        "QFT, build it and invert: `QFTGate(n).inverse()` — verified exactly the adjoint of "
        "`QFTGate(n)` (bit-for-bit, not just equal up to global phase, checked for n = 2 and "
        "3). `do_swaps`, `approximation_degree` and `inverse` belonged to the OLD "
        "`qiskit.circuit.library.QFT` class, which still imports in 2.5.2 but is deprecated "
        "(since 2.1, removed in 3.0) and prints a `DeprecationWarning` on every use — prefer "
        "`QFTGate`.",
    ),
    (
        re.compile(
            r"(?:\bQFT\b|controlled[- ]phase angles|final SWAP layer|swap block|"
            r"swap layer).{0,120}(?:match|equal|differ|Check)|"
            r"(?:match|equal|differ|Check).{0,120}(?:\bQFT\b|controlled[- ]phase angles|"
            r"final SWAP layer|swap block|swap layer)"
        ),
        "A hand-built QFT meant to equal `QFTGate` must match it EXACTLY, not just be "
        '"a textbook QFT". Verified on qiskit 2.5.2 by comparing `Operator`s bit-for-bit '
        "(not just up to global phase) for n = 1..4: `QFTGate(n)` processes qubits from "
        "n-1 DOWN to 0 — `for j in reversed(range(n)): qc.h(j)`, then for `k` from `j-1` down "
        "to `0`, `qc.cp(pi / 2**(j - k), j, k)` — and it ALWAYS appends a final swap layer, "
        "`for i in range(n // 2): qc.swap(i, n - 1 - i)`; `QFTGate.__init__` has no keyword to "
        "turn the swaps off. A loop that starts from qubit 0 and works upward (the common "
        '"textbook" order), or that skips the final swaps, produces a circuit that is NOT '
        "equal to `QFTGate`, even up to global phase — verified by direct comparison. If the "
        "cell does not need to teach the gate-by-gate construction, build the check from "
        "`QFTGate(n)` itself (`qc.append(QFTGate(n), range(n))`) instead of re-deriving the "
        "sequence by hand.",
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
        "Write the molecular Hamiltonian by hand as a `SparsePauliOp` and say in markdown how "
        "it was obtained (molecule, bond length, basis, qubit mapping), never crediting a "
        "paper you were not given. For H2 at 0.735 Å in STO-3G after parity mapping with "
        'two-qubit reduction: `SparsePauliOp(["II", "IZ", "ZI", "ZZ", "XX"], '
        "[-1.052373245772859, 0.39793742484318045, -0.39793742484318045, "
        "-0.01128010425623538, 0.18093119978423156])`; its lowest eigenvalue is the "
        "ELECTRONIC energy (≈ -1.8573 Ha), and adding nuclear repulsion (≈ 0.7200 Ha) gives "
        "the total ≈ -1.1373 Ha. Say which one a cell prints. Never re-import "
        "`qiskit_nature` in the fix — that fails the whole notebook again with nothing run.",
    ),
    (
        re.compile(r"qiskit_algorithms"),
        "`qiskit_algorithms` is not installed in this sandbox. Do not import `VQE`, `QAOA` "
        "or any other algorithm object from it. Write the optimisation loop directly: "
        "`StatevectorEstimator` for the expectation value and `scipy.optimize.minimize` to "
        "drive the parameters: `cost = lambda p: est.run([(ansatz, H, p)]).result()[0].data.evs` "
        'and `scipy.optimize.minimize(cost, x0, method="COBYLA", options={"maxiter": 100})`. '
        "Keep the loop small (few parameters, capped iterations): the whole notebook must run "
        "within 120 seconds.",
    ),
    (
        re.compile(r"qiskit_ibm_runtime"),
        "`qiskit_ibm_runtime` is not installed in this sandbox — a cell that imports it "
        "cannot run at all. To run a circuit on real hardware, call "
        "`leona_submit(circuit, shots=1024)` in an ordinary cell: it records the request and "
        "the reader runs it from the notebook page, priced and confirmed. To demonstrate the "
        "circuit here, run it with `StatevectorSampler` or `AerSimulator`.",
    ),
    (
        re.compile(r"pyscf"),
        "`pyscf` is not installed in this sandbox. Do not run a classical quantum-chemistry "
        "calculation to derive a Hamiltonian at request time; write the qubit Hamiltonian "
        "as a `SparsePauliOp` and say in markdown how it was obtained (molecule, bond "
        "length, basis, qubit mapping), never crediting a paper you were not given.",
    ),
    # Probed on qiskit 2.5.2 / majorana_sandbox.guard, 2026-09-24:
    # `print(__import__("qiskit").__version__)` -> denied_token:__import__,
    # denied_call:__import__; `import qiskit; print(qiskit.__version__)` passes the guard.
    (
        re.compile(r"__import__"),
        "The sandbox's safety guard refuses `__import__(...)` anywhere in a cell, even just to "
        "print a version, and a refused cell stops the whole notebook before anything runs. "
        "Import normally and read the attribute: `import qiskit` then `qiskit.__version__`.",
    ),
    # Probed: measuring a qubit and then applying a gate to the same qubit makes
    # StatevectorSampler raise "cannot handle mid-circuit measurements"; AerSimulator runs it.
    (
        re.compile(r"StatevectorSampler cannot handle mid-circuit measurements"),
        "`StatevectorSampler` cannot run a circuit that uses a qubit again after measuring it. "
        "Run that circuit on the Aer simulator, which is installed: "
        "`from qiskit_aer import AerSimulator` then "
        "`AerSimulator().run(qc, shots=1024).result().get_counts()`.",
    ),
    # Probed: a circuit with `with qc.if_test((clbit, 1)):` makes StatevectorSampler raise
    # "cannot handle ControlFlowOp"; AerSimulator runs it and returns counts.
    (
        re.compile(r"StatevectorSampler cannot handle ControlFlowOp"),
        "`StatevectorSampler` cannot run classical control (`if_test`, `while_loop`). Keep the "
        "`with qc.if_test((clbit, 1)):` block and run the circuit on the Aer simulator instead: "
        "`from qiskit_aer import AerSimulator` then "
        "`AerSimulator().run(qc, shots=1024).result().get_counts()`.",
    ),
)


def hints_for(error_name: str, error_value: str) -> tuple[str, ...]:
    """Every hint whose pattern matches this error, in table order."""
    text = f"{error_name}: {error_value}"
    return tuple(hint for pattern, hint in _HINTS if pattern.search(text))


__all__ = ["hints_for"]
