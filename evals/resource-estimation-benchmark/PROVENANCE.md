# Provenance — how every case was verified, and what was dropped

Every candidate paper was fetched and read at the source (arXiv abstract page for
title/author verification, plus the full PDF and/or HTML rendering for the actual numbers) —
never taken from a search snippet or summary. Each case below got a SEPARATE adversarial
re-read after drafting, specifically checking: is the number exactly as printed, are the units
right (physical vs. logical qubits; T vs. Toffoli; hours vs. days), and are all the
assumptions that determine it carried into the prompt.

## Kept (9 cases)

| Case | Source | Location | Quantities graded |
|---|---|---|---|
| `gidney-ekera-2019-rsa2048` | Gidney & Ekerå, arXiv:1905.09749 | Table 2 ("(ours) 2019 (parallel)" row, p.3), Table 3 (n=2048, p.16) | physical_qubits, runtime_value |
| `gidney-2025-rsa2048` | Gidney, arXiv:2505.15917 | Table 5 + Sec.3 worked calc, n=2048 row | toffoli_count, physical_qubits, runtime_value |
| `kivlichan-2020-hubbard-8x8` | Kivlichan et al., arXiv:1902.10673 | Table 1, row "8x8, Anc=4", Sec.3.3 p.13 | logical_qubits, toffoli_count, t_count, physical_qubits, runtime_value |
| `babbush-2018-hubbard-8x8` | Babbush et al., arXiv:1805.03662 | Table IV p.27, Table IX p.34, row 8x8 | logical_qubits, t_count, physical_qubits, runtime_value |
| `babbush-2018-jellium-n128` | Babbush et al., arXiv:1805.03662 | Table III p.23, Table IX p.34, row N=128 | logical_qubits, t_count, physical_qubits, runtime_value |
| `lee-2021-femoco-thc` | Lee et al., arXiv:2011.03494 | Table 4 p.24, Sec.IV.3 pp.28,31 (Reiher active space) | logical_qubits, toffoli_count, physical_qubits, runtime_value |
| `reiher-2017-femoco-trotter` | Reiher et al., arXiv:1605.03590 | Table 1 & 2, Structure 1 / 0.1mHa / Serial | logical_qubits, t_count, physical_qubits, runtime_value |
| `beverland-2022-chemistry-complex18` | Beverland et al., arXiv:2211.07629 | Table I p.12, Table II p.13, Table IV p.19 | logical_qubits, t_count, physical_qubits, runtime_value |
| `beverland-2022-factoring-majorana` | Beverland et al., arXiv:2211.07629 | Table I p.12, Table II p.13, Table III/IV pp.14,19 | logical_qubits, t_count, physical_qubits, runtime_value |

Every case's own `assumptions` list and `tolerance_rationale` carries the full per-quantity
provenance and precision justification; this file records the CURATION decisions that don't
fit in one case's YAML — what was excluded and why, and paper-wide inconsistencies found on
adversarial re-read.

### Notable transcription traps found and handled (not hidden)

- **Gidney & Ekerå 2019**: no table anywhere prints a single, unambiguous Toffoli/T-count or
  logical-qubit count for the exact "20M qubits / 8h" headline row. Table 1 gives a
  differently-defined "Toffoli+T/2" composite metric (2.7 billion); a separate in-text
  illustrative example gives ~3 billion Toffolis but the authors themselves flag it as using a
  DIFFERENT code distance that doesn't match the precise figures. **Handled by dropping those
  two quantities from this case** rather than picking one and presenting it as "the" number —
  physical_qubits and runtime_value ARE printed as single numbers for this row and are graded.
- **Gidney 2025**: three non-reconciled logical-qubit figures for the same row (1,399 / 1,409 /
  1,537). **Handled by dropping logical_qubits from this case.**
