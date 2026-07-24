# Atlas VQE MVP — Phase 0 owner-review bundle

**Reviewed and approved by:** repository owner, 2026-07-24 (via explicit
instruction in-session: "Phase 0を正式に完了させ...Phase 0修正を...owner-approvedとして記録する").
**Phase status:** `complete` (owner-approved). See
`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md` Phase 0 for the authoritative
phase record; this document is the review evidence bundle referenced from it.

This exists so Phase 0's acceptance isn't just "code exists" — per
`docs/atlas/README.md`'s status vocabulary rule ("Do not mark a phase
`complete` when only code exists. Its acceptance gates, tests, rollback
evidence, and required review must also be complete."), everything below was
re-run fresh on 2026-07-24 rather than carried over from earlier in the
session.

## 1. ADR decisions, open items, reversal triggers

| ADR | Decision (one line) | Open / unresolved | Reversal trigger |
|---|---|---|---|
| [0023](adr/0023-vqe-experiment-identity.md) | Components/Workflows are `ArtifactVersion`s, not string labels; `ScientificExperimentSpec` strictly separated from `ExecutionRequest`/`ExecutionBinding`; idempotency identity is server-generated | Final `vqe_*` table column list is fixed by ADR only after Phase 2 corpus validates the ontology — this ADR fixes identity, not schema | If Phase 2 annotation velocity shows the ArtifactVersion-per-component model is too heavyweight, a lighter identity model may be proposed in a superseding ADR, but must preserve single-source provenance and must not reintroduce string-label identity |
| [0024](adr/0024-vqe-runtime-profiles.md) | Runtime capability resolution is server-authoritative via a support matrix; each runtime is an independently-locked, digest-pinned profile with `frozen_reproduction`/`current_compatibility` lanes; new/upgraded runtimes start `CANDIDATE_UNVERIFIED` | Promotion workflow (who/how a runtime leaves `CANDIDATE_UNVERIFIED`) is specified as "reviewed configuration change" but the concrete mechanism isn't built yet (Phase 5) | If per-profile image/SBOM overhead proves unsustainable at 2-framework MVP scale, a shared base-image strategy may be proposed in a superseding ADR, but must not weaken digest-pinning, deny-all egress, or server-authoritative resolution |
| [0025](adr/0025-vqe-scientific-evidence.md) | Hamiltonians are canonicalized+digested before comparison; `vqe_observations` is strictly append-only; finite-shot evidence is a distinct, non-substitutable class from exact/statevector evidence | Canonicalization routine only implemented+tested for H2/4-qubit case so far (this Phase 0 spike); needs generalization + tests in Phase 1 | Finite-shot evidence may become an accepted class (not a substitute) once a shot-noise statistical-significance protocol is defined in a superseding ADR |

All three ADRs remain formally `proposed` in their own front-matter (owner
security/architecture sign-off on the ADR text itself is a separate action
from this Phase 0 completion review) — this bundle records that their
*decisions* were exercised and held up under the Phase 0B spike, not that a
formal ADR-acceptance pass has separately happened. If the owner wants the
ADR status line itself flipped to `accepted`, that's a one-line edit on
request.

## 2. H2/STO-3G fixture — re-run fresh 2026-07-24

Commands actually executed, in order, from a clean state:

```bash
cd runtimes/vqe/qiskit-current && uv run python spike/h2_sto3g_spike.py
cd runtimes/vqe/pennylane-current && uv run python spike/h2_sto3g_spike.py
cd docs/atlas/fixtures/h2_sto3g && python3 generate_fixture.py
```

Dependency versions actually installed (from each spike's own
`package_versions` field, not asserted separately):

| Runtime | Packages |
|---|---|
| qiskit-current | qiskit 1.4.6, qiskit-algorithms 0.4.0, qiskit-nature 0.8.0, pyscf 2.14.0, numpy 2.5.1 |
| pennylane-current | pennylane 0.45.1, pyscf 2.14.0, numpy 2.5.1 |

Measured results:

| Quantity | Value |
|---|---|
| Independent direct FCI reference (no qubit mapping) | -1.1373060357534004 Ha |
| Qiskit-current qubit-Hamiltonian exact diagonalization | -1.137306035753399 Ha (error vs FCI: 1.33e-15 Ha) |
| PennyLane-current qubit-Hamiltonian exact diagonalization | -1.1373060357532858 Ha (error vs FCI: 1.15e-13 Ha) |
| Cross-framework structural correspondence | qubit permutation `[0,2,1,3]` (PennyLane wire → Qiskit qubit) + per-qubit local Pauli-frame `[id, id, s, sdag]` — exact discrete match, found by exhaustive search |
| Cross-framework numerical agreement (after applying the above) | max coefficient diff **6.52e-10 Ha**; full 16-eigenvalue spectrum diff **1.20e-9 Ha** — both consistent with two independent SCF solves at PySCF's own default `conv_tol=1e-9` Ha (verified by reading it off the installed `pyscf==2.14.0` package directly, not assumed) |
| `hamiltonian_digest_sha256` | `d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79` — reproduced identically across a full fresh re-run of both spikes + fixture generation |

