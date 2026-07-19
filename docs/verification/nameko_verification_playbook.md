# Nala Verification Playbook

## Purpose

Nala should not treat verification as a single yes/no action. For Leona Quantum quantum workflows, verification must classify what kind of evidence is possible, run the strongest feasible checks, and clearly state what has and has not been proven.

The core rule:

> Never claim a full-scale output distribution was verified unless Nala actually produced or checked that distribution. When exact simulation is impossible, say the circuit was verified by construction, by invariant checks, by small-instance evidence, or by statistical fidelity evidence.

## Default Verification Flow

Every verification response should follow this order.

1. Classify the circuit.
   - Count qubits.
   - Estimate depth and gate counts.
   - Identify structure: Clifford, arithmetic, QFT/QPE, Grover, Hamiltonian simulation, variational ansatz, random sampling, data encoding, etc.
   - Identify whether direct statevector simulation, specialized simulation, circuit cutting, or non-simulation verification is available.

2. Choose the verification tier.
   - Tier 1: near-full verification is possible because the circuit has tractable structure.
   - Tier 2: strong design verification is possible through analytic structure, small-instance tests, and full-scale structural checks.
   - Tier 3: only statistical or partial verification is possible because the circuit is designed to be classically hard.

3. Run the strongest feasible checks.
   - Direct simulation if feasible.
   - Circuit cutting if the cut overhead is acceptable.
   - Stabilizer, tensor-network, MPS, near-Clifford, or other specialized simulator if the circuit class permits it.
   - Small-instance exact checks against theory.
   - Sub-block tests.
   - Echo/inverse tests.
   - Basis-state truth-table samples for reversible classical logic.
   - Invariants: qubit count, measurement width, unitarity, conservation laws, symmetry, ancilla cleanup, gate-set validity, hardware connectivity.
   - Statistical or marginal checks where full distributions are intractable.

4. Record evidence.
   - Circuit name and generator.
   - Target size.
   - Feasibility estimate.
   - Checks run.
   - Inputs used.
   - Expected result.
   - Observed result.
   - Pass/fail.
   - Confidence tier.
   - Residual risks.

5. Explain the confidence honestly.
   - Say whether the exact target instance was verified, or only the generator/design.
   - Say which bugs the checks catch.
   - Say which bugs could still survive.
   - Avoid implying that structural verification proves the actual sampled distribution.

## Feasibility Regimes

Use these as rough operating thresholds, not hard guarantees.

- Up to about 29 qubits with modest depth: direct simulation is usually feasible, especially with GPU acceleration.
- About 30 to 53 qubits: direct statevector simulation is usually infeasible, but circuit cutting or specialized methods may work depending on entanglement and structure.
- Beyond about 50 qubits for generic highly entangled circuits: exact statevector verification is not realistic.
- Clifford/stabilizer circuits: exact classical verification can scale to hundreds or thousands of qubits with stabilizer methods.
- Low-entanglement circuits: tensor-network or MPS methods may work far beyond statevector limits.
- Deep generic highly entangled circuits: verification becomes structural, statistical, or partial.

## Confidence Tiers

### Tier 1: Near-Full Verification

Use when the circuit has classically tractable structure.

Examples:

- Clifford/stabilizer circuits.
- Reversible classical arithmetic on basis states.
- Low-entanglement circuits compatible with MPS/tensor-network simulation.
- Circuits reducible to basis-state truth tables.

What Nala can claim:

- "This structure can be verified exactly or near-exactly without full statevector simulation."
- "The check validates the actual defining properties of the circuit class."

What Nala should not claim:

- "This proves arbitrary non-Clifford behavior" if the circuit includes non-Clifford components that were not separately verified.

### Tier 2: Strong Design Verification

Use when the algorithm has analytic guarantees and modular generated structure, but the full instance is too large to simulate.

Examples:

- QFT.
- QPE.
- Grover/amplitude amplification.
- Shor modular arithmetic plus QPE.
- Trotterized Hamiltonian simulation.
- HHL.
- Quantum walks.

What Nala can claim:

- "The circuit is verified by construction and small-instance evidence."
- "The same generator passed analytic checks at tractable sizes."
- "Full-scale structural properties match the specification."

What Nala should not claim:

- "The 100-qubit output distribution was directly verified."

Primary residual risk:

- Scale-specific bugs such as index boundary errors, large-index underflow, target-register reversal, or truncation behavior that does not appear in small tests.

