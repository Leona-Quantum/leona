# Worker queue throughput benchmark

Run the bounded default profile from the repository root:

```bash
uv run --package majorana-worker python bench/worker/queue_throughput.py
```

The default drains 100 deterministic jobs through the real
`majorana_worker.run_forever()` loop with one in-process Worker. `--workers` can
run up to 20 loops against the same in-memory leased queue, and
`--handler-delay-ms` can model a bounded local handler duration without making a
provider call. The command emits one JSON record containing elapsed time,
throughput, queue depth, claim/finish/session counts, and completion invariants. It exits
non-zero if any job is duplicated, retried, left unfinished, or fails to finish
before `--timeout-s`.

Examples:

```bash
# Default approximately-100-job single-Worker profile.
uv run --package majorana-worker python bench/worker/queue_throughput.py

# Compare bounded local Worker-loop concurrency without a database.
uv run --package majorana-worker python bench/worker/queue_throughput.py \
  --jobs 100 --workers 4 --handler-delay-ms 1
```

This is a control-flow and runtime benchmark, not a production-capacity proof.
It does not measure PostgreSQL `FOR UPDATE SKIP LOCKED` contention, connection
pool behavior, Cloud Run scheduling or autoscaling, sandbox/provider latency,
network behavior, or the API's concurrent HTTP/SSE path. Use a separate isolated
staging/database load test for those claims.
