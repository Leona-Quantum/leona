# Paper-to-code benchmark — provenance

How every one of the 5 shipped tasks was sourced and verified, and which candidates from
the initial search were investigated and dropped, and why. Candidate discovery was a
research pass over recent arXiv quant-ph/cs.ET listings (WebSearch + the arXiv API);
every candidate's title, authors, and submission date were confirmed by opening its actual
arXiv abstract page directly, never taken from a search snippet. Circuit-level detail for
the 5 shipped papers was then pulled from each paper's ar5iv HTML render (or, when ar5iv
had not yet processed it, `arxiv.org/html/<id>`) via a second, targeted fetch per paper —
**every mathematical claim about a paper below is either a verbatim quote from that fetch,
or explicitly marked as independently derived/verified** (never asserted from memory of
"how this kind of circuit usually works").

## How new is each task?

Freshness (posted after every model's cutoff — `SPEC.md`) is a necessary but not
sufficient condition for "a model can't have memorized this." A brand-new paper can still
restate a construction that predates it by years. Each task below is classified
`paper-specific` (the construction is the paper's own contribution, or needs a
parameter/structure only this paper gives) or `restated` (the construction predates the
paper), reviewed against the paper's own text rather than left as a self-assessment:

| Task | `novelty` | One-line reason |
|---|---|---|
| `virtual-rz-single-layer-ansatz` | `restated` | A local-rotation + entangling-layer "hardware-efficient ansatz" is a generic, long-standing VQE/QML template; this paper applies it to PDE state prep rather than inventing the layer shape |
| `dicke-state-k1-preparation` | `restated` | The k=1 Dicke state is the W state — textbook, and the paper's own Eq. 9 states it as a special case of a known result, not its novel contribution |
| `belief-propagation-tree-state-prep` | `paper-specific` | The 2-CNOT rotation primitive is known, but the BP-marginal-to-angle formula and its recursive tree composition (Eqs. 34, 38-40) are presented as this paper's own method |
| `ma-qaoa-single-layer` | `restated` | Multi-angle QAOA (independent angle per Pauli term) is a known ansatz variant from prior literature; Eq. 18 restates that general form for this paper's application |
| `lcu-block-encoding-rate-matrix` | `paper-specific` | LCU/block-encoding is a known framework, but the specific rate matrix `A=k(S-I)` and its 2-term decomposition (Eq. 34) is this paper's own contribution |

**Only `belief-propagation-tree-state-prep` and `lcu-block-encoding-rate-matrix` (2 of 5)
support a freshness/"not memorizable" claim.** Every `BenchmarkReport` this harness
produces carries the `paper-specific`-only score as a separate field
(`paper_specific_total`/`paper_specific_passed`/`paper_specific_pass_rate`) precisely so a
reader is never tempted to quote the combined 5-task figure as contamination-proof
evidence — see `SPEC.md`'s "How new is each task?" for the full policy. The 3 `restated`
tasks are not wasted: they exercise the same harness, the same sandbox guard, and the same
grading machinery end to end, and still measure whether a model can correctly implement a
real (if well-known) quantum construction — a genuine, if different, signal.

## Tasks shipped

### `virtual-rz-single-layer-ansatz` — arXiv:2608.17249

Fujii, "Low-Depth and Noise-Resilient Quantum State Preparation for Partial Differential
Equations via Virtual Rz" (2026-08-18). The ansatz (Ry rotations -> nearest-neighbor CZ
layer -> virtual-Rz frame updates) is quoted directly from the abstract and Figure 1's
caption. **Independently verified**: CZ gates are diagonal in the computational basis and
therefore mutually commute regardless of which qubits they act on, so "nearest-neighbor CZ
layer" is unambiguous (checked this is a general fact, not specific to this circuit) even
though the paper's own text does not spell out an operation order for >2 CZ gates. The
paper gives no fixed numeric angles (they are variational, optimized via COBYLA for a
specific PDE target in the paper's own application) — this task grades the ansatz
STRUCTURE for arbitrary input angles, which is what a model has to get right regardless of
what an optimizer later does with it.

### `dicke-state-k1-preparation` — arXiv:2608.22892

Tao, Wang, Zuo, "Deterministic Preparation of Arbitrary Spin Eigenfunctions" (2026-08-24).
Equation (9) — quoted directly — states the paper's own maximum-spin special case reduces
to the standard equal-superposition Dicke state. This task targets the `k=1` special case
of that closed-form equation (the "W state"), NOT the paper's actual novel generalization
(non-uniform, Clebsch-Gordan-weighted "branching path" states, Eq. 28-34 and 45-46) —
because the fetched full text confirms **no fully worked small gate-sequence example exists
in the paper** for the general case ("Figure 3... shows only a schematic structure without
specific numerical parameters or complete instantiation"; "No minimal explicit gate
sequence is provided in the paper"). Building a "reference solution from the paper" for the
general case would have meant inventing a circuit the paper doesn't actually give, so this
task deliberately targets the one piece the paper states in exact closed form instead.
**Independently verified**: the shipped recursive `X` + `(controlled-Ry, CX)` construction
was simulated for `n=3,4,5` and confirmed to put exactly `1/n` probability on each
Hamming-weight-1 basis state and zero elsewhere in every case, before being written into
the task.

### `belief-propagation-tree-state-prep` — arXiv:2608.26840

Hernández Vera, Jamialahmadi, Mete, Schneider, De Pascale, "Quantum Rare-Event Estimation
for Ising Graphical Models with Belief-Propagation State Preparation" (2026-08-27).
Equations (34), (38)-(40) — quoted directly — give a fully general, exact formula (root
rotation + a two-CNOT conditional block per non-root tree node). The fetched text confirms
the paper's own smallest studied system is a 20-node model ("too large to serve as a
pedagogical example") — **no toy numeric example exists in the paper**, so the specific
3-node tree and probability values in this task were constructed by applying the paper's
own general formula to numbers chosen for this benchmark, stated plainly rather than
implied to be vendored from the paper. **Independently verified**: built the circuit for
`p_r=0.36`, `P(a=1|r=0)=0.2`, `P(a=1|r=1)=0.7`, `P(b=1|r=0)=0.5`, `P(b=1|r=1)=0.1` and
confirmed its measured probabilities match the classically-computed joint distribution
`P(r,a,b)=P(r)P(a|r)P(b|r)` exactly across all 8 outcomes.

### `ma-qaoa-single-layer` — arXiv:2609.02793

Ashfaq, Byun, Kim, "Variational preparation of thermofield double states for SYK models
via multi-angle QAOA" (2026-09-02). Equation (18) — quoted directly — defines the ma-QAOA
ansatz as a product of Pauli-string time-evolutions, each with its own independent angle
("an independent angle to every time evolution", also quoted directly). This task grades
exactly that equation's mathematical content (Pauli-string evolution composition with
independent per-term angles) at a small size (N=4), not the paper's full SYK physics
application (whose smallest worked instance is N=8, Table 1). **Independently verified,
with a genuine subtlety caught during authoring**: `qiskit.circuit.library.PauliEvolutionGate`
was checked directly against the closed-form matrix exponential for single- and two-qubit
Pauli strings before being trusted as the reference implementation of `exp(-i*angle*P)`.
More importantly: an EARLIER version of this task's hidden test used a single, fully
qubit-symmetric cost term (`"ZZZZ"` alone) and found — by direct numerical check, not by
reasoning about it — that a specific non-uniform mixer-angle set was exactly
`Statevector.equiv()` to a UNIFORM mixer sharing the same mean angle, which would have
silently defeated the test's whole purpose (distinguishing "multi-angle" from standard
QAOA). The shipped test uses two cost terms (`"ZZZZ"` and `"ZZII"`) specifically to break
that symmetry, and the counterexample was re-verified to correctly differ before shipping.
See that case's own `notes` field for the exact numbers.

