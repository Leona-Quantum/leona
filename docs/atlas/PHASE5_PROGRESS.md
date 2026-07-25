# Atlas VQE Phase 5 — product integration and qualification record

Date: 2026-07-25
Branch: `feature/vqe`
Decision authority: ADR-0023–0031 and the 2026-07-25 owner deferral
State: **Phase 5A implemented and verified; Phase 5B technical candidate
evidence complete; independent human review and public promotion remain
blocked**

## 1. Phase 5A durable execution

The implementation preserves one portable, framework-independent scientific
experiment with independent Qiskit and PennyLane executions. The client may
choose only a framework preference. Runtime profile, package versions,
architecture, image digest, adapter release, protocol, dataset snapshot, and
isolation policy are server-owned.

Each execution is bound to one durable Run and `vqe.execute` job. The closed
lifecycle is:

```text
planned → queued → running → succeeded
                     ├────→ failed
                     └────→ cancelled
```

Retries append a new immutable observation to the same execution. A terminal
execution cannot be rewritten. Dead-letter handling closes both execution and
Run. Workspace scope is enforced through the repository layer.

The local candidate gate is fail-closed:

- default is disabled;
- permitted only for an explicitly configured local development process;
- rejected in Cloud Run, Vercel, and CI contexts;
- public capability remains unavailable;
- public execution, publication, and scientific release remain blocked.

## 2. Runtime boundary

The Qiskit and PennyLane images use:

- digest-pinned `python:3.12.12-slim-bookworm` base;
- independent frozen `uv.lock` files;
- Linux/x86_64;
- non-root UID/GID 65532;
- read-only root filesystem and bounded no-exec tmpfs;
- `--network none`;
- all Linux capabilities dropped and `no-new-privileges`;
- CPU, memory, PID, time, stdout, and stderr limits;
- no inherited host environment, credential mount, database URL, proxy, or
  runtime package installation.

The Worker launches the exact local image digest stored in the server-owned
profile. Mutable image tags are documentation only and are never used for
execution.

## 3. Actual qualification evidence

Machine-readable evidence:

- `evidence/phase5b_h2_runtime_qualification_2026-07-25.json`
- `evidence/qiskit_h2_candidate_1e6552f.sbom.cdx.json`
- `evidence/pennylane_h2_candidate_34214c9f.sbom.cdx.json`

| Candidate | Immutable image digest | Repetitions | Infrastructure failures | Max absolute error (Ha) | Min fidelity |
|---|---|---:|---:|---:|---:|
| Qiskit 1.4.6 | `sha256:1e6552f240a6a79555ee84da0460934900bfa62086467b5866954b96b871ea1c` | 10 | 0 | 1.821e-14 | 0.9999999999999896 |
| PennyLane 0.45.1 | `sha256:34214c9f8ed7ea581a324eb6ebb464f001b75e00570da86e190876e57fe34e59` | 10 | 0 | 1.732e-14 | 0.9999999999999902 |

Every run reported the same comparison-eligible common-basis metrics:

```text
CNOT = 48
Depth = 83
Gate count = 152
Parameters = 1
```

Both strict containers rejected an outbound TCP connection under
`--network none`. Docker Scout extracted CycloneDX SBOMs from the build-time
SBOM/provenance attestations: 140 packages for Qiskit and 149 for PennyLane.

These measurements qualify the exact local Linux/x86_64 candidate images that
were run. They do not prove deployment-environment scheduling, host-kernel
isolation, or production service availability.

## 4. Studio and materialization

`/studio?vqeExperiment=<uuid>` renders a dedicated proof panel rather than
mixing VQE evidence into the circuit editor. It supports:

- Qiskit/PennyLane candidate selection;
- durable execution start, polling, cancellation, and named failures;
- energy, absolute error, fidelity, CNOT, depth, and parameter display;
- private candidate materialization.

The UI parser fails closed unless API evidence remains explicitly
`unreviewed`, `unqualified`, and `public_execution=blocked`. Materialized
artifacts are private, unverified candidates and cannot be published through
the normal artifact publication guard.

## 5. Verification performed

- full Python suite: `1112 passed, 74 skipped`;
- temporary Neon validation branch: `28 passed`;
- web/turbo lint, typecheck, and tests: `6/6` tasks, `95` web tests;
- Next production build: passed, 336 pages, VQE BFF route present;
- targeted Ruff and diff checks: passed;
- 10 strict Linux/x86_64 runs per framework: passed;
- live deny-all egress checks for both image digests: passed;
- CycloneDX SBOM extraction from attestations: passed.

The in-app browser reached the local server, but the protected `/studio`
route redirected the signed-out browser to the public home page. No
authenticated browser flow was claimed as tested.

## 6. Remaining external gates

The following remain deliberately unpassed:

- independent human scientific review of the executable H2 fixture;
- owner review of the authenticated Studio user flow;
- promotion of candidate profiles to a production runtime matrix;
- public execution, publication, scientific claims, deployment, and MVP
  release approval.

Therefore `human_review_state=unreviewed`,
`production_runtime_status=unqualified`, and every public/release state
remain blocked. The technical evidence above is not a substitute for the
independent reviewer or owner decision.
