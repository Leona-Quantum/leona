# Phase 6 threat and rights review

Date: 2026-07-25 JST  
Scope: Atlas VQE Phase 5 candidate execution and Phase 6 release gate

## Threat review

| Threat | Control | Residual status |
|---|---|---|
| Client chooses an arbitrary image/profile | Client sends only framework preference; server resolves an exact binding | controlled |
| Candidate accidentally enabled in production | settings and worker reject non-development and cloud/CI markers | controlled |
| Runtime reads credentials or DB URL | child receives a fixed two-variable environment; live environment audit | controlled |
| Runtime exfiltrates data | Docker `--network none`; live connection test | controlled locally |
| Container privilege escalation | non-root, read-only root, cap-drop ALL, no-new-privileges | controlled locally |
| Resource exhaustion | CPU/memory/pids/time limits and streaming output cap | controlled |
| Retry overwrites earlier evidence | observations are append-only in repository and PostgreSQL trigger | controlled |
| Cross-workspace execution binding | every read/write scopes through experiment/run ownership | controlled |
| Mismatched run reused for VQE | bind checks workspace, creator, execute mode, framework, seed, queued state | controlled |
| Scientific input silently changes | exact component and workflow digests; deferred mode accepts only the frozen H2 semantic keys | controlled |
| Provider-native metrics presented as comparable | only canonical/common stages are comparison-eligible | controlled |
| Unreviewed result appears public or verified | capability unavailable; UI/API labels; private materialization; publication blocked | controlled |
| Compromised dedicated Docker daemon | Dedicated host and Docker socket remain a privileged boundary | accepted for private runtime; host hardening/monitoring remains operational work |
| Registry tag or digest substitution | server profile uses an exact OCI index digest; preflight verifies local RepoDigest; execution uses `--pull=never` | controlled |
| Runtime-time registry/network dependency | images are provisioned before execution and containers use `--network none` | controlled |
| Scientific waiver mislabeled as review | API/evidence use `owner_waived`, never `human_reviewed`; public/scientific release remains blocked | controlled |

## Rights and provenance review

- The H2 fixture, protocol, and adapters are repository-authored scientific
  metadata/code; evidence locators and digests are retained.
- Qiskit and PennyLane dependencies are redistributed only inside local
  candidate images under their upstream package licenses. SBOMs preserve exact
  package identities for a later legal/license scan.
- No third-party paper text, figures, or proprietary datasets are embedded in
  the runtime image.
- Atlas corpus records remain summaries with evidence locators. Unknown and
  conflict states are not converted into affirmative claims.
- The committed SBOMs are inventory evidence, not a legal approval. A human
  license/compliance owner must review flagged package licenses before public
  image distribution.

## Release conclusion

No new technical high-severity issue was found after remediation. GHCR
publication and the private disposable-Neon system E2E are complete. Residual
Docker-host trust, owner-waived independent scientific review, live WorkOS
tenant validation, deployment operations, and human license approval mean
public release remains blocked.
