# G1 — owner review, 2026-08-06, and the 24 marks that still decide it

**This is not the grading sheet and G1 is not decided here.** Protocol and bar:
[`G1-preregistration.md`](G1-preregistration.md) (committed as `a80859bb` before the
first paper was fetched). Run log: [`G1-results.md`](G1-results.md). Full sheet:
[`G1-grading-sheet.md`](G1-grading-sheet.md).

## What the owner said

Session-82 inbox, verbatim:

> **"G1: graded, and everything in first pass is pretty much correct."**

Read against the extraction, this is a real and useful signal: the ten records are not
grossly wrong, and the failure mode where a model returns confident nonsense for every
field is ruled out. **It is not the measurement §4 of the pre-registration asks for**,
and the difference is not pedantry — it is the difference between "the model is roughly
right" and "the model may be trusted unreviewed", which are the two things G1 exists to
separate.

**No verdict has been written into the sheet.** Verified 2026-08-06 against `2a8241cc`
with a clean worktree: 120 field rows, **0 verdict cells filled**, tally blank apart from
the structural-validity row that was pre-passed mechanically.

## What one global statement can and cannot settle

The bar is four criteria, computed **on stratum B only** (72 fields), and any one failing
means G1 does not pass (`G1-preregistration.md` §4).

| criterion | settled by "pretty much correct"? |
|---|---|
| **1** — load-bearing fields 3, 7, 8, 9 ≥ 22 of 24 in stratum B | **No.** It needs a per-field-index *and* per-stratum split. A global rate would have to be ≥ 98.3% before it guaranteed that ≤ 2 of the misses land in those 24 specific cells. |
| **2** — all stratum-B fields ≥ 54 of 72 | **No, not formally.** Stratum A's 48 fields can absorb every correct mark, so a global count *X* over 120 guarantees B ≥ 54 only when *X* ≥ 102 (85%). "Pretty much" pins no *X*. |
| **3** — fabrication ≤ 2 of 72, and **zero** among fields 3, 7, 8, 9 | **No — and this is the one it can say least about.** `FABRICATED` is a judgement about whether the locator quote *supports* the claim, not a correctness rate. A global statement carries no information about how the incorrect residue splits across INCOMPLETE / WRONG / FABRICATED / MISSED, and **one fabrication among the load-bearing 24 fails the gate at any accuracy**. |
| **4** — structural validity 10 of 10 | Already passed, mechanically, before anyone looked (`G1-results.md` §2). |
| §5 A-vs-B reading | **No.** That table needs two independent verdicts. One global statement is one cell, and it cannot separate *"A passes / B passes = extraction works"* from *"A passes / B fails = the model recalls but does not read"* — which is the outcome the whole stratification exists to catch. |

**The sharpest specific, and the reason this file exists rather than a shrug.** Five of
the 24 load-bearing stratum-B fields came back `NOT_STATED` — B1′ field 7, B5 fields 7, 8
and 9, B6 field 7. Criterion 1 tolerates **two** non-correct marks. So if three of those
five refusals are `MISSED` rather than `CORRECT-REFUSAL`, **criterion 1 fails on its own,
with every answered field correct.** `G1-results.md` §3 says the two are indistinguishable
without reading the paper. A statement about how correct the answers are cannot touch the
question of whether the *refusals* were right, and the refusals are where this gate is
currently decided.

## The remaining ask is 24 marks, not 120

The bar is stratum-B-only, and criteria 1 and 3 both key on fields 3, 7, 8 and 9. **Those
24 cells decide the gate.** Grading them is roughly an hour with the six papers open, not
the half-day the full sheet was sized at. Fields 5 and 8 are also where the model
disagreed with *itself* (`G1-results.md` §4, 75% mean self-agreement), so these marks are
the highest-information ones in the sheet by a distance.

Mark one of: `CORRECT` · `INCOMPLETE` · `WRONG` · `FABRICATED` · `CORRECT-REFUSAL` · `MISSED`.
A refusal that the paper genuinely does not answer is **correct**. Judge against the paper,
not against what Leona's corpus says about it. Definitions: `G1-grading-sheet.md`.

### The five that decide it — grade these first

| # | paper | field | model said | verdict |
|---|---|---|---|---|
| B1′-7 | `2102.01781` Optimization of the VQE for Quantum Chemistry | complexity claim | `NOT_STATED` | only mention of complexity is "The number of considered orbitals determines the complexity of the problem and with that the number of required qubits. In many practical cases only a select few low energy orbitals are considered while all higher energy atomic orbitals are ignored." naturally this algorithm's complexity is dependent on exact implementations, so other papers may be needed to find any claims on this, even generally. |
| B5-7 | `1810.09434` Subspace-search VQE | complexity claim | `NOT_STATED` | |
| B5-8 | `1810.09434` Subspace-search VQE | qubit count | `NOT_STATED` *(the second run answered "works on an n-qubit quantum computer", §II.1)* | |
| B5-9 | `1810.09434` Subspace-search VQE | error / precision | `NOT_STATED` | |
| B6-7 | `1603.05681` Quantum subspace expansion | complexity claim | `NOT_STATED` | |

**Three or more `MISSED` here and G1 fails criterion 1 regardless of everything else.**

### The other nineteen