### Tier 3: Statistical or Partial Verification Only

Use when the circuit is intentionally hard to simulate.

Examples:

- Random circuit sampling.
- IQP.
- Boson sampling.
- Generic deep highly entangled circuits.

What Nala can claim:

- "The evidence estimates fidelity or checks low-weight statistics."
- "The circuit structure and schedule match the specification."
- "Elided or patch circuits passed tractable checks."

What Nala should not claim:

- "The exact full output distribution was verified."

## Verification Techniques

### Resource Estimate

Run this before selecting checks.

Record:

- Qubits.
- Classical bits.
- Depth.
- Gate counts.
- Two-qubit gate count.
- Target backend constraints.
- Whether direct simulation, cutting, or special simulation is plausible.

Strength:

- Prevents Nala from guessing whether simulation is feasible.

Weakness:

- Qubit count and depth do not fully capture entanglement or special structure.

### Direct Simulation

Use when the circuit is small enough.

Strength:

- Directly checks the output distribution or statevector.

Weakness:

- Exponential memory and runtime. Does not scale to generic large circuits.

### Circuit Cutting

Use when the circuit is too wide for statevector but has low-entanglement bottlenecks.

Strength:

- Can reconstruct exact-in-principle results beyond direct memory limits.

Weakness:

- Sampling overhead grows exponentially with the number of cuts. Dense entanglement defeats it.

### Specialized Simulation

Use structure-specific simulators:

- Stabilizer for Clifford circuits.
- MPS or tensor networks for low-entanglement circuits.
- Near-Clifford methods when T-count is small.
- Schrodinger-Feynman hybrids for suitable partitioned circuits.

Strength:

- Can verify circuits that are too large for statevector.

Weakness:

- Structure-specific. Generic deep non-Clifford circuits may remain intractable.

### Sub-Block Verification

Verify each reusable module independently:

- QFT block.
- Oracle.
- Diffusion operator.
- Trotter step.
- Adder.
- Multiplier.
- Modular exponentiation block.
- QPE subroutine.
- Encoding map.

Strength:

- Catches construction bugs and validates generated patterns.

Weakness:

- Verifies design components, not necessarily the full large instance.

### Small-Instance Extrapolation

Run the same generator at tractable sizes and compare with theory.

Strength:

- Strong evidence when the circuit is generated by a parameterized pattern.

Weakness:

- Still an inference. Large-index bugs can survive.

### Echo / Inverse Test

Apply `U` followed by `U_dagger` and confirm the input returns exactly.

Strength:

- Catches wiring, swap, phase, ancilla, and inverse-construction bugs.

Weakness:

- A circuit and its inverse can share the same bug. Echo proves reversibility more than algorithmic usefulness.

### Invariant Checks

Use cheap checks that do not require full simulation:

- Qubit and bit counts.
- Measurement width.
- Gate-set validity.
- Hardware connectivity.
- Unitarity of sub-blocks.
- Conservation laws.
- Symmetry constraints.
- Ancilla cleanup.
- Parameter count and parameter binding.

Strength:

- Scale-independent and cheap.

Weakness:

- Necessary conditions, not sufficient proof of the answer.

### Statistical and Marginal Checks

Use when exact output checking is impossible.

Examples:

- Cross-entropy benchmarking for random circuits.
- Low-weight marginals.
- Correlators.
- Patch or elided-circuit checks.
- Fidelity trend extrapolation.

Strength:

- Gives evidence in regimes designed to resist exact verification.

Weakness:

- Estimates fidelity or partial behavior, not the exact distribution.

## Circuit-Family Guidance

### QFT, QPE, and Shor

Checks:

- Verify QFT at small `n` against the analytic transform.
- Run QFT followed by inverse QFT as an echo test.
- For QPE, test a unitary with known eigenphase.
- For Shor, verify modular arithmetic as reversible classical logic on basis inputs.

Claims:

- Strong Tier-2 design verification.
- Arithmetic sub-blocks may reach Tier 1 when tested as basis-state reversible logic.

Risks:

- Tiny controlled rotations, truncation behavior, register ordering, and large-index boundaries.

### Grover and Amplitude Amplification

Checks:

- Verify success probability follows the analytic sine-squared curve at small sizes.
- Test the oracle in isolation on basis states.
- Test the diffusion operator in isolation.
- Confirm the marked-state predicate is encoded correctly.

Claims:

- Strong Tier-2 design verification.

