# Atlas VQE Phase 6 — live control-plane E2E evidence

Date: 2026-07-27 JST  
Branch: `feature/vqe`  
Vercel source commit: `e4e0f8fce8093c7f25663f5654be4c8142cd482b`  
Cloud Run revision: `majorana-api-vqe-test-00003-ttr`  
Environment: test only

## Result

The owner completed a real browser sign-in through the WorkOS Staging tenant
and the Vercel `feature/vqe` Preview deployment. In the same authenticated
browser session:

1. the protected `/run` route rendered the private workspace;
2. `GET /api/me` returned HTTP 200 through the Next.js BFF;
3. the BFF forwarded the WorkOS access token to the Cloud Run FastAPI service;
4. FastAPI accepted the exact WorkOS issuer, per-client JWKS signature,
   `client_id`, expiry/session claims, and required `email` claim;
5. first-login provisioning created or resolved a Neon test-branch user,
   personal workspace, and owner membership;
6. the response contained non-empty `user_id` and `workspace_id`, the expected
   email, workspace name, and `role: owner`.

The response values were visually confirmed by the owner. Tokens, cookies,
database URLs, WorkOS API keys, and secret values are not copied into this
record.

## Configuration correction discovered during the live test

The actual token issuer was:

```text
https://api.workos.com/user_management/<WORKOS_CLIENT_ID>
```

The earlier environment value `https://api.workos.com` was therefore
incorrect for this tenant. The Cloud Run revision was updated to the exact
issuer shown by the WorkOS JWT Template preview. The JWKS remained the
per-client endpoint:

```text
https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>
```

No verifier was disabled or relaxed to make the test pass.

## Exact claim boundary

This evidence proves the live **authentication and control-plane data path**:

```text
browser → Vercel Preview → WorkOS Staging → Next.js BFF
        → Cloud Run FastAPI → Neon test branch
```

It does **not** prove a single live browser-triggered path through a persistent
dedicated VQE worker. The test Cloud Run service deliberately has production
VQE execution disabled and no Docker-host worker attached. Cloud Run is not a
valid host for the dedicated Docker executor.

The separate private production-system evidence in
`PHASE6_PRIVATE_PRODUCTION_E2E.md` proves the durable job and exact
digest-pinned Qiskit/PennyLane OCI execution path on a disposable Neon branch.
The two records are complementary and must not be merged into a claim that was
not run.

## Release consequence

The owner user-flow confirmation and live WorkOS/Neon control-plane gate are
closed for the test environment. Public execution, publication, verified
badges, independent scientific review, and scientific release remain blocked.
Phase 7 metadata-only GitHub import may start independently of those public
release gates.
