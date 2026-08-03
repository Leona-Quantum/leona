# Phase 10 S2 — Acquisition boundary preflight

Date: 2026-08-03 JST  
Status: **partial preflight — Phase 10 live acquisition is disabled**  
Depends on: S0 owner decision and accepted S1 threat model

## 1. Outcome

The existing GitHub metadata client was audited before adding a Phase 10
fetcher. Its narrow request and snapshot rules are useful, but it was possible
to construct the client without a recorded transport and thereby use the live
network without an explicit mode at the constructor boundary.

This was not an API endpoint or an external-source executor path. It was used
by two owner-operated Phase 8/9 scripts for approved official-provider metadata
dry runs. Nevertheless, implicit live-network authority is unsafe to carry
forward into Phase 10.

The client is now fail-closed:

```text
default                          recorded_only
recorded_only + no transport     live_network_not_authorized
recorded_only + credential       credential_not_allowed_in_recorded_mode
live mode + test transport       invalid_network_mode
```

The only explicit live mode is:

```text
LIVE_OFFICIAL_PROVIDER_METADATA
```

It labels the already existing Phase 8/9 operator lane. It is not Phase 10
qualification and must not be used in an API request handler or executor.

## 2. What is proven

- unit and recorded-response callers cannot silently fall through to the
  network;
- credentials cannot enter recorded-mode tests;
- the two existing live operator scripts declare their network authority at
  the call site;
- the fixed GitHub origin, no-redirect, no-environment-proxy, bounded JSON and
  immutable snapshot tests still pass.

## 3. What is not proven

- there is no separately deployed Phase 10 fetcher identity;
- the live client does not yet validate and pin every A/AAAA answer;
- source bytes are not written to a private content-addressed quarantine;
- source-file selection beyond the metadata allowlist is not approved;
- no Phase 10 live fetch, arbitrary repository fetch, archive, clone,
  submodule, LFS or execution was performed;
- an explicit enum is an audit/control aid, not a security boundary against
  arbitrary Python code in the same trusted process.

## 4. Tests

Targeted validation after the change:

```text
GitHub client and snapshot
Phase 8 provider dry-run helpers
Phase 9 private dry-run helpers
Phase 10 threat-model validator
```

The new constructor tests verify the three fail-closed cases above. Normal CI
continues to use inert `httpx.MockTransport` fixtures and performs no new
external fetch.

## 5. S2 exit status

S2 is **not complete**. The next permitted network work is a design and
recorded-response implementation of destination classification. The selected-
file retrieval-manifest contract is now implemented as the pure, offline
`phase10_retrieval_manifest` module. It:

- accepts only an immutable 40- or 64-hex commit identity;
- canonicalizes and bounds selected UTF-8 text files;
- records path, media type, length, SHA-256, fetcher/policy versions, and a UTC
  retrieval timestamp;
- rejects traversal, duplicate/noncanonical paths, binary/unsupported media,
  mutable refs, unsupported versions, and over-limit input;
- supports round-trip manifest verification and later byte-level length/digest
  verification;
- contains no network, database, filesystem, parser, import, publish, or
  execution operation.

This contract is evidence plumbing only. It is not a connector, and it does
not make the current metadata client a Phase 10 fetcher. Live deployment
remains blocked until:

1. S0/S1 are accepted;
2. a separate fetcher workload identity and route are selected;
3. DNS validation/connection pinning passes hostile tests;
4. quarantine and credential-separation decisions are approved;
5. the retrieval manifest is wired to an approved connector and the private
   quarantine round trip is independently verified.
