"""Per-IP admission control for anonymous requests (05-security.md §1 edge).

This is the last unbuilt line of `05-security.md` §1: "Rate limiting at API
middleware (per-user, per-IP for unauthenticated public pages)". The per-user
half shipped with the tier gate in `tiers.py` — a token holder is bounded by an
allowance reserved under their own row lock before a job is enqueued. The
per-IP half is this module, and it binds the surface the tier gate cannot see:
`/v1/catalog/*` takes no credential at all, so there is no account to meter and
no lock to reserve against. Every anonymous reader is the same anonymous reader.

## Scoped by PATH, not by whether a credential was presented

The first shape of this metered every route and treated "no `Authorization`
header" as anonymous. That was wrong twice, and both are worth keeping written
down because each one looks reasonable until it is tried:

- **The header is the caller's to choose.** `Authorization: Bearer x` costs
  nothing to send and skipped the limiter entirely, so a scraper defeated the
  whole control with one header and was merely 401'd on routes that needed a
  real token — which the public catalog does not.
- **It metered routes with no anonymous reading at all.** An authz suite that
  overrides the identity dependency sends no header, so 250 imports by one
  authenticated user counted as 250 anonymous requests from one address. In
  production the header is always present, so no real user would ever have seen
  it: the signal was wrong in the one direction only CI could show.

So `LIMITED_PATH_PREFIXES` decides, and on those paths **every** caller is
metered. The cost is that a signed-in reader on a shared address is metered too;
at `DEFAULT_ANON_LIMIT` an office would have to sustain that many catalog reads
a minute between them to notice. That is the right trade against a control that
any client can opt out of.

(This paragraph named a figure — 240/min, "four reads a second" — and kept
naming it after `DEFAULT_ANON_LIMIT` was raised to 1200, so for the whole of
that time the prose under-stated the real ceiling by 5x while reading as though
it had been checked. The constant is named rather than quoted now, because the
next change to it will not come back to edit this sentence either.)

Everywhere else is bounded by the gate that knows whose request it is — the tier
allowance in `tiers.py`, reserved under the account's own row lock.

## Why a fixed window, and what it does not do

The counters live in this process. Cloud Run runs several instances, so the
effective ceiling is `limit x instances`, not `limit` — this is a backstop
against a script hammering the public catalog, not a distributed quota. Making
it exact needs shared state (Redis), which is infrastructure this deployment
does not have and should not grow for a ceiling that is deliberately far above
legitimate use. The number below is chosen so that being off by a factor of the
instance count still refuses an abuser and still never refuses a reader.

## Saturation degrades to OFF, not to REFUSE

An attacker rotating source addresses defeats any per-IP limiter — that is true
before this module exists. What must not follow is that the same rotation
exhausts memory or, worse, fills the table and starts refusing everybody else.
So the table is capped: expired entries are swept first, and if it is still
full the request is ALLOWED and the saturation is recorded. Degrading to "off"
loses a bound we never had against that attacker; degrading to "refuse" would
take the site down for everyone who is not attacking it.
"""

from __future__ import annotations

import hmac
import time
from dataclasses import dataclass, field

#: Requests per window per address.
#:
#: ## Sized for who is actually on the other end, which is not a browser
#:
#: The first value here was 240, reasoned from "a person clicking as fast as
#: they can read". That reasoning was wrong about the traffic. Nothing in the
#: browser ever calls `/v1/catalog/*`: `apps/web/lib/repository-source.ts` is
#: server-side and fetches with `next: { revalidate }`, so this endpoint sees
#: **Vercel's SSR egress**, not end users — a handful of addresses shared by
#: every visitor at once.
#:
#: At 240/min that limiter was metering our own renderer, and tripping it does
#: not return an error to anybody: `getRepositoryEntries` catches the failure
#: and falls back to the static corpus, so the public catalog would quietly
#: start serving stale data under exactly the load a launch produces. A control
#: whose failure mode is silent staleness has to have enormous headroom over
#: legitimate use.
#:
#: 1200/min is 20 requests a second from one address. Vercel's cached SSR cannot
#: approach that; a scraper in a loop does thousands a minute and is still
#: refused. The proper fix is to stop our own renderer sharing a bucket with
#: anonymous callers at all — the trusted-caller exemption below — after which
#: this can come back down.
#:
#: **It has NOT come down yet, and that is deliberate.** Lowering it in the same
#: change that adds the exemption would mean that if the shared secret is absent
#: or wrong in production, the renderer is metered at the *new, lower* ceiling —
#: strictly worse than today, and silent in exactly the same way. The sequence is:
#: ship the exemption, read back `X-Majorana-Caller-Trust: trusted` from the
#: deployed service, then lower this.
DEFAULT_ANON_LIMIT = 1200
DEFAULT_WINDOW_S = 60.0

