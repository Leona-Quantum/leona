"""Which routes a personal access token may reach, and on which of its scopes.

The owner's ruling, **ai-ops 362 option 1**, quoted in full because every rule below
is one clause of it:

    "Tokens may read and start verified runs, and expire after at most 90 days;
    hardware jobs come later under their own permission"

and, from the question he was answering, the standing exclusion: a token *"would never
work on the pages that hold their IBM key, billing, or account deletion"*.

## The shape: reads default open, writes default SHUT

A token with `read` may `GET` anything except the few templates named in
`READ_DENIED`. A token may perform a write — `POST`, `PATCH`, `PUT`, `DELETE` — only
if that exact (method, template) pair is named in `READ_WRITES` or `RUN_WRITES`. There
is no third case, and in particular there is no "anything else is probably fine".

That asymmetry is the whole design, and it is the opposite of the rule
`scripts/vercel-ignore-build.sh` uses, deliberately. There, an unrecognised package
must BUILD, because the cost of being wrong is a wasted build. Here, an unrecognised
route must be REFUSED, because the cost of being wrong is a credential reaching
something nobody reviewed. So a route added next month is unreachable by every
existing token until somebody adds it to a list in this file, which is a line a
security review can actually be asked to look at.

`test_token_access.py` holds the other half of that promise: it walks the live
OpenAPI schema and asserts that every write template is either in a list here or
provably refused, so "we forgot" fails in CI rather than in production.

## Hardware: the deferral resolved (ai-ops 376, option 2)

`POST /qpu/submissions` — the route that spends a person's own hardware allowance —
used to appear in no allowlist at all, refused by the default-shut rule with no scope
able to reach it, because `TokenScope` had no `hardware` member to grant. The owner's
ruling on ai-ops 376, quoted in full because this whole block is one clause of it:

    "Add a separate 'hardware' permission a person must tick when creating a token.
    With it, leona_submit in their own Jupyter or VS Code submits directly, priced
    and counted against the same weekly allowance."

`HARDWARE_WRITES` below is that permission's allowlist entry, and `TokenScope.HARDWARE`
(added CONTRACTS_VERSION 2.37.0) is the scope it is gated on. It is its own set, not
folded into `RUN_WRITES`, and gated on its own scope, not `TokenScope.RUN`: starting a
verified run and submitting to real hardware spend two different weekly allowances, and
a token minted for one must not silently gain the other. A token holding `run` but not
`hardware` is refused here exactly as a `read`-only token is — `check()` below does not
special-case either. `TokenScope.HARDWARE` does not imply `RUN` either, for the same
reason in the other direction: see `TokenScope`'s own docstring for why a token minted
only to submit already-built circuits from a person's own code should not, by that fact
alone, also be able to start Leona's own generation runs. Pricing a circuit (`POST
/qpu/estimates`) needs neither scope — it is in `READ_WRITES`, reachable by every token
— so a `hardware`-only token can still price before it submits.

## Matched on the route TEMPLATE, never the raw path

As `DEPLOY_PROBE_ROUTES` in `deps.py` already argues: a raw-path match has to reason
about trailing slashes, percent-encoding and `..` segments, while the template is what
FastAPI actually decided to run. The templates here are as each sub-router registered
them, without the `/v1` the app mounts them under — that is the value FastAPI puts in
`scope["route"]` — and the mount point is checked separately rather than assumed. If a
future FastAPI changes that shape, nothing matches, and the default-shut rule means
every token is refused everywhere: loud, and in the safe direction.
"""

from __future__ import annotations

from dataclasses import dataclass

from majorana_contracts.tokens import TokenScope

#: Every router in `app.py` is mounted here, checked so an unprefixed template cannot
#: be reached through some future second mount point.
V1_PREFIX = "/v1/"

