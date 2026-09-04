# ---
# title: Week 05 — Primitives
# kind: lab
# summary: Learn the two questions Qiskit's primitives answer — what outcomes appear, and what is an observable's average — and build a table that matches real tasks to Sampler or Estimator.
# objectives:
#   - Explain what SamplerV2 answers and what EstimatorV2 answers, and how those two questions differ
#   - Run a StatevectorSampler PUB and read counts and bitstrings off a named classical register
#   - Run a StatevectorEstimator PUB with a SparsePauliOp observable on a circuit that has no measurements
#   - Sweep a Parameter across many values inside a single PUB and read the resulting array of expectation values
#   - Decide, for a short list of realistic tasks, which primitive answers each one
# prerequisites:
#   - Week 02 entanglement (building and measuring a Bell state, and Qiskit's bit order)
#   - Week 03 quantum gates (RX as a rotation, reading a predicted outcome before running it)
# duration_minutes: 90
# ---

# %% [markdown] role=objective
# ## What you will build
# Qiskit's primitives answer one of two questions about a circuit. `Sampler` answers
# "what outcomes come out, and how often?" `Estimator` answers "what is the average
# value of some observable?"
#
# By the end of this lab you will have run both kinds of primitive, read their result
# objects, swept a circuit's parameter across nine values in a single call, and started
# a table that matches five realistic tasks to the primitive that answers each one. That
# table is this week's deliverable — the challenge notebook turns it into a dict Python
# can check.

# %% role=setup
import numpy as np
import qiskit

print("qiskit version:", qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.circuit import ClassicalRegister, Parameter, QuantumRegister
from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit.quantum_info import SparsePauliOp

# %% [markdown] role=concept
# ## Two questions, two primitives
# Every quantum program eventually gets read out by one of these two primitives.
#
# `StatevectorSampler` runs a circuit that ends in measurements and returns outcomes:
# bitstrings, and how often each one appeared — the same shape of result you built by
# hand in weeks 01 and 02.
#
# `StatevectorEstimator` runs a circuit that has **no** measurements and returns a
# single number per observable: the value that observable would average to if you
# measured it many times. It skips the measure-and-count step entirely and computes the
# exact average from the circuit's statevector.
#
# Picking the right one is the difference between "show me the distribution" and "show
# me one number." Both questions keep coming up: Grover search in week 06 wants a
# distribution over outcomes; the variational solver in week 07 wants one number to
# minimize.

# %% [markdown] role=concept
# ## The PUB: one call, everything a primitive needs
# Both primitives take a list of PUBs — Primitive Unified Blocs. A PUB bundles a
# circuit with whatever else that circuit needs to run: how many shots (for `Sampler`),
# which observable to average (for `Estimator`), and, if the circuit has a `Parameter`,
# what values to bind it to.
#
# The simplest PUB is just a circuit on its own, with the shot count passed once at the
# `run` call: `sampler.run([qc], shots=1000)`. Later in this lab you will pass an
# observable alongside a circuit, and then a whole sweep of parameter values in one PUB
# — one call to `run`, one round trip, one result.

# %% [markdown] role=predict
# ### Predict: a Bell state's counts
# Build the familiar two-qubit Bell circuit from week 02 — `h(0)` then `cx(0, 1)` — and
# add a full measurement. Before you run anything, write down what you expect
# `StatevectorSampler(seed=42).run([bell], shots=1000)` to report.
#
# Specifically: which bitstrings do you expect to see, roughly how often each one, and
# should any bitstring you don't expect show up at all?

# %% role=run
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)
bell.measure_all()

sampler = StatevectorSampler(seed=42)
job = sampler.run([bell], shots=1000)
result = job.result()
pub_result = result[0]

counts = pub_result.data.meas.get_counts()
print("counts:", counts)

# %% role=observe
bitstrings = pub_result.data.meas.get_bitstrings()
print("first 5 bitstrings:", bitstrings[:5])
print("total shots recorded:", sum(counts.values()))
print("distinct outcomes seen:", sorted(counts.keys()))

