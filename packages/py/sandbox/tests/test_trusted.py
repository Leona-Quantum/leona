"""The second door: control-plane programs, guarded by registration not allowlist.

`run_trusted` skips `check_python_code` on purpose — see `trusted.py`. What
replaces it is that the program must have been registered by digest, and that a
caller's DATA never becomes code. Both are asserted here rather than described.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from majorana_sandbox import (
    LocalSubprocessSandbox,
    TrustedPayloadTooLarge,
    TrustedProgramRejected,
    TrustedRegistrySealed,
    compose_trusted,
    is_registered,
    register_trusted_program,
    run_trusted,
    seal_trusted_registry,
    trusted_registry_is_sealed,
)
from majorana_sandbox.trusted import (
    MAX_PAYLOAD_BYTES,
    _reset_trusted_registry_for_tests,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Every test starts with an empty, unsealed registry.

    The registry is module state, so without this a test that seals it would
    make every later test in the same process fail on an error about sealing —
    which names the wrong test and is why this is autouse rather than opt-in.
    """

    _reset_trusted_registry_for_tests()
    yield
    _reset_trusted_registry_for_tests()


def _write(tmp_path: Path, source: str, name: str = "program.py") -> Path:
    """A trusted program on disk, which is the only thing registration accepts."""

    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return path


# Shaped like a real trusted program: a module docstring and a `from __future__`
# import first — the two statements Python requires to lead the file, and the
# reason `compose_trusted` appends rather than prepends.
_ECHO = '''"""A trusted echo program."""

import json


def _main() -> None:
    with open(LEONA_TRUSTED_RESULT_PATH, "w", encoding="utf-8") as handle:
        handle.write(json.dumps({"ok": True, "seen": json.loads(LEONA_TRUSTED_PAYLOAD)}))
'''


async def test_an_unregistered_program_is_refused_before_a_sandbox_is_created():
    """The whole substitute for the import allowlist.

    If this stopped holding, the door would accept any string a caller could
    reach it with — which is exactly the shape a prompt-injected payload takes.
    """

    with pytest.raises(TrustedProgramRejected):
        await run_trusted(
            LocalSubprocessSandbox(),
            program="import os\nos.system('true')\n",
            payload={},
            result_path="/tmp/majorana-never-written.json",
        )


async def test_a_registered_program_runs_and_its_payload_arrives_as_data(tmp_path):
    register_trusted_program(_write(tmp_path, _ECHO))
    path = "/tmp/leona-trusted-echo.json"
    hostile = {
        # Every one of these is a Python metacharacter. They must come back
        # unchanged, which is what proves the payload was never parsed as code.
        "quote": "'\"\\\\",
        "newline": "a\nb",
        "expression": "__import__('os').system('true')",
        "brace": "{payload}",
    }

    result = await run_trusted(
        LocalSubprocessSandbox(),
        program=_ECHO,
        payload=hostile,
        result_path=path,
        timeout_s=30,
    )

    assert result.ok, result.stderr
    assert result.protected_result == {"ok": True, "seen": hostile}


def test_registration_is_by_digest_so_one_edited_character_is_a_different_program(tmp_path):
    register_trusted_program(_write(tmp_path, _ECHO))
    assert is_registered(_ECHO)
    assert not is_registered(_ECHO + " ")


def test_the_program_text_that_runs_is_the_text_that_was_checked():
    """`compose_trusted` appends the program verbatim after the two globals.

    A composer that reformatted, indented or wrapped the program would make the
    digest check describe something other than what executes.
    """

    composed = compose_trusted(_ECHO, payload="{}", result_path="/tmp/x.json", entrypoint="_main")
    assert composed.startswith(_ECHO)
    assert composed.count(_ECHO) == 1
    # And the composed whole is valid Python. `compose_trusted` compiles it
    # itself for the same reason: a composition error and a compiler failure
    # look identical from outside the sandbox — no sidecar, either way.
    compile(composed, "<composed>", "exec")


def test_a_program_carrying_a_future_import_is_refused_at_registration(tmp_path):
    """The failure that produced this rule, pinned where it is cheap to see.

    A `__future__` import is legal only as the first statement of the compiled
    unit, and a trusted program never is one: globals are appended after it and
    the local double's rlimit bootstrap is prepended before it. The symptom was
    an absent sidecar — which the control plane reports as an internal compiler
    error, naming the wrong thing.
    """

    with pytest.raises(TrustedProgramRejected):
        register_trusted_program(_write(tmp_path, "from __future__ import annotations\nx = 1\n"))


