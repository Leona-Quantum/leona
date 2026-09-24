"""The control-plane client: notebooks, verified runs, estimates, and Qapps.

One bearer-token client for everything `%nala`, the `leona-notebooks` CLI and
`leona-mcp`'s acting tools need from the API. Generalised from
`leona_notebooks.jupyter.Client` (proposal 7 Phase A/B); the notebook methods below
are that class, unchanged in behaviour. `run`/`estimate` methods are new in Phase C;
`run_qapp` and its two lower-level halves are ai-ops 349 option 2's "call it as an
API" endpoint.

Configuration is two environment variables — never a token as a constructor argument
from untrusted input, and never a token in a log line or an exception message:

    LEONA_API_URL    default https://majorana-api-nikekeixtq-uw.a.run.app
    LEONA_API_TOKEN  a bearer token for the control plane

The transport is stdlib `urllib` by default so this class adds no dependency of its
own beyond what `catalog.py` already needs; tests inject a fake transport (a plain
`(method, url, headers, body) -> (status, bytes)` callable), which is also how
`leona_notebooks`'s existing tests already exercised this code before the move.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Type-only — used solely as return-type annotations below. Every runtime
    # use (`.model_validate`, the terminal-status frozensets) is a lazy,
    # function-local import instead, so this module — and, transitively,
    # `leona_notebooks.jupyter`/`leona_notebooks.leona`/`leona_submit` — can be
    # imported without `majorana-contracts` installed. `from __future__ import
    # annotations` (above) already makes every annotation in this file a
    # string at runtime, so these two names are never looked up unless
    # something calls `typing.get_type_hints` on this module.
    from majorana_contracts import QappExecution, Run

from .atlas import (
    SearchLimits,
    method_detail,
    normalize_slug,
    problem_area_counts,
    search,
    similar_slugs,
)
from .catalog import DEFAULT_API_URL as ATLAS_DEFAULT_API_URL
from .catalog import CatalogClient

#: The control plane's public address, the same one the website calls (its CSP
#: `connect-src` names it). Kept identical to `catalog.DEFAULT_API_URL` — both read
#: the same production API — as two names because the two call sites (Atlas listing,
#: control plane) documented it independently before this move; a future change to
#: one should not silently change the other without a second look.
DEFAULT_API_URL = ATLAS_DEFAULT_API_URL

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]
#: `() -> (cell_source, traceback_text) | None` — how `%nala fix` reads the last
#: failure. `leona_notebooks.jupyter.load_ipython_extension` binds this to the live
#: shell; tests inject a fake so the magic is testable with no IPython running at all.
FixContext = Callable[[], "tuple[str, str] | None"]

#: How long `wait_for_run` polls before giving up, absent a caller-chosen value.
#: Generous relative to `wait_for_version`'s notebook default (600s) because a run
#: can carry plan/generate/verify/compile stages, not just one model call.
DEFAULT_RUN_WAIT_S = 600
DEFAULT_RUN_POLL_S = 3.0

#: How long `wait_for_qapp_execution` polls before giving up. Shorter than a run's
#: default: a Qapp execution is one sandboxed call capped at `MAX_TIMEOUT_S = 120`
#: (ADR-0031), not a multi-stage pipeline, so there is no "still planning" phase to
#: wait through.
DEFAULT_QAPP_WAIT_S = 150
DEFAULT_QAPP_POLL_S = 2.0

#: `_TERMINAL_RUN_STATUSES`/`_TERMINAL_QAPP_STATUSES` used to be module-level
#: frozensets built from `majorana_contracts.enums` at import time — moved into
#: `wait_for_run`/`wait_for_qapp_execution` themselves (built once per call, not
#: once per module load) so importing this module never requires
#: `majorana-contracts` to be installed. See the `TYPE_CHECKING` import above.


class LeonaClientError(RuntimeError):
    """Anything this client refuses or cannot complete, in words safe to show a user.

    Never constructed with a token in the message — every raise site here is
    reviewed for that; a caller that formats one of these into a log line is still
    safe.
    """


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - https to the configured API
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


@dataclass
class Client:
    """A bearer-token client of the Leona Quantum control plane.

    `token` is optional at construction: the read-only Atlas methods
    (`search_methods`/`get_method`/`list_problem_areas`) need none, since they read
    the same anonymous endpoint `leona-mcp` does. Every other method calls
    `_authenticated_call`, which raises `LeonaClientError` — never an HTTPError, never
    the token itself — the moment one is needed and absent.
    """

    api_url: str = DEFAULT_API_URL
    token: str | None = None
    transport: Transport = _urllib_transport
    _catalog_client: CatalogClient | None = field(
        default=None, repr=False, compare=False, init=False
    )

    @classmethod
    def from_env(cls, transport: Transport | None = None) -> Client:
        """`LEONA_API_URL` / `LEONA_API_TOKEN`. A missing token is not an error here —
        it only becomes one on the first call that actually needs one — so a caller
        that only wants the Atlas can construct a client with no token set at all."""
        token = os.environ.get("LEONA_API_TOKEN", "").strip() or None
        url = os.environ.get("LEONA_API_URL", "").strip().rstrip("/") or DEFAULT_API_URL
        return cls(api_url=url, token=token, transport=transport or _urllib_transport)

    def _catalog(self) -> CatalogClient:
        if self._catalog_client is None:
            self._catalog_client = CatalogClient(self.api_url)
        return self._catalog_client

    def _call(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        body: bytes | None = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        status, raw = self.transport(method, f"{self.api_url}/v1{path}", headers, body)
        if status >= 400:
            try:
                problem = json.loads(raw.decode("utf-8"))
                detail = (
                    problem.get("title") or problem.get("detail") or raw.decode("utf-8", "replace")
                )
            except (ValueError, AttributeError):
                detail = raw.decode("utf-8", "replace")
            raise LeonaClientError(f"{method} {path} → {status}: {detail}")
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))

    def _authenticated_call(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> Any:
        if not self.token:
            raise LeonaClientError(
                "This needs LEONA_API_TOKEN. Mint one on leonaqt.com (Account → Access "
                "tokens) and set it in your shell environment — never as an argument or "
                "in a notebook cell."
            )
        return self._call(method, path, payload)

    # -- Atlas (read-only, no token needed) -------------------------------

    def search_methods(
        self,
        query: str = "",
        *,
        problem_area: str | None = None,
        max_qubits: int | None = None,
        max_depth: int | None = None,
        hardware: str = "any",
        match_all: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """The same hard-limit rules `leona-mcp`'s `search_methods` tool applies —
        see `atlas.search`'s docstring. Unranked on purpose (ai-ops 358)."""
        rows = asyncio.run(self._catalog().rows())
        limits = SearchLimits(
            query=query,
            match_all=match_all,
            problem_area=problem_area,
            max_qubits=max_qubits,
            max_depth=max_depth,
            hardware=hardware,  # type: ignore[arg-type]
        )
        return search(rows, limits, max_results=limit, offset=offset)

    def get_method(self, slug: str) -> dict[str, Any]:
        """One Atlas record in full — the same shape `leona-mcp`'s `get_method` tool
        returns. Raises `LeonaClientError` when the slug has no published record."""
        wanted = normalize_slug(slug)
        rows = asyncio.run(self._catalog().rows())
        for row in rows:
            if row.slug == wanted:
                return method_detail(row)
        hint = similar_slugs(rows, wanted)
        suffix = f" Slugs containing that text: {', '.join(hint)}." if hint else ""
        raise LeonaClientError(f"No published Atlas record has the slug {wanted!r}.{suffix}")

    def list_problem_areas(self) -> dict[str, Any]:
        rows = asyncio.run(self._catalog().rows())
        return {"problem_areas": problem_area_counts(rows), "records_in_atlas": len(rows)}

    # -- notebooks (generalised from leona_notebooks.jupyter, unchanged behaviour) --

    def notebook(self, notebook_id: str) -> dict[str, Any]:
        return self._authenticated_call("GET", f"/notebooks/{notebook_id}")

    def versions(self, notebook_id: str) -> list[dict[str, Any]]:
        return self._authenticated_call("GET", f"/notebooks/{notebook_id}/versions")["items"]

    def version(self, notebook_id: str, seq: int | None) -> dict[str, Any]:
        if seq is None:
            seq = self.notebook(notebook_id).get("current_version_seq")
            if seq is None:
                raise LeonaClientError("this notebook has no finished version yet")
        return self._authenticated_call("GET", f"/notebooks/{notebook_id}/versions/{seq}")

    def pull(self, notebook_id: str, seq: int | None, out) -> Any:
        """Save a version's `.ipynb` to `out`. Only handles a version that already
        carries a rendered `ipynb`; `leona_notebooks.jupyter.Client` overrides this to
        also render one from a stored `spec` when the API has not compiled it yet —
        that conversion needs `leona_notebooks.ipynb`/`spec`, which this package does
        not and should not depend on (it stays qiskit/nbformat-free)."""
        version = self.version(notebook_id, seq)
        ipynb = version.get("ipynb")
        if ipynb is None:
            raise LeonaClientError(
                f"version {version.get('seq')} has no rendered ipynb "
                f"({version.get('status')}); leona_notebooks.jupyter.Client can "
                "render one from its stored spec"
            )
        out.write_text(json.dumps(ipynb, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return out

    def push(self, path, title: str | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ipynb": json.loads(path.read_text(encoding="utf-8")),
            "execute": True,
        }
        if title:
            payload["title"] = title
        return self._authenticated_call("POST", "/notebooks/import", payload)

    def push_version(
        self,
        notebook_id: str,
        path,
        *,
        message: str = "",
        execute: bool = True,
        run_until: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ipynb": json.loads(path.read_text(encoding="utf-8")),
            "message": message,
            "execute": execute,
        }
        if run_until is not None:
            payload["run_until"] = run_until
        return self._authenticated_call("POST", f"/notebooks/{notebook_id}/versions", payload)

    def rerun(self, notebook_id: str) -> dict[str, Any]:
        """`POST /notebooks/{id}/run`: re-run the current version from a fresh
        sandbox dispatch. No body — `rerun_notebook` (routes/notebooks.py) takes
        none — so this sends `payload=None` exactly as `cancel_run` does below."""
        return self._authenticated_call("POST", f"/notebooks/{notebook_id}/run")

    def wait_for_version_seq(
        self,
        notebook_id: str,
        seq: int,
        *,
        wait_s: int = 600,
        poll_s: float = 3.0,
        sleep=time.sleep,
        on_tick: Callable[[], None] | None = None,
    ) -> dict[str, Any]:
        """Poll ONE version (not "whichever is current") until it leaves
        `queued`/`running`. Used after `rerun`/`push_version`, which both name the
        exact version they just created — `wait_for_version` above answers a
        different question ("has generation finished") and would return early if
        another version raced ahead of this one in the meantime."""
        tick = on_tick or (lambda: None)
        deadline = time.monotonic() + wait_s
        while True:
            version = self.version(notebook_id, seq)
            if version.get("status") not in {"queued", "running"}:
                return version
            if time.monotonic() >= deadline:
                raise LeonaClientError(
                    f"{notebook_id} v{seq} is still {version.get('status')} after {wait_s}s"
                )
            tick()
            sleep(poll_s)

    def create(self, brief: str, **fields: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {"brief": brief}
        payload.update({key: value for key, value in fields.items() if value is not None})
        return self._authenticated_call("POST", "/notebooks", payload)

    def wait_for_version(
        self,
        notebook_id: str,
        *,
        wait_s: int = 600,
        poll_s: float = 3.0,
        sleep=time.sleep,
        on_tick: Callable[[], None] | None = None,
    ) -> dict[str, Any]:
        tick = on_tick or (lambda: None)
        deadline = time.monotonic() + wait_s
        while True:
            notebook = self.notebook(notebook_id)
            if notebook.get("current_version_seq") is not None:
                return notebook
            if notebook.get("latest_status") == "failed":
                raise LeonaClientError(
                    f"{notebook_id} failed to generate — open it on leonaqt.com to see why"
                )
            if time.monotonic() >= deadline:
                raise LeonaClientError(
                    f"{notebook_id} is still generating after {wait_s}s — pull it once it finishes"
                )
            tick()
            sleep(poll_s)

    def status_summary(self, notebook_id: str) -> str:
        rows = self.versions(notebook_id)
        if not rows:
            return f"{notebook_id}: no versions yet"
        latest = max(rows, key=lambda row: row["seq"])
        detail = self.version(notebook_id, latest["seq"])
        lines = [f"v{detail['seq']} {detail['status']} (by {detail['created_by']})"]
        if detail.get("message"):
            lines.append(f"message: {detail['message']}")
        report = detail.get("report")
        if report:
            cells = report.get("cells", [])
            ran = sum(1 for cell in cells if cell.get("status") == "ok")
            failed = sum(1 for cell in cells if cell.get("status") == "error")
            not_run = sum(1 for cell in cells if cell.get("status") in {"skipped", "not_run"})
            lines.append(f"cells: {ran} ran, {failed} failed, {not_run} not run")
        return "\n".join(lines)

    def ask(
        self,
        notebook_id: str,
        message: str,
        *,
        wait_s: int = 180,
        poll_s: float = 3.0,
        sleep=time.sleep,
    ) -> str:
        response = self._authenticated_call(
            "POST", f"/notebooks/{notebook_id}/turns", {"message": message}
        )
        asked_seq = int(response["turn"]["seq"])
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            turns = self._authenticated_call("GET", f"/notebooks/{notebook_id}/turns")["items"]
            replies = [t for t in turns if t["role"] == "nala" and int(t["seq"]) > asked_seq]
            if replies:
                return str(replies[-1]["content"])
            sleep(poll_s)
        raise LeonaClientError(
            "Nala has not replied yet — the run is still going; ask again in a minute"
        )

    # -- runs (proposal 7 Phase C; owner ruling ai-ops 362 option 1) --------

    def start_run(self, prompt: str, **fields: Any) -> Run:
        """`POST /v1/runs` — the same route the website's Run box calls. `prompt` is
        `CreateRunRequest.task_prompt`; `fields` (`mode`, `framework`, `seed`,
        `shots`, `timeout_s`, `conversation_id`, `response_locale`,
        `allow_ai_assumptions`, `source_code`, `source_intent`) are merged in, a
        `None` value dropped so every field can be passed unconditionally. Needs the
        token's `run` scope — a `read`-only token gets `INSUFFICIENT_SCOPE` from
        `token_access.check`, surfaced here as a plain `LeonaClientError`."""
        from majorana_contracts import Run

        payload: dict[str, Any] = {"task_prompt": prompt}
        payload.update({key: value for key, value in fields.items() if value is not None})
        return Run.model_validate(self._authenticated_call("POST", "/runs", payload))

    def get_run(self, run_id: str) -> Run:
        from majorana_contracts import Run

        return Run.model_validate(self._authenticated_call("GET", f"/runs/{run_id}"))

    def list_runs(self, *, status: str | None = None, limit: int = 50) -> list[Run]:
        from majorana_contracts import Run

        query = f"?limit={limit}"
        if status:
            query += f"&status={status}"
        rows = self._authenticated_call("GET", f"/runs{query}")
        return [Run.model_validate(row) for row in rows]

    def cancel_run(self, run_id: str) -> Run:
        from majorana_contracts import Run

        return Run.model_validate(self._authenticated_call("POST", f"/runs/{run_id}/cancel"))

    def wait_for_run(
        self,
        run_id: str,
        *,
        wait_s: int = DEFAULT_RUN_WAIT_S,
        poll_s: float = DEFAULT_RUN_POLL_S,
        sleep=time.sleep,
    ) -> Run:
        """Poll `GET /v1/runs/{id}` until it reaches a terminal status
        (succeeded/failed/cancelled) or `wait_s` elapses. Returns the run at
        whichever terminal state it reached — including `failed` — because that is
        itself an answer the caller asked for; only running out of time raises."""
        from majorana_contracts.enums import RunStatus

        terminal = frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED})
        deadline = time.monotonic() + wait_s
        while True:
            run = self.get_run(run_id)
            if run.status in terminal:
                return run
            if time.monotonic() >= deadline:
                raise LeonaClientError(
                    f"run {run_id} did not reach a terminal state within {wait_s}s "
                    f"(still {run.status}); call get_run({run_id!r}) again later"
                )
            sleep(poll_s)

    # -- QPU devices and pre-run price estimates ------------------------------
    #
    # Both routes are in `token_access.READ_WRITES`/always-readable: `qpu_backends`
    # is a plain `GET`, and `qpu_estimate` is arithmetic over the published rate
    # card (`routes/qpu.py::qpu_estimate` opens no session and touches no
    # provider), so a `read`-only token can price a device without the `run`
    # scope `POST /qpu/submissions` would need — and `POST /qpu/submissions`
    # itself is reachable by no token at all (ai-ops 362's hardware deferral).

    def qpu_backends(self) -> list[dict[str, Any]]:
        """`GET /qpu/backends`: every device Leona knows a rate card for, whether
        or not Leona can submit to it today (`QpuBackendInfo.submittable`)."""
        return self._authenticated_call("GET", "/qpu/backends")["backends"]

    def qpu_estimate(self, device_id: str, shots: int, *, zne: bool = False) -> dict[str, Any]:
        """`POST /qpu/estimates`: a pre-run price for `shots` on `device_id`, from
        the vendor's own published rate card — not a quote, and not a function of
        the circuit's own qubit count or depth (`routes/qpu.py::QpuEstimateRequest`
        takes no circuit at all)."""
        payload: dict[str, Any] = {"device_id": device_id, "shots": shots, "zne": zne}
        return self._authenticated_call("POST", "/qpu/estimates", payload)

    # -- estimates -----------------------------------------------------------

    def estimate_resources(
        self, points: list[dict[str, Any]], *, assumptions: str | None = None
    ) -> dict[str, Any]:
        """`POST /v1/estimates/logical`: physical qubits and runtime for a logical
        cost you state (`LogicalPoint`: `label`, `logical_qubits`, `toffoli_count`,
        `t_count`, `non_clifford_depth`, optional `parameter_value`). Returns the
        raw response — `LogicalEstimateResponse` is route-local, not a
        `majorana_contracts` type, because nothing else reads it (see
        `services/api/src/majorana_api/routes/estimates.py`)."""
        payload: dict[str, Any] = {"points": points}
        if assumptions is not None:
            payload["assumptions"] = assumptions
        return self._authenticated_call("POST", "/estimates/logical", payload)

    # -- Qapps: "call it as an API" (ai-ops 349 option 2, ai-ops 362) --------

    def start_qapp_execution(
        self, slug: str, inputs: dict[str, Any] | None = None
    ) -> QappExecution:
        """`POST /v1/qapps/{slug}/executions` — the SAME route the Qapp's own page
        calls to run it, and the same sandboxed execution ADR-0031 describes; no
        separate execution path exists for a token caller. Returns immediately with
        the execution `queued`; `run_qapp` submits this and then waits. `inputs` are
        validated server-side against the Qapp's own declared input schema. Needs
        the token's `run` scope — a `read`-only token gets `INSUFFICIENT_SCOPE` from
        `token_access.check`, surfaced here as a plain `LeonaClientError`. A private
        Qapp somebody else owns, or one that does not exist, is refused the same way
        (404) as any other absent resource — this is not a way to probe who owns a
        slug."""
        from majorana_contracts import QappExecution

        payload = {"inputs": inputs or {}}
        return QappExecution.model_validate(
            self._authenticated_call("POST", f"/qapps/{slug}/executions", payload)
        )

    def get_qapp_execution(self, execution_id: str) -> QappExecution:
        """`GET /v1/qapps/executions/{id}`. Only the execution's own caller can read
        it back — not even a co-member of the same workspace, per `get_execution`."""
        from majorana_contracts import QappExecution

        return QappExecution.model_validate(
            self._authenticated_call("GET", f"/qapps/executions/{execution_id}")
        )

    def wait_for_qapp_execution(
        self,
        execution_id: str,
        *,
        wait_s: int = DEFAULT_QAPP_WAIT_S,
        poll_s: float = DEFAULT_QAPP_POLL_S,
        sleep=time.sleep,
    ) -> QappExecution:
        """Poll `GET /v1/qapps/executions/{id}` until `succeeded`/`failed`, or
        `wait_s` elapses. Returns the execution at whichever terminal state it
        reached, including `failed` — the caller asked for that answer too — and
        raises only when time runs out first, the same contract `wait_for_run` uses."""
        from majorana_contracts.enums import QappExecutionStatus

        terminal = frozenset({QappExecutionStatus.SUCCEEDED, QappExecutionStatus.FAILED})
        deadline = time.monotonic() + wait_s
        while True:
            execution = self.get_qapp_execution(execution_id)
            if execution.status in terminal:
                return execution
            if time.monotonic() >= deadline:
                raise LeonaClientError(
                    f"qapp execution {execution_id} did not reach a terminal state within "
                    f"{wait_s}s (still {execution.status}); call "
                    f"get_qapp_execution({execution_id!r}) again later"
                )
            sleep(poll_s)

    def run_qapp(
        self,
        slug: str,
        inputs: dict[str, Any] | None = None,
        *,
        wait_s: int = DEFAULT_QAPP_WAIT_S,
        poll_s: float = DEFAULT_QAPP_POLL_S,
    ) -> QappExecution:
        """Call a published Qapp with input values and wait for its result — the
        one call `run_qapp(slug, inputs)` in the plan asks for. Starts the
        execution (`start_qapp_execution`) and polls it (`wait_for_qapp_execution`)
        so a caller who does not want to manage the two calls separately does not
        have to; one that does can call them directly. This spends the caller's own
        Qapp-execution allowance exactly as opening the Qapp's page and running it
        would — the three ceilings in `routes/qapps.py` do not distinguish how the
        request arrived."""
        execution = self.start_qapp_execution(slug, inputs)
        return self.wait_for_qapp_execution(str(execution.id), wait_s=wait_s, poll_s=poll_s)


__all__ = [
    "Client",
    "DEFAULT_API_URL",
    "DEFAULT_QAPP_POLL_S",
    "DEFAULT_QAPP_WAIT_S",
    "DEFAULT_RUN_POLL_S",
    "DEFAULT_RUN_WAIT_S",
    "FixContext",
    "LeonaClientError",
    "Transport",
]
