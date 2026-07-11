# The headless `statistical` check — math and design

`majorana_verification.counts_vs_ideal` (wrapped by `verify_statistical_counts`)
verifies a run's reported measurement counts against a **direct statevector
simulation of the emitted circuit itself** — no reference circuit needed. In the
playbook's terms this is Tier-1 direct-simulation evidence at sandbox sizes
(≤ 20 qubits enforced; a 20-qubit state is 2²⁰ amplitudes = 16 MiB).

## What is being tested

Let `p` be the exact Born distribution of the parsed IR circuit on |0…0⟩,
computed as |⟨x|U|0…0⟩|² by the pure-numpy engine. Let `p̂` be the empirical
distribution from the run's counts, `p̂(x) = n_x / N` with `N = Σ n_x` shots.

If the generated code is honest and correct, its counts are N iid samples from
`p` (the sandbox simulator is noiseless), so `p̂ → p`. The test statistic is
total-variation distance:

    TVD(p̂, p) = ½ Σ_x |p̂(x) − p(x)|

## The pass threshold

With no plan-supplied threshold, the bound comes from L1 concentration for
multinomial sampling (Weissman et al. 2003): for a distribution over `d`
outcomes,

    P( ‖p̂ − p‖₁ ≥ ε ) ≤ 2^d · e^(−N ε² / 2)
    ⇒  P( TVD ≥ t ) ≤ 2^d · e^(−2 N t²)

Setting the right side to a confidence level δ (default 10⁻³) and solving:

    t(N, d, δ) = √( (d·ln2 + ln(1/δ)) / (2N) )

Honest counts exceed `t` with probability ≤ δ. Examples: a Bell pair at
N = 1024, d = 3 → t ≈ 0.066; at N = 4096 → t ≈ 0.033. A 60/40 split on a Bell
state (TVD = 0.1) fails; fair sampling noise passes.

## Coarsening (why `d` stays small)

Naively `d = 2^q`, which makes the bound useless beyond ~10 qubits (at q = 27,
t > 100). Both distributions are therefore **coarsened** onto the ideal
distribution's ≤ 256 highest-probability outcomes plus one TAIL bin holding
everything else, so `d = bins + 1`.

Coarsening is a measurable projection, so by the data-processing inequality
TVD_coarse(p̂, p) ≤ TVD(p̂, p): the coarse test is a *necessary* condition — it
can only be more permissive, never reject honest counts it shouldn't. A
fabricated distribution concentrated off the ideal support lands in TAIL (ideal
mass ≈ 0) and fails maximally. What coarsening genuinely cannot see is a
permutation of probability mass *within* the untracked tail — negligible for the
peaked distributions this pipeline produces (Bell/GHZ/Grover/QAOA), and honest to
note in the run record.

## Bit-order convention

Qiskit reports counts little-endian (qubit 0 = rightmost bit); the engine
indexes big-endian (qubit 0 = leftmost). Both orientations are scored and the
better one is taken, with `bit_order` recorded in the protocol. Endianness is a
representation convention, not a correctness property; accepting either cannot
admit a wrong distribution — a distribution matches under at most one
orientation unless it is (near-)symmetric under bit reversal, in which case both
claims coincide.

## Failure semantics

Per the package rule (never a silent PASS):

- Malformed counts (non-bitstring keys, wrong width vs the circuit, empty,
  negative) → **FAIL** with the reason — a run that promised counts and printed
  garbage is a broken contract, not missing data.
- Missing counts or missing parsed circuit → the *worker* skips the method
  (honest "cannot run"); the always-run contract checks still produce a verdict,
  so skipping can no longer starve the run into INCONCLUSIVE.
- \> 20 qubits → FAIL with "exceeds statevector limit" (the plan prompt steers
  plans away from choosing `statistical` there; larger circuits await the
  playbook's stabilizer/MPS methods).

## Residual risks (recorded, not hidden)

- The ideal distribution comes from the *same emitted circuit* the code ran —
  this catches fabricated/mis-sampled counts and QASM↔execution mismatches, but
  not a circuit that is itself the wrong algorithm for the user's request. That
  is the critic/plan alignment layer's job, plus `exact_diag`/`brute_force`
  against independent classical references.
- δ = 10⁻³ means ~1 in 1000 honest runs fails by bad luck; the feedback loop
  treats that as a re-verify, not a condemnation.
