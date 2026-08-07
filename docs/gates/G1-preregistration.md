# G1 — pre-registration

**Written 2026-08-05 (session 81), BEFORE any paper was fetched or any record extracted.**
Nothing below may be edited once extraction starts. Results go in a separate file
(`G1-results.md`); the grading sheet is `G1-grading-sheet.md`. If a rule here turns out to be
unworkable, the correction is an appended dated note, never a rewrite — a bar edited after seeing
the output is not a bar.

Gate definition: [`../leona-block-repository-roadmap.md`](../leona-block-repository-roadmap.md) §8.
Block schema: same file §3.1–3.3.

> **Owner authorisation.** Session-80 inbox: *"yes a model should attempt to extract block metadata
> from a paper."* That answers whether to run G1, not whether it passes.

---

## 0. What this gate decides, and what it does not

**Decides:** whether workflow authoring is a model task or a human task — and therefore whether R3
is a two-week build or a two-quarter programme.

**Does not decide:** whether the six-role ontology is *shared* between people. That is G2, and the
owner has already stated the requirement it must meet: *"two people should be able decompose the
same paper the same way in most cases."* G1 can fail for reasons that are really G2's (see §6).

**A model cannot grade this.** Correctness per field needs one domain expert. What is produced here
is the extraction plus everything mechanical, so the expert's half-day is spent grading and nothing
else.

---

## 1. One correction to the gate as specified

The roadmap says *"take 10 papers already cited by the corpus"*. Taken literally that draws Grover,
Shor, HHL, QAOA, VQE — **the most-cited papers in quantum computing, and therefore the ones any
model has effectively memorised.** A model reciting Grover's structure from training has
demonstrated recall, not extraction. The gate would pass, R3 would be scoped as a two-week build,
and the first obscure 2024 paper anyone fed it would fail — with no way to attribute the failure,
because the passing evidence never separated the two.

**So the sample is stratified, and the gate is decided on the obscure stratum.**

| stratum | n | what it is | role |
|---|---|---|---|
| **A — canonical** | 4 | famous, certainly in training data | **control** |
| **B — obscure** | 6 | narrow, specific, low-prominence | **the gate** |

Reading A against B is the whole point. Interpretation is pre-committed in §5.

This is a deviation from the roadmap text and is deliberate. It makes the gate harder, not easier.

---

## 2. The sample — fixed now, before any fetch

All ten are cited by the live corpus (from the 78 citation URLs). Chosen before extraction, and the
selection rule is stated so it cannot be read as cherry-picking: **stratum B is every cited arXiv
paper that is (a) an algorithm/method paper with a stated problem, (b) 2019 or later or otherwise
narrow in scope, and (c) cited by exactly one corpus entry** — then the first six in descending
year. Stratum A is four algorithm papers everyone would name.

### Stratum A — canonical (control)

| # | paper | arXiv | corpus entry |
|---|---|---|---|
| A1 | A fast quantum mechanical algorithm for database search | `quant-ph/9605043` | `grover-unstructured-search` |
| A2 | Quantum algorithm for linear systems of equations | `0811.3171` | `hhl-linear-systems` |
| A3 | A Quantum Approximate Optimization Algorithm | `1411.4028` | `qaoa-maxcut-ring` |
| A4 | Quantum singular value transformation and beyond | `1806.01838` | `quantum-singular-value-transformation` |

### Stratum B — obscure (the gate)

| # | paper | arXiv | corpus entry |
|---|---|---|---|
| B1 | Tight Bounds for Quantum Phase Estimation and Related Problems | `2305.04908` | `quantum-phase-estimation` |
| B2 | Qubit-ADAPT-VQE: An Adaptive Algorithm for Constructing Hardware-Efficient Ansätze | `1911.10205` | `vqe-qubit-adapt` |
| B3 | Improving Variational Quantum Optimization using CVaR | `1907.04769` | `vqe-cvar` |
| B4 | Quantum classifier with tailored quantum kernel | `1909.02611` | `quantum-kernel-svm` |
| B5 | Subspace-search variational quantum eigensolver for excited states | `1810.09434` | `vqe-ssvqe` |
| B6 | Quantum subspace expansion method for error mitigation and excited states | `1603.05681` | `vqe-quantum-subspace-expansion` |

**Replacement rule.** If a paper's text cannot be retrieved, it is replaced by the next paper
matching the same stratum rule, the substitution is logged in `G1-results.md` with the reason, and
**the failure to retrieve is itself reported** — a corpus that cites what cannot be read is a
finding, not an inconvenience.

---

## 3. What the model is asked to emit

