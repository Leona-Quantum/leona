# G1 — run log and mechanical results

**Run 2026-08-05 (session 81).** Protocol and bar: [`G1-preregistration.md`](G1-preregistration.md),
committed as `a80859bb` **before the first paper was fetched**.

> **This file contains no correctness verdicts, and G1 is NOT decided here.**
> Everything below is mechanical — what was retrieved, what the model emitted, whether it agrees
> with itself. Correctness per field needs one domain expert; the sheet is
> [`G1-grading-sheet.md`](G1-grading-sheet.md).
>
> **Status 2026-08-06 (session 85): three of the four criteria are settled and all three passed.**
> The owner graded the 24 load-bearing stratum-B cells, cell by cell with comments. **Criterion 1
> passed 24 of 24** against a bar of 22, and **criterion 3's load-bearing half passed with zero
> fabrications** — including on B2-8, the cell the sheet itself flagged as the live candidate.
> Criterion 4 was already mechanical. **Criterion 2 is the only one left**, it is arithmetically
> undecidable from these 24 marks alone, and it needs ≥ 30 of the 48 remaining stratum-B cells —
> laid out in [`G1-owner-review-round2.md`](G1-owner-review-round2.md). Details in §5 below.

---

## 1. Retrieval — and two papers the corpus cites that could not be read

Full text was taken from ar5iv HTML (`ar5iv.labs.arxiv.org/html/<id>`), identical treatment for
every paper, so the stratum A/B comparison is not confounded by source quality.

**Two of the twelve papers attempted could not be retrieved as full text**, and under the
pre-registered replacement rule (§2) both were replaced and the failure reported rather than worked
around:

| attempted | stratum | failure | replaced by |
|---|---|---|---|
| `2305.04908` — Tight Bounds for Quantum Phase Estimation | B | ar5iv returned *"Conversion to HTML had a Fatal error and exited abruptly"* — no paper body | `2102.01781` |
| `quant-ph/9605043` — Grover, database search | A | no ar5iv HTML; 307 redirect back to the arXiv abstract page | `1704.05018` |

**This is a finding, not an inconvenience.** The roadmap's *"papers populate the repository"* line
(§0.3) assumes cited papers can be read by machine. On this sample **17% could not be**, and the two
failures are not random: pre-2007 `quant-ph/…` identifiers have no ar5iv HTML at all, and recent
LaTeX can defeat the converter. Any production pipeline needs a PDF path, and the cost of that path
is not in any estimate on the roadmap.

**`2305.04908` was deliberately NOT run on its abstract alone.** It would have produced eight
`NOT_STATED` answers that look like the *paper* being silent when they are the *retrieval* being
silent — which would have inflated CORRECT-REFUSAL, the one category that counts as correct. Mixing
those two silences would have quietly biased the gate toward passing.

### The ten papers as run

| # | stratum | arXiv | paper | corpus entry |
|---|---|---|---|---|
| A1′ | A (control) | `1704.05018` | Hardware-efficient VQE for small molecules | `vqe-hardware-efficient-ansatz` |
| A2 | A | `0811.3171` | Quantum algorithm for linear systems (HHL) | `hhl-linear-systems` |
| A3 | A | `1411.4028` | A Quantum Approximate Optimization Algorithm | `qaoa-maxcut-ring` |
| A4 | A | `1806.01838` | Quantum singular value transformation | `quantum-singular-value-transformation` |
| B1′ | B (gate) | `2102.01781` | Optimization of the VQE for Quantum Chemistry | `vqe-ground-state-energy` |
| B2 | B | `1911.10205` | Qubit-ADAPT-VQE | `vqe-qubit-adapt` |
| B3 | B | `1907.04769` | Improving Variational Quantum Optimization using CVaR | `vqe-cvar` |
| B4 | B | `1909.02611` | Quantum classifier with tailored quantum kernel | `quantum-kernel-svm` |
| B5 | B | `1810.09434` | Subspace-search VQE for excited states | `vqe-ssvqe` |
| B6 | B | `1603.05681` | Quantum subspace expansion | `vqe-quantum-subspace-expansion` |

---

## 2. Structural validity — criterion 4 of the bar

