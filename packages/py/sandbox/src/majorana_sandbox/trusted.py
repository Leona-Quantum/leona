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

**What keeps user text out of this door, and what part of it is mechanical.**
This paragraph twice said more than it could support, so it now says exactly
what the code enforces and stops there.

The first version claimed "a caller cannot pass a string it received over the
wire, because it could not have registered the digest." That was false while
`register_trusted_program` took a `str`: a caller that registered
request-derived source and then ran it would pass the check. CodeRabbit found it
on PR 778 and it was right. The second version corrected the claim to
integrity-not-provenance and left the gap open, recorded as ai-ops#190.

**The gap is now closed by construction, and this is how.**
`register_trusted_program` takes a `pathlib.Path`, not a `str`. It reads the
file itself. There is no application-callable path in this package that accepts
raw source text and records it as runnable, so registering a string received
over the wire is not something a caller can do wrongly — it is something the
signature refuses. Passing a `str` raises `TrustedProgramRejected` rather than
being coerced, because a silent coercion would re-open the door under a new
name.

**And the registry seals.** `seal_trusted_registry()` is called by the worker's
process entrypoint (`majorana_worker.__main__.main`) once startup registration
is done. After that, `register_trusted_program` raises
`TrustedRegistrySealed`. So even code that wrote attacker-controlled text to a
file and passed its path could not register it while a request is being served:
by then, nothing can register anything.

Two things this deliberately does NOT claim:

1. **A path is still named by the caller.** What the digest proves is that the
   text executed came off disk, at a path some caller named, before the seal.
   In the deployed worker that is a file in an installed first-party package;
   this module cannot verify that on its own and does not pretend to.
2. **Sealing is a call, not a language guarantee.** A process that never calls
   `seal_trusted_registry()` — every test process, for one — keeps an open
   registry. `trusted_registry_is_sealed()` exists so a caller can assert it
   rather than assume it.

Reading the live file, rather than a hand-maintained digest manifest, is
deliberate: it is what guarantees the digest can never drift from the deployed
source. A manifest would close the same gap and trade that property away.

The one production call site is
`services/worker/src/majorana_worker/handlers.py`, at module level, so it runs
at import and never while serving a request. What it registers is
`kernel_path()` — `majorana_frameworks.optimizers`, i.e.
`Path(__file__).with_name("optimizer_kernel.py")`. The kernel does not register
itself; the worker names a file inside its own installed package. The only
other call sites are in `packages/py/sandbox/tests/test_trusted.py`.

Independently of all of it, and still doing the heaviest lifting: the request
data travels as a JSON *payload* serialized by this module — never as code — so
nothing a user controls reaches the composed program except as the right-hand
side of one string assignment, written through `repr`.

The sandbox's own guarantees are unchanged and are still doing the real work:
deny-all egress, no credentials in the environment, and a provider-enforced
wall clock that destroys the machine rather than cancelling a coroutine.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
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

#: Whether registration is closed. Flipped once, by the worker's process
#: entrypoint, after startup registration and before the first poll cycle. It is
#: module state rather than a parameter because the property being asserted is
#: about the *process*, not about any one call.
_SEALED = False

#: Matches a `__future__` import anywhere, including one indented inside a
#: string — deliberately over-broad. A false refusal costs one comment rewrite;
#: a miss costs a SyntaxError that only appears inside a sandbox.
_FUTURE_IMPORT = re.compile(r"^\s*from\s+__future__\s+import\b", re.M)


class TrustedProgramRejected(RuntimeError):
    """A program reached `run_trusted` without having been registered."""


class TrustedPayloadTooLarge(ValueError):
    """The serialized payload exceeded `MAX_PAYLOAD_BYTES`."""


class TrustedRegistrySealed(RuntimeError):
    """Registration was attempted after `seal_trusted_registry`."""


def seal_trusted_registry() -> None:
    """Close registration for the rest of this process.

    Called by the worker's entrypoint once startup registration is done, so that
    a request-time registration is impossible rather than merely unconventional.
    Idempotent: sealing an already-sealed registry is not an error, because the
    property a caller wants afterwards is "closed", not "closed by me".
    """

    global _SEALED
    _SEALED = True


def trusted_registry_is_sealed() -> bool:
    """Whether registration is closed. Assert it rather than assuming it."""

    return _SEALED


def _reset_trusted_registry_for_tests() -> None:
    """Empty the registry and unseal it.

    Underscored and named for its only legitimate caller. A test suite has to be
    able to register repeatedly, and one that sealed the registry would poison
    every test that ran after it in the same process — module state outlives a
    test function.
    """

    global _SEALED
    _REGISTERED_PROGRAMS.clear()
    _SEALED = False


def register_trusted_program(source: Path) -> str:
    """Read a first-party program off disk and record it as runnable.

    Takes a `pathlib.Path` and reads it here. That is the whole provenance
    argument and it is why the parameter is not a `str`: there is no
    application-callable path in this package that turns caller-supplied *text*
    into a registered program, so registering something that arrived over the
    wire is not a mistake a caller can make. It was one while this took a `str`
    — CodeRabbit found it on PR 778 (ai-ops#190) and it was right.

    Refuses a `str` loudly instead of coercing it. A coercion would restore the
    exact gap this signature exists to close, and it would do it silently.

    Refuses to register at all once `seal_trusted_registry` has been called.

    The returned digest is what `run_trusted` re-computes and checks.
    """

    if _SEALED:
        raise TrustedRegistrySealed(
            "the trusted-program registry is sealed for this process; "
            "registration happens at startup, never while serving a request"
        )
    if not isinstance(source, Path):
        raise TrustedProgramRejected(
            "register_trusted_program takes a pathlib.Path and reads the file "
            f"itself, not {type(source).__name__} source text: reading it here "
            "is what makes the recorded digest a statement about a file on "
            "disk rather than about a string some caller assembled"
        )
    source = source.read_text(encoding="utf-8")

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
