# ADR-0013: Framework-native source is the circuit authority

**Date:** 2026-07-15 · **Status:** accepted (owner-confirmed)
**Context:** The pipeline generated Qiskit, Cirq, or PennyLane source but then required
OpenQASM extraction for verification, optimization, final-execution identity, and
artifact persistence. This silently made OpenQASM the real source of truth, rejected
valid SDK-only behavior, and coupled every framework to Qiskit's importer/compiler.
**Decision:** The exact Python source in the user-selected framework is authoritative
through generation, sandbox execution, verification, native optimization, finalization,
and persistence. `packages/py/frameworks` owns adapters for source fingerprints,
execution contracts, resource inspection, and optional interchange observation.
OpenQASM is normalized only when an explicit conversion path can produce it; it is not
a verifier, compilation target, user-facing output, or save prerequisite.
**Consequences:** The returned code is the code that was executed and saved; Qiskit,
Cirq, and PennyLane share one pipeline without silent switching. Framework-specific
optimization remains visible and reproducible in source. Cross-framework conversion is
now an explicit adapter capability and may report unsupported instead of degrading the
circuit. Existing OpenQASM fields and verification enums remain readable for historical
runs. Reversal trigger: a future language-neutral IR may supplement conversion, but it
must not replace selected-framework source without a new owner-approved ADR.
