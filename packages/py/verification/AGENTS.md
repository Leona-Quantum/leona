# AGENTS.md — majorana-verification

The verify stage's toolbox (Phase 2 step 4). Catches fabricated results.

- **Statevector engine is pure numpy over the IR** — no quantum SDK. Ported from the
  quepo `qhte.verification` engine. `reset` is non-unitary and rejected by the engine.
- **Every primitive maps to the contracts VerificationMethod/VerificationResultKind**
  and returns a `VerificationOutcome`. A check that cannot run returns FAIL with the
  reason — never a silent PASS (05-security.md "No invented results").
- Tolerances that touch product promises are named: exact-diag defaults to chemical
  accuracy 1.6e-3 Ha (JC-4); statistical uses shots=4096/seed=1234 (JC-6).
