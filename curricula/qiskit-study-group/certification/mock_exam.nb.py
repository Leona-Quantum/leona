# ---
# slug: certification-mock-exam
# title: Certification Mock Exam
# kind: quiz
# summary: A 45-minute, 25-question timed mock exam across the same eight certification areas,
#   with a separate answer key.
# audience:
#   level: engineer
#   assumes: []
#   not_assumed: []
# style:
#   analogies: true
#   analogy_domains: []
#   tone: plain
#   math_level: minimal
#   visualizations: true
#   code_comments: light
#   language: en
# framework:
#   name: qiskit
#   version: '>=2.5,<2.6'
#   execution: local-statevector
# objectives:
# - Answer 25 original questions across all eight certification areas within a 45-minute limit
# - Practice committing to an answer under time pressure, the way the real exam works
# - Self-score against ANSWER_KEY.md and identify which areas need another pass
# prerequisites:
# - practice_questions.ipynb attempted
# duration_minutes: 45
# ---

# %% [markdown] role=objective
# ## What this is
# A 45-minute timed mock exam: 25 original questions across the same eight areas as
# `practice_questions.ipynb` — circuit construction, visualization, transpilation,
# primitives, V2 result objects, observables, OpenQASM 3, and debugging.
#
# **Time limit: 45 minutes.** Set a timer before you start. Answer every question you can
# in that window before you look at a single answer cell; a real exam does not pause for
# you to check your work question by question. This track is original work, not
# affiliated with or endorsed by IBM, and no question here is copied from IBM's exam or
# from any exam dump.

# %% [markdown] role=note
# ## Rules for a real mock
# Start a 45-minute timer, then work straight through — write down a letter (or a
# predicted printout) for every question before you run its answer cell. Do not stop to
# re-read a week's lab mid-exam; note the area and come back to it afterward. When the
# timer ends (or you finish, whichever comes first), score yourself against
# `ANSWER_KEY.md` in one pass, not question by question as you went.
#
# Each answer cell runs the exact snippet from its question and asserts the stated
# answer, the same checked form `practice_questions.ipynb` uses.

# %% role=setup
import qiskit

print("qiskit version:", qiskit.__version__)

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit import ClassicalRegister, Parameter, QuantumRegister
from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.quantum_info import SparsePauliOp
from qiskit.transpiler import generate_preset_pass_manager
from qiskit.visualization import plot_histogram

# %% [markdown] role=note
# ## Circuit construction (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`3 3`","`0 3`","raises `TypeError`","`3 0`"],"correct":3}
# ### Question 1 — Area: Circuit construction
#
# ```python
# qc = QuantumCircuit(3)
# print(qc.num_qubits, qc.num_clbits)
# ```
# What does this print?
#
# A) `3 3`
# B) `0 3`
# C) raises `TypeError`
# D) `3 0`

# %% role=answer
qc = QuantumCircuit(3)
print(qc.num_qubits, qc.num_clbits)
assert (qc.num_qubits, qc.num_clbits) == (3, 0)
print("Correct answer: D) 3 0")

# %% [markdown] role=question answer={"kind":"choice","options":["`{\"00\": 1000}`","`{\"10\": 1000}`","`{\"01\": 1000}`","`{\"11\": 1000}`"],"correct":1}
# ### Question 2 — Area: Circuit construction
#
# ```python
# qc = QuantumCircuit(2)
# qc.x(1)
# qc.cx(0, 1)
# qc.measure_all()
# ```
# Sample this 1000 times with `StatevectorSampler(seed=1)`. What are the counts?
#
# A) `{"00": 1000}`
# B) `{"10": 1000}`
# C) `{"01": 1000}`
# D) `{"11": 1000}`

# %% role=answer
qc = QuantumCircuit(2)
qc.x(1)
qc.cx(0, 1)
qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
print(counts)
assert counts == {"10": 1000}
print("Correct answer: B) {'10': 1000}")

