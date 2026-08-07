# Sandbox egress + hostile payloads against the real provider — the run, 2026-08-07

The evidence for the two remaining sandbox boxes in `plans/rebuild/05-security.md` §2:

> - [ ] Hostile-payload suite green in CI against the real sandbox provider — **not run.**
>   The deny-all egress policy and empty env are asserted in CI against the *call*, not
>   against a live provider
> - [ ] Sandbox egress: canary-URL exfil attempt provably blocked (test artifact attached) —
>   **not run.** Needs Vercel credentials; owner item

Both have now been run. Harness: `packages/py/sandbox/tests/test_sandbox_egress_live.py`,
driven by `scripts/run-sandbox-egress-gate.sh`. Both are in the repository and the run is
repeatable; this file records one execution and what it does and does not establish.

## What was run

| | |
|---|---|
| date | 2026-08-07 |
| provider | **Vercel Sandbox**, real Firecracker microVMs — not the local double |
| image | `majorana-runner:latest` (`environment_id: vercel:majorana-runner`) |
| project / team | `prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh` / `team_DRpA2jUgcqzPCQ24jjjOLN0O` |
| credentials | `VERCEL_TOKEN` from GCP Secret Manager (`majorana-core`); IDs read off the running `majorana-worker` service |
| canary sink | `majorana-api` Cloud Run request log, queried through `gcloud logging read` |
| result | **5 passed in 46.84s** |

The provider identity is read off the live worker at run time rather than hardcoded in the
script, on the same principle as `run-abuse.sh` grepping the real rate-limit defaults: a gate
run against a project production no longer uses proves nothing about production.

## The guard is bypassed on purpose

Every test calls `sandbox._execute(spec)`, not `run(sandbox, spec)`. The static guard is
layer 1 and would reject all six payloads below before a microVM existed. Testing through
`run` would therefore only ever re-prove that layer 1 works. **Defense in depth has to be
tested one layer at a time with the others defeated**, or the only thing ever established is
that the outermost layer is present.

## Result: six egress vectors, all refused

Raw probe output from inside the microVM:

```json
{
  "urllib":      "URLError: <urlopen error [Errno -3] Temporary failure in name resolution>",
  "dns":         "gaierror: [Errno -3] Temporary failure in name resolution",
  "tcp_canary":  "gaierror: [Errno -3] Temporary failure in name resolution",
  "tcp_bare_ip": "OSError: [Errno 113] No route to host",
  "tcp_gateway": "OSError: [Errno 113] No route to host",
  "curl":        "FileNotFoundError: [Errno 2] No such file or directory: 'curl'"
}
```

The vectors are chosen so that no single mechanism explains all of them:

- **`tcp_bare_ip` is the one that matters most.** `1.1.1.1:443` needs no DNS at all, so
  "No route to host" rules out the comfortable misreading that egress is merely
  *unresolvable* rather than *blocked*. A DNS-only block would have let this through.
- **`tcp_gateway`** targets `100.64.0.1`, the default gateway the guest's own routing table
  names (`/proc/net/route`: `eth0 00000000 01004064`). Even the gateway is unreachable, so
  there is nothing to forward through.
- **DNS is dead by unreachability, not by policy.** `/etc/resolv.conf` says
  `nameserver 172.31.0.2`; that address is `No route to host` over TCP and times out over
  UDP. The name-resolution failures above are a *consequence* of the egress block.
- **`curl` is absent from the image**, so the subprocess vector is moot here. Recorded rather
  than celebrated: it is an artifact of a minimal image, not a control we assert.

### And the canary recorded nothing

The client-side exceptions above are only half the proof — a request can fail on the client
*after* being received. So the sink was asked directly:

```
exfil nonce   canary-exfil-0c3461e90c82493c        → 0 rows
```

## Three controls, because "it was blocked" is the easiest result to fake

A sandbox that never starts — wrong token, missing image, exhausted quota — fails every
hostile payload, and a suite that only asserts failure passes brilliantly while proving
nothing.

**1. The provider is live.** `test_provider_is_live` runs benign code and reads its stdout
back: `hello from the microVM`, exit 0, 3.3 s. Without this every "blocked" above is
uninterpretable rather than reassuring.

**2. The sink records a request that does arrive.**

```
control nonce  canary-control-19b455c3a7a14f1b     → 1 row, 2026-08-07T02:17:26.515693Z
```

Same query shape, same time window. This is what makes zero rows mean *blocked* rather than
*the query is wrong*.

