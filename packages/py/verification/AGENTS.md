# AGENTS.md — majorana-verification

The verify stage's toolbox (Phase 2 step 4). Catches fabricated results.

- **Selected-framework code is the execution boundary.** Statistical verification
  re-executes that exact code; problem-specific checks use independent classical methods.
  OpenQASM parsing remains available only to validate explicit conversion operations.
- **Every primitive maps to the contracts VerificationMethod/VerificationResultKind**
  and returns a `VerificationOutcome`. A check that cannot run returns FAIL with the
  reason — never a silent PASS (05-security.md "No invented results").
- Tolerances that touch product promises are named: exact-diag defaults to chemical
  accuracy 1.6e-3 Ha (JC-4); statistical uses shots=4096/seed=1234 (JC-6).
