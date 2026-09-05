# Certification track — answer key

The readable form of the answers checked in `practice_questions.ipynb` and
`mock_exam.ipynb`. Each answer cell in those notebooks runs the question's snippet (or
the closest runnable form of it) and asserts the same answer listed here. Question
numbers below match each notebook's own numbering, top to bottom.

This file used to claim it and the notebooks were "kept in sync by construction,
generated from one shared source of questions". **There is no such generator**, and the
claim went from true to false the first time the options were reordered — silently,
because a sentence asserting an invariant is not the invariant. What keeps them in sync
now is `scripts/check_answer_key.py`, which runs in CI and compares three copies of every
answer: the letter below, the notebook's `Correct answer:` line, and the machine-readable
`answer=` key the product grades with. Edit any one of them and the build fails until all
three agree.

## practice_questions.ipynb (32 questions)

### Circuit construction

1. **C** — A single integer argument to QuantumCircuit sets the qubit count only; no classical bits are created unless you ask for them.
2. **B** — x(0) flips qubit 0 to 1; cx(0, 1) then fires (control qubit 0 is 1) and flips qubit 1 to 1 as well, so both bits read 1 every shot.
3. **D** — the V1-era binder method was removed in Qiskit 2.x; `assign_parameters` is the way to bind values now, and by default it returns a new circuit rather than mutating in place.
4. **B** — inplace=True mutates the circuit that .compose() is called on and returns None instead of a new circuit — a common trap when a caller expects compose to always hand back a value.
5. **C** — The result's data groups outcomes by the classical register's own name; measure_all() happens to name its register 'meas', but a register you named yourself (here 'c') is read under that name instead.

### Visualization

6. **A** — qc.draw()'s first parameter is output, defaulting to None, which resolves to the same text drawer as draw("text").
7. **B** — plot_histogram builds and returns a matplotlib Figure — you display it (in a notebook, just by leaving it as the last expression) or save it with .savefig().
8. **D** — plot_histogram's sort parameter defaults to "asc", sorting bars by outcome label rather than by frequency or dict order.
9. **D** — The circuit-diagram convention (top wire = q_0) and the bitstring convention (rightmost character = q_0) are unrelated to each other; conflating them is a common source of confusion.

### Transpilation

10. **D** — The SDK's own default optimization_level is 2, even though this course's labs always pass optimization_level=1 explicitly for reproducibility — check the default before assuming a lab's choice is the library's.
11. **C** — GenericBackendV2's basis is cx, id, rz, sx, x, plus the delay, measure and reset instructions every backend supports regardless of basis_gates — h is never in the basis; it always gets rewritten.
12. **C** — Without an explicit coupling_map, GenericBackendV2 fills in a fully connected one (every directed pair among its qubits) — far more generous than any real device.
13. **A** — No three qubits on a line are mutually adjacent, so routing must insert at least one SWAP to bring the far qubit next to qubit 0; the exact count can depend on the seed, so 'always exactly 6' overclaims.

### Primitives (PUBs)

14. **D** — StatevectorSampler's own default_shots is 1024; pass shots= to sampler.run() to override it per call.
15. **A** — An Estimator PUB is (circuit, observable[, parameter_values]); the circuit alone is missing the observable Estimator needs.
16. **D** — A single PUB can sweep a whole array of parameter values in one call; the result carries one expectation value per bound point, with no need for 5 separate run() calls.
17. **D** — run() takes a list of PUBs and returns one PubResult per PUB, in the same order — indexed positionally, not by name.

### V2 result objects

18. **C** — PrimitiveResult is indexed like a list of PubResults, one per submitted PUB; .data lives on each PubResult.
19. **C** — get_counts() aggregates into frequencies; get_bitstrings() gives back the individual outcome for every one of the 1000 shots, in order.
20. **C** — A PUB's observable slot accepts a single observable or a list of them; a list of 2 produces 2 expectation values in one call.
21. **C** — StatevectorEstimator computes the exact expectation value from the statevector; with the default precision (None) there is no simulated shot noise, so stds reports 0.0.

### Observables

22. **C** — SparsePauliOp addition concatenates terms without combining matching labels; .simplify() is the step that merges them.
23. **B** — Z and X anticommute and their matrix product is iY, the standard Pauli algebra identity ZX = iY.
24. **B** — self.tensor(other) places self on the higher-indexed (leftmost-label) qubits and other on the lower-indexed ones — the same right-to-left reading a bitstring uses.
25. **C** — apply_layout re-expresses an observable defined on logical qubits so it's valid on the physical qubits the transpiler actually placed them on, permuting each label's characters to match.

