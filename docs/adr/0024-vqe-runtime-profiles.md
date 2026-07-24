# ADR-0024: VQE runtime capability resolution is server-authoritative, with frozen and current version lanes

**Date:** 2026-07-24 · **Status:** proposed (owner review required before Phase 5 runtime work)
**Context:** Executing a `ScientificExperimentSpec` requires choosing a concrete
Qiskit or PennyLane provider version, adapter release, and container image, and
untrusted client input must never select or influence what actually runs — the
runtime executes ansatz/optimizer code and PySCF-derived Hamiltonians in a process
far heavier and riskier to keep resident than the existing framework-native circuit
converters. Reproducibility additionally requires distinguishing "what environment
produced this paper's reported number" from "what environment Atlas currently
supports," since provider libraries move faster than published results.
**Decision:** Every VQE-capable runtime is packaged as
`runtimes/vqe/<framework>-<lane>/`, an independently uv-locked project kept outside
the root workspace — it is never added unconditionally via the root `pyproject.toml`
`packages/py/*` glob — built into a digest-pinned OCI image with its own SBOM. A
runtime profile carries `runtime_profile_id`, `adapter_release_id`,
`container_digest`, `architecture`, and `provider_versions`. The API maintains a
server-side support matrix mapping `requested_capability` (plus an optional
`preferred_framework` hint) to an approved `ExecutionBinding`; a client-supplied
`runtime_profile_key`, digest, or provider version is never authoritative, only ever
a preference. Two version lanes exist: `frozen_reproduction` pins the exact
source/environment captured at the time a paper/reviewed Artifact was recorded, and
`current_compatibility` is whatever provider/runtime Atlas presently supports. MVP
does not add a `latest_observed` lane, and no lane auto-grants a "verified" status. A
newly introduced or upgraded runtime candidate starts `CANDIDATE_UNVERIFIED` and may
only be promoted into the support matrix after it passes the golden-fixture numerical
gates (ADR-0025) under human/owner review; promotion is a reviewed configuration
change, not a code path any request can trigger. At execution time the runtime
process itself holds no Neon/cloud/QPU/signing/publication credential, cannot reach
the network, runs non-root with a read-only root filesystem except an ephemeral
writable output directory, performs no runtime package installation, and is bounded
on CPU/memory/pids/wall-time/output size — this mirrors the sandbox deny-all
invariant and ADR-0017's execution-runtime trust boundary rather than inventing a
separate one.
**Consequences:** This buys a clean separation between "the API says what should
run" and "an isolated, auditable, non-networked process says what did run," so a
compromised or buggy runtime cannot exfiltrate data or select its own capability
claims. It costs real operational overhead: every framework/version pair needs its
own lock, image build, and SBOM, and promoting a runtime is a manual, reviewed act,
not a version bump. Two frameworks at MVP (Qiskit-current, PennyLane-current) means
two profiles to maintain at minimum; ADAPT-VQE-class, GPU, or QPU runtimes are
explicitly out of MVP scope and would each need their own profile and ADR-0024-level
review before admission. Reversal trigger: if per-profile image/SBOM overhead proves
unsustainable at the two-framework MVP scale, a shared base-image strategy may be
proposed in a superseding ADR, but it must not weaken digest-pinning, deny-all
egress, or server-authoritative capability resolution.