# %% [markdown] role=question answer={"kind":"choice","options":["Yes — `qc.parameters` is empty afterward too","No — `assign_parameters` returns a new circuit; `qc` still has its unbound `Parameter` unless you pass `inplace=True`","It depends on whether `theta` appears once or more than once in the circuit","`assign_parameters` has no `inplace` option at all"],"correct":1}
# ### Question 3 — Area: Circuit construction
#
# ```python
# theta = Parameter("theta")
# qc = QuantumCircuit(1)
# qc.ry(theta, 0)
# bound = qc.assign_parameters({theta: 1.0})
# ```
# Does `bound = qc.assign_parameters(...)` mutate `qc` in place by default?
#
# A) Yes — `qc.parameters` is empty afterward too
# B) No — `assign_parameters` returns a new circuit; `qc` still has its unbound `Parameter` unless you pass `inplace=True`
# C) It depends on whether `theta` appears once or more than once in the circuit
# D) `assign_parameters` has no `inplace` option at all

# %% role=answer
theta = Parameter("theta")
qc = QuantumCircuit(1)
qc.ry(theta, 0)
bound = qc.assign_parameters({theta: 1.0})
assert list(qc.parameters) == [theta]
assert list(bound.parameters) == []
print("Correct answer: B) assign_parameters returns a new circuit by default; qc is unchanged")

# %% [markdown] role=note
# ## Visualization (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`from qiskit.tools.visualization import plot_histogram`","`from qiskit import plot_histogram`","`from qiskit.result import plot_histogram`","`from qiskit.visualization import plot_histogram`"],"correct":3}
# ### Question 4 — Area: Visualization
#
# Which import gives you `plot_histogram` in Qiskit 2.5?
#
# A) `from qiskit.tools.visualization import plot_histogram`
# B) `from qiskit import plot_histogram`
# C) `from qiskit.result import plot_histogram`
# D) `from qiskit.visualization import plot_histogram`

# %% role=answer
from qiskit.visualization import plot_histogram as ph
assert callable(ph)
print("Correct answer: D) from qiskit.visualization import plot_histogram")

# %% [markdown] role=question answer={"kind":"choice","options":["numpy and scipy","matplotlib only","matplotlib and pylatexenc","pillow and matplotlib"],"correct":2}
# ### Question 5 — Area: Visualization
#
# `qc.draw("text")` needs nothing beyond qiskit itself. What two extra packages does `qc.draw("mpl")` need that `"text"` does not?
#
# A) numpy and scipy
# B) matplotlib only
# C) matplotlib and pylatexenc
# D) pillow and matplotlib

# %% role=answer
import importlib

matplotlib_ok = importlib.util.find_spec("matplotlib") is not None
pylatexenc_ok = importlib.util.find_spec("pylatexenc") is not None
print("matplotlib available:", matplotlib_ok, "| pylatexenc available:", pylatexenc_ok)
assert matplotlib_ok and pylatexenc_ok
print("Correct answer: C) matplotlib and pylatexenc")

# %% [markdown] role=question answer={"kind":"choice","options":["The 3 most frequent outcomes as their own bars, plus every remaining outcome collapsed into one bar labeled `\"rest\"`","Only the 3 most frequent outcomes, each its own bar, nothing else","All 7 outcomes; `number_to_keep` only changes bar width","`ValueError`, because 3 is fewer than the number of distinct outcomes"],"correct":0}
# ### Question 6 — Area: Visualization
#
# ```python
# counts = {"000": 50, "001": 30, "010": 10, "011": 5, "100": 3, "101": 1, "110": 1}
# fig = plot_histogram(counts, number_to_keep=3)
# ```
# What do the bars in `fig` show?
#
# A) The 3 most frequent outcomes as their own bars, plus every remaining outcome collapsed into one bar labeled `"rest"`
# B) Only the 3 most frequent outcomes, each its own bar, nothing else
# C) All 7 outcomes; `number_to_keep` only changes bar width
# D) `ValueError`, because 3 is fewer than the number of distinct outcomes

# %% role=answer
counts = {"000": 50, "001": 30, "010": 10, "011": 5, "100": 3, "101": 1, "110": 1}
fig = plot_histogram(counts, number_to_keep=3)
labels = [t.get_text() for t in fig.axes[0].get_xticklabels()]
print(labels)
assert labels == ["000", "001", "010", "rest"]
print('Correct answer: A) 3 named bars plus one "rest" bar for everything else')

