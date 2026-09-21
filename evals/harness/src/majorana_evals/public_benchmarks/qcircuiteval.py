"""QCircuitEval (Qiskit-framework subset) loader + STRUCTURAL scorer.

Read `evals/public-benchmarks/qcircuiteval/PROVENANCE.md` before trusting a result from this
module: it implements only the structural half of QCircuitEval's own per-task grading
contract (`forbidden_imports`, `forbidden_calls`, and every field under `metadata_checks`),
by executing the candidate's `entry_point` function (once per declared `case`, for the QEC
suite's parametrized tasks) and inspecting the returned `QuantumCircuit`'s gate/measurement
structure. It does NOT implement the functional grader — whether the measured distribution
actually matches `expected_dominants` / `expected_peaks` / `exact_distribution` within the
task's declared tolerance — because that logic is genuinely non-trivial (statevector/unitary
equivalence, Hellinger-distance thresholds, multi-case QEC comparisons) and the upstream
`qceval` package that implements it is not a lightweight dependency (see PROVENANCE.md).

`score_qcircuiteval_task` therefore always sets `functional_grading="not_implemented"` on
its result; `passed` reflects the structural checks ONLY and must not be read as "QCircuitEval
says this is correct".

A second, narrower gap: 7 of the 70 vendored tasks (e.g. `qaoa_maxcut_ansatz(G, beta, gamma)`)
declare an `entry_point` that takes required arguments whose concrete values live only in the
task's prose, not as structured data — QCircuitEval's own grader reads them from
`src/qceval/assets/targets/{core,qec}/*.json`, not vendored here. Those tasks cannot be
called at all, so they are reported with a reason prefixed `ungradable:` and `passed=False`
(never a fabricated pass) rather than silently skipped; see `UNGRADABLE_PREFIX`."""

from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from majorana_evals.public_benchmarks.schema import PublicTask

_QISKIT_DIR = Path(__file__).resolve().parents[4] / "public-benchmarks" / "qcircuiteval" / "qiskit"
DEFAULT_CORE_PATH = _QISKIT_DIR / "core.jsonl"
DEFAULT_QEC_PATH = _QISKIT_DIR / "qec.jsonl"

#: Pinned in PROVENANCE.md.
PINNED_SHA256 = {
    "core": "c0a7e8c88c017534dae109f40827a35b06a202c5a54031eea473305c480cbe30",
    "qec": "901e49554ac7d907fa27e52b75a615dd9e0793b876a13f6ff928ad5e28f80038",
}
PINNED_COMMIT_SHA = "e7e4eb300074286191380f81b97697b155a573f5"

#: QCircuitEval's own prompts are already phrased as a direct code-completion instruction
#: (see a vendored example in PROVENANCE.md), so they are used close to verbatim; bump this
#: if the wrapper text below changes.
PROMPT_VERSION = "qcircuiteval-v1"

_CHECK_TIMEOUT_S = 30.0


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def load_qcircuiteval_tasks(
    *,
    core_path: Path | str = DEFAULT_CORE_PATH,
    qec_path: Path | str = DEFAULT_QEC_PATH,
    include_qec: bool = True,
) -> list[PublicTask]:
    """Load the vendored Qiskit-framework QCircuitEval tasks (58 core + 12 QEC = 70).

    Raises `ValueError` on a hash mismatch against `PINNED_SHA256`, for the same reason as
    `qiskit_human_eval.load_qiskit_human_eval_tasks`.
    """

    core_path = Path(core_path)
    qec_path = Path(qec_path)
    core_digest = _sha256(core_path)
    if core_digest != PINNED_SHA256["core"]:
        raise ValueError(
            f"{core_path} does not match the pinned QCircuitEval core hash: "
            f"got {core_digest}, expected {PINNED_SHA256['core']} (commit {PINNED_COMMIT_SHA})."
        )
    records = _load_jsonl(core_path)
    if include_qec:
        qec_digest = _sha256(qec_path)
        if qec_digest != PINNED_SHA256["qec"]:
            raise ValueError(
                f"{qec_path} does not match the pinned QCircuitEval qec hash: "
                f"got {qec_digest}, expected {PINNED_SHA256['qec']} (commit {PINNED_COMMIT_SHA})."
            )
        records += _load_jsonl(qec_path)

    tasks = [
        PublicTask(
            benchmark="qcircuiteval",
            task_id=record["task_id"],
            entry_point=record["entry_point"],
            nala_prompt=build_nala_prompt(record["prompt"]),
            canonical_solution=record["canonical_solution"],
            scaffold=_scaffold_from_prompt(record["prompt"]),
            grading={"canonical_class": record["canonical_class"]},
            category=record.get("category"),
        )
        for record in records
    ]
    return sorted(tasks, key=lambda task: task.task_id)


