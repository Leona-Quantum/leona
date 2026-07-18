# Repository Step 5b — SSRF-hardened fetcher and credential-separated runner

Date: 2026-07-18
Branch: `feature/repository-step5b` (stacked on `feature/repository`, PR #64)
State: core fetch infrastructure implemented and tested; **no real connector is wired
yet**; ADR-0017 security review still pending (see below)

## ⚠️ ADR-0017 approval status

`docs/adr/0017-catalog-ingestion-threat-boundary.md` is **`proposed`** and requires
Ryu/Eshaan security review. This slice implements the architecture that ADR describes,
with the owner's explicit instruction to proceed ahead of approval (2026-07-18 session).
**Merging this branch requires the security review to complete first.** A ready-to-send
review request is at the bottom of this document.

## What this slice contains

Two modules and their adversarial test suites. No import-pipeline wiring, no real
upstream host is contacted anywhere, and nothing changes for the Step 5a
local-fixture path.

### `majorana_api.catalog_fetch` — the bounded fetcher

- HTTPS only; host must be in the policy's explicit `allowed_hosts` frozenset (never a
  wildcard, never caller input); port must match the policy's single allowed port.
- **DNS-rebinding defense**: the hostname is resolved and every candidate address is
  validated *inside the transport's `connect_tcp`*, then the TCP connection is opened
  directly to the one validated IP. httpcore/anyio never re-resolve the name, so the
  answer cannot be swapped between check and connect. TLS SNI and certificate
  verification still use the original hostname (httpcore passes `server_hostname` from
  the request origin, verified against httpcore 1.0.9 source), so pinning the TCP
  target does not weaken certificate validation.
- Rejected address ranges: loopback, private, link-local, multicast, reserved,
  unspecified — including IPv4-mapped IPv6 forms (`::ffff:169.254.169.254` is caught).
- Redirects (3xx) are rejected outright, per ADR-0017's initial release rule.
- Responses are streamed and cut off at `max_bytes` (default 8 MiB); the whole fetch is
  bounded by `timeout_s` (default 15 s).
- Blocked destinations are logged as `catalog_fetch blocked: <kind> host=<host>` —
  rejection kind and host only, never the full URL, whose path/query could carry
  tokens (ADR-0017 observability rule).
- Implementation note: httpx's public `AsyncHTTPTransport` constructor exposes no
  `network_backend` parameter, so the transport's underlying
  `httpcore.AsyncConnectionPool` is replaced with one built on the SSRF-safe backend.
  Verified against httpx 0.28.1 / httpcore 1.0.9 (`_connect` in
  `httpcore/_sync/connection.py` builds `connect_tcp` kwargs from the origin and takes
  `server_hostname` from the request, not from the stream). If a future httpx changes
  this shape, fetches fail loudly — including the test suite's happy path — rather than
  silently bypassing validation.

### `majorana_api.catalog_fetch_runner` — the credential-separated runner

ADR-0017's core split, realized at the process boundary:

- The worker (holding `DATABASE_URL`, catalog authority config, API keys) **never
  fetches**. It spawns this module as a short-lived child whose environment is rebuilt
  from an allowlist (`PATH`, `HOME`, locale vars, `SSL_CERT_FILE`/`SSL_CERT_DIR`,
  plus a constructed `PYTHONPATH`). `DATABASE_URL` and every other parent variable
  are absent — proven by a test that spawns a real child with the parent's
  `DATABASE_URL` set and observes it missing.
- The fetch spec travels over **stdin, not argv**, so URLs never appear in the host's
  process list.
- The child writes raw bytes to a parent-chosen quarantine path and reports a JSON
  manifest (status, content type, sha256, byte count) on stdout. The parent **re-hashes
  the file on pickup** and rejects any manifest/file mismatch — the credentialed side
  never trusts the network-facing side's claims.
- Deterministic rejections come back as stable failure codes
  (`blocked_address`, `redirect_rejected`, `response_too_large`, `fetch_timeout`,
  `connection_error`, …) ready to map onto Step 5a's import-item failure codes when
  the wiring slice lands. Runner-level failures (`runner_timeout`, `runner_crashed`,
  `manifest_mismatch`) are distinguishable from fetch-level ones.
