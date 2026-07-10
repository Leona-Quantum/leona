"""Process configuration — read once at startup, never at import time elsewhere.

Secrets live in GCP Secret Manager (deploy) / .env.local (dev); this module only
reads the environment (05-security.md §1 Secrets).
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    workos_client_id: str
    # AuthKit session access tokens: iss is the user_management issuer for the
    # client; JWKS is served per-client. Both overridable for custom auth domains.
    workos_jwt_issuer: str
    workos_jwks_url: str
    web_origin: str

    @classmethod
    def from_env(cls) -> "Settings":
        client_id = os.environ["WORKOS_CLIENT_ID"]
        return cls(
            workos_client_id=client_id,
            workos_jwt_issuer=os.environ.get(
                "WORKOS_JWT_ISSUER", f"https://api.workos.com/user_management/{client_id}"
            ),
            workos_jwks_url=os.environ.get(
                "WORKOS_JWKS_URL", f"https://api.workos.com/sso/jwks/{client_id}"
            ),
            web_origin=os.environ.get("WEB_ORIGIN", "http://localhost:3000"),
        )
