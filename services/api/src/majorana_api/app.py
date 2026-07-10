"""FastAPI control plane — the only process that talks to Postgres.

REST + SSE under /v1; errors are RFC 9457 problem+json; CORS pinned to the web
origin (02-architecture.md §3, 05-security.md §1).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import engine_from_env, session_factory
from .repos import AuthzError, NotFoundError
from .routes.me import router as me_router
from .settings import Settings


@asynccontextmanager
async def _lifespan(app: FastAPI):
    app.state.engine = engine_from_env()
    app.state.session_factory = session_factory(app.state.engine)
    yield
    await app.state.engine.dispose()


def _problem(status: int, title: str, code: str) -> JSONResponse:
    return JSONResponse(
        {"type": "about:blank", "title": title, "status": status, "code": code},
        status_code=status,
        media_type="application/problem+json",
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
        return _problem(exc.status_code, str(exc.detail), "http_error")

    @app.exception_handler(NotFoundError)
    async def _not_found(request: Request, exc: NotFoundError):
        return _problem(404, "not found", "not_found")

    @app.exception_handler(AuthzError)
    async def _authz(request: Request, exc: AuthzError):
        return _problem(403, "forbidden", "forbidden")

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    app.include_router(me_router, prefix="/v1")
    return app
