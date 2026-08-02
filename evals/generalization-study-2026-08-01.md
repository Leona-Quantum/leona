# Agent generalization study — 2026-08-01

This is an observed real-provider evaluation, not a synthetic benchmark result.

## Configuration

- Branch: `feature/agent-generalization` (uncommitted working tree)
- Provider profile: OpenAI-compatible, model `deepseek-v4-pro` for plan, generate,
  and semantic review
- Database: throwaway local PostgreSQL with migrations at head
- Sandbox: `LocalSubprocessSandbox`, not the production Vercel sandbox and not GCP
- Execution path: direct `RunMode.EXECUTE` handler through the fixed
  Plan → Generate → Sandbox → checks/review → artifact pipeline
- Scoring: terminal state plus protected `RESULT` values compared with independently
  computed analytic, exact-diagonalization, exact-enumeration, or classical values
- Sampling: one stochastic provider run per frozen holdout case. Wilson intervals are
  reported, but one trial per case is not a stability estimate. Targeted diagnostics
  are kept separate from frozen-holdout headline results.

The initial broad run evaluated 22 unique cases: 13 existing but previously unrun
corpus cases and 9 newly added cases. It scored 17/22 (77.3%). The five initial
failures were then rerun after adding general representation and numerical invariants;
three passed. The latest observed outcome per unique case is therefore 20/22 (90.9%),
but this is a mixed-sample diagnostic and **not** a clean post-change rebaseline.

## Frozen holdout results

The later harness records external-oracle correctness separately from product
acceptance, along with Wilson intervals, first-candidate success, candidate revisions,
false positives/negatives, difficulty/workload slices, and durable token use.

| Frozen cohort | Correct | Wilson 95% | First candidate | Mean candidates | False + | False - | Calls | Input / output tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 clean baseline | 6/8 | 40.9–92.9% | 6/8 | 2.125 | 0 | 0 | 46 | 308,536 / 50,717 |
| v2 after reference-schema work | 3/8 | 13.7–69.4% | 1/8 | 3.750 | 1 | 0 | 70 | 350,226 / 41,051 |
| v3 after general rank/range review work | 5/8 | 30.6–86.3% | 4/8 | 1.375 | 1 | 0 | 37 | 151,813 / 16,280 |
| v4 final unseen corroboration | 0/4 | 0.0–49.0% | 0/4 | 2.500 | 1 | 1 | 37 | 179,070 / 36,107 |

These results do **not** establish strong generalization. The variance between frozen
sets is too large, every post-v1 set contains a false positive, and practical
constrained optimization remains especially unstable. v3's research cases both passed,
but v4's research quench was accepted with reversed tensor-factor convention, so the
agent is not reliably research-ready.

Reports are retained as
`report-holdout-v1-deepseek-baseline-20260801.json`,
`report-holdout-v2-deepseek-20260801.json`,
`report-holdout-v3-deepseek-20260801.json`, and
`report-holdout-v4-deepseek-20260801.json`.

## Structural changes tested after v1

The implementation changes were broader than prompt tuning:

- the typed combinatorial reference now preserves constant offsets, objective
  direction, and exact linear constraints;
- the local baseline enumerates only feasible assignments and reports the actual
  typed optimum deterministically;
- every model-authored brute-force reference receives an independent request-to-data
  equivalence audit before generation;
- a typed-reference optimum outside the Plan's own expected range is rejected before
  candidate generation;
- `tolerance: 0.0` is normalized to the deterministic verifier default while negative
  tolerances remain invalid;
- exact closed range boundaries absorb only `1e-12` floating-point representation
  error;
- the harness now measures repeated trials, slices, first-candidate success, candidate
  count, false acceptance/rejection, and durable token use.

The retained prompt additions state representation-level invariants: original decision
variables versus Hamiltonian encodings, statevector rank, tensor/Pauli order, matrix
product versus SDK call order, finite-register grids, and review of every requested
numeric evidence field. No holdout expected value or instance coefficient was added to
product prompts or runtime code. A four-qubit Grover-specific example was removed after
the diff audit; the general iteration formula remains.

Targeted diagnostics showed real local gains but are not unbiased rebaselines:

- a mathematically correct SWAP-test result stopped failing on a `3e-16` range-boundary
  difference;
- a Loschmidt echo that repeatedly built a `(1, 8)` row state passed after the general
  matrix/vector rank rule;
- weighted MaxCut and set cover passed after separating LLM semantic equivalence from
  local optimum enumeration and normalizing zero tolerance;
- a one-qubit product formula passed after clarifying right-to-left matrix action versus
  source-order gate calls.

The same diagnostics also exposed unresolved failures: channel self-review can still
accept a wrong dilation, QPE can return the right decoded phase with the wrong
distribution, constrained QAOA generation can exhaust its candidate budget, and
multi-qubit tensor ordering can still be reversed. These were not hidden or converted
into prompt-specific fixes.

## Model-routing experiments

- `gpt-5.6-sol` planning was attempted on the two v1 practical cases, but both OpenAI
  calls returned HTTP 429 before a Plan; the A/B is inconclusive and no default changed.
- DeepSeek Flash planning scored 0/1 on the knapsack diagnostic, so it did not replace
  Pro.
- DeepSeek Flash review scored 0/2 with one false positive on QPE; it safely rejected
  amplitude damping but did not justify a global reviewer switch.

All reported runs used provider keys loaded from the repository's local `.env.local`, a
throwaway local PostgreSQL instance, and `LocalSubprocessSandbox`. They did not use GCP
or a remote production sandbox. Secret values were neither printed nor modified.

## Existing-corpus expansion

The 13-case run scored 12/13 (92.3%). Cirq Bell, Qiskit GHZ, PennyLane Bell, Japanese
beginner Bell, QFT, five-bit QPE, four- and six-qubit VQE, eight-node weighted QAOA,
two-solution Grover, mid-circuit OpenQASM 3, and four-qubit Grover all passed.

The five-qubit transverse-field Ising evolution was a false positive at the product
level: the run materialized an artifact and semantic review returned READY, but
`magnetization_z=-0.1638498732` disagreed with the independent second-order Trotter
reference `0.6539842446`. The generated step applied the transverse-field group for a
total of `2*dt` while applying each interaction group for `dt`. Exact matrix
exponentiation gives `0.6548569035`; the correct 12-step Strang result differs from it
by only `8.73e-4`.

## New breadth and research cases

Initial result: 5/9 (55.6%).

| Case | Initial result | Candidates | Protected result / cause |
|---|---:|---:|---|
| coherent teleportation | pass | 1 | fidelity `0.9999999999999991` |
| CHSH | fail | 8 | `0.0`; the benchmark had not stated its sign convention explicitly |
| Cirq parameter-shift gradient | pass | 3 | `-0.3616154492` |
| four-bit amplitude estimation | fail | 8 | final `0.5975451610`; controlled-phase/reflection errors |
| five-qubit GHZ quantum Fisher information | pass | 1 | `24.999999999999993` |
| six-qubit critical-Ising half-chain entropy | pass | 1 | `0.8479265692034431` |
| amplitude-damping Stinespring dilation | fail | 8 | population `1.0`, entropy `0.0`; system excitation never transferred |
| two-phase-qubit HHL | fail | 7 | fidelity `0.9`; postselection/axis-order error and non-convergence |
| PennyLane three-qubit VQE | pass | 5 | `-2.175682813660471`, exact `-2.1756828136740562` |

The CHSH prompt was made mathematically unambiguous by stating
`S=E00+E01+E10-E11`. This is eval hygiene, not evidence of a general agent gain.

## General change and targeted rerun

The prompts now state general rules rather than case-specific answers:

- finite-register expected ranges must use the estimator's discrete output grid;
- Qiskit Pauli strings and raw Statevector NumPy axes must use the correct little-endian
  convention;
- custom oracles, dilations, controlled powers, postselection, and uncomputation must
  be checked against their basis/eigenstate maps;
- every Hamiltonian term in a product-formula step must accumulate exactly its requested
  signed coefficient-time;
- reviewers must trace a proposed gate repair on a minimal state before calling the
  decomposition correct.

Targeted rerun result: 3/5 (60%).

| Case | Before | After | Latest protected result |
|---|---:|---:|---|
| CHSH | fail / 8 candidates | pass / 1 | `2.8284271247461894` |
| five-qubit Ising evolution | wrong success / 2 | pass / 1 | `0.6539842445630305` |
| amplitude damping | fail / 8 | pass / 3 | population `0.7000000000000001`, entropy `0.8812908992306926` |
| amplitude estimation | fail / 8 | fail / 8 | `0.8535533905932737` instead of `0.14644660940672624` |
| HHL | fail / 7 | fail / 8 | fidelity `0.6484721263804231` instead of `1.0` |

The corrected amplitude-damping source genuinely implements the requested map: it
applies a system-controlled environment rotation and then an environment-controlled
system CNOT. The corrected Ising source uses one half ZZ layer, one full X layer, and
one half ZZ layer per step. Neither result is hard-coded.

Amplitude estimation remains a correlated plan/generate/review failure. The planner
still chose `[0.12, 0.14]` from the continuous value even though the four-bit decoded
grid value is `0.1464466094`; generated Grover operators then retained a phase offset
and returned its complement. HHL remains dominated by QPE ordering, reciprocal-control,
and postselection errors. More prompt text alone is unlikely to be the right fix for
these two cases.

## Cost and limitations

The database recorded the following substantive LLM calls. These counts exclude any
provider work not persisted by the LLM-call recorder, so they are not a billing total.

| Cohort | Runs | Candidates | Recorded calls | Input tokens | Output tokens |
|---|---:|---:|---:|---:|---:|
| existing 13 | 13 | 16 | 45 | 168,036 | 18,995 |
| new 9, initial | 9 | 42 | 103 | 540,549 | 101,749 |
| targeted rerun 5 | 5 | 21 | 51 | 284,535 | 58,786 |
| total | 27 | 79 | 199 | 993,120 | 179,530 |

Important limits:

- Single stochastic samples cannot establish a stable pass rate. Repeat trials and
  confidence intervals are still required.
