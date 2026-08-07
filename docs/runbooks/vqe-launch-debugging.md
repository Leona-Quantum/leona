# VQE launch debugging runbook

Use this runbook when the launcher is empty, a workflow is shown as blocked,
experiment creation fails, or an execution does not start. Never bypass the
projection or edit scientific state in the database to make a run proceed.

## 1. Start with the browser-visible reason

The launcher and proof panel must show an RFC 9457 problem containing:

- HTTP status;
- stable `reason_code`;
- `request_id` and `trace_id`;
- retryable/non-retryable classification;
- blocker fields where applicable.

Copy only the IDs and reason code. Do not copy bearer tokens, cookies, database
URLs, JWTs, or complete environment output into an issue.

## 2. Read the current projection

With an authenticated session, request:

```text
GET /v1/vqe/workflow-launch-projections/{workflow_artifact_version_id}
```

Interpret each layer independently:

| Field | Meaning |
| --- | --- |
| `definition_state` | canonical component/workflow definition exists |
| `composition_state` | strict portable scientific composition validated |
| `review_state` | independent scientific review state only |
| `execution_policy_state` | whether private execution is permitted |
| `implementation_resolution` | exact framework implementation binding |
| `runtime_qualification` | historical profile qualification |
| `live_readiness` | non-expired worker observation now |

Do not infer launchability from any single field. Use the server-produced
`experiment_creation.decision` and per-framework `decision`.

## 3. Stable reason-code actions

| Reason | Operator action |
| --- | --- |
| `vqe_launch_projection_stale` | refresh projection and retry once |
| `vqe_runtime_readiness_unknown` | verify worker is running and publishing |
| `vqe_runtime_readiness_stale` | inspect worker loop/clock/DB connectivity |
| `vqe_runtime_unavailable` | verify exact digest is provisioned; do not pull during a run |
| `vqe_implementation_unresolved` | compare component binding metadata with runtime profile |
| `vqe_validated_draft_required` | derive and save the validated draft, then launch that UUID |
| `vqe_eligible_create_scientific_mismatch` | incident: stop launch rollout and inspect Registry drift |

HTTP 422 is not one diagnosis. Always use `reason_code`. HTTP 503 denotes a
currently unavailable runtime. HTTP 412 denotes stale read/mutate truth.

## 4. Correlate structured logs

Search API logs for `event=vqe_launch_decision` and the `request_id`. The log
contains workflow/experiment UUIDs and only a projection digest prefix.

Search worker logs for `event=vqe_runtime_readiness` and the relevant
`runtime_profile_id`. It records generation, observed/expiry time, status,
failure code, and a detail digest prefix. Exception messages are deliberately
absent because they may contain paths or subprocess arguments.

## 5. Query durable decision evidence

Use a read-only database role and constrain the workspace/request. Example:

```sql
SELECT created_at,
       request_id,
       action,
       decision,
       primary_reason_code,
       workflow_artifact_version_id,
       experiment_id,
       left(projection_sha256, 12) AS projection_prefix,
       blockers_json,
       readiness_snapshot_json
FROM vqe_launch_decisions
WHERE workspace_id = :workspace_id
  AND request_id = :request_id
ORDER BY created_at, id;
```

Never UPDATE or DELETE this table. Migration `vqe_launch_0057` installs a
database trigger that refuses both operations.

## 6. Check live readiness without inventing it

```sql
SELECT runtime_profile_id,
       generation,
       worker_id,
       status,
       observed_at,
       expires_at,
       left(detail_sha256, 12) AS detail_prefix
FROM vqe_runtime_readiness
ORDER BY runtime_profile_id;
```

A row with `status=ready` but `expires_at <= now()` is not ready. Never extend
TTL manually. Fix the worker and wait for a new generation.

## 7. Exact OCI verification

On the dedicated worker host, verify that the runtime profile's full repository
digest is present. Tags, local image IDs, and a different platform manifest are
not substitutes. Runtime execution remains `--pull=never`; provisioning is an
operator action outside the job.

The API process must have no Docker socket. A request that can pull or inspect
an image is an architecture violation.

## 8. Alert and incident policy

Page/stop rollout when `majorana.vqe.launch.invariant_failures` increases at all
within 15 minutes. Preserve the request and projection IDs, then compare the
projection evaluator input with the strict resolver input. Do not reclassify the
422 as user error.

Warn when an admitted runtime has no ready heartbeat for two TTL periods. This
may pause only VQE execution. Atlas browsing and unrelated Studio work must
remain available.

## 9. Safe recovery

1. Correct Registry materialization, implementation metadata, worker runtime,
   or deployment configuration.
2. Let the worker publish a new readiness generation.
3. Refresh the projection.
4. Retry with a new/appropriate idempotency key only when the earlier request
   did not succeed.
5. Confirm a new immutable decision row and expected execution state.

Do not delete evidence, mutate a frozen experiment, relabel owner waiver as
review, reuse a stale projection digest, or loosen the scientific resolver.