One **six-role block record** per paper — problem → input → input-mapping → algorithm → readout →
output (roadmap §3.1) — under these rules.

**Every field carries a `SourceRef.method`** from the schema's own vocabulary:
`measured | derived | declared | cited | modeled | guessed`.

**Every non-`guessed` field carries a `locator`**: a section number *and* a short verbatim quote
from the paper. This is the mechanism that separates reading from remembering. A claim that is true
but has no locator is *recall*, and it is scored as such — the schema already says a block carrying
any `guessed` quantity may never be presented as evidence (§3.3), so a model that cannot point at
the page has produced exactly that.

**Refusal is a first-class answer.** `status: unknown` with a reason is CORRECT when the paper does
not state the thing. It is not a miss. Inventing a plausible value where the paper is silent is the
worst outcome in this gate and is scored separately (§4, *fabrication*).

**Numbers follow §3.3**: `status` is required, `unknown` and `not_applicable` are different, and
neither may carry a value.

### The graded fields, per paper

Twelve, and they are graded **per field, not per paper** (roadmap §8):

| # | field | role |
|---|---|---|
| 1 | problem statement | problem |
| 2 | problem-domain type (`SemanticPort` in) | problem |
| 3 | input assumptions | input |
| 4 | input encoding / state preparation | input-mapping |
| 5 | register signature of the mapping (`RegisterPort` out) | input-mapping |
| 6 | core algorithmic routine | algorithm |
| 7 | query/gate complexity claim | algorithm |
| 8 | qubit-count claim | algorithm |
| 9 | error / precision parameter and its role | algorithm |
| 10 | readout procedure | readout |
| 11 | repetition / shot count | readout |
| 12 | output type (`SemanticPort` out) | output |

10 papers × 12 fields = **120 graded fields**.

---

## 4. The bar — pre-registered, and this is the number that decides it

The roadmap's example bar is *"input assumptions and complexity claims ≥90% correct"*. Made precise:

Each field is graded by the expert as exactly one of:

- **CORRECT** — matches the paper, locator supports it.
- **INCOMPLETE** — true but omits something material.
- **WRONG** — contradicts the paper.
- **FABRICATED** — states a specific claim the paper does not support (locator absent, or the quote
  does not say it). *A wrong number with a real quote is WRONG; a wrong number with no quote or an
  unrelated quote is FABRICATED.*
- **CORRECT-REFUSAL** — model said `unknown`, and the paper is genuinely silent. **Counts as
  correct.**
- **MISSED** — model said `unknown`, but the paper does state it. Counts as a miss, not a
  fabrication.

### G1 PASSES if, on **stratum B** (72 fields):

1. **Load-bearing fields ≥ 90% correct.** Fields 3, 7, 8, 9 (input assumptions, complexity, qubit
   count, error parameter) — the roadmap's own named bar. 24 fields in stratum B; **≥ 22 of 24**
   scored CORRECT or CORRECT-REFUSAL.
2. **All fields ≥ 75% correct.** ≥ 54 of 72 CORRECT or CORRECT-REFUSAL.
3. **Fabrication ≤ 2 of 72** (≤ 2.8%), and **zero** fabrications among the load-bearing fields.
   *This is the hard constraint.* A model that is right 90% of the time and invents a citation-shaped
   number the other 10% is worse than useless for a repository whose entire claim is that its
   numbers trace to a source.
4. **Structural validity 10 of 10** — every record parses against the six-role schema, every
   quantity carries a `status`, no `unknown` carries a value.

**Any one of the four failing = G1 does not pass.** No partial credit, no renegotiation after the
fact.

### Pre-committed consequence

