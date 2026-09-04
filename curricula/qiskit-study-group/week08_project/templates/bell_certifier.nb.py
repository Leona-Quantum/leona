# ---
# title: "Week 08 — Project template: Bell-pair certifier"
# kind: project
# summary: >-
#   Certify a Bell pair by measuring it in two different bases with SamplerV2 and
#   checking that both correlation coefficients land near +1.
# objectives:
#   - Build a Bell pair and measure it in the Z basis and the X basis with SamplerV2
#   - Compute a correlation coefficient from raw counts in each basis
#   - Explain why two correlated bases is stronger evidence than one, using a
#     non-entangled control circuit as contrast
# prerequisites:
#   - Week 02 — CX gate, Bell state, correlation, bitstring order
#   - Week 03 — rotations (H before measurement changes which basis you measure)
#   - Week 05 — SamplerV2 and result objects
# duration_minutes: 90
# ---

# %% [markdown] role=objective
# ## What your team will build
# A "certifier" for a Bell pair: a function that measures a two-qubit circuit in the
# computational (Z) basis and again in the X basis, and reports a correlation
# coefficient for each. A genuinely entangled Bell pair correlates in both bases; a
# circuit that only looks correlated by coincidence in one basis will not survive the
# second check. This is the "Bell certifier" template from the Week 08 project brief
# (`README.md`). Work through the milestones below, then compare with
# `reference/bell_certifier.nb.py`.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

print(f"qiskit {qiskit.__version__}")
assert qiskit.__version__.startswith("2.5"), (
    f"expected Qiskit 2.5.x, found {qiskit.__version__} instead"
)

# %% [markdown] role=concept
# ## Recap: the Bell pair and basis rotation
# `h(0)` then `cx(0, 1)` builds the Bell state from Week 02 — measuring it in the Z
# basis (a plain `measure_all()`) should only ever produce `00` or `11`, never `01` or
# `10`. To measure in the X basis instead, apply `h` to both qubits immediately before
# `measure_all()`: `H` swaps the X and Z bases, so measuring Z after that extra `H` is
# the same as measuring X on the state you actually built. Both weeks — 02's CX and
# 03's basis rotation — are what this project template puts together.

# %% [markdown] role=exercise
# ### Milestone 1 — build the pair, measure ZZ
# Complete `bell_pair()` below, then `zz_correlation(shots=2000, seed=42)`, which
# measures the pair in the Z basis and returns a correlation coefficient: map each
# qubit's bit to `+1` for `"0"` and `-1` for `"1"`, multiply the two qubits' values for
# each shot, and average over all shots (weighted by count). A perfectly correlated
# pair gives exactly `+1.0`.

# %% role=run
def bell_pair():
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    return qc


def correlation_from_counts(counts):
    """Map each qubit's bit to +-1 (0 -> +1, 1 -> -1) and average the per-shot product."""
    total = sum(counts.values())
    weighted_sum = 0
    for bitstring, count in counts.items():
        bit_q0 = bitstring[-1]
        bit_q1 = bitstring[-2]
        value_q0 = 1 if bit_q0 == "0" else -1
        value_q1 = 1 if bit_q1 == "0" else -1
        weighted_sum += value_q0 * value_q1 * count
    return weighted_sum / total


def zz_correlation(shots=2000, seed=42):
    qc = bell_pair()
    qc.measure_all()
    counts = StatevectorSampler(seed=seed).run([qc], shots=shots).result()[0].data.meas.get_counts()
    return counts, correlation_from_counts(counts)


zz_counts, corr_zz = zz_correlation()
print(f"ZZ counts: {zz_counts}")
print(f"ZZ correlation: {corr_zz:.3f}")

# %% role=figure
_zz_qc = bell_pair()
_zz_qc.measure_all()
print(_zz_qc.draw("text"))
from qiskit.visualization import plot_histogram

plot_histogram(zz_counts)

# %% [markdown] role=exercise
# ### Milestone 2 — rotate to the X basis, measure XX
# Write `xx_correlation(shots=2000, seed=42)`: build the same Bell pair, apply `h` to
# both qubits, measure, and reuse `correlation_from_counts` on the result. Before you
# run it, predict: for the ideal Bell state `(|00> + |11>) / sqrt(2)`, do you expect the
# XX correlation to land near `+1`, near `-1`, or near `0`?

# %% role=run
def xx_correlation(shots=2000, seed=42):
    qc = bell_pair()
    qc.h(0)
    qc.h(1)
    qc.measure_all()
    counts = StatevectorSampler(seed=seed).run([qc], shots=shots).result()[0].data.meas.get_counts()
    return counts, correlation_from_counts(counts)


xx_counts, corr_xx = xx_correlation()
print(f"XX counts: {xx_counts}")
print(f"XX correlation: {corr_xx:.3f}")

# %% role=figure
_xx_qc = bell_pair()
_xx_qc.h(0)
_xx_qc.h(1)
_xx_qc.measure_all()
print(_xx_qc.draw("text"))
plot_histogram(xx_counts)

# %% role=checkpoint
# Both bases should certify the pair: near +1, not just close to it by chance.
assert corr_zz > 0.9, f"ZZ correlation too low to certify entanglement: {corr_zz:.3f}"
assert corr_xx > 0.9, f"XX correlation too low to certify entanglement: {corr_xx:.3f}"

# %% [markdown] role=exercise
# ### Milestone 3 — a non-entangled control
# A single correlated basis is not by itself proof of entanglement — a coincidence or a
# classically-correlated (but unentangled) pair could pass one check. Build a control
# circuit with `h` on each qubit and **no** `cx`, measure it in the Z basis with the same
# helper, and confirm its correlation sits near 0 — two independent coins, not a pair.

# %% role=run
def independent_pair():
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.h(1)
    return qc


control_qc = independent_pair()
control_qc.measure_all()
control_counts = (
    StatevectorSampler(seed=42).run([control_qc], shots=2000).result()[0].data.meas.get_counts()
)
corr_control = correlation_from_counts(control_counts)
print(f"control counts: {control_counts}")
print(f"control correlation: {corr_control:.3f}")

# %% role=checkpoint
assert abs(corr_control) < 0.3, (
    f"control circuit should show near-zero correlation, got {corr_control:.3f} — "
    "check that it has no cx gate"
)

# %% [markdown] role=explain
# ZZ and XX both landing near `+1` — while the no-`cx` control lands near `0` — is what
# makes this a certifier rather than a single lucky measurement. A classical process
# that fakes correlation in one fixed basis (say, always agreeing on Z) will not also
# agree in a second, unrelated basis unless it is actually entangled. That is the same
# logic behind a Bell inequality test, kept to the two bases this course has covered.

# %% [markdown] role=summary
# ## What your team has now
# A `bell_pair()` circuit, a shared `correlation_from_counts` helper, ZZ and XX
# correlation checks that both pass, and a non-entangled control that does not. For the
# demo: state your XX prediction from Milestone 2 before showing the result, and be
# ready to explain the control circuit as your "one modification" if you did not try
# another. Compare your implementation with `reference/bell_certifier.nb.py`.
