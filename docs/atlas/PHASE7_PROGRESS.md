# Atlas VQE Phase 7 — manual read-only GitHub metadata import

Date: 2026-07-27 JST  
Branch: `feature/vqe`  
State: **in progress; S0-S3 input, bounded client, and immutable snapshot
boundary implemented; live network, persistence, and publication not
enabled**

## 1. Claim and capability boundary

Phase 7 accepts one operator-supplied public GitHub repository URL, an optional
ref, and optional paper identifiers. It is metadata-only.

The phase does not:

- clone or execute repository code;
- install repository dependencies;
- accept private repositories;
- accept arbitrary hosts or API base URLs;
- follow user-selected redirects;
- expand archives, submodules, Git LFS, or symlinks;
- publish an Artifact or assign a verified/official badge;
- infer missing VQE facts as known values.

## 2. Current slices

| Slice | Outcome | Status |
|---|---|---|
| S0 | Phase 6 handoff, threat/rights boundary, official API review | complete |
| S1 | Pure GitHub coordinate parser and bounded metadata selection | implemented |
| S2 | Recorded-response GitHub REST client; no live credentials | implemented |
| S3 | Immutable commit/tree retrieval manifest and stable failures | implemented |
| S4 | Durable importer provider and idempotency integration | pending |
| S5 | License/citation/dependency fact extraction as assertions | pending |
| S6 | Phase 2 corpus reconciliation and negative fixtures | pending |
| S7 | Disposable-Neon operator E2E and rollback | pending |

No later slice is considered complete merely because S1 accepts a URL.

## 3. S0 official-source decisions

GitHub currently supports REST API versions `2026-03-10` and `2022-11-28`;
the latter remains supported until 2028-03-10. Phase 7 pins `2026-03-10`, as
specified by the master plan. Parser fixtures and request-header tests make
that response contract explicit rather than following GitHub's default
version implicitly.

Primary sources:

- [GitHub REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)
- [Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)
- [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit)
- [Get a Git tree](https://docs.github.com/en/rest/git/trees#get-a-tree)
- [Repository contents](https://docs.github.com/en/rest/repos/contents)
- [GitHub App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [REST API rate-limit behavior](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#rate-limit-errors)

The Git tree endpoint can return `truncated: true` and documents a recursive
limit of 100,000 entries / 7 MB. A truncated result is not treated as a
complete repository manifest. S1 fails closed and a later slice may implement
bounded non-recursive traversal.

Public resources can be read without a token, but the eventual product
connector should use a read-only GitHub App with Metadata read and Contents
read. Credentials must exist only in the fetch boundary, never in the parser,
runtime, browser, evidence, or Neon record.

## 4. S1 implemented boundary

`services/api/src/majorana_api/github_coordinates.py` now:

1. accepts only `https://github.com/<owner>/<repository>`;
2. strips only an optional terminal `.git`;
3. rejects credentials, ports, query, fragment, and deeper paths;
4. constructs the API path from validated components rather than accepting an
   API URL;
5. percent-encodes an optional ref as one path value;
6. rejects truncated or malformed tree manifests;
7. selects only root dependency/citation/license metadata and GitHub workflow
   YAML;
8. excludes ordinary source code, directories, submodules, and symlinks;
9. enforces file-count, per-file byte, and total-byte limits;
10. records oversized eligible paths as skipped instead of downloading them.

This module is pure: no network, database, filesystem, clock, credential, or
publication access.

## 5. Security gate before S2/S3 live network

ADR-0017 remains the governing threat boundary. A recorded-response client can
be implemented and tested next, but live network enablement requires all of:

- hardcoded `api.github.com:443`;
- no arbitrary proxy or environment credential inheritance;
- explicit connect/read/total timeouts and response byte caps;
- bounded serial requests;
- stable handling of 403/404/409/422/429 and rate-limit headers;
- redirect policy that cannot escape the GitHub API authority;
- no request-time parsing, execution, DB publication, or dynamic install;
- logs that omit authorization headers and URL queries;
- malicious/adversarial fixtures passing before credentials are introduced.

S2 now implements the non-live portion of this gate in
`services/api/src/majorana_api/github_client.py`:

- hardcoded `https://api.github.com`;
- caller cannot supply a base URL or arbitrary endpoint;
- `trust_env=False`, so proxy and environment authentication are not inherited;
- redirects are rejected;
- connect/read/write/pool timeouts are explicit;
- requests are serialized;
- `Accept-Encoding: identity` plus a decoded response-byte cap;
- duplicate JSON keys and non-object top-level JSON are rejected;
- rate-limit headers are parsed without persisting response bodies;
- stable failure codes distinguish timeout, transport, rate limit, not found,
  conflict, invalid coordinate, forbidden, oversized, malformed, and upstream
  failure;
- object-digest endpoints accept only validated 40/64-character lowercase hex.

The tests use `httpx.MockTransport`; no GitHub token or live network is used.
S2 therefore qualifies the client contract, not GitHub availability or a
credentialed GitHub App.

## 6. S3 immutable snapshot boundary

`services/api/src/majorana_api/github_snapshot.py` composes only the bounded
S1 coordinate/manifest policy and S2 REST client. It:

- verifies the numeric repository identity, canonical repository URL, and
  public visibility before retrieving content;
- resolves the requested ref or default branch to an immutable commit SHA and
  tree SHA;
- fails closed when the returned tree identity differs or the tree is
  truncated, malformed, duplicated, or outside the fixed budget;
- verifies every selected blob's identity, reported size, decoded byte size,
  and Git object digest;
- records independent SHA-256 digests for source bytes, the full inspected tree
  manifest, and the selected metadata manifest;
- emits an audit manifest without embedding third-party source bytes.

All S1-S3 tests use recorded `httpx.MockTransport` responses. Passing them
demonstrates deterministic boundary behavior, not live GitHub availability,
GitHub App permission correctness, or durable database recovery.

Verification on 2026-07-27:

```text
Phase 7 focused tests: 43 passed
Repository Python suite: 1168 passed, 81 skipped, 4 upstream warnings
Ruff lint: passed
Ruff format check: 299 files already formatted
```

The four warnings are PennyLane deprecation warnings in pre-existing framework
tests; Phase 7 does not suppress or reinterpret them.

## 7. Academic integrity gate

Retrieved data produces assertions with source locators, not verified facts.
Repository metadata, detected license, dependency files, and paper relations
must keep separate evidence and confidence states. `unknown`, `not_reported`,
`conflicting`, and `unreadable_due_to_limit` are preserved. Phase 2 corpus
records are a reconciliation set, not automatically a human gold standard.

## 8. Rollback

S1 rollback is code-only: remove the pure parser and tests. Once durable import
begins, rollback disables provider creation and drains/cancels its jobs while
retaining private staged evidence for audit. It never deletes or publishes
records to hide a failed import.
