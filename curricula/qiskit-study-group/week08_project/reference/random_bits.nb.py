# ---
# title: "Week 08 — Reference: quantum random bit generator"
# kind: solution
# summary: >-
#   Complete reference implementation of the random-bits project template: a
#   circuit-backed bit generator plus a bias check and a runs check on a 500-bit stream.
# objectives:
#   - Show a complete, working generate_bits pipeline built on SamplerV2
#   - Demonstrate a bias check and a runs check passing on the same stream
#   - State plainly what the PRNG-based simulator does and does not demonstrate
# prerequisites:
#   - templates/random_bits.nb.py attempted first
# duration_minutes: 20
# ---

# %% [markdown] role=objective
# ## Reference solution: quantum random bit generator
# This is the complete answer to `templates/random_bits.nb.py`: a `generate_bits`
# function backed by a one-qubit circuit and `SamplerV2`, a bias check, and a runs
# check, both passing on a 500-bit stream. Read this after attempting the template
# yourself — the milestone prompts below are the same ones the template poses; each is
# followed by the working implementation.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
from qiskit.visualization import plot_histogram

print(f"qiskit {qiskit.__version__}")
assert qiskit.__version__.startswith("2.5"), (
    f"expected Qiskit 2.5.x, found {qiskit.__version__} instead"
)

# %% [markdown] role=exercise
# ### Milestone 1 — generate a bitstream
# Build `generate_bits(n_bits, base_seed=42)`: for each of the `n_bits` positions,
# build a one-qubit H circuit, sample it with `shots=1` and `seed=base_seed + i`, and
# record which single outcome came back.

# %% role=solution
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
_preview_qc = QuantumCircuit(1)
_preview_qc.h(0)
_preview_qc.measure_all()
print(_preview_qc.draw("text"))
_preview_qc.draw("mpl")

# %% [markdown] role=exercise
# ### Milestone 2 — check for bias
# Generate a 500-bit stream and compute the fraction that came back `"1"`. A fair
# generator should land near 0.5, not on it exactly — sampling noise applies to 500
# independent draws the same way it applied to the 100-shot run in Week 00.

# %% role=solution
stream = generate_bits(500)
fraction_ones = stream.count("1") / len(stream)
n_ones = stream.count("1")
n_zeros = len(stream) - n_ones
print(f"stream length: {len(stream)}")
print(f"count of 1s: {n_ones}, count of 0s: {n_zeros}")
print(f"fraction of 1s: {fraction_ones:.3f}")

# %% role=figure
print(f"0: {n_zeros}, 1: {n_ones}")
plot_histogram({"0": n_zeros, "1": n_ones})

# %% [markdown] role=exercise
# ### Milestone 3 — check for clumping with a runs test
# Count the runs (maximal streaks of the same bit) in the stream and compare against
# the expected count and spread for a fair, unclumped sequence of the same length and
# bit balance:
#
# ```
# mu    = 2 * n1 * n0 / n + 1
# sigma = sqrt(2 * n1 * n0 * (2 * n1 * n0 - n) / (n**2 * (n - 1)))
# z     = (observed_runs - mu) / sigma
# ```

# %% role=solution
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
assert 0.40 < fraction_ones < 0.60, f"stream looks biased: fraction of 1s = {fraction_ones:.3f}"
assert abs(runs_z) < 3.5, f"runs test flagged this stream: z = {runs_z:.3f}"

# %% [markdown] role=note
# ## This is a PRNG, and that is the point
# `StatevectorSampler` is a classical simulator: given a seed, its output is fully
# determined, so re-running this notebook reproduces the exact same 500-bit stream
# every time. That is not a shortcut around the exercise — the circuit, the per-shot
# sampling call, and the bias/runs checks above are exactly the pipeline you would point
# at a real QPU's hardware-sourced randomness in the hardware bonus chapter. What this
# reference solution demonstrates is that the pipeline is correct, not a claim about
# where the randomness ultimately comes from in simulation.

# %% [markdown] role=summary
# ## What this reference shows
# `generate_bits` built on a real Qiskit circuit and `SamplerV2`, a bias check and a
# runs check both passing on a 500-bit stream, and an explicit statement of what a
# simulated "random" bit generator does and does not prove. Compare this against your
# own `templates/random_bits.nb.py` attempt, then use `CHECKLIST.md` for your team's
# self-evaluation before the demo.
