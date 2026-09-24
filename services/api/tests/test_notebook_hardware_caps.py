"""A notebook's hardware request must fit the route it will be submitted through.

`leona_submit` records a circuit inside the sandbox, the reader confirms a price on the
notebook page, and only then does the web post it to `POST /v1/qpu/submissions`. The
contract's `HardwareRequest` restates the route's bounds because the contracts package
imports nothing internal, so the two numbers can drift without any import breaking.
If they did, a request the sandbox happily recorded could be refused by the route AFTER
the reader had been shown a price and pressed confirm. These tests are what notices.
"""

from majorana_contracts import HardwareRequest
from majorana_contracts.notebooks import (
    MAX_HARDWARE_REQUEST_QASM_CHARS,
    MAX_HARDWARE_REQUEST_SHOTS,
)

from majorana_api.routes import qpu


def test_the_notebook_caps_are_the_submission_routes_caps() -> None:
    assert MAX_HARDWARE_REQUEST_SHOTS == qpu.MAX_ESTIMATE_SHOTS
    assert MAX_HARDWARE_REQUEST_QASM_CHARS == qpu.MAX_SUBMISSION_QASM_CHARS


def test_a_request_at_every_cap_is_a_valid_submission_body() -> None:
    """Checked through the route's own request model rather than by comparing
    numbers alone: a new constraint on the route (a pattern, a minimum) that a
    notebook request could violate shows up here and not in production."""
    request = HardwareRequest(
        qasm="O" * MAX_HARDWARE_REQUEST_QASM_CHARS,
        shots=MAX_HARDWARE_REQUEST_SHOTS,
        num_qubits=2,
    )
    body = qpu.QpuSubmissionRequest(
        device_id="ibm_open_plan",
        shots=request.shots,
        qasm=request.qasm,
        # The longest fingerprint the web builds: a UUID notebook id, a six-digit
        # version, a 32-character cell id and 12 hex digits (lib/notebook-hardware.ts).
        source_fingerprint="notebook:"
        + "0" * 36
        + ":v999999:"
        + "c" * 32
        + ":"
        + "f" * 12,
    )
    assert body.shots == MAX_HARDWARE_REQUEST_SHOTS
    assert len(body.qasm) == MAX_HARDWARE_REQUEST_QASM_CHARS
