"""The switcher's HTTP surface, and the property that makes it safe.

The live behaviour is covered in tests/authz/test_active_workspace_live.py.
What is asserted here is structural and cannot be seen from a database: that
`get_scope` derives the tenant from stored state rather than from anything the
caller sends, and that adding the switch did not quietly open a second way in.
"""

import inspect

from majorana_api.auth import deps
from majorana_api.routes import workspaces as workspace_routes


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in workspace_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_the_switcher_is_reachable_over_http():
    assert ("/workspaces", "GET") in _routes()
    assert ("/workspaces/active", "POST") in _routes()


def test_no_route_accepts_a_caller_supplied_scope():
    """`workspace_id` may appear in a *switch* body — it is validated against
    memberships — but never as an argument that selects the tenant a handler
    reads. A route that took one would bypass `get_scope` entirely."""
    handlers = [route.endpoint for route in workspace_routes.router.routes]
    assert len(handlers) >= 6  # the sweep is worthless if it found nothing
    for handler in handlers:
        annotations = getattr(handler, "__annotations__", {})
        assert "workspace_id" not in annotations, handler.__name__


def test_get_scope_reads_no_request_input():
    """The dependency takes an identity and a session. Not a Request, not a
    header, not a query parameter — so there is no value a caller can send that
    changes which workspace their request acts in."""
    params = inspect.signature(deps.get_scope).parameters
    assert set(params) == {"identity", "session"}


def test_switch_refuses_extra_fields():
    """`extra="forbid"` is what stops a request body from carrying a role or a
    user id alongside the workspace and having it silently ignored."""
    assert workspace_routes.SwitchWorkspaceRequest.model_config["extra"] == "forbid"


def test_the_deploy_probe_cannot_switch_workspaces():
    """The post-deploy credential is confined to three run routes. A switch
    would let it move itself into a customer tenant."""
    for path in ("/workspaces", "/workspaces/active"):
        for method in ("GET", "POST"):
            assert (method, path) not in deps.DEPLOY_PROBE_ROUTES
