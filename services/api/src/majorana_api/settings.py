"""Process configuration — read once at startup, never at import time elsewhere.

Secrets live in GCP Secret Manager (deploy) / .env.local (dev); this module only
reads the environment (05-security.md §1 Secrets).
"""

import os
from dataclasses import dataclass

from .catalog_authority import CatalogAuthority


@dataclass(frozen=True)
class Settings:
    workos_client_id: str
    # AuthKit session access tokens: iss is the user_management issuer for the
    # client; JWKS is served per-client. Both overridable for custom auth domains.
    workos_jwt_issuer: str
    workos_jwks_url: str
    web_origin: str
    environment: str = "production"
    local_dev_auth: bool = False
    local_dev_token: str = "majorana-local-dev"
    local_dev_user_id: str = "local-dev-user"
    local_dev_email: str = "local-dev@majorana.test"
    local_dev_display_name: str = "Local developer"
    catalog_authority: CatalogAuthority = CatalogAuthority()

    def __post_init__(self) -> None:
        if self.local_dev_auth and self.environment != "development":
            raise RuntimeError("local dev auth is only valid when MAJORANA_ENV=development")

    @classmethod
    def from_env(cls) -> "Settings":
        environment = os.environ.get("MAJORANA_ENV", "production").strip().lower()
        local_dev_auth = os.environ.get("MAJORANA_LOCAL_DEV_AUTH", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if local_dev_auth and (
            environment != "development"
            or any(
                os.environ.get(name)
                for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")
            )
        ):
            raise RuntimeError(
                "MAJORANA_LOCAL_DEV_AUTH requires MAJORANA_ENV=development and a local process"
            )

        client_id = os.environ.get("WORKOS_CLIENT_ID")
        if not client_id and not local_dev_auth:
            raise RuntimeError("WORKOS_CLIENT_ID is required unless local dev auth is enabled")
        client_id = client_id or "local-dev"
        return cls(
            workos_client_id=client_id,
            workos_jwt_issuer=os.environ.get(
                "WORKOS_JWT_ISSUER", f"https://api.workos.com/user_management/{client_id}"
            ),
            workos_jwks_url=os.environ.get(
                "WORKOS_JWKS_URL", f"https://api.workos.com/sso/jwks/{client_id}"
            ),
            web_origin=os.environ.get("WEB_ORIGIN", "http://localhost:3000"),
            environment=environment,
            local_dev_auth=local_dev_auth,
            local_dev_token=os.environ.get("MAJORANA_LOCAL_DEV_TOKEN", "majorana-local-dev"),
            local_dev_user_id=os.environ.get("MAJORANA_LOCAL_DEV_USER_ID", "local-dev-user"),
            local_dev_email=os.environ.get("MAJORANA_LOCAL_DEV_EMAIL", "local-dev@majorana.test"),
            local_dev_display_name=os.environ.get(
                "MAJORANA_LOCAL_DEV_DISPLAY_NAME", "Local developer"
            ),
            catalog_authority=CatalogAuthority.from_env(),
        )
