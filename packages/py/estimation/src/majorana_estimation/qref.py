"""Import and export through QREF, the open Quantum Resource Estimation Format.

QREF is PsiQuantum's exchange format for algorithm-level resource counts
(`github.com/PsiQ/qref`, PyPI `qref`, Apache-2.0). Its schema v1 was read
directly from the primary source — `src/qref/schema_v1.py` in that repo,
fetched and quoted on 2026-09-21 against package version **0.11.0**
(uploaded 2025-04-08, per PyPI's JSON API, which was the latest release at
the time of writing and the version this module's shape was checked
against) — rather than assumed from a tutorial. The pin that matters is the
schema's own: `SchemaV1.version: Literal["v1"]`. There is no `v2`; `QREF_SCHEMA_VERSION`
below is that literal, not a guess at a moving target.

**`qref` is not a dependency of this package**, on purpose:
`packages/py/estimation/pyproject.toml` keeps `dependencies = []` so the API
and worker can import this package without dragging in anything —
`qref` itself is small (Apache-2.0, depending only on `pydantic>=2.0` and
`graphviz` for its optional visualiser) and would have been a defensible
add, but a hand-written mapping costs nothing further once the schema shape
is already pinned from the primary source, so there was no reason to widen
the dependency surface. `validate_qref_document` below checks structurally
against the exact constraints quoted from `schema_v1.py` (the `_Name`
pattern `^[A-Za-z_][A-Za-z0-9_]*$` and the `ResourceV1.type` enum) rather
than a self-invented approximation of them.

**QREF v1 has no concept of hardware.** Reading the schema confirms what its
own design implies: `RoutineV1` carries `ports`, `resources`, `connections`
and a free-form `meta` dict — nothing about a physical error rate, a code
distance, or a runtime. It is the algorithmic/logical layer only, the same
split this package already draws between `LogicalCost` (hardware-free) and
`AssumptionSet`+`estimate()` (hardware-dependent). So:

- `export_logical_cost_to_qref` / `import_logical_cost_from_qref` round-trip
  a `LogicalCost` through QREF's native vocabulary — `resources`, typed
  `"qubits"` or `"additive"` exactly as `ResourceV1.type` defines.
- `export_estimate_to_qref` exports the same logical resources, and adds the
  hardware-costed numbers (`assumption_set`, `total_physical_qubits`,
  `runtime_seconds`, `code_distance`) into `program.meta` under a
  `leona_`-prefixed key — QREF's own extension point for exactly this kind
  of tool-specific annotation. **Nothing here claims QREF standardises a
  physical-qubit count or a runtime**; the prefix and the module docstring
  are the disclosure that these are Leona's numbers riding along in the one
  field QREF reserves for exactly that, not a QREF resource.

**The resource names below are Leona's own convention, not QREF's.** QREF
does not standardise what a resource is called — that is the whole reason
`ResourceV1.name` is a free identifier rather than an enum. Another tool's
QREF document will not use these names unless it was also produced by this
module; `import_logical_cost_from_qref` says so in its docstring rather than
implying interop it cannot deliver on every QREF document that exists.
"""

from __future__ import annotations

import re

from .estimate import PhysicalEstimate
from .logical import LogicalCost

QREF_SCHEMA_VERSION = "v1"
"""`SchemaV1.version`'s pinned literal, quoted directly from
`src/qref/schema_v1.py` in github.com/PsiQ/qref at package version 0.11.0."""

QREF_PACKAGE_VERSION_CHECKED_AGAINST = "0.11.0"
"""The `qref` PyPI release this module's schema shape was verified against
(PyPI JSON API, `info.version`, checked 2026-09-21). Not installed; recorded
so a later change to the published schema can be noticed by re-checking this
version against whatever is then current."""

_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
"""`_Name`'s exact pattern in `schema_v1.py`: `^[A-Za-z_][A-Za-z0-9_]*$`."""