- Plan, generation, and review used the same model, so correlated misconceptions remain
  possible. The original Ising false positive demonstrates this directly.
- The harness verifies requested scalar outputs, not a general proof of algorithmic
  correctness. Its product verifier honestly remains `inconclusive` when no supported
  independent reference method exists.
- The local subprocess sandbox does not test production sandbox packaging, resource
  enforcement, or deployment connectivity.
- The explicit QUBO/MaxCut checks validate the declared instance. They do not prove that
  an LLM correctly translated an underspecified higher-level business problem into that
  instance.

## Recommended next architecture work

1. Run calibration/holdout cases for at least 5 seeds and report Wilson intervals plus
   first-candidate success, terminal success, and mean candidates separately.
2. Use a genuinely independent review/reference model or deterministic executable
   invariants for phase-estimation and channel subroutines; same-model self-review is
   not enough.
3. Treat planner-authored `expected_range` as a weak sanity bound. It must never raise
   evidence strength without an independent declared reference.
4. Add typed, deterministic references for bounded dynamics/observables and small
   linear systems instead of trying to encode more algorithm answers in prose prompts.
5. Put a bounded timeout on non-critical title generation so metadata cannot hold an
   otherwise terminal corpus run open.

## 2026-08-02 extension: typed consensus and fresh high-difficulty holdouts

This extension used the same local PostgreSQL + `LocalSubprocessSandbox` execution
path and real DeepSeek provider calls loaded from `.env.local`. It did not use GCP.
No credential value was changed. OpenAI-compatible provider attempts now have a
configurable bounded timeout (`MAJORANA_LLM_TIMEOUT_SECONDS`, default 120 seconds);
one diagnostic had previously spent more than 20 minutes waiting for a review response
after its sandbox execution had already completed in 720 ms.

### Additional architecture changes

The retained changes are not a lookup table of holdout answers:

- binary optimization is represented in reported business units and independently
  extracted by a second Pro call; semantic equivalence compares direction, feasibility,
  and every feasible objective value, not only one optimum;
- bounded Pauli dynamics uses sparse indexed factors, with identity padding performed
  deterministically by the worker;
- bounded Lindblad problems (at most three system qubits) use typed product states,
  sparse complex operators, explicit dissipator multipliers, and typed density-matrix
  result targets; Plan, Pro extraction, and Flash extraction must agree before the
  server computes `exp(t L)` and checks every declared scalar;
- deterministic reference failures replace speculative reviewer repair prose with a
  minimal RESULT-first repair instruction;
- exact-reference consensus removes model-authored free-form numeric notes as
  correctness authority, and exact diagonalization removes a guessed range that
  excludes its computed truth;
- `exact_diag` now has a typed `reference_result_key`, so a primary `energy_error`
  cannot be compared accidentally with the Hamiltonian ground-state energy;
- provider calls have a finite timeout. Timeout failures remain typed and retryable.

The prompt changes describe schema semantics and representation invariants: literal
`a/b` dissipator arithmetic, lowering/raising matrices in the stated basis, sparse
factor indexing, and the distinction between a candidate energy and an error/baseline
metric. No holdout coefficient, optimum, or expected output value appears in a product
prompt or server branch.

### v5 diagnostics

The frozen v5 baseline was 4/8, with two false positives and one false negative
(`50` calls, `283,848 / 50,262` recorded input/output tokens). Its exposed failure
cases were used only as diagnostics:

- assignment and project selection: 2/2 after independent business-reference
  consensus;
- five-qubit sparse dynamics: 1/1 after indexed Pauli references;
- one-qubit amplitude damping plus dephasing: the original wrong complement was first
  still accepted, then safely rejected after exact Lindblad checking, and finally
  repaired to the oracle on candidate 2 after deterministic minimal repair feedback.

The final Lindblad diagnostic reported
`excited_population=0.20126211201681793`,
`coherence_real=0.2445960558981657`, and
`purity=0.7981431125551814`, with 1/1 oracle pass and no false positive. These are
targeted regressions, not a clean v5 rebaseline.

### Fresh holdout v6

v6 was frozen after the Lindblad/reference implementation and before its outcomes were
observed. It contains one 16-variable assignment, exact four-bit QPE, an independent
three-qubit VQE, four-qubit sparse dynamics, coupled two-qubit Lindblad evolution,
four-qubit GHZ QFI, a three-qubit OTOC, and an HHL-style linear system.

| Metric | Result |
|---|---:|
| terminal + oracle pass | 4/8 (50.0%) |
| Wilson 95% interval | 21.5–78.5% |
| research slice | 3/5 (60.0%) |
| advanced slice | 1/3 (33.3%) |
| first-candidate pass | 1/8 |
| false positives / false negatives | 0 / 1 |
| candidates / mean candidates | 33 / 4.125 |
| recorded calls | 68 |
| recorded input / output tokens | 470,257 / 79,964 |

QPE, coupled two-qubit Lindblad, GHZ QFI, and OTOC passed their numeric oracles. The
assignment eventually produced the correct cost 15 but exhausted the Plan budget
because a free-form Plan note claimed 17. VQE was blocked by a guessed range. Sparse
dynamics repeatedly transcribed `X0 Z2` as `XZII` instead of `XIZI`. The HHL-style case
failed through a sequence of SciPy import and current-Qiskit QFT API/runtime errors.
The first three failures motivated general contract/routing fixes; HHL did not receive
a task-specific patch.

### Fresh corroboration v7 and v8

v7 was frozen after the v6 structural fixes and used different coefficients, variable
counts, constraints, and Pauli supports. It scored 2/3 (66.7%), first-candidate 2/3,
with zero false positives. An eight-project constrained portfolio and a new indexed
three-qubit dynamics problem both passed on candidate 1. The VQE candidate numerically
matched its oracle from candidate 1, but exact diagonalization was bound to
`energy_error` instead of `variational_energy`, so the run incorrectly exhausted its
budget.

v8 was then frozen with another Hamiltonian and different output names after adding
the typed result binding. It passed 1/1 on candidate 1 with zero false positives:
`primary_metric=energy_error`, `reference_result_key=optimized_energy`, and observed
`optimized_energy=-0.8332361670424815` versus exact
`-0.8332361670424819`.

Reports:

- `report-holdout-v6-deepseek-20260802.json`
- `report-holdout-v7-deepseek-20260802.json`
- `report-holdout-v8-deepseek-20260802.json`
- `report-holdout-v5-lindblad-minimal-reference-repair-diagnostic-20260802.json`

### Current conclusion

The evidence supports a narrower claim than “research-ready”: unseen research cases
improved to 3/5 in v6, and the later unseen dynamics/VQE binding corroborations passed,
while no false positive occurred in v6, v7, or v8. However, one trial per case is not a
stability estimate, first-candidate accuracy remains weak, 16-variable sampled QAOA is
resource-expensive, and HHL-style circuit synthesis remains unreliable. The next clean
study should repeat a frozen mixed cohort across at least five seeds and should add a
typed bounded linear-system reference rather than more HHL-specific prompt prose.

## 2026-08-02 extension: repeated mixed cohort and unseen corroborations

### Frozen v9, three repetitions

v9 was frozen before the product changes described below. It contains ten cases from
basic through research difficulty and educational, practical, and scientific workloads.
Every case was run three times with the real provider, for 30 total trials.

| Metric | Result |
|---|---:|
| terminal + oracle pass | 18/30 (60.0%) |
| Wilson 95% interval | 42.3–75.4% |
| stable cases (3/3) | 5/10 |
| first-candidate pass | 15/30 |
| candidates / mean candidates | 77 / 2.567 |
| false positives / false negatives | 3 / 0 |
| recorded calls | 201 |
| recorded input / output tokens | 1,313,592 / 198,115 |

The basic Bell and intermediate coherent-teleportation cases were 3/3. The advanced
slice was 4/12 and the research slice was 8/12. By workload, educational was 6/6,
practical 3/6, and scientific 9/18. The ten case results were:

- Bell 3/3; coherent teleportation 3/3; exact 3x3 assignment 3/3;
- four-qubit Ising entanglement 3/3 and bounded two-qubit Lindblad 3/3;
- three-qubit VQE 1/3 and five-qubit sparse dynamics 2/3;
- ten-project constrained QAOA 0/3, exact five-bit QPE 0/3, and HHL-style linear
  system 0/3.

All three QPE trials were product false positives: the decoded integer/phase happened
to be reported correctly while the protected distributions were diffuse or used the
wrong register ordering. HHL trials exposed a separate trust-boundary bug: Python JSON
accepted `Infinity`, then PostgreSQL JSONB rejected it and poisoned the transaction.
The frozen HHL wording also named `amplitude_ratio` without specifying its orientation;
later diagnostics made it explicitly `solution_x1/solution_x0`. This ambiguity does not
change the v9 HHL failures, which also failed terminal state and explicit component
checks, but the ratio field alone is not used as evidence from that frozen prompt.

### Retained generic changes after v9

- Protected sandbox JSON now rejects NaN and infinity before persistence, including
  overflowed numeric literals. A real diagnostic then failed cleanly instead of leaving
  a running job and rolled-back session.
- Exact noiseless dyadic QPE has a bounded typed reference for 1–16 counting qubits.
  The worker recomputes the integer and phase, reads protected counts, recomputes peak
  probability, and requires an exact dyadic phase to concentrate at probability at
  least 0.99. Reported scalars cannot substitute for the count distribution.
- Bounded 2–8 dimensional real-symmetric linear systems have a typed dense reference.
  Matrix, right-hand side, result normalization, component indices, and ratio direction
  are independently extracted from the request; a substantive extraction must agree
  with the Plan, and a second typed audit derivation must also agree when it does not
  abstain. The server then solves the system and checks every bound scalar at absolute
  tolerance 0.01. Undefined ratio orientation is never guessed.
- Successful exact dynamics, Lindblad, QPE, and linear-system checks are now recorded as
  actual exact reference evidence rather than leaving the artifact at a structural-only
  evidence grade. The overall verdict remains `inconclusive`; one checked scalar is not
  a proof of the whole artifact.
