"""One unserializable value must cost itself, and nothing more or less.

`compose_execution` used to replace the WHOLE observation with a two-key error
payload when `json.dumps` raised. That cost a real outage nobody saw:
`qml.to_openqasm` returns a transform, so `interchange_qasm` held a function, so
every PennyLane run in the product lost its resource metrics, native statevector,
sampled counts and interchange together — all of them serializable, all discarded
for one neighbour.

The recovery keeps every serializable key. That change has its own hazard, which
is what the second half of this file is about: the old handler was bounded by
accident (two keys are small), and the size ceiling that guards the sidecar lives
INSIDE the `try` that just raised, so it never runs on this path.

These execute the composed program directly rather than through a sandbox
provider — the epilogue is generated source, and the only honest test of
generated source is running it.
"""

from __future__ import annotations

import json
import pathlib

from majorana_sandbox.spec import MAX_OUTPUT_BYTES, ExecutionSpec, compose_execution


def _run(observer: str, tmp_path: pathlib.Path) -> dict:
    """Execute a composed program whose epilogue fills the observation."""
    sidecar = tmp_path / "result.json"
    program = compose_execution(
        ExecutionSpec(
            code="RESULT = {'ok': True}\n",
            trusted_observer=observer,
            protected_result_path=str(sidecar),
            source_fingerprint="a" * 64,
        )
    )
    exec(compile(program, "<test>", "exec"), {"__name__": "__main__"})
    return json.loads(sidecar.read_text())


def test_a_serializable_neighbour_survives_an_unserializable_key(tmp_path):
    observation = _run(
        """
_majorana_observation["resource_metrics"] = {"qubits": 2, "depth": 3}
_majorana_observation["native_sampled"] = {"counts": {"00": 5}}
_majorana_observation["interchange_qasm"] = lambda: "OPENQASM 3.0;"
""",
        tmp_path,
    )

    # The evidence that WAS serializable is all still there. This is the whole
    # point: these are written by independent blocks and fail independently.
    assert observation["resource_metrics"] == {"qubits": 2, "depth": 3}
    assert observation["native_sampled"] == {"counts": {"00": 5}}
    assert observation["result"] == {"ok": True}

    # And the gap is legible AS a gap, rather than looking like a block that
    # never ran.
    assert observation["evidence_error"] == "protected_result_not_json_serializable"
    assert observation["evidence_dropped_keys"] == ["interchange_qasm"]
    assert "interchange_qasm" not in observation


def test_a_clean_observation_carries_no_error_and_drops_nothing(tmp_path):
    """The positive control. Without it the assertions above would pass against
    an implementation that reported an error every single time."""
    observation = _run('_majorana_observation["resource_metrics"] = {"qubits": 2}\n', tmp_path)
    assert observation["resource_metrics"] == {"qubits": 2}
    assert "evidence_error" not in observation
    assert "evidence_dropped_keys" not in observation


def test_the_byte_ceiling_still_applies_to_a_RECOVERED_observation(tmp_path):
    """The hazard the partial recovery introduced, and the reason it is bounded.

    The size check runs inside the `try` that raised, so it never executes on the
    recovery path. While the handler emitted two keys that was safe by accident;
    keeping every serializable key means a large observation plus ONE bad value
    would write an unbounded sidecar — which the reader then rejects wholesale,
    turning a partial loss back into a total one.
    """
    observation = _run(
        f"""
_majorana_observation["huge"] = "x" * {MAX_OUTPUT_BYTES + 1000}
_majorana_observation["interchange_qasm"] = lambda: "OPENQASM 3.0;"
""",
        tmp_path,
    )
    assert observation == {
        "source_fingerprint": "a" * 64,
        "evidence_error": "protected_result_not_json_serializable",
    }
    assert len(json.dumps(observation).encode("utf-8")) < MAX_OUTPUT_BYTES


def test_an_oversized_but_VALID_observation_is_still_bounded(tmp_path):
    """The pre-existing path, unchanged — asserted so the recovery cannot mask it."""
    observation = _run(
        f'_majorana_observation["huge"] = "x" * {MAX_OUTPUT_BYTES + 1000}\n', tmp_path
    )
    assert observation["evidence_error"] == "protected_result_too_large"
    assert "huge" not in observation