_RESOURCE_TYPES = frozenset({"additive", "multiplicative", "qubits", "other"})
"""`ResourceV1.type`'s exact `Literal` values in `schema_v1.py`."""

_ROUTINE_NAME = "leona_logical_workload"
"""Fixed, always-valid `program.name`. A `LogicalCost.label` is free text
(`"FeMoco ground state (Lee et al. 2021, as costed by Webber et al. fig. 1)"`
is a real one in this repo's own tests) and routinely violates `_NAME_PATTERN`,
so the label travels in `program.meta["label"]` instead, where QREF places no
constraint on the string."""

_LOGICAL_QUBITS = "logical_qubits"
_TOFFOLI_COUNT = "toffoli_count"
_T_COUNT = "t_count"
_NON_CLIFFORD_DEPTH = "non_clifford_depth"

_RESOURCE_KINDS: dict[str, str] = {
    _LOGICAL_QUBITS: "qubits",
    _TOFFOLI_COUNT: "additive",
    _T_COUNT: "additive",
    _NON_CLIFFORD_DEPTH: "additive",
}


def validate_qref_document(document: object) -> None:
    """Structurally check `document` against the shape `schema_v1.py` pins.

    Deliberately narrower than the full QREF schema: it checks the fields
    this module reads or writes (`version`, `program.name`, `program.resources`,
    `program.meta`) against their exact quoted constraints, and does not
    validate `ports`, `connections`, `children`, `linked_params` or
    `repetition` — this module never populates or reads them, so validating
    them would be checking a claim this module does not make. A document
    with extra, unrecognised top-level or `program` fields is not rejected;
    QREF documents from other tools may carry structure this module ignores.
    """
    if not isinstance(document, dict):
        raise ValueError(f"a QREF document must be an object, got {type(document).__name__}")
    if document.get("version") != QREF_SCHEMA_VERSION:
        raise ValueError(
            f"expected QREF schema version {QREF_SCHEMA_VERSION!r} "
            f"(SchemaV1.version in qref {QREF_PACKAGE_VERSION_CHECKED_AGAINST}), "
            f"got {document.get('version')!r}"
        )
    program = document.get("program")
    if not isinstance(program, dict):
        raise ValueError("a QREF document needs a 'program' object (RoutineV1)")
    name = program.get("name")
    if not isinstance(name, str) or not _NAME_PATTERN.match(name):
        raise ValueError(
            f"program.name {name!r} does not match QREF's _Name pattern {_NAME_PATTERN.pattern!r}"
        )
    resources = program.get("resources", [])
    if not isinstance(resources, list):
        raise ValueError("program.resources must be a list (NamedList[ResourceV1])")
    seen_names: set[str] = set()
    for entry in resources:
        if not isinstance(entry, dict) or "name" not in entry or "type" not in entry:
            raise ValueError(f"each resource needs at least 'name' and 'type': {entry!r}")
        if not _NAME_PATTERN.match(entry["name"]):
            raise ValueError(f"resource name {entry['name']!r} does not match QREF's _Name pattern")
        if entry["name"] in seen_names:
            raise ValueError(f"resource {entry['name']!r} is named more than once")
        seen_names.add(entry["name"])
        if entry["type"] not in _RESOURCE_TYPES:
            raise ValueError(
                f"resource {entry['name']!r} has type {entry['type']!r}, "
                f"not one of {sorted(_RESOURCE_TYPES)} (ResourceV1.type)"
            )
    meta = program.get("meta", {})
    if not isinstance(meta, dict):
        raise ValueError("program.meta must be an object (dict[str, Any])")


def _coerce_resource_int(name: str, value: object) -> int:
    """QREF's `_Value` is `int | float | str`; this package's counts are ints.

    Accepts a JSON number that round-trips exactly to an int (so `5` and
    `5.0` both work, since a JSON encoder may emit either for a Python int),
    and refuses anything else with the actual offending value in the message.
    """
    if isinstance(value, bool):
        raise TypeError(f"resource {name!r} must be a number, got a bool ({value!r})")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    raise TypeError(f"resource {name!r} must be a whole number, got {value!r}")


