# Retrieval, re-measured — the 17% is 0%, and the PDF path was the wrong fix

**2026-08-06.** `G1-results.md` §1 recorded that 2 of 12 cited papers could not be read as
full text, and §5.3 left "a PDF retrieval path" open and unsized. Both papers are now
readable, **and one of them must not be read the obvious way.**

## What was measured

Every paper G1 attempted, run through the source-priority chain in
`evals/harness/src/majorana_evals/paper_source.py` — e-print LaTeX → ar5iv HTML → PDF
text, with the arXiv API abstract fetched every time as an independent witness:

| arXiv | source used | math verdict | chars | fields forced to `NOT_STATED` |
|---|---|---|---|---|
| `1704.05018` | latex | reliable | 114,538 | — |
| `0811.3171` | latex | reliable | 69,454 | — |
| `1411.4028` | latex | reliable | 41,981 | — |
| `1806.01838` | latex | reliable | 246,604 | — |
| `2102.01781` | latex | reliable | 58,708 | — |
| `1911.10205` | latex | reliable | 219,974 | — |
| `1907.04769` | latex | reliable | 62,426 | — |
| `1909.02611` | latex | reliable | 156,674 | — |
| `1810.09434` | latex | reliable | 29,950 | — |
| `1603.05681` | latex | reliable | 50,832 | — |
| **`2305.04908`** | **latex** | **reliable** | **68,708** | — |
| **`quant-ph/9605043`** | **pdf** | **unreliable** | 32,372 | **5, 7, 8** |

**Twelve of twelve are retrievable. Eleven of twelve are retrievable at higher fidelity
than the run used**, because LaTeX source delivers mathematics as `\sqrt{N}` rather than
as glyphs that have to survive a font map.

## The two failures, and why each was misdiagnosed

**`2305.04908` never needed a PDF.** Its arXiv e-print *is* a LaTeX tarball. The paper
that defeated ar5iv's HTML converter reads cleanly from source. It was replaced in the
G1 sample for a reason that turns out to be a property of one converter, not of the
paper.

**`quant-ph/9605043` (Grover) is where a naive PDF path does real damage.** The e-print
is 1996 FrameMaker PostScript — no `.tex`, so there is no source path — and the PDF's
fonts carry no ToUnicode CMap. What comes out depends on the extractor, and **both
outcomes are wrong in the same direction**:

- **poppler / pdfminer / PyMuPDF** produce the bound with its root deleted: the
  abstract's *"in only O(√N) steps"* extracts as **"O ( N )"** — a legible, confident,
  false claim that Grover's algorithm has no quantum speedup.
- **pypdf** deletes the mathematics outright and closes the prose over the hole:
  *"with a probability of , any classical algorithm … will need to look at a minimum of
  names."* No radical, and **no complexity token left to notice.**

Either way the failure lands on field 7 (complexity) — one of the four load-bearing
fields the gate's criterion 1 is computed over — and converts a `CORRECT-REFUSAL` into a
`MISSED` that reads as sourced.

## What the guard does about it

The document is compared against an independent witness — the arXiv API abstract for the
same id — before any of it reaches an extraction prompt. Two detectors, because the two
extractors fail differently:

1. **The root was lost.** The abstract carries a radical, the text carries none, and the
   text still carries complexity-shaped tokens. The bound survived; its root did not.
2. **The mathematics was dropped.** The abstract states mathematics — a radical or a
   complexity marker — that appears **nowhere** in the extracted text. This is the one
   that catches the real paper, and it is why the guard cannot key on the presence of a
   complexity token: there is no token.

Either fires → the document is `MATH_UNRELIABLE` and fields **5 (register signature),
7 (complexity), 8 (qubit count)** are forced to `NOT_STATED`.

The verdict is **three-valued, and the middle value is reachable**: when the abstract
cannot be fetched the document is `unchecked`, which refuses exactly as `unreliable`
does. "This paper has no mathematics" and "the mathematics was deleted" are the same
document without a witness, so a missing witness is not a clean bill of health.

**LaTeX source is exempt** — a radical there is markup, not a glyph, and there is no font
to lose it to.

## One retrieval bug found while measuring, worth recording on its own

**ar5iv answers an id it has no HTML for with a 307 to the arXiv *abstract page*.** Follow
it and you get a 200 full of prose that is not the paper. An extraction over that page
produces eight `NOT_STATED` answers that look like *the paper* being silent when they are
*the retrieval* being silent — inflating `CORRECT-REFUSAL`, the one verdict that counts
as correct, and biasing the gate toward passing. `G1-results.md` §1 caught this by hand
in session 81 and declined to run the paper; the chain now declines to follow the
redirect, so it cannot be caught by hand twice.

## What this changes

- **`G1-results.md` §5.3 is closed.** The unsized "PDF retrieval path" is built and
  measured. The retrieval risk on *"papers populate the repository"* is not 17% of papers
  unreadable; it is **one paper in twelve whose mathematics cannot be recovered by
  machine, and which now says so.**
- **It does not re-run G1.** The ten graded records were extracted from ar5iv HTML and
  the sheet grades those records. Re-extracting from LaTeX would produce different
  records and a different gate; the bar is pre-registered against what was run.
  Worth doing **after** the 24 marks land, as a separate measurement of whether source
  fidelity moves extraction quality — which would be a genuinely interesting number and
  is not one this gate asked for.
- **The math-unreliable path is now the honest answer for the PostScript era**, which is
  most of the corpus's foundational citations. Those papers are not unreachable. They
  arrive with their complexity, register and qubit-count fields refused, and the refusal
  is a measurement rather than a failure to try.