#: Templates a token may not even READ. Short, and each entry is one clause of what the
#: owner said a token must never reach.
READ_DENIED: frozenset[tuple[str, str]] = frozenset(
    {
        # The IBM key. `GET` returns no key material, but it does answer "does this
        # person have a hardware account, and what did they label it" — which is
        # account-settings information about a credential a token may not use.
        ("GET", "/qpu/credentials"),
        # Billing.
        ("GET", "/billing/status"),
        # A token must not be able to enumerate the account's other tokens: knowing
        # what automations exist, when each was last used and when each expires is
        # reconnaissance for which one to go after, and it is account settings.
        ("GET", "/tokens"),
    }
)

#: Write-shaped requests a `read` token may make. Each earns its place by doing
#: nothing a GET would not:
#:
#: - `POST /qpu/estimates` is arithmetic over the rate card in `majorana_qpu`
#:   (`routes/qpu.py::qpu_estimate` takes no session), so it touches no database,
#:   no provider and no money. It is a POST only because it takes a body.
#: - `POST /estimates/logical` (proposal 7 Phase C, ai-ops 349/362) is the same
#:   shape: `routes/estimates.py::estimate_logical` also takes no session and
#:   costs exactly the numbers the caller sends through `majorana_estimation`,
#:   nothing stored, nothing charged. Added here deliberately, not by default —
#:   its own module docstring said "until someone allowlists it deliberately"
#:   and this is that decision, made because a token-holding MCP client
#:   (`leona_mcp`'s `estimate_resources` tool) is the first caller who needs it
#:   and the route has no side effect a `read` token shouldn't already have.
#: - `POST /plans` (ai-ops 382, Phase B slice S2) is the same shape again:
#:   `routes/plans.py::plan` takes no session and evaluates the workflow
#:   planner's closed-form formulas (`leona_planner`) over the numbers the caller
#:   sends, nothing stored, nothing charged, no provider, nothing executed. A
#:   POST only because it takes a body. Added deliberately for `leona_mcp`'s
#:   `plan_workflow` tool, whose answer is meant to be handed straight to
#:   `/estimates/logical` above, so a token that may estimate may plan.
#:
#: The plan's own pitch for this feature is "an Atlas method, a verified run or an
#: estimate", and an estimate should not need the power to start a run.
READ_WRITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/qpu/estimates"),
        ("POST", "/estimates/logical"),
        ("POST", "/plans"),
    }
)

