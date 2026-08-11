"""The SSE handler must not hold an auth session for the stream lifetime."""

from types import SimpleNamespace
import uuid

import httpx
from majorana_contracts.enums import Role

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.routes import runs as runs_routes
from majorana_api.settings import Settings


SETTINGS = Settings(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


class _SessionContext:
    def __init__(self, trace: list[str]):
        self._trace = trace

    async def __aenter__(self):
        self._trace.append("poll_session_open")
        return object()

    async def __aexit__(self, *_exc_info):
        self._trace.append("poll_session_close")


class _SessionFactory:
    def __init__(self, trace: list[str]):
        self._trace = trace

    def __call__(self):
        return _SessionContext(self._trace)


async def test_sse_releases_request_session_before_consuming_stream(monkeypatch):
    trace: list[str] = []
    run_id = uuid.uuid4()
    app = create_app(SETTINGS)
    app.state.session_factory = _SessionFactory(trace)

    async def request_session():
        trace.append("request_session_open")
        try:
            yield object()
        finally:
            trace.append("request_session_close")

    async def get_run(_scope, _session, requested_id):
        assert requested_id == run_id
        return SimpleNamespace()

    async def list_run_events_with_status(_scope, _session, requested_id, *, after_seq):
        trace.append("events_query")
        assert requested_id == run_id
        assert after_seq == 0
        return [
            SimpleNamespace(
                run_id=run_id,
                seq=1,
                ts=None,
                type="run.finished",
                payload={"status": "succeeded"},
            )
        ], "succeeded"

    user_id = uuid.uuid4()
    workspace_id = uuid.uuid4()

    async def resolve_active_workspace(_session, *, user, personal_workspace_id):
        assert user.id == user_id
        assert personal_workspace_id == workspace_id
        return SimpleNamespace(workspace_id=workspace_id, role=Role.OWNER)

    monkeypatch.setattr(runs_routes.runs_repo, "get_run", get_run)
    monkeypatch.setattr(
        runs_routes.runs_repo,
        "list_run_events_with_status",
        list_run_events_with_status,
    )
    monkeypatch.setattr(runs_routes.system, "resolve_active_workspace", resolve_active_workspace)
    app.dependency_overrides[auth_deps.get_session] = request_session
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        SimpleNamespace(id=user_id),
        SimpleNamespace(id=workspace_id),
    )

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=True)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("GET", f"/v1/runs/{run_id}/events/stream") as response:
            assert response.status_code == 200
            body = "".join([chunk async for chunk in response.aiter_text()])

    assert "event: run.finished" in body
    assert trace.index("request_session_close") < trace.index("events_query")
    assert trace.index("poll_session_close") > trace.index("events_query")