**10 of 10 pass.** Every paper produced all twelve fields; every field carried either a
section locator plus a verbatim quote, or the exact token `NOT_STATED`. No field returned a value
together with a refusal, and none returned prose where a locator was required.

This is the one criterion an agent can settle, and it is settled: **the schema is emittable.**

## 3. Refusal rate — mechanical, not a verdict

`NOT_STATED` was returned for **14 of 120 fields (11.7%)**.

| stratum | refusals | rate |
|---|---|---|
| A (control) | 4 / 48 | 8.3% |
| B (gate) | 10 / 72 | 13.9% |

Concentrated in fields 5 (register signature), 7 (complexity), 8 (qubit count) and 11 (shots).
**Whether each refusal is a CORRECT-REFUSAL or a MISS is exactly what the expert decides** — the two
are indistinguishable without reading the paper, which is why the bar counts them separately.

One observation offered without a verdict, because it bears on the fabrication cap: when handed the
*corrupted* `2305.04908` page, the model returned `NOT_STATED` for all twelve fields rather than
inventing content for a paper whose title it could see. That is one data point, on one adversarial
input, in the direction the cap cares about. It is not evidence about the ten graded papers.

---

## 4. Self-consistency — measured, and NOT part of the bar

Four papers re-extracted independently, identical prompt, two per stratum — the pre-registered
minimum (§7). Agreement is scored per field: the same substantive claim *and* the same
answered/refused status.

| paper | stratum | fields agreeing | rate |
|---|---|---|---|
| A2 — HHL | A | 12 / 12 | **100%** |
| A3 — QAOA | A | 7 / 12 | **58%** |
| B2 — qubit-ADAPT-VQE | B | 7 / 12 | **58%** |
| B5 — SSVQE | B | 10 / 12 | **83%** |
| **mean** | | **36 / 48** | **75%** |

**Where it disagrees is worse than how often.** The disagreements cluster in the load-bearing
fields the bar names:

- **Field 8 (qubit count) flipped between a value and `NOT_STATED` on three of the four.** On B5 one
  run said `NOT_STATED` and the other quoted *"works on an n-qubit quantum computer"*. On A3 one run
  quoted a subgraph qubit bound and the other refused.
- **Field 5 (register signature) flipped on B2 and A3** — answered in one run, refused in the other.
- **Field 1 (problem) differed on B2 in substance, not wording**: one run said finding the molecular
  ground state, the other said building compact ansätze. Both are defensible readings of that paper,
  which is precisely the ambiguity G2 is about.
- **A2 (HHL) reproduced all twelve fields exactly** — the most canonical paper in the sample, and
  the one where recall is most likely to be doing the work.

### What this does and does not say

It is **one model twice, not two people once. It is not G2 and must not be reported as G2.**

It bounds G2 from below. The owner's requirement — *"two people should be able decompose the same
paper the same way in most cases"* — is measured here against the easiest possible case: same
reader, same prompt, same text, minutes apart. That case came in at **75%**, and at **58% on two of
four papers**. Two different people, with different training, on a paper neither wrote, will not do
better than one model agreeing with itself.

**This is the strongest signal the session produced, and it points at the ontology rather than at
the model.** Fields 5 and 8 are where it fails, and those are exactly the fields §3.1 of the roadmap
says carry the type system — the `RegisterPort` signature that makes a mapping block a mapping
block. A field that a careful reader answers one way and refuses the next is not a field with a
hard boundary yet.

It is excluded from the bar by pre-registration, and it stays excluded: a model can be perfectly
self-consistent and consistently wrong. It is reported because it is decision-relevant on its own.

---

## 5. The owner's marks, and what is still open — session 85, 2026-08-06

### 5.1 Three criteria settled, all three passed

The owner graded the 24 load-bearing stratum-B cells (fields 3, 7, 8, 9 × six B papers), with a
written comment on each of the five refusals. Transcribed into
[`G1-grading-sheet.md`](G1-grading-sheet.md) with per-row assertions, and into
[`G1-owner-review-2026-08-06.md`](G1-owner-review-2026-08-06.md) verbatim.

