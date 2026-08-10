# Targeted verification fixes — 2026-08-10

## Outcome

The authoritative post-fix result is
[`report-targeted-verification-fixes-final-v3-20260810.json`](./report-targeted-verification-fixes-final-v3-20260810.json).
It ran the repository's real eval harness against the configured provider, a local
subprocess sandbox, and local PostgreSQL with procedural seed `867530920260810`.
Each of the seven cases was run once.

| Metric | First branch diagnostic | Final v3 |
|---|---:|---:|
| Oracle-correct pass rate | 3/7 (42.9%) | **7/7 (100%)** |
| First-candidate pass | 2/7 | **5/7** |
| False positives | 3 | **0** |
| Candidate revisions | 8 | 11 |
| Recorded LLM calls | 25 | 34 |

The first diagnostic is not a pristine `dev` baseline; it is the earliest real-provider
run made while this branch was being repaired. The final result's Wilson 95% interval is
64.6%–100%, so seven cases on one fixed seed demonstrate the targeted fixes but do not
establish broad production accuracy.

## Final per-family result

| Family | Result | First candidate | Candidates | Recorded LLM calls | Protected oracle evidence |
|---|---:|---:|---:|---:|---|
| Non-dyadic QPE | pass | yes | 1 | 4 | dominant integer 14; phase 0.875; peak 0.6923484844 |
| Amplitude damping | pass | no | 2 | 5 | excited population 0.1825331322; purity 0.9485139678 |
| Lindblad + Stinespring | pass | yes | 1 | 6 | density fidelity 0.9999999999999987 |
| Repetition QEC | pass | no | 4 | 10 | worst-case fidelity 1.0 |
| Ordered Trotter | pass | yes | 1 | 3 | exact/Trotter fidelity 0.9999920469 |
| Qibo statevector | pass | yes | 1 | 3 | all four Bloch/population scalars match |
| Qulacs statevector | pass | yes | 1 | 3 | all four Bloch/population scalars match |

QEC is still the main efficiency gap: it succeeded, but consumed four candidates and ten
recorded LLM calls. Lindblad used one candidate but six calls because planning and optional
reference extraction/auditing remain relatively expensive.

## What changed

- Qubit-order and sign verification now combines trusted native `FINAL_CIRCUIT` evidence
  with request-derived exact checks. Native checks cover Bloch Y sign, canonical q0 order,
  reduced system density matrices, finite-QPE displayed order, and ordered-Trotter output.
  Fully specified Qibo/Qulacs RY→RZ and non-dyadic QPE requests also get independent task
  oracles, preventing a wrong circuit and its self-consistent RESULT from passing together.
- Amplitude damping gets an independent scalar oracle derived from gamma and the input
  state. Repair feedback names the required environment→system CNOT in the Stinespring
  isometry.
- QEC planning is normalized to the requested coherent three-qubit repetition contract,
  and the generation scaffold handles all three single-qubit errors plus no error without
  comparing an 8×8 encoded density matrix to a 2-vector.
- Ordered second-order Trotter generation preserves written term order and uses matching
  exact/Trotter observables.
- Broad Lindblad plans no longer fail typed validation because the planner invented an
  unusable exact reference. Exact extraction is optional, the requested same-channel
  fidelity is pinned near one, and a direct amplitude-damping-plus-dephasing dilation
  scaffold is available.
- High-risk generation families use the substantive plan model. In this run the provider
  profile was `openai`, with `deepseek-v4-pro` for plan/high-risk generation and verify;
  the ordinary generate/audit override was `deepseek-v4-flash`.
- Migration `0049` completes framework constraints for `runs`, `artifacts`, and
  `artifact_versions`, complementing the `0048` changes to candidate/step tables.
- The orphan reaper now closes active direct/eval runs with no queue job after a one-hour
  grace period, while preserving fresh runs and runs with any live job.
- Eval scoring follows the candidate recorded in `code.finalized`, not a later unfinished
  repair candidate. A stronger `ai_review_aligned_with_reference_check` terminal reason is
  accepted when a case expected ordinary alignment.

## Diagnostic chronology

All JSON files below are actual command output. Intermediate reports are retained because
they caught distinct bugs; only final v3 should be quoted as the final targeted result.

| Report | Scope | Pass | False positives | Finding |
|---|---:|---:|---:|---|
| `report-targeted-verification-fixes-20260810.json` | 7 | 3 | 3 | Initial sign/order and Lindblad planning failures |
| `report-targeted-verification-fixes-postfix-20260810.json` | 7 | 3 | 2 | Native evidence exposed tuple binding and QEC repair defects |
| `report-targeted-verification-fixes-round3-20260810.json` | 4 | 2 | 1 | QEC/Qulacs improved; amplitude self-consistency hole remained |
| `report-targeted-verification-fixes-round4-20260810.json` | 2 | 2 | 0 | Amplitude damping and Lindblad both passed |
| `report-targeted-verification-fixes-final-20260810.json` | 7 | 6 | 1 | Exposed scorer selecting the unfinished last candidate |
| `report-targeted-verification-fixes-final-v2-20260810.json` | 7 | 5 | 2 | Exposed request-vs-circuit holes in QPE and Qulacs |
| `report-targeted-verification-fixes-round5-20260810.json` | 2 | 0 | 0 | New checks failed closed; QPE still did not converge |
| `report-targeted-verification-fixes-round6-qpe-20260810.json` | 1 | 1 | 0 | Direct diagonal-QPE scaffold passed on the first candidate |
| `report-targeted-verification-fixes-final-v3-20260810.json` | 7 | **7** | **0** | Final authoritative targeted run |

## Verification commands

- `uv run ruff check .`: passed.
- `uv run ruff format --check .`: 357 files formatted.
- `uv run pytest -q`: 2174 passed, 409 skipped.
- On a freshly created scratch PostgreSQL database: 20 passed, 1 skipped across orphan
  reaper, live job queue, and pipeline end-to-end tests.
- On the same scratch database: Alembic upgrade to head, downgrade to `0048`, and upgrade
  back to `0049 (head)` all passed. The scratch database was then removed.
