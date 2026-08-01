"""What a piece of source IS: a circuit, or a program that runs one.

## The problem this exists to name

Three surfaces in this product hold quantum source and they have never agreed on
what "the code" means:

* the **open repository** publishes a circuit — a definition. `FINAL_CIRCUIT` is
  built and that is the whole file. Nothing executes, nothing is measured,
  nothing is reported, because a published circuit is a thing you take, not a
  thing you ran.
* the **agent** emits a program — a script that builds a circuit, executes it on
  a simulator, and binds `RESULT` to what it found.
* an **artifact version** holds one `code` blob that is silently either.

They were treated as interchangeable, and the consequence was concrete: a run
whose source came from the repository executed fine, produced a complete set of
trusted observations, and then FAILED its execution contract with `RESULT missing
key` — because a circuit binds no `RESULT`. The retry target for that failure is
GENERATION, so a run over a published circuit went to a language model to be
rewritten. The user's own circuit, replaced by a model's guess at it.

## What consolidation actually means here

Not "make them one blob". The distinction is real and it is the distinction that
matters most for everything coming next: you can transpile, block-encode, or
re-target a circuit, and you cannot do any of those to a script that prints a
number. Collapsing them would destroy the thing that makes a repository worth
having.

So: one model, two declared roles, and a conversion in each direction.

* **Lifting** (program → circuit) already existed before this module. The sandbox
  epilogue observes `FINAL_CIRCUIT` and serializes it (`extract_interchange_qasm`).
* **Lowering** (circuit → program) is what was missing, and it needs no new
  simulator: `adapters._majorana_native_evidence` ALREADY executes `FINAL_CIRCUIT`
  through the framework's own sampler and statevector for every run. Measured
  against a real Bell circuit, a raw repository circuit and the agent's program
  for the same task produce byte-identical trusted evidence — the same counts,
  the same statevector, the same interchange QASM. The only difference between
  them was the `RESULT` binding. So lowering is: let the evidence that already
  ran BE the result, and say that it was.

`FrameworkProgram.trusted_observer(derive_result=True)` does that.

## The role is read off the source, never off the producer

`version_capabilities._origin` classifies a version by which of four writers made
it. That is the right question for "what does this row hold" and the wrong one
here: an agent program whose generation failed halfway is not a program, and a
circuit a user pasted into Studio has no producer at all. What decides is what
the source BINDS, structurally, in the AST — the same test `contract_diagnostics`
already applies to `FINAL_CIRCUIT`.

`UNKNOWN` is a real answer and is never guessed into one of the others. Source
that binds neither name is not a circuit with a missing result; it is something
this product cannot execute, and saying so is more useful than lowering it into a
program that will bind nothing either.
"""

from __future__ import annotations

import ast
from enum import StrEnum

#: The name a framework-native circuit must bind. Same literal
#: `adapters._binds_final_circuit` enforces; asserted equal in the tests.
CIRCUIT_NAME = "FINAL_CIRCUIT"

#: The name an executable program binds with what it found.
RESULT_NAME = "RESULT"


class ProgramRole(StrEnum):
    """What the source is, structurally."""

    #: Binds FINAL_CIRCUIT and no RESULT. What the open repository publishes.
    CIRCUIT = "circuit"
    #: Binds RESULT. What the agent emits and what a run's contract expects.
    PROGRAM = "program"
    #: Binds neither. Not executable as either, and not guessed into one.
    UNKNOWN = "unknown"