| criterion | threshold | result | |
|---|---|---|---|
| **1** — load-bearing correct | ≥ 22 of 24 | **24 of 24** | ✅ |
| **3** — zero fabrications among load-bearing | 0 of 24 | **0** | ✅ |
| **4** — structural validity | 10 of 10 | 10 of 10 | ✅ (mechanical, §2) |
| **2** — all stratum-B fields correct | ≥ 54 of 72 | 24 graded, **48 ungraded** | ⬜ undecided |

**The refusals were the risk and they came back clean.** §3 of this file said a `CORRECT-REFUSAL`
and a `MISSED` are indistinguishable without reading the paper, and criterion 1 tolerated only two
non-correct marks against five refusals in the load-bearing set. All five were read as correct
refusals, each with the paper's actual text quoted in support — e.g. B5-7, *"no mention of
complexity at all"*; B6-7, only *"while exact diagonalization is not advantageous from a complexity
point of view"*, which is not a complexity claim for the method.

**Criterion 3 passed on the cell that could have failed it.** B2-8 answers a qubit-count field with
a pool size (*"2n−2 operators"*). The sheet flagged it in its own note column as the live
`FABRICATED` candidate — one of those fails criterion 3 outright at any accuracy — the grader saw
the flag and marked `CORRECT`.

### 5.2 The one adversarial reading, computed rather than worried about

**B5-8 is the single cell where the grader's own comment cites text pointing the other way.** The
mark is `CORRECT-REFUSAL`, and the comment supporting it also quotes the paper saying *"works on an
n-qubit quantum computer"* and *"we numerically simulate our algorithms with 4-qubit
Hamiltonians"* — the first a general statement rather than a count, the second a property of a
simulation run rather than of the method. That is a defensible refusal and it is the grader's call.
It is also the exact cell where the two independent runs disagreed (§4), which is why it gets this
paragraph.

**It does not change the outcome.** Scored `MISSED` instead, criterion 1 is **23 of 24** against a
bar of 22 and still passes; criterion 3 is untouched, because a `MISSED` is a miss and not a
fabrication (pre-registration §4 separates them for this reason). **So criterion 1 passes under
both readings**, and no further judgement on this cell is needed to decide the gate.

### 5.3 Stratum A is ungraded, and that limits the reading rather than the result

Pre-registration §5 reads A against B to separate *"extraction works"* from *"the model recalls but
does not read"*. That table needs stratum A graded, and it is not. **This does not weaken any
criterion above** — all four are computed on stratum B alone, by construction. What it costs is the
diagnosis on a failure: if criterion 2 comes in below 54, the A/B comparison is what would say
whether the cause is the model or the protocol, and it would have to be graded then. Grading A now,
before criterion 2 is known, would be 48 marks spent on a question that may never be asked.

### 5.4 What is still open

1. **Criterion 2 — 48 marks, and only 30 need to be correct.** Fields 1, 2, 4, 5, 6, 10, 11, 12
   across the six B papers, in the same one-mark-per-row form that made the first pass work:
   [`G1-owner-review-round2.md`](G1-owner-review-round2.md). **The earlier claim in
   `G1-owner-review-2026-08-06.md` that "those 24 cells decide the gate" was wrong** — it is true
   of criteria 1 and 3, and criterion 2 is computed over all 72. Corrected there and here rather
   than quietly dropped.
2. **Six papers not re-run** (A1′, A4, B1′, B3, B4, B6). Pre-registration set a minimum of 4 and a
   target of 10; 4 were done. **Reported rather than left as a smaller denominator**: the 75% is
   over 4 papers, not 10, and two of those four are the canonical stratum where agreement should be
   easiest.
3. ~~**A PDF retrieval path**, without which 17% of this sample is unreadable and the pre-2007
   `quant-ph` era — which is most of the foundational citations in the corpus — is entirely
   unreachable.~~ **Closed 2026-08-06, and the diagnosis above was wrong in both directions:
   `2305.04908` never needed a PDF (its e-print is LaTeX source), and for Grover a PDF is
   retrievable but its mathematics is not — three extractors delete the radical from
   "O(√N)". 12 of 12 now retrieve, 11 of them from LaTeX. Measurement and the guard that
   keeps the corrupted one from asserting anything: [`G1-retrieval-2026-08-06.md`](G1-retrieval-2026-08-06.md).**
