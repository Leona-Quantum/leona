# Verification v2 seeded regressions

These provider-free cases record routing expectations, not fabricated live-provider
outputs. `majorana_evals.score_seeded_corpus` accepts observations from tests or real
runs and treats a missing observation as a failed case.

The following production tests supply the behavioral evidence behind the seeds:

| Seeds | Production behavior exercised |
|---|---|
| v2-01, v2-02 | `services/worker/tests/test_agent_ports.py` Bell/GHZ phase-aware property tests |
| v2-03 | native statistical replay and reported-count disagreement tests in `test_agent_ports.py` |
| v2-04 | semantic request-to-Plan mismatch and Plan revision tests in `test_agent_ports.py` and `packages/py/agent/tests/test_audited_state_machine.py` |
| v2-05 | malformed critic retry and same-candidate tests in `test_agent_ports.py` and `packages/py/agent/tests/test_audited_state_machine.py` |
| v2-06, v2-07 | unsupported-property and structural-only sufficiency tests in `test_agent_ports.py` and `packages/py/verification/tests/test_property_policy.py` |
| v2-08 | resource-exhaustion terminal routing in `services/worker/tests/test_handlers.py` |
| v2-09, v2-10 | brute-force MaxCut/QUBO positive and negative checks in `test_agent_ports.py` |
| v2-11a, v2-11b | exact-diagonalization VQE positive and negative checks in `test_agent_ports.py` |
| v2-12 | verdict-neutral conversion tests in `packages/py/agent/tests/test_audited_state_machine.py` and `test_agent_ports.py` |
| v2-13 | private INCONCLUSIVE materialization tests in `packages/py/agent/tests/test_audited_state_machine.py` |
| v2-14 | fingerprint mismatch gates in `services/api/tests/test_artifact_verification_gates.py` and `services/worker/tests/test_agent_ports.py` |
| v2-15 | legacy event/API parsing tests in `packages/py/contracts/tests/test_events.py` and `services/api/tests/test_artifact_routes.py` |

`services/api/tests/test_artifact_verification_gates.py::test_seeded_verification_v2_publication_matrix`
also sends every seed through the real API public-visibility gate. It proves that only a
fingerprint-bound physical PASS can become public, while INCONCLUSIVE, FAIL, stale, and
legacy-unknown cases remain private.
