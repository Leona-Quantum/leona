# ADR-0002: Python owns the backend (FastAPI control plane)

**Date:** 2026-07-09 · **Status:** accepted
**Context:** The quantum stack (qiskit/pennylane/cirq), verification primitives, and
classical baselines are Python; the salvaged quepo logic is Python. Splitting business
logic between a TS API layer and Python compute created contract drift in the old repos.
**Decision:** A single FastAPI control plane owns all business logic, the LLM pipeline,
verification, and is the only caller of Postgres. Next.js API routes hold no business
logic — session/BFF glue only.
**Consequences:** One language for pipeline + verification kills a class of contract
drift; direct reuse of salvaged Python. Costs: TS↔Py type safety must come from generated
contracts (ADR-0008). Reversal trigger: none foreseen — this is load-bearing; revisit only
with a full re-architecture.