- QAOA diagonal objectives use `DiagonalGate` from a length-`2**n` phase vector. The
  old example rebuilt a dense `2**n` square `UnitaryGate` on every optimizer evaluation,
  which reproducibly hit the 90-second sandbox timeout at ten variables. Brute-force
  repair feedback now preserves its specific `SUBOPTIMAL` versus invalid-scoring
  diagnosis instead of replacing it with generic prose.
- Current-Qiskit QFT construction, real-valued rotation parameters, statevector axis
  order, and postselection bit masks are documented as API/representation invariants.
  These are capability rules, not coefficients or answers from one eval task.

No product prompt or deterministic branch contains a v9/v10/v11 matrix entry,
eigenphase answer, portfolio optimum, or selected project set.

### Targeted and unseen outcomes

The exact-QPE diagnostic on v9 improved from three false-positive acceptances to 2/3
oracle passes with zero false positives. A fresh v10 task was frozen with six counting
qubits, phase `13/64`, and different output names; it also scored 2/3 with zero false
positives. Both successful v10 trials had exact peak probability 1.0. The remaining
trial failed safely after returning the wrong phase and diffuse counts.

The constrained ten-project QAOA diagnostic passed 1/1 after the generic diagonal-cost
and repair-evidence changes. It no longer timed out on candidate 1; candidate 5 returned
`qaoa_value=exact_value=35`, `total_cost=14`, and sampled selection
`[1,4,5,6,8]`. This is a targeted regression, not a new mixed-cohort headline.

HHL-style synthesis remains unsuccessful. With independent typed consensus active,
the clarified v9 diagnostic scored 0/1 in three successive architectural/API
diagnostics, always with zero false positives. One candidate reached fidelity
`0.9989940459` but its signed components and ratio still exceeded tolerance, and later
repairs regressed. A fresh v11 matrix with different coefficients and result-key names
also scored 0/1, ending in `execution_code_error` after seven candidates. Thus the
linear reference substantially improves rejection safety and failure diagnosis, but
does not establish HHL generation capability.

Reports added by this extension:

- `report-holdout-v9-baseline-deepseek-20260802.json`
- `report-diagnostic-v9-qpe-exact-reference-20260802.json`
- `report-holdout-v10-qpe-generalization-20260802.json`
- `report-diagnostic-v9-hhl-nonfinite-boundary-20260802.json`
- `report-diagnostic-v9-hhl-independent-consensus-20260802.json`
- `report-diagnostic-v9-hhl-qft-api-20260802.json`
- `report-diagnostic-v9-hhl-bitmask-20260802.json`
- `report-holdout-v11-linear-generalization-20260802.json`
- `report-diagnostic-v9-portfolio-scalable-qaoa-20260802.json`

### Current conclusion

The cleanest repeated estimate is v9's 18/30 (60.0%), not the earlier one-shot 90%+
figures. Generalization is clearly task-family dependent: elementary state preparation,
teleportation, assignment, Lindblad, and Ising entanglement were stable; QPE now has
unseen corroboration with safe failures; bounded QAOA improved but remains expensive;
VQE and sparse dynamics are stochastic; and HHL is not reliable. The retained changes
reduce correlated false acceptance and improve bounded execution, but they do not make
the agent generally research-ready.

All runs in this extension used `.env.local` provider configuration, throwaway local
PostgreSQL, and `LocalSubprocessSandbox`. They did not connect to GCP or the production
sandbox.

## 2026-08-02 extension: algorithm-family context and exact-statevector VQE

### Changes under test

The generation system message previously sent Bell, VQE, QAOA, and QEC implementations
to every task. It was 18,339 characters even when none of those families matched. The
worker now selects one verified reference by framework and algorithm family while
retaining all shared runtime, artifact, numerical, and representation rules. Observed
prompt sizes were 9,134 characters for Bell, 11,654 for VQE, 12,524 for QAOA, 14,179
for HHL, and 8,606 for an unrelated dynamics task. Non-Qiskit generation receives no
Qiskit implementation example.

The HHL reference is a generic finite real-symmetric 2-by-2 construction, not a solved
holdout instance. It derives `U=exp(2*pi*i*scale*A)`, prepares the normalized right-hand
side, builds and exactly inverts one phase-estimation subcircuit, applies phase-keyed
reciprocal rotations, postselects by Qiskit integer bit masks, and returns signed
circuit amplitudes. Matrix entries, right-hand sides, output keys, phase scale, and
counting width remain task inputs. A local executable test checks the same scaffold on
three different matrices and right-hand sides against an independent dense solve to
`1e-10`.

VQE exposed two non-prompt defects. First, the verifier reused a sampled-run 2% optimizer
allowance for exact statevector expectations. `shots=None` now receives only
`1e-6*max(1, sum(abs(coefficients)))`; finite-shot verification retains its derived shot
noise plus sampled optimizer allowance. Second, Plan validation recognized only keys
containing `energy` or `eigenvalue`, so it could reject a valid
`optimized_expectation` and accept a classically diagonalized `dense_ground_energy` as
the candidate. Candidate expectations are now valid exact-diag bindings, while exact,
dense-diagonalization, reference, and baseline outputs are not. An exact-statevector
energy above the ground state also produces typed convergence feedback: materially
change ansatz connectivity/depth and deterministic starts, retain the best variational
circuit, and never substitute the exact eigenvector or baseline.

These are execution-regime and result-semantics rules. They contain no v9, v12, or v13
Hamiltonian coefficient, matrix entry, answer, result-key spelling, or selected
bitstring.

### Observed family results

| Experiment | Correct | First candidate | False positives | Mean candidates |
|---|---:|---:|---:|---:|
| v9 HHL with selected generic scaffold | 3/3 | 3/3 | 0 | 1.000 |
| fresh frozen v12 HHL, different matrix/keys | 3/3 | 3/3 | 0 | 1.000 |
| v9 VQE after strict verification, before specific convergence feedback | 2/3 | 1/3 | 0 | 3.667 |
| fresh frozen v13 VQE before binding fix | 1/3 | 1/3 | 1 | 0.667 |
| fresh frozen v13 VQE after semantic binding + feedback | 3/3 | 1/3 | 0 | 2.000 |
| v9 VQE after convergence feedback | 3/3 | 2/3 | 0 | 1.667 |
| v9 constrained ten-project QAOA regression | 3/3 | 2/3 | 0 | 1.333 |

The fresh v12 system used a rotated matrix with eigenvalues 0.25 and 0.75, a different
right-hand side, and different RESULT names. All three trials returned the signed
normalized solution and ratio from the postselected circuit with fidelity 1.0. The
fresh v13 Hamiltonian had nine different Pauli coefficients and result names
`optimized_expectation`, `dense_ground_energy`, and `absolute_gap`. After the binding
fix, its three final absolute errors were `3.15e-14`, `4.64e-7`, and `2.91e-13`.

The v9 VQE strict-verification diagnostic is also an important safe-failure result. It
changed the prior erroneous acceptance of a statevector 0.00705 above the exact ground
state into `candidate_budget_exhausted`, with no artifact saved. After adding typed
convergence feedback, the same Hamiltonian passed 3/3 with final errors from
`6.04e-14` through `1.56e-11`. The QAOA regression returned sampled feasible value 35,
cost 14, and the same selected-project oracle in every trial; its finite-shot tolerance
path was unchanged.

Reports:

- `report-diagnostic-v9-hhl-family-example-20260802.json`
- `report-holdout-v12-hhl-generalization-20260802.json`
- `report-diagnostic-v9-vqe-strict-exact-20260802.json`
- `report-holdout-v13-vqe-generalization-20260802.json`
- `report-holdout-v13-vqe-binding-repair-20260802.json`
- `report-diagnostic-v9-vqe-convergence-repair-20260802.json`
- `report-diagnostic-v9-portfolio-family-regression-20260802.json`

### Updated conclusion

These targeted repeated trials establish bounded capability for two small HHL matrices,
two explicit three-qubit VQE Hamiltonians, and the ten-variable constrained QAOA
regression under the local simulator. They do not replace the frozen mixed v9 headline
of 18/30, establish production-sandbox behavior, or justify a general
"research-ready" claim. The strongest new evidence is that a fresh-key VQE false
positive was reproduced, explained by a semantic binding defect, removed without
relaxing the oracle, and then repaired to 3/3; the strongest remaining limitation is
that first-candidate VQE success is only 3/6 across the two final cohorts and all model
roles still share a provider family.

## 2026-08-02 extension: final mixed rebaseline and frozen v14

### Final v9 rebaseline

After the retained family-context, exact-reference, binding, and convergence changes,
the already-frozen mixed v9 cohort was rerun for three repetitions with the real
provider. It scored 20/30 (66.7%, Wilson 95% 48.8–80.8%), versus the earlier 18/30.
Four of ten cases were stable at 3/3, first-candidate success was 18/30, and mean
candidates was 2.1. The database recorded 181 calls and 1,098,398 / 171,297 input /
output tokens.

Bell, VQE, Lindblad, and Ising were 3/3; teleportation, portfolio QAOA, assignment, and
dynamics were 2/3; QPE and the original v9 HHL wording were 0/3. The apparent HHL false
positive is an evaluation ambiguity: the prompt named only `amplitude_ratio`, the
candidate returned `x0/x1`, and the harness expected `x1/x0`, while its signed
components, residual, and fidelity were correct. Later fresh HHL tasks explicitly name
the ratio direction. This field is not evidence of a product-verifier regression.

### Frozen unseen v14

v14 was frozen before observing any outcome. Its ten cases span Cirq Bell,
Bernstein–Vazirani, weighted MaxCut, 16-variable assignment, four-qubit VQE, renamed
exact QPE, complex-Pauli dynamics, collective-jump Lindblad evolution, rotated-basis
HHL with an explicit ratio direction, and coherent phase-flip QEC. The mix contains
one basic, one intermediate, three advanced, and five research cases across
educational, practical, and scientific workloads. Every scalar oracle was computed
independently before the provider run by direct enumeration, dense diagonalization,
matrix exponentiation, or a dense linear solve.

