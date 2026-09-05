# ---
# slug: certification-practice-questions
# title: Certification Practice — API Recall and Debugging
# kind: quiz
# summary: 32 original multiple-choice and read-the-output questions across all eight certification
#   areas, each with a checked answer cell.
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
# - Recall Qiskit 2.5 API shapes for circuit construction, visualization, transpilation, primitives,
#   results, observables and OpenQASM 3 without looking them up
# - Read a short code snippet and predict its output or its error before running it
# - 'Recognize the debugging patterns this track drills: bit order, a missing measurement, an
#   Estimator given a circuit with measurements, and a KeyError from an unseen bitstring'
# prerequisites:
# - Weeks 00–08 of the study group completed
# duration_minutes: 60
# ---

# %% [markdown] role=objective
# ## What this is
# 32 original questions covering every API area this certification track drills: circuit
# construction, visualization, transpilation, primitives (PUBs), V2 result objects,
# observables, OpenQASM 3, and debugging. Every question here is original — none of them
# are copied from IBM's exam or from any exam dump — and this track is not affiliated with
# or endorsed by IBM.
#
# Complete weeks 00 through 08 of the study group before attempting this notebook.

# %% [markdown] role=note
# ## How to use this notebook
# Read a question and commit to an answer — a letter, or what you think a snippet prints
# — *before* you run the answer cell below it, the same predict-before-you-run habit from
# the weekly labs. Each answer cell runs the exact snippet from its question (or the
# closest runnable form of a conceptual question) and asserts something that would fail if
# the stated answer were wrong — it is a check, not just a printed claim.
#
# `ANSWER_KEY.md` in this directory lists the same 32 answers in one short, readable pass,
# with a one-line reason each. Use it to scan quickly; the answer cell in this notebook is
# the checked, authoritative form, and the two are kept consistent with each other.
#
# Each question names its area explicitly next to its number, for example
# "Area: Transpilation" — this matches the breakdown in `README.md`.

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
# ## Circuit construction (5 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`2 2`","`0 2`","`2 0`","raises `TypeError` — a classical-bit count is required"],"correct":2}
# ### Question 1 — Area: Circuit construction
#
# ```python
# qc = QuantumCircuit(2)
# print(qc.num_qubits, qc.num_clbits)
# ```
# What does this print?
#
# A) `2 2`
# B) `0 2`
# C) `2 0`
# D) raises `TypeError` — a classical-bit count is required

# %% role=answer
qc = QuantumCircuit(2)
print(qc.num_qubits, qc.num_clbits)
assert (qc.num_qubits, qc.num_clbits) == (2, 0)
print("Correct answer: C) 2 0")

# %% [markdown] role=question answer={"kind":"choice","options":["`{\"00\": 1000}`","`{\"11\": 1000}`","`{\"01\": 1000}`","`{\"10\": 1000}`"],"correct":1}
# ### Question 2 — Area: Circuit construction
#
# ```python
# qc = QuantumCircuit(2)
# qc.x(0)
# qc.cx(0, 1)
# qc.measure_all()
# ```
# Sample this circuit 1000 times with `StatevectorSampler(seed=1)`. What are the counts?
#
# A) `{"00": 1000}`
# B) `{"11": 1000}`
# C) `{"01": 1000}`
# D) `{"10": 1000}`

# %% role=answer
qc = QuantumCircuit(2)
qc.x(0)
qc.cx(0, 1)
qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
print(counts)
assert counts == {"11": 1000}
print("Correct answer: B) {'11': 1000}")

# %% [markdown] role=question answer={"kind":"choice","options":["`qc.bind({theta: 1.0})`","`qc.set_parameters({theta: 1.0})`","`qc.parameters.bind({theta: 1.0})`","`qc.assign_parameters({theta: 1.0})`"],"correct":3}
# ### Question 3 — Area: Circuit construction
#
# Which method actually binds a numeric value to a `Parameter` on a `QuantumCircuit` in Qiskit 2.5?
#
# A) `qc.bind({theta: 1.0})`
# B) `qc.set_parameters({theta: 1.0})`
# C) `qc.parameters.bind({theta: 1.0})`
# D) `qc.assign_parameters({theta: 1.0})`

# %% role=answer
theta = Parameter("theta")
qc = QuantumCircuit(1)
qc.ry(theta, 0)
bound = qc.assign_parameters({theta: 1.0})
assert list(bound.parameters) == []
assert list(qc.parameters) == [theta], "assign_parameters returns a new circuit; qc itself is unchanged"
print("Correct answer: D) qc.assign_parameters({theta: 1.0})")

