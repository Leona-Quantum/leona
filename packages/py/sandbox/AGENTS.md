# AGENTS.md — majorana-sandbox  (BLAST-RADIUS)

Ephemeral execution of untrusted generated code (Phase 2 step 2). This is the
highest-risk surface in the product; changes here need orchestrator/owner review
(`.github/CODEOWNERS`, AGENTS.md rule 1 & 3).

Three layers, always in this order via `base.run(sandbox, spec)`:
1. `guard.check_python_code` — static defense-in-depth. Allowlist imports, deny
   dangerous tokens/builtins. NOT the boundary; it just closes the obvious escapes.
2. `spec.preflight` — pre-dispatch caps incl. the ≤27-qubit lane ceiling, computed
   before any sandbox is created.
3. A `Sandbox` provider:
   - `VercelSandbox` — the real Firecracker boundary. **The deny-all egress
     invariant lives in `vercel.py`** (`network_policy="deny-all"` at creation;
     Vercel defaults to allow-all). A sandbox that can reach the internet is a
     release-blocking bug. Zero credentials inside the sandbox env, ever.
   - `LocalSubprocessSandbox` — DEV/TEST double. Timeout + best-effort memory
     rlimit only; **cannot deny network** — never a production boundary.

`tests/test_hostile_payloads.py` is the Phase 2 gate. The equivalent suite against
the REAL provider (incl. the canary-URL egress test) is the Phase 4 release gate
(05-security.md §2), owner-gated on Vercel credentials.
