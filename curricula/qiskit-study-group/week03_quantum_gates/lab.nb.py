# ---
# title: Week 03 — Gates and state
# kind: lab
# summary: Read a circuit's amplitudes with Statevector before any measurement, predict what RX, RY and RZ do to |0>, and turn an invisible phase into a visible flip.
# objectives:
#   - Read a circuit's amplitudes with Statevector before adding a measurement
#   - Predict and verify what RX, RY and RZ do to a qubit starting at |0>
#   - Explain why a phase difference is invisible in counts until interference reveals it
#   - Read a Bloch-sphere picture in terms of probability and phase
# prerequisites:
#   - Week 02 entanglement lab completed (CX, Bell state, bitstring order)
# duration_minutes: 90
# ---

# %% [markdown] role=objective
# ## What you will build
# Last week you sampled circuits and counted outcomes. This week you look underneath
# the counts, at the numbers Qiskit computes before it ever takes a measurement.
#
# You will use `Statevector` to read those numbers directly, predict what three
# rotation gates — `RX`, `RY`, `RZ` — do to a qubit starting at `|0>`, and check each
# prediction before you see the answer. One of the three gates will change nothing you
# can measure, which looks like a bug until you see why. Then you will turn that
# invisible change into a visible one using two Hadamard gates, and read the same idea
# off a Bloch-sphere picture.
#
# By the end you can predict the outcome probabilities of a single-qubit rotation
# circuit without running it — this week's deliverable is a set of gate-prediction
# experiments you can reuse on circuits of your own.

# %% [markdown] role=concept
# ## The minimum math this week adds
# Every notebook so far has treated a circuit as a black box you sample. This week
# opens it partway, with three ideas and no matrices.
#
# **Amplitude.** For a single qubit, Qiskit tracks two complex numbers — one attached
# to outcome `0`, one to outcome `1`. Each is called an amplitude. You never type these
# numbers in; every gate updates them as the circuit runs.
#
# **Probability.** The probability of measuring an outcome is the squared magnitude of
# its amplitude: `probability = |amplitude| ** 2`. An amplitude can be a complex
# number, so "squared magnitude" means multiplying it by its own complex conjugate —
# Python does that for you with `abs(amplitude) ** 2`.
#
# **Phase.** An amplitude has a size and a direction: in the complex plane, a distance
# from zero and an angle. The size sets the probability. The angle is the phase, and
# two states can share every probability while disagreeing only on phase. Counts alone
# never show you a phase directly. You need either a picture (the Bloch sphere, later
# in this lab) or a second gate that turns a phase difference into a probability
# difference (the interference experiment, also later in this lab).
#
# No matrices are required to use any of this. `Statevector` computes the amplitudes
# for you — you only need to read them.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
from qiskit.quantum_info import Operator, Statevector
from qiskit.visualization import plot_bloch_multivector, plot_histogram
import numpy as np

print("Qiskit version:", qiskit.__version__)

# %% [markdown] role=concept
# ### Looking at the state before you measure
# `Statevector(qc)` runs a circuit exactly, the way the simulator does internally, and
# hands you the amplitudes instead of a sample. It needs no shots and no randomness —
# the same circuit always gives the same `Statevector`, because it answers what the
# circuit computed, not what one imagined measurement would return.

# %% role=run
qc = QuantumCircuit(1)
sv = Statevector(qc)
print(sv)
print(sv.probabilities_dict())

# %% [markdown] role=note
# The dictionary prints `{'0': 1.0}` — probability 1 for outcome `0`; outcome `1`
# doesn't even appear, because an outcome with exactly zero probability is left out of
# the dictionary entirely. Keep that in mind below — check a probability with
# `.get("1", 0.0)` rather than indexing directly, or a perfectly ordinary zero will
# raise a `KeyError`.
#
# You may also notice the keys and values print as `np.str_('0')` and
# `np.float64(1.0)` rather than plain `'0'` and `1.0` — that is only how NumPy chooses
# to display its own number and string types. They compare and hash exactly like the
# plain Python versions, so `probs.get("1", 0.0)` works whether or not the key you are
# matching against was ever a plain `str`.
#
# The printed `Statevector` line shows the raw amplitudes: `1` for `0`, `0` for `1` —
# no surprises yet, since no gate has been added.