def build_nala_prompt(qce_prompt: str) -> str:
    """QCircuitEval's own `prompt` field, used near-verbatim: it was already written to be
    handed directly to a code-generation model ("Complete the function... Return complete
    Python source only... Submission contract: ...")."""

    return qce_prompt


def _scaffold_from_prompt(qce_prompt: str) -> str:
    """Best-effort extraction of the ```python ... ``` scaffold block, for the stub's
    canonical-mode source (scaffold + canonical_solution's own imports overlap harmlessly;
    the canonical_solution is a complete function on its own, so this is only used as a
    fallback prefix, never required for correctness)."""

    if "```python" not in qce_prompt:
        return ""
    return qce_prompt.split("```python", 1)[1].split("```", 1)[0]


def _forbidden_identifiers_present(source: str, forbidden: list[str]) -> list[str]:
    """Names from `forbidden` that appear as an import, a call, or a bare reference.

    Static (no execution): parses the source with `ast` and collects every `Name`,
    `Attribute.attr`, and imported name, so `from qiskit.circuit.library import Grover` and
    `qiskit.circuit.library.Grover(...)` are both caught the same way.
    """

    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"<source did not parse: {exc}>"]
    seen: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            seen.update(alias.name.split(".")[-1] for alias in node.names)
            seen.update(alias.asname for alias in node.names if alias.asname)
        elif isinstance(node, ast.ImportFrom):
            seen.update(alias.name for alias in node.names)
            seen.update(alias.asname for alias in node.names if alias.asname)
        elif isinstance(node, ast.Name):
            seen.add(node.id)
        elif isinstance(node, ast.Attribute):
            seen.add(node.attr)
    return sorted(seen & set(forbidden))


_INTROSPECT_TEMPLATE = """
import json
import sys

{source}

_cases = {cases!r}
_results = []
for _args in _cases:
    try:
        _circuit = {entry_point}(*_args)
    except Exception as exc:
        _results.append({{"error": f"{{type(exc).__name__}}: {{exc}}"}})
        continue
    _type_name = type(_circuit).__name__
    if not (hasattr(_circuit, "data") and hasattr(_circuit, "num_qubits")):
        _results.append({{"error": f"returned {{_type_name}}, not a QuantumCircuit"}})
        continue
    _entangling = 0
    _measurement = 0
    _non_measurement = 0
    _measured_qubits = []
    for _instruction in _circuit.data:
        _op = _instruction.operation
        _name = _op.name
        _qubit_indices = [_circuit.find_bit(_q).index for _q in _instruction.qubits]
        if _name == "measure":
            _measurement += 1
            _measured_qubits.extend(_qubit_indices)
        else:
            _non_measurement += 1
            if _op.num_qubits >= 2 and _name != "barrier":
                _entangling += 1
    _results.append({{
        "num_qubits": _circuit.num_qubits,
        "entangling_gate_count": _entangling,
        "measurement_count": _measurement,
        "non_measurement_operation_count": _non_measurement,
        "measured_qubits": sorted(set(_measured_qubits)),
    }})

print(json.dumps(_results))
"""


