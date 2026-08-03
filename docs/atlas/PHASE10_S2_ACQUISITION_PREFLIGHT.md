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

## 3. Offline destination policy

The pure `phase10_destination_policy` module now provides the testable policy
boundary for already-resolved A/AAAA answers. It requires the exact server-
built `api.github.com:443` destination, rejects the complete answer set if any
answer is non-global or ambiguous, canonicalizes and bounds the remaining set,
and allows a peer only when it matches that set within a 60-second validity
window. Tests include loopback, RFC1918, link-local/metadata, shared, multicast,
documentation/reserved, unique-local, scoped, bracketed, IPv4-mapped, mixed-
answer, IPv6 transition/translation, duplicate, over-limit, peer-substitution,
and expiry cases.

This policy still performs no DNS or socket operation. It does not prove that a
runtime transport connects to the approved IP while retaining
`api.github.com` for TLS SNI, certificate, and Host validation.

## 4. What is not proven

- there is no separately deployed Phase 10 fetcher identity;
- the live client does not yet validate and pin every A/AAAA answer;
- source bytes are not written to a private content-addressed quarantine;
- source-file selection beyond the metadata allowlist is not approved;
- no Phase 10 live fetch, arbitrary repository fetch, archive, clone,
  submodule, LFS or execution was performed;
- an explicit enum is an audit/control aid, not a security boundary against
  arbitrary Python code in the same trusted process.

## 5. Offline acquisition authorization contract

The pure `phase10_acquisition_contract` module now closes the request-shape
gap between source intent, destination evidence, and retrieval evidence. A
request can contain only:

```text
known repository id and full name
immutable 40/64-hex commit
bounded canonical selected paths
canonical UTC request time
fixed connector / operation / policy identifiers
```

It cannot carry a URL, header, credential, proxy, redirect, port, command, or
entrypoint. The source host and port are always `api.github.com:443`, and the
only declared operation is selected repository content at the exact commit.
The canonical request is SHA-256 bound.

A separate authorization object binds that request to the short-lived,
validated destination evidence. A later retrieval manifest is accepted only
when repository id, repository name, commit, complete selected-path set, and
time window match exactly. Both direct construction and serialized round trips
are fail-closed; unknown fields and self-consistent attempts to change the
connector, operation, host, or port are rejected.

This does not perform DNS, network, TLS, filesystem, database, quarantine, or
replay-state operations. A production connector must enforce one-time job
state and connection pinning outside this pure contract.

## 6. Offline GitHub REST request plan

The pure `phase10_github_request_plan` module compiles an approved
authorization into one deterministic `GET` per selected file. GitHub's
[official repository-contents API documentation](https://docs.github.com/en/rest/repos/contents#get-repository-content)
was rechecked on 2026-08-03 before fixing this contract. The documented route
is `GET /repos/{owner}/{repo}/contents/{path}`, and `ref` selects the exact
commit/branch/tag. Atlas supplies only the already validated immutable commit.

The plan fixes:

```text
method                 GET
route                  /repos/{owner}/{repo}/contents/{encoded path}
query                  ref=<immutable commit>
Accept                 application/vnd.github.object+json
X-GitHub-Api-Version   2026-03-10
Accept-Encoding        identity
redirects              false
response byte limit    512 KiB
```

The object media type is intentional. GitHub documents that the raw media type
can return a symlink target's contents; the later response validator must first
prove that the response represents an ordinary file and reject directories,
symlinks, and submodules. This request-plan stage does not yet parse or trust a
response.

Paths are encoded segment by segment, so spaces, Unicode, `?`, and `#` cannot
become query/fragment syntax. The complete plan, including the acquisition and
destination evidence, is SHA-256 bound and rejects even self-consistently
rehashed changes to the method, route, query, headers, redirect policy, or
limit. Workload credentials are deliberately absent from the plan.

## 7. Tests

Targeted validation after the change:

```text
GitHub client and snapshot
Phase 8 provider dry-run helpers
Phase 9 private dry-run helpers
Phase 10 threat-model validator
```

The new tests verify the fail-closed client modes, hostile destination classes,
canonical request/authorization round trips, transport-field injection,
digest tampering, mutable refs, unsafe/duplicate paths, repository/commit/path
substitution, pre-request evidence, and expired DNS evidence. Normal CI uses
inert fixtures and performs no new external fetch.

## 8. S2 exit status

S2 is **not complete**. The selected-file retrieval-manifest contract is now
implemented as the pure, offline
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

The retrieval, acquisition, and request-plan contracts are evidence plumbing
only. They are not a connector, and they do not make the current metadata
client a Phase 10 fetcher. Live deployment remains blocked until:

1. S0/S1 are accepted;
2. a separate fetcher workload identity and route are selected;
3. the approved runtime transport demonstrably connects to a validated answer
   while retaining the fixed TLS identity, and live hostile probes pass;
4. quarantine and credential-separation decisions are approved;
5. the retrieval manifest is wired to an approved connector and the private
   quarantine round trip is independently verified.