# %% [markdown] role=predict
# ### Experiment 1 — RX(pi/2)
# `RX(theta)` rotates the qubit by an angle `theta`, around an axis you have not used
# yet. Before running anything: `qc.rx(np.pi / 2, 0)` applied to a qubit starting at
# `|0>`. Write down your own guess for `P(0)` and `P(1)` — equal, or one much larger
# than the other? And do you expect both amplitudes to be plain real numbers, the way
# they were for `|0>` above?

# %% role=run
qc = QuantumCircuit(1)
qc.rx(np.pi / 2, 0)
sv = Statevector(qc)
print(qc.draw("text"))
print(sv)
print(sv.probabilities_dict())

# %% [markdown] role=observe
# The probabilities come out at 0.5 and 0.5 — a fair coin, same as `H` gave you in
# week 01. But look at the amplitudes themselves: about `0.7071` for `|0>` and about
# `-0.7071j` for `|1>`. The second one is not a real number at all — it is purely
# imaginary.

# %% [markdown] role=explain
# `RX` rotates the qubit around a different axis than `H` does, so two circuits can
# land on the same probabilities by different routes through amplitude space. This is
# the first concrete case of the phase idea from above: probability only reads the
# size of an amplitude, so two states that differ only in phase, or only in which axis
# produced them, can still measure identically. You cannot tell `RX(pi/2)|0>` apart
# from `H|0>` by sampling alone — the counts really do look the same either way.
# `Statevector` is the tool that shows you they are not the same state.

# %% role=modify
for angle_name, angle in [("pi/4", np.pi / 4), ("pi", np.pi)]:
    qc = QuantumCircuit(1)
    qc.rx(angle, 0)
    sv = Statevector(qc)
    print(f"RX({angle_name}):", sv.probabilities_dict())

# %% [markdown] role=predict
# ### Experiment 2 — RY(pi/2)
# Same question, a different axis: `qc.ry(np.pi / 2, 0)` on a qubit starting at `|0>`.
# Guess `P(0)` and `P(1)` again, and this time also guess whether the amplitudes will
# come out as plain real numbers or with an imaginary part, based on what you just saw
# for `RX`.

# %% role=run
qc = QuantumCircuit(1)
qc.ry(np.pi / 2, 0)
sv = Statevector(qc)
print(qc.draw("text"))
print(sv)
print(sv.probabilities_dict())

# %% [markdown] role=observe
# Both probabilities are 0.5 again, and this time both amplitudes are plain real
# numbers — about `0.7071` and `0.7071`, no `j` anywhere. That is exactly what `H|0>`
# gave you in week 01.

# %% [markdown] role=explain
# `RY(pi/2)` and `H` do not just agree on probabilities here — they land on the
# identical state. `H` is one fixed gate; `RY(theta)` is a whole family of gates
# indexed by an angle, and at `theta = pi/2` that family happens to pass through the
# same point `H` sits at. This is also a first look at why the axis matters:
# `RX(pi/2)` and `RY(pi/2)` both split `|0>` 50/50, but along different amplitude
# directions — exactly the "size vs. direction" distinction from the concept cell
# above. Size (probability) matched; direction (phase) did not.

# %% role=modify
for angle_name, angle in [("pi/6", np.pi / 6), ("pi", np.pi)]:
    qc = QuantumCircuit(1)
    qc.ry(angle, 0)
    sv = Statevector(qc)
    print(f"RY({angle_name}):", sv.probabilities_dict())

# %% [markdown] role=predict
# ### Experiment 3 — RZ(pi/2)
# One more axis: `qc.rz(np.pi / 2, 0)` on a qubit starting at `|0>`. `RX` and `RY`
# both moved probability away from `P(0) = 1`. Guess whether `RZ` will do the same —
# and if your guess is "no change," guess why a gate could exist that changes the
# state but leaves every probability exactly where it started.

# %% role=run
qc = QuantumCircuit(1)
qc.rz(np.pi / 2, 0)
sv = Statevector(qc)
print(qc.draw("text"))
print(sv)
print(sv.probabilities_dict())

