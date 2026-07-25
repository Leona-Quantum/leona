# Phase 6 rollback rehearsal

## Safe rollback unit

The feature is fail-closed behind:

```text
MAJORANA_VQE_CANDIDATE_EXECUTION=false
```

Setting or leaving this value false prevents experiment execution without
deleting registry metadata, experiments, observations, or Artifacts.

## Rehearsed sequence

1. Disable `MAJORANA_VQE_CANDIDATE_EXECUTION`.
2. Restart API and worker.
3. Confirm `POST /v1/vqe/experiments/{id}/executions` returns
   `candidate_execution_disabled`.
4. Preserve all append-only observations and run events.
5. Stop the local candidate worker.
6. Remove local image tags only after recording their immutable digests.
7. If schema rollback is required on an empty rehearsal database, run Alembic
   downgrade to base and upgrade to head.

On 2026-07-25, the feature-off API test passed and an empty PostgreSQL database
completed upgrade → downgrade base → upgrade head, followed by seed. Existing
scientific evidence was not mutated or deleted.

## Prohibited rollback actions

- do not delete or update a prior observation
- do not rewrite scientific spec/resolution JSON
- do not relabel unreviewed evidence as reviewed
- do not replace a digest with a mutable image tag
- do not publish a private candidate Artifact
