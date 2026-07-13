"""FastAPI control plane — the only process that talks to Postgres.

REST + SSE under /v1; errors are RFC 9457 problem+json; CORS pinned to the web
origin (02-architecture.md §3, 05-security.md §1).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import engine_from_env, session_factory
from .observability import init_telemetry
from .repos import AuthzError, NotFoundError
from .routes.artifacts import router as artifacts_router
from .routes.me import router as me_router
from .routes.runs import router as runs_router
from .settings import Settings
from .routes.workspaces import router as workspaces_router


def _wire_observability(app: FastAPI) -> None:
    if init_telemetry("majorana-api") is not None:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    app.state.engine = engine_from_env()
    app.state.session_factory = session_factory(app.state.engine)
    yield
    await app.state.engine.dispose()


def _problem(
    status: int, title: str, code: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(
        {"type": "about:blank", "title": title, "status": status, "code": code},
        status_code=status,
        media_type="application/problem+json",
        headers=headers,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="majorana-api", lifespan=_lifespan)
    app.state.settings = settings or Settings.from_env()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[app.state.settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "X-Workspace-Id"],
    )

    @app.exception_handler(HTTPException)
    async def _http_exc(request: Request, exc: HTTPException):
        return _problem(exc.status_code, str(exc.detail), "http_error", headers=exc.headers)

    @app.exception_handler(NotFoundError)
    async def _not_found(request: Request, exc: NotFoundError):
        return _problem(404, "not found", "not_found")

    @app.exception_handler(AuthzError)
    async def _authz(request: Request, exc: AuthzError):
        return _problem(403, "forbidden", "forbidden")

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        return _problem(422, "validation failed", "validation_error")

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Never leak internals (05-security.md §1); detail lives in logs/Sentry.
        return _problem(500, "internal error", "internal_error")

    # /health, not /healthz: Google Front End intercepts /healthz on run.app
    # URLs and returns its own 404 before the container ever sees the request.
    @app.get("/health")
    async def health():
        return {"ok": True}

    app.include_router(me_router, prefix="/v1")
    app.include_router(artifacts_router, prefix="/v1")
    app.include_router(runs_router, prefix="/v1")
    app.include_router(workspaces_router, prefix="/v1")
    _wire_observability(app)
    return app
