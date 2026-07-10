"""AuthN for the control plane (blast-radius surface — CODEOWNERS).

Next.js owns the AuthKit session cookie; every API request carries the
WorkOS-minted access token as a Bearer header; we verify statelessly via JWKS
with issuer pinned and ±60 s leeway (05-security.md §1 AuthN/AuthZ). Scope
derivation from the verified identity lives in deps.py — the ONLY place a
Scope may be constructed in request handling.
"""

from .jwt import TokenError, VerifiedToken, verify_bearer_token

__all__ = ["TokenError", "VerifiedToken", "verify_bearer_token"]