**3. The sink records the payload's exact URL shape.** The control above sends
`?canary=<nonce>`; the payload sends `?canary=<nonce>-urllib&leak=fake-secret-ABCDEF`. A
detector that matched the first and not the second would be blind to the thing it exists to
catch, so that exact shape was sent from a networked host and looked for:

```
2026-08-07T02:28:05.426303Z
  https://majorana-api-…/health?canary=canary-negctl-3ba9a9ed6d9248d9-urllib&leak=fake-secret-ABCDEF
```

Found ~10 s after sending.

## The first version of this gate passed for the wrong reason

Worth recording, because it is the failure mode this class of test is most prone to.

The initial suite queried the log immediately after the sandbox run. `test_exfil_...` **passed**
— and would have passed identically with egress wide open, because Cloud Logging ingestion is
asynchronous and *nothing* had been ingested yet. What exposed it was control 2 **failing**:
the request that definitely succeeded also showed zero rows.

The fix is an ordering argument rather than a longer sleep. After the sandbox has finished
trying, the test sends a *tracer* request from the host and blocks until it appears. The
tracer landing proves the log has ingested past a moment strictly later than any request the
sandbox could have made; only then is the exfil nonce's absence read. An absence measured too
early is indistinguishable from an absence that means something.

## Also established

**The sandbox environment carries no credentials.** Enumerated from inside: the only
credential-shaped variable is `GPG_KEY`, the Python release signing key baked into the
upstream `python` image. Asserted by exact name rather than filtered by pattern, so a second
one fails the test instead of being absorbed by the exception.

## One finding: 169.254.169.254 answers, and carries nothing

Found by running the gate rather than assumed, and **not** rounded up into the tick above.

Every address tested is `No route to host` except one. The link-local metadata address
accepts TCP on port 80 and is served by `Server: Firecracker API` — the microVM's own MMDS,
in **V2 session-token mode** (`401: No MMDS token provided`).

MMDSv2's session-token requirement exists to defeat SSRF, which cannot easily issue a `PUT`
with a custom header. **Code running natively inside the guest can**, and does: the probe
minted a 48-character token on the first attempt.

With that token, the store is empty:

| path | response |
|---|---|
| `/` | **200, zero-length body** |
| `/latest/meta-data` | 404 |
| `/latest/meta-data/iam/security-credentials/` | 404 |
| `/latest/user-data` | 404 |

So there is nothing to steal, and this is not a hole in the deny-all policy — MMDS is not
egress, it is the hypervisor talking to its own guest, and it never leaves the host.

**But the emptiness is Vercel's configuration choice, not ours, and nothing on our side would
notice it changing.** `test_mmds_carries_nothing` is where we would find out: it asserts the
200-with-empty-body and the three 404s, and fails the moment MMDS starts serving content —
which is the moment it becomes a credential surface reachable by untrusted code. That is the
honest shape of this result: a dependency on someone else's default, pinned by a test rather
than trusted.

## What this run does NOT establish

Written out rather than rounded up, on the pattern the k6 artifact set.

- **It is not run in CI.** The suite is `skipif`-gated on `VERCEL_TOKEN`, so the `py` job
  collects, imports and lint-checks it and then skips execution. Every run costs real
  sandbox time against a paid provider, and putting the production Vercel token into GitHub
  Actions to make a checkbox green is a worse trade than running it by hand before a release.
  The §2 box is therefore ticked as **run against the real provider**, not as *green in CI* —
  the original wording asked for the latter and this is deliberately not claiming it.
- **It does not test the runtime caps against the real provider.** The timeout and memory
  kills are still asserted against the local double in `test_hostile_payloads.py`. The real
  boundary is the microVM and Vercel enforces the cap itself; that is an argument for why it
  is lower risk, not evidence that it was checked here.
- **It is one image, one region, one moment.** `majorana-runner:latest` moved by hand
  (`docs/runbooks/sandbox-image.md`), and a future image could ship `curl`, which would make
  vector 6 meaningful rather than moot. Re-run the gate when the image is promoted.
- **It says nothing about what the guard lets through.** Layer 1 is deliberately bypassed
  here. `test_hostile_payloads.py` remains the file that tests it.

## Re-running

```bash
./scripts/run-sandbox-egress-gate.sh
```

Reads `VERCEL_TOKEN` from Secret Manager and the project/team IDs off `majorana-worker`; the
token is piped straight into the child process and never echoed, written to disk, or passed
on a command line. Takes ~50 s and creates six short-lived microVMs.
