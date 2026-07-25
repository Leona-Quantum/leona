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
| Compromised local Docker daemon | Docker socket remains a privileged host boundary | accepted for local candidate only; blocks production promotion |
| Registry tag or digest substitution | execution uses digest, never tag | local proof complete; registry publication pending |

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

No new technical high-severity issue was found after remediation. Residual
Docker-daemon trust, independent scientific review, registry publication, and
human license approval mean public release remains blocked.