#: What `run` adds: start a verified run, stop one you started, start a published
#: Qapp's own sandboxed execution, or have a circuit checked. Cancelling a run is here
#: rather than in a scope of its own because a credential that can start work it cannot
#: stop is worse for the account holder, not better.
#:
#: ## Notebooks (ai-ops 362, the Bridge lane, 2026-09-23)
#:
#: `%nala`/the `leona-notebooks` CLI drive notebooks over this same API with a
#: personal access token — `jupyter.py`'s own module docstring has named
#: `LEONA_API_TOKEN` from before this change, and the Bridge lane's brief opens
#: by naming the symptom this fixes: "`%nala new/push/ask` cannot work with a
#: PAT" today, because every notebook write was refused for a token
#: unconditionally. Every one of those commands that does real work — generate,
#: push (new or as a new version), ask Nala a follow-up, re-run, grade an
#: attempt — is, underneath, one of the six `routes/notebooks.py` handlers that
#: call `runs_repo.create_run(mode=RunMode.NOTEBOOK)`: the exact mechanism
#: ai-ops 362 says a token may drive ("tokens may read and start verified
#: runs"). Each one already goes through `_gate_notebook_run`, the identical
#: abuse/tier backstop `POST /runs` applies, so a token cannot use a notebook
#: route to start more sandboxed work than the `run` scope already lets it
#: start directly.
#:
#: - `POST /notebooks` — `create_notebook`: generate a new notebook from a brief
#:   (`%nala new`, `leona-notebooks new`).
#: - `POST /notebooks/import` — `import_notebook`: `%nala push <file.ipynb>`
#:   with no `--to` — a notebook imported whole from a reader's own `.ipynb`,
#:   which spends a run only when the request asks to re-run it
#:   (`execute: true`, the CLI/magic default). Named explicitly in the brief as
#:   one of the three things a PAT could not do before this change, so it is
#:   included even though the run it starts is conditional on the request body
#:   — the same way `execute=false` on `author_notebook_version` below is.
#: - `POST /notebooks/{notebook_id}/turns` — `create_notebook_turn`: a Nala
#:   follow-up (`%nala ask`/`%nala fix`), which revises the notebook and costs
#:   a run exactly as generation does.
#: - `POST /notebooks/{notebook_id}/run` — `rerun_notebook`: re-run the current
#:   version from a fresh sandbox (`%nala run` with no file).
#: - `POST /notebooks/{notebook_id}/versions` — `author_notebook_version`: push
#:   a version written locally (Jupyter, VS Code, `%nala push --to`/`%nala
#:   run --to`). Only the `execute=true` branch spends a run; `execute=false`
#:   writes a draft with no run at all, but the policy is checked by
#:   route+method, not by request body, so both branches are reachable with
#:   `run` — the same shape this route already had for a signed-in browser
#:   session.
#: - `POST /notebooks/{notebook_id}/attempts` — `grade_notebook_attempt`: grade
#:   a reader's own answer, which executes THEIR code in the sandbox and so
#:   costs a run under the identical gate a re-run does.
#:
#: All six `runs_repo.create_run(mode=RunMode.NOTEBOOK)` call sites in
#: `routes/notebooks.py` are covered above — checked by grep, not assumed, so
#: a seventh appearing later is caught by `test_every_write_route_is_refused_
#: unless_it_was_deliberately_allowed` rather than silently inheriting whatever
#: a token could already do to its neighbours.
#:
#: ## Courses (same ruling)
#:
#: `routes/courses.py` has three routes that call `runs_repo.create_run` — `POST
#: /courses` (plans a course: `COURSE_PLAN_JOB_KIND`), `POST
#: /courses/{course_id}/generate` (generates the selected modules' notebooks),
#: and `POST /courses/{course_id}/turns` (revises the plan in chat:
#: `COURSE_REVISE_JOB_KIND`) — but only the middle one is a *notebook
#: generation* run in the sense this list already grants: `generate_course`
#: creates the run itself and then calls the SAME `create_notebook_and_enqueue`
#: that `POST /notebooks` uses, dispatching `NOTEBOOK_GENERATE_JOB_KIND` per
#: module — the identical job a token can already start directly via `POST
#: /notebooks`, just addressed at a course's module instead of typed by hand.
#: Course planning and course-plan chat are a different action (there is no
#: notebook yet for either to run), no `%nala`/CLI command reaches them, and
#: the brief that asked for this change never named a course. Left out under
#: the file's own default-shut rule ("a route added next month is unreachable
#: ... until somebody adds it ... loud, and in the safe direction") pending an
#: explicit ask rather than assumed in — flagged in the PR that adds this
#: block for the lead/owner to confirm or widen.
#:
#: - `POST /courses/{course_id}/generate` — `generate_course`.
RUN_WRITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/runs"),
        ("POST", "/runs/{run_id}/cancel"),
        # "Call a Qapp as an API" (ai-ops 349 option 2). This is NOT a new execution
        # path: it is `execute_qapp` (routes/qapps.py), the exact route a signed-in
        # browser session already reaches from the Qapp's own page, which enqueues
        # the exact same sandboxed run through `majorana_sandbox.run` that ADR-0031
        # describes. Widening it to a token is what ai-ops 349's §1a gate is about —
        # a new caller class reaching execution, not a new place execution happens —
        # so it earns its own allowlist entry rather than riding in on `/runs`'s.
        # `run` because it spends the caller's own sandbox allowance and the same
        # three abuse ceilings (`QAPP_EXECUTION_BACKSTOP_PER_HOUR` and friends)
        # exactly as opening the page and clicking run would; `read` alone must not
        # be able to spend that.
        ("POST", "/qapps/{slug}/executions"),
        # Notebooks (see the module docstring above this set for the full account
        # of all six call sites, why each is here).
        ("POST", "/notebooks"),
        ("POST", "/notebooks/import"),
        ("POST", "/notebooks/{notebook_id}/turns"),
        ("POST", "/notebooks/{notebook_id}/run"),
        ("POST", "/notebooks/{notebook_id}/versions"),
        ("POST", "/notebooks/{notebook_id}/attempts"),
        # Courses: only the route that generates notebooks, not plan/revise.
        ("POST", "/courses/{course_id}/generate"),
        # The agent connector's `check_circuit` (ai-ops 382 option 1). NOT in
        # `READ_WRITES` beside `/estimates/logical`, although both are stateless POSTs
        # that store nothing: an estimate is integer arithmetic over the numbers sent,
        # while a check parses the caller's circuit and simulates it, and its broken
        # copies, on Leona's CPU (`routes/checks.py` states the worst case per call).
        # Spending compute on the caller's behalf is what `run` grants, so a `read`
        # token is refused here with INSUFFICIENT_SCOPE, exactly as `/runs` refuses it.
        ("POST", "/checks/circuit"),
    }
)