# %% [markdown] role=question answer={"kind":"choice","options":["`d` is a new circuit with both `h` and `cx`; `a` is unchanged","`d` is `None`; `a` now contains both `h` and `cx`","`d` is `None`; `a` is unchanged, `b` gained the `h`","this raises `TypeError` — `compose` has no `inplace` argument"],"correct":1}
# ### Question 4 — Area: Circuit construction
#
# ```python
# a = QuantumCircuit(2)
# a.h(0)
# b = QuantumCircuit(2)
# b.cx(0, 1)
# d = a.compose(b, inplace=True)
# ```
# What is `d` bound to, and what has happened to `a`?
#
# A) `d` is a new circuit with both `h` and `cx`; `a` is unchanged
# B) `d` is `None`; `a` now contains both `h` and `cx`
# C) `d` is `None`; `a` is unchanged, `b` gained the `h`
# D) this raises `TypeError` — `compose` has no `inplace` argument

# %% role=answer
a = QuantumCircuit(2)
a.h(0)
b = QuantumCircuit(2)
b.cx(0, 1)
d = a.compose(b, inplace=True)
assert d is None
assert a.count_ops() == {"h": 1, "cx": 1}
print("Correct answer: B) d is None; a now contains both h and cx")

# %% [markdown] role=question answer={"kind":"choice","options":["`result[0].data.meas.get_counts()`","`result[0].data.get_counts()`","`result[0].data.c.get_counts()`","`result[0].c.get_counts()`"],"correct":2}
# ### Question 5 — Area: Circuit construction
#
# ```python
# qr = QuantumRegister(2, "q")
# cr = ClassicalRegister(2, "c")
# qc = QuantumCircuit(qr, cr)
# qc.h(0)
# qc.cx(0, 1)
# qc.measure(qr, cr)
# result = StatevectorSampler(seed=1).run([qc], shots=1000).result()
# ```
# Which attribute path reads the counts out of `result`?
#
# A) `result[0].data.meas.get_counts()`
# B) `result[0].data.get_counts()`
# C) `result[0].data.c.get_counts()`
# D) `result[0].c.get_counts()`

# %% role=answer
qr = QuantumRegister(2, "q")
cr = ClassicalRegister(2, "c")
qc = QuantumCircuit(qr, cr)
qc.h(0)
qc.cx(0, 1)
qc.measure(qr, cr)
result = StatevectorSampler(seed=1).run([qc], shots=1000).result()
counts = result[0].data.c.get_counts()
print(counts)
assert sum(counts.values()) == 1000
try:
    result[0].data.meas
    raised = False
except AttributeError:
    raised = True
assert raised, "there is no register named 'meas' here — only measure_all() creates one with that name"
print("Correct answer: C) result[0].data.c.get_counts()")

# %% [markdown] role=note
# ## Visualization (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["Yes — `output=None` falls back to the text drawer","No — `output=None` defaults to `\"mpl\"`","No — calling `qc.draw()` with no arguments raises `TypeError`","They differ only in whitespace"],"correct":0}
# ### Question 6 — Area: Visualization
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# default_drawing = qc.draw()
# text_drawing = qc.draw("text")
# ```
# Is `default_drawing` the same as `text_drawing`?
#
# A) Yes — `output=None` falls back to the text drawer
# B) No — `output=None` defaults to `"mpl"`
# C) No — calling `qc.draw()` with no arguments raises `TypeError`
# D) They differ only in whitespace

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
default_drawing = qc.draw()
text_drawing = qc.draw("text")
assert str(default_drawing) == str(text_drawing)
print("Correct answer: A) Yes — output=None falls back to the text drawer")

# %% [markdown] role=question answer={"kind":"choice","options":["`None` — it displays the plot directly and returns nothing","a matplotlib `Figure`","a PIL `Image`","the same dict you passed in, unchanged"],"correct":1}
# ### Question 7 — Area: Visualization
#
# ```python
# counts = {"0": 511, "1": 489}
# fig = plot_histogram(counts)
# ```
# What type of object does `plot_histogram(counts)` return?
#
# A) `None` — it displays the plot directly and returns nothing
# B) a matplotlib `Figure`
# C) a PIL `Image`
# D) the same dict you passed in, unchanged

# %% role=answer
counts = {"0": 511, "1": 489}
fig = plot_histogram(counts)
assert fig is not None
assert hasattr(fig, "savefig"), "a matplotlib Figure exposes .savefig(); this object does"
print("Correct answer: B) a matplotlib Figure")

# %% [markdown] role=question answer={"kind":"choice","options":["`\"desc\"`","`\"hamming\"`","`None` (insertion order of the dict)","`\"asc\"`"],"correct":3}
# ### Question 8 — Area: Visualization
#
# What is the default value of `plot_histogram`'s `sort` parameter — the bar order you get when you don't pass anything?
#
# A) `"desc"`
# B) `"hamming"`
# C) `None` (insertion order of the dict)
# D) `"asc"`

