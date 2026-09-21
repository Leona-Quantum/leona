"""Tests for the constant-source registry.

`test_every_assumption_set_field_is_classified` is the load-bearing one for
"a constant has neither a source nor an explicit no-source marker": it fails
the moment a new `AssumptionSet` field is added without being sorted into
either the constant list or the bookkeeping list, which is exactly the gap
`rotation_t_coefficient` sat in until this module existed (see
`docs/estimation/assumption-sets.md`).

`test_atlas_paper_register_cross_check` is the other load-bearing one: it
reads the real `apps/web/lib/repository/paper-register.ts` from this test
(not from the package, which stays dependency-free) and checks
`ATLAS_PAPER_IDS` against it directly, rather than trusting a comment that
says someone grepped it once.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from majorana_estimation import COMPOSED_TRAPPED_ION, GIDNEY_2025, AssumptionSet
from majorana_estimation.provenance import (
    ASSUMPTION_SET_CONSTANT_FIELDS,
    ATLAS_PAPER_IDS,
    MODULE_LEVEL_CONSTANT_SOURCES,
    ConstantSource,
    SourceKind,
    _BOOKKEEPING_FIELDS,
    all_builtin_sources,
    sources_for,
)

BUILTIN_SETS = (GIDNEY_2025, COMPOSED_TRAPPED_ION)


# --- ConstantSource itself ---------------------------------------------------


def test_a_constant_source_needs_a_nonempty_reference():
    with pytest.raises(ValueError, match="no reference text"):
        ConstantSource(field="x.y", kind=SourceKind.CITED, reference="")
    with pytest.raises(ValueError, match="no reference text"):
        ConstantSource(field="x.y", kind=SourceKind.CITED, reference="   ")


def test_a_constant_source_needs_a_field_name():
    with pytest.raises(ValueError, match="must name a field"):
        ConstantSource(
            field="", kind=SourceKind.NO_SOURCE_RECORDED, reference="no source states it"
        )


def test_an_atlas_claim_must_be_a_confirmed_id():
    """Refuses at construction, so inventing a cross-link is caught immediately
    rather than surfacing later as a broken link on the public page."""
    with pytest.raises(ValueError, match="not in the confirmed set"):
        ConstantSource(
            field="x.y", kind=SourceKind.ATLAS_PAPER_REGISTER, reference="arxiv:9999.99999"
        )


# --- the completeness guard: no AssumptionSet field escapes classification --


def test_every_assumption_set_field_is_classified_as_constant_or_bookkeeping():
    all_fields = {f.name for f in dataclasses.fields(AssumptionSet)}
    classified = set(ASSUMPTION_SET_CONSTANT_FIELDS) | _BOOKKEEPING_FIELDS
    missing = all_fields - classified
    assert not missing, (
        f"AssumptionSet field(s) {missing} are neither a tracked constant nor "
        "declared bookkeeping — classify them in provenance.py"
    )
    # And nothing is double-counted as both a constant and bookkeeping.
    assert set(ASSUMPTION_SET_CONSTANT_FIELDS).isdisjoint(_BOOKKEEPING_FIELDS)


def test_sources_for_returns_exactly_one_entry_per_constant_field():
    for assumptions in BUILTIN_SETS:
        sources = sources_for(assumptions)
        assert [s.field.split(".", 1)[1] for s in sources] == list(ASSUMPTION_SET_CONSTANT_FIELDS)


# --- neither built-in set has anything genuinely unsourced ------------------


def test_neither_builtin_set_has_a_no_source_recorded_constant():
    """`docs/estimation/assumption-sets.md` records that v2 removed every
    working allowance from both sets; this is that claim, checked."""
    for assumptions in BUILTIN_SETS:
        assert assumptions.working_allowances == ()
        kinds = {s.kind for s in sources_for(assumptions)}
        assert SourceKind.NO_SOURCE_RECORDED not in kinds, (
            f"{assumptions.identity} has an unsourced constant, but its own "
            "working_allowances is empty — the two disagree"
        )


@pytest.mark.parametrize(
    ("field", "expected_kind", "expected_id_fragment"),
    [
        ("threshold", SourceKind.ATLAS_PAPER_REGISTER, "1808.06709"),
        ("logical_error_prefactor", SourceKind.ATLAS_PAPER_REGISTER, "1808.06709"),
        ("routing_factor", SourceKind.ATLAS_PAPER_REGISTER, "1808.02892"),
        ("rotation_t_coefficient", SourceKind.ATLAS_PAPER_REGISTER, "1403.2975"),
        ("physical_error_rate", SourceKind.CITED, "2505.15917"),
        ("cycle_time_s", SourceKind.CITED, "2505.15917"),
        ("t_per_toffoli", SourceKind.CITED, "2505.15917"),
    ],
)
def test_gidney_2025_field_sources(field, expected_kind, expected_id_fragment):
    sources = {s.field.split(".", 1)[1]: s for s in sources_for(GIDNEY_2025)}
    source = sources[field]
    assert source.kind is expected_kind
    assert expected_id_fragment in source.reference


@pytest.mark.parametrize(
    ("field", "expected_kind"),
    [
        ("routing_factor", SourceKind.ATLAS_PAPER_REGISTER),
        ("rotation_t_coefficient", SourceKind.ATLAS_PAPER_REGISTER),
        (
            "physical_error_rate",
            SourceKind.CITED,
        ),  # Webber, arXiv:2108.12371 -- not in the register
        (
            "factory_footprint_logical",
            SourceKind.CITED,
        ),  # Litinski, Quantum 3, 205 -- no arXiv id given
        ("factory_cycles_per_state", SourceKind.CITED),
    ],
)
def test_composed_trapped_ion_field_sources(field, expected_kind):
    sources = {s.field.split(".", 1)[1]: s for s in sources_for(COMPOSED_TRAPPED_ION)}
    assert sources[field].kind is expected_kind


# --- the two non-AssumptionSet constants -------------------------------------


def test_module_level_constants_are_recorded_as_no_source():
    assert len(MODULE_LEVEL_CONSTANT_SOURCES) == 2
    for source in MODULE_LEVEL_CONSTANT_SOURCES:
        assert source.kind is SourceKind.NO_SOURCE_RECORDED
        assert source.field.startswith("estimate.")


def test_all_builtin_sources_covers_both_sets_and_the_module_level_constants():
    combined = all_builtin_sources(BUILTIN_SETS)
    expected_len = len(MODULE_LEVEL_CONSTANT_SOURCES) + len(ASSUMPTION_SET_CONSTANT_FIELDS) * 2
    assert len(combined) == expected_len
    for source in combined:
        assert source.reference.strip()  # ConstantSource already enforces this; belt and braces


# --- cross-checked against the real Atlas paper register ---------------------


def _find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pnpm-workspace.yaml").exists():
            return candidate
    raise RuntimeError(
        "could not locate the monorepo root (no pnpm-workspace.yaml found above "
        f"{current}) -- this cross-check needs the full checkout, not a package-only install"
    )


def test_atlas_paper_register_cross_check():
    register_path = _find_repo_root() / "apps/web/lib/repository/paper-register.ts"
    text = register_path.read_text(encoding="utf-8")

    # TS object-literal syntax: an unquoted key (`id:`), not JSON's `"id":`.
    for atlas_id in ATLAS_PAPER_IDS:
        needle = f'id: "{atlas_id}"'
        assert needle in text, (
            f"{atlas_id} is claimed present in ATLAS_PAPER_IDS but {needle!r} was not "
            f"found in {register_path} -- re-check and update provenance.py"
        )

    # The four papers this package cites that are documented as NOT in the
    # register (docs/estimation/assumption-sets.md) must not have quietly
    # gained an entry that would make our CITED classification stale.
    for not_registered in ("2505.15917", "2011.04149", "2108.12371"):
        needle = f'id: "arxiv:{not_registered}"'
        assert needle not in text, (
            f"arxiv:{not_registered} now has an Atlas paper-register entry -- "
            "update ATLAS_PAPER_IDS and docs/estimation/assumption-sets.md, this "
            "constant can now cross-link"
        )