# %% [markdown] role=note
# ## Transpilation (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["A list mapping each logical qubit index to the physical qubit it was placed on","The final gate count for each qubit","The backend's coupling map","The list of qubits left idle"],"correct":0}
# ### Question 7 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=5, seed=1)
# pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
# qc = QuantumCircuit(2)
# qc.h(0); qc.cx(0, 1); qc.measure_all()
# isa = pm.run(qc)
# placement = isa.layout.initial_index_layout()
# ```
# What does `placement` represent?
#
# A) A list mapping each logical qubit index to the physical qubit it was placed on
# B) The final gate count for each qubit
# C) The backend's coupling map
# D) The list of qubits left idle

# %% role=answer
backend = GenericBackendV2(num_qubits=5, seed=1)
pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
isa = pm.run(qc)
placement = isa.layout.initial_index_layout()
print(placement)
assert len(placement) >= qc.num_qubits
assert all(isinstance(p, int) for p in placement[: qc.num_qubits])
print("Correct answer: A) a list mapping each logical qubit index to its physical qubit")

# %% [markdown] role=question answer={"kind":"choice","options":["It raises `ValueError: Invalid optimization level 4`","It runs; levels above 3 are silently clamped to 3","It raises `TypeError` — `optimization_level` must be a string","It runs at the backend's own default, ignoring the 4"],"correct":0}
# ### Question 8 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=5, seed=1)
# generate_preset_pass_manager(optimization_level=4, backend=backend)
# ```
# What happens?
#
# A) It raises `ValueError: Invalid optimization level 4`
# B) It runs; levels above 3 are silently clamped to 3
# C) It raises `TypeError` — `optimization_level` must be a string
# D) It runs at the backend's own default, ignoring the 4

# %% role=answer
backend = GenericBackendV2(num_qubits=5, seed=1)
try:
    generate_preset_pass_manager(optimization_level=4, backend=backend)
    raised = None
except ValueError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None and "4" in raised
print("Correct answer: A) ValueError: Invalid optimization level 4")

# %% [markdown] role=question answer={"kind":"choice","options":["`isa_again` comes out with the same operation counts as `isa` — an already-compatible circuit passes through unchanged in substance","It raises — a pass manager refuses a circuit that's already transpiled","Every gate gets translated a second time, roughly doubling the gate count","The coupling-map constraint is dropped the second time"],"correct":0}
# ### Question 9 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=5, seed=1)
# pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
# qc = QuantumCircuit(2)
# qc.h(0); qc.cx(0, 1); qc.measure_all()
# isa = pm.run(qc)
# isa_again = pm.run(isa)
# ```
# `isa` is already a valid ISA circuit for this backend. What happens when you run it through the same pass manager a second time?
#
# A) `isa_again` comes out with the same operation counts as `isa` — an already-compatible circuit passes through unchanged in substance
# B) It raises — a pass manager refuses a circuit that's already transpiled
# C) Every gate gets translated a second time, roughly doubling the gate count
# D) The coupling-map constraint is dropped the second time

# %% role=answer
backend = GenericBackendV2(num_qubits=5, seed=1)
pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
isa = pm.run(qc)
isa_again = pm.run(isa)
print(isa.count_ops(), isa_again.count_ops())
assert isa.count_ops() == isa_again.count_ops()
print("Correct answer: A) the same operation counts come out both times")

# %% [markdown] role=note
# ## Primitives (PUBs) (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`None` — an exact statevector expectation value, no simulated shot noise","`0.0`","`0.01`","It's required; omitting it raises `TypeError`"],"correct":0}
# ### Question 10 — Area: Primitives (PUBs)
#
# ```python
# result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"))]).result()
# ```
# What is the default value of `precision` when you call `.run()` without passing it?
#
# A) `None` — an exact statevector expectation value, no simulated shot noise
# B) `0.0`
# C) `0.01`
# D) It's required; omitting it raises `TypeError`

