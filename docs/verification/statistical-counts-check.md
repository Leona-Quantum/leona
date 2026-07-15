# The framework-native `statistical` check

The pipeline verifies the same source code it returns to the user. It does not rebuild
that circuit through OpenQASM. For a plan containing the `statistical` method, the worker
executes the selected-framework program twice in the network-locked sandbox and compares
the two reported count distributions with
`majorana_verification.verify_statistical_counts_pair`.

## What is tested

Let `p̂₁` and `p̂₂` be the empirical distributions from the first and second executions.
The statistic is total-variation distance:

    TVD(p̂₁, p̂₂) = ½ Σₓ |p̂₁(x) − p̂₂(x)|

The default maximum is `0.05`; a plan may supply `tvd_max` or
`total_variation_max`. The evidence record includes the observed TVD, threshold, and
shot counts from both executions.

Generated programs must use deterministic framework seeds where supported. A mismatch
therefore detects unstable source, nondeterministic configuration, or a result that is
not reproducible from the exact code being saved.

## Failure and skip semantics

- Empty distributions fail.
- A TVD above the configured threshold fails and enters the bounded repair loop.
- If the program does not return a counts-shaped value, the statistical method fails
  with an explicit missing-evidence reason. Return-contract and applicable independent
  problem checks still run, but the run cannot pass without the promised statistical
  evidence.
- OpenQASM availability has no effect on this check or on artifact persistence.

## What this does not prove

Re-execution proves reproducibility, not that the chosen circuit solves the right
problem. Correctness evidence comes from plan-to-code review and independent methods
such as exact diagonalization or brute force. Direct statevector checks over OpenQASM
remain library primitives for explicit conversion testing, not the pipeline boundary.