# %% role=answer
import inspect
default_sort = inspect.signature(plot_histogram).parameters["sort"].default
print("default sort:", default_sort)
assert default_sort == "asc"
print('Correct answer: D) "asc"')

# %% [markdown] role=question answer={"kind":"choice","options":["Yes — top-to-bottom in the diagram matches left-to-right in the bitstring","No — Qiskit actually draws `q_0` on the bottom wire","It depends on whether `measure_all()` or `measure()` was used","No — the diagram draws `q_0` on top, but the bitstring's *rightmost* character is `q_0`; the two conventions are independent"],"correct":3}
# ### Question 9 — Area: Visualization
#
# ```python
# qc = QuantumCircuit(2)
# qc.x(0)
# print(qc.draw("text"))
# ```
# This draws `q_0` on the **top** wire. Sampling the same circuit gives `{"01": 1000}`. A teammate says: "`q_0` is on top in the picture, so the leftmost character of the bitstring must be `q_0` too." Are they right?
#
# A) Yes — top-to-bottom in the diagram matches left-to-right in the bitstring
# B) No — Qiskit actually draws `q_0` on the bottom wire
# C) It depends on whether `measure_all()` or `measure()` was used
# D) No — the diagram draws `q_0` on top, but the bitstring's *rightmost* character is `q_0`; the two conventions are independent

# %% role=answer
qc = QuantumCircuit(2)
qc.x(0)
lines = str(qc.draw("text")).splitlines()
q0_row = next(i for i, line in enumerate(lines) if "q_0" in line)
q1_row = next(i for i, line in enumerate(lines) if "q_1" in line)
assert q0_row < q1_row, "q_0 is drawn above q_1 in the text diagram"

qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
assert counts == {"01": 1000}
# the rightmost character ("1") is qubit 0, which is exactly the qubit x(0) touched
print("Correct answer: D) top-to-bottom in the drawing and left-to-right in a bitstring are two independent conventions")

# %% [markdown] role=note
# ## Transpilation (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["0","1","3 — it always spends maximum effort unless you turn it down","2"],"correct":3}
# ### Question 10 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=5, seed=1)
# pm = generate_preset_pass_manager(backend=backend)
# ```
# No `optimization_level` was passed. What level does `generate_preset_pass_manager` actually use?
#
# A) 0
# B) 1
# C) 3 — it always spends maximum effort unless you turn it down
# D) 2

# %% role=answer
import inspect
default_level = inspect.signature(generate_preset_pass_manager).parameters["optimization_level"].default
print("default optimization_level:", default_level)
assert default_level == 2
print("Correct answer: D) 2")

# %% [markdown] role=question answer={"kind":"choice","options":["`['cx', 'h', 'measure', 'rz', 'sx', 'x']`","`['cx', 'cz', 'measure', 'rz', 'x']`","`['cx', 'delay', 'id', 'measure', 'reset', 'rz', 'sx', 'x']`","`['ccx', 'cx', 'h', 'measure', 'rz', 'sx', 'x']`"],"correct":2}
# ### Question 11 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=3, seed=1)
# print(sorted(backend.target.operation_names))
# ```
# What does this print?
#
# A) `['cx', 'h', 'measure', 'rz', 'sx', 'x']`
# B) `['cx', 'cz', 'measure', 'rz', 'x']`
# C) `['cx', 'delay', 'id', 'measure', 'reset', 'rz', 'sx', 'x']`
# D) `['ccx', 'cx', 'h', 'measure', 'rz', 'sx', 'x']`

# %% role=answer
backend = GenericBackendV2(num_qubits=3, seed=1)
names = sorted(backend.target.operation_names)
print(names)
assert names == ["cx", "delay", "id", "measure", "reset", "rz", "sx", "x"]
print("Correct answer: C) ['cx', 'delay', 'id', 'measure', 'reset', 'rz', 'sx', 'x']")

# %% [markdown] role=question answer={"kind":"choice","options":["A line — 1 neighbor per end qubit, 2 for interior ones","No coupling map at all — the call raises","Fully connected — every pair of qubits is wired together","A single qubit, with the rest idle"],"correct":2}
# ### Question 12 — Area: Transpilation
#
# ```python
# backend = GenericBackendV2(num_qubits=4, seed=1)
# print(len(backend.coupling_map.get_edges()))
# ```
# No `coupling_map=` was passed. How is this backend's coupling map wired?
#
# A) A line — 1 neighbor per end qubit, 2 for interior ones
# B) No coupling map at all — the call raises
# C) Fully connected — every pair of qubits is wired together
# D) A single qubit, with the rest idle

# %% role=answer
backend = GenericBackendV2(num_qubits=4, seed=1)
edges = list(backend.coupling_map.get_edges())
n = backend.num_qubits
print("edges:", len(edges), "expected fully-connected count:", n * (n - 1))
assert len(edges) == n * (n - 1)
print("Correct answer: C) fully connected")