# %% role=answer
import inspect
default_precision = inspect.signature(StatevectorEstimator.run).parameters["precision"].default
print("default precision:", default_precision)
assert default_precision is None
print("Correct answer: A) None — exact, no simulated shot noise")

# %% [markdown] role=question answer={"kind":"choice","options":["`tolerance`","`shots`, same as Sampler","`precision`, a keyword-only argument to `.run()`","There is no such knob; Estimator is always exact"],"correct":2}
# ### Question 11 — Area: Primitives (PUBs)
#
# Sampler PUBs can carry a per-PUB `shots` override. Estimator PUBs have no `shots` field at all. What's Estimator's equivalent knob for simulated precision?
#
# A) `tolerance`
# B) `shots`, same as Sampler
# C) `precision`, a keyword-only argument to `.run()`
# D) There is no such knob; Estimator is always exact

# %% role=answer
import inspect
sig = inspect.signature(StatevectorEstimator.run)
assert "precision" in sig.parameters
assert "shots" not in sig.parameters
print("Correct answer: C) precision")

# %% [markdown] role=question answer={"kind":"choice","options":["It works exactly like `sampler.run([qc], shots=100)`","It silently runs 0 shots","It raises `TypeError: unhashable type`","It raises `ValueError`, with a message suggesting you wrap the circuit in `[]`"],"correct":3}
# ### Question 12 — Area: Primitives (PUBs)
#
# ```python
# sampler = StatevectorSampler(seed=1)
# sampler.run(qc, shots=100)
# ```
# `qc` was passed directly, not wrapped in a list. What happens?
#
# A) It works exactly like `sampler.run([qc], shots=100)`
# B) It silently runs 0 shots
# C) It raises `TypeError: unhashable type`
# D) It raises `ValueError`, with a message suggesting you wrap the circuit in `[]`

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
sampler = StatevectorSampler(seed=1)
try:
    sampler.run(qc, shots=100)
    raised = None
except ValueError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None and "[" in raised
print("Correct answer: D) ValueError suggesting you wrap the circuit in []")

# %% [markdown] role=note
# ## V2 result objects (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["1","200","3","600"],"correct":2}
# ### Question 13 — Area: V2 result objects
#
# ```python
# result = StatevectorSampler(seed=1).run([qc1, qc2, qc3], shots=200).result()
# ```
# What is `len(result)`?
#
# A) 1
# B) 200
# C) 3
# D) 600

# %% role=answer
def make():
    c = QuantumCircuit(1)
    c.h(0)
    c.measure_all()
    return c

qc1, qc2, qc3 = make(), make(), make()
result = StatevectorSampler(seed=1).run([qc1, qc2, qc3], shots=200).result()
print("len:", len(result))
assert len(result) == 3
print("Correct answer: C) 3")

# %% [markdown] role=question answer={"kind":"choice","options":["`\"num_shots\"`","`\"count\"`","`\"shots\"`","It isn't in `metadata` at all — you have to `sum()` the counts yourself"],"correct":2}
# ### Question 14 — Area: V2 result objects
#
# ```python
# result = StatevectorSampler(seed=1).run([qc], shots=200).result()
# print(result[0].metadata)
# ```
# Which key in `result[0].metadata` tells you how many shots that PUB actually ran?
#
# A) `"num_shots"`
# B) `"count"`
# C) `"shots"`
# D) It isn't in `metadata` at all — you have to `sum()` the counts yourself

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
result = StatevectorSampler(seed=1).run([qc], shots=200).result()
print(result[0].metadata)
assert result[0].metadata["shots"] == 200
print('Correct answer: C) "shots"')

