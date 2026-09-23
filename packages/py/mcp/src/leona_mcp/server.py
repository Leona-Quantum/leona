"""The MCP server: eight tools over the public Atlas and, with a token, runs and Qapps.

Run it as `leona-mcp`. It speaks MCP over stdin and stdout, opens no port, and
makes network calls only through `leona_client` — the anonymous catalog endpoint for
`search_methods`/`get_method`/`list_problem_areas`, and the authenticated control
plane for `run_verified`/`get_run`/`list_my_runs`/`estimate_resources`/`run_qapp`.
Logging goes to stderr, because stdout carries the protocol.

The acting tools (proposal 7 Phase C, ai-ops 349/362) take their token ONLY from the
`LEONA_API_TOKEN` environment variable — never a tool argument, so no MCP client, log
or transcript ever carries it. With no token set they answer with a plain message
telling the caller to mint one; the three read-only Atlas tools are unaffected. No
hardware tool exists here: ai-ops 362's ruling was "hardware jobs come later under
their own permission," and `leona_client.Client` has no method that could reach
`POST /qpu/submissions` in the first place.

`run_qapp` (ai-ops 349 option 2, "call it as an API") calls a published Qapp through
the exact same `POST /v1/qapps/{slug}/executions` route the Qapp's own page calls —
not a second execution path, only a second class of caller reaching the one ADR-0031
already describes.
"""

from __future__ import annotations

import argparse
import functools
import logging
import sys
from typing import Annotated, Any, Literal

import anyio
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

from leona_client import Client, LeonaClientError
from leona_client.atlas import (
    DEFAULT_RESULTS,
    MAX_RESULTS,
    SearchLimits,
    method_detail,
    normalize_slug,
    problem_area_counts,
    resolve_problem_area,
    search,
    similar_slugs,
)
from leona_client.catalog import CatalogClient

from . import __version__

SERVER_NAME = "leona-atlas"

INSTRUCTIONS = (
    "This server reads the Quantum Atlas, the public catalog of quantum algorithms, gates, "
    "states and benchmark circuits at leonaqt.com, and — when the LEONA_API_TOKEN "
    "environment variable holds a personal access token minted on leonaqt.com (Account → "
    "Access tokens) — can start a verified run, read its result, estimate physical "
    "resources, and call a published Qapp for its result, on the caller's behalf. It reads "
    "Leona's public, read-only API and nothing else for "
    "search_methods/get_method/list_problem_areas: every answer comes from a "
    "published record and carries that record's page URL; get_method also returns the "
    "papers the record cites. A record is a claim from its cited sources, not a result "
    "this server checked or ran, so quote it as the record's claim. When a record does "
    "not carry a field, the answer says 'not stated in the record' rather than filling it "
    "in. A good order for those three: list_problem_areas or search_methods to find "
    "candidates, then get_method on a slug for the full record. run_verified spends the "
    "caller's own run quota and Leona's LLM budget, the same as starting a run on the "
    "website — nothing else here spends money or a quota. A run's status can be "
    "'succeeded' while its verification did not pass: read verifier_decision and "
    "verification_summary, never just status, before telling anyone a result is verified. "
    "run_qapp spends the caller's own Qapp-execution allowance exactly like opening the "
    "Qapp's page and running it would — a private Qapp someone else owns is refused as not "
    "found, never disclosed as existing. No tool here submits hardware jobs."
)

SEARCH_DESCRIPTION = (
    "Find Atlas records that fit a problem and some hard limits. The limits work like the "
    "method finder on leonaqt.com: a record is dropped only when it states a value that "
    "breaks a limit. A record that does not state its qubits or depth, or states them in a "
    "form that is not a single number (for example 'n + 1'), stays in the results with the "
    "verdict 'not-stated' for that limit, so check those yourself. "
    "'query' matches any of its words, or all of them with match_all=true, anywhere in a "
    "record's title, description, algorithm family, framework, provenance or tags, ignoring "
    "case. Common words such as 'quantum' match most records. "
    "Results are unranked candidates, sorted by slug: judge relevance yourself, and use "
    "offset to page when total_matches is more than came back. excluded_by_only counts, for "
    "each limit you set, the records that fail only that limit. "
    "hardware='nisq' keeps records that publish a runnable circuit. hardware='fault-tolerant' "
    "never drops a record here, because this server does not read the cost estimator; it "
    "only marks records that say they need fault tolerance."
)

