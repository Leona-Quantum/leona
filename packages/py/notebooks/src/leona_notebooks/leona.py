"""A small Python API for scripts and notebook cells that want Leona without the
`%nala` magic — `from leona_notebooks.leona import Leona; lq = Leona.from_env()`.

    lq.devices()                                    what Leona can price/submit to
    lq.estimate(circuit_or_qasm, device=..., shots=1024)   a pre-run price, no submission
    lq.ask(question, notebook=None)                 ask Nala about a notebook (default: linked)
    lq.run(prompt, framework="qiskit")               POST /v1/runs, then wait for the result

`Leona` is `leona_notebooks.jupyter.Client` (itself `leona_client.Client`) under a
friendlier name and with `ask`/`run` convenience wrappers — the same token, the same
routes, the same `_gate_notebook_run`/`_enforce_execute_backstop` limits `%nala`
already runs into, just a plain method call instead of a magic line for a script
that is not running inside IPython at all.

Bridge lane (ai-ops 362, 2026-09-23). Nothing here imports qiskit, `leona_notebooks`'s
sandbox-facing modules, or anything else heavy at module scope — only `leona_client`/
`leona_notebooks.jupyter`, which already keep this same discipline — so importing
this module (or `leona_submit` below) costs nothing beyond what `%nala` already
costs, in an environment that has never touched qiskit at all.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from leona_client import LeonaClientError
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

    Shared by `Leona.estimate` and `leona_submit` so the two cannot disagree about
    what a circuit's qubit count is. `leona_notebooks.hardware.hardware_request`
    (the Hardware lane's in-sandbox equivalent, ai-ops 362) applies the same
    conversion plus the sandbox's own request-shape limits (max shots, max qasm
    length, requests per notebook) — this function is intentionally the SMALLER,
    conversion-only piece of that, since `leona_submit` below is local-only and
    unbounded by those product limits (nothing here is ever billed or queued).
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


def _size(num_qubits: int, shots: int) -> str:
    """ "2 qubits, 1,024 shots": the same words the sandbox's `leona_submit` uses."""
    qubits = "1 qubit" if num_qubits == 1 else f"{num_qubits} qubits"
    return f"{qubits}, {'1 shot' if shots == 1 else f'{shots:,} shots'}"


def leona_submit(
    circuit: Any,
    shots: int = 1024,
    *,
    label: str | None = None,
    device: str | None = None,
) -> HardwareSubmission | None:
    """The LOCAL half of `leona_submit` — importable as `from leona_notebooks
    import leona_submit` for a cell written and tested in a reader's own Jupyter,
    VS Code or Colab before it ever reaches Leona.

    This never submits anything to hardware. Owner ruling ai-ops 362: "hardware
    jobs come later under their own permission" — a personal access token may
    read and start verified runs, not spend real QPU time, so nothing this
    function does may either. Inside Leona's own sandbox, a DIFFERENT
    `leona_submit` (Hardware lane) records the same request into the notebook's
    execution report, which the web page then offers to run on a real device
    with the reader's own IBM credential and an explicit confirmation
    (`POST /v1/qpu/submissions`) — two functions with one name and (as far as
    `circuit`/`shots`/`label` go) one contract, so a cell written against either
    reads the same way in the other.

    `device` is a LOCAL-ONLY convenience (which device to price, for the estimate
    below) that the in-sandbox `leona_submit` does not accept — leave it unset in
    a cell you also intend to run on Leona, or a copy that keeps `device=` will
    raise `TypeError: unexpected keyword argument 'device'` there. Pricing a
    specific device before uploading is still possible: call
    `Leona.from_env().estimate(circuit, device=...)` instead.

    Never raises for an environment problem — a missing qiskit or an unset
    `LEONA_API_TOKEN` — since the whole point of running this locally is to keep
    iterating; both degrade to a printed message and `None`. An invalid circuit or
    shot count still raises, the same way calling any other function with bad
    arguments would.
    """
    try:
        qasm, num_qubits = _qasm_and_qubits(circuit)
    except ImportError as exc:
        print(  # noqa: T201 - the whole point of a local shim is console feedback
            f"leona_submit: qiskit is not installed here ({exc}) — install it, or "
            "pass an OpenQASM 3 string instead of a QuantumCircuit"
        )
        return None
    if not isinstance(shots, int) or isinstance(shots, bool) or shots < 1:
        raise ValueError(f"shots must be a positive int, got {shots!r}")
    if label is not None and not isinstance(label, str):
        raise TypeError(f"label must be a str or None, got {type(label).__name__}")

    submission = HardwareSubmission(qasm=qasm, shots=shots, num_qubits=num_qubits, label=label)

    token = os.environ.get("LEONA_API_TOKEN", "").strip()
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


__all__ = ["DEFAULT_ESTIMATE_DEVICE_ID", "HardwareSubmission", "Leona", "leona_submit"]