def _bound_names(source: str) -> frozenset[str] | None:
    """Module-level-ish names this source assigns. None when it will not parse.

    `ast.walk` rather than a scan of `tree.body`, deliberately: a circuit built
    inside `if __name__ == "__main__":`, a `for` loop, or a `try` block is still a
    circuit, and the sandbox executes the module top to bottom so any of those
    really do bind the name. The cost is that a binding inside a function body
    that never runs counts too — which is the safe direction here, because the
    consequence of a false CIRCUIT is one derived result the contract then
    rejects, while the consequence of a false PROGRAM is the rewrite loop this
    module exists to stop.

    Walrus and annotated assignments are included for the same reason
    `_binds_final_circuit` includes them: `FINAL_CIRCUIT: QuantumCircuit = qc` is
    ordinary typed Python and refusing to see it would be a trap. So are `for`,
    `with ... as`, `except ... as`, comprehensions, `def`/`class` and
    `import ... as` — assignment is not the only way Python binds a name.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    names: set[str] = set()

    def collect(target: ast.expr | None) -> None:
        if isinstance(target, ast.Name):
            names.add(target.id)
        elif isinstance(target, ast.Starred):
            collect(target.value)
        elif isinstance(target, (ast.Tuple, ast.List)):
            # `RESULT, counts = run()` binds RESULT. Unpacking is how a program
            # that computes two things at once usually writes it.
            for element in target.elts:
                collect(element)

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                collect(target)
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr, ast.AugAssign)):
            collect(node.target)
        # Every OTHER form Python has for putting a name in scope. Assignment is
        # not the only one, and treating it as the only one was not the harmless
        # direction the first draft assumed: a real PROGRAM binding RESULT via
        # `with ... as` was classified CIRCUIT, took the contract's circuit
        # branch, derived nothing (its own RESULT was already there), and was
        # then reported as "the circuit produced no result to report" — a failure
        # on a program that reported one perfectly well. Five forms were
        # confirmed misclassified before this was widened.
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            collect(node.target)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                collect(item.optional_vars)
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                names.add(node.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            names.update(node.names)
    return frozenset(names)


def classify_source(source: str) -> ProgramRole:
    """Circuit, program, or neither — from the source alone.

    PROGRAM wins over CIRCUIT when both names are bound, and that ordering is
    load-bearing rather than arbitrary: the agent's own output binds BOTH (it
    builds `FINAL_CIRCUIT` and then reports `RESULT`), so the other ordering
    would classify every generated program as a circuit and derive a result over
    the top of the one the program computed.

    Source that does not parse is UNKNOWN, not CIRCUIT. It binds nothing this
    module can see, and `contract_diagnostics` already refuses it by name with a
    better message than anything derivable here.
    """
    names = _bound_names(source)
    if names is None:
        return ProgramRole.UNKNOWN
    if RESULT_NAME in names:
        return ProgramRole.PROGRAM
    if CIRCUIT_NAME in names:
        return ProgramRole.CIRCUIT
    return ProgramRole.UNKNOWN


#: Provider-owned epilogue that turns a circuit's trusted evidence into its result.
#:
#: Appended AFTER everything an adapter emits — it reads only
#: `_majorana_observation`, which every framework's native evidence fills in the
#: same shape, so one block covers Qiskit, Cirq and PennyLane rather than three.
#:
#: Three properties it must have, and each one has a way of going wrong:
#:
#: 1. **It never overwrites a real result.** `"result" not in _majorana_observation`
#:    is checked first. A program that bound RESULT reported something, and
#:    replacing it with the sampler's own answer would delete the finding and
#:    substitute a tautology.
#: 2. **It says the result was derived.** `result_origin` is the field every
#:    consumer keys the honesty off: a derived result is not a claim the code
#:    made, so nothing downstream may check it against the same evidence it came
#:    from. That comparison is `f(x) == f(x)` — it cannot fail, and a check that
#:    cannot fail reported as PASS is worse than no check.
#: 3. **Every builtin it touches is the pre-bound `_majorana_` snapshot.** A bare
#:    `isinstance` here would resolve through normal scoping at epilogue time —
#:    after untrusted code has run, and `import builtins` is not on the guard's
#:    denied list. That is the shadowing defence every other epilogue in
#:    `adapters.py` already follows; the convention exists so nobody has to
#:    assess the blast radius of one bare call at a time.
#: 4. **A failure names EVERY reason, not the first.** An unmeasured circuit
#:    past the statevector ceiling is refused by the sampler (no measurements)
#:    AND by the statevector (too wide). Reporting one of those sends the reader
#:    to fix half a problem; the order between them would be arbitrary anyway.
#: 5. **It prefers counts to the statevector.** Counts are what a measured
#:    circuit produced and what `expected_output_keys` normally names; the
#:    statevector is the fallback for a circuit with no measurements at all,
#:    which is a legitimate thing to publish and impossible to sample.
DERIVE_RESULT_FROM_CIRCUIT = """
if "result" not in _majorana_observation:
    _majorana_sampled = _majorana_observation.get("native_sampled")
    _majorana_sv = _majorana_observation.get("native_statevector")
    if _majorana_isinstance(_majorana_sampled, dict) and _majorana_sampled.get("counts"):
        _majorana_observation["result"] = {
            "counts": _majorana_sampled.get("counts"),
            "shots": _majorana_sampled.get("shots"),
        }
        _majorana_observation["result_origin"] = "derived_from_circuit"
        _majorana_observation["result_evidence"] = "native_sampled"
    elif _majorana_isinstance(_majorana_sv, dict) and _majorana_sv.get("amplitudes"):
        _majorana_observation["result"] = {
            "statevector": _majorana_sv.get("amplitudes"),
            "qubits": _majorana_sv.get("qubits"),
        }
        _majorana_observation["result_origin"] = "derived_from_circuit"
        _majorana_observation["result_evidence"] = "native_statevector"
    else:
        _majorana_reasons = [
            _majorana_reason
            for _majorana_reason in (
                _majorana_observation.get("native_sampled_error"),
                _majorana_observation.get("native_statevector_error"),
            )
            if _majorana_reason
        ]
        _majorana_observation["result_derivation_error"] = (
            "; ".join(_majorana_reasons)
            if _majorana_reasons
            else "the circuit produced no trusted evidence to derive a result from"
        )
"""


def result_was_derived(observation: dict | None) -> bool:
    """Did the platform compute this result rather than the source reporting it?

    One reader for a decision three places have to make the same way — the
    contract check, the verification summary, and what the artifact says it
    holds. Written as a function rather than as `obs.get("result_origin") ==
    "derived_from_circuit"` inline so the literal exists once.
    """
    if not isinstance(observation, dict):
        return False
    return observation.get("result_origin") == "derived_from_circuit"
