"""FastAPI control plane — one of two Postgres clients (API + Worker).

REST + SSE under /v1; errors are RFC 9457 problem+json; CORS pinned to the web
origin (02-architecture.md §3, 05-security.md §1). Both clients use the
repository layer owned by this service; no other process may access Postgres.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

# PoolTimeout is re-exported by db.py rather than imported from sqlalchemy here.
# `scripts/check_raw_queries.py` forbids a sqlalchemy import outside the
# repository layer, and it is right to: the exemption would have to be a
# blanket one on the module, and the next sqlalchemy import into app.py would
# then arrive unchallenged. Routing it through the module that owns the pool
# also puts the exception next to the timeout that raises it.
from .db import DEFAULT_POOL_TIMEOUT_S, PoolTimeout, engine_from_env, session_factory
from .observability import init_telemetry
from .rate_limit import (
    CALLER_TRUST_HEADER,
    EXEMPT_PATHS,
    TRUSTED_CALLER_HEADER,
    MAX_REQUEST_BYTES,
    AuthFailureThrottle,
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
from .routes.courses import router as courses_router
from .routes.notebooks import router as notebooks_router
from .routes.qpu import router as qpu_router
from .routes.qapps import router as qapps_router
from .routes.runs import router as runs_router
from .routes.shares import router as shares_router
from .routes.usage import router as usage_router
from .settings import Settings
from .routes.workspaces import router as workspaces_router
from .security_headers import apply_security_headers


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


def _auth_failures_throttled(retry_after_s: int) -> JSONResponse:
    return _problem(
        429,
        "Too many failed authentication attempts from this address. Wait and "
        "try again, or sign in again if your session has expired.",
        "rate_limited",
        headers={"Retry-After": str(retry_after_s)},
        extra={"reason": "auth_failure_throttled"},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()

    # FastAPI serves `/docs`, `/redoc` and `/openapi.json` by default, and on
    # 2026-08-17 all three answered 200 to an UNAUTHENTICATED caller on the live
    # service: the full interactive documentation and machine-readable schema
    # for every endpoint, including the ones behind auth. Nothing decided that —
    # it is the framework's default rather than a choice this service made, and
    # it hands anyone who knows the hostname a complete map of the API.
    #
    # Nothing depends on the served copies. The `openapi.json` in the repo comes
    # from `packages/py/majorana_contracts/export.py`, a deterministic exporter
    # CI runs directly, so the contract pipeline never reads these routes.
    #
    # Development keeps them, because that is where they are actually read.
    docs_enabled = resolved.environment == "development"
    app = FastAPI(
        title="majorana-api",
        lifespan=_lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.settings = resolved
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[app.state.settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # There was no response compression at all. `/v1/catalog/entries` is the
    # hot public path and returns JSON that gzips to roughly a tenth of its
    # size, over a link that is 3,800 km long in the direction that matters —
    # Vercel's functions are in `iad1`, this service is in `us-west1`.
    #
    # `compresslevel=6` rather than the library's 9. On JSON, 9 buys one or two
    # percent over 6 for several times the CPU, and this service has ONE vCPU
    # (`1000m` — `API_CPU` in `infra/fleet.env`, the declared source since
    # infra/pin-api-cloud-run-shape; before that this figure was only "verified
    # from `gcloud run services describe majorana-api`" by hand. The 2-vCPU
    # figure in docs/runbooks/system-catalog.md:195 describes a `gcloud run
    # jobs` import batch, a different resource). Spending that CPU on the
    # last one percent of a response is the wrong trade on a box that also has
    # to serve the request.
    #
    # ## SSE is safe, and it is the library that makes it safe
    #
    # `/v1/runs/{id}/events/stream` returns a `StreamingResponse` with
    # `media_type="text/event-stream"` (routes/runs.py:624). Compressing that
    # would hold each event in the gzip window until it filled, turning a live
    # stream into a stuttering one — the standard way this middleware breaks SSE.
    #
    # It does not happen here: Starlette declares
    # `DEFAULT_EXCLUDED_CONTENT_TYPES = ("text/event-stream",)` and skips those
    # responses (starlette/middleware/gzip.py:8,56). Read from the installed
    # source rather than assumed, because the whole safety of this line rests on
    # it — and because it is a library DEFAULT, which is exactly the kind of
    # thing an upgrade changes silently. `test_gzip.py` pins it.
    app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)

    # Per-IP admission control for callers presenting no credential — the
    # `/v1/catalog/*` surface, which has no account to meter (rate_limit.py).
    # On the app rather than a router: the point is to answer before a handler,
    # a dependency, or a database session has been created.
    # `bucket` and `warn_hint` are per-instance because BOTH limiters here are a
    # `FixedWindowLimiter`, and a warning that names the wrong ceiling sends the reader
    # in exactly the wrong direction — the same argument the refusal below makes for why
    # its 429 body names the bucket, applied one step earlier.
    app.state.anon_limiter = FixedWindowLimiter(
        limit=app.state.settings.anon_rate_limit_per_minute,
        bucket="anonymous catalog",
        warn_hint=(
            "If this is our own renderer, the trusted-caller exemption is not being "
            "applied and the public catalog will fall back to the static corpus once it "
            "is refused."
        ),
    )
    # A SECOND bucket, for the one caller we can recognise: our own server-side
    # renderer. Nothing in a browser reads /v1/catalog/*, so without this the
    # limiter's entire subject is Vercel's SSR egress — a handful of addresses
    # shared by every visitor at once — and tripping it is silent, because
    # `getRepositoryEntries` falls back to the static corpus rather than erroring.
    # A separate limiter rather than a bigger number so the two ceilings can move
    # independently: the anonymous one is a security control and wants to come
    # DOWN, the trusted one is a runaway-loop backstop and wants headroom.
    app.state.trusted_limiter = FixedWindowLimiter(
        limit=app.state.settings.trusted_rate_limit_per_minute,
        bucket="trusted renderer",
        warn_hint=(
            "This is the renderer's own ceiling, not the anonymous one; a render path is looping."
        ),
    )
    # Meters every caller — credentialed or not, every path — by the 401s and
    # 403s their own requests produce (ai-ops#145, `AuthFailureThrottle`). A
    # third, independent bucket rather than folding into either limiter above:
    # those two are scoped to `/v1/catalog/*` and count every request; this one
    # runs everywhere and counts only a refusal.
    app.state.auth_failure_throttle = AuthFailureThrottle(
        limit=app.state.settings.auth_failure_limit
    )

    @app.middleware("http")
    async def _anon_rate_limit(request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        # `request.headers` (Starlette's `Headers`) is already case-insensitive
        # and already normalizes multi-value headers, so there is nothing a
        # rebuilt lowercased dict adds here — it only cost a per-request
        # allocation this middleware and `_auth_failure_throttle` were each
        # paying separately. `client_address` and `is_trusted_caller` accept
        # any string-keyed mapping, `request.headers` included.

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
        declared = request.headers.get("content-length")
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
        # public read surface metered at the CONFIGURED anonymous limit per
        # address (`ANON_RATE_LIMIT_PER_MINUTE`, defaulting to
        # `DEFAULT_ANON_LIMIT`), and
        # the concern that motivated the exemption — an office or lab on one NAT
        # — would have to sustain that between them. The figure lives in
        # rate_limit.py and is deliberately not repeated here; this sentence used
        # to say "240/min", which stopped being true when that constant was
        # raised to 1200 and stayed wrong because nothing makes a comment fail.
        if not is_rate_limited_path(request.url.path):
            return await call_next(request)
        peer = request.client.host if request.client else None

        # WHICH bucket, never WHETHER to meter. A caller that proves it holds the
        # renderer's shared secret is counted against a separate, generous
        # ceiling; everyone else — including a caller that sent a wrong token —
        # is counted as anonymous. There is no branch here that skips metering.
        trusted = is_trusted_caller(
            request.headers, request.app.state.settings.trusted_caller_token
        )
        limiter = request.app.state.trusted_limiter if trusted else request.app.state.anon_limiter
        # Emitted on the refusal AND on the success, because the question this
        # answers — "is the deployed renderer actually being seen as trusted?" —
        # is asked of a healthy service, not a refused one.
        trust_header = {CALLER_TRUST_HEADER: "trusted" if trusted else "anonymous"}

        decision = limiter.check(client_address(request.headers, peer))
        if not decision.allowed:
            # The refusal names the bucket that actually refused. Reporting a
            # trusted renderer's ceiling as "anonymous" would tell whoever is
            # reading the log to look at scrapers when the cause is our own
            # render path looping — which is the only thing the trusted ceiling
            # exists to catch, so it is the one case where getting this wrong
            # sends the investigation in exactly the wrong direction. It would
            # also tell our own server to "sign in".
            title, reason = (
                (
                    "Too many requests from this trusted caller. This is the "
                    "renderer's own ceiling, not the anonymous one; a render path "
                    "is looping.",
                    "trusted_rate_limited",
                )
                if trusted
                else (
                    "Too many requests from this address. This is an anonymous-traffic "
                    "ceiling on the public catalog; sign in for your account's allowance.",
                    "anonymous_rate_limited",
                )
            )
            return _problem(
                429,
                title,
                "rate_limited",
                headers={"Retry-After": str(decision.retry_after_s), **trust_header},
                extra={"reason": reason},
            )
        response = await call_next(request)
        # CALLER_TRUST_HEADER describes THIS request's caller — our own renderer
        # versus an anonymous one — not the payload. `routes/catalog.py` marks
        # its six public GETs `Cache-Control: public`, and a shared cache is then
        # free to replay one caller's stored response to a different caller, so
        # the verdict must never ride on a publicly cacheable response.
        #
        # **Stripping it outright was wrong, and this is the correction.** The
        # first version of this block dropped the header from every `public`
        # response, on the reasoning that "nothing downstream reads this header".
        # Something does: `apps/web/lib/trusted-caller.ts`'s `reportCallerTrust`
        # is called on every catalog fetch the renderer makes, and its module
        # comment says in as many words that a mismatch is **the only symptom
        # this failure has**. The failure it detects is real — the renderer's
        # token misconfigured or rejected, so our own server-side renders are
        # metered against the anonymous per-address ceiling, hit it under load,
        # and fall back to the bundled static corpus. Stripping the header from
        # the six routes the renderer actually fetches turned off the only
        # detector for that, silently, on exactly those routes.
        #
        # So the split is by caller rather than by route:
        #
        #   trusted   -> keep the verdict, and mark the response `private` so no
        #                SHARED cache stores it. A private cache holding a
        #                response whose trust verdict is its own is correct.
        #   anonymous -> keep `public`, strip the verdict. An anonymous caller
        #                has nothing to learn from it, and this is the variant a
        #                CDN is allowed to keep.
        #
        # `Vary` is added on the credential header so a cache cannot serve the
        # public variant to a trusted caller and hide the diagnostic again. It
        # costs one extra cache key for a caller that is a single deployment.
        cache_control = response.headers.get("Cache-Control", "")
        if "public" in cache_control:
            response.headers["Vary"] = (
                f"{response.headers['Vary']}, {TRUSTED_CALLER_HEADER}"
                if response.headers.get("Vary")
                else TRUSTED_CALLER_HEADER
            )
        if "public" in cache_control and trusted:
            response.headers["Cache-Control"] = cache_control.replace("public", "private", 1)
        if "public" not in response.headers.get("Cache-Control", ""):
            response.headers[CALLER_TRUST_HEADER] = trust_header[CALLER_TRUST_HEADER]
        return response

    # Registered after `_anon_rate_limit`, which makes it OUTER relative to
    # that middleware (see the placement comment two blocks down for what
    # "registration order" means for nesting). The practical effect: this
    # runs its block-check before `_anon_rate_limit` does any work at all, so
    # an address already over the auth-failure ceiling is refused before this
    # service spends anything buffering its body or touching the catalog
    # limiter's own counters.
    @app.middleware("http")
    async def _auth_failure_throttle(request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        # `request.headers` directly — see the comment in `_anon_rate_limit`.
        peer = request.client.host if request.client else None
        address = client_address(request.headers, peer)
        throttle = request.app.state.auth_failure_throttle

        # Identity-gated exemption from REFUSAL, never from counting — see
        # `AuthFailureThrottle`'s "The trusted-caller exemption" docstring
        # section for the full reasoning (Aikido finding 1, PR 707) and its
        # residual. A caller proving it holds the renderer's shared secret is
        # never blocked here, because that secret cannot be forged the way an
        # address can — so an attacker who does not hold it cannot make
        # themselves look like the BFF and get the BFF blocked. An attacker
        # who does not present it is metered and blocked exactly as before.
        trusted = is_trusted_caller(
            request.headers, request.app.state.settings.trusted_caller_token
        )
        if not trusted:
            decision = throttle.should_block(address)
            if not decision.allowed:
                return _auth_failures_throttled(decision.retry_after_s)

        response = await call_next(request)
        # The OUTCOME, not the path or a header, decides what counts — see
        # `AuthFailureThrottle`'s docstring for why that is what keeps a CI
        # authz suite (which overrides the identity dependency and rejects
        # nothing), our own health checks, and the deploy probe's working
        # path from ever contributing to this count at all: none of them,
        # when everything is configured correctly, ever produces a 401 for
        # this to see. The trusted-caller path is different: it CAN produce a
        # 401 in principle and is still counted when it does (`trusted` above
        # only skips the refusal, not this line) — the count, and the WARN
        # threshold it can trigger, must stay visible even for an exempt
        # caller, or the exemption also hides the one signal that would show
        # the shared bucket climbing.
        #
        # 401 only, not 403 — narrowed after review. `auth/deps.py`'s
        # `get_verified_token` is the ONLY place this service raises a 401, for
        # a missing/invalid/expired/reserved-identity bearer token, which is
        # what "an auth failure" actually means. 403 is NOT counted: it is
        # raised from several unrelated places, almost all of them a correctly
        # authenticated caller being told no by business logic (a free-tier
        # plan gate, a workspace-scope check) rather than a credential problem
        # — see `AuthFailureThrottle`'s "401 only, not 403" section for the
        # concrete exploit (a legitimate free-tier user tripping the block for
        # every other signed-in user behind the shared BFF address) that this
        # narrowing closes.
        if response.status_code == 401:
            throttle.record_failure(address)
        return response

    # Registered LAST, which makes it OUTERMOST — Starlette's `add_middleware`
    # inserts at the front of `user_middleware`, and the front of that list is
    # the outside of the stack. That is the whole point of the placement: the
    # responses most worth covering are the ones that never reach a route
    # handler — both limiters' 429s above, the 413 for an oversized body, and
    # every problem+json the exception handlers below produce. A middleware
    # registered earlier would sit inside the limiters and see none of them.
    #
    # What it still does not cover is a 500 raised past every handler, because
    # Starlette's ServerErrorMiddleware is outside all user middleware by
    # construction. That response is a bare "Internal Server Error" with no
    # attacker-influenced content in it, which is the case these headers matter
    # least for.
    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        # The path is passed so the documentation routes can be exempted from the
        # CSP and only the CSP — `default-src 'none'` would render Swagger UI and
        # ReDoc blank. In production those routes do not exist at all (see
        # `create_app` above), so this branch is a development affordance rather
        # than a hole in the deployed policy.
        apply_security_headers(response.headers, request.url.path)
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

    @app.exception_handler(PoolTimeout)
    async def _pool_exhausted(request: Request, exc: PoolTimeout):
        # Saturation is not a bug, and it must not be reported as one. Before
        # this handler a request that waited out `DEFAULT_POOL_TIMEOUT_S` for a
        # database connection fell through to the catch-all below and left as
        # `500 internal error` — indistinguishable, to a client, a dashboard or
        # an on-call reader, from a genuine fault. The distinction is worth a
        # handler of its own for three reasons: a 5xx rate is the signal a
        # launch is watched by, and overload folded into it hides real faults;
        # a 503 is the only response a client may safely retry, where a 500
        # says the request will never succeed; and `Retry-After` turns a retry
        # storm into a spread one, which is the one thing that helps a pool
        # that is already full.
        #
        # The value is the pool timeout itself: a caller that comes back sooner
        # arrives while the same requests are still holding the same
        # connections. It carries no internals — a fixed integer discloses
        # nothing beyond "this server is busy", which the status code already
        # says (05-security.md §1).
        return _problem(
            503,
            "the service is at capacity",
            "capacity_exhausted",
            headers={"Retry-After": str(int(DEFAULT_POOL_TIMEOUT_S))},
            extra={"reason": "capacity_exhausted"},
        )

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
    app.include_router(qapps_router, prefix="/v1")
    app.include_router(notebooks_router, prefix="/v1")
    app.include_router(courses_router, prefix="/v1")
    app.include_router(billing_router, prefix="/v1")
    app.include_router(usage_router, prefix="/v1")
    _wire_observability(app)
    return app
