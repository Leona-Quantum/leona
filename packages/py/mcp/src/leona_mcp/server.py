"""The MCP server: ten tools over the public Atlas and, with a token, runs, plans, checks.

Run it as `leona-mcp`. It speaks MCP over stdin and stdout, opens no port, and
makes network calls only through `leona_client` — the anonymous catalog endpoint for
`search_methods`/`get_method`/`list_problem_areas`, and the authenticated control
plane for `run_verified`/`get_run`/`list_my_runs`/`estimate_resources`/`run_qapp`/
`check_circuit`/`plan_workflow`.
Logging goes to stderr, because stdout carries the protocol.

The acting tools (proposal 7 Phase C, ai-ops 349/362) take their token ONLY from the
`LEONA_API_TOKEN` environment variable — never a tool argument, so no MCP client, log
or transcript ever carries it. With no token set they answer with a plain message
telling the caller to mint one; the three read-only Atlas tools are unaffected. No
hardware tool exists here. Submitting to hardware (`POST /qpu/submissions`) needs a
token's separate `hardware` scope (ai-ops 376, `token_access.HARDWARE_WRITES`), and
although `leona_client.Client.qpu_submit` can call that route for `leona_submit` in a
notebook, no tool on this server does.

`run_qapp` (ai-ops 349 option 2, "call it as an API") calls a published Qapp through
the exact same `POST /v1/qapps/{slug}/executions` route the Qapp's own page calls —
not a second execution path, only a second class of caller reaching the one ADR-0031
already describes.

`check_circuit` (ai-ops 382 option 1, VISION §5.8) is the connector's reason to exist
beside IBM's own Qiskit MCP servers: it sends a circuit and a property to
`POST /v1/checks/circuit` and returns Leona's verdict with its teeth, whether the check
could tell deliberately broken copies of the circuit from the original. It never calls a
pass "verified", and neither may the model quoting it.

`plan_workflow` (ai-ops 382, Phase B slice S2; VISION §5.8 "plan") sends a problem, its
sizes and any block choices to `POST /v1/plans` and returns the pipeline and the cited
cost lines `leonaqt.com/repository/plan` shows for the same inputs, with a `summary`
that quotes each number with its kind and source. The problems, parameters and choices
its description teaches are generated from the TS planner (`plan_catalog.json`, written
by `scripts/write-planner-fixture.ts`); this package never plans locally.
"""

from __future__ import annotations

import argparse
import functools
import json
import logging
import sys
from importlib import resources
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
from majorana_contracts import MAX_CIRCUIT_CHECK_QASM_CHARS, CheckVerdict
from majorana_contracts.notebooks import (
    CHECK_DISTRIBUTION_MAX_QUBITS,
    CHECK_STATE_MAX_QUBITS,
    CHECK_UNITARY_MAX_QUBITS,
    MAX_CHECK_HAMILTONIAN_QUBITS,
)

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
    "found, never disclosed as existing. check_circuit judges an OpenQASM 3 circuit against "
    "a property (a state, a unitary, a distribution or an energy) with Leona's own trusted "
    "code, stores nothing, and says whether the check could catch deliberately broken copies "
    "of the circuit; report its pass as 'checked against' what it names, never as verified. "
    "plan_workflow returns the pipeline of Atlas blocks and the cited cost lines Leona's "
    "workflow planner gives for a problem at the sizes you state; quote each number with its "
    "kind and source, and pass its estimate_point to estimate_resources for physical qubits "
    "and runtime. No tool here submits hardware jobs."
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

