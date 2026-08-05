"""Hostile-payload suite (05-security.md §1 blast-radius, Phase 2 step 2 gate).

Each hostile class must be demonstrably killed or blocked, asserted automatically:
- static guard blocks: outbound network, pip/subprocess, /proc + metadata probing,
  dynamic import, credential-env reads;
- runtime caps kill: infinite loop (timeout), memory bomb (rlimit);
- the provider adapter always requests deny-all egress at creation.

NOTE: the runtime-cap tests run against the LOCAL subprocess double, which is not
a security boundary. The equivalent suite against the REAL Vercel provider — incl.
the canary-URL egress test — is the Phase 4 release gate (05-security.md §2) and is
owner-gated on Vercel credentials; this file proves the invariants we can prove
without a paid provider plus the deny-all-at-creation contract.
"""

import sys

import httpx
import pytest
from majorana_sandbox import (
    DENY_ALL_EGRESS,
    ExecutionSpec,
    GuardRejection,
    LocalSubprocessSandbox,
    run,
)
from majorana_sandbox.vercel import VercelSandbox, _create_kwargs

# --- Blocked statically (never even reach a sandbox) -------------------------

HOSTILE_STATIC = {
    "outbound_curl": "import socket\ns=socket.socket()\ns.connect(('example.com',80))",
    "pip_install": "import subprocess\nsubprocess.run(['pip','install','evil'])",
    "metadata_probe": "import urllib.request\nurllib.request.urlopen('http://169.254.169.254/')",
    "proc_probe": "import os\nprint(os.environ)",
    "dynamic_import": "__import__('os').system('id')",
}


@pytest.mark.parametrize("name", sorted(HOSTILE_STATIC))
async def test_static_guard_blocks_hostile_payload(name):
    sandbox = LocalSubprocessSandbox()
    with pytest.raises(GuardRejection):
        await run(sandbox, ExecutionSpec(code=HOSTILE_STATIC[name]))


# --- Killed at runtime by the caps ------------------------------------------


async def test_infinite_loop_is_killed_by_timeout():
    sandbox = LocalSubprocessSandbox()
    result = await run(sandbox, ExecutionSpec(code="while True:\n    pass", timeout_s=2))
    assert not result.ok
    assert "timeout" in result.stderr.lower()


@pytest.mark.skipif(
    sys.platform == "darwin",
    reason="RLIMIT_AS is not enforced on macOS; the double's memory cap is Linux-only "
    "(CI runs Linux). The real provider caps memory via the microVM regardless.",
)
async def test_memory_bomb_is_killed_by_rlimit():
    sandbox = LocalSubprocessSandbox()
    # Allocate far past the cap; the address-space rlimit makes the alloc fail /
    # the process die. Either way the run is not ok and did not blow past the cap.
    result = await run(
        sandbox,
        ExecutionSpec(
            code="x = bytearray(8_000_000_000)\nprint(len(x))",
            timeout_s=10,
            memory_mb=512,
        ),
    )
    assert not result.ok


async def test_legitimate_run_succeeds_on_local_double():
    sandbox = LocalSubprocessSandbox()
    result = await run(sandbox, ExecutionSpec(code="import json\nprint(json.dumps({'v': 42}))"))
    assert result.ok
    assert '"v": 42' in result.stdout
    assert result.provider == "local-subprocess"


async def test_braket_local_simulator_succeeds_on_local_double():
    sandbox = LocalSubprocessSandbox()
    code = (
        "import json\n"
        "from braket.circuits import Circuit\n"
        "from braket.devices import LocalSimulator\n"
        "circuit = Circuit().x(0).measure([0])\n"
        "counts = LocalSimulator().run(circuit, shots=32).result().measurement_counts\n"
        "print(json.dumps({str(k): int(v) for k, v in counts.items()}))\n"
    )

    result = await run(sandbox, ExecutionSpec(code=code, timeout_s=30))

    assert result.ok, result.stderr
    assert result.stdout.strip() == '{"1": 32}'


@pytest.mark.parametrize(
    "hostile_shadow",
    [
        "open = lambda *args, **kwargs: None",
        "print.__self__.open = lambda *args, **kwargs: None",
        "import json\njson.dump = lambda *args, **kwargs: None",
        "print.__self__.len = lambda value: 999",
        "globals = lambda: {'FINAL_CIRCUIT': 'forged'}",
        "_majorana_observation = {'interchange_qasm': 'forged'}",
    ],
)
async def test_provider_observer_isolated_from_generated_name_shadowing(tmp_path, hostile_shadow):
    result_path = tmp_path / "protected-result.json"
    result = await run(
        LocalSubprocessSandbox(),
        ExecutionSpec(
            code=f'{hostile_shadow}\nFINAL_CIRCUIT = "real"\nprint("model stdout")',
            trusted_observer=(
                '_majorana_observation["interchange_qasm"] = _majorana_namespace["FINAL_CIRCUIT"]\n'
                '_majorana_observation["length"] = _majorana_len([1, 2])'
            ),
            protected_result_path=str(result_path),
        ),
    )

    assert result.ok
    assert result.protected_result == {"interchange_qasm": "real", "length": 2}
    assert not result_path.exists()


async def test_protected_result_binds_source_fingerprint_and_structured_result(tmp_path):
    result_path = tmp_path / "protected-result.json"
    fingerprint = "a" * 64
    result = await run(
        LocalSubprocessSandbox(),
        ExecutionSpec(
            code='RESULT = {"counts": {"00": 2}}',
            trusted_observer='_majorana_observation["observed"] = True',
            protected_result_path=str(result_path),
            source_fingerprint=fingerprint,
        ),
    )
    assert result.ok
    assert result.protected_result == {
        "source_fingerprint": fingerprint,
        "result": {"counts": {"00": 2}},
        "observed": True,
    }


