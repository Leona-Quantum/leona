# Repository Step 5b-1 — pinned safe fetcher

Date: 2026-07-19
Branch: `feature/repository-step5b-plan`
State: first real-network slice implemented and locally validated

## User outcome

Majorana can retrieve one QASMBench OpenQASM file from an immutable upstream commit
without accepting an arbitrary URL. The retrieved bytes remain inert data: this slice
does not parse, execute, stage, publish, or write them to Neon.

## Security boundary

- connector: `qasmbench` only;
- upstream: `pnnl/QASMBench` at commit
  `357b942396d5c2b7cbc1c229c585a6ef5ccaebac`;
- transport: HTTPS port 443 only, no redirect;
- DNS: every A/AAAA result must be globally routable;
- connection: validated IP with `raw.githubusercontent.com` retained for TLS SNI;
- content: one `.qasm` file under `small/`, `medium/`, or `large/`;
- bounds: 10 seconds, 16 KiB headers, 64 KiB body;
- rejected: arbitrary hosts/repositories/refs, private/loopback/link-local addresses,
  redirects, compression, chunked transfer, archive magic, oversized or malformed
  responses, and path traversal.

The network-capable function returns bytes plus immutable source identity and SHA-256.
It contains no database, publication, QPU, cloud-provider, or signing credentials.

## Actual network result

The opt-in smoke test fetched:

```text
medium/ghz_state_n23/ghz_state_n23.qasm
bytes: 1154
sha256: 27e77c753e2993b3b4785872ec83d434dfac62cc526f4ee574347e6f5c8986ff
```

The file came from the pinned commit above and began with `OPENQASM 2.0;`. No source
code was executed. The resolved address is intentionally not treated as stable
metadata because GitHub's globally routed addresses may change; every fetch validates
and pins the addresses returned for that connection.

## Validation

- adversarial and policy tests with real-network opt-in: `19 passed`;
- the network smoke test is skipped unless `MAJORANA_RUN_NETWORK_TESTS=1`;
- no database or Neon connection was used;
- no feature flag was enabled and no public state changed.

## Next small slice

Add a private content-addressed quarantine write boundary and retrieval manifest, then
connect only this pinned QASMBench adapter to durable import items. Parsing remains a
separate deny-all sandbox step. Do not expand to repository clone, archive ingestion,
MQT Bench, the 285-record batch, or publication in the next slice.