GET_DESCRIPTION = (
    "Read one Atlas record in full: description, introduction and explanation; the cost the "
    "record states; its speedup class and whether that class was checked against the "
    "record's own primary paper; its verification tier, methods and caveat; the literature "
    "it cites (title, authors, year, link); its resource rows; and the OpenQASM 3 of its "
    "circuit when it has one. Any field the record does not carry reads 'not stated in the "
    "record'. Nothing is estimated or filled in. Accepts a slug or a record URL."
)

LIST_DESCRIPTION = (
    "List the problem areas the Atlas tags records with (chemistry, optimization, finance "
    "and so on), each with its definition and how many records carry it. A record can carry "
    "more than one. Pass an id to search_methods as problem_area."
)

_NEEDS_TOKEN = (
    "Needs a personal access token in the LEONA_API_TOKEN environment variable "
    "(leonaqt.com → Account → Access tokens). "
)

RUN_VERIFIED_DESCRIPTION = (
    _NEEDS_TOKEN + "Starts a Nala run — the same pipeline and the same POST /v1/runs route the "
    "website's Run box calls — as the token's own account, then polls for up to "
    "wait_s seconds for it to reach a terminal state (succeeded, failed or "
    "cancelled). Returns the run AS IT STOOD when it stopped waiting, including its "
    "verification record: 'verified' is true only when verifier_decision is 'pass'. "
    "A 'succeeded' status with verified=false means the pipeline finished but did not "
    "establish the code does what was asked — read verification_summary for why. If "
    "wait_s runs out first the run is still going; call get_run with the returned id "
    "later. Needs the token's run scope; a read-only token is refused."
)

GET_RUN_DESCRIPTION = _NEEDS_TOKEN + (
    "Reads one run by id: its status, and — once it has one — its verification "
    "record. Only the token owner's own runs are reachable."
)

LIST_RUNS_DESCRIPTION = _NEEDS_TOKEN + (
    "Lists the token owner's own runs, most recent first, optionally filtered to one "
    "status (queued, running, succeeded, failed, cancelled)."
)

ESTIMATE_DESCRIPTION = _NEEDS_TOKEN + (
    "Turns a logical cost you state — logical qubits, Toffoli and/or T gates, "
    "optionally a serial non-Clifford depth — at 1 to 16 problem sizes into physical "
    "qubits and wall-clock time under a named built-in assumption set (default "
    "gidney-2025@v2). This costs exactly the numbers you give it; it does not know "
    "how a cost grows with problem size and invents nothing. A point with no Toffoli "
    "or T count comes back with 'refused' explaining there is no magic-state cost to "
    "convert. Any signed-in token may call this — it is arithmetic over a public "
    "rate card, the same as the website's own estimate panel."
)

RUN_QAPP_DESCRIPTION = (
    _NEEDS_TOKEN + "Calls a published Qapp with input values — the same "
    "POST /v1/qapps/{slug}/executions route the Qapp's own page calls, and the same "
    "sandboxed execution the page runs (no separate execution path exists for this "
    "tool) — then polls for up to wait_s seconds for a terminal status (succeeded or "
    "failed). inputs is validated server-side against the Qapp's own declared input "
    "schema; an input outside its declared type, range or enum is refused (422) "
    "before anything runs. This spends the caller's own Qapp-execution allowance "
    "exactly like opening the Qapp's page and clicking run would, and is subject to "
    "the same per-account, per-Qapp and deployment-wide hourly ceilings. A Qapp "
    "someone else owns and has not published, or a slug that does not exist, is "
    "refused as not found — this is not a way to probe who owns a slug. Needs the "
    "token's run scope; a read-only token is refused. If wait_s runs out first the "
    "execution is still going; poll it again with the returned id."
)

_READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)

#: Needs a token and has a side effect (starts or advances a run) — not read-only,
#: not idempotent (each call is a new run), and not destructive (nothing is deleted).
_ACTING = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=True,
)

#: Needs a token but has no side effect: reading a run, or costing a stated point
#: against a public rate card.
_AUTHENTICATED_READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)

#: How long `run_verified` polls before giving up and returning control to the
#: caller. The run itself keeps going either way. Kept well under most MCP clients'
#: own per-call timeout so a caller sees this tool's own message rather than a
#: generic client-side timeout with no guidance.
DEFAULT_WAIT_S = 240
MAX_WAIT_S = 570
DEFAULT_POLL_S = 3.0


class EstimatePoint(BaseModel):
    """One problem size to cost. Mirrors `LogicalPoint` in
    `services/api/src/majorana_api/routes/estimates.py` — kept local rather than
    imported, since that module is inside the control plane this package's import
    contract keeps out."""

    label: str = Field(min_length=1, max_length=120, description="A name for this problem size.")
    logical_qubits: int = Field(ge=1, description="Logical qubits the source states at this size.")
    toffoli_count: int = Field(default=0, ge=0, description="Toffoli gates the source states.")
    t_count: int = Field(
        default=0, ge=0, description="T gates the source states, if counted instead of Toffolis."
    )
    non_clifford_depth: int = Field(
        default=0,
        ge=0,
        description="The serial non-Clifford chain length, if the source states one.",
    )
    parameter_value: float | None = Field(
        default=None,
        description="The problem parameter this point is at — echoed back, never read.",
    )


def _token_client() -> Client:
    """`Client.from_env()`, but refused up front with the guidance the plan asks for
    rather than surfacing a bare 'LEONA_API_TOKEN is not set' from deep inside a
    call. Reading the read-only Atlas tools never reaches this function."""
    client = Client.from_env()
    if not client.token:
        raise LeonaClientError(
            "This tool needs a personal access token. Set LEONA_API_TOKEN in your "
            "environment (leonaqt.com → Account → Access tokens) and restart this "
            "MCP server; the search_methods/get_method/list_problem_areas tools work "
            "without one."
        )
    return client


async def _in_thread(func: Any, /, *args: Any, **kwargs: Any) -> Any:
    """Run a blocking `leona_client.Client` call off the event loop.

    `Client` is synchronous (stdlib `urllib`, shared with `%nala`); `run_verified`
    polls for up to `MAX_WAIT_S` seconds, and blocking the stdio server's own event
    loop for that long would stall every other request this process could otherwise
    still answer.
    """
    return await anyio.to_thread.run_sync(functools.partial(func, *args, **kwargs))


