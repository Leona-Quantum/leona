"""`leona_notebooks.dependencies`: the per-cell graph dependency-graph replay runs on
(DESIGN §3) — binding forms, the mutation rule, barriers, cache keys, and `plan_run`.
"""

from __future__ import annotations

from leona_notebooks.dependencies import (
    CHECK_ROLE,
    RunPlan,
    analyze_cell_source,
    build_dependency_graph,
    cache_keys,
    cell_cache_payload,
    check_property_payload,
    plan_run,
)
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.source import parse_source
from leona_notebooks.spec import Cell, NotebookSpec


def _spec(source: str) -> NotebookSpec:
    return parse_source(source)


def _check_cell(cell_id: str, *, property: object = None) -> Cell:
    """A `role="check"` cell built with `model_construct` — `CellRole` has no
    `"check"` member on this branch (the checks lane's own contracts land on a
    sibling branch), so the normal `Cell(...)` constructor would refuse the
    string. `property` mirrors that lane's future `CheckProperty` field, which
    does not exist on `Cell` here either — see `check_property_payload`."""
    cell = Cell.model_construct(
        id=cell_id,
        kind="code",
        role=CHECK_ROLE,
        source=f"# check: {cell_id}",
        tags=[],
        execute=True,
        stub=None,
        check=None,
        answer=None,
        answer_prompt=None,
        timeout_s=None,
    )
    if property is not None:
        object.__setattr__(cell, "property", property)
    return cell


def _spec_with_cells(cells: list[Cell], *, slug: str = "s") -> NotebookSpec:
    return NotebookSpec(schema_version=1, slug=slug, title="T", cells=cells)


# --------------------------------------------------------------------------- binding forms


def test_plain_assignment_defines_and_a_later_read_depends_on_it() -> None:
    defined, read, barriers = analyze_cell_source("x = 1\n")
    assert defined == {"x"}
    assert read == set()
    assert barriers == ()


def test_tuple_assignment_defines_every_target() -> None:
    defined, _read, _b = analyze_cell_source("a, (b, c) = 1, (2, 3)\n")
    assert defined == {"a", "b", "c"}


def test_augmented_assignment_both_defines_and_reads_the_same_name() -> None:
    defined, read, _b = analyze_cell_source("counter += 1\n")
    assert defined == {"counter"}
    assert "counter" in read  # the mutation rule needs this: see the module docstring


def test_annotated_assignment_defines_the_target() -> None:
    defined, _read, _b = analyze_cell_source("n: int = 3\n")
    assert defined == {"n"}


def test_walrus_at_top_level_defines_the_target() -> None:
    defined, read, _b = analyze_cell_source("print(total := compute())\n")
    assert defined == {"total"}
    assert "compute" in read


def test_for_target_defines_at_notebook_level() -> None:
    defined, read, _b = analyze_cell_source("for i, j in pairs:\n    pass\n")
    assert defined == {"i", "j"}
    assert "pairs" in read


def test_with_as_defines_the_bound_name() -> None:
    defined, read, _b = analyze_cell_source("with opened() as handle:\n    pass\n")
    assert defined == {"handle"}
    assert "opened" in read


def test_plain_import_binds_the_module_name() -> None:
    defined, _read, _b = analyze_cell_source("import numpy\n")
    assert defined == {"numpy"}


def test_dotted_import_binds_only_the_top_package() -> None:
    defined, _read, _b = analyze_cell_source("import qiskit.quantum_info\n")
    assert defined == {"qiskit"}


def test_import_as_binds_the_alias() -> None:
    defined, _read, _b = analyze_cell_source("import numpy as np\n")
    assert defined == {"np"}


def test_from_import_binds_each_name_or_its_alias() -> None:
    defined, _read, _b = analyze_cell_source("from qiskit import QuantumCircuit as QC, transpile\n")
    assert defined == {"QC", "transpile"}


def test_function_def_binds_its_own_name_but_not_its_body_locals() -> None:
    defined, read, _b = analyze_cell_source("def f(x):\n    y = x + 1\n    return y\n")
    assert defined == {"f"}
    assert "y" not in defined
    # `x` is f's own parameter: referencing it inside f is not a read of anything else.
    assert "x" not in read


def test_function_body_free_variable_bubbles_up_as_a_read() -> None:
    # Conservative on purpose (module docstring): `f` is only DEFINED here, never
    # called, and still counts as reading `n` — an extra edge is safe, a missing one
    # is not.
    defined, read, _b = analyze_cell_source("def f():\n    return n\n")
    assert defined == {"f"}
    assert "n" in read


def test_class_def_binds_its_own_name_but_not_its_body_locals() -> None:
    defined, read, _b = analyze_cell_source(
        "class Foo:\n    value = 1\n    def method(self):\n        return self.value\n"
    )
    assert defined == {"Foo"}
    assert "value" not in defined
    assert "method" not in read  # method is Foo's own local, not a free read