Full detail: `docs/atlas/fixtures/h2_sto3g/manifest.json`,
`docs/atlas/fixtures/h2_sto3g/raw/*.json`.

**Important scope note carried over from the fixture's own `review_record`:**
this is *automated cross-validation*, not the human/owner scientific review
`atlas_vqe_mvp_execution_plan_ja.md` Part III §12 requires before later
phases may treat the fixture as ground truth. Phase 0's own acceptance
criteria (independent-lock builds, digest match/permutation-equivalence,
exact result within tolerance, honest failure contract, no fabricated
values) do not require that deeper scientific review — approving Phase 0
here approves the *engineering slice*, not a claim that a domain scientist
has signed off on the physics. That remains open.

## 3. Failure-contract reproducible test results

Both `spike/h2_sto3g_spike.py` scripts were refactored so their core logic
(`run_spike(*, basis, output_path)`) is callable with an injected invalid
basis, rather than relying on a one-off manual edit-run-revert cycle. Tracked
tests, actually run:

```bash
cd runtimes/vqe/qiskit-current && uv run pytest spike/test_failure_contract.py -v
cd runtimes/vqe/pennylane-current && uv run pytest spike/test_failure_contract.py -v
```

Result: **2 passed** in each project (`test_invalid_basis_produces_bounded_failure_contract`,
`test_valid_basis_still_succeeds`). Each failure-contract test asserts: exit
code 1, JSON report exists and is ≤2000 bytes, `status == "execution_failed"`,
`failure_code == "execution_failed"`, non-empty `error_type`/`error_message`
strings, and that no success-shaped fields (`qubit_hamiltonian_exact_diagonalization`,
`independent_direct_fci_reference`) leak into the failure report.

This closes the earlier gap where the failure contract had only been verified
once, manually, via a temporary `sed` edit that was reverted afterward —
that verification is now a tracked, re-runnable fixture per the "CI or
tracked fixture" requirement (CI wiring was deliberately not added: these
runtime candidates are intentionally excluded from the root workspace/CI per
ADR-0024 to keep heavy native scientific dependencies out of the main
pipeline, and `.github/workflows/*` is a blast-radius file requiring
owner/CODEOWNER review before editing per root `AGENTS.md` — the tracked
pytest file satisfies reproducibility without that additional blast radius).

## 4. Corrections made before this approval

Two issues raised in owner review were fixed and re-verified before this
bundle was written (see commit history on `feature/vqe` for the actual diffs):

1. **Overclaiming language.** Earlier fixture prose said things like "confirmed
   both sides represent the same physical operator" and implied byte-exact
   equality. Rewritten throughout `generate_fixture.py`, `manifest.json`, and
   `README.md` to separate the **exact discrete structural correspondence**
   (permutation + local Pauli-frame, a yes/no match) from **bounded numerical
   agreement** (6.52e-10 Ha / 1.20e-9 Ha, not machine precision), and to state
   spectrum-match evidence as "consistent with," not "proof of," operator
   identity.
2. **Under-justified tolerance.** `CROSS_LIBRARY_SCF_AGREEMENT_TOLERANCE_HA`
   was 1e-6 Ha with no stated derivation — about 3 orders of magnitude looser
   than the actually observed ~1e-9 Ha gap, and easily confusable with the
   unrelated `EXACT_CROSS_CHECK_TOLERANCE_HA=1e-10` (a different, within-pipeline
   check). Tightened to 1e-7 Ha, explicitly derived from PySCF's verified
   `conv_tol=1e-9` default plus a ~2-order-of-magnitude margin, and the
   manifest now reports both tolerances side by side with their distinct
   meanings and observed values so they cannot be conflated.

## 5. Sign-off

- All Phase 0 acceptance criteria (`atlas_vqe_mvp_execution_plan_ja.md`
  Phase 0 § Acceptance) hold against the fresh 2026-07-24 run above.
- No fabricated numbers: every value in this document is copied from an
  actually-executed command's actual output, not typed from memory or
  estimated.
- Phase 0 is recorded `complete` (owner-approved) in
  `atlas_vqe_mvp_execution_plan_ja.md`. Remaining open items (ADR text
  formally flipped to `accepted`; deeper domain-scientist review of the H2
  fixture) are tracked, not blocking, and do not gate Phase 1 per the plan's
  own acceptance criteria for Phase 0.
- Next: Phase 1 (`ComponentSpec`/`WorkflowSpec`/`ScientificExperimentSpec`/
  `ExecutionRequest`/`ExecutionBinding`/`EvaluationProtocol`/canonical
  Hamiltonian+digest/result contract), no DB/UI, in `packages/py/vqe/`.
