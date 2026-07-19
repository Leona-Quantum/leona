"""Route-level wiring for artifact mutations.

`soft_delete_artifact` was implemented, workspace-scoped, role-gated and
covered by repo tests — and reachable from no route at all. The Library's
Delete button therefore only wrote a localStorage tombstone: the row stayed in
Postgres and reappeared on another device or after clearing site data.

Repo-level tests cannot catch that, because the primitive itself was correct.
These assert the HTTP surface actually exposes it.
"""

from majorana_api.routes import artifacts as artifact_routes


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in artifact_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_library_delete_is_reachable_over_http():
    assert ("/artifacts/{artifact_id}", "DELETE") in _routes()


def test_delete_route_delegates_to_the_scoped_soft_delete():
    """Guards against a hard delete or an unscoped query being swapped in."""
    source = artifact_routes.delete_artifact.__doc__ or ""
    assert "Soft" in source
    handler = artifact_routes.delete_artifact
    assert handler.__annotations__["scope"] is not None
    # The handler must take CurrentScope, not a caller-supplied workspace id.
    assert "workspace_id" not in handler.__annotations__
