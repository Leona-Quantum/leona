# ---
# title: Week 04 challenge — Transpilation
# kind: challenge
# summary: Make a 4-qubit GHZ target-compatible and report its depth; read directly connected qubit pairs off a different backend's coupling map.
# objectives:
#   - Transpile a 4-qubit GHZ circuit into a target-compatible ISA circuit and report its depth
#   - Read directly connected qubit pairs off a backend's own coupling map
# prerequisites:
#   - lab.nb.py completed
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will build
# `lab.nb.py` built one function, `to_target_compatible`, that turns any small circuit
# into an ISA circuit for a given backend. This challenge uses the same two ideas by
# hand, on a bigger circuit and a different topology: transpile a 4-qubit GHZ circuit and
# report its depth, then read a backend's coupling map to find which qubit pairs are
# directly connected — without running anything to find out.

# %% [markdown] role=concept
# ## Two tasks, same tools
# Both tasks reuse exactly what the lab used: `generate_preset_pass_manager(...).run(qc)`
# to get an ISA circuit, `.depth()` and `.count_ops()` to read it, and
# `backend.coupling_map.get_edges()` to read a backend's wiring directly, without
# transpiling anything.

# %% role=setup
from qiskit import QuantumCircuit
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.transpiler import generate_preset_pass_manager

backend = GenericBackendV2(num_qubits=5, seed=1)
print(f"backend: {backend.name}, {backend.num_qubits} qubits")

# %% [markdown] role=exercise
# ## Task 1: a bigger GHZ
# Build a 4-qubit GHZ circuit named `ghz4`: `h` on qubit 0, then a chain of `cx` gates —
# `cx(0, 1)`, `cx(1, 2)`, `cx(2, 3)` — linking each qubit to the next. Transpile it for
# `backend` above with `generate_preset_pass_manager(optimization_level=1, backend=backend,
# seed_transpiler=1).run(ghz4)`, store the result in `answer_1_isa`, and store its depth in
# `answer_1_depth`.

# %% role=solution stub="ghz4 = None\nanswer_1_isa = None\nanswer_1_depth = None\n"
ghz4 = QuantumCircuit(4)
ghz4.h(0)
ghz4.cx(0, 1)
ghz4.cx(1, 2)
ghz4.cx(2, 3)

pm = generate_preset_pass_manager(optimization_level=1, backend=backend, seed_transpiler=1)
answer_1_isa = pm.run(ghz4)
answer_1_depth = answer_1_isa.depth()
print("depth:", answer_1_depth)
print(answer_1_isa.count_ops())

# %% [markdown] role=hint
# This is the same shape as `lab.nb.py`'s GHZ example, one qubit longer:
# `generate_preset_pass_manager(optimization_level=1, backend=backend,
# seed_transpiler=1).run(ghz4)` returns the ISA circuit; call `.depth()` on it for the
# depth `lab.nb.py` printed alongside `.count_ops()`.

# %% role=checkpoint
if answer_1_isa is not None:
    answer_1_ops = {
        instr.operation.name for instr in answer_1_isa.data if instr.operation.name != "barrier"
    }
    assert answer_1_ops <= set(backend.target.operation_names), (
        f"every instruction in the ISA circuit must come from the backend's basis, saw {answer_1_ops}"
    )

# %% role=checkpoint
if answer_1_depth is not None:
    # A band, not an exact count: this checks the shape of the result, not one precise
    # number that a different Qiskit patch release could quietly change.
    assert 4 <= answer_1_depth <= 20, (
        f"expected a modest depth for a 4-qubit chain GHZ on a fully connected backend, "
        f"got {answer_1_depth}"
    )

# %% [markdown] role=explain
# This backend is fully connected, the same as in `lab.nb.py`, so a chain-shaped GHZ needs
# no SWAPs regardless of length — the depth you measured comes entirely from decomposing
# `h` and each `cx` into the basis, not from routing.

# %% role=run
branch_backend = GenericBackendV2(
    num_qubits=5, coupling_map=[[0, 1], [1, 2], [1, 3], [3, 4]], seed=1
)
print("branch backend built — its coupling map is not printed here on purpose.")

# %% [markdown] role=exercise
# ## Task 2: read the wiring
# `branch_backend` above has a different shape from anything in `lab.nb.py`: qubit 1 sits
# at a junction connected to three other qubits, and qubit 4 hangs off qubit 3. Find every
# directly connected qubit pair **without transpiling anything** — read it straight off
# `branch_backend.coupling_map`. Store the result as `answer_2_pairs`: a sorted list of
# 2-tuples `(smaller, larger)`, with each connected pair appearing exactly once (so `(0,
# 1)` counts once, not again as `(1, 0)`).

# %% role=solution stub="answer_2_pairs = None\n"
raw_edges = branch_backend.coupling_map.get_edges()
answer_2_pairs = sorted({tuple(sorted(pair)) for pair in raw_edges})
print(answer_2_pairs)

# %% [markdown] role=hint
# `branch_backend.coupling_map.get_edges()` returns each connection as a *directed* pair.
# `lab.nb.py`'s first backend was built with no `coupling_map` argument, so Qiskit filled
# in every direction automatically and each connection appeared twice; `branch_backend`
# was built from an explicit list instead, so it lists only the direction that was passed
# in. Either way, `sorted(pair)` turns any pair into ascending order — `(1, 0)` becomes
# `(0, 1)` — so wrapping that in `tuple(...)` and collecting the results in a `set` gives
# each connection once regardless of how many directions were listed; `sorted(...)` the
# set into a list.

# %% role=checkpoint
if answer_2_pairs is not None:
    assert set(answer_2_pairs) == {(0, 1), (1, 2), (1, 3), (3, 4)}, (
        f"expected the branch backend's four connected pairs, got {sorted(set(answer_2_pairs))}"
    )
    assert len(answer_2_pairs) == 4, (
        f"expected each connected pair listed exactly once (4 pairs total), got {len(answer_2_pairs)}"
    )

# %% [markdown] role=explain
# Four connections, not five: qubit 1 is the only one wired to three others (0, 2 and 3),
# and qubit 4 only reaches the rest of the backend through qubit 3. A circuit with a `cx`
# between, say, qubits 0 and 4 would need routing on this backend, the same way the
# triangle circuit in `lab.nb.py` did on the line backend — you now have a way to check
# that without transpiling first.

# %% [markdown] role=summary
# ## What you built
# A 4-qubit GHZ circuit transpiled into an ISA circuit with its depth read off directly,
# and a backend's coupling map read for its connected pairs without running anything.
# Compare your answers with the reference solution notebook and its self-evaluation
# checklist.
