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


# --- The deny-all egress invariant (provider adapter) ------------------------


def test_vercel_create_always_requests_deny_all_egress():
    # The one line that makes a sandbox network-locked. If this ever regresses to
    # allow-all, it's a release-blocking bug (AGENTS.md rule 3).
    kwargs = _create_kwargs(ExecutionSpec(code="print(1)"), image="majorana-runner")
    assert kwargs["image"] == "majorana-runner"
    assert "runtime" not in kwargs  # custom images and built-in runtimes are exclusive
    assert kwargs["network_policy"] == DENY_ALL_EGRESS
    assert kwargs["env"] == {}  # no credentials inside the sandbox
    assert VercelSandbox(image="majorana-runner@sha256:test").environment_id == (
        "vercel:majorana-runner@sha256:test"
    )


async def test_vercel_execute_without_sdk_raises_not_silently_runs():
    from majorana_sandbox import SandboxProviderError

    # Without the SDK / creds the adapter must fail loudly, never fall through to
    # an unsandboxed execution.
    with pytest.raises(SandboxProviderError):
        await VercelSandbox()._execute(ExecutionSpec(code="print(1)"))