# %% [markdown] role=explain
# ### Explain: only two outcomes, split roughly in half
# Only `00` and `11` appear. The Bell circuit's `cx(0, 1)` entangles the qubits so that
# a measurement of qubit 0 and a measurement of qubit 1 always agree — `01` and `10`
# have zero probability, not just low probability, so 1000 shots never produces them.
#
# The rough 50/50 split between `00` and `11` comes from the `h(0)` before the `cx`: it
# puts qubit 0 into an equal superposition, and entanglement carries that even split
# onto the pair. The exact counts wobble around 500/500 because sampling is still
# random — `seed=42` only makes that randomness reproducible, not gone.
# `get_bitstrings()` gives you the raw sequence of individual outcomes the counts were
# tallied from — useful when you want the order shots happened in, not just the totals.

# %% role=modify
qr = QuantumRegister(2, "q")
cr = ClassicalRegister(2, "c")
bell_named = QuantumCircuit(qr, cr)
bell_named.h(0)
bell_named.cx(0, 1)
bell_named.measure(qr, cr)

named_result = StatevectorSampler(seed=42).run([bell_named], shots=1000).result()
named_counts = named_result[0].data.c.get_counts()
print("counts via a register named 'c':", named_counts)
print("meas.get_counts() worked because measure_all() names its register 'meas';")
print("data.c worked because we named this register 'c' ourselves.")

# %% role=checkpoint
assert sum(counts.values()) == 1000
assert sum(named_counts.values()) == 1000
assert set(counts.keys()) <= {"00", "11"}
assert set(named_counts.keys()) <= {"00", "11"}
assert 350 < counts.get("00", 0) < 650
assert 350 < counts.get("11", 0) < 650

# %% role=figure
print(bell.draw("text"))
bell.draw("mpl")

# %% role=figure
from qiskit.visualization import plot_histogram

print("counts (text form):", counts)
plot_histogram(counts)

# %% [markdown] role=concept
# ## From counts to a single number
# Suppose you don't want a distribution — you want, for example, how correlated two
# qubits are, expressed as one number you could compare across many circuits. That is
# what `StatevectorEstimator` is for: it takes a circuit with no measurement gates and
# an observable, and returns the expectation value of that observable on the circuit's
# final state.

# %% [markdown] role=concept
# ## Observables as Pauli strings
# `SparsePauliOp("ZZ")` describes the observable $Z \otimes Z$ on a two-qubit circuit:
# one `Z` per qubit, read the same right-to-left way as a bitstring — the rightmost
# character is qubit 0. Every character in the label is one of `I`, `X`, `Y`, `Z`; `I`
# means "ignore this qubit."
#
# `ZZ`'s eigenvalue on a computational-basis state is `+1` when the two qubits agree
# (`00` or `11`) and `-1` when they disagree (`01` or `10`) — the parity of the two
# bits, turned into a sign. `StatevectorEstimator` computes the exact average of that
# quantity over the circuit's state, with no measurement and no sampling noise involved.

# %% [markdown] role=predict
# ### Predict: <ZZ> on the Bell state
# Reuse the Bell circuit, but without the measurement — an `Estimator` circuit carries
# no measure instructions. Predict `<ZZ>` before running it. You already know from the
# Sampler run that `00` and `11` are the only two outcomes, and they agree on parity
# every single time. What does that mean for the exact expectation value?

# %% role=run
bell_no_meas = QuantumCircuit(2)
bell_no_meas.h(0)
bell_no_meas.cx(0, 1)

estimator = StatevectorEstimator()
zz_result = estimator.run([(bell_no_meas, SparsePauliOp("ZZ"))]).result()
zz_ev = zz_result[0].data.evs
print("<ZZ> =", zz_ev)

# %% role=observe
print("type:", type(zz_ev))
print("exactly 1.0?", bool(zz_ev == 1.0))
print("close to 1.0?", bool(np.isclose(zz_ev, 1.0)))