def test_except_as_binds_the_handler_name() -> None:
    defined, _read, _b = analyze_cell_source(
        "try:\n    risky()\nexcept ValueError as exc:\n    print(exc)\n"
    )
    assert defined == {"exc"}


# --------------------------------------------------------------------------- comprehension scoping


def test_comprehension_loop_variable_is_not_a_notebook_level_definition() -> None:
    defined, read, _b = analyze_cell_source("xs = [i for i in range(3)]\n")
    assert defined == {"xs"}
    assert "i" not in defined
    assert "i" not in read  # `i` resolves within the comprehension's own scope
    assert "range" in read


def test_comprehension_outer_iterable_is_read_in_the_enclosing_scope() -> None:
    defined, read, _b = analyze_cell_source("ys = [i * 2 for i in source]\n")
    assert defined == {"ys"}
    assert "source" in read
    assert "i" not in read


def test_walrus_inside_a_comprehension_escapes_to_the_enclosing_scope() -> None:
    # PEP 572: unlike the comprehension's own `for` target, a walrus written inside
    # one binds the nearest enclosing function/module scope — here, the cell itself.
    defined, _read, _b = analyze_cell_source("total = sum(y := v for v in values)\n")
    assert "y" in defined
    assert "v" not in defined


def test_dict_comprehension_keeps_its_own_key_and_value_scoped() -> None:
    defined, read, _b = analyze_cell_source("d = {k: k * 2 for k in keys}\n")
    assert defined == {"d"}
    assert "k" not in read
    assert "keys" in read


# --------------------------------------------------------------------------- barriers


def test_import_star_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("from qiskit import *\n")
    assert barriers == ("import *",)


def test_exec_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("exec('x = 1')\n")
    assert barriers == ("exec",)


def test_eval_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("eval('1 + 1')\n")
    assert barriers == ("eval",)


def test_globals_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("globals()['x'] = 1\n")
    assert barriers == ("globals",)


def test_locals_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("print(locals())\n")
    assert barriers == ("locals",)


def test_vars_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("print(vars())\n")
    assert barriers == ("vars",)


def test_global_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("def f():\n    global x\n    x = 1\n")
    assert barriers == ("global",)


def test_nonlocal_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source(
        "def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        x = 2\n    inner()\n"
    )
    assert barriers == ("nonlocal",)


def test_del_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("x = 1\ndel x\n")
    assert barriers == ("del",)


def test_a_cell_that_fails_to_parse_is_a_barrier() -> None:
    defined, read, barriers = analyze_cell_source("def broken(:\n")
    assert defined == set()
    assert read == set()
    assert barriers == ("could not be parsed",)


def test_a_barrier_depends_on_everything_before_it_and_everything_after_depends_on_it() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 1\n"
        "# %% id=c02\ny = 2\n"
        "# %% id=c03\nexec('z = 1')\n"
        "# %% id=c04\nw = 3\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c03"}  # c04 reads/defines nothing tied to c01/c02
    assert "c01" in graph.deps("c04")  # transitively, via the barrier
    assert "c02" in graph.deps("c04")


# --------------------------------------------------------------------------- the mutation rule


def test_mutation_rule_chains_every_intermediate_reader_not_just_the_definer() -> None:
    # Exactly the case the module docstring names: `qc.h(0)` / `qc.cx(0, 1)` each
    # READ `qc` without rebinding it, so a "depends on the last assignment" rule
    # alone would only catch c01 as c04's dependency — every intermediate READER
    # must show up too, because any of them could have mutated the object in place.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nqc = 1\n"  # a stand-in for QuantumCircuit(2)
        "# %% id=c02\nqc.h(0)\n"
        "# %% id=c03\nqc.cx(0, 1)\n"
        "# %% id=c04\nprint(qc)\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == {"c01"}
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c01", "c02", "c03"}


def test_mutation_rule_with_a_pure_in_place_call_not_a_rebind() -> None:
    # The case the module docstring names explicitly: `qc.h(0)` never rebinds `qc`,
    # so a "depends on the last ASSIGNMENT" rule alone would miss this edge.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nqc = 1\n"
        "# %% id=c02\nqc.h(0)\n"
        "# %% id=c03\nqc.cx(0, 1)\n"
        "# %% id=c04\nprint(qc)\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.analyses["c02"].defined == set()  # a method call defines nothing
    # `qc.h(0)` is also this cell's trailing expression, so `prepare_cell_source`
    # wraps it in `__leona_display__(...)` (Jupyter-style auto-display) — that name
    # is read too, harmlessly, since no cell ever defines it. This test is about
    # `qc`, not about that wrapper, so it checks membership rather than equality.
    assert "qc" in graph.analyses["c02"].read
    assert graph.direct["c02"] == {"c01"}
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c01", "c02", "c03"}