async def test_an_oversized_payload_is_refused_rather_than_composed(tmp_path):
    register_trusted_program(_write(tmp_path, _ECHO))
    with pytest.raises(TrustedPayloadTooLarge):
        await run_trusted(
            LocalSubprocessSandbox(),
            program=_ECHO,
            payload={"blob": "x" * (MAX_PAYLOAD_BYTES + 1)},
            result_path="/tmp/majorana-never-written.json",
        )


async def test_a_trusted_program_that_overruns_is_killed_and_writes_nothing(tmp_path):
    """The half of ai-ops#186 that was not about dependencies.

    `asyncio.wait_for(asyncio.to_thread(...))` reported a timeout and let the
    work run on. A sandbox timeout ends the process. The absent sidecar is how
    the control plane tells the two apart.
    """

    spin = "def _main():\n    while True:\n        pass\n"
    register_trusted_program(_write(tmp_path, spin, "spin.py"))
    path = "/tmp/leona-trusted-spin.json"

    result = await run_trusted(
        LocalSubprocessSandbox(),
        program=spin,
        payload={},
        result_path=path,
        timeout_s=1,
    )

    assert not result.ok
    assert result.protected_result is None


def test_a_payload_with_a_nonfinite_number_is_refused_rather_than_serialized(tmp_path):
    """`json.dumps` writes `NaN` by default and no JSON reader accepts it.

    The kernel would receive a literal it cannot parse and report a failure the
    user would read as the compiler's.
    """

    register_trusted_program(_write(tmp_path, _ECHO))
    with pytest.raises(ValueError):
        json.dumps({"angle": float("nan")}, allow_nan=False)


def test_registration_refuses_source_text_rather_than_coercing_it(tmp_path):
    """The whole of ai-ops#190, pinned.

    While this took a `str`, the digest proved integrity and not provenance: a
    caller that registered request-derived source and then ran it passed every
    check. Taking a `Path` and reading the file here is what closes that, so the
    refusal of a `str` is the invariant, not an argument-validation nicety. If
    this test ever has to be relaxed, the module docstring's provenance claim
    stops being true in the same commit.
    """

    _write(tmp_path, _ECHO)  # on disk, so the refusal is about the ARGUMENT, not the file
    with pytest.raises(TrustedProgramRejected) as refusal:
        register_trusted_program(_ECHO)
    assert "pathlib.Path" in str(refusal.value)


def test_a_sealed_registry_refuses_further_registration(tmp_path):
    """Request-time registration is impossible by construction, not by convention.

    The worker seals in `majorana_worker.__main__.main`, after `handlers` has
    registered the kernel at import and before the first poll cycle. So even code
    that wrote attacker-controlled text to a file and passed its path could not
    get it registered while a request is being served.
    """

    assert not trusted_registry_is_sealed()
    seal_trusted_registry()
    assert trusted_registry_is_sealed()
    with pytest.raises(TrustedRegistrySealed):
        register_trusted_program(_write(tmp_path, _ECHO))


def test_sealing_is_idempotent_and_does_not_forget_what_was_registered(tmp_path):
    """What a caller wants afterwards is "closed", not "closed by me".

    And sealing must not be a way to disarm `run_trusted`: a program registered
    before the seal stays runnable, which is the entire point of sealing at the
    end of startup rather than before it.
    """

    register_trusted_program(_write(tmp_path, _ECHO))
    seal_trusted_registry()
    seal_trusted_registry()
    assert is_registered(_ECHO)


async def test_a_program_registered_before_the_seal_still_runs(tmp_path):
    """The worker's actual sequence, end to end: register at import, seal, serve."""

    register_trusted_program(_write(tmp_path, _ECHO))
    seal_trusted_registry()
    path = "/tmp/leona-trusted-sealed.json"

    result = await run_trusted(
        LocalSubprocessSandbox(),
        program=_ECHO,
        payload={"n": 1},
        result_path=path,
    )

    assert result.ok, result.stderr
    assert result.protected_result == {"ok": True, "seen": {"n": 1}}