- Same spawn pattern as `packages/py/sandbox/local.py`, applied to the inverse
  problem: the sandbox child may compute but not freely reach the network; the fetch
  child may reach the network (within policy) but must know nothing.

## Validation

- 30 tests, all local (a self-signed-cert mock HTTPS server on loopback; no real
  external host is ever contacted):
  - address-classifier unit matrix (loopback/private/link-local/metadata-service/
    multicast/reserved/unspecified, v4+v6+v4-mapped-v6; public addresses allowed);
  - happy path, redirect rejection, oversized cutoff, timeout, unlisted host, wrong
    port, non-HTTPS scheme, connection refused;
  - **production-mode loopback rejection with a live server listening** — proves the
    real connect-time gate fires, not a mocked check;
  - runner: env-allowlist strips credentials (dict-level and real-spawn-level),
    subprocess happy path with parent `DATABASE_URL` set, blocked-address /
    oversized / redirect outcomes surface as stable codes with no quarantine file
    left behind.
- Ruff check/format, import-linter (3 kept / 0 broken), raw-query gate: clean.
  `openapi.json` untouched (no contract change in this slice).

## Deliberately still missing (needs the information below before wiring)

1. **QASMBench connector**: exact GitHub org/repo, pinned commit SHA, and file-path
   scope. ADR-0017 requires individual bounded file retrieval from an immutable ref —
   the allowlist entries must be verified against the real repository, not guessed.
2. **MQT Bench connector**: whether the generator package is installed into the
   reviewed image (ADR-0017 forbids dynamic installation), its exact version pin, and
   its sandbox execution profile.
3. **285-record bootstrap**: source data lives in
   `apps/web/lib/repository/entries-literature-expansion.ts` (an `apps/web` file this
   work does not touch); extracting it into a pinned, checksummed manifest needs an
   agreed read-only extraction step.
4. Import-pipeline wiring (`ImportProvider` addition, worker use of the runner,
   quarantine-store lifecycle) — follows in this branch once 1–3 are resolved.

## Security review request (ready to send to Eshaan / Ryu)

> **Subject: Security review — ADR-0017 + catalog fetcher implementation (PR: feature/repository-step5b)**
>
> ADR-0017 (catalog ingestion threat boundary) is still `proposed` and gates this
> work. The implementation now exists and follows the ADR as written; owner approved
> starting ahead of review, and merge is blocked on your sign-off. Please review:
>
> 1. **ADR-0017 itself** — accept, or amend and we re-align the code.
> 2. **Address-range policy** (`catalog_fetch._is_disallowed_address`): loopback,
>    private, link-local, multicast, reserved, unspecified, v4-mapped-v6. Anything
>    missing you'd want blocked (e.g. NAT64 64:ff9b::/96)?
> 3. **DNS-rebinding approach**: resolve+validate inside `connect_tcp`, connect to the
>    validated IP, SNI/cert verification kept on the hostname. Note this relies on
>    replacing httpx's private `_pool` attribute (documented, verified against httpx
>    0.28.1) — acceptable, or do you want a pinned httpx version in pyproject?
> 4. **Default limits**: 8 MiB per fetch, 15 s timeout, redirects rejected outright,
>    port 443 only. Per ADR these are reviewed configuration — confirm or set values.
> 5. **Credential separation**: child-process env allowlist (`catalog_fetch_runner`)
>    instead of a separately deployed fetcher service. The child holds no DB/API
>    credentials (test-proven) but does share the host filesystem with the worker —
>    sufficient for the initial release, or do you require stronger isolation before
>    any real host is allowlisted?
> 6. **Quarantine store**: currently a worker-local directory with sha256 pickup
>    verification. ADR says storage implementation "must be approved during the
>    importer slice" — this is that request.
>
> Nothing fetches from a real host yet; connector allowlists (QASMBench repo/commit,
> MQT Bench package pin) will come as a separate, small follow-up once you've ruled
> on the above.

## Rollback

This slice is inert until a connector and pipeline wiring exist: no job kind invokes
the runner, no allowlist contains a real host, and deleting the two modules restores
the exact Step 5a surface.
