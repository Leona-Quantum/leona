import uuid

import pytest
from fastapi import HTTPException
from repo_test_helpers import RecordingSession, compiled

from majorana_api.auth.catalog_deps import get_public_catalog_scope
from majorana_api.catalog_authority import (
    CatalogAuthority,
    CatalogConfigurationError,
    CatalogDisabledError,
)
from majorana_api.repos import AuthzError, NotFoundError, catalog
from majorana_api.settings import Settings


def authority(*, enabled: bool = True) -> CatalogAuthority:
    return CatalogAuthority(
        enabled=enabled,
        workspace_id=uuid.uuid4(),
        importer_user_id=uuid.uuid4(),
        public_reader_user_id=uuid.uuid4(),
    )


def test_catalog_authority_fails_closed_when_disabled():
    with pytest.raises(CatalogDisabledError):
        authority(enabled=False).public_scope()


def test_catalog_authority_requires_all_distinct_ids():
    shared = uuid.uuid4()
    with pytest.raises(CatalogConfigurationError, match="distinct"):
        CatalogAuthority(
            enabled=True,
            workspace_id=shared,
            importer_user_id=shared,
            public_reader_user_id=uuid.uuid4(),
        )


def test_public_dependency_uses_only_server_settings():
    configured = authority()
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        catalog_authority=configured,
    )
    scope = get_public_catalog_scope(settings)
    assert scope == configured.public_scope()


def test_public_dependency_maps_disabled_to_not_found():
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
    )
    with pytest.raises(HTTPException) as exc:
        get_public_catalog_scope(settings)
    assert exc.value.status_code == 404


async def test_catalog_repo_binds_exact_system_workspace_and_reader_membership():
    configured = authority()
    session = RecordingSession()
    scope = configured.public_scope()
    with pytest.raises(NotFoundError):
        await catalog.get_catalog_workspace(scope, session, authority=configured)
    sql, params = compiled(session.statements[0])
    assert "workspaces.kind" in sql
    assert "memberships.user_id" in sql
    assert scope.workspace_id in params.values()
    assert scope.user_id in params.values()
    assert "system" in params.values()
    assert "viewer" in params.values()


async def test_private_workspace_cannot_be_substituted_into_catalog_read():
    configured = authority()
    private_scope = configured.public_scope().model_copy(update={"workspace_id": uuid.uuid4()})
    session = RecordingSession()
    with pytest.raises(AuthzError):
        await catalog.get_catalog_workspace(private_scope, session, authority=configured)
    assert session.statements == []


def test_is_importer_scope_matches_configured_identity():
    configured = authority()
    assert configured.is_importer_scope(configured.importer_scope())


def test_is_importer_scope_rejects_public_reader_scope():
    configured = authority()
    assert not configured.is_importer_scope(configured.public_scope())


def test_is_importer_scope_rejects_wrong_user():
    configured = authority()
    substituted = configured.importer_scope().model_copy(update={"user_id": uuid.uuid4()})
    assert not configured.is_importer_scope(substituted)
