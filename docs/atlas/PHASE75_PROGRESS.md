# Atlas VQE Phase 7.5 progress

Date: 2026-07-27 JST  
Branch: `feature/vqe`  
Authority: ADR-0033

## Outcome

The public VQE surface is now component-first. Papers and repositories remain
available only as provenance/evidence; the primary VQE navigation no longer
contains Papers, Repositories, or Comparisons tabs.

## Completed locally

| Slice | Result |
|---|---|
| S0 | Definition / Implementation / Configuration / Compatibility / Workflow identities fixed |
| S1 | 29 canonical components in nine UI groups |
| S2 | 28 runtime-qualified H₂ provider bindings across Qiskit and PennyLane |
| S3 | Component catalog, Current Workflow tray, compatibility and responsive UI |
| S4 | Seven templates; one executable and six explicitly structured |
| S5 | Three exactly-one-role controlled comparisons |

## Safety boundary

An executable Workflow has both:

1. qualified implementation bindings for every selected component; and
2. an explicit Registry semantic identity.

Studio never receives the catalog-local template key as though it were a
Registry UUID. It resolves
`h2.sto3g.actual_vqe.workflow.v0_2` through the authenticated Registry API,
fails closed on an unknown or ambiguous request, and only then creates an
experiment.

## Verification

```text
Python: 1188 passed, 85 skipped
Web: 101 passed
TypeScript: passed
Ruff: passed
Catalog generation --check: passed
Next production compilation: passed
Alembic: single head 0038
Browser: desktop and 390 × 844 responsive checks passed
```

The live Neon/Registry/WorkOS execution proof remains an explicit environment
gate and is not represented as completed by these local results.
