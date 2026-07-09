# ADR-0005: Auth = WorkOS AuthKit

**Date:** 2026-07-09 · **Status:** accepted (owner-confirmed)
**Context:** Firebase auth is being decommissioned with the legacy repos. The PRD's
Team/Enterprise tier needs SAML/OIDC; pre-revenue budget needs a generous free tier.
**Decision:** WorkOS AuthKit. Free to 1M MAU; SAML/OIDC native; per-connection pricing
predictable. Session model: Next.js owns the AuthKit session cookie; the server mints
short-lived JWTs; FastAPI verifies statelessly via JWKS. User/workspace provisioning on
first login.
**Consequences:** Buys enterprise SSO without re-platforming later, stateless API auth.
Costs: two-hop session model to keep straight (cookie in web, JWT to API). Reversal
trigger (per Phase 1 stop condition): WorkOS free-tier friction or JWKS/session mismatch
with App Router → documented fallback is Clerk, with cost delta written up before
switching.
