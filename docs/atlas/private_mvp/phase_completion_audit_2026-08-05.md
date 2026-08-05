# Private Component-First VQE MVP completion audit — 2026-08-05

## Decision

| Boundary | Decision | Evidence |
|---|---|---|
| Deterministic local/offline implementation | **GO** | manifest/catalog checks, scientific/API contracts, full Python and web regressions, production build, synthetic authenticated browser journey |
| Release-candidate freeze | **CONDITIONAL** | changes are not yet committed/pushed and current remote CI does not include this working tree |
| Digest-pinned private CI Golden Journey | **NOT_RUN — GO判定不可** | required disposable database, Registry Workflow ID, dedicated runtime-host marker, and operator enable flag were absent |
| Live WorkOS same-account logout/login/reopen | **NOT_RUN — GO判定不可** | no new committed live-staging evidence was produced |
| Public execution, publication, external repository execution, or superiority claim | **BLOCKED** | Capability Manifest and API/UI claim boundaries remain fail-closed |

This audit qualifies implementation coherence only. It is not an independent
scientific review and does not establish optimizer, ansatz, or provider
superiority.

## Scope frozen for this phase

The primary Golden Journey is:

```text
H2 / STO-3G
→ Fixed Excitation
→ SLSQP
→ exact statevector
→ Qiskit and PennyLane private candidates
→ change exactly parameter_optimizer to COBYLA
→ execute both sides
→ server-recomputed controlled comparison
→ private save
→ reopen
```

UCCSD is a secondary capability smoke journey. Hardware-Efficient RY–CX is a
capability migration, not a one-component controlled comparison.

## Dev reconciliation

Remote references were refreshed immediately before this audit.

```text
origin/dev:         78926da581ab80e94a64427a2e3be8e8d5a01a51
local HEAD:         b5e7629d0aa23b1cdb90ebb6c0b5c8962344e329
origin/dev...HEAD:  0 behind / 184 ahead
origin/feature/vqe: d711a578546b9270ad154404ec1da0a1cb2eb685
remote feature gap: 0 behind / 27 ahead before this working-tree commit
```

Therefore the latest fetched `origin/dev` is an ancestor of the current
feature branch. This does not mean the uncommitted working tree has CI
evidence; it must be committed and pushed before an RC freeze.

## Automated evidence

| Command | Result |
|---|---|
| `pnpm atlas:vqe:mvp-gate --mode=offline` | **GO**; manifest and catalog current, 58 scientific/API tests passed, typecheck passed, 26 web contract tests passed |
| `uv run pytest -q` | **2770 passed, 422 skipped** |
| `pnpm --filter @majorana/web test` | **597 passed, 0 skipped** |
| `pnpm typecheck` | **passed** |
| `pnpm lint` | **passed** |
| `uv run ruff check .` | **passed** |
| `uv run ruff format --check .` | **532 files formatted** |
| `uv run lint-imports` | **5 contracts kept, 0 broken** |
| `uv run python scripts/check_raw_queries.py` | **clean** |
| `pnpm build` | **passed**, 338 routes generated |
| `node scripts/check-client-bundle-secrets.mjs --self-test` | **passed**, all credential and public-variable detectors proved active |
| `node scripts/check-client-bundle-secrets.mjs --dist apps/web/.next` | **clean**, 377 browser-served files scanned |
| `pnpm exec playwright test --config=playwright.vqe.config.ts` | **5 passed**, including fixed-excitation SLSQP → COBYLA save/compare/reopen |
| `pnpm atlas:vqe:mvp-gate --mode=private-e2e` | **NOT_RUN — GO判定不可**, exit 2 as designed |

The 422 Python skips are not counted as qualification evidence. The dedicated
private-E2E gate also refuses to translate missing operator prerequisites into
a successful skip.

## Defects detected and resolved during the gate

1. The Studio lost the immutable baseline experiment ID when reopening a saved
   optimizer-swap workflow. The baseline is now carried through reopen and
   experiment creation, and the complete browser journey exercises it.
2. The browser mock selected the ansatz by binding array position. It now finds
   the binding by scientific role, preventing order-dependent false evidence.
3. Stale button labels described qualified private candidates as local. The
   action is now consistently `Run private candidate`.