# %% [markdown] role=question answer={"kind":"choice","options":["More than 3 — routing inserts SWAP gates (each one costs 3 CX in this basis) to bring qubits together","Still 3 — the layout stage always finds a placement that avoids extra gates","`pm.run(qc)` raises `TranspilerError` — this circuit is impossible on a line topology","Always exactly 6, for any `seed_transpiler`"],"correct":0}
# ### Question 13 — Area: Transpilation
#
# ```python
# line = GenericBackendV2(num_qubits=4, coupling_map=[[i, i + 1] for i in range(3)], seed=1)
# qc = QuantumCircuit(4)
# qc.h(0)
# qc.cx(0, 1)
# qc.cx(0, 2)
# qc.cx(0, 3)
# pm = generate_preset_pass_manager(optimization_level=1, backend=line, seed_transpiler=3)
# isa = pm.run(qc)
# ```
# The original circuit has 3 `cx` gates, but qubit 0 needs a direct connection to 1, 2 *and* 3 at once — impossible on a line, where every qubit has at most 2 neighbors. What best describes `isa.count_ops()["cx"]`?
#
# A) More than 3 — routing inserts SWAP gates (each one costs 3 CX in this basis) to bring qubits together
# B) Still 3 — the layout stage always finds a placement that avoids extra gates
# C) `pm.run(qc)` raises `TranspilerError` — this circuit is impossible on a line topology
# D) Always exactly 6, for any `seed_transpiler`

# %% role=answer
line = GenericBackendV2(num_qubits=4, coupling_map=[[i, i + 1] for i in range(3)], seed=1)
qc = QuantumCircuit(4)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.cx(0, 3)
pm = generate_preset_pass_manager(optimization_level=1, backend=line, seed_transpiler=3)
isa = pm.run(qc)
original_cx = qc.count_ops().get("cx", 0)
isa_cx = isa.count_ops().get("cx", 0)
print("original cx:", original_cx, "isa cx:", isa_cx)
assert original_cx == 3
assert isa_cx > 3, "a star with a degree-3 center cannot fit on a line without at least one SWAP"
print("Correct answer: A) more than 3 — routing adds SWAP gates")

# %% [markdown] role=note
# ## Primitives (PUBs) (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["1","100","1000","1024"],"correct":3}
# ### Question 14 — Area: Primitives (PUBs)
#
# ```python
# qc = QuantumCircuit(1)
# qc.h(0)
# qc.measure_all()
# sampler = StatevectorSampler()
# job = sampler.run([qc])
# ```
# No `shots=` was passed, and `StatevectorSampler()` was built with no `default_shots=` argument either. How many shots actually ran?
#
# A) 1
# B) 100
# C) 1000
# D) 1024

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
sampler = StatevectorSampler(seed=1)
result = sampler.run([qc]).result()
total = sum(result[0].data.meas.get_counts().values())
print("total shots:", total)
assert total == 1024
print("Correct answer: D) 1024")

# %% [markdown] role=question answer={"kind":"choice","options":["`est.run([(qc, SparsePauliOp(\"Z\"))])`","`est.run([(qc,)])`","`est.run(qc)`","`est.run([(qc, \"Z\", shots=1000)])`"],"correct":0}
# ### Question 15 — Area: Primitives (PUBs)
#
# `qc` has no measurements. Which of these is a valid Estimator PUB for computing `<Z>` on it?
#
# A) `est.run([(qc, SparsePauliOp("Z"))])`
# B) `est.run([(qc,)])`
# C) `est.run(qc)`
# D) `est.run([(qc, "Z", shots=1000)])`

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
est = StatevectorEstimator()
result = est.run([(qc, SparsePauliOp("Z"))]).result()
print("evs:", result[0].data.evs)

try:
    est.run([qc]).result()
    bare_circuit_worked = True
except Exception as exc:
    bare_circuit_worked = False
    print("bare circuit ->", type(exc).__name__)
assert not bare_circuit_worked, "an Estimator PUB needs an observable; a bare circuit is not a valid pub-like"
print('Correct answer: A) est.run([(qc, SparsePauliOp("Z"))])')

# %% [markdown] role=question answer={"kind":"choice","options":["A single float — only the last value in `values` is used","It raises — a PUB can only bind one parameter value at a time","Shape `(5, 5)`","Shape `(5,)` — one expectation value per bound value, from this one call"],"correct":3}
# ### Question 16 — Area: Primitives (PUBs)
#
# ```python
# theta = Parameter("theta")
# qc = QuantumCircuit(1)
# qc.ry(theta, 0)
# values = np.linspace(0, np.pi, 5)
# result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"), values)]).result()
# ```
# `qc.parameters` has exactly one `Parameter`, and `values` has 5 entries. What shape is `result[0].data.evs`?
#
# A) A single float — only the last value in `values` is used
# B) It raises — a PUB can only bind one parameter value at a time
# C) Shape `(5, 5)`
# D) Shape `(5,)` — one expectation value per bound value, from this one call

