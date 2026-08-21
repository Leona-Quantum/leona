"""Security response headers for the API (05-security.md §1 edge).

`apps/web` has had a considered header policy for a while — `next.config.ts`
argues its CSP out at length. This service had **none**: CORS pinned to
`web_origin`, gzip, and nothing else. That is defensible right up until someone
points a browser straight at an API URL, which is the case every header below is
about.

## Why a JSON API needs any of this

The API's whole output is `application/json` and `application/problem+json`, and
none of it is ever meant to be a document. Three of the four headers here simply
say that out loud, so that a browser cannot be talked into treating a response
as something it is not:

- **`X-Content-Type-Options: nosniff`** — the one with a real attack behind it.
  Content sniffing is how a JSON response containing an attacker-influenced
  string gets executed as HTML: the response echoes a slug, a search term or an
  error `detail` back to the caller, and a browser that guesses at the type
  renders it. The `Content-Type` we send is already right; this stops the
  browser from second-guessing it.
- **`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; ...`**
  — the strong form of the same statement. An API response has no legitimate
  subresources at all, so the policy is "load nothing", which is both the
  tightest possible CSP and an exactly accurate description of this service.
  `frame-ancestors 'none'` is the part that does work today: it is what refuses
  to be framed, and unlike `X-Frame-Options` it is not overridden by a `Vary`
  cache splitting responses.
- **`X-Frame-Options: DENY`** — kept alongside it anyway. It is redundant with
  `frame-ancestors` on any browser released this decade, and it is two dozen
  bytes to also cover one that is not.
- **`Referrer-Policy: no-referrer`** — an API URL can carry a run id or a share
  token in its path. Nothing here navigates, so there is no referrer worth
  sending and no reason to let one leak if something ever does.

## The one that is NOT here, and why

**No `Strict-Transport-Security`.** It would be a lie about who is enforcing
what. This service is reachable at `*.a.run.app`, and Google already has
`run.app` in the browser preload list — HSTS is enforced there before a response
of ours is read, so a header from us changes nothing. Sending one anyway would
put a claim in the response that looks like this service's policy while the real
guarantee lives somewhere else entirely, and the day the API moves to a custom
domain, whoever reads this file would find a header that had never once been the
thing doing the work. It belongs with the domain, not with the app.

## The one exception: FastAPI's own HTML docs

`default-src 'none'` is only accurate because every response really is JSON —
and two are not. FastAPI's `/docs` and `/redoc` are HTML documents that load
Swagger UI and ReDoc from `cdn.jsdelivr.net`, so the blanket policy would render
them blank. Found by a scanner on the PR that added these headers, before it
shipped.

Both halves of that are handled, and the second is the more interesting one:

1. **In production the pages do not exist.** `create_app` passes
   `docs_url=None, redoc_url=None, openapi_url=None` outside development, so the
   JSON-only policy is simply true there.
2. **In development they are exempt from the CSP**, and only from the CSP —
   `nosniff`, `X-Frame-Options` and `Referrer-Policy` still apply, because none
   of those is what Swagger UI needs.

## Why production stopped serving them at all

Not to make a header convenient. Checked on 2026-08-17, `/docs`, `/redoc` and
`/openapi.json` all answered **200 to an unauthenticated caller** on the live
service — the full interactive documentation and machine-readable schema for
every endpoint, including the ones behind auth. That is a free enumeration of
the entire API surface for anyone who guesses the hostname, and nothing appears
to have decided it: it is FastAPI's default, not a choice this service made.

Nothing depends on the served copies. `openapi.json` in the repo is produced by
`packages/py/majorana_contracts/export.py`, a deterministic exporter CI runs
directly, so the contract pipeline never reads the live route. Turning them off
in production costs nothing and closes the surface; development keeps them,
which is where they are actually used.
"""

from __future__ import annotations

from collections.abc import Mapping

#: Paths whose responses are HTML documents rather than JSON, and so cannot live
#: under `default-src 'none'`. Only reachable in development — see the module
#: docstring — but listed unconditionally so the exemption does not depend on
#: the environment check being right.
DOCUMENT_PATHS: frozenset[str] = frozenset(
    {"/docs", "/redoc", "/docs/oauth2-redirect", "/openapi.json"}
)

#: Set on every response this service produces.
#:
#: A plain dict rather than logic, because every value here is a constant: there
#: is no route in this service that should want a different answer, and the
#: moment one does, the exception belongs at that route rather than as a branch
#: in the middleware.
SECURITY_RESPONSE_HEADERS: Mapping[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    # `base-uri` and `form-action` are not implied by `default-src`, so they are
    # named explicitly; without them "load nothing" still permits a `<base>` tag
    # and a form post if a response were ever rendered as a document.
    "Content-Security-Policy": (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    ),
}


def apply_security_headers(headers, path: str = "") -> None:
    """Add the header set to a response, without overwriting a deliberate value.

    `setdefault` rather than assignment. A route that has gone to the trouble of
    setting one of these has a reason the middleware cannot see, and the
    middleware running *outermost* means a blind assignment here would silently
    win over every one of them. Nothing in the service does that today; this is
    about which way the collision resolves when something eventually does.

    Takes the header container rather than the response so the policy can be
    tested on its own, without constructing a response to look inside.

    `path` exists only for the documentation routes, which get every header
    except the CSP. Defaulting it to `""` means a caller that forgets it gets the
    *strict* policy rather than a silently relaxed one — the safe direction for
    an argument to be missing in.
    """
    skip_csp = path in DOCUMENT_PATHS
    for name, value in SECURITY_RESPONSE_HEADERS.items():
        if skip_csp and name == "Content-Security-Policy":
            continue
        headers.setdefault(name, value)