- **Lee et al. 2021**: the paper states TWO different Toffoli figures (5.3e9 in Table 4;
  6.7e9 computed from the layout's own inner-loop count and used later in the same section)
  and TWO different runtimes ("3 days" then "3.5 days" for the textually same configuration).
  **Handled by using the internally-consistent pair (the layout-derived 6.7e9 Toffoli count,
  which is what the graded physical-qubit figure is actually built from; the larger 3.5-day
  runtime) and widening the tolerance band to also accept the paper's other reading**, stated
  explicitly in `tolerance_rationale` rather than silently discarding one figure.
- **Kivlichan et al. 2020**: the paper's title is "...via Trotterization" — the candidate list
  handed to this build dropped that clause; corrected here. The paper reports up to 48
  distinct (Toffoli, T, qubits, time) tuples for Hubbard alone (3 lattice sizes × 2 ancilla
  schemes × 2 precision targets × 2 error rates); no sentence anoints one "the" headline.
  **Handled by pinning all four axes explicitly in the prompt** (8x8 lattice, Anc=4 scheme,
  relative-precision target, p=1e-3) rather than presenting the paper as if it had one answer.
- **Reiher et al. 2017** and **Babbush et al. 2018**: both report a small grid of
  (structure/system × precision/target × variant) cells rather than one headline number.
  **Handled the same way as Kivlichan**: the prompt states which specific cell is being asked
  about.

## Dropped (2 candidates from the owner's list, plus 1 substitution)

| Candidate | arXiv | Reason dropped |
|---|---|---|
| Litinski 2019, "A Game of Surface Codes" | 1808.02892 | **No RSA-2048 example exists in this paper** — a full-text search for "RSA" and "2048" returns zero hits; the recollection that prompted its inclusion was likely conflating it with Gidney & Ekerå 2019. Its own generic worked example (100 qubits, T-count 1e8) is explicitly a multi-point Pareto space-time trade-off curve (three-plus points along two different error-rate curves), not a single determinate configuration a prompt could pin without importing an external circuit's T-count via this paper's OWN cost formulas — which would make the reference value something WE derived, not something the paper states, undermining the "every reference answer traces to a paper" requirement. |
| von Burg et al. 2021, "Quantum computing enhanced computational catalysis" | 2007.14460 | Not a single self-contained determinate task: 8 catalytic-cycle structures × 2 qubit/Toffoli trade-off points, and THREE mutually irreconcilable runtime figures (28 hours at an assumed 10μs/Toffoli; "several years" at 10ms/Toffoli; "a few weeks" under a third, unstated assumption) with no physical-qubit count or code distance given anywhere in the main text (only a qualitative "millions of physical qubits"). Also note: this paper studies a ruthenium CO2-to-methanol catalyst, NOT cytochrome P450 or FeMoco as the initial candidate list assumed — FeMoco appears only as a secondary comparison table, borrowed from Reiher et al. 2017. |

Beverland et al. 2022 supplied TWO cases (chemistry + factoring) in place of the one originally
anticipated, since both of its worked application rows (unlike von Burg's) are fully
self-contained with every assumption stated in one place — this kept the corpus at 9 solid
cases without stretching any single paper's ambiguous table into a case it can't cleanly
support.

## Second-tool cross-check: tool and version

**Microsoft QDK Python package**, `qdk` v1.32.3 (installed 2026-09-21 in a throwaway venv,
`pip install qdk` — NOT added as a runtime dependency; see `evals/harness/pyproject.toml`'s
`resource-estimation-crosscheck` optional extra for reproducing this). The deprecated
`qsharp` package (v1.31.0, which wraps `qdk`) was tried first; `qdk.estimator.LogicalCounts`
was used directly instead, per the deprecation notice.

Method: `LogicalCounts({"numQubits": ..., "cczCount": ... | "tCount": ..., ...}).estimate({
"errorBudget": 0.01, "qubitParams": {"name": "qubit_gate_ns_e3"|"qubit_gate_ns_e4"|
"qubit_maj_ns_e4"}, "qecScheme": {"name": "surface_code"|"floquet_code"}})` — feeding each
case's OWN logical qubit count and gate count (Toffoli as `cczCount`, T-gates as `tCount`,
never both, never converted between them) and physical error rate through the tool's generic
cost model. Every call completed in well under 1 second (measured; no CPU concern, nothing run
on the cluster). Exact inputs, command, and result are recorded per case in each YAML's
`cross_check` field; the summary of agreement/disagreement per case:

| Case | Cross-check vs. paper | Verdict |
|---|---|---|
| `gidney-ekera-2019-rsa2048` | 21.9M phys vs. 20M paper (approximate input only — no clean gate count exists for this row, see above); 1 day vs. 0.31 days | Rough corroboration only, given the approximate input |
| `gidney-2025-rsa2048` | 6.41M phys vs. 898K paper (~7x); 3 days vs. 4.96 days (~1.6x) | Physical-qubit gap understood: generic estimator has no model of this paper's yoked codes / magic state cultivation |
| `kivlichan-2020-hubbard-8x8` | 521K phys vs. 320K paper (~1.6x); 6 sec vs. 2,160 sec (~360x) | Runtime gap understood: paper deliberately uses a 100x-more-conservative decoder latency than a naive model |
| `babbush-2018-hubbard-8x8` | 880K phys vs. 2.4M paper (~2.7x fewer); 44 min vs. 15 hr (~20x less) | Understood: 2018-era per-gate clocking assumption, not factory-throughput-limited |
| `babbush-2018-jellium-n128` | 955K phys vs. 2.9M paper (~3x fewer); 29 min vs. 10 hr (~20x less) | Same cause as the sibling Hubbard case, same paper |
| `lee-2021-femoco-thc` | 8.47M phys vs. ~4M paper (~2.1x more); 2.7 days vs. 3-3.5 days (close) | Runtime corroborates; physical-qubit gap is the OPPOSITE direction from Gidney 2025 — Lee et al.'s bespoke floorplanning is MORE qubit-efficient than the generic model here |
| `reiher-2017-femoco-trotter` | 1.84M phys vs. 1.8e8 paper (~100x fewer); 516 years vs. 130 days (~1,450x more) | Large, understood disagreement: this 2017 paper's flat "1 T-gate/10ns" clock is not throughput-limited by a real magic-state factory, a point later literature makes explicitly |
| `beverland-2022-chemistry-complex18` | 3.46M phys vs. 1.9M paper (~1.8x); 43 days vs. ~30 days (~1.4x) | Best agreement in the corpus — Beverland et al.'s own architecture uses a generic surface code, closest in spirit to the tool's default model |
| `beverland-2022-factoring-majorana` | 66.7M phys vs. 26M paper (~2.6x, using `floquet_code`, the closest built-in proxy for the paper's Hastings-Haah code); 21 hr vs. 15 hr (~1.4x) | Reasonable order-of-magnitude corroboration; no tool tested implements Hastings-Haah exactly |

**Disagreement was recorded, not hidden or explained away as tool error.** In every case the
REFERENCE value used for grading is the source paper's own number — the cross-check is
supporting evidence about plausibility and a documented account of WHY a generic tool does or
doesn't reproduce a specific paper's bespoke choices, never a substitute ground truth.
