# ---
# title: "Week 08 — Project template: quantum random bit generator"
# kind: project
# summary: >-
#   Build a quantum random bit generator from a single-qubit circuit, then check the
#   resulting bitstream for bias and clumping the way you would check any RNG.
# objectives:
#   - Generate a reproducible bitstream from a Qiskit circuit sampled with SamplerV2
#   - Run a bias check and a runs check against that bitstream
#   - Explain what a quantum circuit adds when the simulator itself is a seeded PRNG
# prerequisites:
#   - Week 01 — X, H gate, measurement, shots
#   - Week 02 — bitstring order (qubit 0 is the rightmost character)
#   - Week 05 — SamplerV2 and result objects
# duration_minutes: 90
# ---

# %% [markdown] role=objective
# ## What your team will build
# A function `generate_bits(n_bits)` that returns a string of `n_bits` characters, each
# `"0"` or `"1"`, produced by sampling a one-qubit circuit — then a short statistical
# report on that stream: is it biased toward one value, and does it clump into long
# streaks more than a fair sequence should? This is the "random bits" template from the
# Week 08 project brief (`README.md`). Work through the three milestones below, then use
# `reference/random_bits.nb.py` to compare your approach once your checkpoint passes.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

print(f"qiskit {qiskit.__version__}")
assert qiskit.__version__.startswith("2.5"), (
    f"expected Qiskit 2.5.x, found {qiskit.__version__} instead"
)

# %% [markdown] role=concept
# ## One circuit, sampled many times
# The circuit itself is the one from Week 01: a single qubit, a Hadamard gate, a
# measurement. Sampled once, it returns one random bit. `StatevectorSampler` is
# deterministic given its seed, so calling it once per bit — with a different seed each
# time — is what makes the stream vary from run to run while still being reproducible
# for grading. Reusing one `StatevectorSampler` instance across calls does **not**
# advance its randomness on its own; the seed you pass each call is what determines the
# outcome.

# %% [markdown] role=exercise
# ### Milestone 1 — generate a bitstream
# Complete (or extend) `generate_bits(n_bits, base_seed=42)` below: for each of the
# `n_bits` positions, build the one-qubit H circuit, sample it with `shots=1` and
# `seed=base_seed + i`, and record which single outcome came back. Run the cell and
# read the 20-bit preview it prints — it should look irregular, not like `0101010101…`
# or a single repeated digit.

# %% role=run
def generate_bits(n_bits, base_seed=42):
    """Return a string of n_bits random bits, one single-shot circuit run per bit."""
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.measure_all()
    bits = []
    for i in range(n_bits):
        sampler = StatevectorSampler(seed=base_seed + i)
        counts = sampler.run([qc], shots=1).result()[0].data.meas.get_counts()
        bits.append(next(iter(counts)))
    return "".join(bits)


preview = generate_bits(20)
print(f"20-bit preview: {preview}")

# %% role=figure
# The circuit behind every bit in the stream: one qubit, one Hadamard, one measurement.
_preview_qc = QuantumCircuit(1)
_preview_qc.h(0)
_preview_qc.measure_all()
print(_preview_qc.draw("text"))
_preview_qc.draw("mpl")

# %% [markdown] role=exercise
# ### Milestone 2 — check for bias
# A generator that returns `"1"` 90% of the time is not useful no matter how "quantum"
# the circuit is. Before you run the cell below, predict: for a 500-bit stream from a
# genuinely fair generator, do you expect the fraction of 1s to land within 0.01 of
# 0.500, within 0.05, or could it plausibly drift as far as 0.10 away just from sampling
# noise? Then generate a longer stream — 500 bits — and compute the fraction that came
# back `"1"`. A fair generator should land near 0.5; it will not land on exactly 0.5,
# because each bit is an independent sample and small samples fluctuate (the same
# sampling noise from Week 00 and Week 01, just spread across 500 draws instead of two).