Risks:

- A correct Grover skeleton around a wrong oracle still passes many structural checks.

### Hamiltonian Simulation and Trotterization

Checks:

- Verify one Trotter step against exact matrix exponential at small sizes.
- Check error scaling as step size decreases.
- Check conservation laws such as particle number, spin, parity, or energy symmetry.
- Use MPS/tensor networks for 1D low-entanglement cases where possible.

Claims:

- Tier 1 when specialized simulation applies.
- Tier 2 otherwise.

Risks:

- Symmetry preservation is necessary but not sufficient. Wrong dynamics can still preserve the same symmetry.

### VQE and QAOA

Checks:

- Verify layer count, topology, parameter count, and bound parameters.
- Use special-angle sanity checks.
- Compare expectation values at small sizes with independent classical computation.
- Check conservation laws for chemistry ansatze.

Claims:

- Verifies ansatz machinery, not optimization success.

Risks:

- Does not prove the ansatz can find a good solution or avoid barren plateaus.

### Quantum Arithmetic

Checks:

- Test basis-state inputs for adders, multipliers, and modular exponentiation.
- Sample edge cases: zero, one, max value, carry boundaries, modular wraparound.
- Run inverse/uncompute tests.
- Confirm ancillas return to zero.

Claims:

- Often Tier 1 because the circuit acts like reversible classical logic on basis states.

Risks:

- Random input sampling is not exhaustive unless paired with a structural proof.

### Clifford and Stabilizer Circuits

Checks:

- Use stabilizer simulation.
- Verify stabilizer generators.
- Verify syndrome behavior.
- Check logical operator commutation and anticommutation.

Claims:

- Tier 1 exact verification can scale far beyond statevector limits.

Risks:

- Non-Clifford gates break pure stabilizer tractability. Near-Clifford cost scales with T-count.

### Random Circuit Sampling, IQP, and Boson Sampling

Checks:

- Verify the gate schedule, seed, coupling map, and hardware constraints.
- Use XEB or similar fidelity estimates at the largest tractable sizes.
- Use elided or patch circuits.
- Check low-weight marginals and correlators where theory permits.

Claims:

- Tier 3 statistical or partial evidence only.

Risks:

- Full distribution certification is unavailable by design.

### HHL and Linear Systems

Checks:

- Verify QPE module.
- Verify eigenvalue-inversion rotation.
- Verify inverse-QPE uncompute.
- Test the full pipeline on a small matrix with known eigenvalues and solution.

Claims:

- Tier 2 modular verification.

Risks:

- Condition number, eigenvalue resolution, and postselection success may break behavior at scale.

### Quantum Walks and Amplitude Estimation

Checks:

- Verify coin and shift operators on basis states.
- Verify single-step unitarity.
- Check spectral properties at small graph sizes.
- For amplitude estimation, reuse QPE checks on the Grover-like operator.

Claims:

- Tier 2 design verification.

Risks:

- Graph-dependent spectral gaps may not generalize from small examples.

### Quantum Machine Learning and Data Encoding

Checks:

- Verify feature count and encoding map.
- Confirm data loads into intended qubits.
- Check zero-input reference behavior.
- At small sizes, check that distinct inputs produce distinguishable encoded states.

Claims:

- Verifies encoding and circuit machinery.

Risks:

- Does not prove model generalization, useful kernels, or training success.

## Nala Response Template

Use this structure when answering verification requests:

```markdown
## Verification Classification

- Target circuit:
- Qubits:
- Depth:
- Gate counts:
- Structure:
- Feasibility:
- Confidence tier:

## Checks I Will Run

1. Resource estimate
2. ...

## Results

| Check | Expected | Observed | Status | What it proves | What it does not prove |
| --- | --- | --- | --- | --- | --- |
| Resource estimate | ... | ... | Pass | ... | ... |

## Confidence Statement

This is Tier X verification. It establishes ...

It does not establish ...

## Residual Risks

- ...
```

## Language Rules for Nala

Use:

- "verified by direct simulation"
- "verified by construction"
- "verified by invariant checks"
- "verified by small-instance analytic agreement"
- "verified by stabilizer simulation"
- "statistical fidelity estimate"
- "partial evidence"

Avoid:

- "fully verified" unless the exact target behavior was actually checked.
- "proved correct" unless there is a formal proof or exhaustive class-specific verification.
- "the output distribution is correct" when only structure or small instances were tested.