# %% [markdown] role=observe
# `probabilities_dict()` prints `{'0': 1.0}` — outcome `1` does not appear at all,
# because its probability is exactly zero, not just small. The state did change,
# though: the printed `Statevector` shows the amplitude of `|0>` is now about
# `0.7071 - 0.7071j` instead of plain `1`. But `abs(0.7071 - 0.7071j) ** 2` is still
# `1.0`, so the probability you would measure has not moved at all.

# %% [markdown] role=explain
# `RZ` rotates phase without moving probability between outcomes — that is what the
# gate is for. Starting from `|0>`, there is only one outcome with any probability, so
# a gate that only touches phase has nothing to redistribute: `|0>`'s phase changed,
# but since `|1>`'s amplitude was zero both before and after, there is no second
# outcome for that phase difference to show up against. Sampling this circuit, however
# many shots you use, gives you `{'0': 1000}` every time — `RZ` alone, applied to
# `|0>`, is invisible to counts. That is not a limitation of Qiskit; a real device
# could not distinguish these two states by measurement either. The next experiment
# shows how you make the phase visible.

# %% role=modify
for angle_name, angle in [("pi/4", np.pi / 4), ("pi", np.pi)]:
    qc = QuantumCircuit(1)
    qc.rz(angle, 0)
    sv = Statevector(qc)
    print(f"RZ({angle_name}):", sv.probabilities_dict())

# %% [markdown] role=predict
# ### Experiment 4 — turning a phase into a flip
# Apply `H`, then `Z`, then `H` again to a qubit starting at `|0>`. You already know
# `Z` alone applied to `|0>` changes nothing measurable, for the same reason `RZ` did
# not: `Z` only touches phase, and `|0>` has no second outcome for phase to act
# against. Now that the first `H` puts some amplitude on `|1>`, guess what `Z` does to
# that amplitude, and then guess what the second `H` does with the result. Will `P(1)`
# end up at 0, at 0.5, or somewhere else?

# %% role=run
qc = QuantumCircuit(1)
qc.h(0)
qc.z(0)
qc.h(0)
sv = Statevector(qc)
print(qc.draw("text"))
print(sv)
print(sv.probabilities_dict())

# %% [markdown] role=observe
# `P(1)` comes out at 1.0 — this circuit takes `|0>` to `|1>` exactly, every time,
# with no randomness at all. Two `H` gates around a phase gate produced a full flip.

# %% [markdown] role=explain
# The first `H` puts equal amplitude on `|0>` and `|1>`. `Z` leaves `|0>`'s amplitude
# alone and flips the sign of `|1>`'s — a phase change invisible on its own, exactly
# like `RZ` on `|0>` was invisible. But now there are two nonzero amplitudes to
# compare, and the second `H` combines them by addition: where the two amplitudes
# agree in sign, they add up (constructive interference); where they disagree, they
# cancel (destructive interference). The sign `Z` flipped on `|1>` is what decides
# which outcome gets the addition and which gets the cancellation. This is
# interference: a phase difference you could not see in counts before, converted into
# a probability difference you can. Nothing about this needed a matrix — you can trace
# the whole thing in "amplitudes add" terms.

# %% role=modify
for angle_name, angle in [("0", 0.0), ("pi/3", np.pi / 3), ("pi/2", np.pi / 2), ("pi", np.pi)]:
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.rz(angle, 0)
    qc.h(0)
    sv = Statevector(qc)
    print(f"H-RZ({angle_name})-H:", sv.probabilities_dict())

# %% [markdown] role=note
# ### Checking the flip with real measurement
# Everything above came from `Statevector`, which never uses randomness. You can also
# confirm it the way you did in week 01 and week 02 — add a measurement and sample
# with shots. If the interference story is right, sampling the `H`, `Z`, `H` circuit
# should give outcome `1` on essentially every shot, with only the small fluctuation
# shots always bring.

# %% role=figure
qc = QuantumCircuit(1)
qc.h(0)
qc.z(0)
qc.h(0)
qc.measure_all()

sampler = StatevectorSampler(seed=42)
counts = sampler.run([qc], shots=1000).result()[0].data.meas.get_counts()
print(counts)
plot_histogram(counts)