# %% [markdown] role=question answer={"kind":"choice","options":["`result[0].data.meas.get_counts()` — `measure()` always names the register `meas`","`result[0].data.b.get_counts()` — each register's results live under its own name on `.data`","`result[0].data.get_counts(\"b\")`","They're unavailable separately; only a combined 2-bit string is readable"],"correct":1}
# ### Question 15 — Area: V2 result objects
#
# ```python
# qr = QuantumRegister(2, "q")
# cr_a = ClassicalRegister(1, "a")
# cr_b = ClassicalRegister(1, "b")
# qc = QuantumCircuit(qr, cr_a, cr_b)
# qc.h(0)
# qc.cx(0, 1)
# qc.measure(0, cr_a[0])
# qc.measure(1, cr_b[0])
# ```
# This circuit has two separate one-bit classical registers. After sampling, how do you read qubit 1's outcomes?
#
# A) `result[0].data.meas.get_counts()` — `measure()` always names the register `meas`
# B) `result[0].data.b.get_counts()` — each register's results live under its own name on `.data`
# C) `result[0].data.get_counts("b")`
# D) They're unavailable separately; only a combined 2-bit string is readable

# %% role=answer
qr = QuantumRegister(2, "q")
cr_a = ClassicalRegister(1, "a")
cr_b = ClassicalRegister(1, "b")
qc = QuantumCircuit(qr, cr_a, cr_b)
qc.h(0)
qc.cx(0, 1)
qc.measure(0, cr_a[0])
qc.measure(1, cr_b[0])
result = StatevectorSampler(seed=1).run([qc], shots=200).result()
b_counts = result[0].data.b.get_counts()
print("b counts:", b_counts)
assert sum(b_counts.values()) == 200
print("Correct answer: B) result[0].data.b.get_counts()")

# %% [markdown] role=note
# ## Observables (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`1`","`2`","`4`","It raises — scalar multiplication isn't supported"],"correct":1}
# ### Question 16 — Area: Observables
#
# ```python
# op = 2 * SparsePauliOp("X")
# ```
# What is the resulting coefficient?
#
# A) `1`
# B) `2`
# C) `4`
# D) It raises — scalar multiplication isn't supported

# %% role=answer
op = 2 * SparsePauliOp("X")
print(op)
assert op.coeffs[0] == 2
print("Correct answer: B) 2")

# %% [markdown] role=question answer={"kind":"choice","options":["It raises `QiskitError` — an invalid Pauli string label","It's silently treated as `I`","It silently creates a zero operator","It raises `TypeError`"],"correct":0}
# ### Question 17 — Area: Observables
#
# ```python
# SparsePauliOp("A")
# ```
# `A` is not one of `I`, `X`, `Y`, `Z`. What happens?
#
# A) It raises `QiskitError` — an invalid Pauli string label
# B) It's silently treated as `I`
# C) It silently creates a zero operator
# D) It raises `TypeError`

# %% role=answer
from qiskit.exceptions import QiskitError

try:
    SparsePauliOp("A")
    raised = None
except QiskitError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None
print("Correct answer: A) QiskitError — invalid Pauli string label")

# %% [markdown] role=question answer={"kind":"choice","options":["`['IZI', 'IIX']` — the original two qubits keep their positions; the new qubit is padded with `I`","`['ZII', 'IXI']`","It raises — `num_qubits` must equal the operator's current width when `layout` is `None`","`['ZI', 'IX', 'III']` — a third all-identity term is appended"],"correct":0}
# ### Question 18 — Area: Observables
#
# ```python
# op = SparsePauliOp(["ZI", "IX"])  # 2-qubit operator
# widened = op.apply_layout(None, num_qubits=3)
# print(widened.paulis)
# ```
# `layout=None` means "no permutation," just widen up to `num_qubits`. What does this print?
#
# A) `['IZI', 'IIX']` — the original two qubits keep their positions; the new qubit is padded with `I`
# B) `['ZII', 'IXI']`
# C) It raises — `num_qubits` must equal the operator's current width when `layout` is `None`
# D) `['ZI', 'IX', 'III']` — a third all-identity term is appended

# %% role=answer
op = SparsePauliOp(["ZI", "IX"])
widened = op.apply_layout(None, num_qubits=3)
labels = list(widened.paulis.to_labels())
print(labels)
assert labels == ["IZI", "IIX"]
print("Correct answer: A) ['IZI', 'IIX']")