| # | paper | field | model's answer | locator | verdict |
|---|---|---|---|---|---|
| B1′-3 | `2102.01781` | input assumptions | "Born-Oppenheimer approximation applied; Hartree-Fock method reformulates Hamiltonian; select few low energy orbitals considered." | §II | |
| B1′-8 | `2102.01781` | qubit count | "Symmetry group commuting with m-qubit Hamiltonian requires at most m generators; taper off qubits based on particle and spin number." | §IV | |
| B1′-9 | `2102.01781` | error / precision | "Each qubit manipulation has non-negligible probability of error; important to minimize number of necessary manipulations." | §III | |
| B2-3 | `1911.10205` Qubit-ADAPT-VQE | input assumptions | "Time-reversal symmetry is preserved; pool operators restricted to odd Pauli strings; ansatz remains real throughout" | §III | |
| B2-7 | `1911.10205` | complexity claim | "minimal pool size that achieves completeness scales linearly with the number of qubits: minimal complete pools contain only 2n−2 operators" | §III.2 | |
| B2-8 | `1911.10205` | qubit count | "2n−2 operators sufficient; minimal complete pools proven to exist for any n" — **note this answers with a pool size, not a qubit count**; run 2 gave "8 spin-orbitals for H₄, 12 for LiH, 12 for H₆" | §III.2 | |
| B2-9 | `1911.10205` | error / precision | "Threshold ϵ; ansatz keeps growing until norm of gradient vector smaller than chosen threshold ϵ" | §II | |
| B3-3 | `1907.04769` CVaR | input assumptions | Problem Hamiltonian H is diagonal; objective values H_{j,j} are "classically easy" to compute from measurement outcomes | §2 | |
| B3-7 | `1907.04769` | complexity claim | VQE depth "O(np)" with "n(1+p) parametrized Y-rotations"; QAOA needs "O(n²p) single-qubit rotations and O(n²p) CNOT-gates" | §2 | |
| B3-8 | `1907.04769` | qubit count | not stated as a general claim; experiments use "6,8,10,12,14,16 qubits", hardware uses "6 qubits" — **grade the qualification, not just the number** | §2; §6 | |
| B3-9 | `1907.04769` | error / precision | Confidence level α∈(0,1] controls "expected value of the lower α-tail of the distribution" | §4 | |
| B4-3 | `1909.02611` quantum kernel | input assumptions | "all inputs x_m and x̃ have unit length" | Results — Quantum kernel | |
| B4-7 | `1909.02611` | complexity claim | "requires only a constant number of repetitions regardless of the number of data" | Abstract | |
| B4-8 | `1909.02611` | qubit count | "n(M+2)⌈log₂(N)⌉+2⌈log₂(M)⌉+M+1 qubits needed" | Supp. Note II | |
| B4-9 | `1909.02611` | error / precision | "Pauli error on ancilla or label qubit becomes (1−2p)⟨σ_z^{(a)}σ_z^{(l)}⟩ where p is error rate" | Results — Connection | |
| B5-3 | `1810.09434` | input assumptions | "choose input states {\|φⱼ⟩} which are mutually orthogonal (⟨φᵢ\|φⱼ⟩=δᵢⱼ)" | §II.1 | |
| B6-3 | `1603.05681` | input assumptions | "the state that is produced becomes a function of the discrete set of input parameters" | §I.2 | |
| B6-8 | `1603.05681` | qubit count | "4-qubit quantum state representing H2" | main text | |
| B6-9 | `1603.05681` | error / precision | "Tp/T1=0.05" characterises decoherence; determines channel noise strength | §I.5 | |

**Fabrication is the one to watch while marking.** A wrong number *with* a real supporting
quote is `WRONG`. A wrong number with no locator, or with a quote that does not say it, is
`FABRICATED` — and zero of those are allowed in this table. B2-8 is the live candidate: it
answers a qubit-count field with a pool size, and the quote genuinely says what it says.
Whether that is `WRONG` (right quote, wrong field) or `FABRICATED` (the quote does not
support a qubit count at all) is a judgement only the grader makes, and it alone can fail
criterion 3.

## What happens on each outcome — pre-committed, not negotiated here

From `G1-preregistration.md` §4:

- **All four criteria pass** → R3 is a model-assisted build, with the locator requirement
  carried into production: no extracted field ships without one.
- **Fabrication (3) fails alone** → the model may extract but may never be trusted
  unreviewed; R3 becomes model-drafts-human-approves, sized nearer two weeks.
- **1 or 2 fails** → workflow authoring is a human task, R3 is a two-quarter programme,
  and everything above R3 is re-planned before anything is built.

## R3 is not blocked while this sits, and that is deliberate

**R3 proceeds now as model-drafts-human-approves with the locator requirement** — the
middle outcome above. Two independent reasons, and neither is a workaround:

1. The owner's coverage doctrine (roadmap §0.4/§3.6, recorded 2026-08-06) already
   specifies exactly that workflow: the agent drafts, every claim carries a source, gaps
   stay declared rather than filled with plausible text, and a human signs off. There is no
   version of the owner's stated product in which unreviewed model extraction ships.
2. The evidence to date cannot rule out a fabrication in the load-bearing 24, and the
   pre-registered consequence of that specific failure *is* model-drafts-human-approves.

So the 24 marks decide **whether review can ever be dropped**, and how R3 is sized above
its first three workflows — not whether R3 starts. What they must not be allowed to do is
be skipped and then quietly assumed to have passed: the gate stays open in
`G1-results.md` §5 until this table is filled.

## Two things that stay open whatever these 24 marks say

- **The model does not reliably agree with itself.** 75% mean field agreement over four
  papers re-run, worst 58%, concentrated in *register signature* and *qubit count* — the
  two fields carrying the block schema's type system (`G1-results.md` §4). Excluded from
  the bar by pre-registration and it stays excluded, but it is the strongest signal the run
  produced and it points at the ontology, not the model. It bounds **G2** from below.
- **G2 has not started.** One model twice is not two people once, and the owner's stated
  requirement — *"two people should be able decompose the same paper the same way in most
  cases"* — is measured by G2 alone.
