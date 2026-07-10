# AGENTS.md — majorana-baselines

Deterministic classical baselines (Phase 2 step 4). The honest yardstick a quantum
result is compared against.

- **Trusted control-plane code, not sandboxed.** The solvers are our own bounded,
  deterministic Python — the model supplies only a *structured instance*, never code.
  This is the deliberate difference from the legacy nameko version (which generated
  Python for the sandbox).
- **Caps are enforced before solving** (`check_caps`) and raise `CapError`; an oversized
  instance is rejected, never silently truncated.
- **maxcut maximizes; everything else minimizes** — `compute_quantum_gap` encodes the
  direction. A claimed value that beats the exact optimum is fabrication, not success.
