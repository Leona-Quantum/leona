# ---
# title: "Week 08 — Reference: Bell-pair certifier"
# kind: solution
# summary: >-
#   Complete reference implementation of the Bell-pair certifier: ZZ and XX correlation
#   coefficients from SamplerV2, both landing near +1, contrasted with a non-entangled
#   control near 0.
# objectives:
#   - Show a complete two-basis certification of a Bell pair
#   - Demonstrate the non-entangled control that motivates measuring a second basis
#   - State what the two correlations together do and do not establish
# prerequisites:
#   - templates/bell_certifier.nb.py attempted first
# duration_minutes: 20
# ---

# %% [markdown] role=objective
# ## Reference solution: Bell-pair certifier
# This is the complete answer to `templates/bell_certifier.nb.py`: a `bell_pair()`
# circuit measured in the Z basis and the X basis, a shared correlation helper, both
# correlations landing near `+1`, and a non-entangled control that lands near `0`. Read
# this after attempting the template yourself.

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
# ### Milestone 1 — build the pair, measure ZZ
# Build `bell_pair()` and `zz_correlation(shots=2000, seed=42)`: measure the pair in the
# Z basis and return a correlation coefficient, mapping each qubit's bit to `+1` for
# `"0"` and `-1` for `"1"`, multiplying the two qubits' values per shot, and averaging
# over all shots.

# %% role=solution
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
plot_histogram(zz_counts)

# %% [markdown] role=exercise
# ### Milestone 2 — rotate to the X basis, measure XX
# Build `xx_correlation(shots=2000, seed=42)`: the same Bell pair, `h` applied to both
# qubits before measurement, and the same correlation helper reused on the result.

# %% role=solution
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
assert corr_zz > 0.9, f"ZZ correlation too low to certify entanglement: {corr_zz:.3f}"
assert corr_xx > 0.9, f"XX correlation too low to certify entanglement: {corr_xx:.3f}"

# %% [markdown] role=exercise
# ### Milestone 3 — a non-entangled control
# Build `independent_pair()`: `h` on each qubit, no `cx`. Measure it in the Z basis with
# the same correlation helper and confirm the result sits near 0.

# %% role=solution
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
    f"control circuit should show near-zero correlation, got {corr_control:.3f}"
)

# %% [markdown] role=explain
# ZZ and XX both landing near `+1`, while the no-`cx` control lands near `0`, is what
# makes this a certifier rather than one lucky measurement. A classical process rigged
# to agree in one fixed basis will not also agree in a second, unrelated basis unless it
# is genuinely entangled — the same logic a Bell inequality test relies on, kept here to
# the two bases this course has covered. What this notebook does **not** establish: a
# full CHSH-style Bell inequality violation, which needs more than two basis choices and
# a specific inequality threshold, not just "both correlations are high."

# %% [markdown] role=summary
# ## What this reference shows
# A `bell_pair()` circuit, a shared correlation helper, ZZ and XX correlations both
# above 0.9, and a non-entangled control below 0.3 — all checked, not just plotted.
# Compare this against your own `templates/bell_certifier.nb.py` attempt, then use
# `CHECKLIST.md` for your team's self-evaluation before the demo.
