"""Control-plane programs, run in the same isolation boundary as generated code.

`base.run` exists for code a model or a user wrote: it applies
`guard.check_python_code` first, and that guard's allowlist is the list of
imports *generated* code is permitted. This module is for the other case — a
program this repository authored, shipped into the sandbox as source, whose
imports are decided at review time rather than at runtime.

**Why that case needs its own door rather than a wider allowlist.** Studio's
compiler lane (ai-ops#186, owner ruling: option A) runs six third-party
compilers. Adding `pytket`, `pyzx` and `bqskit` to `ALLOWED_IMPORTS` would widen
what *generated* code may import in order to let *our* code import it — paying
for a control-plane need out of the untrusted-code budget. The isolation
boundary is the same either way; only the static pre-check differs, and the
pre-check is about provenance.

**What keeps user text out of this door, stated more carefully than it was.**
This paragraph used to claim that "a caller cannot pass a string it received
over the wire, because it could not have registered the digest." That is false
and is corrected here rather than left standing: `register_trusted_program`
accepts any `str`, so a caller that registered request-derived source and then
ran it would pass the check. CodeRabbit found it on PR 778 and it was right.

What the digest actually proves is narrower: that the text `run_trusted`
executes is byte-identical to text some caller registered. It is an integrity
check, not a provenance check. Provenance is a **convention** — every call site
in this repository registers a module's own source at import time, which
`packages/py/sandbox/tests/test_trusted.py` and the single production caller in
`majorana_frameworks.optimizer_kernel` are the complete list of. A reviewed
static digest manifest would make provenance mechanical, and that is an open
suggestion rather than something done here.

What is NOT a convention, and is what actually keeps user text out: the request
data travels as a JSON *payload* serialized by this module — never as code — so
nothing a user controls reaches the composed program except as the right-hand
side of one string assignment, written through `repr`. To get user text into
this door at all, someone would first have to write new code in this repository
that registers it.

The sandbox's own guarantees are unchanged and are still doing the real work:
deny-all egress, no credentials in the environment, and a provider-enforced
wall clock that destroys the machine rather than cancelling a coroutine.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from majorana_sandbox.base import Sandbox
from majorana_sandbox.spec import (
    DEFAULT_MEMORY_MB,
    DEFAULT_TIMEOUT_S,
    ExecutionSpec,
    SandboxResult,
    preflight,
)

#: Ceiling on the serialized payload a trusted program may be handed. It is the
#: one part of the composed source a caller's data reaches, so it is bounded
#: here rather than trusted to the caller's own validation.
MAX_PAYLOAD_BYTES = 262_144

_REGISTERED_PROGRAMS: set[str] = set()

#: Matches a `__future__` import anywhere, including one indented inside a
#: string — deliberately over-broad. A false refusal costs one comment rewrite;
#: a miss costs a SyntaxError that only appears inside a sandbox.
_FUTURE_IMPORT = re.compile(r"^\s*from\s+__future__\s+import\b", re.M)


class TrustedProgramRejected(RuntimeError):
    """A program reached `run_trusted` without having been registered."""


class TrustedPayloadTooLarge(ValueError):
    """The serialized payload exceeded `MAX_PAYLOAD_BYTES`."""


def register_trusted_program(source: str) -> str:
    """Record a control-plane program as runnable and return its digest.

    Call this on a module's own source text at import time — never on a string
    assembled from a request. The returned digest is what `run_trusted`
    re-computes and checks.

    **That first sentence is a convention this function cannot enforce.** It
    takes any `str` and will happily digest request-derived text; the check it
    backs proves integrity (what runs is what was registered), not provenance
    (what was registered came from this repository). See the module docstring.
    """

    if _FUTURE_IMPORT.search(source):
        # A `__future__` import is legal only as the first statement of the
        # compiled unit, and a trusted program is never the whole unit: this
        # module appends its payload globals and an entrypoint call after it,
        # and `LocalSubprocessSandbox` prepends an rlimit bootstrap ahead of
        # everything. Either one turns the program into a SyntaxError before a
        # line of it runs — and it fails INSIDE the sandbox, where the only
        # symptom is an absent sidecar. Refuse it here, at the worker's import,
        # rather than there, on a user's run.
        raise TrustedProgramRejected(
            "a trusted program may not carry a `from __future__` import: it is "
            "composed into a larger script and would become a SyntaxError"
        )
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    _REGISTERED_PROGRAMS.add(digest)
    return digest


def is_registered(source: str) -> bool:
    return hashlib.sha256(source.encode("utf-8")).hexdigest() in _REGISTERED_PROGRAMS


def compose_trusted(program: str, *, payload: str, result_path: str, entrypoint: str) -> str:
    """The program verbatim and FIRST, then its two globals, then one call.

    The globals are appended rather than prepended, and the order is not
    cosmetic: a module's docstring and its `from __future__` imports must be
    the first statements in the file, so an assignment placed above them makes
    the whole program a SyntaxError before a line of it runs. A trusted program
    is ordinary source that is also imported by tests, so it will have both.

    Appending also keeps the digested text first and unaltered, which is what
    makes the SHA-256 `run_trusted` checked a statement about what executes.

    The trailing `entrypoint()` call is here rather than in the program's own
    `if __name__ == "__main__"` block because that block would run BEFORE these
    assignments and die on a NameError with no sidecar written. Its absence is
    also what keeps importing the program side-effect free.

    `payload` and `result_path` are written as Python string literals via
    `repr`, so a caller's data can only ever be *data* inside the composed
    module; it is never parsed as code.
    """

    if not entrypoint.isidentifier():
        raise ValueError(f"trusted entrypoint must be a plain identifier, got {entrypoint!r}")
    composed = (
        f"{program}\n\n"
        f"LEONA_TRUSTED_PAYLOAD = {payload!r}\n"
        f"LEONA_TRUSTED_RESULT_PATH = {result_path!r}\n"
        f"{entrypoint}()\n"
    )
    # Compiled, not just concatenated. A composition error is otherwise
    # indistinguishable from a compiler failure: the sandbox writes no sidecar
    # either way, and the stderr that says which one it was is inside a machine
    # that has already been destroyed.
    compile(composed, "<leona-trusted>", "exec")
    return composed


async def run_trusted(
    sandbox: Sandbox,
    *,
    program: str,
    payload: dict[str, Any],
    result_path: str,
    entrypoint: str = "_main",
    timeout_s: int = DEFAULT_TIMEOUT_S,
    memory_mb: int = DEFAULT_MEMORY_MB,
) -> SandboxResult:
    """Execute a registered control-plane program against a JSON payload.

    Skips the generated-code guard by design (see the module docstring) and
    keeps every other pre-dispatch cap. The program writes its answer to
    `result_path`, which the provider reads back as `protected_result`.
    """

    if not is_registered(program):
        raise TrustedProgramRejected(
            "run_trusted accepts only programs registered with "
            "register_trusted_program; refusing to execute unregistered source"
        )
    serialized = json.dumps(payload, allow_nan=False, sort_keys=True, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise TrustedPayloadTooLarge(
            f"trusted payload is {len(serialized.encode('utf-8'))} bytes, "
            f"over the {MAX_PAYLOAD_BYTES} byte limit"
        )
    spec = ExecutionSpec(
        code=compose_trusted(
            program, payload=serialized, result_path=result_path, entrypoint=entrypoint
        ),
        timeout_s=timeout_s,
        memory_mb=memory_mb,
        protected_result_path=result_path,
    )
    preflight(spec)
    return await sandbox._execute(spec)
