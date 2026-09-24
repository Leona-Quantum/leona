"""A small Python API for scripts and notebook cells that want Leona without the
`%nala` magic — `from leona_notebooks.leona import Leona; lq = Leona.from_env()`.

    lq.devices()                                    what Leona can price/submit to
    lq.estimate(circuit_or_qasm, device=..., shots=1024)   a pre-run price, no submission
    lq.ask(question, notebook=None)                 ask Nala about a notebook (default: linked)
    lq.run(prompt, framework="qiskit")               POST /v1/runs, then wait for the result
    lq.qpu_submit(device_id, shots, qasm, source_fingerprint)  a real hardware submission
                                                     (needs a token with the `hardware` scope)

`Leona` is `leona_notebooks.jupyter.Client` (itself `leona_client.Client`) under a
friendlier name and with `ask`/`run` convenience wrappers — the same token, the same
routes, the same `_gate_notebook_run`/`_enforce_execute_backstop` limits `%nala`
already runs into, just a plain method call instead of a magic line for a script
that is not running inside IPython at all.

Bridge lane (ai-ops 362, 2026-09-23; the `hardware` scope itself is ai-ops 376,
2026-09-24). Nothing here imports qiskit, `leona_notebooks`'s sandbox-facing modules,
or anything else heavy at module scope — only `leona_client`/`leona_notebooks.jupyter`,
which already keep this same discipline — so importing this module (or `leona_submit`
below) costs nothing beyond what `%nala` already costs, in an environment that has
never touched qiskit at all.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Any

from leona_client import LeonaClientError
from leona_client.client import DEFAULT_QPU_WAIT_S
from leona_notebooks.jupyter import Client as _JupyterClient
from leona_notebooks.jupyter import get_linked_notebook, notebook_url

#: IBM's free-queue device (`majorana_qpu.pricing.RATE_CARD`) — always priceable,
#: never requires a credential to ask about, and the one entry on the rate card an
#: estimate can default to without guessing what the reader actually has access to.
#: Pass `device=` (to `estimate`/`leona_submit`) to price a different one; `lq.devices()`
#: lists every id this constant could be pointed at.
DEFAULT_ESTIMATE_DEVICE_ID = "ibm.open_plan"


class Leona(_JupyterClient):
    """`leona_notebooks.jupyter.Client` (so `from_env()` still refuses a missing
    token immediately) plus the handful of methods a script reaches for by name
    rather than through a magic line."""

    def devices(self) -> list[dict[str, Any]]:
        """Every device Leona has a rate card for (`GET /v1/qpu/backends`) —
        whether or not Leona can actually submit to it today
        (`backend["submittable"]`)."""
        return self.qpu_backends()

    def estimate(
        self,
        circuit_or_qasm: Any,
        *,
        device: str | None = None,
        shots: int = 1024,
        zne: bool = False,
    ) -> dict[str, Any]:
        """A pre-run price for running `circuit_or_qasm` `shots` times on `device`
        (default `DEFAULT_ESTIMATE_DEVICE_ID`) — never a submission.

        `circuit_or_qasm` is read only to report `num_qubits` alongside the price:
        the rate card itself (`POST /v1/qpu/estimates`) prices by device and shot
        count alone, not by the circuit's structure — see `leona_client.Client.
        qpu_estimate`'s docstring. Passing a circuit here keeps this call symmetric
        with `run`/`leona_submit`, which do need one, and means the qubit count
        this prints and the one a hardware cell will actually submit cannot drift
        apart.
        """
        _qasm, num_qubits = _qasm_and_qubits(circuit_or_qasm)
        result = self.qpu_estimate(device or DEFAULT_ESTIMATE_DEVICE_ID, shots, zne=zne)
        return {**result, "num_qubits": num_qubits}

    def ask(self, question: str, notebook: str | None = None) -> str:  # type: ignore[override]
        """Ask Nala about `notebook` (default: whatever `%nala link` last set in
        this process). Deliberately a different signature from the base class's
        `ask(notebook_id, message)` — `question` first, `notebook` optional — this
        is the friendlier script-facing spelling `%nala`'s own line magic uses
        internally via `_resolve_notebook_id`, not a drop-in override; nothing in
        this package calls `Leona.ask` expecting the base positional order.
        """
        notebook_id = notebook or get_linked_notebook()
        if not notebook_id:
            raise LeonaClientError(
                "no notebook given and none linked — pass notebook=, or run "
                "%nala link <notebook_id> first"
            )
        return super().ask(notebook_id, question)

    def run(self, prompt: str, *, framework: str = "qiskit", **fields: Any):
        """`POST /v1/runs` (needs the `run` scope), then wait for it to finish —
        the one call a script wants when it does not care about polling itself.
        `wait_for_run` returns the run at whatever terminal state it reached,
        including `failed`, exactly as calling the two separately would."""
        run = self.start_run(prompt, framework=framework, **fields)
        return self.wait_for_run(run.id)


def _qasm_and_qubits(circuit_or_qasm: Any) -> tuple[str, int]:
    """OpenQASM 3 text and a qubit count, from either a qiskit `QuantumCircuit` or
    an OpenQASM string. qiskit is imported here, lazily, in BOTH branches — even a
    string still needs `qasm3.loads` to find `num_qubits`, so there is no input
    that skips qiskit; only the module IMPORT (this function is never called at
    module scope) is what a caller with no qiskit installed gets to skip, by never
    calling `estimate`/`leona_submit` with a circuit at all.

    Used by `Leona.estimate`, which only needs a qubit count to show beside a price.
    `leona_submit` below does NOT use it: it goes through `leona_notebooks.hardware.
    hardware_request`, the checks the sandbox's own `leona_submit` is held to, so a
    circuit Leona would refuse is refused here first, in the same words.
    """
    if isinstance(circuit_or_qasm, str):
        text = circuit_or_qasm
        if "OPENQASM 2" in text:
            raise LeonaClientError(
                "OpenQASM 2 is not accepted here — convert it first "
                "(qiskit.qasm2.load(...) then qiskit.qasm3.dumps(...))"
            )
        from qiskit import qasm3

        try:
            circuit = qasm3.loads(text)
        except Exception as exc:  # noqa: BLE001 - reported, not a qiskit-specific type
            raise LeonaClientError(f"could not parse as OpenQASM 3: {exc}") from exc
        return text, circuit.num_qubits
    from qiskit import qasm3

    return qasm3.dumps(circuit_or_qasm), circuit_or_qasm.num_qubits


@dataclass(frozen=True)
class HardwareSubmission:
    """What `leona_submit` recorded, locally, for the reader's own inspection.
    Never sent anywhere on its own — `qasm` is what Leona's sandbox would receive
    if this same cell ran there instead."""

    qasm: str
    shots: int
    num_qubits: int
    label: str | None = None


@dataclass(frozen=True)
class HardwareRun:
    """A REAL submission `leona_submit` just made (ai-ops 376: the token carried
    the `hardware` scope). Unlike `HardwareSubmission`, `qasm` is not kept here —
    it is on the server's own attestation row (`GET /v1/qpu/runs/{run_id}`), which
    `.status()`/`.result()` read from, so this object is a thin handle onto that
    row rather than a second copy of the circuit.
    """

    run_id: str
    device_id: str
    #: The `Leona` client that made the submission, reused for every poll so
    #: `.status()`/`.result()` need no token or transport of their own. Excluded
    #: from `repr`/`==` the same way `Leona` itself is not the interesting part
    #: of this object to a reader printing it in a cell.
    _client: Leona = field(repr=False, compare=False)

    def status(self) -> str:
        """A fresh read of `GET /v1/qpu/runs/{run_id}` — never cached, since the
        point of calling this is to learn whether anything has changed since the
        last read."""
        return str(self._client.get_qpu_run(self.run_id)["status"])

    def result(self, *, timeout: int = DEFAULT_QPU_WAIT_S) -> dict[str, int]:
        """Wait for a terminal status and return the counts (`raw_counts`).

        Raises `LeonaClientError` if the run finished as `error`/`cancelled`
        rather than `done` — asking for counts and getting none back silently
        would read as an empty result rather than a failed one. `.status()`, or
        `self._client.get_qpu_run(self.run_id)` directly, is how to inspect a
        non-`done` terminal record instead of raising on it.
        """
        record = self._client.wait_for_qpu_run(self.run_id, wait_s=timeout)
        status = record.get("status")
        if status != "done":
            detail = f": {record['error']}" if record.get("error") else ""
            raise LeonaClientError(f"qpu run {self.run_id} finished as {status}{detail}")
        return record.get("raw_counts") or {}


#: `source_fingerprint`'s length ceiling on `POST /qpu/submissions`
#: (`QpuSubmissionRequest`, `services/api/src/majorana_api/routes/qpu.py`) —
#: mirrored as a literal for the same reason 0069 mirrors `TokenScope` into a
#: migration: this needs to keep saying what it checked on the day it was
#: written, not silently track a constant this package does not import (the
#: route is behind `services/api`, which this package does not depend on).
_MAX_SOURCE_FINGERPRINT_CHARS = 200

#: How much of the QASM's SHA-256 to carry — enough to tell two different
#: circuits apart at a glance without turning the fingerprint into another full
#: hash, matching the four-character economy `TOKEN_TAIL_CHARS` uses for the
#: same "recognisable, not exhaustive" purpose elsewhere in this product.
_QASM_FINGERPRINT_HEX_CHARS = 16


def _source_fingerprint(qasm: str) -> str:
    """`local:<notebook id or "none">:<sha256 prefix of qasm>` — recognisable in
    `GET /v1/qpu/runs` history as a LOCAL submission (the sandbox's own
    `leona_submit` and Studio each write their own prefix), and stable for the
    same circuit run twice from the same notebook, so a reader scanning their
    history can tell "the same cell, run again" from "a different circuit".

    Checked against `_MAX_SOURCE_FINGERPRINT_CHARS`: `"local:"` (6) + a uuid7
    notebook id (36, the longest real id this product mints) + `":"` (1) +
    `_QASM_FINGERPRINT_HEX_CHARS` (16) is 59 — well inside 200 — but a caller
    could in principle have linked a notebook id of some other shape, so this
    still truncates defensively rather than trusting the arithmetic silently.
    """
    notebook_id = get_linked_notebook() or "none"
    digest = hashlib.sha256(qasm.encode("utf-8")).hexdigest()[:_QASM_FINGERPRINT_HEX_CHARS]
    fingerprint = f"local:{notebook_id}:{digest}"
    return fingerprint[:_MAX_SOURCE_FINGERPRINT_CHARS]


def _size(num_qubits: int, shots: int) -> str:
    """Say "2 qubits, 1024 shots" the way the sandbox's own `leona_submit` does."""
    qubits = "1 qubit" if num_qubits == 1 else f"{num_qubits} qubits"
    return f"{qubits}, {'1 shot' if shots == 1 else f'{shots} shots'}"


def leona_submit(
    circuit: Any,
    shots: int = 1024,
    *,
    label: str | None = None,
    device: str | None = None,
) -> HardwareSubmission | HardwareRun | None:
    """The LOCAL half of `leona_submit` — importable as `from leona_notebooks
    import leona_submit` for a cell written and tested in a reader's own Jupyter,
    VS Code or Colab before it ever reaches Leona.

    ## Whether this submits anything depends on the token's scope (ai-ops 376)

    Owner ruling ai-ops 362 deferred hardware access for a token to "under
    their own permission"; ai-ops 376 option 2 is that permission. With
    `LEONA_API_TOKEN` set to a token carrying the `hardware` scope, this prices
    the circuit exactly as before and THEN submits it for real
    (`POST /qpu/submissions`, the caller's own weekly hardware allowance),
    returning a `HardwareRun` — a handle onto that real submission, with
    `.status()`/`.result(timeout=...)`. A token without `hardware` — no token,
    a `read`-only token, or a `run`-only token, none of which reach that route —
    behaves exactly as this function always has: price, print, and return a
    local-only `HardwareSubmission`. **There is no separate confirmation step
    here** the way the in-product notebook page has one; minting a token with
    `hardware` ticked IS the confirmation, matching the ruling's own wording,
    "leona_submit in their own Jupyter or VS Code submits directly".

    Which of the two happened is never guessed from a token's shape or from
    matching text in an error: it is read from the API's own answer. A
    `token_scope_insufficient` refusal on the submission attempt (surfaced as
    `LeonaClientError.reason`, not by pattern-matching the sentence) is the
    authoritative "this token has no hardware scope" signal, and the ONLY one —
    `GET /v1/tokens`, which would otherwise let a token read back its own
    scopes, is itself refused to every token (`token_access.READ_DENIED`), so
    there is no side channel this function could use to decide in advance.

    Inside Leona's own sandbox, a DIFFERENT `leona_submit` (Hardware lane)
    records a request into the notebook's execution report instead of
    submitting outright, which the web page then offers to run with a device
    picker, the estimate and allowance shown, and an explicit confirm step —
    the product's own guided path, distinct from this direct one. The two
    functions share one name and (as far as `circuit`/`shots`/`label` go) one
    contract, so a cell written against either reads the same way in the other.

    `device` is a LOCAL-ONLY convenience (which device to price and, with
    `hardware` scope, submit to) that the in-sandbox `leona_submit` does not
    accept — leave it unset in a cell you also intend to run on Leona, or a
    copy that keeps `device=` will raise `TypeError: unexpected keyword
    argument 'device'` there. The default is `DEFAULT_ESTIMATE_DEVICE_ID`
    (IBM's free Open Plan queue); a paid device must be named explicitly.

    Never raises for an environment problem — a missing qiskit, an unset
    `LEONA_API_TOKEN`, or a failed price/submission call over the network —
    since the whole point of running this locally is to keep iterating; all of
    them degrade to a printed message and either `None` or a local-only
    `HardwareSubmission`. An invalid circuit or shot count still raises, the
    same way calling any other function with bad arguments would.
    """
    if not isinstance(circuit, str):
        try:
            import qiskit  # noqa: F401 - only to learn whether a circuit can be converted
        except ImportError as exc:
            print(  # noqa: T201 - the whole point of a local shim is console feedback
                f"leona_submit: qiskit is not installed here ({exc}) — install it, or "
                "pass an OpenQASM 3 string instead of a QuantumCircuit"
            )
            return None
    # The SAME checks, in the same words, as the leona_submit inside Leona's sandbox
    # (`hardware_request` is what `test_hardware.py` holds the sandbox to): unbound
    # parameters, a circuit that measures nothing, OpenQASM 2, shots and size limits.
    # A cell that passes here must not be refused the moment it runs on Leona.
    from leona_notebooks.hardware import hardware_request

    request = hardware_request(circuit, shots, label=label)
    qasm, shots, num_qubits, label = request.qasm, request.shots, request.num_qubits, request.label

    submission = HardwareSubmission(qasm=qasm, shots=shots, num_qubits=num_qubits, label=label)

    token = os.environ.get("LEONA_API_TOKEN", "").strip()
    lq: Leona | None = None
    if token:
        try:
            lq = Leona.from_env()
            estimate = lq.estimate(qasm, device=device, shots=shots)
        except Exception as exc:  # noqa: BLE001 - a bad estimate must not stop the cell
            print(f"leona_submit: could not fetch a price estimate ({exc})")  # noqa: T201
        else:
            basis = estimate.get("basis", "")
            fee = estimate.get("task_fee_usd")
            per_shot = estimate.get("per_shot_usd")
            price_bits = [f"{estimate.get('device_id')}: {basis}" if basis else "estimate:"]
            if fee is not None:
                price_bits.append(f"task fee ${fee:.2f}")
            if per_shot is not None:
                price_bits.append(f"${per_shot:.5f}/shot")
            print(  # noqa: T201
                f"{_size(num_qubits, shots)}. "
                + ", ".join(price_bits)
                + " (pre-run estimate, not a charge — nothing was submitted)."
            )
    else:
        print(  # noqa: T201
            f"{_size(num_qubits, shots)}. Set LEONA_API_TOKEN to see a price "
            "estimate here before you open this on Leona."
        )

    if lq is not None:
        # The one attempt this function makes at spending real money — see the
        # docstring's "Whether this submits anything depends on the token's
        # scope" section for why a refusal is read from `.reason`, never guessed.
        try:
            record = lq.qpu_submit(
                device or DEFAULT_ESTIMATE_DEVICE_ID,
                shots,
                qasm,
                _source_fingerprint(qasm),
            )
        except LeonaClientError as exc:
            if exc.reason != "token_scope_insufficient":
                # Some OTHER reason this token, with hardware scope or not,
                # could not submit right now — no IBM credential connected, the
                # deployment gate closed, the weekly allowance spent, an
                # unknown device. Reported, not swallowed silently, but still
                # never raised: the cell falls through to the local-only
                # messages below exactly as a token-less run would.
                print(f"leona_submit: could not submit to hardware ({exc})")  # noqa: T201
        except Exception as exc:  # noqa: BLE001 - a submission failure must not stop the cell
            print(f"leona_submit: could not submit to hardware ({exc})")  # noqa: T201
        else:
            print(  # noqa: T201
                f"Submitted to {record.get('device_id')} as run {record.get('id')} "
                f"({record.get('status')}) — charged to your weekly hardware allowance. "
                "Call .status() or .result(timeout=...) on the returned object to check on it."
            )
            return HardwareRun(
                run_id=str(record["id"]),
                device_id=str(record.get("device_id") or ""),
                _client=lq,
            )

    linked = get_linked_notebook()
    if linked:
        print(  # noqa: T201
            f"This ran locally only — open {notebook_url(linked)} on Leona to run it on "
            "real hardware."
        )
    else:
        print(  # noqa: T201
            "This ran locally only — push this notebook to Leona (%nala push) and open it "
            "there to run it on real hardware."
        )
    return submission


__all__ = [
    "DEFAULT_ESTIMATE_DEVICE_ID",
    "HardwareRun",
    "HardwareSubmission",
    "Leona",
    "leona_submit",
]
