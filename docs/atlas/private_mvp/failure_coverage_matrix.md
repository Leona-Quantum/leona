# Private VQE MVP failure-coverage matrix

| Failure or invariant | Existing automated evidence | Level | Missing live evidence? |
|---|---|---|---|
| Unknown/missing/wrong-role component | `test_standard_catalog.py`, `test_vqe_spec_resolution.py` | offline fail-closed | No |
| More than one changed comparison role | `test_standard_catalog.py::test_comparison_changes_exactly_one_component` | offline scientific contract | No |
| SLSQP/COBYLA configuration drift | `test_standard_catalog.py::test_optimizer_comparison_does_not_change_other_configuration` | offline scientific contract | Private E2E must confirm saved records |
| Client chooses network, credentials, or dynamic install | `test_vqe_runtime_isolation.py` | offline security contract | No |
| Runtime image is not an exact OCI digest | `test_vqe_runtime_isolation.py::test_production_profile_is_exact_oci_digest_and_keeps_deny_all_policy` | offline security contract | CI host must pull with `--pull=never` |
| Missing execution or fabricated result | `test_vqe_routes.py::test_execution_endpoints_remain_honest_without_an_execution`, `vqe-proof.test.ts` | API/UI fail-closed | No |
| Idempotency conflict | `test_vqe_routes.py::test_create_experiment_translates_idempotency_conflict_to_409` | API contract | Private E2E replays mutations |
| Cross-provider result conflation | separate Qiskit/PennyLane execution rows in `test_vqe_production_e2e.py` | private CI | Yes until current CI evidence passes |
| Browser loses the immutable baseline while reopening the optimizer-swap workflow | `vqe-authenticated-flow.spec.ts::fixed-excitation SLSQP to COBYLA is saved, compared, and reopened` | synthetic authenticated browser E2E | Private CI must confirm persisted rows |
| Browser displays or saves a comparison whose server response is not explicitly private and publication-blocked | `vqe-controlled-comparison.test.ts::fails closed when a comparison is not explicitly private and blocked` | client fail-closed contract | No |
| Browser mock drifts from the production comparison schema | `vqe-controlled-comparison.test.ts::parses the production-shaped controlled comparison payload`, `vqe-authenticated-flow.spec.ts` | parser and browser contract | No |
| Server labels a comparison comparable while an invariant is false | `vqe-controlled-comparison.test.ts::rejects a comparable status when an invariant failed` | client fail-closed contract | No |
| Metric evidence is attached to a different execution than the comparison run identifies | `vqe-controlled-comparison.test.ts::rejects metric evidence attached to the wrong execution identity` | client fail-closed identity contract | No |
| Resource metrics were computed under a different metric protocol than the frozen comparison specification | `vqe-controlled-comparison.test.ts::rejects resource evidence from a different metric protocol` | client fail-closed scientific contract | No |
| Numerical comparison is shown before the server declares the record comparable | `vqe-controlled-comparison-panel.tsx` guarded rendering exercised by `vqe-authenticated-flow.spec.ts` | UI scientific-claim boundary | No |
| A failed strict reopen is overwritten by a success message or navigation | boolean reopen admission in `vqe-experiment-launcher.tsx`, exercised by `vqe-authenticated-flow.spec.ts` | UI fail-closed state transition | No |
| Mock/browser test binds the ansatz by array position instead of scientific role | role-addressed bindings in `mock-control-plane.mjs` exercised by the fixed-excitation golden journey | synthetic integration regression | No |
| Private save and same-subject reopen | second synthetic JWT session in `test_vqe_production_e2e.py` | private CI, synthetic auth | Yes until current CI evidence passes |
| Cross-workspace access | scoped repository tests and `test_research_candidate_controlled_e2e_live.py` | disposable PostgreSQL | No for repository boundary |
| Logout → live WorkOS login → same workspace reopen | no current committed evidence | live WorkOS staging | **Yes — NOT_RUN** |
| Public execution or publication | API responses and Capability Manifest remain `blocked` | fail-closed policy | No; owner approval would be a separate phase |

The matrix avoids reimplementing already-covered failures. Release work adds a
test only when the referenced evidence does not exercise the exact boundary.
