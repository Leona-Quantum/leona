# ---
# title: Week 04 — Transpilation
# kind: lab
# summary: Read a backend's Target, transpile circuits into it with generate_preset_pass_manager, and build a function that always returns a target-compatible circuit.
# objectives:
#   - Read a backend's Target — its basis gates and its coupling map
#   - Predict and verify how a gate outside the basis gets rewritten
#   - Predict and verify how a two-qubit gate on unconnected qubits gets routed
#   - Compare optimization levels by the depth they produce on the same circuit
#   - Write a function that turns any small circuit into a target-compatible ISA circuit
# prerequisites:
#   - Week 03 gates and state completed (lab.ipynb run, both checkpoints passing)
# duration_minutes: 40
# ---

# %% [markdown] role=objective
# ## What you will build
# Every circuit you have written through Week 03 is abstract: gates like `H`, `RY`, `CX`,
# addressed to whichever qubit number you picked. No backend runs that circuit as written.
# A real backend supports a fixed, small set of physical gates — its **basis** — and its
# qubits are wired together in a fixed pattern — its **coupling map**. A two-qubit gate
# only works directly between qubits that share a wire.
#
# **Transpilation** is what turns your abstract circuit into one a specific backend can
# run: an **ISA circuit** — instructions from the target's basis, addressed to physical
# qubits, respecting the coupling map. By the end of this lab you will have a function
# that takes any small circuit and a backend, and returns an ISA circuit for it, checked
# against that backend's own `Target`. This lab never samples anything — no `Sampler`, no
# counts. It is entirely about what a circuit turns into before it runs; Week 05 covers
# running it.

# %% [markdown] role=concept
# ## Target, basis, coupling map
# Qiskit describes what a backend can do with a `Target` object: which gates it supports
# (the basis gates), and — for two-qubit gates — which pairs of qubits are physically wired
# together (the coupling map). `Target` replaced the older, separate `basis_gates` and
# `coupling_map` arguments you may see in older tutorials; on a modern backend both live
# inside `backend.target`.
#
# `generate_preset_pass_manager` reads a backend's `Target` and builds a pipeline that
# rewrites any circuit into one that target accepts. You choose an `optimization_level`
# from 0 (least effort) to 3 (most effort spent shrinking the result).

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.transpiler import generate_preset_pass_manager

print(qiskit.__version__)

backend = GenericBackendV2(num_qubits=5, seed=1)
print(f"backend: {backend.name}, {backend.num_qubits} qubits")

# %% role=run
print("target basis gates:", sorted(backend.target.operation_names))
print("coupling map:", list(backend.coupling_map.get_edges()))

# %% [markdown] role=note
# ## Reading that printout
# The basis is `cx, id, rz, sx, x`, plus `delay`, `measure` and `reset`, which every
# backend supports regardless of what you pass as `basis_gates`. Every gate you have ever
# written — `H`, `Y`, `RY`, a three-qubit Toffoli, anything — has to be rewritten in terms
# of just those seven. `rz` is a rotation around one axis; `sx` is a fixed
# square-root-of-X rotation. Together they can reach any single-qubit rotation, so the
# transpiler never needs more than `rz` and `sx` for one-qubit work.
#
# The coupling map lists every physical qubit pair that can host a two-qubit gate
# directly, once per direction — `(0, 1)` and `(1, 0)` both appear, because a coupling map
# records directed edges. Because this backend was built without an explicit
# `coupling_map` argument, Qiskit filled in a **fully connected** one: every pair among
# the five qubits is wired together. Real hardware is never this generous. Later in this
# lab you build a backend with a sparser, more realistic layout and watch the coupling map
# start to matter.

# %% [markdown] role=predict
# **Predict.** You are about to transpile a circuit that contains one `H` gate for this
# backend. `H` is not in the basis list above. Write a specific guess: which gate or gates
# will the ISA circuit use in its place, and roughly how many of each?

# %% role=run
h_only = QuantumCircuit(1)
h_only.h(0)

pm_level1 = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
isa_h = pm_level1.run(h_only)