def test_a_shared_builtin_name_never_creates_a_spurious_edge() -> None:
    # Regression: `readers_since` must never be tracked for a name nobody defines —
    # two unrelated cells that both call `print` must not depend on each other.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nprint('a')\n"
        "# %% id=c02\nprint('b')\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == set()


def test_unrelated_cells_never_get_an_edge() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nqc = 1\n# %% id=c02\ny = 2\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == set()


# --------------------------------------------------------------------------- check cells


def test_check_cell_is_a_barrier_reader_that_defines_nothing() -> None:
    cells = [
        Cell(id="c01", kind="code", source="x = 1\n"),
        Cell(id="c02", kind="code", source="y = 2\n"),
        _check_cell("chk"),
        Cell(id="c03", kind="code", source="print('after')\n"),
    ]
    spec = _spec_with_cells(cells)
    graph = build_dependency_graph(spec)
    assert graph.analyses["chk"].is_check is True
    assert graph.analyses["chk"].defined == set()
    assert graph.direct["chk"] == {"c01", "c02"}  # reads everything before it
    # c03 doesn't read x/y and never references chk: nothing depends on chk for
    # having existed, since a check defines no notebook-level name.
    assert "chk" not in graph.direct["c03"]


def test_skip_cells_never_enter_the_graph() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01 execute=false\nimport os\n"
        "# %% id=c02\n%%time\nx = 1\n"
        "# %% id=c03\ny = 2\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.cell_ids == ("c03",)


# --------------------------------------------------------------------------- cache keys


def test_an_upstream_edit_changes_every_downstream_key_and_no_unrelated_key() -> None:
    before = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 1\n"
        "# %% id=c02\ny = x + 1\n"
        "# %% id=c03\nz = 99\n"  # unrelated to c01/c02
    )
    after = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 2\n"  # the only content edit
        "# %% id=c02\ny = x + 1\n"
        "# %% id=c03\nz = 99\n"
    )
    before_keys, after_keys = cache_keys(before), cache_keys(after)
    assert before_keys["c01"] != after_keys["c01"]
    assert before_keys["c02"] != after_keys["c02"]  # downstream of the edit
    assert before_keys["c03"] == after_keys["c03"]  # untouched, unrelated


def test_reordering_an_unrelated_cell_does_not_change_a_keys_deps_ordering() -> None:
    # "the sorted keys of direct deps": a cell's own key must not depend on the
    # ORDER its dependencies happen to be discovered in.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\na = 1\n"
        "# %% id=c02\nb = 2\n"
        "# %% id=c03\nboth = a + b\n"
    )
    keys = cache_keys(spec)
    assert len(keys) == 3
    assert len(set(keys.values())) == 3  # three distinct cells, three distinct keys


def test_check_property_payload_drops_author_and_accepted() -> None:
    class FakeProperty:
        def model_dump(self, mode="json"):
            return {"kind": "state", "tolerance": 1e-6, "author": "nala", "accepted": False}

    payload = check_property_payload(_check_cell("chk", property=FakeProperty()))
    assert payload == {"kind": "state", "tolerance": 1e-6}


def test_check_property_payload_is_none_when_the_field_does_not_exist_yet() -> None:
    # The real case on THIS branch today: `Cell` has no `property` field at all.
    assert check_property_payload(_check_cell("chk")) is None
    assert check_property_payload(Cell(id="c01", kind="code", source="x = 1\n")) is None


def test_a_changed_check_property_changes_the_cache_key_even_with_the_same_source() -> None:
    class FakeProperty:
        def __init__(self, tolerance: float) -> None:
            self._tolerance = tolerance

        def model_dump(self, mode="json"):
            return {
                "kind": "state",
                "tolerance": self._tolerance,
                "author": "user",
                "accepted": True,
            }

    loose = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(1e-3)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    tight = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(1e-9)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    assert loose != tight


def test_accepting_a_check_does_not_change_its_cache_key() -> None:
    class FakeProperty:
        def __init__(self, accepted: bool) -> None:
            self._accepted = accepted

        def model_dump(self, mode="json"):
            return {
                "kind": "state",
                "tolerance": 1e-6,
                "author": "nala",
                "accepted": self._accepted,
            }

    unaccepted = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(False)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    accepted = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(True)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    assert unaccepted == accepted


# --------------------------------------------------------------------------- plan_run


def _ten_cell_source() -> str:
    lines = ["# ---\n# title: T\n# kind: scratch\n# ---\n"]
    lines.append("# %% id=c01\nv01 = 1\n")
    for i in range(2, 11):
        lines.append(f"# %% id=c{i:02d}\nv{i:02d} = v{i - 1:02d} + 1\n")
    return "".join(lines)