#: What `hardware` adds, and the ONLY thing it adds: submit an already-built circuit
#: to real quantum hardware, spending the caller's weekly hardware allowance. See the
#: module docstring above ("Hardware: the deferral resolved") for the ruling and why
#: this is its own set, gated on its own scope, rather than riding in on `RUN_WRITES`.
HARDWARE_WRITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/qpu/submissions"),
    }
)

_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True)
class Refusal:
    """Why a token was refused, in words the holder of the token can act on."""

    reason: str
    detail: str


#: Refusal reasons are machine-readable so the web app and the MCP client can tell
#: "this token will never work here" from "mint one with more scope", which are
#: different instructions to the person reading the error.
FORBIDDEN_ROUTE = "token_route_forbidden"
INSUFFICIENT_SCOPE = "token_scope_insufficient"


def check(method: str, template: str, path: str, scopes: frozenset[str]) -> Refusal | None:
    """`None` when the token may proceed, otherwise why not.

    `template` is the resolved route template; `path` is the raw request path, used
    only to confirm the mount point. Pure, and takes no request object, so the policy
    can be tested directly against the route table rather than through a client.
    """
    if not path.startswith(V1_PREFIX):
        return Refusal(
            FORBIDDEN_ROUTE,
            "a personal access token can only be used on the versioned API",
        )

    pair = (method.upper(), template)

    if pair in READ_DENIED:
        return Refusal(
            FORBIDDEN_ROUTE,
            "personal access tokens cannot reach your hardware credential, billing, "
            "or your tokens themselves — sign in on the website for those",
        )

    if method.upper() in _READ_METHODS:
        return None

    if pair in READ_WRITES:
        return None

    if pair in RUN_WRITES:
        if TokenScope.RUN not in scopes:
            return Refusal(
                INSUFFICIENT_SCOPE,
                "this token can read but not start runs; mint one with the run scope",
            )
        return None

    if pair in HARDWARE_WRITES:
        if TokenScope.HARDWARE not in scopes:
            return Refusal(
                INSUFFICIENT_SCOPE,
                "this token cannot submit to hardware; mint one with the hardware scope",
            )
        return None

    return Refusal(
        FORBIDDEN_ROUTE,
        "personal access tokens cannot make this change; sign in on the website",
    )


__all__ = [
    "FORBIDDEN_ROUTE",
    "HARDWARE_WRITES",
    "INSUFFICIENT_SCOPE",
    "READ_DENIED",
    "READ_WRITES",
    "RUN_WRITES",
    "V1_PREFIX",
    "Refusal",
    "check",
]