The real-provider baseline scored 6/10 (60.0%, Wilson 95% 31.3–83.2%), all on the first
candidate, with zero false positives and zero false negatives. It used 82 recorded
calls and 438,947 / 72,428 input / output tokens. Bell, Bernstein–Vazirani, weighted
MaxCut, complex dynamics, collective Lindblad, and rotated HHL passed. The failures
were:

- the 16-variable assignment repeatedly built a length-`2**16` `DiagonalGate` and
  timed out at 90 seconds;
- four-qubit VQE reached a best exact-energy error of `6.03e-4`, safely outside the
  strict statevector tolerance;
- QPE decoded the correct integer but had only `0.68457` peak probability and was
  safely rejected;
- phase-flip QEC used the wrong encoding/syndrome basis and ended at zero fidelity.

The assignment's independent extractor also compressed 16 row-major decision
variables into four indices. A proposed diagonal-term normalizer was tested and then
removed because it could have converted this correlated wrong reference into an
accepted one. No task-specific extraction repair was retained.

### Provisional family-level improvements after v14

Five bounded, parameterized generation rules were retained after repeated failure
classification and executable local checks:

- exact-dyadic QPE accepts an arbitrary finite power-of-two unitary, arbitrary target
  preparation circuit, and 1–16 counting qubits, then derives the phase from sampled
  counts; it was executed locally on three different widths/phases, including a
  two-qubit target, at exact peak probability 1.0;
- explicit binary QUBO cost layers are compiled to local `RZ`/`RZZ` gates instead of a
  length-`2**n` diagonal. All eight basis phases of a three-variable test matched the
  source polynomial up to global phase, and a 16-variable assignment layer compiled
  to 48 `RZZ` plus 16 `RZ` gates and ran locally in about 0.01 seconds after compile;
- coherent phase-flip QEC is expressed as a basis-conjugation invariant: bit-flip
  repetition encoding first, Hadamards on data, then after a `Z` error conjugate back
  to the ordinary syndrome/correction circuit. The executable local test recovered
  errors on each of the three data qubits at fidelity approximately 1.0.
- explicit two- to four-qubit statevector VQE uses an alternating-ring `CZ` ansatz,
  `RY` for real Hamiltonians and `RY`/`RZ` for complex Hamiltonians, exact
  parameter-shift gradients, bounded L-BFGS-B, and deterministic full-range starts.
  Dense diagonalization supplies only the independently reported energy and convergence
  gap; the returned circuit is the optimized parameterized ansatz and no eigenvector is
  prepared. A requested start count is the number of optimizer runs actually executed.
- standard statevector amplitude estimation accepts an arbitrary unmeasured one- to
  four-qubit state-preparation circuit, an arbitrary computational-basis good-state
  set, and 1–12 evaluation qubits. It constructs
  `Q=-A S0 A_dagger S_good`, runs controlled powers, marginalizes the actual circuit
  statevector, folds `y` with `min(y, 2**m-y)`, and maps the folded integer to
  `sin(pi*y/2**m)**2`. The Plan prompt now uses this same attainable grid rather than a
  range around the continuous input probability.

The VQE choice followed a local cross-instance comparison rather than the v14 outcome
alone. Alternating `RY`/`CZ`, alternating `CX`, and all-pairs `CZ` candidates reached
near-machine precision on the two earlier three-qubit Hamiltonians, but six-start
Powell took 88.8 seconds on v14 and was rejected as too close to the sandbox limit.
Across five seeded unrelated real four-qubit Hamiltonians, the retained ansatz with an
exact gradient reached error at most `2.0e-15` in 1.5–3.1 seconds. Three separately
seeded complex three-/four-qubit Hamiltonians reached error at most `2.2e-15` in
4.7–19.7 seconds. A further bounded L-BFGS-B comparison on five new real/complex
instances reached error at most `1.67e-11` in 0.24–19.2 seconds. Finally, executing all
six requested starts on the v14 Hamiltonian took 20.6 seconds and ended at gap
`5.57e-12`, well inside both its oracle tolerance and the 90-second sandbox bound.

The selected VQE generation prompt now contains this parameterized helper instead of
also carrying the fixed H2 example. Its size fell from 17,998 to 14,950 characters, and
no fixed chemistry or holdout coefficient is selected for a VQE request.

The QAE helper was locally executed on one-, two-, and three-system-qubit preparations,
3–5 evaluation qubits, different objective qubits, singleton and multi-state good
sets, exact and off-grid phases, amplitudes below and above one half, and the exact
boundary values zero and one. The original `theta=0.37`, four-evaluation-qubit failure
now decodes the circuit distribution to folded integer 2 and grid value
`0.14644660940672624`; the symmetric pair contains probability
`0.9579953673807876`. A separate off-grid three-qubit case gives folded integer 3,
grid value `0.08426519384872735`, and independently derived Dirichlet-kernel pair mass
`0.9931061446753955`. Three new renamed QAE cases were frozen under
`diagnostic-qae-family` before any provider outcome. No new verifier schema was added:
generation-only evidence is intentionally evaluated first before expanding a
contract-owned blast radius.

### Rejected assignment-mixer experiment

A proposed four-body swap mixer was evaluated for square 4-by-4 assignment. It starts
from one permutation and rotates only between two feasible permutations that exchange
the jobs of two workers, so all circuit probability remains inside the 24-state
feasible subspace. This removed the vanishing-feasible-sample problem of an ordinary
X mixer and made the v14 optimum the top state with probability about 0.42 at depth
two. Across an initial seven unrelated cost matrices, however, selecting depths one
through three produced the optimum as the top state for only five matrices. Depth four
and more restarts repaired the two exposed matrices, but a second seeded normalized
cost experiment again left one optimum at probability `5.9e-11` and made the top state
suboptimal on several other matrices. More layers also increased optimizer sensitivity.

The mixer was therefore not added to the product prompt or runtime. Observing the
optimum on one assignment and then encoding that circuit would have been instance
specialization, not a general gain. The retained local `RZ`/`RZZ` QUBO layer solves the
known exponential gate-construction timeout, while constrained-QAOA search quality
remains an explicit limitation. One implementation comment that named the original
`12x40` evaluation case was generalized to describe large underspecified assignment
requests; the concrete prompt remains only in the eval corpus.

Durable evidence from the one failed v9 3-by-3 assignment trial exposed a separate,
cross-instance reporting defect. Every executed candidate sampled the correct feasible
assignment `[1, 2, 0]`, but reported its internal penalty-Hamiltonian value `-111` as
`qaoa_cost` instead of the requested original assignment cost `9`; the independent
business reference rejected all three executions, and two later generations repeated
the same source fingerprint. The QAOA generation example now states the general
boundary explicitly and demonstrates separate `qaoa_energy` and
`business_objective` functions. It filters sampled candidates by the original
constraints, ranks feasible observations by the original objective, and fails when no
feasible sample exists instead of substituting an exact-baseline solution. No matrix,
optimum, assignment, or result-key from v9 was added. A prompt-selection regression
test also proves this rule is present for QAOA context and absent from Bell context.
The executable selection helper was then reused unchanged on a 2-by-2 assignment
minimization, a capacity-constrained knapsack maximization, and a weighted-MaxCut
maximization. In each case an infeasible or inferior sampled key was present in counts;
the helper returned the best feasible observed business value with the correct Qiskit
bit order and direction. This tests the reporting boundary across three formulations,
not QAOA search quality itself.
This is a locally checked prompt invariant, not a claimed real-provider improvement;
the latter still requires the frozen rerun after provider credit is available.

### Structured generation-family routing

The family-scaffold selector originally concatenated Plan domain, Algorithm, and
summary text, then chose the first matching keyword. That made prose outrank the
Plan's typed Algorithm: `AmplitudeEstimation` did not match the spaced keyword and
received no QAE scaffold, while explicit `QAOA` and `ErrorCorrection` Plans whose
summaries mentioned phase estimation incorrectly received the QPE scaffold. A
`Simulation` Plan for exact Pauli dynamics could fail similarly when its summary
mentioned phase estimation as a comparison.

The selector now normalizes the typed Algorithm and treats supported explicit values
as authoritative. Text routing is reserved for generic `other`, `Simulation`, and
`StatePreparation` Plans whose families are not represented by the enum, with more
specific HHL, teleportation, repetition-QEC, exact-dynamics, and open-system boundaries
evaluated before broad algorithm names. Open-system tasks receive no unsupported QPE or
closed-system dynamics scaffold merely because those phrases occur secondarily.
Repetition-code examples remain narrower than the `ErrorCorrection` enum: a surface-
code task receives no three-qubit bit-flip example, while an explicit phase-flip
repetition task does. Deterministic collision tests cover typed QAE, QAOA, HHL via
`other`, exact dynamics via `Simulation`, generic versus repetition QEC, QFT with a QPE
comparison, and Lindblad with a QPE comparison. This corrects prompt selection only;
it does not claim generation accuracy until the frozen real-provider rerun.

### Deterministic teleportation instability

The final v9 teleportation result was 2/3 even though ideal coherent teleportation is
deterministic. Durable evidence from the failed trial showed two sandbox executions of
identical source. Both created `AerSimulator(method="statevector")`, executed a separate
input-preparation circuit without `save_statevector()`, and then called
`get_statevector()`. Current Aer does not store a statevector merely because that method
is selected, so both executions raised `No statevector for experiment`; later duplicate
candidates were stopped as non-converging. One successful trial used a saved Aer
instruction and the other directly constructed a Qiskit `Statevector`.

A short Qiskit-wide API rule now prefers `Statevector.from_instruction` for bound
measurement-free circuits and states that Aer requires `save_statevector()` before
`get_statevector()`. This is selected for every Qiskit family and for no Cirq or
PennyLane prompt. A coherent-teleportation helper is selected only when the task context
names teleportation. It accepts any bound one-qubit preparation, uses Bell-transform
qubit 1 for the X correction and qubit 0 for the Z correction, and computes the receiver
Bloch vector and fidelity from a partial trace of the complete three-qubit statevector.