# %% role=answer
theta = Parameter("theta")
qc = QuantumCircuit(1)
qc.ry(theta, 0)
values = np.linspace(0, np.pi, 5)
result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"), values)]).result()
evs = result[0].data.evs
print("shape:", evs.shape)
assert evs.shape == (5,)
print("Correct answer: D) shape (5,)")

# %% [markdown] role=question answer={"kind":"choice","options":["1 result; both circuits' counts are merged into `result[0]`","2 results; `qc_b`'s counts are `result[\"qc_b\"].data.meas.get_counts()`","500 results, one per shot","2 results; `qc_b`'s counts are `result[1].data.meas.get_counts()`"],"correct":3}
# ### Question 17 — Area: Primitives (PUBs)
#
# ```python
# result = StatevectorSampler(seed=1).run([qc_a, qc_b], shots=500).result()
# ```
# How many `PubResult`s does `result` contain, and how do you read `qc_b`'s counts?
#
# A) 1 result; both circuits' counts are merged into `result[0]`
# B) 2 results; `qc_b`'s counts are `result["qc_b"].data.meas.get_counts()`
# C) 500 results, one per shot
# D) 2 results; `qc_b`'s counts are `result[1].data.meas.get_counts()`

# %% role=answer
qc_a = QuantumCircuit(1)
qc_a.x(0)
qc_a.measure_all()
qc_b = QuantumCircuit(1)
qc_b.h(0)
qc_b.measure_all()
result = StatevectorSampler(seed=1).run([qc_a, qc_b], shots=500).result()
print("len(result):", len(result))
assert len(result) == 2
b_counts = result[1].data.meas.get_counts()
print("qc_b counts:", b_counts)
assert sum(b_counts.values()) == 500
print("Correct answer: D) 2 results; result[1].data.meas.get_counts()")

# %% [markdown] role=note
# ## V2 result objects (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`result.data`","`result.pubs[0].data`","`result[0].data`","`result.first().data`"],"correct":2}
# ### Question 18 — Area: V2 result objects
#
# ```python
# result = StatevectorSampler(seed=1).run([qc]).result()
# ```
# How do you get the first (and here, only) PUB's data out of `result`?
#
# A) `result.data`
# B) `result.pubs[0].data`
# C) `result[0].data`
# D) `result.first().data`

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
result = StatevectorSampler(seed=1).run([qc]).result()
data = result[0].data
print(type(data).__name__)
assert hasattr(data, "meas")
print("Correct answer: C) result[0].data")

# %% [markdown] role=question answer={"kind":"choice","options":["They're two names for the same thing — both are `{bitstring: frequency}` dicts","`bitstrings` only contains the distinct outcomes seen, with no repeats","`counts` is `{bitstring: frequency}`; `bitstrings` is the raw per-shot list, so `len(bitstrings) == 1000` and `sum(counts.values()) == 1000`","`get_bitstrings()` needs a separate `.run()` call"],"correct":2}
# ### Question 19 — Area: V2 result objects
#
# ```python
# data = result[0].data.meas
# counts = data.get_counts()
# bitstrings = data.get_bitstrings()
# ```
# Both come from the same 1000-shot run. What's true about them?
#
# A) They're two names for the same thing — both are `{bitstring: frequency}` dicts
# B) `bitstrings` only contains the distinct outcomes seen, with no repeats
# C) `counts` is `{bitstring: frequency}`; `bitstrings` is the raw per-shot list, so `len(bitstrings) == 1000` and `sum(counts.values()) == 1000`
# D) `get_bitstrings()` needs a separate `.run()` call

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
result = StatevectorSampler(seed=1).run([qc], shots=1000).result()
data = result[0].data.meas
counts = data.get_counts()
bitstrings = data.get_bitstrings()
print("len(bitstrings):", len(bitstrings), "sum(counts):", sum(counts.values()))
assert len(bitstrings) == 1000
assert sum(counts.values()) == 1000
print("Correct answer: C) counts tallies outcomes; bitstrings is the raw per-shot sequence")

# %% [markdown] role=question answer={"kind":"choice","options":["A single float — only the last observable survives","It raises — a PUB accepts exactly one observable","Shape `(2,)` — one expectation value per observable","Shape `(2, 2)`"],"correct":2}
# ### Question 20 — Area: V2 result objects
#
# ```python
# result = StatevectorEstimator().run([(qc, [SparsePauliOp("ZZ"), SparsePauliOp("XX")])]).result()
# ```
# One PUB, two observables, no parameter sweep. What shape is `result[0].data.evs`?
#
# A) A single float — only the last observable survives
# B) It raises — a PUB accepts exactly one observable
# C) Shape `(2,)` — one expectation value per observable
# D) Shape `(2, 2)`

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
result = StatevectorEstimator().run([(qc, [SparsePauliOp("ZZ"), SparsePauliOp("XX")])]).result()
evs = result[0].data.evs
print("shape:", evs.shape, "values:", evs)
assert evs.shape == (2,)
print("Correct answer: C) shape (2,)")