def _two_chain_source(*, c03_rhs: str = "v02 + 1") -> str:
    """A 10-cell notebook of two INDEPENDENT 5-cell linear chains: c01..c05 build
    `v01..v05`, c06..c10 build `w06..w10`, and neither chain reads a name the other
    defines. `c03_rhs` is the one line varied by the "edit a middle cell" tests."""
    lines = ["# ---\n# title: T\n# kind: scratch\n# ---\n"]
    lines.append("# %% id=c01\nv01 = 1\n")
    lines.append("# %% id=c02\nv02 = v01 + 1\n")
    lines.append(f"# %% id=c03\nv03 = {c03_rhs}\n")
    lines.append("# %% id=c04\nv04 = v03 + 1\n")
    lines.append("# %% id=c05\nv05 = v04 + 1\n")
    lines.append("# %% id=c06\nw06 = 1\n")
    for i in range(7, 11):
        lines.append(f"# %% id=c{i:02d}\nw{i:02d} = w{i - 1:02d} + 1\n")
    return "".join(lines)


def _ok_report_from_keys(spec: NotebookSpec, keys: dict[str, str]) -> ExecutionReport:
    return ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[CellResult(id=cid, status="ok", cache_key=key) for cid, key in keys.items()],
    )


def test_everything_cached_gives_an_empty_execute_set() -> None:
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == frozenset()
    assert set(plan.reused) == set(keys)
    assert plan.not_run == ()


def test_editing_one_middle_cell_reruns_only_its_chain_not_the_unrelated_one() -> None:
    spec = _spec(_two_chain_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)

    edited = _spec(_two_chain_source(c03_rhs="v02 + 5"))  # only c03's own line changed

    plan = plan_run(edited, spec, report, None)
    # c03 is stale; c04/c05 are downstream of it; c01/c02 are ITS deps, pulled back in
    # by the closure step because a fresh sandbox has no memory of the PRIOR run — c04
    # cannot compute `v03 + 1` correctly unless c01..c03 actually execute again in the
    # SAME dispatch to rebuild `v01`..`v03` as real objects, not just replay a report.
    # So editing anywhere in a straight chain reruns the WHOLE chain — the saving is
    # that the UNRELATED chain (c06..c10), which reads none of it, needs none of that.
    assert plan.execute == {"c01", "c02", "c03", "c04", "c05"}
    assert set(plan.reused) == {f"c{i:02d}" for i in range(6, 11)}
    assert plan.not_run == ()


def test_run_cell_target_is_the_same_cut_run_until_uses() -> None:
    spec = _spec(_two_chain_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    edited = _spec(_two_chain_source(c03_rhs="v02 + 5"))

    # "Run cell c03": the cut excludes everything after c03 (c04, c05, and the whole
    # second chain) from consideration entirely — this is DESIGN §3's own
    # "Run cell X = X ∪ deps(X)", X = c03, deps(X) = {c01, c02}.
    plan = plan_run(edited, spec, report, "c03")
    assert plan.execute == {"c01", "c02", "c03"}
    assert plan.reused == {}
    assert plan.not_run == ("c04", "c05", "c06", "c07", "c08", "c09", "c10")


def test_a_parent_error_is_never_reused_even_with_a_matching_key() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nraise ValueError('boom')\n"
    )
    keys = cache_keys(spec)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=False,
        runner="sandbox",
        cells=[CellResult(id="c01", status="error", cache_key=keys["c01"])],
    )
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == {"c01"}
    assert plan.reused == {}


def test_a_parent_result_with_no_cache_key_is_always_stale() -> None:
    spec = _spec("# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nx = 1\n")
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[CellResult(id="c01", status="ok")],  # no cache_key: a pre-feature report
    )
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == {"c01"}


def test_no_parent_report_makes_everything_stale() -> None:
    spec = _spec(_ten_cell_source())
    plan = plan_run(spec, None, None, None)
    assert plan.execute == set(cache_keys(spec))
    assert plan.reused == {}


def test_run_plan_partitions_every_code_cell_exactly_once() -> None:
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    edited = _spec(_ten_cell_source().replace("v03 = v02 + 1\n", "v03 = v02 + 5\n"))
    plan = plan_run(edited, spec, report, "c07")
    all_ids = {cell.id for cell in edited.code_cells()}
    assert plan.execute | set(plan.reused) | set(plan.not_run) == all_ids
    assert not (plan.execute & set(plan.reused))
    assert not (plan.execute & set(plan.not_run))
    assert not (set(plan.reused) & set(plan.not_run))


def test_run_plan_is_a_dataclass_with_the_documented_fields() -> None:
    # A cheap contract test: a caller (`_handle_author`) reads these by name.
    assert set(RunPlan.__dataclass_fields__) == {"execute", "reused", "not_run", "cache_keys"}