The executable helper preserved `|0>`, `|1>`, `|+>`, the former v9 complex rotation,
and a new three-axis rotation to absolute Bloch/fidelity error below `1e-12`. Three
additional cases with different gates, analytic states, difficulty levels, and RESULT
names were frozen under `diagnostic-teleport-family` before provider execution. Their
real-LLM effect remains unmeasured.

### Exact-dynamics tensor-order convergence

The final v9 sparse-dynamics result was also 2/3. The failed trial executed six
candidates and every one returned the same survival probability as the oracle but
`observable_expectation=0.1912712883` instead of `-0.4844211237`. Source inspection
showed that each candidate constructed Hamiltonian and observable matrices with q0 as
the leftmost Kronecker factor, reversed the initial bitstring into a Qiskit integer,
and then applied the unreversed mathematical matrix in Qiskit's little-endian qubit
order. The exact reference rejected all six by error `0.675692`; repeated prose repair
feedback did not change the value.

A bounded exact indexed-Pauli dynamics helper now keeps all computation in the request's
q0-leftmost mathematical convention. It builds the initial vector directly from the
written bitstring, evaluates `expm(-i*t*H)` and the observable there, and conjugates only
the final unitary by an explicit bit-reversal permutation before attaching it to
physical Qiskit qubits. The generated program then maps the circuit statevector back and
requires it to agree with the mathematical evolved state. The helper is bounded to one
through eight qubits and is selected only for explicit exact Pauli matrix-exponential
dynamics; Lindblad/master equations and requested Trotter approximations do not receive
it.

The same executable helper reproduced the v9 five-qubit result, the v14 four-qubit
complex-Pauli result, and a new three-qubit complex-Pauli system to absolute error below
`1e-12`; circuit-to-mathematical state error was zero for the two larger regressions.
Three fresh two-, three-, and six-qubit cases with different supports, bitstrings,
times, observables, and RESULT names were frozen under `diagnostic-dynamics-family`
before provider execution. The generation gain remains provisional until that run.

These are algorithm-family scaffolds whose matrices, coefficients, widths, circuits,
error locations, and output keys remain task inputs. A product-source search found no
v14 oracle value, Hamiltonian coefficient, optimum, HHL amplitude, or expected
bitstring. Nevertheless, their effect on real LLM generation is **not yet measured**:
the post-change DeepSeek diagnostics failed before Plan with HTTP 402 insufficient
balance, and the OpenAI A/B failed before Plan with HTTP 429
`credit_balance_exhausted`. Those reports are provider-failure artifacts and are not
counted as model-performance results.

Real-LLM four-qubit VQE remains an explicit limitation until this helper is exercised
through Plan and Generate. No exact-state-preparation fallback or task-specific
coefficient was added.

### Frozen broad v15 cohort and oracle audit

After the QAOA reporting boundary and structured generation-family routing changes,
but before any provider outcome, a new ten-case `holdout-v15` cohort was frozen. It is
not a set of renamed helper regressions: it covers PennyLane GHZ stabilizers, a
two-parameter entangled Cirq parameter-shift calculation, two-marked-state Grover,
constrained business-QUBO reporting, graph-state quantum Fisher information, coherent-
input amplitude damping, a nonuniform open-Ising ground state and entropy, ordered
second-order Pauli Trotterization, a complex four-qubit PennyLane VQE, and non-dyadic
finite-register QPE. The mix is one basic, one intermediate, two advanced, and six
research cases across educational, practical, and scientific workloads.

Before freezing v15, twelve previously added broad corpus oracles were independently
recomputed by analytic formulas, finite enumeration, dense eigensolvers, matrix
exponentiation, and classical linear solves. W-state support, teleportation fidelity,
CHSH, Cirq parameter shift, finite-grid QAE, explicit QUBO, two-qubit dynamics, GHZ
QFI, critical-Ising entropy, amplitude damping, HHL fidelity, and PennyLane-VQE exact
energy all matched their checked-in expectations. The largest difference was
`1.41e-12`, caused only by the rounded dynamics value stored in YAML.

The high-risk v15 calculations were then executed locally without an LLM. The complex
four-qubit RY/RZ-CZ ansatz completed all four deterministic starts in 74.55 seconds,
returned energy `-2.21274703943082`, and had exact gap `1.27e-11`, within the 90-second
sandbox boundary. The non-dyadic QPE circuit returned integer 7, phase `0.21875`, and
peak probability `0.9897354277117048`. PennyLane GHZ, Cirq gradients, Grover, graph
QFI, and amplitude damping matched their independent values to at most `5e-16`.
The local-gate Trotter circuit returned `z1=0.2831054137433535`, exact
`z1=0.28195064340364634`, and exact-state fidelity `0.9999981128508367`.

The first Trotter audit briefly produced a false fidelity of about `0.925` because the
audit mapped mathematical q0 to Qiskit physical q2 and then incorrectly applied a
second bit-reversal to the state. Removing that duplicate reversal restored agreement;
no product prompt or oracle was changed from the false result. All ten YAML cases load
through the checked-in eval schema. No real-provider score exists yet, so v15 remains
an unobserved holdout rather than performance evidence.

### PennyLane VQE cross-framework scaffold

Production generation previously selected the bounded VQE scaffold only for Qiskit;
PennyLane VQE received the common 8,606-character prompt with no framework-native
optimization example. A PennyLane candidate was evaluated before changing that
selector. It uses the same bounded two- to four-qubit alternating-ring RY/CZ or
RY/RZ/CZ ansatz, but runs a `default.qubit` QNode with exact adjoint gradients and
returns an optimized `QuantumScript` rather than translating a Qiskit circuit.

Across the existing real three-qubit corpus Hamiltonian, frozen v15 complex four-
qubit Hamiltonian, and six independently seeded two-/three-/four-qubit real and
complex Pauli Hamiltonians, the candidate's worst energy gap was `9.02e-7`. Five of
the six seeded cases had gap at most `1.03e-11`; seeded complex four-qubit case 2101
was the exception. Adding a fourth start did not improve it and all nonzero starts
reached the 300-iteration bound, so extra layers or an unbounded optimizer were not
added merely to erase that result. It remains inside the statevector exact-reference
tolerance. Runtime ranged from 0.10 to 18.78 seconds on the seeded cases. The existing
three-qubit case took 1.08 seconds at gap `1.33e-15`; v15 took 26.05 seconds at gap
`1.07e-11` with all four requested starts.

The retained helper validates Hermiticity and dimensions, supports identity offsets
and arbitrary distinct PennyLane wire labels, uses the best computational-basis state
only as an ansatz start, executes every requested restart, and diagonalizes solely for
the reported comparison. Its optimized tape crossed the real sandbox observer with
two qubits, zero measurement-policy measurements, native statevector evidence,
2,048-shot native sampled evidence, and no interchange error. Selection is narrow:
PennyLane VQE receives the 14,502-character native helper, while PennyLane Bell and
Cirq VQE remain on the common prompt and Qiskit VQE keeps its own helper. No tested
Hamiltonian coefficient or oracle is present in product source. As with the other
post-v14 scaffolds, real-LLM generation impact remains unmeasured.

### Framework-scoped generation contracts

The runtime already selected one algorithm-family helper, but the remaining common
generation prompt still sent every SDK-specific rule to every selected framework. A
Cirq or PennyLane run therefore received Qiskit-only Aer, rotation-scalar, Pauli/axis,
and `QFTGate` instructions; Qiskit received Cirq precision and PennyLane serialization
instructions. These rules were not merely documentation: this is the exact system
prompt passed to Generate, so irrelevant APIs could compete with the selected-framework
contract and consume context on every candidate and repair.

The API, representation, and QFT rules are now assembled by selected framework while
the cross-framework artifact, numerical, sandbox, and safety invariants remain shared.
Algorithm-family helper selection is unchanged. A complete 3-framework by 16-algorithm
test matrix proves that each generated prompt contains its own SDK markers and none of
the other two SDK-specific marker sets. Existing family-boundary and worker runtime
tests also pass. For neutral tasks, the Qiskit prompt range fell from 9,287–16,921 to
8,919–16,553 characters; PennyLane fell from 8,829–14,725 to 7,335–13,231; and Cirq
fell from 8,829 to 7,478. No task coefficient, expected answer, holdout ID, or surface
wording was added. This is a general context-isolation change; its real-model effect is
unmeasured while provider credit is unavailable.

### Seeded procedural generalization evals

Static frozen prompts make individual regressions attributable, but their coefficients
eventually become visible during repeated development. The eval harness now optionally
adds versioned procedural holdouts whose task inputs and independent oracles are
derived from a recorded seed. Generator `v3` covers twenty-three formulations: basic
single-qubit state preparation, finite-shot Pauli estimation, mid-circuit active reset,
native gate-basis compilation, arbitrary-bipartition entanglement spectra,
unconstrained explicit QUBO, constrained assignment,
exact dyadic and non-dyadic QPE, finite-register amplitude estimation, coherent-input
amplitude damping, explicitly non-unitary mixed-state Kraus channels, Lindblad evolution
with an independently simulated Stinespring witness, entangled Cirq parameter shifts,
general Pauli-generator QFI,
multi-solution Grover amplification, partially entangled CHSH, arbitrary-state
teleportation, coherent bit/phase-flip repetition QEC, ordered second-order Pauli
Trotterization, exact indexed-Pauli dynamics, exact-dyadic linear systems, and complex
PennyLane VQE. They span every declared difficulty from basic through research,
Qiskit, Cirq, and PennyLane, plus educational, practical, and scientific workloads.

The generator imports no product verifier and needs no provider. QUBO and assignment
truth come from complete enumeration; QPE and Grover from finite-register/amplitude-
amplification arithmetic; damping, gradients, CHSH, teleportation, and the structured
two-qubit dynamics family from independent analytic formulas; Lindblad truth is checked
through a separately assembled Liouvillian matrix exponential and unitary Stinespring
dilation; mixed-channel truth is assembled from Kraus matrix sums before being compared
with Aer's density-matrix execution; finite-shot truth uses an independently derived
Hoeffding interval rather than a frozen random count; active-reset truth marginalizes
the protected multi-bit counts directly; compiled-state truth combines an independent
dense state, fingerprint-bound native statevector, trusted QASM gate names, and native
transpilation evidence; entanglement truth uses an independently assembled Schmidt
matrix for the requested qubit subset; linear systems use a
closed two-by-two solve with a separately checked dyadic spectrum; PennyLane VQE uses
the analytic parity-block spectrum and is independently checked by a complex dense
eigensolve in tests. A SHA-256-derived sub-seed for each `(version, root seed, family,
index)` keeps every case stable when more cases per family are requested. Version and
seed are included in case IDs and the final report note.