print("original:", h_only.count_ops())
print("ISA circuit:", isa_h.count_ops())
print(isa_h.draw("text"))

# %% [markdown] role=observe
# `H` became two `rz` rotations around one `sx` — a `rz, sx, rz` pattern — with a global
# phase reported separately. Nothing else changed: still a one-qubit, gate-only circuit.

# %% [markdown] role=explain
# `rz, sx, rz` is how this basis reaches an arbitrary single-qubit rotation, and `H` is one
# particular rotation. You do not need to work out the angles by hand — the point is that
# the transpiler always has a route from any 1-qubit gate to this basis, because `rz` and
# `sx` together generate every rotation a single qubit can undergo.

# %% role=modify
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)
bell.measure_all()

isa_bell = pm_level1.run(bell)
print("original:", bell.count_ops(), "depth", bell.depth())
print("ISA circuit:", isa_bell.count_ops(), "depth", isa_bell.depth())

# %% role=checkpoint
isa_bell_ops = {instr.operation.name for instr in isa_bell.data if instr.operation.name != "barrier"}
assert isa_bell_ops <= set(backend.target.operation_names), (
    f"every instruction in an ISA circuit must come from the backend's basis, saw {isa_bell_ops}"
)
assert isa_bell.count_ops().get("cx", 0) == 1, (
    "the backend is fully connected, so the Bell circuit's single CX needs no extra help"
)

# %% [markdown] role=concept
# ## When qubits are not neighbors
# A fully connected backend never has to think about the coupling map: any pair of qubits
# can host a two-qubit gate directly. Real backends are not fully connected — each qubit
# typically talks to two, three or four neighbors. When your circuit asks for a two-qubit
# gate between qubits that are not connected, the transpiler has to do something about it
# before the circuit can run.
#
# Build a second backend with a **line** topology — five qubits wired 0-1-2-3-4 and
# nothing else — to see what "something" means.

# %% [markdown] role=predict
# **Predict.** Here is a three-qubit circuit: `CX(0,1)`, `CX(1,2)`, `CX(0,2)` — one CX for
# every pair, so qubits 0, 1 and 2 all need a direct connection to *each other* at some
# point. On a line 0-1-2-3-4, qubit 1 has two neighbors (0 and 2), but 0 and 2 are not
# neighbors of each other — no three qubits on this line are mutually connected. Write a
# guess: can the transpiler still produce a working circuit, and if so, roughly what does
# it have to add?

# %% role=run
line_backend = GenericBackendV2(num_qubits=5, coupling_map=[[i, i + 1] for i in range(4)], seed=1)
print("line coupling map:", list(line_backend.coupling_map.get_edges()))

triangle = QuantumCircuit(3)
triangle.h(0)
triangle.cx(0, 1)
triangle.cx(1, 2)
triangle.cx(0, 2)

pm_line1 = generate_preset_pass_manager(optimization_level=1, backend=line_backend, seed_transpiler=1)
isa_triangle = pm_line1.run(triangle)

print("original:", triangle.count_ops(), "depth", triangle.depth())
print("ISA circuit:", isa_triangle.count_ops(), "depth", isa_triangle.depth())

# %% [markdown] role=observe
# The CX count grew from 3 to 6, and the depth grew from 4 to more than five times that.
# Nothing failed — the transpiler produced a working circuit, just a noticeably bigger one.

# %% [markdown] role=explain
# The circuit needed three qubits mutually connected — a triangle — but a line graph has
# no triangle in it anywhere: any node's two neighbors are never neighbors of each other.
# The routing stage bridges that gap with a **SWAP** gate, which exchanges two qubits'
# states so a gate that needed a missing connection can happen where a connection does
# exist. `swap` is not in this backend's basis either, so it becomes three `CX` gates —
# which is why the CX count jumped by exactly 3 (one SWAP's worth) and the depth grew well
# beyond the original.