# %% [markdown] role=note
# ## OpenQASM 3 (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`creg meas[2];`","`classical meas: bit[2];`","`bit[2] meas;`","There is no such line — OpenQASM 3 has no classical bit type"],"correct":2}
# ### Question 19 — Area: OpenQASM 3
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# qc.measure_all()
# text = qasm3.dumps(qc)
# ```
# Which line in `text` declares the classical results container?
#
# A) `creg meas[2];`
# B) `classical meas: bit[2];`
# C) `bit[2] meas;`
# D) There is no such line — OpenQASM 3 has no classical bit type

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
text = qasm3.dumps(qc)
print(text)
assert "bit[2] meas;" in text
print("Correct answer: C) bit[2] meas;")

# %% [markdown] role=question answer={"kind":"choice","options":["Yes — dumping raises unless every gate is in a hardware basis","No, but the angle gets silently rounded to the nearest basis rotation","No — OpenQASM 3 can represent arbitrary gates like `ry` directly; no transpilation is required to export it","Only single-qubit gates can be dumped without transpiling first"],"correct":2}
# ### Question 20 — Area: OpenQASM 3
#
# ```python
# theta = Parameter("theta")
# qc = QuantumCircuit(1)
# qc.ry(theta, 0)
# qc.measure_all()
# bound = qc.assign_parameters({theta: 0.7})
# text = qasm3.dumps(bound)
# ```
# `ry` is not in `GenericBackendV2`'s basis (`cx, id, rz, sx, x`). Does `qasm3.dumps` require the circuit to be transpiled to some fixed basis first?
#
# A) Yes — dumping raises unless every gate is in a hardware basis
# B) No, but the angle gets silently rounded to the nearest basis rotation
# C) No — OpenQASM 3 can represent arbitrary gates like `ry` directly; no transpilation is required to export it
# D) Only single-qubit gates can be dumped without transpiling first

# %% role=answer
theta = Parameter("theta")
qc = QuantumCircuit(1)
qc.ry(theta, 0)
qc.measure_all()
bound = qc.assign_parameters({theta: 0.7})
text = qasm3.dumps(bound)
print(text)
assert "ry(0.7)" in text
print("Correct answer: C) no transpilation is required to export it")

# %% [markdown] role=question answer={"kind":"choice","options":["It returns an empty `QuantumCircuit`","It silently returns `None`","It raises a parsing error","It prints a `UserWarning` and continues"],"correct":2}
# ### Question 21 — Area: OpenQASM 3
#
# ```python
# qasm3.loads("this is not qasm3")
# ```
# What happens?
#
# A) It returns an empty `QuantumCircuit`
# B) It silently returns `None`
# C) It raises a parsing error
# D) It prints a `UserWarning` and continues

# %% role=answer
try:
    qasm3.loads("this is not qasm3")
    raised = None
except Exception as exc:
    raised = type(exc).__name__
print("raised:", raised)
assert raised is not None and "Pars" in raised
print("Correct answer: C) it raises a parsing error")

# %% [markdown] role=note
# ## Debugging (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["It runs, and the extra qubit is silently dropped","It raises `TranspilerError` — the circuit needs more qubits than the device has","It raises `IndexError` at the `h(0)` line, before transpilation even starts","It runs, and Qiskit automatically resizes the backend to 6 qubits"],"correct":1}
# ### Question 22 — Area: Debugging
#
# ```python
# backend = GenericBackendV2(num_qubits=5, seed=1)
# pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
# qc = QuantumCircuit(6)
# qc.h(0)
# pm.run(qc)
# ```
# `qc` uses 6 qubits; `backend` only has 5. What happens?
#
# A) It runs, and the extra qubit is silently dropped
# B) It raises `TranspilerError` — the circuit needs more qubits than the device has
# C) It raises `IndexError` at the `h(0)` line, before transpilation even starts
# D) It runs, and Qiskit automatically resizes the backend to 6 qubits

# %% role=answer
from qiskit.transpiler.exceptions import TranspilerError

backend = GenericBackendV2(num_qubits=5, seed=1)
pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
qc = QuantumCircuit(6)
qc.h(0)
try:
    pm.run(qc)
    raised = None
except TranspilerError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None
print("Correct answer: B) TranspilerError — not enough qubits on the device")