# %% [markdown] role=concept
# ### Seeing amplitude and phase together
# A single qubit's `Statevector` carries exactly enough information to draw as one
# point on a sphere — the Bloch sphere. How far the point sits from the north pole
# encodes the probability split (`P(0)` vs. `P(1)`); which direction it points around
# the sphere's vertical axis encodes the phase. A gate like `RZ`, which only changes
# phase, only spins the point around that vertical axis — which is exactly why it
# never changes how close the point sits to either pole, and so never changes
# probability.

# %% role=figure
qc = QuantumCircuit(1)
qc.ry(np.pi / 3, 0)
qc.rz(np.pi / 4, 0)
sv = Statevector(qc)

print(sv)
print(sv.probabilities_dict())
plot_bloch_multivector(sv)

# %% [markdown] role=explain
# `RY(pi/3)` alone would put the point partway down from the north pole, splitting
# probability 0.75/0.25 the way experiment 2's family did. Adding `RZ(pi/4)` afterward
# does not move the point up or down at all — it only spins it further around the
# vertical axis, a phase you cannot read from `probabilities_dict()` but can read
# straight off this picture.

# %% [markdown] role=concept
# ### One table of numbers for the whole circuit
# Every amplitude you printed above came from somewhere: Qiskit represents a circuit's
# full effect as one table of complex numbers, called a unitary operator, and
# multiplies your starting state through it. You do not need to read a single entry of
# that table to use this course — `Statevector` already does the multiplying — but it
# helps to see the table is just an object like any other, not a separate kind of
# magic.

# %% role=run
qc = QuantumCircuit(1)
qc.h(0)
qc.z(0)
print(Operator(qc))

# %% [markdown] role=observe
# `Operator(qc)` printed a 2-by-2 grid of complex numbers — one table for the whole
# `H`, `Z` sequence. `Statevector(qc)` is what you get from multiplying that table by
# the starting state `|0>`. You will not need to construct or read one of these tables
# by hand in this course; the point is only that "the circuit" and "a table of
# numbers" are the same object viewed two ways, so nothing you saw above was ever a
# black box, even before you had `Statevector` to look inside it.

# %% role=checkpoint
# RY(pi/3) on |0> matches the closed-form probabilities cos^2(theta/2), sin^2(theta/2).
# This is deterministic (no sampling), so the tolerance below is only for floating-point
# rounding, not for shot noise.
qc = QuantumCircuit(1)
qc.ry(np.pi / 3, 0)
probs = Statevector(qc).probabilities_dict()

expected_p0 = np.cos(np.pi / 6) ** 2
expected_p1 = np.sin(np.pi / 6) ** 2
assert np.isclose(probs.get("0", 0.0), expected_p0, atol=1e-6), probs
assert np.isclose(probs.get("1", 0.0), expected_p1, atol=1e-6), probs
print("checkpoint 1 ok:", probs)

# %% role=checkpoint
# RZ never moves probability away from |0>, at any angle — a phase-only gate applied
# to a state with no second outcome has nothing to redistribute.
baseline = Statevector(QuantumCircuit(1)).probabilities()
for angle in (np.pi / 5, np.pi / 2, np.pi, 1.7 * np.pi):
    qc = QuantumCircuit(1)
    qc.rz(angle, 0)
    probs = Statevector(qc).probabilities()
    assert np.allclose(probs, baseline, atol=1e-6), f"RZ({angle}) changed probabilities: {probs}"
print("checkpoint 2 ok: RZ left probabilities unchanged at every angle tried")

# %% [markdown] role=summary
# ## What you built, and what is still open
# You can now read a circuit's amplitudes directly with `Statevector`, before any
# measurement, and explain three things counts alone cannot: why `RX(pi/2)` and `H`
# can agree on probability while disagreeing on amplitude, why `RZ` alone applied to
# `|0>` is invisible to sampling, and how two `H` gates turn an invisible phase
# difference into a full, visible flip. You also know `probabilities_dict()`'s one
# sharp edge — it drops outcomes at exactly zero probability — and a Bloch-sphere
# reading of the same idea: distance from a pole is probability, rotation around the
# vertical axis is phase.
#
# One question worth carrying into the challenge: every experiment above started from
# `|0>`. If you started from `RY(pi/2)|0>` instead — a state already split 50/50 —
# would `Z` still be invisible on its own, or would it show up in the counts this
# time? The gate-prediction challenge asks you to work that kind of question out
# before you run it.