# %% [markdown] role=explain
# ### Explain: exactly +1, every time
# Every shot of the Bell circuit agrees on parity — `00` or `11`, never `01` or `10` —
# so the parity observable `ZZ` has eigenvalue `+1` on every possible outcome.
# Averaging a constant gives that constant back: `<ZZ> = 1`, matching your prediction
# if you reasoned from the counts.
#
# `zz_ev` prints as a value extremely close to `1.0` rather than exactly `1.0` because
# it comes out of floating-point linear algebra on the statevector, not from counting
# integers. That is a different kind of imprecision than sampling noise — it will not
# shrink with more shots, because there are no shots here. `np.isclose` is the right
# tool either way.

# %% role=checkpoint
assert np.isclose(zz_ev, 1.0, atol=1e-6)

# %% [markdown] role=predict
# ### Predict: <ZI> and <XX>
# Two more observables on the same Bell state. `ZI` measures only qubit 0's `Z` and
# ignores qubit 1 — write down your prediction for `<ZI>` using what you know about a
# single qubit that has been through `h(0)`.
#
# `XX` measures $X \otimes X$ instead of $Z \otimes Z$ — the same "parity" idea, but in
# the X basis. Predict whether `<XX>` will land near `0`, near `+1`, or near `-1`, and
# say why before you run it.

# %% role=run
zi_xx_result = estimator.run(
    [
        (bell_no_meas, SparsePauliOp("ZI")),
        (bell_no_meas, SparsePauliOp("XX")),
    ]
).result()
zi_ev = zi_xx_result[0].data.evs
xx_ev = zi_xx_result[1].data.evs
print("<ZI> =", zi_ev)
print("<XX> =", xx_ev)

# %% role=observe
print("<ZI> close to 0:", bool(np.isclose(zi_ev, 0.0, atol=1e-6)))
print("<XX> close to 1:", bool(np.isclose(xx_ev, 1.0, atol=1e-6)))

# %% [markdown] role=explain
# ### Explain: <ZI> is 0, <XX> is also +1
# `<ZI> = 0` because `h(0)` puts qubit 0 into an equal superposition, and ignoring
# qubit 1 (the `I`) leaves you with a fair coin: half `0`, half `1`, average `0`.
# Entanglement doesn't change that marginal — a single qubit pulled out of an entangled
# pair still looks random on its own.
#
# `<XX> = 1` is the more surprising one. The Bell state is not just correlated in the
# `Z` basis — it is correlated in the `X` basis too. If you measured both qubits in the
# `X` basis instead of the computational basis, they would still always agree. That is
# a signature of entanglement specifically, not just correlation: a classical pair of
# coins rigged to always match in `Z` would not also always match in `X`. You do not
# need the full mathematics to use this fact — remember it as "a Bell pair agrees in
# more than one basis," and revisit the details if you continue past week 08.

# %% role=checkpoint
assert np.isclose(zi_ev, 0.0, atol=1e-6)
assert np.isclose(xx_ev, 1.0, atol=1e-6)

# %% [markdown] role=concept
# ## Sweeping a Parameter in one PUB
# A circuit can hold a placeholder value instead of a fixed number: `Parameter("theta")`.
# Week 03 used fixed rotation angles; a `Parameter` lets you defer the choice of angle
# until you call `run`.
#
# Earlier Qiskit versions needed a separate step to swap a `Parameter` for a number
# before running the circuit. The V2 primitives fold that into the PUB itself: the
# third element of an `Estimator` PUB is a list of parameter-value sets, one per point
# you want evaluated. Passing nine sets of values sweeps nine points in a single call
# and gets back an array of nine expectation values — no loop, no nine separate jobs.

# %% [markdown] role=predict
# ### Predict: the shape of <Z> vs theta
# Build a one-qubit circuit with a single `rx(theta, 0)` starting from `|0⟩`, and sweep
# `theta` over nine evenly spaced points from `0` to `2π`. The observable is `Z`.
#
# From week 03: `rx` rotates the qubit's state around the Bloch sphere's X axis.
# Predict the shape of `<Z>` as a function of `theta` — a straight line, a
# cosine-shaped curve, or something else — and predict where its minimum falls.