def build_server(client: CatalogClient | None = None) -> FastMCP:
    """The server with its seven tools. Tests pass a `CatalogClient` with a mock
    transport for the three read-only ones; the acting tools build their own
    `leona_client.Client` per call from `LEONA_API_TOKEN`, so tests for those
    construct a `Client` directly with a fake transport instead."""
    catalog = client or CatalogClient()
    # WARNING, not the SDK's INFO default: INFO logs every request and every HTTP call
    # to stderr, which an MCP client shows its user as noise.
    server = FastMCP(SERVER_NAME, instructions=INSTRUCTIONS, log_level="WARNING")
    # FastMCP takes no version and the SDK then reports its own ("1.30.0") as the
    # server's in `serverInfo`. The low-level server it wraps reads this attribute;
    # a test pins the handshake so an SDK change here fails rather than misreports.
    server._mcp_server.version = __version__

    @server.tool(
        name="search_methods",
        title="Search the Atlas",
        description=SEARCH_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def search_methods(
        query: Annotated[
            str,
            Field(description="Words to look for. Empty means no text filter."),
        ] = "",
        problem_area: Annotated[
            str | None,
            Field(
                description=(
                    "A problem area id from list_problem_areas, such as 'chemistry' or "
                    "'linear-algebra'. Its label also works."
                )
            ),
        ] = None,
        max_qubits: Annotated[
            int | None,
            Field(ge=0, description="Drop records that state more qubits than this."),
        ] = None,
        max_depth: Annotated[
            int | None,
            Field(ge=0, description="Drop records that state a greater depth than this."),
        ] = None,
        hardware: Annotated[
            Literal["any", "nisq", "fault-tolerant"],
            Field(description="'nisq' keeps records with a runnable circuit. See above."),
        ] = "any",
        match_all: Annotated[
            bool,
            Field(description="Require every query word, not just one."),
        ] = False,
        limit: Annotated[
            int,
            Field(ge=1, le=MAX_RESULTS, description=f"Rows to return, at most {MAX_RESULTS}."),
        ] = DEFAULT_RESULTS,
        offset: Annotated[
            int,
            Field(ge=0, description="Rows to skip, for paging."),
        ] = 0,
    ) -> dict[str, Any]:
        area = resolve_problem_area(problem_area).id if problem_area else None
        limits = SearchLimits(
            query=query,
            match_all=match_all,
            problem_area=area,
            max_qubits=max_qubits,
            max_depth=max_depth,
            hardware=hardware,
        )
        return search(await catalog.rows(), limits, max_results=limit, offset=offset)

    @server.tool(
        name="get_method",
        title="Read one Atlas record",
        description=GET_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def get_method(
        slug: Annotated[
            str,
            Field(
                description=(
                    "The record's slug, as search_methods returns it, or its "
                    "https://leonaqt.com/repository/<slug> URL."
                )
            ),
        ],
    ) -> dict[str, Any]:
        wanted = normalize_slug(slug)
        rows = await catalog.rows()
        for row in rows:
            if row.slug == wanted:
                return method_detail(row)
        hint = similar_slugs(rows, wanted)
        suffix = f" Slugs containing that text: {', '.join(hint)}." if hint else ""
        raise ValueError(
            f"No published Atlas record has the slug {wanted!r}.{suffix} "
            "search_methods finds slugs."
        )

    @server.tool(
        name="list_problem_areas",
        title="List problem areas",
        description=LIST_DESCRIPTION,
        annotations=_READ_ONLY,
    )
    async def list_problem_areas() -> dict[str, Any]:
        rows = await catalog.rows()
        return {"problem_areas": problem_area_counts(rows), "records_in_atlas": len(rows)}

    @server.tool(
        name="run_verified",
        title="Start a verified Nala run",
        description=RUN_VERIFIED_DESCRIPTION,
        annotations=_ACTING,
    )
    async def run_verified(
        prompt: Annotated[
            str,
            Field(
                min_length=1,
                max_length=20_000,
                description="What Nala should build or answer — the same box the website's Run panel takes.",
            ),
        ],
        framework: Annotated[
            Literal["qiskit", "pennylane", "cirq", "braket", "qibo", "qulacs"],
            Field(description="The SDK the generated code should target."),
        ] = "qiskit",
        seed: Annotated[
            int | None, Field(ge=0, description="A fixed RNG seed, for a reproducible run.")
        ] = None,
        shots: Annotated[
            int | None, Field(ge=1, le=20_000, description="Shots for the final execution.")
        ] = None,
        timeout_s: Annotated[
            int | None, Field(ge=1, le=600, description="The run's own backend execution timeout.")
        ] = None,
        wait_s: Annotated[
            int,
            Field(
                ge=1,
                le=MAX_WAIT_S,
                description="How long THIS TOOL polls for a terminal state before giving up.",
            ),
        ] = DEFAULT_WAIT_S,
    ) -> dict[str, Any]:
        client = _token_client()
        run = await _in_thread(
            client.start_run,
            prompt,
            framework=framework,
            seed=seed,
            shots=shots,
            timeout_s=timeout_s,
        )
        run = await _in_thread(
            client.wait_for_run, str(run.id), wait_s=wait_s, poll_s=DEFAULT_POLL_S
        )
        return _run_result(run)

    @server.tool(
        name="get_run",
        title="Read one run",
        description=GET_RUN_DESCRIPTION,
        annotations=_AUTHENTICATED_READ_ONLY,
    )
    async def get_run(
        run_id: Annotated[
            str, Field(description="A run id, as run_verified or list_my_runs returned it.")
        ],
    ) -> dict[str, Any]:
        client = _token_client()
        run = await _in_thread(client.get_run, run_id)
        return _run_result(run)

    @server.tool(
        name="list_my_runs",
        title="List my runs",
        description=LIST_RUNS_DESCRIPTION,
        annotations=_AUTHENTICATED_READ_ONLY,
    )
    async def list_my_runs(
        limit: Annotated[
            int, Field(ge=1, le=100, description="At most this many runs, most recent first.")
        ] = 20,
        status: Annotated[
            Literal["queued", "running", "succeeded", "failed", "cancelled"] | None,
            Field(description="Only runs in this status."),
        ] = None,
    ) -> dict[str, Any]:
        client = _token_client()
        runs = await _in_thread(client.list_runs, status=status, limit=limit)
        return {"runs": [_run_result(run) for run in runs]}

    @server.tool(
        name="estimate_resources",
        title="Estimate physical qubits and runtime",
        description=ESTIMATE_DESCRIPTION,
        annotations=_AUTHENTICATED_READ_ONLY,
    )
    async def estimate_resources(
        points: Annotated[
            list[EstimatePoint],
            Field(min_length=1, max_length=16, description="1 to 16 problem sizes to cost."),
        ],
        assumptions: Annotated[
            str | None,
            Field(
                description="A built-in assumption-set key, e.g. 'gidney-2025@v2'. Defaults to that set."
            ),
        ] = None,
    ) -> dict[str, Any]:
        client = _token_client()
        return await _in_thread(
            client.estimate_resources,
            [point.model_dump(exclude_none=True) for point in points],
            assumptions=assumptions,
        )

    @server.tool(
        name="run_qapp",
        title="Call a published Qapp",
        description=RUN_QAPP_DESCRIPTION,
        annotations=_ACTING,
    )
    async def run_qapp(
        slug: Annotated[
            str,
            Field(
                min_length=1,
                description="A Qapp's slug, as its leonaqt.com/q/<slug> page shows it.",
            ),
        ],
        inputs: Annotated[
            dict[str, Any] | None,
            Field(
                description=(
                    "Input values, shaped to this Qapp's own declared input schema — read "
                    "its /q/<slug> page, or ask its creator, for what it takes. Omit for a "
                    "Qapp whose schema supplies defaults for everything."
                ),
            ),
        ] = None,
        wait_s: Annotated[
            int,
            Field(
                ge=1,
                le=MAX_WAIT_S,
                description="How long THIS TOOL polls for a terminal state before giving up.",
            ),
        ] = DEFAULT_WAIT_S,
    ) -> dict[str, Any]:
        client = _token_client()
        execution = await _in_thread(client.start_qapp_execution, slug, inputs)
        execution = await _in_thread(
            client.wait_for_qapp_execution,
            str(execution.id),
            wait_s=wait_s,
            poll_s=DEFAULT_POLL_S,
        )
        return execution.model_dump(mode="json")

    return server


def _run_result(run: Any) -> dict[str, Any]:
    """A run as JSON, plus an explicit `verified` the caller cannot mistake for
    `status`: `verifier_decision` is `pass`/`fail`/`inconclusive`/absent, and only
    `pass` means verified. Keeping this separate from `model_dump` is the point —
    a caller that only reads `status == "succeeded"` would otherwise report an
    unverified result as one."""
    data = run.model_dump(mode="json")
    data["verified"] = data.get("verifier_decision") == "pass"
    return data


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="leona-mcp",
        description=(
            "An MCP server over the public Quantum Atlas at leonaqt.com, and, with a "
            "personal access token in LEONA_API_TOKEN, verified runs and resource "
            "estimates. Set LEONA_API_URL to read a different Leona API."
        ),
    )
    parser.add_argument("--version", action="version", version=f"leona-mcp {__version__}")
    parser.parse_args(argv)
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.WARNING,
        format="leona-mcp: %(levelname)s %(message)s",
    )
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