Unit tests independently reparse the written prompts and recompute every family oracle,
pin seed sensitivity and exact reproducibility, and reject invalid seeds or family
counts. A wider `v3` property audit generated 6,900 cases from 100 root seeds with three
cases per family: every family contributed 300 cases, all 6,900 IDs were unique,
repeated generation was byte-equivalent at the model-data level, every oracle was
finite, and the longest prompt was 1,229 characters. The CLI can mix two fresh cases per
family into v15 with:

```bash
uv run --package majorana-evals python -m majorana_evals \
  --corpus evals/holdout-v15 --out evals/report.json \
  --procedural-seed 20260802 --procedural-cases-per-family 2
```

This adds forty-six cross-instance cases without changing product prompts, for 56
total cases when combined with v15. Five seeds from each newly executable helper family
were then run locally. Across twenty executions, maximum absolute error was
`8.88e-16` for teleportation, `2.22e-16` for dynamics, `1.20e-14` for the HHL circuit,
and `6.66e-16` for PennyLane exact energies; the largest PennyLane variational gap was
`6.04e-14`.

Numeric variation alone does not test wording generalization: each family could still
be recognized from one repeated sentence template. The generator therefore supports
versioned `surface-v2` metamorphic variants. Variant 2 changes instruction verbs,
RESULT/artifact phrasing, exactness language, and prohibition wording; variant 3 uses a
strict-brief wrapper, a different controlled vocabulary, and a bullet-structured
requirements layout instead of one prose paragraph. Both preserve every supplied
number, sentence/operation order, bit convention, API/machine identifier, expected
value, artifact oracle, difficulty, framework, and workload. The original wording
remains variant 1, so existing regressions and attribution stay intact.

The wider wording cohort is selected explicitly:

```bash
uv run --package majorana-evals python -m majorana_evals \
  --corpus evals/holdout-v15 --out evals/report.json \
  --procedural-seed 20260802 --procedural-cases-per-family 2 \
  --procedural-prompt-variants 3
```

This combines 10 static cases, 46 base procedural instances, and 92 surface variants,
for 148 real-provider cases. A provider-free property audit generated all three forms
for 2,300 base cases across 100 root seeds: all 6,900 IDs were unique, regeneration was
byte-equivalent, every within-instance wording was distinct, and there were zero oracle,
number-token, or machine-identifier mismatches. Natural random-instance collisions left
6,660 unique prompt texts across the 6,900 cases; IDs and attribution remain distinct.
Every third form had at least two structured requirement bullets, with zero semantic
model-data, number-token, or machine-identifier mismatches. The longest transformed
prompt was 1,377 characters. No surface wording or variant ID
was added to product prompting or routing.

Each generated form now also carries eval-only `semantic_group_id` and `prompt_variant`
provenance through `CaseResult`. Reports pair those records instead of treating the
wordings as unrelated tasks. `metamorphic_robustness` is the fraction of semantic groups
for which every variant passed every repetition; `metamorphic_consistency` is the
fraction whose binary pass/fail outcome matched across every variant at each aligned
trial. An incomplete or duplicate variant-by-trial matrix satisfies neither metric, and
per-variant pass rates remain visible separately. Existing report JSON remains loadable
because the new fields have neutral defaults. A provider-free instrumentation audit over
all 6,900 generated forms recovered exactly 2,300 three-variant groups and 2,300 records
for each variant label. Feeding deliberately all-pass synthetic outcomes produced 1.0
for both paired metrics, as expected; this validates aggregation only and is not an Agent
performance result. Mixed and incomplete matrices are pinned by unit tests so swapped or
missing trials cannot be mislabeled robust.

The basic family was added only after a slice audit showed that the procedural corpus
had intermediate, advanced, and research cases but no seeded basic case. It varies both
angles and requires exact X/Y/Z Bloch components plus the one-state probability, which
detects gate-order and relative-phase mistakes without relying on shots. One hundred
generated circuits were executed against an independent dense-state oracle; maximum
error across all four outputs was `4.44e-16`. No product prompt or helper was changed for
this already-supported fundamental operation.

Finite-shot tasks exposed a harness-level gap before any product change: the evaluator
could only compare a random scalar with a fixed value plus an arbitrary tolerance. It
now supports finite inclusive numeric ranges with schema validation, rejects overlapping
exact/range expectations, and explicitly rejects NaN or infinity instead of allowing
IEEE comparisons to fall through. The new procedural family varies X, Y, and Z basis
measurements, state angles, simulator seeds, and 4,096 through 20,000 shots. Its range is
derived from a delta=`1e-9` Hoeffding bound on the actual sampled expectation, while the
unmeasured expectation and requested shot count remain exact oracles.

One hundred seeded Aer executions covered all three axes and all five shot counts. None
fell outside the independent confidence interval; maximum observed sampling error was
`0.04379`, and the smallest remaining interval margin was `0.03593`. This avoids both
pinning one SDK-specific random count as truth and loosening every result with a generic
tolerance. Product prompting and verification were left unchanged until a real-model
run shows a generation or review defect.

Mid-circuit control adds a separate practical execution axis. The generated task uses
two classical bits: it measures an arbitrary `RY(theta)` state into c0, applies `X`
through current Qiskit `if_test` control only when c0 is one, then measures the reset
state into c1. The evaluator now supports generic protected-count marginals over selected
displayed bit positions, including register separators, nonnegative-count validation,
width checks, and independently derived probability intervals. It therefore verifies
both the random first outcome and deterministic reset outcome from counts rather than
trusting reported scalar marginals.

One hundred preliminary circuits had zero final-one probability and maximum first-bit
sampling error `0.01094`. A separate 100-case generated cohort crossed the composed
observer with zero oracle failures; maximum first-bit error was `0.01165`, every trusted
native re-sample reset to zero, and every dynamic QASM 3 export retained its `if`
statement. The native statevector path correctly declared incapacity instead of
pretending a feed-forward circuit was unitary. This QASM and sampling behavior is pinned
in permanent regressions. The product implementation already behaved correctly, so no
Agent prompt or runtime rule changed.

The entanglement-spectrum family widens the research slice beyond one fixed critical
Ising partition. It varies three through seven qubits, complex rotation layers, a random
entangling path, and arbitrary one- through three-qubit subsystem sets that need not be
contiguous. The independent oracle maps each computational-basis amplitude into a
Schmidt matrix using explicit Qiskit qubit indices, then derives the complete reduced
spectrum, purity, base-two von Neumann and Renyi-2 entropies, largest eigenvalue, and
thresholded Schmidt rank. The fingerprint-bound native statevector separately proves
that those metrics correspond to the saved circuit.

Three hundred preliminary random circuits covered 102 partitions and Schmidt ranks
2/4/8. Maximum density, spectrum, and entropy errors against Qiskit partial trace were
`4.44e-16`, `9.99e-16`, and `2.50e-15`. The generated 100-case cohort covered 59
partitions with zero oracle failures; maximum RESULT error was `1.33e-15`, maximum native
artifact error was `2.17e-16`, and the largest QASM was 549 characters. No Ising
coefficient, fixed half-chain layout, or expected spectrum entered product source, and
the product prompt stayed unchanged because no generation-boundary defect was observed.

Compilation needed a different oracle because valid transpiled circuits are non-unique:
pinning one emitted circuit or one gate count would reject equally correct compiler
outputs. The harness now optionally checks the fingerprint-bound FINAL_CIRCUIT itself.
It compares trusted native amplitudes with an independent target up to global phase,
extracts executable gate names from trusted QASM, and checks the observer's native
optimization evidence. Missing evidence, non-finite amplitudes, wrong dimensions,
relative-phase errors, or a gate outside the declared basis fail even when model-authored
RESULT claims perfect fidelity.

Before retaining the family, 200 random two- through five-qubit state-preparation
circuits were independently multiplied in NumPy and transpiled to `rz/sx/x/cx`. Dense
source error was at most `2.22e-16`; compiled state error was at most `8.47e-16` up to
global phase. A further 100 generated cases crossed the real composed observer and the
new artifact oracle with zero failures. Maximum native error was `1.16e-15`, compiled
depth was at most 13, and the largest QASM was 887 characters. No exact compiled gate
sequence, depth, or SDK-specific output is frozen, and no product prompt changed because
the existing compiler execution path exposed no defect.

The mixed-state slice addresses a different blind spot: every earlier procedural
circuit was unitary even when it represented a channel through a larger Stinespring
system. Two hundred random one-qubit cases now apply explicit amplitude-damping Kraus
operators followed by a four-operator Pauli mixture. An independently summed channel
matched Qiskit Aer density-matrix execution with maximum density error `3.33e-16`.
The final 100 generated cases varied the input Bloch state and both error probabilities;
maximum RESULT error and trace error were each `4.44e-16`, and the minimum density
eigenvalue was `0.0311`.

This is also an artifact-honesty test. A representative non-unitary circuit crossed the
real composed observer, preserved its protected RESULT and one-qubit resource metrics,
and explicitly reported that neither a pure native statevector nor OpenQASM 3 was
available. That is the correct outcome for a Kraus instruction: the executable Python
remains canonical even though Studio cannot draw it. A permanent framework regression
now prevents a missing diagram from being treated as failed code or fabricated QASM.
No product prompt or implementation changed because the existing execution boundary
already behaved correctly.

The Lindblad slice was added only after two independent audits found no product-verifier
defect. Two hundred random one- and two-qubit Hamiltonian/jump-operator problems matched
a direct DOP853 density-matrix integration with maximum density error `2.38e-13`, trace
error `2.22e-16`, and minimum density eigenvalue `-2.00e-16`. A separate 200-case
one-qubit analytic channel audit varied damping, dephasing, frequency, time, and all four
X/Y eigenstates; its three-qubit Stinespring circuit matched the master-equation state
with maximum density error `4.44e-16` and minimum fidelity
`0.9999999999999978`.