# %% [markdown] role=concept
# ## `optimization_level`, briefly
# - **0** — placement and basis translation only, essentially no extra effort spent
#   shrinking the result. Fastest to compile, usually the biggest output.
# - **1** — some gate cancellation and light optimization alongside routing. This lab
#   passes `optimization_level=1` explicitly everywhere, so results stay reproducible
#   regardless of what `generate_preset_pass_manager`'s own default (currently 2) is.
# - **2** — more synthesis effort spent finding a smaller circuit.
# - **3** — the most effort; best when compile time matters less than the depth and gate
#   count you end up with.
#
# Higher levels cost more compile time in exchange for more optimization effort spent —
# Qiskit's own docs call the result "potentially more optimized," not a guaranteed
# ordering. On the same circuit and backend you should not expect a higher level to come
# out worse than a lower one; the next experiment checks that on this input directly.

# %% role=modify
pm_line0 = generate_preset_pass_manager(optimization_level=0, backend=line_backend, seed_transpiler=1)
pm_line3 = generate_preset_pass_manager(optimization_level=3, backend=line_backend, seed_transpiler=1)

isa_triangle_0 = pm_line0.run(triangle)
isa_triangle_3 = pm_line3.run(triangle)

print("optimization_level=0:", isa_triangle_0.count_ops(), "depth", isa_triangle_0.depth())
print("optimization_level=3:", isa_triangle_3.count_ops(), "depth", isa_triangle_3.depth())

# %% role=checkpoint
assert isa_triangle.count_ops().get("cx", 0) > triangle.count_ops().get("cx", 0), (
    "routing the triangle onto a line needs at least one SWAP, so the CX count should grow"
)
assert isa_triangle_3.depth() <= isa_triangle_0.depth(), (
    f"optimization_level=3 (depth {isa_triangle_3.depth()}) should never end up deeper than "
    f"optimization_level=0 (depth {isa_triangle_0.depth()}) on the same input"
)

# %% [markdown] role=concept
# ## What "ISA circuit" means
# An **ISA circuit** — instruction set architecture circuit — is the output of that whole
# pipeline: every instruction comes from the target's basis, every qubit index refers to a
# *physical* qubit on the backend (not necessarily the qubit index you wrote — the layout
# stage may relabel things), and every two-qubit gate sits on an edge of the coupling map.
# That is the only kind of circuit a real backend, or a faithful simulator of one, can run.

# %% role=run
print(isa_triangle.draw("text"))

placement = isa_triangle.layout.initial_index_layout()
logical_to_physical = {logical: physical for logical, physical in enumerate(placement[: triangle.num_qubits])}
print("logical qubit -> physical qubit:", logical_to_physical)

# %% [markdown] role=note
# That mapping is the relabeling you saw in the circuit drawing above, where a wire
# labeled `q_0 -> 1` means "this is logical qubit 0, placed on physical qubit 1." The
# layout stage chooses this placement before routing even starts, and a good choice can
# reduce how many SWAPs routing needs to add.

# %% [markdown] role=predict
# **Predict.** A three-qubit GHZ state is usually built as a chain: `H(0)`, `CX(0,1)`,
# `CX(1,2)`. On the line backend, 0-1 are neighbors and 1-2 are neighbors — the same shape
# as the circuit itself. Write a guess: will this circuit need any SWAP gates on the line
# backend?

# %% role=run
ghz3 = QuantumCircuit(3)
ghz3.h(0)
ghz3.cx(0, 1)
ghz3.cx(1, 2)

isa_ghz3 = pm_line1.run(ghz3)
print("original:", ghz3.count_ops(), "depth", ghz3.depth())
print("ISA circuit:", isa_ghz3.count_ops(), "depth", isa_ghz3.depth())

# %% [markdown] role=observe
# No extra `cx` appeared: the count of two-qubit gates in the ISA circuit matches the
# original exactly.

# %% [markdown] role=explain
# The layout stage placed the three logical qubits on three physical qubits that are
# already chain-connected, so every `CX` in the circuit lands on an edge of the coupling
# map without any SWAP. Writing a circuit whose own connectivity pattern already matches
# (or fits inside) the hardware's topology is the cheapest way to keep transpilation from
# adding overhead — the triangle above could not do this on a line; this chain can.