# %% [markdown] role=question answer={"kind":"choice","options":["`1.0`","It raises `AttributeError` — `stds` only exists once `precision` is set","`0.0` — a bare statevector expectation has no simulated shot noise to report","`None`"],"correct":2}
# ### Question 21 — Area: V2 result objects
#
# ```python
# result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"))]).result()
# ```
# No `precision=` was passed. What does `result[0].data.stds` equal?
#
# A) `1.0`
# B) It raises `AttributeError` — `stds` only exists once `precision` is set
# C) `0.0` — a bare statevector expectation has no simulated shot noise to report
# D) `None`

# %% role=answer
qc = QuantumCircuit(1)
qc.h(0)
result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"))]).result()
stds = result[0].data.stds
print("stds:", stds)
assert float(stds) == 0.0
print("Correct answer: C) 0.0")

# %% [markdown] role=note
# ## Observables (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["1 term throughout — addition merges identical labels automatically","`op` raises `ValueError` — you can't add two `SparsePauliOp`s with the same label","2 terms in `op` (`['Z', 'Z']`, coeffs `[1, 1]`); `simplified` has 1 term, `['Z']` with coefficient `2`","2 terms in both `op` and `simplified`"],"correct":2}
# ### Question 22 — Area: Observables
#
# ```python
# op = SparsePauliOp("Z") + SparsePauliOp("Z")
# simplified = op.simplify()
# ```
# How many terms does `op` have before `.simplify()`, and what does `simplified` look like?
#
# A) 1 term throughout — addition merges identical labels automatically
# B) `op` raises `ValueError` — you can't add two `SparsePauliOp`s with the same label
# C) 2 terms in `op` (`['Z', 'Z']`, coeffs `[1, 1]`); `simplified` has 1 term, `['Z']` with coefficient `2`
# D) 2 terms in both `op` and `simplified`

# %% role=answer
op = SparsePauliOp("Z") + SparsePauliOp("Z")
simplified = op.simplify()
print("op:", list(op.paulis), list(op.coeffs))
print("simplified:", list(simplified.paulis), list(simplified.coeffs))
assert len(op) == 2
assert len(simplified) == 1
assert simplified.coeffs[0] == 2
print("Correct answer: C) 2 terms before simplify; 1 term, coefficient 2, after")

# %% [markdown] role=question answer={"kind":"choice","options":["`I`","`Y`, with coefficient `1j`","`X`","`Z`"],"correct":1}
# ### Question 23 — Area: Observables
#
# ```python
# result = SparsePauliOp("Z") @ SparsePauliOp("X")
# ```
# `@` composes the two operators (matrix product). Up to its coefficient, which single Pauli does `result` reduce to?
#
# A) `I`
# B) `Y`, with coefficient `1j`
# C) `X`
# D) `Z`

# %% role=answer
result = SparsePauliOp("Z") @ SparsePauliOp("X")
print(result)
assert list(result.paulis.to_labels()) == ["Y"]
assert result.coeffs[0] == 1j
print("Correct answer: B) Y, coefficient 1j")

# %% [markdown] role=question answer={"kind":"choice","options":["`['XZ']` — `Z` acts on qubit 0","`['ZX']` — `Z` acts on qubit 1 (the left character), `X` on qubit 0","`['ZX']` — `Z` acts on qubit 0, since it was called first","`SparsePauliOp` has no `.tensor()` method; use `^` instead"],"correct":1}
# ### Question 24 — Area: Observables
#
# ```python
# op = SparsePauliOp("Z").tensor(SparsePauliOp("X"))
# print(op.paulis)
# ```
# `.tensor()` is called on `Z`; `X` is the argument. What does this print, and which qubit does `Z` act on?
#
# A) `['XZ']` — `Z` acts on qubit 0
# B) `['ZX']` — `Z` acts on qubit 1 (the left character), `X` on qubit 0
# C) `['ZX']` — `Z` acts on qubit 0, since it was called first
# D) `SparsePauliOp` has no `.tensor()` method; use `^` instead

# %% role=answer
op = SparsePauliOp("Z").tensor(SparsePauliOp("X"))
labels = list(op.paulis.to_labels())
print(labels)
assert labels == ["ZX"]
# label characters read right-to-left by qubit index, same convention as a bitstring
assert labels[0][-1] == "X"  # qubit 0
assert labels[0][-2] == "Z"  # qubit 1
print("Correct answer: B) ['ZX'] — Z acts on qubit 1, X acts on qubit 0")