4. A root-level pytest run failed because the OpenQASM and VQE packages both
   exposed `test_portable` as a top-level module. The VQE suite now has a unique
   basename, preserving existing local test imports while allowing the complete
   workspace regression to collect.
5. An attempted `turbopack.root` warning suppression passed production build
   but changed CSS resolution under the development server. It was reverted;
   functionality takes precedence over suppressing a non-blocking warning.
6. Invoking Playwright without `playwright.vqe.config.ts` cannot resolve the
   relative Studio URL. The audited command now names the dedicated config
   explicitly; the incorrect invocation is not counted as test evidence.
7. The authenticated browser mock returned a simplified flat metric payload
   that did not match the production API's nested execution summaries. The
   client parser and mock now share the production-shaped contract, and tests
   reject the obsolete flat shape and inconsistent comparability status.
8. The client accepted nested metric evidence without proving that it belonged
   to the baseline and candidate execution UUIDs named by the controlled run,
   or that resource metrics used the comparison's frozen metric protocol. The
   strict parser now cross-checks both identities and both protocol digests.
9. A failed strict reopen could be followed by an unconditional success message
   and navigation. Reopen admission now returns an explicit boolean, and create
   or finalize flows proceed only after strict validation succeeds.
10. The browser test waited on a baseline query parameter that already existed
    before the candidate action, allowing a navigation race. It now waits
    atomically for both the newly created candidate and immutable baseline IDs.

## Scientific integrity checks

- Comparison admission recomputes immutable experiment identities and accepts
  only one changed role: `parameter_optimizer`.
- Problem, representation, state, ansatz, measurement, evaluation, stopping,
  compilation/resource protocol, and framework are invariant.
- Qiskit and PennyLane observations remain separate execution records.
- CNOT and depth remain canonical ansatz-only decomposition metrics; they do
  not silently include reference-state preparation, measurement, routing, or
  hardware optimization.
- Server comparison resources explicitly remain `visibility=private` and
  `publication=blocked`; the client rejects weaker or malformed responses.
- Numerical comparison metrics are rendered only after the server reports
  `comparable` and every controlled invariant passes. A failed or incomplete
  audit cannot be presented as a valid scientific comparison.
- Every nested metric summary must identify the exact baseline or candidate
  execution named by the run, and every resource summary must use the metric
  protocol digest frozen in the comparison specification.
- Wall-clock time is retained only as supplementary operational evidence. It is
  not used to judge the controlled optimizer comparison because host load and
  runtime placement are not fixed by the scientific protocol.
- Inventory counts remain descriptive inventory, never qualification KPIs.

## Engineering integrity checks

- Unknown components, ambiguous Registry resolution, incompatible swaps,
  malformed execution evidence, and hidden multi-role changes fail closed.
- Workflow scientific identity is persisted before framework-specific
  executions are created.
- Idempotency conflict, tenant boundary, immutable digest, deny-all runtime,
  failed execution, private materialization, and reopen boundaries are covered
  by the referenced contract and E2E suites.
- The Capability Manifest remains the committed status authority; UI wording
  does not infer qualification from catalog presence.
- Browser test artifacts are not retained in the working tree.

## Known non-blocking platform debt

- Next.js 16 warns that `middleware.ts` is deprecated in favor of `proxy.ts`.
  This is a CODEOWNERS blast-radius authentication file and requires a separate
  auth regression/migration change, not a silent rename inside the VQE phase.
- Local Next.js may infer `/Users/rei` as the Turbopack root because an unrelated
  parent `package-lock.json` exists. Explicitly overriding the root broke the
  current development CSS import path and was reverted. The build and dedicated
  browser suite pass with the existing configuration.

## Remaining operator actions before RC GO

1. Commit the reviewed working tree and push `feature/vqe`.
2. Run the private E2E gate on disposable PostgreSQL 17 with the provisioned
   Registry Workflow and digest-pinned OCI runtime host.
3. Commit the resulting evidence only if both Qiskit and PennyLane complete the
   Fixed Excitation + SLSQP path and the SLSQP → COBYLA save/reopen comparison.
4. Perform one live WorkOS staging logout/login with the same subject and reopen
   the saved private comparison.
5. Re-run remote CI at the exact candidate commit. Only then freeze the Private
   Technical MVP RC.
