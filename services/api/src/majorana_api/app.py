"""FastAPI control plane — the only process that talks to Postgres.

REST + SSE under /v1; errors are RFC 9457 problem+json; CORS pinned to the web
origin (02-architecture.md §3, 05-security.md §1).
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import engine_from_env, session_factory
from .repos import AuthzError, NotFoundError
from .routes.me import router as me_router
from .settings import Settings


def _wire_observability(app: FastAPI) -> None:
    """AD-10: OTel once, exported twice — everything env-gated so local dev and
    CI run with zero observability config. Sentry via SENTRY_DSN; traces via
    the standard OTEL_EXPORTER_OTLP_* variables (Grafana Cloud)."""
    if os.environ.get("SENTRY_DSN"):
        import sentry_sdk

        sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], traces_sample_rate=0.1)
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": "majorana-api"}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)
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
    _wire_observability(app)
    return app