# %% role=modify
ghz3_shortcut = QuantumCircuit(3)
ghz3_shortcut.h(0)
ghz3_shortcut.cx(0, 1)
ghz3_shortcut.cx(0, 2)  # qubit 0 now needs BOTH of its partners directly, not a chain

isa_ghz3_shortcut = pm_line1.run(ghz3_shortcut)
print("chain version:   ", isa_ghz3.count_ops(), "depth", isa_ghz3.depth())
print("shortcut version:", isa_ghz3_shortcut.count_ops(), "depth", isa_ghz3_shortcut.depth())

# %% [markdown] role=note
# The CX count did not grow here either, even though logical qubit 0 now needs two direct
# partners at once. Look at the line 0-1-2-3-4: qubit 1 sits in the middle, with two
# neighbors. If the layout stage places logical qubit 0 there, both of its CX partners are
# one hop away and no SWAP is needed — a reminder that *where* your logical qubits land
# matters as much as how many SWAPs get inserted afterward. The depth still moved, because
# the single-qubit gates around each CX get scheduled differently; the CX count is the
# number worth watching for routing cost specifically.

# %% role=figure
print(isa_ghz3.draw("text"))
isa_ghz3.draw("mpl")

# %% role=checkpoint
ghz3_ops = {instr.operation.name for instr in isa_ghz3.data if instr.operation.name != "barrier"}
assert ghz3_ops <= set(line_backend.target.operation_names), (
    f"every instruction in the ISA circuit must come from the line backend's basis, saw {ghz3_ops}"
)
assert isa_ghz3.count_ops().get("cx", 0) == ghz3.count_ops().get("cx", 0), (
    "a chain-shaped circuit on a chain-shaped backend should not need any extra CX from routing"
)

# %% [markdown] role=note
# ## Deliverable: one function
# Every experiment above followed the same three steps: build a
# `generate_preset_pass_manager` for a backend, run it on a circuit, and read off the
# result. Package that as a function you can hand any small circuit and any backend.

# %% role=run
def to_target_compatible(circuit, backend, optimization_level=1, seed_transpiler=1):
    """Return an ISA circuit for `circuit` on `backend`: every instruction drawn from the
    backend's basis, addressed to physical qubits, respecting its coupling map."""
    pm = generate_preset_pass_manager(
        optimization_level=optimization_level,
        backend=backend,
        seed_transpiler=seed_transpiler,
    )
    return pm.run(circuit)


test_cases = [
    ("bell", bell, backend),
    ("triangle", triangle, line_backend),
    ("ghz3-chain", ghz3, line_backend),
    ("ghz3-shortcut", ghz3_shortcut, line_backend),
]

# %% role=run
for name, circuit, target_backend in test_cases:
    isa = to_target_compatible(circuit, target_backend)
    print(f"{name:15s} depth={isa.depth():3d} ops={dict(isa.count_ops())}")

# %% role=checkpoint
for name, circuit, target_backend in test_cases:
    isa = to_target_compatible(circuit, target_backend)
    used = {instr.operation.name for instr in isa.data if instr.operation.name != "barrier"}
    assert used <= set(target_backend.target.operation_names), (
        f"{name}: to_target_compatible must only emit instructions from {target_backend.name}'s basis, "
        f"saw {used}"
    )

# %% [markdown] role=summary
# ## What you built
# A `Target` describes what a backend can actually run: its basis gates and its coupling
# map. `generate_preset_pass_manager(...).run(circuit)` rewrites any circuit into an ISA
# circuit for that target — decomposing gates outside the basis, and inserting SWAPs to
# route two-qubit gates across qubits that are not directly connected. Higher optimization
# levels spend more effort but never produced a deeper circuit than a lower one on the
# same input here, and a circuit whose own connectivity matches the hardware's needed no
# routing at all. `to_target_compatible` packages all of that into one reusable function,
# checked against every backend's own `Target` rather than a hardcoded gate list.
#
# One remaining question to carry into Week 05: primitives (`SamplerV2`, `EstimatorV2`)
# accept a circuit and, for the estimator, an observable — do those need to already be ISA
# circuits before you hand them to a real backend, or does something transpile them for
# you first?
