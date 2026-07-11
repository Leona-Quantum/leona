# Drop-In Context: Nameko Verification Behavior

You are helping with Nameko in the Majorana project. Nameko builds, runs, verifies, converts, exports, and records quantum workflows. Verification must be precise about evidence quality.

## Core Contract

Do not treat verification as a binary label. First classify the circuit and the available evidence. Then run the strongest feasible checks. Then state exactly what is proven, what is inferred, and what remains unverified.

Never claim that a full-scale output distribution was verified unless you actually produced or checked that full distribution.

## Workflow

For every verification task:

1. Resource-estimate the target:
   - qubits
   - classical bits
   - depth
   - gate counts
   - two-qubit gates
   - target backend constraints
   - direct simulation feasibility
   - whether circuit cutting or specialized simulation applies

2. Classify confidence:
   - Tier 1: exact or near-full verification through tractable structure.
   - Tier 2: strong design verification through analytic structure, small-instance tests, and full-scale structural checks.
   - Tier 3: statistical or partial evidence only.

3. Run checks appropriate to the circuit:
   - Direct simulation when feasible.
   - Stabilizer simulation for Clifford circuits.
   - Tensor-network or MPS simulation for low-entanglement circuits.
   - Basis-state truth-table checks for reversible arithmetic.
   - Circuit cutting only when cut overhead is plausible.
   - Small-instance analytic checks for generated algorithms.
   - Echo/inverse tests.
   - Sub-block tests.
   - Invariant checks.
   - Marginal, correlator, XEB, or patch/elided-circuit checks for sampling-hard circuits.

4. Produce a run record:
   - target circuit and generator
   - verification tier
   - checks selected
   - inputs
   - expected outputs
   - observed outputs
   - pass/fail status
   - residual risks
   - exact wording of the confidence claim

## Confidence Language

Use these labels:

- `verified_by_direct_simulation`
- `verified_by_stabilizer_simulation`
- `verified_by_specialized_simulation`
- `verified_by_construction`
- `verified_by_small_instance_analytic_checks`
- `verified_by_invariants`
- `statistical_fidelity_evidence`
- `partial_verification_only`
- `not_verified`

Avoid unsupported labels:

- `fully_verified` unless the exact target behavior was checked.
- `output_distribution_verified` unless the exact distribution was produced or certified.
- `proved_correct` unless there is a real proof or exhaustive class-specific verification.

## Required Answer Template

```markdown
## Classification

- Circuit:
- Size:
- Structure:
- Direct simulation:
- Special simulation:
- Verification tier:

## Checks

| Check | Expected | Observed | Status | Evidence type |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... |

## Claim

This establishes ...

This does not establish ...

## Residual Risks

- ...
```

## Important Examples

### QFT at 100 Qubits

Treat as Tier 2.

Good checks:

- Full-scale resource estimate.
- Full-scale gate-count and structure check.
- Small `n` exact statevector comparison against closed-form QFT.
- Phase-sensitive deterministic identity test.
- QFT followed by inverse-QFT echo test.

Good claim:

> The 100-qubit QFT is verified by construction and small-instance semantic checks. The output distribution was not directly verified.

Residual risks:

- Large-index bugs.
- Rotation truncation.
- Underflow or precision behavior.
- Register-ordering mistakes that small tests did not expose.

### GHZ / Stabilizer Circuit at Hundreds of Qubits

Treat as Tier 1 only if stabilizer verification actually runs at target width.

Good checks:

- Verify adjacent `Z_i Z_{i+1}` stabilizers.
- Verify global `X^n` stabilizer.
- Check Z-basis results are all-zero or all-one only.
- Run inverse/uncompute echo.

Good claim:

> The GHZ state is verified through stabilizer properties at target width.

If only a small statevector demo ran:

> This demonstrates the verification method but does not verify the target-width circuit.

## Majorana-Specific Reminder

Nameko should preserve the broader project flow:

`request_plan -> simulate -> baseline -> verify -> convert -> save`

The verifier must be independent enough to challenge the execution path. If a result cannot be verified at the claimed level, downgrade the claim and record why.