# %% role=run
theta = Parameter("theta")
sweep_circuit = QuantumCircuit(1)
sweep_circuit.rx(theta, 0)

theta_values = np.linspace(0, 2 * np.pi, 9)
sweep_pub = (sweep_circuit, SparsePauliOp("Z"), [[value] for value in theta_values])

sweep_result = estimator.run([sweep_pub]).result()
evs = sweep_result[0].data.evs
print("evs shape:", evs.shape)

# %% role=observe
for value, ev in zip(theta_values, evs):
    print(f"theta={value:.3f}  <Z>={ev:.3f}")

# %% role=figure
import matplotlib.pyplot as plt

plt.figure(figsize=(5, 3))
plt.plot(theta_values, evs, marker="o")
plt.axhline(0, linewidth=0.5, color="gray")
plt.xlabel("theta (radians)")
plt.ylabel("<Z>")
plt.title("Estimator sweep: <Z> vs theta")

print("theta values:", np.round(theta_values, 3))
print("<Z> values:  ", np.round(evs, 3))

# %% [markdown] role=explain
# ### Explain: a cosine, minimum at theta = pi
# `<Z>` traces a cosine curve: `1` at `theta=0`, falling through `0` near `theta=pi/2`,
# down to `-1` at `theta=pi`, and back up to `1` at `theta=2pi`. `rx(theta, 0)` rotates
# the qubit's state by `theta` around the Bloch sphere's X axis starting from `|0⟩` — at
# `theta=pi` that rotation has carried the qubit all the way to `|1⟩`, whose `Z`
# eigenvalue is `-1`. Nine evenly spaced points is enough to see the shape even though
# it is not enough to trace a perfectly smooth curve.

# %% role=checkpoint
minimum_index = int(np.argmin(evs))
assert abs(theta_values[minimum_index] - np.pi) < 0.4
assert evs[minimum_index] < -0.9

# %% role=modify
mixed_obs = 0.5 * SparsePauliOp("ZZ") + 0.5 * SparsePauliOp("XX")
mixed_result = estimator.run([(bell_no_meas, mixed_obs)]).result()
mixed_ev = mixed_result[0].data.evs
print("<0.5*ZZ + 0.5*XX> =", mixed_ev)

# %% role=checkpoint
assert np.isclose(mixed_ev, 1.0, atol=1e-6)

# %% [markdown] role=note
# ## Deliverable: primitive selection
# Five tasks below. For each one, decide whether `Sampler` or `Estimator` answers it,
# and write your answer next to it. There is no code cell here — this is a decision
# exercise, and the challenge notebook turns it into a dict Python can check.
#
# | # | Task | Which primitive? |
# |---|------|-------------------|
# | 1 | Get the full distribution of measurement outcomes from a Grover circuit. | ____ |
# | 2 | Compute the expectation value of a cost Hamiltonian to score one set of variational parameters. | ____ |
# | 3 | Find the single most frequent bitstring a circuit produces over many shots. | ____ |
# | 4 | Track how `<Z>` changes as a variational parameter sweeps across a range of values, in one call. | ____ |
# | 5 | Read the final value of a named classical register after a circuit with a mid-circuit measurement. | ____ |
#
# Write your five answers down — as `"sampler"` or `"estimator"` — before you open the
# challenge notebook.

# %% [markdown] role=summary
# ## Summary
# You ran both V2 primitives locally: `StatevectorSampler` for outcome distributions,
# read off a register by name (`meas` or `c`), and `StatevectorEstimator` for exact
# expectation values of `SparsePauliOp` observables on unmeasured circuits. You swept a
# `Parameter` across nine values in one PUB instead of nine separate calls, and matched
# the shape of the result to a rotation you predicted from week 03.
#
# The primitive-selection table above carries into the challenge, where you turn it
# into a dict Python can check.
#
# One question worth sitting with: `StatevectorEstimator` gave you exact numbers with
# no sampling noise. A real QPU cannot do that — every expectation value it reports is
# itself estimated from a finite number of shots. What does that change about how much
# you should trust a single `<Z>` reading from hardware, compared to what you saw here?