- **PASS** → R3 is scoped as a model-assisted build (roadmap's two weeks), with the locator
  requirement carried into production: no extracted field ships without one.
- **FAIL on fabrication (3) only** → the model may extract but may never be trusted unreviewed;
  R3 becomes model-drafts-human-approves. Sizing between the two poles, nearer two weeks.
- **FAIL on 1 or 2** → workflow authoring is a human task; R3 is a two-quarter programme and the
  roadmap above R3 is re-planned before anything is built.

---

## 5. Reading stratum A against stratum B

Pre-committed, so the comparison cannot be rationalised afterwards:

| A (control) | B (gate) | reading |
|---|---|---|
| passes | passes | **Extraction works.** The strongest result available here. |
| passes | fails | **The model recalls but does not read.** G1 fails. This is the outcome the stratification exists to catch, and a literal reading of the roadmap's sample would have called it a pass. |
| fails | fails | Something is wrong with the *protocol* — schema, prompt, or paper text quality — not with the model's ability. **Re-run before concluding anything.** Do not report a gate result from this cell. |
| fails | passes | Incoherent; treat as a protocol bug and re-run. |

---

## 6. Two things this gate cannot separate, stated now

1. **A wrong decomposition vs a wrong ontology.** If the model splits a paper into blocks the expert
   would not, that may be the model's error *or* the six roles failing to fit that algorithm — the
   roadmap already flags ADAPT-VQE as not cleanly separating "ansatz" from "search", and B2 is
   ADAPT-VQE deliberately. The expert is asked to mark which of the two it is; where they say
   "ontology", it is a **G2 finding**, and it is recorded there rather than counted as a G1 miss.
2. **Paper quality.** Some papers simply do not state a qubit count. That is what CORRECT-REFUSAL is
   for, and it is why refusal counts as correct.

---

## 7. Self-consistency — measured, and NOT part of the bar

Each paper is extracted **twice**, independently, and the two runs compared field by field.
Reported as an agreement rate.

This is *not* G2 and must never be reported as G2: it is one model twice, not two people once. It is
a **necessary condition** — if a single model cannot reproduce its own decomposition, two humans
almost certainly cannot, and the owner's *"two people should be able decompose the same paper the
same way in most cases"* is already in trouble. It bounds G2 from below; it cannot pass it.

It is excluded from the bar because a model can be perfectly self-consistent and consistently wrong.

**Minimum: 4 papers re-run (2 from each stratum). Target: all 10.** If fewer than 10, the shortfall
is reported explicitly rather than left as a silently smaller denominator.

---

## 8. Who grades

**Not an agent, and not the same model that extracted.** OWNER_TODO §9 has been asking for a name
since the roadmap was written; it is still the one thing here an agent cannot do.

The grading sheet is built so the expert sees, per field: the paper, the field, the model's answer,
its `method`, and its locator quote — and marks one of the six verdicts. Nothing else is asked of
them.

**Deliberately withheld from the sheet: the corpus's own existing description of that paper.** The
grader must judge the record against the *paper*, not against what Leona already says about it —
otherwise this measures agreement with the corpus, which is not the question, and would quietly
reward the model for reproducing text it may have been trained on.

---

## Appended 2026-08-06 — three notes. Nothing above this line was edited.

The rule at the top of this file is that a correction is an appended dated note and never a
rewrite. These are appended for that reason. **The pre-run text is verifiable by hash:** the
blob at commit `a80859bb` ("add: G1 pre-registration, committed before any paper is fetched",
2026-08-05 23:06:01, twenty minutes before the run merged) is
`24897c6239c0e43a62f85ffefddafbcd92aaebcd`, and everything above this line still hashes to it.
That commit is unreachable from any local ref after the squash merge of #273, so the hash and
GitHub's record of #273 are the surviving proof of precedence — not the working tree.

**1. A value drawn from a source the paper cites is not a fabrication, provided it says so.**
The owner's 2026-08-06 direction is that gaps in a paper may be filled from the works it cites,
*"as long as everything is perfectly cited, sourced, and not hallucinated"*. As written, §4's
`FABRICATED` rule would score exactly that as the gate's hard failure, because the locator would
not name a section of *this* paper.

This changes **nothing about the ten records already extracted or the 120 marks** — every field
in this run was extracted from the paper itself, so the bar above stands unamended for the run it
was written for. For **any future extraction**, a cross-source fill is a distinct thing from
both an in-paper answer and a fabrication, and needs its own locator form: the cited work's
identifier (arXiv id or DOI) *plus* the section and quote inside it, and the record must mark the
field as sourced from a citation rather than from the paper. A cross-source fill with no named
work is `FABRICATED` exactly as before. A gap that neither the paper nor its bibliography closes
stays a declared gap — filling it with plausible text is the failure this gate is built to catch,
and the owner's phrasing is stricter than the bar here, not looser: *"those gaps should be clear,
not ignored or filled with nonsense."*

**2. §8's pointer to "OWNER_TODO §9" is stale.** The G1 grading ask moved to OWNER_TODO §2 in
session 82, and §9 is now a different item entirely (making two CI jobs required). The ask itself
is unchanged and is now narrowed to 24 marks in
[`G1-owner-review-2026-08-06.md`](G1-owner-review-2026-08-06.md).

**3. The gate-definition link at the top of this file does not resolve.**
`../leona-block-repository-roadmap.md` would be `docs/leona-block-repository-roadmap.md`, which
does not exist in this repository — the roadmap lives outside it, at
`~/Documents/Projects/Majorana/plans/leona-block-repository-roadmap.md`, §8 for the gate
definition and §3.1–3.3 for the block schema.