# %% [markdown] role=question answer={"kind":"choice","options":["`['ZI', 'IX']` — unchanged","`['XI', 'IZ']`","`['IZ', 'XI']`","It raises — `apply_layout` needs a `TranspileLayout`, not a plain list"],"correct":2}
# ### Question 25 — Area: Observables
#
# ```python
# op = SparsePauliOp(["ZI", "IX"])
# laid = op.apply_layout([1, 0], num_qubits=2)
# print(laid.paulis)
# ```
# `[1, 0]` means logical qubit 0 moved to physical qubit 1, and logical qubit 1 moved to physical qubit 0. What does this print?
#
# A) `['ZI', 'IX']` — unchanged
# B) `['XI', 'IZ']`
# C) `['IZ', 'XI']`
# D) It raises — `apply_layout` needs a `TranspileLayout`, not a plain list

# %% role=answer
op = SparsePauliOp(["ZI", "IX"])
laid = op.apply_layout([1, 0], num_qubits=2)
labels = list(laid.paulis.to_labels())
print(labels)
assert labels == ["IZ", "XI"]
print("Correct answer: C) ['IZ', 'XI']")

# %% [markdown] role=note
# ## OpenQASM 3 (3 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["`qreg q[2];` — the QASM2-style register declaration","`declare q: qubit[2];`","`q = QuantumRegister(2)`","`qubit[2] q;`"],"correct":3}
# ### Question 26 — Area: OpenQASM 3
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# qc.measure_all()
# text = qasm3.dumps(qc)
# ```
# Which line appears in `text`?
#
# A) `qreg q[2];` — the QASM2-style register declaration
# B) `declare q: qubit[2];`
# C) `q = QuantumRegister(2)`
# D) `qubit[2] q;`

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
text = qasm3.dumps(qc)
print(text)
assert "qubit[2] q;" in text
assert "qreg" not in text
print("Correct answer: D) qubit[2] q;")

# %% [markdown] role=question answer={"kind":"choice","options":["False — OpenQASM 3 drops the classical register's name","True — the round trip preserves the circuit","False — the qubit order gets reversed","It raises — `loads` can't read what `dumps` wrote"],"correct":1}
# ### Question 27 — Area: OpenQASM 3
#
# ```python
# qc = QuantumCircuit(2)
# qc.h(0)
# qc.cx(0, 1)
# qc.measure_all()
# roundtripped = qasm3.loads(qasm3.dumps(qc))
# ```
# Is `roundtripped == qc`?
#
# A) False — OpenQASM 3 drops the classical register's name
# B) True — the round trip preserves the circuit
# C) False — the qubit order gets reversed
# D) It raises — `loads` can't read what `dumps` wrote

# %% role=answer
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
roundtripped = qasm3.loads(qasm3.dumps(qc))
assert roundtripped == qc
print("Correct answer: B) True")

# %% [markdown] role=question answer={"kind":"choice","options":["`from qiskit.qasm3 import QASM3Exporter`","`import qasm3`","`from qiskit.circuit import qasm3`","`from qiskit import qasm3`"],"correct":3}
# ### Question 28 — Area: OpenQASM 3
#
# Which import gives you `dumps` and `loads` for OpenQASM 3 in Qiskit 2.5?
#
# A) `from qiskit.qasm3 import QASM3Exporter`
# B) `import qasm3`
# C) `from qiskit.circuit import qasm3`
# D) `from qiskit import qasm3`

# %% role=answer
from qiskit import qasm3 as qasm3_module
assert hasattr(qasm3_module, "dumps")
assert hasattr(qasm3_module, "loads")
print("Correct answer: D) from qiskit import qasm3")

# %% [markdown] role=note
# ## Debugging (4 questions)

# %% [markdown] role=question answer={"kind":"choice","options":["Qubit 0 — the rightmost character of the bitstring is qubit 0","Qubit 1 — the leftmost character is always the one you addressed first","Both — a 2-character string always reports both qubits together","You can't tell without also printing `qc.draw()`"],"correct":0}
# ### Question 29 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(2)
# qc.x(0)
# qc.measure_all()
# counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
# print(counts)
# ```
# This prints `{"01": 1000}`. Which physical qubit did `x(0)` flip?
#
# A) Qubit 0 — the rightmost character of the bitstring is qubit 0
# B) Qubit 1 — the leftmost character is always the one you addressed first
# C) Both — a 2-character string always reports both qubits together
# D) You can't tell without also printing `qc.draw()`

# %% role=answer
qc = QuantumCircuit(2)
qc.x(0)
qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
print(counts)
assert counts == {"01": 1000}
print("Correct answer: A) qubit 0 — the rightmost character is qubit 0")