#: Requests per window for a caller that proved it is our own renderer.
#:
#: ## What this bound is for, and what it is not for
#:
#: It is a backstop against **our own code looping** — a render path that fetches
#: in an unbounded loop, a revalidate window set to zero, a retry with no ceiling.
#: Those are the failures that have actually happened to this service, and an
#: unmetered exempt path would let one of them saturate the API with nothing
#: reporting it.
#:
#: It is **not** meaningful protection against a leaked token. 20000/min is 333
#: requests a second; anybody holding the secret can read the entire 283-record
#: corpus hundreds of times over inside this ceiling. Saying otherwise would be
#: the kind of stated-but-unheld guarantee this module's `read_bounded_body`
#: docstring already records once. The control for a leaked token is rotating it.
DEFAULT_TRUSTED_LIMIT = 20_000

#: Presented by our own server-side renderer to prove it is not an anonymous
#: caller. Never sent from a browser: the value is a server-only secret, and
#: `apps/web/lib/repository-source.ts` — the only sender — is imported solely by
#: server components and route handlers.
TRUSTED_CALLER_HEADER = "x-majorana-trusted-caller"

#: Echoed on every metered response so the deployment can be READ BACK rather
#: than assumed. `trusted` or `anonymous`.
#:
#: This is the whole reason the exemption is verifiable. Without it, a token that
#: is missing, misspelled or stale in the renderer's environment presents exactly
#: like a working one — the catalog keeps rendering, from the static corpus,
#: until somebody notices the data is old. With it, one curl against the live
#: service answers the question.
#:
#: The header is emitted for both verdicts on purpose. Emitting it only when
#: trusted would make "the token is wrong" and "this build does not have the
#: feature" the same observation, which is the failure it exists to prevent.
#: It discloses nothing an attacker cannot already infer by sending 1300
#: requests in a minute and seeing whether they are refused.
CALLER_TRUST_HEADER = "X-Majorana-Caller-Trust"

#: Maximum distinct addresses tracked at once. At ~80 bytes per entry this is
#: single-digit megabytes — small enough that the cap is about bounding the
#: worst case rather than about the steady state.
DEFAULT_MAX_KEYS = 20_000

#: Never metered: the container's own liveness probe. A refused health check
#: would take the revision down, which is the one outcome worse than the abuse.
EXEMPT_PATHS = frozenset({"/health"})

#: The ONLY routes this limiter meters — the surface that serves data to a
#: caller presenting no credential. See the module docstring for why the path,
#: rather than the `Authorization` header, is what decides.
LIMITED_PATH_PREFIXES = ("/v1/catalog",)

#: Ceiling on a single request body, across every route.
#:
#: Comfortably above the largest legitimate document this API accepts: the
#: biggest single field is `source_code` at 100 KB and the biggest request is an
#: artifact import carrying code plus QASM, so ~256 KB. 1 MiB leaves room for a
#: field to grow without this constant becoming the thing that refuses a feature,
#: while still being 32x below the platform ceiling it replaces as the real limit.
MAX_REQUEST_BYTES = 1024 * 1024


