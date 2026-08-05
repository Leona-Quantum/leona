# Private Component-First VQE MVP

This directory is the committed release truth for the private technical MVP.
It does not claim public execution, independent scientific review, or
scientific superiority.

## Authority flow

```text
immutable Registry records
+ committed runtime/review/deployment evidence
→ capability_manifest_v1.json
→ API/UI status surfaces and release gates
```

Generate or verify the manifest:

```bash
uv run python scripts/generate-vqe-private-mvp-manifest.py
uv run python scripts/generate-vqe-private-mvp-manifest.py --check
```

Run the deterministic gate:

```bash
pnpm atlas:vqe:mvp-gate --mode=offline
```

The operator-controlled gate requires a provisioned disposable PostgreSQL 17
database and the digest-pinned OCI runtime environment:

```bash
pnpm atlas:vqe:mvp-gate --mode=private-e2e
```

Missing private-E2E prerequisites produce `NOT_RUN — GO判定不可` and a nonzero
exit. They are never converted into a successful skip.

The primary scientific path is Fixed Excitation + SLSQP, followed by exactly
one changed role (`parameter_optimizer`) to COBYLA. UCCSD and
Hardware-Efficient RY–CX are private capability smoke journeys, not the primary
one-component comparison.

The latest local completion decision, exact test evidence, discovered defects,
and remaining operator gates are recorded in
[`phase_completion_audit_2026-08-05.md`](phase_completion_audit_2026-08-05.md).

The consolidation phase, frozen scope, acceptance table, and handoff boundary
are recorded in
[`../PHASE11_PRIVATE_COMPONENT_FIRST_MVP.md`](../PHASE11_PRIVATE_COMPONENT_FIRST_MVP.md).