# %% [markdown] role=question answer={"kind":"choice","options":["`zeros` is `0` — `get_counts()` always includes every possible outcome, even at zero","`zeros` is `None`","`TypeError`, because dict keys must be looked up with `.get()`","`KeyError: '0'` — a `get_counts()` dict only has keys for outcomes that actually appeared; use `counts.get(\"0\", 0)` to read one safely"],"correct":3}
# ### Question 23 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(1)
# qc.x(0)
# qc.measure_all()
# counts = StatevectorSampler(seed=1).run([qc], shots=100).result()[0].data.meas.get_counts()
# print(counts)          # {"1": 100}
# zeros = counts["0"]
# ```
# What happens on the last line?
#
# A) `zeros` is `0` — `get_counts()` always includes every possible outcome, even at zero
# B) `zeros` is `None`
# C) `TypeError`, because dict keys must be looked up with `.get()`
# D) `KeyError: '0'` — a `get_counts()` dict only has keys for outcomes that actually appeared; use `counts.get("0", 0)` to read one safely

# %% role=answer
qc = QuantumCircuit(1)
qc.x(0)
qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=100).result()[0].data.meas.get_counts()
print(counts)
assert counts == {"1": 100}
try:
    counts["0"]
    raised = False
except KeyError:
    raised = True
assert raised
assert counts.get("0", 0) == 0
print('Correct answer: D) KeyError; counts.get("0", 0) is the safe read')

# %% [markdown] role=question answer={"kind":"choice","options":["The observable is truncated to `\"ZZ\"` and it runs","The circuit is silently padded to 3 qubits with an idle wire","It raises `ValueError` — the qubit counts of the circuit and the observable don't match","It runs and returns `evs` for whichever 2 of the 3 `Z`s happen to line up"],"correct":2}
# ### Question 24 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# StatevectorEstimator().run([(qc, SparsePauliOp("ZZZ"))]).result()
# ```
# `qc` has 2 qubits; the observable `"ZZZ"` has 3. What happens?
#
# A) The observable is truncated to `"ZZ"` and it runs
# B) The circuit is silently padded to 3 qubits with an idle wire
# C) It raises `ValueError` — the qubit counts of the circuit and the observable don't match
# D) It runs and returns `evs` for whichever 2 of the 3 `Z`s happen to line up

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
try:
    StatevectorEstimator().run([(qc, SparsePauliOp("ZZZ"))]).result()
    raised = None
except ValueError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None and "qubits" in raised
print("Correct answer: C) ValueError — qubit-count mismatch")

# %% [markdown] role=question answer={"kind":"choice","options":["It works — `Estimator` accepts `shots` as an alias for `precision`","It's silently ignored and the call runs with default precision","It raises `ValueError`, but still returns a (wrong) result","It raises `TypeError`: `run()` got an unexpected keyword argument `'shots'`"],"correct":3}
# ### Question 25 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# StatevectorEstimator().run([(qc, SparsePauliOp("ZZ"))], shots=1000)
# ```
# A learner used to `Sampler` passes `shots=` to an `Estimator.run()` call by habit. What happens?
#
# A) It works — `Estimator` accepts `shots` as an alias for `precision`
# B) It's silently ignored and the call runs with default precision
# C) It raises `ValueError`, but still returns a (wrong) result
# D) It raises `TypeError`: `run()` got an unexpected keyword argument `'shots'`

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
try:
    StatevectorEstimator().run([(qc, SparsePauliOp("ZZ"))], shots=1000)
    raised = None
except TypeError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None and "shots" in raised
print("Correct answer: D) TypeError: unexpected keyword argument 'shots'")

# %% [markdown] role=summary
# ## Scoring this mock exam
# Count how many of the 25 you got right against `ANSWER_KEY.md`, then group the misses by
# area using the "Area: ..." tag on each question. An area with more than one miss is
# worth another pass through that week's lab and `practice_questions.ipynb`'s matching
# section before you try a second mock attempt. This exam does not tell you whether you
# would pass IBM's actual certification — see the FAQ in the course `README.md` for what
# completing this course does and does not establish about that.