### `lcu-block-encoding-rate-matrix` — arXiv:2609.08432

Ikeda, Iwakiri, Nishio, Matsumoto, "Explicit block encodings of rate matrices for
simulating polymerization kinetics on quantum computers" (2026-09-08). Section 2.5.1,
Equation (34) and its surrounding prose — quoted directly — give the two-term LCU
decomposition `A = k*(S-I)` with equal-magnitude coefficients, and state (in prose, not
equations) that PREPARE is a single Hadamard and SELECT is a single controlled-S.
**Independently derived and verified, stated plainly rather than read into the paper**: the
paper's own text does not spell out the mechanics of folding the NEGATIVE coefficient
(`c_0 = -k`) into the LCU sandwich (a standard technique — absorb the sign into the
unitary, since PREPARE only ever encodes coefficient magnitudes as real amplitudes) at the
level of exact gates; this task's `X;Z;X`-on-the-ancilla construction was derived
independently and then confirmed numerically (extracting the ancilla=|0> block of the
built circuit's full unitary and checking it equals `A/lambda` to floating-point precision
for `N=4, k=0.5`) before being written into the task.

## Candidates investigated and dropped

Discovered by an initial research pass (14 candidates total, all with confirmed titles/
dates/authors); the following were read in more depth and dropped for correctness or
verifiability reasons, not availability:

- **2609.12698** ("Extremely Low-Cost Magic State Preparation...", Gao/Yuan/Yao,
  2026-09-11) — the abstract's precise numbers (19 qubits, 82 CNOTs) made it the most
  attractive-looking candidate, but the fetched full text shows its FIRST step — preparing
  the 15-qubit Reed-Muller `|+_L>` state — explicitly reuses "the Daguerre-Kim protocol['s]
  ... 25-CNOT `|+_L>` encoder" from a DIFFERENT, prior paper rather than defining it itself
  ("cites prior work... rather than providing an original explicit circuit description").
  Implementing this task would test whether a model knows THAT OTHER paper, not this one —
  dropped.