The first 100-case procedural execution then caught a defect in the new eval witness,
not in the product Agent: the `|-i>` preparation incorrectly combined both `Z` and
`S-dagger`, producing the opposite Y eigenstate. Four-state regression coverage was
added and the witness was corrected without changing any expected tolerance. Re-running
100 generated cases covered `|+>`, `|->`, `|+i>`, and `|-i>`; maximum result error was
`2.66e-15`, minimum Stinespring fidelity was `0.9999999999999982`, maximum trace error
was `3.33e-16`, and every density matrix remained positive. A representative artifact
also crossed the composed Majorana observer with three qubits, all eight amplitudes,
and error-free OpenQASM 3 export. Since the product verifier passed both independent
audits, no Lindblad-specific product prompt or implementation change was added.

Non-dyadic QPE was prioritized because the unseen v14 case had a diffuse-distribution
failure while the selected generation scaffold only covered measured, exactly dyadic
phases. The scaffold is now one bounded finite-register helper: it validates an arbitrary
one- to four-qubit prepared eigenstate, constructs controlled powers, derives the exact
counting distribution from the complete unmeasured statevector, and optionally produces
sampled counts as separate fields. It never substitutes the known continuous phase for
the finite-grid peak. Five hundred random one- to three-qubit eigenbases, phases, and
counting widths matched an independent Dirichlet-kernel distribution with maximum error
`3.64e-14`; four sampled dyadic controls placed all 512 shots on the exact key.

The first real-observer attempt found a second general defect: Qiskit computed the raw
controlled `UnitaryGate` circuit correctly, but OpenQASM 3 export raised `TypeError`,
which leaves Studio unable to draw the artifact. The helper now computes truth from the
transparent circuit, then deterministically transpiles only `FINAL_CIRCUIT` to portable
`u`/`cx` gates. Across 100 generated non-dyadic cases, the reported distribution differed
from the independent oracle by at most `1.61e-14`, the saved portable artifact by at most
`1.70e-14`, every QASM export succeeded, the largest export was 9,026 characters, and
the slowest helper call took 0.55 seconds. A representative six-qubit artifact crossed
the composed observer with the correct integer 7, phase `0.21875`, probability
`0.9897354277117062`, native statevector evidence, and no interchange error. No expected
phase or distribution from the generated cohort appears in product source.

QFI and second-order Trotterization were then proceduralized because their coverage was
still limited to two fixed QFI states/generators and two fixed Hamiltonians. Before
changing the corpus, 100 three- to five-qubit states with arbitrary real Pauli-generator
sums were compared between Qiskit and an independently assembled dense state/operator;
maximum QFI error was `1.42e-14`. Another 100 noncommuting three-term Hamiltonians varied
coefficients, term order, initial basis state, time, step count, and measured qubit. The
ordered symmetric product circuit matched an independently multiplied dense product
state to `1.10e-14`, its observable to `2.07e-14`, and exact-state fidelity to
`2.31e-14`.

The final generated cohorts added another 100 QFI and 100 Trotter circuits. QFI mean and
value errors were at most `3.61e-16` and `1.42e-14`; Trotter observable and fidelity
errors were at most `2.54e-14` and `2.47e-14`. The procedural oracle uses NumPy dense
linear algebra and imports no product verifier. Product generation guidance was left
unchanged because these executions exposed no product-side defect; the new cases measure
whether the real model can generalize the existing common numerical rules.

Representative QFI and PauliEvolutionGate Trotter artifacts also crossed the real
Majorana composed-execution observer. Both produced the expected eight-amplitude native
statevector without observer error and exported OpenQASM 3 without interchange error.
Because the requested circuits were intentionally unmeasured, the observer declared
`circuit has no measurements to sample` instead of inventing counts. A permanent
regression pins the custom Pauli-evolution instruction's native state to `1e-14` and its
QASM export path.

The assignment portion was checked separately because the retained scaffold supplies
a generic QUBO layer rather than a solved assignment algorithm. Fifty generated three-
and four-worker matrices (23 and 27 respectively) were expanded into their row/column
penalty polynomials. Across 150 independently selected basis assignments, the local
`RZ`/`RZZ` layer's relative phase matched `exp(-i*gamma*C(x))` to maximum error
`1.30e-13`; the largest 16-variable layer contained 64 gates. This validates the
encoding and polynomial resource behavior, not the optimizer's probability of sampling
the optimum. Constrained-QAOA search quality therefore remains an explicit provider-run
question rather than being inferred from a correct cost unitary.

The first HHL audit exposed one real cross-instance defect: when two normalized
components had exactly equal magnitude, floating-point noise made the dense solver and
postselected circuit choose different largest-component indices, so the same physical
state could be compared with opposite global signs. Both the independent verifier and
the generic HHL helper now choose the lowest index among magnitudes tied within
`1e-12`. The failing generated seed moved from component error `1.414` to the final
family maximum `1.20e-14`; no tolerance was relaxed. The extraction prompt, helper
description, and procedural task now state this convention explicitly, while preserving
the literal A*x=b sign for unnormalized classical components and noting that ratios are
global-sign invariant. The expanded cohort is ready for real-provider execution but has
no model-performance result while provider credit is unavailable.

The `v3` expansion added finite-register QAE and coherent repetition-code QEC because
both had generation guidance but no procedural holdout. The first QAE pressure test
used 200 random one- to three-qubit unitaries, arbitrary computational-basis good-state
sets, evaluation widths one through seven, and the two endpoint amplitudes. Three cases
were decoded incorrectly: the helper selected one raw phase bin and only then folded
it, so at low width the two individually smaller symmetric bins were never combined.
For example, correct folded estimate `0.5` was returned as `0` or `1`. The generic
decoder now aggregates every `y` and `2**m-y` pair before selecting the dominant folded
integer, and the planning rule states the same finite-register distinction. On 500 new
random unitaries, its complete phase distribution and selected pair agreed with an
independent Dirichlet-kernel QPE oracle in every case; the largest distribution and pair
error was `2.43e-12` in a near-endpoint floating-point case. A separate 100-seed `v3`
execution had zero amplitude-estimate error and maximum pair-probability error
`1.74e-14`. No tolerance was relaxed and no generated angle, good-state set, or answer
was added to product source.

The QEC scaffold needed no product change. One hundred arbitrary complex logical states
were run through both bit-flip and phase-flip repetition codes for no error and all
three single-qubit errors: all 800 recovery executions passed, with minimum fidelity
`0.9999999999999969`. The 100-seed procedural cohort then executed one generated code
variant and all four error cases per seed; all 400 executions passed with the same
minimum fidelity. These cases vary both logical amplitude and relative phase, avoiding
the earlier real-only demonstration state.

After the fix, the local scaffold audit was widened without further product changes.
Exact QPE, arbitrary-state teleportation, and exact indexed-Pauli dynamics each ran on
100 independently seeded v2 instances, for 300 circuit executions in 12.39 seconds.
Every QPE count distribution placed all 4,096 shots on the exact expected key, with zero
phase and peak-probability error; maximum teleportation and dynamics errors were
`8.88e-16` and `4.44e-16`. Thirty complex two-qubit PennyLane VQE instances then ran
with three deterministic starts each: all met the `2e-5` external tolerance, maximum
variational gap was `4.63e-14`, maximum exact-oracle error was `6.66e-16`, and the
slowest case took 1.56 seconds. Because these broader trials did not expose a defect,
their product paths were left unchanged.

The same 100-seed audit exposed a framework-wide precision issue in the Cirq gradient
family. Cirq's default `complex64` simulator produced a maximum exact-gradient error of
`1.277e-7`, which can falsely fail a correctly formulated program under a tighter
declared tolerance. Re-running the identical circuits with `complex128` reduced the
maximum error to `3.05e-16`. The common generation contract now requests
`cirq.Simulator(dtype=np.complex128, seed=...)` for exact statevectors, expectations,
and parameter-shift gradients, and the trusted native observer independently captures
and uses the same precision for statevector evidence. Sampled execution is unchanged,
no task coefficients or expected answers were added, and no verification tolerance was
relaxed. A real composed-execution regression proves both that the observer matches a
separate `complex128` statevector to `1e-15` and that the fixture would differ by more
than `1e-9` under Cirq's default precision.

### Generic multi-marked Grover scaffold

The earlier four-qubit Grover example was removed because its fixed marked state and
instance shape could encourage memorization. The retained replacement is different: it
accepts an arbitrary explicit set of unique, equal-width bitstrings, constructs one
X-conjugated multi-controlled phase oracle per supplied string, and derives the default
iteration count from `asin(sqrt(M/N))`. No marked string, width, iteration count, or
expected probability from an eval case appears in product source. Typed `Grover` is
authoritative; free-text `Grover` or `amplitude amplification` is used only for generic
`Other`/`Simulation`/`StatePreparation`, and Cirq, QPE, and other typed families do not
receive the helper.

This change addresses an observed family-level failure rather than a hypothetical
case: one real Grover task produced the same invalid Qiskit circuit composition across
six candidates, while a different model later solved it. Before retaining the helper,
the circuit was executed for two through ten qubits, one through three marked states,
and different non-symmetric marked sets. Representative exact marked probabilities
were `1.0` for `(n=2,M=1,r=1)` and `(n=3,M=2,r=1)`,
`0.9613189697265041` for `(n=5,M=2,r=3)`, `0.9981388254090018` for
`(n=6,M=3,r=3)`, `0.9968460471837406` for `(n=8,M=3,r=7)`, and
`0.9999998719547132` for `(n=10,M=3,r=14)`. The largest discrepancy from
`sin((2r+1)theta)^2` was `3.50e-12`; probability was equal across marked states to
`2.54e-14`.

