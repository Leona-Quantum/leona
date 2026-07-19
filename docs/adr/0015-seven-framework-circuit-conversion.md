# ADR-0015: Seven-framework circuit conversion is bounded and explicit

**Date:** 2026-07-18 · **Status:** accepted (owner-requested)
**Context:** The public Atlas and private Workspace exposed seven circuit
framework labels, but most records only carried one native snippet and missing
variants appeared as pending placeholders. A universal source-to-source rewrite
would be misleading: framework programs can contain host-language control flow,
custom operations, noise, result processing, and measurement semantics that do
not have lossless equivalents in every target SDK. Literature methods and
Hamiltonian/operator definitions are not ordered gate programs at all.
**Decision:** Concrete circuits use one of two explicit conversion paths. Circuits
inside Leona Quantum's ordered portable subset (`H`, `X`, `Y`, `Z`, `S`, `T`,
`RX`, `RY`, `RZ`, `CX`, `CZ`, `SWAP`, and terminal all-qubit measurement) are
parsed or stored once and deterministically emitted as Qiskit, PennyLane, Cirq,
CUDA-Q, Amazon Braket, OpenQASM 3.0, and PyQuil. Arbitrary circuits may use
OpenQASM 3 captured from the executed framework-native circuit; the UI emits a
reviewable target recipe rather than claiming lossless source equivalence.
Qiskit, Cirq, Amazon Braket, CUDA-Q, and PyQuil use qBraid's current target
adapters (including dedicated OpenQASM adapters where its graph has no automatic
edge), while PennyLane uses its official `from_qasm3` importer. Qiskit,
PennyLane, and Cirq remain the executable sandbox targets; the other four are
copy/export formats. Records without a concrete circuit are explicitly
unsupported and never receive fabricated code.
**Consequences:** New Studio-builder circuits and bounded Atlas circuits can
switch among all seven formats immediately, while imported artifacts retain all
available variants. Rich framework code remains authoritative under ADR-0013,
and failed or unavailable interchange does not block execution or publication.
The bounded converter preserves gate order, angle expressions, qubit indices,
and terminal measurement, but downstream decomposition and device behavior still
require review. Recipes list the current qBraid/PennyLane extras required in the
user's environment. Reversal trigger: adopt a broader typed IR or hosted
converter only when it can preserve and report unsupported semantics at least
as explicitly.
