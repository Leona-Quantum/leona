"""Static safety guard for model/user-generated Python, run BEFORE it reaches any
runner. Ported from the legacy nameko py-guard.ts.

This is DEFENSE IN DEPTH, not the isolation boundary. The real boundary is the
sandbox's deny-all network egress + OS-level isolation (see vercel.py and
05-security.md §1). The guard exists so that even a misconfigured runner is not
one prompt-injection away from network access, subprocess execution, filesystem
tampering, or cloud metadata-server credential theft.

Strategy: allowlist the scientific-stack + side-effect-free stdlib modules the
generated code may import, and deny a small set of high-confidence dangerous
tokens/builtins that legitimate quantum-simulation code never needs."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Top-level modules generated code may import: the installed scientific/quantum
# stack (mirrors the sandbox OCI image) plus pure-Python stdlib with no process,
# network, or filesystem-write surface.
ALLOWED_IMPORTS: frozenset[str] = frozenset(
    {
        "qiskit",
        "qiskit_aer",
        "pennylane",
        "pennylane_lightning",
        "cirq",
        "numpy",
        "scipy",
        "sympy",
        "networkx",
        "matplotlib",
        "mpl_toolkits",
        "pylatexenc",
        # Side-effect-free standard library.
        "math",
        "cmath",
        "json",
        "base64",
        "io",
        "itertools",
        "functools",
        "collections",
        "dataclasses",
        "typing",
        "random",
        "decimal",
        "fractions",
        "statistics",
        "re",
        "time",
        "datetime",
        "warnings",
        "copy",
        "abc",
        "enum",
        "string",
        "textwrap",
        "heapq",
        "bisect",
        "operator",
        "contextlib",
        "numbers",
        "array",
        "hashlib",
    }
)

# Attribute/module tokens that must never appear — matched as plain substrings
# because they do not occur in legitimate quantum-simulation code.
DENIED_SUBSTRINGS: tuple[str, ...] = (
    "__import__",
    "importlib",
    "subprocess",
    "os.system",
    "os.popen",
    "os.exec",
    "os.spawn",
    "os.fork",
    "os.environ",
    "os.getenv",
    "os.putenv",
    "socket",
    "ctypes",
    "cffi",
    "pty.",
    "pickle",
    "marshal",
    "shelve",
    "sys.modules",
    "sys.argv",
    "__subclasses__",
    "__globals__",
    "__builtins__",
    "__loader__",
    "metadata.google.internal",
    "169.254.169.254",
    "computeMetadata",
    "urllib",
    "requests.",
    "httpx",
    "http.client",
    "aiohttp",
    "ftplib",
    "smtplib",
    "telnetlib",
    "paramiko",
    # `io` is allowed because matplotlib output goes through io.BytesIO, and
    # `io.open` IS the `open` builtin — so denying the bare call below while
    # leaving this reachable denied nothing. Measured: `io.open('/etc/passwd')`
    # passed the guard cleanly.
    "io.open",
    # numpy is allowed for obvious reasons, and these four are its filesystem
    # primitives. `np.load` additionally executes pickles when a caller asks it
    # to. No circuit needs any of them; a name like `read_fromfile` matching is
    # a false positive the author can rename around.
    ".fromfile",
    ".tofile",
    "np.load",
    "numpy.load",
)

# Builtins that must not appear as a direct (non-method) call.
#
# The negative lookbehind avoids matching legitimate method CALLS like
# `expr.eval(...)`. It did not avoid matching a method DEFINITION — `def
# eval(self, x)` has a space before the name, so a generated class that defined
# one was blocked with the network-and-subprocess refusal message for something
# that is neither. `def\s+` is excluded for that reason; a definition binds a
# name, it does not invoke the builtin.
DENIED_CALLS: tuple[str, ...] = ("__import__", "eval", "exec", "compile", "open", "breakpoint")

_FROM_RE = re.compile(r"^from\s+([.\w]+)\s+import\b")
_IMPORT_RE = re.compile(r"^import\s+(.+)$")

#: `module.attribute` pairs that are denied wherever they are reachable from.
#: DENIED_SUBSTRINGS above catches the spelling people actually write; this
#: catches the spellings that reach the same function through a rename.
#:
#: Two shapes evade a substring check entirely:
#:
#:     import io as i          ->  i.open(...)
#:     from io import open     ->  open(...)   (also `as read` -> read(...))
#:
#: Neither is exotic — the first is how numpy is imported in every file in this
#: repository. So the aliases are resolved from the import lines and the denied
#: attribute is then looked for under whatever name the code gave it.
ALIASED_DENIALS: dict[str, frozenset[str]] = {
    "io": frozenset({"open"}),
    "numpy": frozenset({"load", "fromfile", "tofile", "save", "savetxt", "loadtxt"}),
}

_IMPORT_AS_RE = re.compile(r"^import\s+([.\w]+)(?:\s+as\s+(\w+))?\s*$")
_FROM_IMPORT_NAMES_RE = re.compile(r"^from\s+([.\w]+)\s+import\s+(.+?)\s*$")


def _aliased_violations(code: str) -> list[str]:
    """Denied attributes reached under a name the import statement invented."""
    violations: list[str] = []
    for raw_line in code.splitlines():
        line = raw_line.strip()

        if module_import := _IMPORT_AS_RE.match(line):
            module, alias = module_import.group(1), module_import.group(2)
            denied = ALIASED_DENIALS.get(_top_level(module))
            if denied and alias:
                for attribute in denied:
                    if re.search(rf"(?<![.\w]){re.escape(alias)}\.{attribute}\s*\(", code):
                        violations.append(f"denied_alias:{alias}.{attribute}")
            continue

        if from_import := _FROM_IMPORT_NAMES_RE.match(line):
            module, names = from_import.group(1), from_import.group(2)
            denied = ALIASED_DENIALS.get(_top_level(module))
            if not denied:
                continue
            for part in names.strip("()").split(","):
                pieces = part.strip().split()
                if not pieces:
                    continue
                imported = pieces[0]
                bound = pieces[2] if len(pieces) >= 3 and pieces[1] == "as" else imported
                if imported in denied:
                    violations.append(f"denied_import_of:{module}.{imported} as {bound}")
    return violations


@dataclass
class GuardResult:
    ok: bool
    violations: list[str] = field(default_factory=list)
    reason: str | None = None


def _top_level(module_name: str) -> str:
    return module_name.split(".")[0]


def _extract_top_level_imports(code: str) -> list[str]:
    modules: list[str] = []
    for raw_line in code.splitlines():
        line = raw_line.strip()
        if from_match := _FROM_RE.match(line):
            modules.append(_top_level(from_match.group(1)))
            continue
        if import_match := _IMPORT_RE.match(line):
            for part in import_match.group(1).split(","):
                name = re.split(r"\s+as\s+|\s+|;", part.strip())[0]
                if name:
                    modules.append(_top_level(name))
    return modules


def check_python_code(code: str, extra_allowed: frozenset[str] = frozenset()) -> GuardResult:
    """Check generated Python for disallowed imports and dangerous constructs.
    Never raises; the caller decides what to do with a blocked result."""
    allowed = ALLOWED_IMPORTS | extra_allowed
    violations: list[str] = []

    for module_name in _extract_top_level_imports(code):
        if module_name not in allowed:
            violations.append(f"disallowed_import:{module_name or '(relative)'}")

    for token in DENIED_SUBSTRINGS:
        if token in code:
            violations.append(f"denied_token:{token}")

    # Definitions are removed before the call scan rather than exempted inside
    # it: a lookbehind is fixed-width, so `(?<!def\s)` exempts `def eval(` and
    # not `def  eval(`, which Python accepts and which was still being refused.
    without_definitions = re.sub(r"\bdef\s+\w+\s*\(", "def _(", code)
    for name in DENIED_CALLS:
        if re.search(rf"(?<![.\w]){re.escape(name)}\s*\(", without_definitions):
            violations.append(f"denied_call:{name}")

    violations.extend(_aliased_violations(code))

    unique = list(dict.fromkeys(violations))
    if not unique:
        return GuardResult(ok=True)
    return GuardResult(
        ok=False,
        violations=unique,
        reason=(
            "Code blocked by the Python safety guard before execution. Only quantum/"
            "scientific libraries and side-effect-free stdlib are permitted; network, "
            "subprocess, filesystem/OS access, and dynamic imports are not allowed. "
            f"Violations: {', '.join(unique)}."
        ),
    )