@dataclass(frozen=True)
class Decision:
    """The verdict for one request. `retry_after_s` is only meaningful when refused."""

    allowed: bool
    remaining: int
    retry_after_s: int = 0


@dataclass
class _Window:
    started_at: float
    count: int


@dataclass
class FixedWindowLimiter:
    """In-process fixed-window counter, keyed by caller address.

    Kept free of FastAPI and of the clock so the policy can be tested directly:
    `now` is passed in by the caller, which is what lets a test prove the window
    actually rolls instead of sleeping through it.
    """

    limit: int = DEFAULT_ANON_LIMIT
    window_s: float = DEFAULT_WINDOW_S
    max_keys: int = DEFAULT_MAX_KEYS
    _windows: dict[str, _Window] = field(default_factory=dict)
    #: Incremented whenever the table was full and a request was let through
    #: because of it. Read by the tests, and the number to look at first if the
    #: limiter ever appears not to be working.
    saturated_admissions: int = 0

    def check(self, key: str, *, now: float | None = None) -> Decision:
        """Count one request against `key` and say whether it may proceed."""
        if self.limit <= 0:  # explicitly disabled
            return Decision(allowed=True, remaining=0)
        now = time.monotonic() if now is None else now

        window = self._windows.get(key)
        if window is None or now - window.started_at >= self.window_s:
            if window is None and len(self._windows) >= self.max_keys:
                self._sweep(now)
                if len(self._windows) >= self.max_keys:
                    # Table full of live entries. See the module docstring: the
                    # safe direction here is to admit, not to refuse.
                    self.saturated_admissions += 1
                    return Decision(allowed=True, remaining=0)
            window = _Window(started_at=now, count=0)
            self._windows[key] = window

        window.count += 1
        if window.count > self.limit:
            elapsed = now - window.started_at
            return Decision(
                allowed=False,
                remaining=0,
                # Always at least 1: a `Retry-After: 0` reads as "retry now",
                # which is the instruction that produced the refusal.
                retry_after_s=max(1, int(self.window_s - elapsed) + 1),
            )
        return Decision(allowed=True, remaining=self.limit - window.count)

    def _sweep(self, now: float) -> None:
        expired = [k for k, w in self._windows.items() if now - w.started_at >= self.window_s]
        for key in expired:
            del self._windows[key]


class BodyTooLarge(Exception):
    """The request body exceeded MAX_REQUEST_BYTES. Carries no detail — the
    middleware turns it into a 413 and the caller learns only the limit."""


async def read_bounded_body(receive, max_bytes: int) -> list[dict]:
    """Buffer the request body, refusing as soon as it passes `max_bytes`.

    ## Why this exists rather than a Content-Length check alone

    A `Content-Length` check is free and catches every ordinary client, and it
    was the whole of this limit until a probe showed what it misses: a request
    using `Transfer-Encoding: chunked` declares no length at all, so a 2 MiB
    chunked body sailed through a 1 MiB "limit" and reached the handler. The
    comment above it claimed a total-size bound the code did not deliver, which
    is the failure this codebase keeps finding in itself — a guarantee stated and
    not held is worse than no guarantee, because it stops anyone looking.

    Counting as the chunks arrive is what actually holds the bound. The refusal
    fires on the chunk that crosses the line, so at most one chunk beyond the
    limit is ever held.

    Buffering every request body is acceptable here **because this API has no
    streaming upload**: SSE is a response, and every request is a bounded JSON
    document. If that ever stops being true, this is the thing to revisit.
    """
    messages: list[dict] = []
    total = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            # http.disconnect — hand it on and stop; there is no body to bound.
            messages.append(message)
            return messages
        total += len(message.get("body", b""))
        if total > max_bytes:
            raise BodyTooLarge
        messages.append(message)
        if not message.get("more_body", False):
            return messages


