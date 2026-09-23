"""Checks that a task's `prompt` never names the very API drift it is grading.

**Why this exists**: a prompt that says "use `transpile()` and `backend.run()`, never the
removed `execute()`" tells a model exactly which API to call — passing such a task then
measures instruction-following ("did the model do what the prompt said"), not SDK currency
("does the model's own default idiom, absent any hint, still work"). This benchmark's whole
premise (SPEC.md) is that a model trained on old Qiskit code will REFLEXIVELY reach for the
old idiom; a prompt that forbids the old idiom by name defeats that premise by handing the
model the answer.

**What counts as "the drift", mechanically**: for each case, extract identifier-shaped
tokens from `change.old_api` and `change.new_api` and take the SYMMETRIC DIFFERENCE — the
tokens present in exactly one of the two snippets. A token present in BOTH (e.g. `Sampler`
appears in both the V1 and V2 import lines; `UnitaryGate` is imported from two different
modules by the same name; `generate_preset_pass_manager`/`parallel_map` are called by both
the old and new code, just with different arguments) does not by itself reveal which
generation to use, so it is not banned — this is the mechanical form of "name the concept,
not the V1/V2 class" (e.g. "a Sampler primitive" is fine to say; `StatevectorSampler`, which
appears only on the new_api side, is not). Everything in the symmetric difference IS
distinctive to one side and is banned, after dropping a short, reviewed allowlist of
vocabulary needed to state ANY Qiskit task (`_ALLOWED_WORDS`) — a word not on that list is
banned by default, not exempted by default.

The word forms "removed"/"deprecated"/"legacy", and every dotted version number
(`X.Y[.Z]`) appearing in `change.changed_in_version`, are banned unconditionally.

Matching is a case-insensitive SUBSTRING search, not exact-token equality: a test-harness
function name like `cnot_circuit_unitary` reads as containing "cnot" even though it is
technically one underscore-joined identifier, and that readable leak is exactly the priming
effect this check exists to catch — exact-token matching would silently miss it. The one
deliberate exception is the file-FORMAT name "qasm"/"openqasm", allowed outright: two of
these tasks are genuinely about producing/parsing OpenQASM text, and there is no way to
state that task without the format's own name, independent of which API produces or parses
it."""

from __future__ import annotations

import re

from majorana_evals.sdk_drift.schema import SdkDriftTask

_IDENTIFIER_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
#: `changed_in_version` is free text ("deprecated in 1.2, removed in 2.0") — extract the
#: actual dotted version NUMBERS out of it rather than banning the whole sentence (which
#: would never usefully match) or individual bare digits (which WOULD false-positive on
#: an ordinary qubit count like "5 qubits").
_VERSION_NUMBER_RE = re.compile(r"\d+\.\d+(?:\.\d+)?")

#: Vocabulary needed to state ANY well-posed Qiskit task, regardless of which API
#: generation is under test — banning these would make it impossible to write a prompt at
#: all, not just a neutral one. A word not on this (intentionally short) list is banned
#: whenever it lands in the symmetric difference; this list is reviewed by hand against
#: every case's own old_api/new_api pair, not grown reactively to make a check pass.
_ALLOWED_WORDS = frozenset(
    {
        "backend",
        "backends",
        "circuit",
        "circuits",
        "qubit",
        "qubits",
        "gate",
        "gates",
        "value",
        "values",
        "shots",
        "shot",
        "result",
        "results",
        "job",
        "jobs",
        "register",
        "registers",
        "ancilla",
        "index",
        "name",
        "names",
        "true",
        "false",
        "none",
        "and",
        "or",
        "not",
        "in",
        "is",
        "as",
        "from",
        "import",
        "def",
        "self",
        "return",
        "qc",
        "np",
        "list",
        "dict",
        "str",
        "int",
        "float",
        "bool",
        "theta",
        "angle",
        "matrix",
        "data",
        "optimization",
        "level",
        "levels",
        "pass",
        "manager",
        "preset",
        "run",
        #: The file-FORMAT name, not an implementation identifier (see module docstring).
        "qasm",
        "openqasm",
        #: Every prompt legitimately opens "Using Qiskit, write a function...".
        "qiskit",
        #: The English verb describing what a parsing task DOES, not the specific
        #: `.parse()` method call — unavoidable for a task that is genuinely about
        #: reading a text format, independent of which API does the reading.
        "parse",
        #: Qiskit's default classical-register name after `.measure_all()` — collides
        #: with the ordinary English word "measurement", which no circuit-execution
        #: prompt can avoid using.
        "meas",
        #: Per explicit review guidance: naming the general PRIMITIVE CONCEPT ("a Sampler
        #: primitive", "an Estimator primitive") is allowed; only a specific V1/V2 CLASS
        #: name is banned (`StatevectorSampler`/`StatevectorEstimator` are distinct,
        #: unshared tokens and are caught by the symmetric-difference rule above without
        #: needing to be listed here — only the bare, shared class names need this
        #: explicit exception, since `Sampler`/`Estimator` alone are NOT the same string
        #: as their V2 counterparts and would not otherwise cancel out).
        "sampler",
        "estimator",
    }
)


def leaked_identifiers(task: SdkDriftTask) -> list[str]:
    """Every banned phrase — a symmetric-difference old_api/new_api identifier, a
    `changed_in_version` version number, or the words removed/deprecated/legacy — found as
    a case-insensitive substring in `task.prompt`. Empty means clean."""

    old_tokens = _tokens(task.change.old_api)
    new_tokens = _tokens(task.change.new_api)
    banned = (old_tokens ^ new_tokens) | {"removed", "deprecated", "legacy"}
    banned.update(
        match.lower() for match in _VERSION_NUMBER_RE.findall(task.change.changed_in_version)
    )

    prompt_lower = task.prompt.lower()
    return sorted(phrase for phrase in banned if phrase in prompt_lower)


def _tokens(snippet: str) -> set[str]:
    return {
        match.lower()
        for match in _IDENTIFIER_RE.findall(snippet)
        if len(match) >= 3 and match.lower() not in _ALLOWED_WORDS
    }