CHECK_CIRCUIT_DESCRIPTION = _NEEDS_TOKEN + (
    "Checks an OpenQASM 3 circuit against ONE property with Leona's own trusted code and "
    "returns pass, fail or inconclusive, a diagnosis on a fail (reversed qubit order, one "
    "wrong phase, a QFT missing its final swaps, the inverse of the reference), and "
    "'teeth': Leona makes deliberately broken copies of the circuit (drops a gate, swaps a "
    "control and target, negates an angle, swaps S/T for their inverses, reverses the "
    "qubit order) and reports how many the check caught. A check that catches none of them "
    "could not tell a broken circuit from yours. Nothing is run on hardware and nothing is "
    "stored. Needs the token's run scope. "
    "THE CIRCUIT: OpenQASM 3 as qiskit.qasm3.dumps writes it, with "
    f'include "stdgates.inc"; up to {MAX_CIRCUIT_CHECK_QASM_CHARS:,} characters; at most '
    f"{CHECK_STATE_MAX_QUBITS} qubits for a state check, {CHECK_DISTRIBUTION_MAX_QUBITS} for "
    f"a distribution check, {CHECK_UNITARY_MAX_QUBITS} for a unitary check and "
    f"{MAX_CHECK_HAMILTONIAN_QUBITS} for an energy check. A wider circuit, or one whose "
    "gate definitions unroll into more than a few thousand gates, is inconclusive. Final "
    "measurements are ignored for state, unitary and energy checks; a measurement or reset "
    "before the end, or if/for/while, makes the check inconclusive. Leona may answer 503 "
    "while it is checking another circuit: wait a few seconds and call again. "
    "BIT ORDER: Qiskit's. q0 is the RIGHTMOST character, so '01' means q0 = 1 and q1 = 0, "
    "and the Pauli string 'ZI' is Z on q1. "
    "KINDS, each with its own expectation arguments and no others: "
    "kind='state' compares the output state from |0...0> with exactly one of reference, "
    "amplitudes or reference_qasm, up to global phase; "
    "kind='unitary' compares the circuit's unitary with reference or reference_qasm, up to "
    "global phase; kind='distribution' compares the ideal measured distribution (exact, no "
    "sampling) with probabilities; kind='energy' compares <psi|H|psi> for hamiltonian "
    f"(Pauli string to coefficient, up to {MAX_CHECK_HAMILTONIAN_QUBITS} qubits and 256 "
    "terms) with target, 'ground' "
    "for the exact ground energy or a number. "
    "LIBRARY REFERENCES, built by Leona from qiskit.circuit.library: for state checks "
    "'bell' ((|00>+|11>)/sqrt 2, the same as 'bell:phi+'), 'bell:phi-', 'bell:psi+', "
    "'bell:psi-', 'ghz(n)', 'w(n)', 'uniform(n)'; for unitary checks 'qft(n)' and 'iqft(n)', "
    "Qiskit's QFT including its final swaps. "
    "AMPLITUDES AND PROBABILITIES map bitstrings to a number or an expression using numbers, "
    "i, pi, e, sqrt(), exp(), cos(), sin() and + - * / **, e.g. {'00': '1/sqrt(2)', "
    "'11': '1/sqrt(2)'}; basis states you leave out are 0. "
    "TOLERANCE defaults: state 1e-6 (on 1 - fidelity), unitary 1e-6 (largest entry of the "
    "difference after removing global phase), distribution 1e-6 (total variation distance), "
    "energy 1e-3 (absolute difference). "
    "THE ANSWER: 'passed' is true only for status 'pass'; 'summary' is one paragraph you can "
    "quote; 'teeth_note' appears when the teeth were not measured. A pass means the circuit "
    "matches what 'checked_against' names, within the tolerance, and nothing more: say "
    "'checked against <checked_against>', never 'verified' or 'proven correct'. The "
    "reference can itself be the wrong target."
)

#: The problems, parameters and root choices `plan_workflow` describes, generated from the
#: TS planner by `scripts/write-planner-fixture.ts` (`plannerToolCatalog`) and checked
#: current by `apps/web/lib/workflow-planner-python-port.test.ts`. Package data, not an
#: import: this package reaches the planner only through `POST /v1/plans`.
PLAN_CATALOG: dict[str, Any] = json.loads(
    resources.files("leona_mcp").joinpath("plan_catalog.json").read_text("utf-8")
)
PLAN_PROBLEMS: tuple[str, ...] = tuple(problem["id"] for problem in PLAN_CATALOG["problems"])


def _plain(value: float) -> str:
    """A range bound as a person writes it: 16384, 1e+30, 0.0016."""
    return str(int(value)) if float(value).is_integer() and abs(value) < 1e7 else f"{value:g}"


def _problem_words(problem: dict[str, Any]) -> str:
    params = []
    for spec in problem["params"]:
        kind = "whole number" if spec["integer"] else "number"
        words = (
            f"{spec['key']} ({spec['label']}; {kind} {_plain(spec['min'])} to {_plain(spec['max'])}"
        )
        if spec["assumed"]:
            words += f"; assumed {_plain(spec['assumed']['value'])} if left out: {spec['assumed']['reason']}"
        params.append(words + ")")
    root = problem["root"]
    methods = ", ".join(
        f"{method['id']}{' (default)' if method['id'] == root['default'] else ''}"
        for method in root["methods"]
    )
    return (
        f"'{problem['id']}': {problem['label']}. "
        + (f"Params: {'; '.join(params)}. " if params else "No params: no numeric cost model yet. ")
        + f"Choice at '{root['path']}': {methods}. "
        + f'E.g. "{problem["example"]}"'
    )