def replay(messages: list[dict], receive):
    """An ASGI `receive` that yields the buffered body, then defers to the real one.

    Deferring is the whole contract, and getting it wrong is silent. A first
    version returned a synthetic `{"type": "http.disconnect"}` once the buffer
    was spent, on the reasoning that the body was finished so nothing more could
    arrive. That is true of the BODY and false of the channel: SSE calls
    `request.is_disconnected()`, which reads from `receive`, so every stream saw
    an immediate disconnect and closed before emitting an event. The pipeline
    e2e caught it — a manual probe of the size limit never would have, because
    the size limit worked perfectly.
    """
    remaining = list(messages)

    async def _receive():
        if remaining:
            return remaining.pop(0)
        return await receive()

    return _receive


def client_address(headers: dict[str, str], peer: str | None) -> str:
    """Best available identifier for the caller, given one trusted proxy.

    Cloud Run terminates TLS at the Google front end, so the socket peer is
    always infrastructure and `X-Forwarded-For` carries the client. Its first
    entry is the originating address.

    That entry is client-supplied and therefore forgeable, and the choice not to
    read from the right instead is deliberate. Reading the rightmost entry is
    unforgeable but is the proxy's own address, which puts every anonymous
    reader in the world into one bucket — the limiter would then refuse the
    entire public catalog the moment any single client got busy. Between "an
    attacker who sets a header evades their own ceiling" and "one busy visitor
    takes the site down for everybody", only the first is acceptable. Forging
    the header buys an attacker exactly what rotating source addresses already
    buys them, and the module docstring is explicit that this limiter does not
    stop that attacker.
    """
    forwarded = headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return peer or "unknown"


def is_rate_limited_path(path: str) -> bool:
    """True for the routes that serve data without a credential."""
    return path.startswith(LIMITED_PATH_PREFIXES)


def is_trusted_caller(headers: dict[str, str], expected: str) -> bool:
    """True when the caller presented our own renderer's shared secret.

    ## Why a secret header here, when the module docstring rejects a header

    The docstring above is explicit that `Authorization: Bearer x` cannot decide
    whether the limiter runs, because *presenting a header* costs an attacker
    nothing. That objection is about presence, not about proof: this compares the
    value against a secret the attacker does not have. The distinction is the
    whole design — `LIMITED_PATH_PREFIXES` still decides which routes are metered,
    and this only decides **which bucket** a metered caller is counted in. There
    is no path on which an unproven caller escapes metering entirely.

    ## Unset means nobody is trusted

    An empty `expected` refuses every caller, including one sending an empty
    header. That is the direction that fails safe: a deployment that forgot to
    set the secret meters its own renderer as anonymous, which is exactly the
    behaviour it had before this function existed. The opposite default — empty
    matches empty — would hand the exemption to every anonymous caller in the
    world the moment a variable went missing.

    `compare_digest` rather than `==` because the wrong-token case is reachable
    by anyone: `/v1/catalog/*` takes no credential, so an attacker can probe this
    comparison as often as they like and a byte-by-byte early exit would leak the
    prefix. The secret is long enough that this is precaution rather than a live
    threat, which is the right time to spend one function call on it.

    ## The ASCII check is not defensive tidiness — it is the bug

    `hmac.compare_digest` **raises TypeError on a non-ASCII `str`**. Header bytes
    reach here latin-1 decoded, so a single `0x80` in
    `X-Majorana-Trusted-Caller` reached this comparison, raised, and came back as
    a **500** — on the one route in this service that takes no credential at all.
    Anyone could produce it, cheaply, in a loop. Confirmed by probe before this
    line existed, not reasoned about.

    Refusing rather than encoding is also the *correct* answer and not merely the
    safe one: the token is generated by `secrets.token_urlsafe` and is ASCII by
    construction, so a non-ASCII header could never have matched one. Startup
    validation refuses a non-ASCII configured token for the other half of it —
    otherwise an operator could set a secret that no caller can ever present.
    """
    if not expected or not expected.isascii():
        return False
    presented = headers.get(TRUSTED_CALLER_HEADER, "")
    if not presented or not presented.isascii():
        return False
    return hmac.compare_digest(presented, expected)