- **2608.15161** ("Exact and Efficient Circuit Construction for Block Encoding Matrix
  Polynomials", Ko, 2026-08-15) — a general `O(d log d)` algorithm (Algorithm 1) but the
  fetched full text confirms "the paper does not provide a fully explicit, self-contained
  small example for d=1 or d=2" — reconstructing a small instance myself from Eqs. (8)-(10)
  and (19) without the paper's own worked check risked an undetected derivation error.
  Dropped in favor of tasks with a verifiable small instance.
- **2609.07537** ("Toward Fault-Tolerant Variational Optimization: QAOA under [[4,2,2]]
  Error Detection", Child/Dri/Vitali/Vercellino/Leporati, 2026-09-07) — the [[4,2,2]] code
  stabilizers and logical-qubit encodings (Eq. 3) were cleanly quoted, but the paper's own
  novel contribution — the ancilla-mediated inter-block logical R_ZZ gate — is described
  as "the intra-block procedure from [2] plus two SWAP gates" and its exact gate sequence
  lives in Figure 2, which a text-only fetch cannot reliably convey (the fetch itself could
  only paraphrase the figure caption, not the diagram's actual gate list). Dropped rather
  than guess at a circuit diagram.
- **2608.30176** ("Data and code for collision-model Dicke-state preparation...", Vu et
  al., 2026-08-31) — a genuinely concrete circuit (fractional-SWAP collisions, Eq. 1, with
  an explicit 5-qubit `D^2_5` worked instance) but the fetched text states "the collision
  strengths and phase angles are optimized parameters (stored in released data, not fixed
  analytically in the paper)" — i.e. the actual numbers needed to reach a specific target
  state live in a companion dataset file, not the paper's own text. This benchmark only
  uses papers whose task-relevant numbers are recoverable from the paper's own text.
  Dropped.
- **2609.20331** ("State-Space-Based FIR Filtering on a Quantum Computer", Salmi, Rocchesso,
  Välimäki, 2026-09-17) — a first-order lowpass filter example is stated with an explicit
  formula (`F(z) = |0><0| . H . Lambda(z) . H`, Eq. 6), but the underlying "delay gate"
  `Lambda(z)`'s exact multi-qubit realization depends on a "transposition gate" described
  only relative to Figure 2's diagram ("exchanges the amplitudes |0>|1> <-> |k>|0> between
  the work and delay buffers") — a second, more targeted fetch still could not resolve the
  exact qubit count and gate sequence with confidence. Dropped for the same reason as the
  [[4,2,2]] paper: a figure a text fetch cannot faithfully convey is not a safe basis for a
  reference solution.

Additionally, the initial 14-candidate list included several papers not investigated in
depth once 5 solid tasks were secured: 2609.00852 (MCT placement on bivariate bicycle
codes — an architecture/routing optimization paper, a poor fit for statevector/unitary
equivalence grading per its own abstract), 2608.05992 (native platform is high-dimensional
nuclear-spin qudits, not qubits — porting concerns), and 2608.28573 (QFT toolbox for
GL_2(F_q)/wreath products — group-theory-heavy; not pursued given time budget, not because
a problem was found).

### Two further attempts to add a 6th/7th `paper-specific` task (both stopped short)

After review flagged that only 2 of the 5 shipped tasks are genuinely `paper-specific`
("How new is each task?" above), two of the already-dropped candidates were revisited
specifically to see if a 6th or 7th `paper-specific` task could be added with the same
verification discipline:

- **2608.15161** (block-encoding matrix polynomials): a targeted follow-up fetch confirmed
  the angle-computation pipeline for even the smallest (d=1) instance requires implementing
  an FFT/DCT evaluation followed by a Gray-code-permuted Walsh-Hadamard transform (Eq. 30),
  and the fetch's own verdict was explicit: "deriving those angles for even d=1 requires
  code... not expanded enough in the text for manual calculation." Writing that pipeline
  from scratch, without the paper's own reference implementation to check against, risked
  producing a plausible-looking but unverifiable "reference" — the exact failure mode this
  benchmark's own discipline exists to avoid. Not added.
- **2609.08432 Model B** (the copolymer 5-term LCU, as opposed to Model A's single-monomer
  2-term LCU which WAS shipped): a second targeted fetch confirmed the diagonal term's exact
  unitary is never expressed in LCU form in the text ("the text states it uses 'value-to-
  angle conversion' but doesn't express it as an explicit unitary U_0"), and no section
  gives all 5 coefficients together for one concrete instance. Not added, for the same
  reason as Model A's sibling case above: a genuinely fuzzy specification, not merely an
  inconvenient one.

Both attempts are recorded here rather than silently abandoned — per this benchmark's own
"never hide a dropped candidate" convention (see the resource-estimation benchmark's own
PROVENANCE.md for the precedent).