PLAN_DESCRIPTION = _NEEDS_TOKEN + (
    "Plans a quantum algorithm the way leonaqt.com/repository/plan does and returns the same "
    "numbers: the pipeline of Atlas blocks that realises a problem (every stage, the method "
    "chosen there and why, and the other methods that could fill it), and the cost lines the "
    "planner evaluates from published formulas at your sizes. Every line carries its 'kind' "
    "(exact, upper-bound, leading-order, numerical-estimate, published, derived, supplied, or "
    "scaling, which is a magnitude with no constant and never a count) and its 'source' (a "
    "paper, where in it, and a quote). A line whose parameter you did not give has value null "
    "and says which it is 'missing'. A block with no numeric model here has its cost as the "
    "paper states it in 'stated_cost'. 'summary' is one paragraph quoting each number with its "
    "kind and source. 'estimate_point' is this plan's logical cost ready to pass, as one "
    "point, to estimate_resources for physical qubits and runtime. Arithmetic only; nothing "
    "is run or stored; any token may call it. "
    "CHOICES: 'choices' maps a stage 'path' from a previous answer to a method id from that "
    "stage's 'alternatives'; a choice the planner cannot follow is listed in "
    "'ignored_choices'. A value outside a parameter's range is refused with the range. "
    "PROBLEMS: " + " | ".join(_problem_words(problem) for problem in PLAN_CATALOG["problems"])
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

#: Needs a token but has no side effect: reading a run, costing a stated point against a
#: public rate card, or checking a circuit (judged, nothing stored, the same answer for
#: the same input).
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
    """The server with its ten tools. Tests pass a `CatalogClient` with a mock
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
        name="plan_workflow",
        title="Plan a workflow and cost it from its sources",
        description=PLAN_DESCRIPTION,
        annotations=_AUTHENTICATED_READ_ONLY,
    )
    async def plan_workflow(
        problem: Annotated[
            Literal[PLAN_PROBLEMS],  # type: ignore[valid-type]
            Field(description="A planner problem id; the description lists each one."),
        ],
        params: Annotated[
            dict[str, float | None] | None,
            Field(
                description="Parameter key to value, from the problem's list. null clears an "
                "assumed value. Leave one out to keep its assumption."
            ),
        ] = None,
        choices: Annotated[
            dict[str, str] | None,
            Field(
                description="Stage path (from an answer's stages) to the method id to use there."
            ),
        ] = None,
        language: Annotated[
            Literal["en", "ja"],
            Field(description="The language of labels, notes and the summary."),
        ] = "en",
    ) -> dict[str, Any]:
        client = _token_client()
        plan = await _in_thread(client.plan_workflow, problem, params, choices)
        return _plan_result(plan, language)

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

    @server.tool(
        name="check_circuit",
        title="Check a circuit against a property",
        description=CHECK_CIRCUIT_DESCRIPTION,
        annotations=_AUTHENTICATED_READ_ONLY,
    )
    async def check_circuit(
        qasm: Annotated[
            str,
            Field(
                min_length=1,
                max_length=MAX_CIRCUIT_CHECK_QASM_CHARS,
                description='The circuit as OpenQASM 3, with include "stdgates.inc".',
            ),
        ],
        kind: Annotated[
            Literal["state", "unitary", "distribution", "energy"],
            Field(
                description="What to compare: the output state, the unitary, the ideal "
                "measured distribution, or an energy."
            ),
        ],
        reference: Annotated[
            str | None,
            Field(
                description="A library reference: bell, bell:phi-, bell:psi+, bell:psi-, "
                "ghz(n), w(n), uniform(n) (state), or qft(n), iqft(n) (unitary)."
            ),
        ] = None,
        amplitudes: Annotated[
            dict[str, float | str] | None,
            Field(
                description="state only: bitstring (q0 rightmost) to amplitude, a number "
                "or an expression such as '1/sqrt(2)' or 'exp(i*pi/4)/2'."
            ),
        ] = None,
        probabilities: Annotated[
            dict[str, float | str] | None,
            Field(description="distribution only: bitstring (q0 rightmost) to probability."),
        ] = None,
        reference_qasm: Annotated[
            str | None,
            Field(description="state or unitary: a reference circuit as OpenQASM 3."),
        ] = None,
        hamiltonian: Annotated[
            dict[str, float] | None,
            Field(description="energy only: Pauli string (q0 rightmost) to coefficient."),
        ] = None,
        target: Annotated[
            Literal["ground"] | float | None,
            Field(description="energy only: 'ground' for the exact ground energy, or a number."),
        ] = None,
        tolerance: Annotated[
            float | None,
            Field(ge=0, description="Leave out for the kind's default (see the description)."),
        ] = None,
        statement: Annotated[
            str,
            Field(max_length=300, description="One line saying what is being checked."),
        ] = "",
    ) -> dict[str, Any]:
        given = {
            "reference": reference,
            "amplitudes": amplitudes,
            "probabilities": probabilities,
            "reference_qasm": reference_qasm,
            "hamiltonian": hamiltonian,
            "target": target,
            "tolerance": tolerance,
        }
        prop: dict[str, Any] = {"kind": kind, "subject": "circuit", "statement": statement}
        prop.update({key: value for key, value in given.items() if value is not None})
        client = _token_client()
        verdict = await _in_thread(client.check_circuit, qasm, prop)
        return _check_result(verdict)

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


def _teeth_words(verdict: CheckVerdict) -> str:
    teeth = verdict.teeth
    if teeth is None or teeth.status != "measured":
        reason = teeth.reason if teeth is not None and teeth.reason else "no reason was given"
        return f"Whether this check can catch a broken circuit was not measured: {reason}"
    tried, caught = teeth.mutants, teeth.caught
    copies = "copy" if tried == 1 else "copies"
    if caught == tried:
        words = (
            f"Leona also made {tried} deliberately broken {copies} of the circuit that change "
            f"its output, and the check caught all {tried}."
        )
    elif caught == 0:
        words = (
            f"Leona also made {tried} deliberately broken {copies} of the circuit that change "
            "its output, and the check caught none of them: it could not tell a broken "
            "circuit from this one."
        )
    else:
        words = (
            f"Leona also broke the circuit on purpose: the check caught {caught} of {tried} "
            f"changes that alter the output. It missed: {'; '.join(teeth.survivors)}."
        )
    if teeth.equivalent:
        same = "copy" if teeth.equivalent == 1 else "copies"
        words += (
            f" {teeth.equivalent} more broken {same} behaved exactly like the original and "
            "were left out, since no check could catch them."
        )
    unrun = getattr(teeth, "could_not_run", 0)
    if unrun:
        which = "copy" if unrun == 1 else "copies"
        words += f" {unrun} more broken {which} could not be simulated and are not counted."
    if teeth.reason:
        words += f" ({teeth.reason})"
    return words


def _check_summary(verdict: CheckVerdict) -> str:
    """One paragraph a model can quote as it stands: what the circuit was checked
    against, the outcome, and whether the check could have failed. Written from the
    verdict's own fields only, and never with the word "verified"."""
    against = verdict.checked_against or "the property given"
    measure = f" ({verdict.measure})" if verdict.measure else ""
    if verdict.status == "pass":
        head = f"Checked against {against}: pass{measure}."
    elif verdict.status == "fail":
        head = f"Checked against {against}: fail{measure}. {verdict.detail}".rstrip()
    else:
        head = (
            "Leona could not judge this circuit, so this is neither a pass nor a fail: "
            f"{verdict.detail}"
        ).rstrip()
    return f"{head} {_teeth_words(verdict)}"


def _check_result(verdict: CheckVerdict) -> dict[str, Any]:
    """The verdict as JSON, plus three fields a calling model cannot misread: `passed`
    (true for `pass` and nothing else, so an `inconclusive` is never taken for one),
    `summary`, and — only when no broken copies were tried — `teeth_note`."""
    data = verdict.model_dump(mode="json")
    data["passed"] = verdict.status == "pass"
    data["summary"] = _check_summary(verdict)
    if verdict.teeth is None or verdict.teeth.status != "measured":
        data["teeth_note"] = _teeth_words(verdict)
    return data


def _in_language(value: Any, language: str) -> Any:
    """Every `{"en": ..., "ja": ...}` in the plan reduced to the one language asked for."""
    if isinstance(value, dict):
        if set(value) == {"en", "ja"} and all(isinstance(v, str) for v in value.values()):
            return value[language]
        return {key: _in_language(item, language) for key, item in value.items()}
    if isinstance(value, list):
        return [_in_language(item, language) for item in value]
    return value


def _number_words(value: float) -> str:
    """A number about the way the planner page prints it: 6,190 · 2.62e9 · 0.0016.

    Rounded for reading, never into a different claim: a probability of 0.99999905
    stays 0.99999905 rather than becoming "1", because "1" says certain.
    """
    size = abs(value)
    if size != 0 and (size >= 1e7 or size < 1e-3):
        mantissa, exponent = f"{value:.2e}".split("e")
        return f"{mantissa.rstrip('0').rstrip('.')}e{int(exponent)}"
    if float(value).is_integer():
        return f"{int(value):,}"
    if size >= 100:
        return f"{round(value):,}"
    short = f"{value:.3g}"
    return repr(value) if float(short).is_integer() else short


def _cited(source: dict[str, Any] | None) -> str:
    """`Gidney & Ekerå 2019 (arxiv:1905.09749), abstract`: enough to find the passage."""
    if source is None:
        return "no paper: Leona's own arithmetic"
    surnames = [name.split()[-1] for name in source["authors"].split(",") if name.strip()]
    if len(surnames) > 2:
        names = f"{surnames[0]} et al."
    else:
        names = " & ".join(surnames) or "unknown"
    return f"{names} {source['year']} ({source['paper_id']}), {source['locator']}"


#: Why the planner put a method at a stage (`StageChoice` in `assemble.ts`), in words.
_CHOICE_WORDS = {
    "reader": "your choice",
    "published": "the route its source used",
    "preferred": "the planner's default",
    "first": "the first listed, an arbitrary default",
    "none": "nothing fills it",
}


def _line_words(line: dict[str, Any], sources: dict[str, Any]) -> str:
    source = sources.get(line["source"]) if line["source"] else None
    where = f"{line['kind']}; {_cited(source)}"
    if line["value"] is None:
        return f"{line['label']}: not computed, needs {', '.join(line['missing'])} [{where}]"
    qualifier = f"{line['qualifier']} " if line.get("qualifier") else ""
    unit = f" {line['unit']}" if line["unit"] else ""
    number = _number_words(line["value"])
    if line["kind"] == "scaling":
        return f"{line['label']}: {number}, a magnitude with no constant, not a count [{where}]"
    return f"{line['label']}: {qualifier}{number}{unit} [{where}]"


def _plan_summary(plan: dict[str, Any]) -> str:
    """One paragraph a model can quote: the pipeline, then every number with its kind and
    source. Written from the answer's own fields, in the answer's language."""
    problem = plan["problem"]["label"]
    origins = {"reader": "given", "assumed": "assumed"}
    given = [
        f"{param['key']} = {_number_words(param['value'])} ({origins.get(param['origin'], param['origin'])})"
        for param in plan["params"]
        if param["value"] is not None
    ]
    root = plan["stages"][0] if plan["stages"] else None
    head = f"Leona's workflow planner, for {problem}"
    head += f" at {', '.join(given)}" if given else ""
    if root and root["method"]:
        how = _CHOICE_WORDS.get(root["choice"], root["choice"])
        head += f": {root['capability']['label']} by {root['method']['label']} ({how})"
        if len(plan["stages"]) > 1:
            head += f", {len(plan['stages']) - 1} stages below it"
    parts = [head + "."]
    sources = plan["sources"]
    if plan["lines"]:
        parts.append(
            "Costs: " + "; ".join(_line_words(line, sources) for line in plan["lines"]) + "."
        )
    if plan["classical"]:
        parts.append(
            "Classically: "
            + "; ".join(_line_words(line, sources) for line in plan["classical"])
            + "."
        )
    if plan["published"]:
        parts.append(
            "Published at this size: "
            + "; ".join(_line_words(line, sources) for line in plan["published"])
            + "."
        )
    parts += [note["text"] for note in plan["notes"]]
    if plan["lines"] or plan["classical"] or plan["published"]:
        parts.append("Figures here are rounded for reading; the lines carry exact values.")
    if plan["estimate_point"]:
        parts.append("For physical qubits and runtime, pass estimate_point to estimate_resources.")
    else:
        parts.append(
            "There is no estimate_point: this plan states no logical qubit count together "
            "with a Toffoli or T count, so there is nothing to turn into a machine."
        )
    return " ".join(parts)


def _plan_result(plan: dict[str, Any], language: str) -> dict[str, Any]:
    """The plan in one language, plus `summary`."""
    data = _in_language(plan, language)
    data["summary"] = _plan_summary(data)
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