def export_logical_cost_to_qref(logical: LogicalCost) -> dict:
    """A `LogicalCost` as a QREF v1 document.

    Every field round-trips through `import_logical_cost_from_qref`: the
    four counts as `resources`, the label as `program.meta["label"]`.
    """
    resources = [
        {
            "name": _LOGICAL_QUBITS,
            "type": _RESOURCE_KINDS[_LOGICAL_QUBITS],
            "value": logical.logical_qubits,
        },
        {
            "name": _TOFFOLI_COUNT,
            "type": _RESOURCE_KINDS[_TOFFOLI_COUNT],
            "value": logical.toffoli_count,
        },
        {"name": _T_COUNT, "type": _RESOURCE_KINDS[_T_COUNT], "value": logical.t_count},
        {
            "name": _NON_CLIFFORD_DEPTH,
            "type": _RESOURCE_KINDS[_NON_CLIFFORD_DEPTH],
            "value": logical.non_clifford_depth,
        },
    ]
    document = {
        "version": QREF_SCHEMA_VERSION,
        "program": {
            "name": _ROUTINE_NAME,
            "resources": resources,
            "meta": {"label": logical.label},
        },
    }
    validate_qref_document(document)  # a bug here should fail loudly, not ship a bad document
    return document


def export_estimate_to_qref(estimate: PhysicalEstimate) -> dict:
    """`estimate.logical` as QREF resources, plus the physical costing in
    `program.meta` under `leona_`-prefixed keys — see the module docstring
    for why this is meta and not a QREF resource."""
    document = export_logical_cost_to_qref(estimate.logical)
    document["program"]["meta"].update(
        {
            "leona_assumption_set": estimate.assumption_set,
            "leona_total_physical_qubits": estimate.total_physical_qubits,
            "leona_runtime_seconds": estimate.runtime_seconds,
            "leona_code_distance": estimate.distance.code_distance,
        }
    )
    validate_qref_document(document)
    return document


def import_logical_cost_from_qref(document: dict) -> LogicalCost:
    """A `LogicalCost` from a QREF v1 document.

    Reads `program.resources` by name using **this module's own convention**
    (`logical_qubits`, `toffoli_count`, `t_count`, `non_clifford_depth`), not
    a name QREF itself mandates — a document from another tool will only
    import cleanly if it happens to use, or was produced under, this same
    convention. `logical_qubits` is required (a workload needs at least one
    qubit, and `LogicalCost` refuses a document that lacks it); the other
    three default to 0 when the resource is absent, matching
    `LogicalCost`'s own defaults for "not stated".
    """
    validate_qref_document(document)
    resources = {entry["name"]: entry for entry in document["program"]["resources"]}

    if _LOGICAL_QUBITS not in resources:
        raise ValueError(
            f"the QREF document has no {_LOGICAL_QUBITS!r} resource; "
            "import_logical_cost_from_qref needs at least a qubit count"
        )

    def read(name: str) -> int:
        if name not in resources:
            return 0
        return _coerce_resource_int(name, resources[name].get("value"))

    meta = document["program"].get("meta", {})
    label = meta.get("label", "")
    if not isinstance(label, str):
        raise TypeError(f"program.meta['label'] must be a string, got {type(label).__name__}")

    return LogicalCost(
        logical_qubits=read(_LOGICAL_QUBITS),
        toffoli_count=read(_TOFFOLI_COUNT),
        t_count=read(_T_COUNT),
        non_clifford_depth=read(_NON_CLIFFORD_DEPTH),
        label=label,
    )


__all__ = [
    "QREF_PACKAGE_VERSION_CHECKED_AGAINST",
    "QREF_SCHEMA_VERSION",
    "export_estimate_to_qref",
    "export_logical_cost_to_qref",
    "import_logical_cost_from_qref",
    "validate_qref_document",
]