async def test_protected_result_is_bounded_before_provider_read(tmp_path):
    result_path = tmp_path / "protected-result.json"
    fingerprint = "b" * 64
    result = await run(
        LocalSubprocessSandbox(),
        ExecutionSpec(
            code='RESULT = {"payload": "x" * 1_100_000}',
            trusted_observer='_majorana_observation["observed"] = True',
            protected_result_path=str(result_path),
            source_fingerprint=fingerprint,
        ),
    )
    assert result.ok
    assert result.protected_result == {
        "source_fingerprint": fingerprint,
        "evidence_error": "protected_result_too_large",
    }


async def test_nonfinite_result_is_rejected_before_jsonb_persistence(tmp_path):
    """Python json emits Infinity by default, but Postgres JSONB rejects it."""

    result_path = tmp_path / "protected-result.json"
    fingerprint = "c" * 64
    result = await run(
        LocalSubprocessSandbox(),
        ExecutionSpec(
            code='RESULT = {"amplitude_ratio": 1e309}',
            trusted_observer='_majorana_observation["observed"] = True',
            protected_result_path=str(result_path),
            source_fingerprint=fingerprint,
        ),
    )

    assert result.ok
    assert result.protected_result == {
        "source_fingerprint": fingerprint,
        "result_error": "not_json_serializable",
        "observed": True,
    }


async def test_a_nonfinite_value_in_the_OBSERVATION_drops_one_key_not_the_run(tmp_path):
    """The other half of the pair above, and the half that could kill the process.

    `RESULT` is checked with `allow_nan=False` before it is recorded, so a non-finite
    value there is caught. The OBSERVATION is not: the trusted observer copies numbers
    straight out of the candidate's namespace — `_float(_amp.real)` for every native
    statevector amplitude — and a diverged optimizer makes those NaN.

    The recovery block below the serialization failure kept such a key, because its
    per-key probe omitted `allow_nan=False` while the write that ends the program
    requires it. That write sits outside every handler, so the process died on it:
    measured as `ok=False`, `protected_result=None` and NO sidecar on disk at all —
    the candidate's own serializable RESULT thrown away along with it. The point of
    this block is that one bad value must not cost every other one.
    """

    for literal in ("float('inf')", "float('nan')"):
        result_path = tmp_path / f"protected-{literal}.json"
        fingerprint = "e" * 64
        result = await run(
            LocalSubprocessSandbox(),
            ExecutionSpec(
                code=f"DIVERGED = {literal}\nRESULT = {{'shots': 1024}}",
                trusted_observer=(
                    '_majorana_observation["native_expectation"] = '
                    '_majorana_namespace.get("DIVERGED")\n'
                    '_majorana_observation["native_sampled"] = {"counts": {"00": 1024}}'
                ),
                protected_result_path=str(result_path),
                source_fingerprint=fingerprint,
            ),
        )

        assert result.ok, f"{literal} killed the sandbox process: {result.stderr}"
        assert result.protected_result == {
            "evidence_error": "protected_result_not_json_serializable",
            "evidence_dropped_keys": ["native_expectation"],
            "native_sampled": {"counts": {"00": 1024}},
            "result": {"shots": 1024},
            "source_fingerprint": fingerprint,
        }


# --- The deny-all egress invariant (provider adapter) ------------------------


def test_vercel_create_always_requests_deny_all_egress():
    # The one line that makes a sandbox network-locked. If this ever regresses to
    # allow-all, it's a release-blocking bug (AGENTS.md rule 3).
    kwargs = _create_kwargs(ExecutionSpec(code="print(1)"), image="majorana-runner")
    assert kwargs["image"] == "majorana-runner"
    assert "runtime" not in kwargs  # custom images and built-in runtimes are exclusive
    assert kwargs["resources"] == {"vcpus": 1}  # 1 vCPU provisions the requested 2 GiB
    assert kwargs["network_policy"] == DENY_ALL_EGRESS
    assert kwargs["env"] == {}  # no credentials inside the sandbox
    assert VercelSandbox(image="majorana-runner@sha256:test").environment_id == (
        "vercel:majorana-runner@sha256:test"
    )


def test_vercel_resources_round_memory_up_to_provider_vcpu_units():
    kwargs = _create_kwargs(
        ExecutionSpec(code="print(1)", memory_mb=2049),
        image="majorana-runner",
    )

    assert kwargs["resources"] == {"vcpus": 2}


async def test_vercel_execute_without_sdk_raises_not_silently_runs():
    from majorana_sandbox import SandboxProviderError

    # Without the SDK / creds the adapter must fail loudly, never fall through to
    # an unsandboxed execution.
    with pytest.raises(SandboxProviderError):
        await VercelSandbox()._execute(ExecutionSpec(code="print(1)"))


async def test_vercel_permission_failure_exposes_actionable_authorization_error(monkeypatch):
    from vercel.sandbox import SandboxPermissionError
    from vercel.sandbox.aio import Sandbox as AsyncSandbox

    async def denied_create(**kwargs):
        raise SandboxPermissionError(httpx.Response(403), "Not authorized")

    monkeypatch.setattr(AsyncSandbox, "create", denied_create)

    from majorana_sandbox import SandboxProviderError

    with pytest.raises(SandboxProviderError) as exc_info:
        await VercelSandbox()._execute(ExecutionSpec(code="print(1)"))
    message = str(exc_info.value)
    assert "HTTP 403" in message
    assert "VERCEL_PROJECT_ID" in message
    assert "VERCEL_TEAM_ID" in message
