# docs/archive

Completed build logs, one-time cutover procedures and closed review records. Everything
here is **history**: accurate on the day it was written, superseded now. Each file opens
with a dated `ARCHIVED` banner naming what replaced it and what, if anything, in it never
shipped.

Nothing was deleted. A record of a real decision stays readable even after the decision
is reversed — that is the point of the directory.

| Folder | What it holds |
|---|---|
| `repository-migration-2026-07/` | The nine `repository-step*.md` build-log entries for the 2026-07 catalog migration (steps 0 through 5b Slice A), the closed PR #64 review disposition, and the Neon-branch-shaped operator runbook that `docs/runbooks/system-catalog.md` replaced. |
| `verification-v2-2026-07/` | The verification-v2 implementation plan and rollout review, both superseded by ADR-0023, plus the step-12 screenshot evidence for that review. |
| `japanese-ui-audit-2026-07-30/` | The Japanese UI copy audit and its two "before" screenshots. The findings were applied; its glossary was promoted to `docs/ui/copy.md`, which also lists the four residues that survive. |
| `one-time-cutovers/` | The WorkOS staging→production cutover (2026-07-29) and the local execution log for the ADR-0023 pipeline. |

## What did *not* ship, and is easy to lose in here

Two things were planned in these documents, never built, and remain live scope:

- **Step 5b Slice B** — the allowlisted network fetcher with SSRF/redirect/archive/
  traversal hardening, and the MQT Bench / QASMBench sources it was for. `ImportProvider`
  is still a closed two-member allowlist of in-repo readers. See ADR-0017, which is
  therefore a design that has never been exercised against a single real fetch.
- **The version-bound evidence layer** — `artifact_verifications` and
  `conversion_attempts` exist in no migration and no ORM model, so public support labels
  are not derived from stored evidence. See ADR-0018.