### OpenQASM 3

26. **D** — OpenQASM 3 replaces QASM2's qreg/creg declarations with typed qubit[n] and bit[n] declarations.
27. **B** — dumps and loads are inverses of each other for a circuit built from ordinary gates and measurements.
28. **D** — qasm3 is a top-level submodule of qiskit; dumps/loads are its two everyday entry points.

### Debugging

29. **A** — Qiskit prints qubit 0 as the rightmost character of a bitstring; only that character is 1, matching the single x(0) call.
30. **A** — Forgetting measure_all() does not error at .run() time — it warns and returns an empty DataBin with no meas register; the failure only shows up the moment you try to read counts.
31. **A** — Estimator circuits must carry no measurements at all — a measure instruction is a classical-bit operation Estimator's statevector path refuses outright, rather than quietly ignoring it.
32. **B** — Qubit 2 was never touched by any gate, so it stays |0> and always reads 0 (the leftmost character) — a classic forgot-a-gate bug that a checkpoint on qubit 2 alone would have caught immediately.

## mock_exam.ipynb (25 questions)

### Circuit construction

1. **D** — A single integer argument sets only the qubit count; classical bits stay at 0 unless requested separately.
2. **B** — x(1) sets qubit 1 to 1; cx(0, 1) uses qubit 0 as control, and qubit 0 is still 0, so the CX never fires — qubit 1 stays 1 and qubit 0 stays 0, giving '10'.
3. **B** — assign_parameters's inplace argument defaults to False, so the original circuit keeps its unbound Parameter unless you opt into mutating it.

### Visualization

4. **D** — plot_histogram lives in qiskit.visualization alongside the other plotting helpers, such as plot_bloch_multivector.
5. **C** — The mpl circuit drawer renders gate labels through pylatexenc and draws with matplotlib; the text drawer needs neither.
6. **A** — number_to_keep caps the plot at its N most frequent outcomes and folds the remainder into a single 'rest' bar rather than dropping or hiding them.

### Transpilation

7. **A** — The layout stage decides, before routing even starts, which physical qubit each logical qubit lands on; initial_index_layout() reports that mapping.
8. **A** — optimization_level only accepts 0 through 3; anything outside that range is rejected immediately, not clamped.
9. **A** — Every instruction in isa is already in the backend's basis and already respects the coupling map, so re-running the pipeline finds nothing left to rewrite or route.

### Primitives (PUBs)

10. **A** — precision is keyword-only and defaults to None, which StatevectorEstimator treats as an exact statevector calculation.
11. **C** — Estimator trades shots for precision: a float controlling simulated statistical noise, passed as a keyword-only argument to run().
12. **D** — run() expects an iterable of PUBs; a bare circuit is not itself a valid pub-like, and the error message says so directly.

### V2 result objects

13. **C** — One PubResult comes back per submitted PUB, regardless of how many shots each one ran.
14. **C** — SamplerPubResult.metadata carries a 'shots' key alongside 'circuit_metadata', reporting exactly how many shots that PUB ran.
15. **B** — Each classical register you name yourself is readable under its own name on .data; there is no register named meas here at all, since measure() was called directly rather than measure_all().

### Observables

16. **B** — SparsePauliOp supports scalar multiplication directly; the coefficient scales, the label stays 'X'.
17. **A** — Every character in a Pauli label must be one of I, X, Y, Z; anything else fails validation immediately with a QiskitError.
18. **A** — With no permutation given, apply_layout keeps every original qubit exactly where it was and pads the new, higher-indexed qubits with identity.

### OpenQASM 3

19. **C** — OpenQASM 3's typed bit[n] declaration replaces QASM2's creg for a classical register.
20. **C** — qasm3.dumps exports whatever gates the circuit actually contains; the exported basis matches the circuit, not any particular backend's Target.
21. **C** — Malformed OpenQASM 3 text fails to parse and raises immediately rather than returning a placeholder circuit.

### Debugging

22. **B** — The layout stage cannot place a 6-qubit circuit's qubits onto a 5-qubit device, and fails immediately with a clear TranspilerError.
23. **D** — get_counts() only has keys for outcomes that actually appeared in the run; an outcome with zero shots is simply absent, not present with value 0.
24. **C** — Estimator checks that a circuit's qubit count matches every observable's qubit count and refuses to run when they disagree, rather than guessing an alignment.
25. **D** — Estimator's run() has no shots parameter at all — precision is the equivalent knob, and passing shots fails immediately as an unrecognized keyword.

