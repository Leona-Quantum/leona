"""FastAPI control plane — one of two Postgres clients (API + Worker).

REST + SSE under /v1; errors are RFC 9457 problem+json; CORS pinned to the web
origin (02-architecture.md §3, 05-security.md §1). Both clients use the
repository layer owned by this service; no other process may access Postgres.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import engine_from_env, session_factory
from .observability import init_telemetry
from .rate_limit import (
    CALLER_TRUST_HEADER,
    EXEMPT_PATHS,
    MAX_REQUEST_BYTES,
    BodyTooLarge,
    FixedWindowLimiter,
    client_address,
    is_rate_limited_path,
    is_trusted_caller,
    read_bounded_body,
    replay,
)
from .repos import AuthzError, NotFoundError
from .routes.artifacts import router as artifacts_router
from .routes.billing import router as billing_router
from .routes.catalog import router as catalog_router
from .routes.me import router as me_router
from .routes.qpu import router as qpu_router
from .routes.runs import router as runs_router
from .routes.shares import router as shares_router
from .routes.usage import router as usage_router
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
    status: int,
    title: str,
    code: str,
    headers: dict[str, str] | None = None,
    extra: dict | None = None,
) -> JSONResponse:
    body = {"type": "about:blank", "title": title, "status": status, "code": code}
    if extra:
        # Typed-refusal fields (`reason`, and whatever that reason carries) as
        # siblings of `title`, which is what RFC 7807 says extensions are.
        body.update({k: v for k, v in extra.items() if k not in body})
    return JSONResponse(
        body,
        status_code=status,
        media_type="application/problem+json",
        headers=headers,
    )


def _too_large() -> JSONResponse:
    return _problem(
        413,
        f"Request body exceeds the {MAX_REQUEST_BYTES // 1024} KB limit.",
        "request_too_large",
        extra={"reason": "request_too_large", "limit_bytes": MAX_REQUEST_BYTES},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="majorana-api", lifespan=_lifespan)
    app.state.settings = settings or Settings.from_env()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[app.state.settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Per-IP admission control for callers presenting no credential — the
    # `/v1/catalog/*` surface, which has no account to meter (rate_limit.py).
    # On the app rather than a router: the point is to answer before a handler,
    # a dependency, or a database session has been created.
    app.state.anon_limiter = FixedWindowLimiter(limit=app.state.settings.anon_rate_limit_per_minute)
    # A SECOND bucket, for the one caller we can recognise: our own server-side
    # renderer. Nothing in a browser reads /v1/catalog/*, so without this the
    # limiter's entire subject is Vercel's SSR egress — a handful of addresses
    # shared by every visitor at once — and tripping it is silent, because
    # `getRepositoryEntries` falls back to the static corpus rather than erroring.
    # A separate limiter rather than a bigger number so the two ceilings can move
    # independently: the anonymous one is a security control and wants to come
    # DOWN, the trusted one is a runaway-loop backstop and wants headroom.
    app.state.trusted_limiter = FixedWindowLimiter(
        limit=app.state.settings.trusted_rate_limit_per_minute
    )

    @app.middleware("http")
    async def _anon_rate_limit(request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        headers = {k.lower(): v for k, v in request.headers.items()}

        # Total request size. Pydantic bounds each FIELD — `task_prompt` at
        # 20 KB, `source_code` at 100 KB — but a field limit applies AFTER the
        # body has been received and parsed, so nothing before this bounded the
        # whole document. Cloud Run's 32 MB ceiling is a platform backstop, not a
        # statement by this service about what it will accept.
        #
        # TWO checks, because Content-Length alone is not a bound: a
        # `Transfer-Encoding: chunked` request declares no length, and a probe
        # confirmed a 2 MiB chunked body reaching the handler under a 1 MiB
        # "limit". The declared check stays because it refuses without reading
        # anything; `read_bounded_body` is what makes the limit true.
        declared = headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
            return _too_large()
        try:
            buffered = await read_bounded_body(request.receive, MAX_REQUEST_BYTES)
        except BodyTooLarge:
            return _too_large()
        request._receive = replay(buffered, request.receive)

        # The anonymous-serving surface, and EVERY caller on it — including one
        # presenting a credential. Skipping header-bearing callers was the first
        # shape of this and it defeated the control outright: `Authorization:
        # Bearer x` is free to send, so a scraper simply sent one. The header is
        # the caller's to choose, so it cannot be what decides whether the
        # limiter runs.
        #
        # Metering signed-in readers too is the cost, and it is small: this is a
        # public read surface at 240/min per address, where the concern that
        # motivated the exemption — an office or lab on one NAT — would need to
        # sustain four catalog reads a second between them.
        if not is_rate_limited_path(request.url.path):
            return await call_next(request)
        peer = request.client.host if request.client else None

        # WHICH bucket, never WHETHER to meter. A caller that proves it holds the
        # renderer's shared secret is counted against a separate, generous
        # ceiling; everyone else — including a caller that sent a wrong token —
        # is counted as anonymous. There is no branch here that skips metering.
        trusted = is_trusted_caller(headers, request.app.state.settings.trusted_caller_token)
        limiter = request.app.state.trusted_limiter if trusted else request.app.state.anon_limiter
        # Emitted on the refusal AND on the success, because the question this
        # answers — "is the deployed renderer actually being seen as trusted?" —
        # is asked of a healthy service, not a refused one.
        trust_header = {CALLER_TRUST_HEADER: "trusted" if trusted else "anonymous"}

        decision = limiter.check(client_address(headers, peer))
        if not decision.allowed:
            return _problem(
                429,
                "Too many requests from this address. This is an anonymous-traffic "
                "ceiling on the public catalog; sign in for your account's allowance.",
                "rate_limited",
                headers={"Retry-After": str(decision.retry_after_s), **trust_header},
                extra={"reason": "anonymous_rate_limited"},
            )
        response = await call_next(request)
        response.headers[CALLER_TRUST_HEADER] = trust_header[CALLER_TRUST_HEADER]
        return response

    @app.exception_handler(HTTPException)
    async def _http_exc(request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            # A typed refusal — `{"error": <a sentence for the user>, "reason":
            # <a token for the client>, ...}`. `str()` on that is a Python repr,
            # single quotes and all, and the web client renders `title` straight
            # to the person: the free tier's workspace limit has been putting
            # {'error': 'Your plan includes 3 workspaces...'} on screen since it
            # shipped. Nobody saw it because the accounts that hit these limits
            # are not the ones the product was demonstrated from.
            return _problem(
                exc.status_code,
                str(detail.get("error", "request refused")),
                "http_error",
                headers=exc.headers,
                extra={k: v for k, v in detail.items() if k != "error"},
            )
        return _problem(exc.status_code, str(detail), "http_error", headers=exc.headers)

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
    # After the workspaces router: `/workspace/projects/{project_id}/shares` must
    # not be reached by that router's `/workspace/projects/{project_id}` PATCH and
    # DELETE, and FastAPI matches in registration order. The paths differ by a
    # trailing segment so no ordering bug is possible today — this is registered
    # here so that stays true if either side gains a wildcard.
    app.include_router(shares_router, prefix="/v1")
    app.include_router(catalog_router, prefix="/v1")
    app.include_router(qpu_router, prefix="/v1")
    app.include_router(billing_router, prefix="/v1")
    app.include_router(usage_router, prefix="/v1")
    _wire_observability(app)
    return app
