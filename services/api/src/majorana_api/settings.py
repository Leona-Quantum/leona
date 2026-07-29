"""Process configuration — read once at startup, never at import time elsewhere.

Secrets live in GCP Secret Manager (deploy) / .env.local (dev); this module only
reads the environment (05-security.md §1 Secrets).
"""

import os
from dataclasses import dataclass

from .catalog_authority import CatalogAuthority
from .tiers import parse_developer_emails

_MIN_TOKEN_LENGTH = 32

#: Any literal that appears in this public repository must never be accepted as a
#: real credential, no matter which variable it is set in. The first entry is the
#: placeholder the web app shipped before the single-user lock had an API
#: counterpart; the lock is gone but the string is still public, so it stays
#: refused by name.
_PUBLIC_PLACEHOLDERS = frozenset(
    {
        "majorana-single-user-lock",
        "majorana-deploy-probe",
        "changeme",
    }
)


def _validate_deploy_probe_token(token: str) -> None:
    """An empty value disables the probe; a weak one must not silently enable it.

    The probe credential is narrow — it may create a run and read that run back,
    nothing else (auth/deps.py) — but it is still a standing bearer token on the
    production control plane, so it is held to a real secret's strength.
    """
    if token in _PUBLIC_PLACEHOLDERS:
        raise RuntimeError("DEPLOY_PROBE_TOKEN is a public placeholder; generate a real secret")
    if len(token) < _MIN_TOKEN_LENGTH:
        raise RuntimeError(
            f"DEPLOY_PROBE_TOKEN must be at least {_MIN_TOKEN_LENGTH} characters "
            "(unset it entirely to disable the post-deploy probe)"
        )


@dataclass(frozen=True)
class Settings:
    workos_client_id: str
    # AuthKit session access tokens: issuer is environment-wide, while the
    # client_id claim and per-client JWKS bind the token to this application.
    # Issuer/JWKS remain overridable for a custom auth domain.
    workos_jwt_issuer: str
    workos_jwks_url: str
    web_origin: str
    environment: str = "production"
    local_dev_auth: bool = False
    local_dev_token: str = "majorana-local-dev"
    local_dev_user_id: str = "local-dev-user"
    local_dev_email: str = "local-dev@majorana.test"
    local_dev_display_name: str = "Local developer"
    #: Addresses granted the developer tier by this service (tiers.py). Empty by
    #: default and never hardcoded — this repository is public. A missing value
    #: meters collaborators like free accounts; it cannot throttle the operator,
    #: whose identity is recognised without configuration.
    developer_emails: frozenset[str] = frozenset()
    # Post-deploy probe (NEXT.md §2 item 1, approved session 33). Empty disables
    # it, which is the state every environment except production is in. Unlike
    # the lock, this credential does not open the product: it may create a run
    # and read that one run back, and every other route refuses it.
    deploy_probe_token: str = ""
    deploy_probe_user_id: str = "deploy-probe"
    deploy_probe_email: str = "deploy-probe@leonaquantum.com"
    deploy_probe_display_name: str = "Deploy probe"
    catalog_authority: CatalogAuthority = CatalogAuthority()
    # Phase 5A candidate execution is deliberately non-public. It may be
    # enabled only by a local development process; production capability
    # remains unavailable until Phase 5B qualification and owner promotion.
    vqe_candidate_execution: bool = False
    # Private Phase 6 execution through a dedicated Docker runtime host. The
    # API may enqueue from a managed control plane, but the worker must enforce
    # the dedicated-host marker before it can launch an OCI runtime.
    vqe_production_execution: bool = False

    def __post_init__(self) -> None:
        if self.local_dev_auth and self.environment != "development":
            raise RuntimeError("local dev auth is only valid when MAJORANA_ENV=development")
        if self.vqe_candidate_execution and (
            self.environment != "development"
            or any(
                os.environ.get(name)
                for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")
            )
        ):
            raise RuntimeError(
                "VQE candidate execution requires MAJORANA_ENV=development and a local process"
            )
        if self.vqe_production_execution and self.environment != "production":
            raise RuntimeError("VQE production execution requires MAJORANA_ENV=production")
        if self.vqe_candidate_execution and self.vqe_production_execution:
            raise RuntimeError(
                "candidate and production VQE execution gates are mutually exclusive"
            )
        if self.deploy_probe_token:
            _validate_deploy_probe_token(self.deploy_probe_token)

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

        vqe_candidate_execution = os.environ.get(
            "MAJORANA_VQE_CANDIDATE_EXECUTION",
            "",
        ).strip().lower() in {"1", "true", "yes"}
        vqe_production_execution = os.environ.get(
            "MAJORANA_VQE_PRODUCTION_EXECUTION",
            "",
        ).strip().lower() in {"1", "true", "yes"}
        client_id = os.environ.get("WORKOS_CLIENT_ID")
        if not client_id and not local_dev_auth:
            raise RuntimeError("WORKOS_CLIENT_ID is required unless local dev auth is enabled")
        client_id = client_id or "local-dev"
        return cls(
            workos_client_id=client_id,
            workos_jwt_issuer=os.environ.get(
                "WORKOS_JWT_ISSUER",
                f"https://api.workos.com/user_management/{client_id}",
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
            developer_emails=parse_developer_emails(os.environ.get("LEONA_DEVELOPER_EMAILS")),
            deploy_probe_token=os.environ.get("DEPLOY_PROBE_TOKEN", "").strip(),
            catalog_authority=CatalogAuthority.from_env(),
            vqe_candidate_execution=vqe_candidate_execution,
            vqe_production_execution=vqe_production_execution,
        )