# %% [markdown] role=question answer={"kind":"choice","options":["A `UserWarning` fires on `.run()` (\"no output classical registers\"), and `result[0].data.meas` then raises `AttributeError` — there is no `meas` register to read","`counts` comes back as `{\"0\": ~500, \"1\": ~500}`, same as if `measure_all()` had been called","`.run()` itself raises `ValueError` immediately","`counts` comes back as `{}`, with no warning at all"],"correct":0}
# ### Question 30 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(1)
# qc.h(0)
# # no measure_all() call
# result = StatevectorSampler(seed=1).run([qc], shots=1000).result()
# counts = result[0].data.meas.get_counts()
# ```
# What actually happens?
#
# A) A `UserWarning` fires on `.run()` ("no output classical registers"), and `result[0].data.meas` then raises `AttributeError` — there is no `meas` register to read
# B) `counts` comes back as `{"0": ~500, "1": ~500}`, same as if `measure_all()` had been called
# C) `.run()` itself raises `ValueError` immediately
# D) `counts` comes back as `{}`, with no warning at all

# %% role=answer
import warnings

qc = QuantumCircuit(1)
qc.h(0)
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    result = StatevectorSampler(seed=1).run([qc], shots=1000).result()
    warned = any(issubclass(w.category, UserWarning) for w in caught)
assert warned, "expected a UserWarning about missing classical registers"

try:
    result[0].data.meas
    raised = False
except AttributeError:
    raised = True
assert raised
print("Correct answer: A) a UserWarning fires, then .data.meas raises AttributeError")

# %% [markdown] role=question answer={"kind":"choice","options":["It raises `QiskitError`: `\"Cannot apply instruction with classical bits: measure\"`","The measurement is silently ignored and `evs` comes back as usual","It raises `ValueError` about an invalid PUB shape, same as forgetting to wrap the circuit in `[]`","It runs, but `evs` always comes back exactly `0.0`"],"correct":0}
# ### Question 31 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(1)
# qc.h(0)
# qc.measure_all()
# result = StatevectorEstimator().run([(qc, SparsePauliOp("Z"))]).result()
# ```
# The circuit still has its `measure_all()` in it. What happens?
#
# A) It raises `QiskitError`: `"Cannot apply instruction with classical bits: measure"`
# B) The measurement is silently ignored and `evs` comes back as usual
# C) It raises `ValueError` about an invalid PUB shape, same as forgetting to wrap the circuit in `[]`
# D) It runs, but `evs` always comes back exactly `0.0`

# %% role=answer
from qiskit.exceptions import QiskitError

qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
try:
    StatevectorEstimator().run([(qc, SparsePauliOp("Z"))]).result()
    raised = None
except QiskitError as exc:
    raised = str(exc)
print("raised:", raised)
assert raised is not None
assert "classical bits" in raised
print("Correct answer: A) QiskitError: Cannot apply instruction with classical bits: measure")

# %% [markdown] role=question answer={"kind":"choice","options":["Only `\"000\"` and `\"111\"` still appear — qubit 2 gets entangled by the first `cx` too","Only `\"000\"` and `\"011\"` appear — qubit 2 (the leftmost bit) is always `0`, since nothing ever touched it","All 8 three-bit strings appear roughly equally","`.run()` raises, because a GHZ circuit requires exactly `n - 1` CX gates"],"correct":1}
# ### Question 32 — Area: Debugging
#
# ```python
# qc = QuantumCircuit(3)
# qc.h(0)
# qc.cx(0, 1)
# # meant to also write qc.cx(1, 2), but forgot it
# qc.measure_all()
# counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
# ```
# A 3-qubit GHZ state should give only `"000"` and `"111"`. This circuit is missing its second `cx`. What do the counts actually look like?
#
# A) Only `"000"` and `"111"` still appear — qubit 2 gets entangled by the first `cx` too
# B) Only `"000"` and `"011"` appear — qubit 2 (the leftmost bit) is always `0`, since nothing ever touched it
# C) All 8 three-bit strings appear roughly equally
# D) `.run()` raises, because a GHZ circuit requires exactly `n - 1` CX gates

# %% role=answer
qc = QuantumCircuit(3)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
counts = StatevectorSampler(seed=1).run([qc], shots=1000).result()[0].data.meas.get_counts()
print(counts)
assert set(counts.keys()) <= {"000", "011"}
assert all(outcome[0] == "0" for outcome in counts)
print('Correct answer: B) only "000" and "011" appear; qubit 2 is always 0')

# %% [markdown] role=summary
# ## What this covered
# 32 questions across all eight certification areas: circuit construction, visualization,
# transpilation, primitives, V2 result objects, observables, OpenQASM 3, and debugging. If
# an answer surprised you, that is the API detail worth re-reading in the matching week's
# lab before attempting `mock_exam.ipynb`. The mock exam does not repeat these questions —
# it draws on the same eight areas from different angles, under a 45-minute limit.