A separate seeded audit generated 100 unseen marked sets at three through eight
qubits with one through four solutions. Its maximum formula error was
`6.43e-13`, maximum marked-state probability spread was `1.35e-14`, and all three
uniform-tie cases were handled without assuming an arbitrary dictionary-order winner.
An asymmetric five-qubit, two-solution execution crossed the real sandbox observer:
the generated run reported exact probability `0.961318969726502` and sampled
probability `0.9638671875`; the independent 2,048-shot observer's top key was marked,
resource metrics reported five qubits and five measurements, and OpenQASM 3 export had
no interchange error. Exact and sampled metrics remain separate, so a known analytic
probability cannot be substituted for observed counts. The implementation is bounded
to 2–10 qubits, at most 32 marked states, 100 iterations, 20,000 shots, and 512 total
oracle applications to preserve the local-runtime contract. Real-LLM impact remains
unmeasured while provider credit is unavailable.

### Effective circuit resource-boundary audit

The AUTO router and Chat assistant previously described the default lane as executable
up to 27 qubits, matching the absolute Plan schema ceiling but not the worker that
actually creates candidates. The worker conservatively budgets 32 bytes per complex
statevector amplitude under a 2,048 MiB lane and rejects estimates greater than or
equal to that limit before sandbox creation. Thus 25 qubits estimates 1,024 MiB and is
admitted, while 26 and 27 estimate 2,048 and 4,096 MiB and are rejected. A model could
therefore route a nominally 26-qubit request to Execute based on a capability the
runtime never offered.

The shared execution-boundary text now distinguishes the absolute 27-qubit schema/lane
ceiling from the effective 25-qubit circuit/simulation maximum. An integration test
derives the 25/26 boundary from the executor's own estimator and default sandbox memory,
then pins the router text to the same result. No task-name or benchmark-specific routing
rule was added. In particular, the router still sends every AUTO message to the neutral
classifier: reintroducing a regex/keyword short-circuit would conflict with that tested
design and could misread an explanatory question as an execution request. Large
underspecified assignment requests remain governed by the general input-readiness rule
(missing costs, constraints, or objective data are never invented) and the general
capability boundary; the product does not infer a particular encoding merely from
vehicle and stop counts. Real-provider routing behavior remains unmeasured while credit
is unavailable.

### Seeded AUTO-routing holdouts

The original routing corpus contained the literal 12-vehicle/40-stop request. That is a
useful regression but weak evidence of wording-level generalization, so the intent eval
can now add seeded `v1` routing holdouts without changing the product router. Eight
balanced families create canonical circuits, explicit QUBOs, explicit dynamics, and
fully specified 2x2 through 4x4 assignments that should execute, paired with missing-data
business requests, 26-plus-qubit statevectors, unavailable dependencies/hardware, and
fully specified 6x6 through 8x8 one-qubit-per-pair assignments that must stay in chat.
The assignment contrast separates input readiness from capability readiness: the large
case includes its complete cost matrix but explicitly requires 36–64 qubits.

A property audit generated 2,400 cases from 100 root seeds with three cases per family.
All IDs were unique, each family contributed 300 cases, regeneration was byte-equivalent,
and the cohort was exactly balanced at 1,200 execute and 1,200 chat decisions. Bounded
assignment widths ranged from 4 to 16 qubits, while oversized widths ranged from 36 to
64. The CLI merges two cases per family with the 14 fixed holdout cases into a balanced
30-case real-provider routing cohort. No regex or deterministic task-name shortcut was
added to production; the result remains unmeasured until provider credit is restored.

Reports:

- `report-holdout-v9-final-mixed-rebaseline-20260802.json`
- `report-holdout-v14-unseen-baseline-20260802.json`
- `report-diagnostic-qpe-family-scaffold-20260802.json` (provider failure; invalid for
  performance)
- `report-diagnostic-qpe-family-openai-ab-20260802.json` (provider failure; invalid for
  performance)

### Restored-credit real-provider audit

After DeepSeek credit was restored, the frozen v15 cohort ran end to end against the
real `deepseek-v4-pro`/`deepseek-v4-flash` profile. It passed 8/10 cases (80%, Wilson
95% interval 49.0%–94.3%), with 61 recorded calls, 358,734 input tokens, 42,079 output
tokens, and no oracle-discordant materialization. Basic, intermediate, and advanced
cases passed 1/1, 1/1, and 2/2; research cases passed 4/6. The protected RESULT oracle
confirmed every success. Failures were one Plan that never became executable for a
second-order Trotter task and one PennyLane VQE whose generated optimizer passed an
ordinary NumPy array to `qml.grad`, yielding no trainable parameters.

The generic PennyLane helper already used `qml.numpy.array(..., requires_grad=True)`;
the common SDK rule now states that boundary explicitly. Optional exact-dynamics data
bound to a secondary rather than primary RESULT key now degrades by dropping that
unsupported optional check instead of invalidating the whole Plan. Re-running the two
frozen failures recovered VQE to an energy within `4.22e-13` of the independent exact
ground state. The Trotter candidate was materialized with a wrong full-state fidelity
after semantic review moved the Plan's lower bound around the candidate's own claimed
"exact" value. Its reported observable happened to match because the chosen basis
state masked a Qiskit/leftmost-qubit permutation mismatch.

That event was an oracle-discordant private materialization, not a Verified false
positive: its persisted verifier decision was `inconclusive`. Nevertheless, accepting
the candidate's own reference as independent evidence is unsafe. Planning and review
guidance now forbid laundering an observed value into a relaxed expected range, and a
deterministic replan guard preserves any existing lower and upper bounds unless the
proposal tightens them. Qiskit's q0-leftmost bridge rule now requires one explicit
index reversal or bit permutation before comparing dense and SDK states. A final
frozen rerun exhausted seven candidates and failed safely rather than saving the wrong
answer: 0/1 materialized and zero oracle-discordant materializations. This removes the
unsafe acceptance path; it does not yet solve that Trotter generation task.

Reports:

- `report-holdout-v15-deepseek-post-generalization-20260802.json`
- `report-holdout-v15-failed-pair-repair-20260802.json`
- `report-holdout-v15-trotter-antifp-repair-20260802.json`

### Metamorphic surface audit and generic SDK repairs

The first real surface-v2 cohort selected seven semantic families and ran each request
in three meaning-preserving forms: base prose, a formal paraphrase, and a structured
strict brief. It passed 14/21, with 4/7 groups robust across all variants and 6/7 groups
outcome-consistent. All six reported `false_positive` rows were actually
`verifier_decision=inconclusive` private materializations; no artifact was Verified.
The eval field retains its historical "succeeded and saved despite oracle disagreement"
meaning, so reports must not describe it as a verified false positive.

The six disagreements concentrated in two complete groups rather than wording noise.
Every single-qubit variant computed Bloch Y as `2*Im(alpha*conj(beta))`, reversing the
conjugation and therefore the sign. Every compiled-state variant produced a correct
transpiled Qiskit circuit and a reported fidelity near one, but the bounded product run
intentionally omitted its extra native statevector snapshot and classified
`generate_preset_pass_manager(...).run(...)` as unoptimized. The only inconsistent
group was the mixed-Kraus channel: base and structured variants recovered, while the
formal paraphrase spent eight candidates passing bare matrices to `QuantumError` or
calling nonexistent `NoiseModel.add_kraus` APIs.

The retained repairs are SDK- and mathematics-level, not case-level. Qiskit generation
now defines Bloch components through `conj(alpha)*beta`, appends literal channels with
`qiskit.quantum_info.Kraus`, converts Aer's saved `DensityMatrix` wrapper to an ndarray
before matrix algebra, and converts `Statevector.data` before ndarray-only operations.
The native optimization classifier recognizes Qiskit's preset pass manager. For eval
scoring only, a missing native snapshot may fall back to independently simulating the
fingerprint-bound sandbox QASM; model-authored RESULT data is never used as that
statevector oracle, and unsupported/nonunitary QASM still supplies no fallback.

On the same frozen seed, the three affected groups then passed 9/9, with all 3/3 groups
robust and consistent and zero oracle-discordant materializations. A focused rerun after
the DensityMatrix conversion rule made all three Kraus variants pass on their first
candidate, versus all three requiring a repair immediately beforehand. More
importantly, a fresh unseen seed changed every angle, channel coefficient, entangler
path, qubit instance, and transpiler seed: the same three families again passed 9/9,
with 3/3 robust groups, 3/3 consistent groups, and zero oracle-discordant
materializations. First-candidate success was 6/9; two initial failures were anomalous
local sandbox timeouts on tiny otherwise-valid programs, and one called the nonexistent
`Statevector.conj()` before repair. The final `Statevector.data` rule is covered by
prompt tests but has not yet received a post-change real-model rerun, so its provider
impact remains unmeasured.

Across the two non-overlapping seeds, affected-family correctness is therefore 18/18
over six semantic groups and three surface forms per group. This is a useful
counterexample search against seed and wording specialization, not proof of universal
generalization: the Wilson lower bound for either nine-case run is only 70.1%, variants
within a semantic group are correlated, and all successful product artifacts still had
an `inconclusive` verifier label rather than Verified evidence. No procedural ID, seed,
angle, coefficient, target state, or expected scalar was added to product source.

Reports:

- `report-procedural-surface-v2-stratified-deepseek-20260802.json`
- `report-procedural-surface-v2-targeted-repair-deepseek-20260802.json`
- `report-procedural-surface-v2-kraus-first-candidate-deepseek-20260802.json`
- `report-procedural-surface-v2-unseen-seed-targeted-deepseek-20260802.json`

### Current conclusion

The best earlier mixed estimate remains 20/30 on v9 and the fully unseen v14 estimate
remains 6/10. With restored credit, frozen v15 reached 8/10, while the first 21-case
metamorphic cohort exposed two systematic semantic/evidence gaps and one wording-
sensitive channel failure. Generic SDK repairs recovered all 18 affected-family
variants across two seeds. This is stronger evidence of bounded cross-instance and
surface-form capability, not proof of universal generalization or research readiness.
Second-order Trotter generation still fails safely, all surface-cohort successes remain
verification-inconclusive, and the latest Statevector wrapper rule is not yet measured
against a real provider. All experiments used local `.env.local` provider configuration,
throwaway local PostgreSQL, and `LocalSubprocessSandbox`; none used GCP.