def _introspect_cases(source: str, entry_point: str, cases: list[tuple]) -> list[dict[str, Any]]:
    script = _INTROSPECT_TEMPLATE.format(source=source, cases=cases, entry_point=entry_point)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(script)
        script_path = handle.name
    try:
        result = subprocess.run(  # noqa: S603 - fixed interpreter, no shell
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=_CHECK_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return [{"error": f"did not complete within {_CHECK_TIMEOUT_S:.0f}s"}]
    finally:
        Path(script_path).unlink(missing_ok=True)
    if result.returncode != 0:
        tail = "\n".join(result.stderr.strip().splitlines()[-20:])
        return [{"error": f"candidate source did not execute (exit {result.returncode}): {tail}"}]
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return [{"error": f"introspection produced no parseable output: {result.stdout[-500:]!r}"}]


#: Marker prefix so a caller can tell "this task cannot be graded with the data vendored
#: here" apart from "Nala's code failed this task" — see `_required_entry_point_args`.
UNGRADABLE_PREFIX = "ungradable:"


def _required_entry_point_args(source: str, entry_point: str) -> list[str] | None:
    """Positional/keyword parameter names `entry_point` requires (no default), or None if
    it cannot be found — read from the CANDIDATE source, not the canonical_solution, since
    a task with a well-formed entry point is what this is meant to detect."""

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == entry_point:
            args = node.args
            defaults_for = len(args.defaults)
            positional = args.args[: len(args.args) - defaults_for] if defaults_for else args.args
            kw_only_required = [
                a.arg for a, d in zip(args.kwonlyargs, args.kw_defaults) if d is None
            ]
            return [a.arg for a in positional] + kw_only_required
    return None


def score_qcircuiteval_task(source: str, task: PublicTask) -> tuple[bool, list[str]]:
    """Structural-only score. See the module docstring for what this does and does not
    check. Returns (passed, reasons); `passed=True` means "every structural check in the
    task's own contract passed", never "the functional answer is correct".

    7 of the 70 vendored tasks declare an `entry_point` that takes required arguments
    (e.g. `qaoa_maxcut_ansatz(G, beta, gamma)`) whose concrete values are described only in
    the task's PROSE (`prompt`), not as structured data — QCircuitEval's own grader reads
    them from `src/qceval/assets/targets/{core,qec}/*.json`, which is not vendored here (see
    PROVENANCE.md). Those tasks are reported with a reason starting with `UNGRADABLE_PREFIX`
    and `passed=False` — never a fabricated pass — so a caller can tell "this harness cannot
    grade this task with the data it has" apart from "Nala's code is wrong"."""

    canonical_class = task.grading.get("canonical_class", {})
    if canonical_class.get("type") == "case_table":
        cases = canonical_class.get("cases", [])
        arg_tuples = [tuple(case["args"]) for case in cases]
    else:
        required = _required_entry_point_args(source, task.entry_point)
        if required:
            return False, [
                f"{UNGRADABLE_PREFIX} entry_point {task.entry_point!r} requires argument(s) "
                f"{required} whose concrete values are not in the vendored dataset (no "
                "case_arg_names/cases, and the target/manifest assets that carry them were "
                "not vendored — see qcircuiteval/PROVENANCE.md)"
            ]
        arg_tuples = [()]

    reasons: list[str] = []

    forbidden_imports = canonical_class.get("forbidden_imports", [])
    if forbidden_imports:
        hit = _forbidden_identifiers_present(source, forbidden_imports)
        if hit:
            reasons.append(f"uses forbidden import(s): {', '.join(hit)}")

    metadata = canonical_class.get("metadata_checks", {})
    forbidden_calls = metadata.get("forbidden_calls", [])
    if forbidden_calls:
        hit = _forbidden_identifiers_present(source, forbidden_calls)
        if hit:
            reasons.append(f"uses forbidden call(s): {', '.join(hit)}")

    case_results = _introspect_cases(source, task.entry_point, arg_tuples)
    if len(case_results) != len(arg_tuples):
        reasons.append(
            f"introspection returned {len(case_results)} case result(s), expected {len(arg_tuples)}"
        )
        return False, reasons

    for case, stats in zip(arg_tuples, case_results, strict=True):
        label = f"case{case!r}" if case else "case()"
        if "error" in stats:
            reasons.append(f"{label}: {stats['error']}")
            continue
        if "min_num_qubits" in metadata and stats["num_qubits"] < metadata["min_num_qubits"]:
            reasons.append(
                f"{label}: num_qubits {stats['num_qubits']} < min_num_qubits {metadata['min_num_qubits']}"
            )
        if (
            "min_entangling_gate_count" in metadata
            and stats["entangling_gate_count"] < metadata["min_entangling_gate_count"]
        ):
            reasons.append(
                f"{label}: entangling_gate_count {stats['entangling_gate_count']} < "
                f"min_entangling_gate_count {metadata['min_entangling_gate_count']}"
            )
        if (
            "min_measurement_count" in metadata
            and stats["measurement_count"] < metadata["min_measurement_count"]
        ):
            reasons.append(
                f"{label}: measurement_count {stats['measurement_count']} < "
                f"min_measurement_count {metadata['min_measurement_count']}"
            )
        if (
            "max_measurement_count" in metadata
            and stats["measurement_count"] > metadata["max_measurement_count"]
        ):
            reasons.append(
                f"{label}: measurement_count {stats['measurement_count']} > "
                f"max_measurement_count {metadata['max_measurement_count']}"
            )
        if (
            "min_non_measurement_operation_count" in metadata
            and stats["non_measurement_operation_count"]
            < metadata["min_non_measurement_operation_count"]
        ):
            reasons.append(
                f"{label}: non_measurement_operation_count "
                f"{stats['non_measurement_operation_count']} < "
                f"min_non_measurement_operation_count "
                f"{metadata['min_non_measurement_operation_count']}"
            )
        required_qubits = set(metadata.get("required_measurement_qubits", []))
        if required_qubits and not required_qubits <= set(stats["measured_qubits"]):
            reasons.append(
                f"{label}: measured qubits {stats['measured_qubits']} missing required "
                f"{sorted(required_qubits - set(stats['measured_qubits']))}"
            )
        forbidden_qubits = set(metadata.get("forbidden_measurement_qubits", []))
        hit_forbidden = forbidden_qubits & set(stats["measured_qubits"])
        if hit_forbidden:
            reasons.append(f"{label}: measured forbidden qubit(s) {sorted(hit_forbidden)}")

    return not reasons, reasons