# %% role=run
stream = generate_bits(500)
fraction_ones = stream.count("1") / len(stream)
print(f"stream length: {len(stream)}")
print(f"fraction of 1s: {fraction_ones:.3f}")

# %% [markdown] role=exercise
# ### Milestone 3 — check for clumping with a runs test
# Bias is not the only way a generator can be broken: `01010101…` has exactly half 1s
# and is still useless, because it never varies. A **run** is a maximal streak of the
# same bit (`"1101100"` has runs `11`, `0`, `11`, `00` — four runs). For a fair, unclumped
# sequence of `n` bits with `n1` ones and `n0` zeros, the expected number of runs and its
# spread are:
#
# ```
# mu    = 2 * n1 * n0 / n + 1
# sigma = sqrt(2 * n1 * n0 * (2 * n1 * n0 - n) / (n**2 * (n - 1)))
# z     = (observed_runs - mu) / sigma
# ```
#
# `z` near 0 means the observed run count matches what a fair sequence would produce;
# a large `|z|` (conventionally beyond about 3) means the stream clumps or alternates
# more than chance would explain. Predict before you run the cell below: do you expect
# this stream's `z` to land comfortably under 1, somewhere in the 1–3 range, or close to
# the checkpoint's 3.5 cutoff?

# %% role=run
def runs_test(bit_string):
    n = len(bit_string)
    n1 = bit_string.count("1")
    n0 = n - n1
    runs = 1
    for i in range(1, n):
        if bit_string[i] != bit_string[i - 1]:
            runs += 1
    mu = (2 * n1 * n0) / n + 1
    variance = (2 * n1 * n0 * (2 * n1 * n0 - n)) / (n**2 * (n - 1))
    sigma = variance**0.5
    z = (runs - mu) / sigma
    return runs, mu, sigma, z


observed_runs, expected_runs, runs_sigma, runs_z = runs_test(stream)
print(f"observed runs: {observed_runs}")
print(f"expected runs (mu): {expected_runs:.2f}, sigma: {runs_sigma:.2f}")
print(f"z-score: {runs_z:.3f}")

# %% role=checkpoint
assert len(stream) == 500, f"expected 500 bits, got {len(stream)}"
# Bias band: a fair stream's fraction of 1s should sit near 0.5, not equal to it.
assert 0.40 < fraction_ones < 0.60, f"stream looks biased: fraction of 1s = {fraction_ones:.3f}"
# Runs band: |z| well beyond about 3 would flag clumping or over-alternation.
assert abs(runs_z) < 3.5, f"runs test flagged this stream: z = {runs_z:.3f}"

# %% [markdown] role=note
# ## This is a PRNG, and that is the point
# `StatevectorSampler` is a classical simulator. Given a seed, its output is completely
# determined — it is a pseudo-random number generator, not a source of physical
# randomness, and re-running this notebook reproduces the exact same stream every time.
# That is not a shortcut around the exercise: the circuit, the sampling call, and the
# statistical checks above are the same pipeline you would point at a real QPU's
# hardware-sourced randomness in the hardware bonus chapter. The lesson here is the
# pipeline, not a claim about where the randomness came from.

# %% [markdown] role=exercise
# ### Optional stretch — before the demo
# If your checkpoint passes with time to spare, try one modification and be ready to
# explain what changed and why: sample two qubits per shot instead of one (does the
# bias or runs check still pass?), or reduce `base_seed` variation to a single fixed
# seed for every draw and see the checkpoint fail — that failure is itself worth
# showing at the demo, since it demonstrates the check actually checks something.

# %% [markdown] role=summary
# ## What your team has now
# A working `generate_bits` function backed by a real Qiskit circuit and `SamplerV2`,
# plus a bias check and a runs check that both passed on a 500-bit stream. For the demo:
# be ready to state your prediction for the bias and runs checks before you ran them,
# show the checkpoint passing, and explain the one modification you tried. Compare your
# implementation with `reference/random_bits.nb.py` before the session ends.
