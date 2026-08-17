"""Per-IP admission control for anonymous requests (05-security.md §1 edge),
and — in `AuthFailureThrottle` below — a second, unrelated control that meters
every caller (credentialed or not) by the 401s their requests actually produce
(ai-ops#145; see that class's docstring for why 403 was cut after review).
They live in one module because both are
address-keyed admission decisions made in front of a handler, not because
they share a policy: the first is scoped to one path prefix and counts every
request; the second runs on every path and counts only a refusal.

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
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass, field

import sentry_sdk

logger = logging.getLogger(__name__)

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

#: Auth failures (401s the API actually returned — see `AuthFailureThrottle`
#: for why 403 does not count) allowed from one address before it is refused
#: outright (ai-ops#145). See
#: `AuthFailureThrottle` for the mechanism and its docstring's "Sizing against
#: the real population" section for why 300 is the right order of magnitude —
#: it is not reasoned from a single browser the way `DEFAULT_ANON_LIMIT`'s
#: superseded first value was, because a single browser is not what this
#: address usually is.
DEFAULT_AUTH_FAILURE_LIMIT = 300

#: Window over which auth failures accumulate before the count resets.
#:
#: Five minutes, not the anonymous limiter's one: a stale-session cluster is
#: bursty WITHIN a page load (every panel on the dashboard fetches at once,
#: all with the same dead token) and then silent until the caller notices and
#: signs in again. A one-minute window would need a disproportionately high
#: per-minute ceiling just to clear one such burst; a longer window absorbs it
#: naturally while still resetting inside a single support conversation.
DEFAULT_AUTH_FAILURE_WINDOW_S = 300.0

#: Fractions of `AuthFailureThrottle.limit` at which one address's window gets
#: a WARN, once per (address, window, threshold) — never once per request past
#: the line, which would just move the noise problem rather than solve it.
#:
#: This exists because `DEFAULT_AUTH_FAILURE_LIMIT` is reasoned, not measured
#: — see `AuthFailureThrottle`'s "Sizing against the real population" section
#: — and the failure mode if it is wrong is silent until the shared BFF bucket
#: actually crosses it and every signed-in user gets 429'd at once. 50% and
#: 80% turn that into something noticed with headroom to act: at 300/5min, a
#: warning at 150 and again at 240 both land comfortably before the block that
#: only starts at 300, converting "this number could be wrong" into "we will
#: be told before it matters."
AUTH_FAILURE_WARN_THRESHOLDS: tuple[float, ...] = (0.5, 0.8)

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


@dataclass
class _FailureWindow:
    """`AuthFailureThrottle`'s own window record — not the shared `_Window`
    above. `FixedWindowLimiter` answers per REQUEST and has nothing like the
    early-warning problem this exists for: a caller blocked for a window is
    silent until it happens, which is exactly what `warned_thresholds` is for.
    Giving the two limiters separate record shapes is a continuation of the
    reasoning in `AuthFailureThrottle`'s "What is reused from
    `FixedWindowLimiter`" section — the mechanics are shared, the state is not.
    """

    started_at: float
    count: int
    #: Which of `AUTH_FAILURE_WARN_THRESHOLDS` have already fired for this
    #: window, so a crossing is reported once — not on every request past it.
    warned_thresholds: set[float] = field(default_factory=set)


@dataclass
class AuthFailureThrottle:
    """Meters callers by the 401s their requests actually produce (ai-ops#145),
    and refuses further requests from an address that has produced too many.

    ## Outcome, not shape — and why that is the fix this time

    `LIMITED_PATH_PREFIXES` above exists because two earlier attempts to meter
    by the *request's shape* both failed, in the same direction: a legitimate
    caller looked like the thing being metered because the signal was about
    what the request looked like rather than what it did. An authz suite that
    overrides the identity dependency and sends no `Authorization` header is
    the concrete case — 250 authenticated requests, zero of which the
    application ever rejected, read as 250 anonymous ones.

    That failure mode cannot repeat here, structurally: this counts the
    response. An authz suite whose overridden dependency never rejects a
    request produces zero 401s no matter how many requests it sends — there is
    nothing for this class to count. A real caller who is guessing tokens or
    replaying stale credentials produces almost nothing *but* 401s. The two
    populations are separated by the one fact that actually describes the
    behaviour being policed, so there is no request shape left for a
    legitimate caller to accidentally resemble.

    ## 401 only, not 403 — narrowed on review, and here is why

    This counted 403 too, in the first version, on the owner ruling's literal
    words ("meter addresses by the 401s and 403s they produce"). Two Aikido
    findings on this PR's own review (2026-08-17) showed that was wrong, with a
    concrete exploit: a signed-in FREE-TIER user hitting the project-sharing
    route repeatedly gets an immediate 403 — a plan refusal, not a credential
    problem — and because every authenticated request funnels through one
    shared BFF address (next section), a few hundred of those from ONE
    ordinary, correctly-authenticated user would trip the block for every
    OTHER signed-in user sharing that address for the rest of the window. A
    legitimate user could cause that by accident, let alone on purpose.

    Grepped the whole service for every `403` (`services/api/src/majorana_api/`,
    2026-08-17): it is raised from at least four semantically different
    places — a missing email claim, the deploy probe hitting the wrong route,
    `AuthzError` for a workspace-scope violation, and a scatter of tier/plan/
    ownership refusals inline in route handlers. Only the first two are
    genuinely about the credential; the rest are a correctly-authenticated
    caller being told no by business logic, which is not the threat model this
    control is for.

    401 has exactly ONE source in this entire service —
    `auth/deps.py`'s `get_verified_token`, for a missing, invalid, expired, or
    reserved-identity bearer token — which is precisely "someone is presenting
    a bad credential." So this is not a smaller version of the ruling, it is a
    more accurate reading of what "an auth failure" means in this codebase's
    own status-code vocabulary: 401 is what a credential problem looks like
    here, and most of what 403 is turns out to be something else wearing the
    same status code. Recorded here rather than changed silently, because the
    owner's words did name both codes — if the intent is broader (catching
    tier-gate abuse, say), that is a decision for him and probably wants its
    own control with its own ceiling, not this one repurposed for it.

    ## Sizing against the real population, and it is not a single browser

    **State this plainly, because every reader of this class needs it before
    reasoning about any per-address control here: on this API, an address
    does not identify a person for authenticated traffic.** `tiers.py`'s
    per-account allowance, reserved under the account's own row lock, is the
    mechanism that does. This class exists for the surface that mechanism
    cannot see — the moment BEFORE an account is known, when all this API has
    to go on is the connection.

    `DEFAULT_ANON_LIMIT`'s history is a warning about reasoning from "a person
    clicking as fast as they can read" when the real caller on `/v1/catalog/*`
    is Vercel's SSR egress — a handful of addresses shared by every visitor at
    once. The same fact is true here, and worse: `apps/web/lib/control-plane.ts`
    is how EVERY authenticated route is reached (`app/api/*/route.ts` proxies
    the browser's request to this service with the signed-in user's own bearer
    token, over a fresh server-to-server connection that carries no
    `X-Forwarded-For` for the original visitor). So `client_address()` for
    almost all authenticated traffic is not one person — it is Vercel's
    function egress pool, shared across the whole active user base. An
    attacker who wants a bucket of their own still gets one: they reach this
    Cloud Run URL directly, which is how a stolen or guessed token is actually
    replayed, and that connection's peer is *their* address, not Vercel's. The
    case this ceiling has to clear is not one attacker — it is every ordinary
    session hiccup across every signed-in user landing in the same bucket
    within one window: a stale tab refreshing after the browser slept, a
    revoked session still open somewhere, a dashboard load's several panels
    all firing on one dead token at once. None of that is measured — there is
    no production telemetry for it yet — so 300/5min is reasoned the same way
    `DEFAULT_ANON_LIMIT` was when it was raised: pick a number large enough
    that being wrong about the aggregate by a wide margin still refuses an
    abuser and still never refuses the shared address everyone signed in is
    behind. The forward-looking fix this paragraph used to end on — a
    *second* bucket for the BFF, the way `DEFAULT_TRUSTED_LIMIT` gave the
    renderer its own — arrived sooner than expected, from a security review
    rather than a measurement. See the next section.

    ## The trusted-caller exemption — from refusal, never from counting

    Two Aikido findings on this PR (2026-08-17) showed the address-based
    refusal above is not a residual risk on shared BFF traffic, it is a
    weapon. `client_address()`'s own docstring accepts that the leftmost
    `X-Forwarded-For` entry is forgeable, reasoning that "between an attacker
    who evades their own ceiling and one busy visitor taking the site down
    for everybody, only the first is acceptable" — correct for a METERING
    control, where forging only relocates the forger's own quota. It is
    stale for a PUNITIVE one. Here, forging the header costs the forger
    nothing: choose a victim address — the BFF's, for maximum blast radius —
    send a junk bearer token (a free, trivial 401), and that address is
    refused. The control becomes the weapon. The docstring's own second
    horn, "takes the site down for everybody," is reached through the door
    it was not watching.

    So a caller presenting the renderer's shared secret
    (`TRUSTED_CALLER_HEADER`, compared the same way `is_trusted_caller`
    already compares it for the anonymous/trusted rate-limit split) is never
    refused by `should_block` here, regardless of its address. The secret is
    what makes this safe rather than merely convenient: unlike an address, it
    cannot be forged by a caller who does not hold it, so an attacker cannot
    make themselves look like the BFF and cannot get the BFF blocked. A
    direct-to-Cloud-Run attacker — the population this control actually
    exists for — holds no such secret and is refused on their own address
    exactly as before.

    **Narrower than exempting the trusted caller outright, and the narrowing
    is deliberate.** An earlier version of this reasoning rejected a full
    exemption — skip counting AND refusal — as trading a bounded false
    positive for an unbounded bypass: anyone holding the secret could then
    produce unlimited 401s with nothing to stop them. That trade reverses for
    REFUSAL once refusal can be weaponised the way Aikido's finding shows,
    but it does not reverse for COUNTING: `record_failure` runs for an
    exempt caller exactly as it does for anyone else, so
    `AUTH_FAILURE_WARN_THRESHOLDS` still fires if the BFF's own failure rate
    climbs. Exemption from refusal must not mean invisibility — a leaked or
    compromised trusted-caller secret producing sustained 401s with nothing
    ever refusing it is precisely the case the count and the warning exist to
    surface, even though nothing here will act on it by blocking.

    **The residual, stated so nobody removes this thinking it is unrelated
    cruft:** this control's safety against Aikido's finding now DEPENDS on
    the trusted-caller mechanism correctly recognising the BFF. If
    `TRUSTED_CALLER_TOKEN` is ever stale, unset, or misconfigured in
    production — exactly the failure class a prior session's finding already
    recorded once, where a correct-when-written check went blind after an
    unrelated change elsewhere in this same file (`app.py`'s cache-control
    handling started stripping `CALLER_TRUST_HEADER` from public responses,
    fixed in PR 694) — the BFF stops presenting a recognisable identity and
    becomes blockable again by address, silently, with no error anywhere.
    That condition IS observable: `CALLER_TRUST_HEADER` is the read-back
    mechanism PR 694 fixed, and this PR's own investigation confirmed it live
    in production (ai-ops#145's read-back), so "is the renderer actually
    being recognised" is answerable by one request against the deployed
    service. It is not, however, watched continuously by anything in this
    codebase today — a gap worth naming rather than assuming closed.

    **Not yet effective for the traffic it exists to protect — this must
    close before the safety claim above is true end to end.**
    `TRUSTED_CALLER_HEADER` is presented today by exactly one caller:
    `apps/web/lib/repository-source.ts`'s catalog SSR fetch
    (`withTrustedCallerHeader`, grepped as the only call site in the whole of
    `apps/web`, 2026-08-17). The BFF's AUTHENTICATED proxy —
    `apps/web/lib/control-plane.ts`'s `fetchControlPlane` /
    `openControlPlaneStream`, called from every `app/api/*/route.ts`
    handler, which is the traffic Aikido's finding is actually about — sends
    only `Authorization: Bearer <token>` and never this header. So today this
    exemption protects a path (`/v1/catalog/*`) that could never have been
    refused in the first place — no route under it ever calls
    `get_verified_token` (see `is_trusted_caller`'s own docstring) — and does
    NOT yet protect the authenticated BFF traffic the whole shared-address
    problem is about. Closing that needs a companion change OUTSIDE this
    service: `control-plane.ts` attaching the same secret to every proxied
    call, not only the catalog ones. This PR does not make that change. The
    mechanism here is correct and ready for it; the exposure Aikido found is
    not yet closed end to end until it lands.

    ## Two methods, not one, because the event is not the request

    `FixedWindowLimiter.check` decides and counts atomically, which is right
    when the request itself is the thing being metered. Here the thing being
    metered — whether the response was a 401 — does not exist until
    after the handler has run. So admission and counting happen at different
    points in the request's lifecycle: `should_block` is asked before the
    request is allowed to proceed at all, and `record_failure` is told the
    outcome once the response exists. Collapsing them into one atomic call, the
    way the anonymous limiter does it, would require knowing the response
    before the request has been handled.

    ## The refusal lasts as long as the window, not a separate punishment

    Blocked simply means "this window's count is already over the limit" —
    there is no independent cooldown timer layered on top. That is a deliberate
    reuse of the fixed-window idiom above rather than a new mechanism, and
    given the previous section it is also the safer choice: a punitive cooldown
    longer than the window would extend a false-positive block on the shared
    BFF address past the window that caused it, for every signed-in user, for
    no benefit against an attacker who is refused either way.

    ## What is reused from `FixedWindowLimiter`, and why not the class itself

    The window bookkeeping, the `max_keys` cap, the sweep-before-refusing-space
    order, and the degrade-to-OFF-not-REFUSE rule when the table is still full
    after sweeping are all the same shapes as `FixedWindowLimiter` for the same
    reasons given there — in particular, an attacker rotating source addresses
    to fill the table must not end up refusing everyone else. It is a separate
    class rather than a second instance of `FixedWindowLimiter` only because
    the two-method split above has no `.check()` equivalent to reuse.
    """

    limit: int = DEFAULT_AUTH_FAILURE_LIMIT
    window_s: float = DEFAULT_AUTH_FAILURE_WINDOW_S
    max_keys: int = DEFAULT_MAX_KEYS
    _windows: dict[str, _FailureWindow] = field(default_factory=dict)
    #: Same meaning as `FixedWindowLimiter.saturated_admissions` — read by the
    #: tests, and the first thing to check if this throttle ever appears not to
    #: be tracking a caller it should be.
    saturated_admissions: int = 0

    def should_block(self, key: str, *, now: float | None = None) -> Decision:
        """Ask whether `key` is already over the limit for the current window.

        Read-only: a caller with no record yet, or whose last record has aged
        out of the window, has not failed anything *in this window* and is
        allowed — this method never creates or rolls a window itself, only
        `record_failure` does, so an address that never fails never occupies a
        table slot.
        """
        if self.limit <= 0:  # explicitly disabled
            return Decision(allowed=True, remaining=0)
        now = time.monotonic() if now is None else now

        window = self._windows.get(key)
        if window is None or now - window.started_at >= self.window_s:
            return Decision(allowed=True, remaining=self.limit)
        # `>=`, not `>`. `FixedWindowLimiter.check` counts and decides in one
        # call, so it lets exactly `limit` REQUESTS through by refusing the
        # request whose own increment would push the count past the limit —
        # `count > limit` after incrementing. This method cannot do that: the
        # count for the request under consideration does not exist yet, because
        # whether this request fails is not known until after `call_next`
        # returns. So the equivalent statement is in terms of failures already
        # on the books — once `limit` failures have already happened, the
        # NEXT request is refused before it gets the chance to become one more.
        # Using `>` here would let exactly one extra failing request through
        # every window, silently, and the test that would have caught it did.
        if window.count >= self.limit:
            elapsed = now - window.started_at
            return Decision(
                allowed=False,
                remaining=0,
                # Always at least 1, same reasoning as FixedWindowLimiter.check:
                # "retry in 0 seconds" is the instruction that caused the block.
                retry_after_s=max(1, int(self.window_s - elapsed) + 1),
            )
        return Decision(allowed=True, remaining=self.limit - window.count)

    def record_failure(self, key: str, *, now: float | None = None) -> None:
        """Count one 401 against `key`. Call only on that outcome — this has
        no opinion about which responses qualify, the caller does.

        Also the only place `AUTH_FAILURE_WARN_THRESHOLDS` is checked — see
        `_warn_threshold_crossed` for why a crossing fires once, not on every
        request past the line.
        """
        if self.limit <= 0:  # explicitly disabled
            return
        now = time.monotonic() if now is None else now

        window = self._windows.get(key)
        if window is None or now - window.started_at >= self.window_s:
            if window is None and len(self._windows) >= self.max_keys:
                self._sweep(now)
                if len(self._windows) >= self.max_keys:
                    # Table full of live entries. Same direction as
                    # FixedWindowLimiter: degrade to not tracking this caller,
                    # never to refusing a caller we cannot even identify.
                    self.saturated_admissions += 1
                    return
            window = _FailureWindow(started_at=now, count=0)
            self._windows[key] = window
        window.count += 1

        # Ascending order matters when `limit` is small enough that one
        # failure crosses more than one threshold at once (e.g. limit=2:
        # count 1->2 crosses both 0.5 and 0.8 in the same call) — each
        # newly-crossed threshold still gets exactly one warning.
        for threshold in AUTH_FAILURE_WARN_THRESHOLDS:
            if threshold in window.warned_thresholds:
                continue
            if window.count / self.limit >= threshold:
                window.warned_thresholds.add(threshold)
                self._warn_threshold_crossed(key, window.count, threshold)

    def _warn_threshold_crossed(self, key: str, count: int, threshold: float) -> None:
        """One signal per (address, window, threshold) — see
        `AUTH_FAILURE_WARN_THRESHOLDS` for why this exists at all.

        `sentry_sdk.capture_message` rather than `logger.warning` alone,
        because a bare log call would not reach Sentry as its OWN alert:
        sentry-sdk's default `LoggingIntegration` only turns WARNING+ logs
        into breadcrumbs attached to some LATER event (`event_level` defaults
        to ERROR), and there may never be a later event — the whole point
        here is to be told before anything else goes wrong. `capture_message`
        files a Sentry issue directly, and is a documented no-op when Sentry
        was never initialised (dev, CI, every test in this file), so no
        environment check is needed here — the same reason `client_address`
        never checks whether `TRUSTED_CALLER_TOKEN` is set before comparing
        against it.

        The log call stays too, for the environments Sentry is not wired up
        in and for anyone reading Cloud Run's own logs directly.
        """
        message = (
            f"auth-failure throttle: {key} crossed {threshold:.0%} of its "
            f"ceiling ({count}/{self.limit} failures in the current "
            f"{self.window_s:.0f}s window)"
        )
        logger.warning(message)
        sentry_sdk.capture_message(message, level="warning")

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


def client_address(headers: Mapping[str, str], peer: str | None) -> str:
    """Best available identifier for the caller, given one trusted proxy.

    `headers` is any string-keyed, case-insensitive-lookup mapping — a plain
    `dict` with lowercase keys in tests, or `request.headers` (Starlette's own
    `Headers`) in the app. Passing `request.headers` directly is deliberate:
    it is already case-insensitive, so building a lowercased copy first would
    only add an allocation this function does not need.

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

    ## Cloudflare (ai-ops#141) does not change any of this — checked, not assumed

    Owner ruling ai-ops#141 puts Cloudflare in front of Vercel for `leonaqt.com`
    (DNS + CDN only, no WAF), not yet flipped as of this writing. Once it is,
    `apps/web`'s own address derivation has to switch to `cf-connecting-ip` —
    Vercel's edge and everything behind it will see one Cloudflare anycast
    address for every visitor on Earth, and `X-Forwarded-For` alone collapses.
    That is a real, separate change, made in `apps/web/lib/contact-rate-limit.ts`.

    This service is not in that request path, and adding the same preference
    here would be wrong rather than merely unnecessary. Checked directly rather
    than assumed from "it's behind the same domain":

    - **No Cloud Run domain mapping exists for this service in any region**
      (`gcloud beta run domain-mappings list --project majorana-core`, every
      region, empty). Cloud Run only accepts traffic on a custom domain through
      an explicit mapping; without one, the only address this service answers
      on is its own `*.a.run.app` hostname.
    - **No DNS record for an API subdomain exists in the `leonaqt.com` zone**
      (`api.leonaqt.com`, `majorana-api.leonaqt.com` — both NXDOMAIN). Cloudflare
      can only proxy a hostname it holds authoritative DNS for; there is none
      here for it to intercept.
    - **Every caller that reaches this service — the BFF's authenticated proxy
      (`control-plane.ts`'s `CONTROL_PLANE_URL`), the anonymous catalog SSR
      fetch (`repository-source.ts`'s `API_URL`), and the GCP uptime checks —
      addresses it by `NEXT_PUBLIC_API_URL`, confirmed in production (the live
      site's CSP `connect-src`) to be the raw
      `majorana-api-nikekeixtq-uw.a.run.app` URL, not a `leonaqt.com` subdomain.**

    So every request this service receives arrives at Cloud Run's own front end
    directly — the same front end that already sets `X-Forwarded-For` today —
    whether the Cloudflare flip has happened or not. There is no hop between the
    caller and this service for Cloudflare to sit on.

    **The forgery analysis, run anyway because the caller reaches this service
    either way:** preferring `cf-connecting-ip` here would not merely do
    nothing — it would make things worse. Because no request to this service
    ever actually passes through Cloudflare, nothing here could ever verify
    that header; any value on it is exactly as client-supplied as a forged
    `X-Forwarded-For` entry, except with no unforgeable fallback behind it. The
    existing `X-Forwarded-For` design at least has Cloud Run's own front end as
    the source of truth for *a* real address, even though the first (client)
    entry is the one read; trusting `cf-connecting-ip` on a service Cloudflare
    never touches would hand an attacker a second, unaudited way to pick their
    own bucket, on top of the one already accepted above. If this service is
    ever given a domain inside a Cloudflare-proxied zone, this reasoning is
    what to revisit — not before.
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


def is_trusted_caller(headers: Mapping[str, str], expected: str) -> bool:
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
