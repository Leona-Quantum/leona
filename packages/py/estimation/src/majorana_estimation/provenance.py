"""Where every constant this package uses comes from, checked structurally.

`AssumptionSet` already has a disclosure mechanism — `working_allowances` for
a value no source states, `value_provenance` for a value attributed to
somewhere other than `source_citation` — and `docs/estimation/assumption-sets.md`
is the audit trail behind it. What was missing until 2026-09-21 is a check that
a *new* field cannot silently skip that disclosure: `rotation_t_coefficient`
had a real, correct citation (Ross and Selinger, arXiv:1403.2975) sitting in a
docstring the whole time, and nothing forced it into `value_provenance` where
`citation` — the string the public estimate panel renders — could actually
show it to a reader. `sources_for` and the completeness check in
`test_provenance.py` exist so that gap cannot recur unnoticed.

**Three kinds of constant, never four.** Physics honesty runs in both
directions: a constant must not be *understated* as unsourced when it has a
real citation, and must not be *oversold* as belonging to the Atlas corpus's
own paper register when it does not (yet) have an entry there.

- `ATLAS_PAPER_REGISTER` — the paper also has an entry in the Atlas corpus's
  paper register (`apps/web/lib/repository/paper-register.ts`), so the
  constant is tied to the same paper record the catalogue cites. No page
  renders this as a link yet: the estimate panel prints the citation as text.
- `CITED` — a real, checked citation (an arXiv id, DOI, or paper + section
  quoted in `assumptions.py` or `docs/estimation/assumption-sets.md`) for a
  paper that is not (yet) in that register. Still a source; just not (yet) a
  registered one.
- `NO_SOURCE_RECORDED` — nothing states this. Reserved for values that are
  not physics claims at all: an engineering safety margin, a policy default.
  A `working_allowances` entry on an `AssumptionSet` renders exactly this
  claim on the public page ("It does not state the value(s) …"), so it is
  treated as this kind too.

Two of the seven papers this estimator cites are not (yet) in the Atlas paper
register — Webber et al. (arXiv:2108.12371) and Litinski's *Magic state
distillation: not as costly as you think* (Quantum 3, 205, no arXiv id given
anywhere in this package). Gidney 2025 (arXiv:2505.15917) and Babbush et al.
(arXiv:2011.04149) joined the register on 2026-09-22, when the Atlas workflow
planner began citing both (PR 974), so the `gidney-2025` constants they source
now classify as Atlas-registered. That is a corpus fact, not something this module invents — see
`docs/estimation/assumption-sets.md`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .assumptions import AssumptionSet
from .estimate import MAX_CODE_DISTANCE


class SourceKind(str, Enum):
    ATLAS_PAPER_REGISTER = "atlas_paper_register"
    CITED = "cited"
    NO_SOURCE_RECORDED = "no_source_recorded"


ATLAS_PAPER_IDS = frozenset(
    {
        "arxiv:1808.06709",  # Fowler & Gidney, Low overhead quantum computation using lattice surgery
        "arxiv:1808.02892",  # Litinski, A Game of Surface Codes
        "arxiv:1403.2975",  # Ross & Selinger, Optimal ancilla-free Clifford+T approximation of z-rotations
        "arxiv:2505.15917",  # Gidney 2025, How to factor 2048 bit RSA integers with less than a million noisy qubits
        "arxiv:2011.04149",  # Babbush et al., Focus beyond quadratic speedups for error-corrected quantum advantage
    }
)
"""Confirmed present in `apps/web/lib/repository/paper-register.ts` (grepped
directly, session recorded in `docs/estimation/assumption-sets.md`).

Not derived from that file at import time: this package imports nothing
outside the standard library (`pyproject.toml`), and reading a sibling
package's source at runtime would be a second, quieter way for that rule to
erode. `test_atlas_paper_register_cross_check` in the test suite re-reads the
real file and is where this set is actually re-verified, not trusted forever
from one session's grep.
"""


@dataclass(frozen=True)
class ConstantSource:
    """One constant's source, as shown to a reader.

    `field` is `"<assumption_set_name>.<field>"` for an `AssumptionSet`
    constant, or a module-qualified name (`"estimate.MAX_CODE_DISTANCE"`) for
    one that is not.
    """

    field: str
    kind: SourceKind
    reference: str
    """What a reader is told: an Atlas id, a citation, or the no-source
    sentence. Never empty — see `__post_init__`."""

    def __post_init__(self) -> None:
        if not self.field:
            raise ValueError("a ConstantSource must name a field")
        if not self.reference.strip():
            raise ValueError(
                f"{self.field} has no reference text: a source with nothing to show is not a source"
            )
        if self.kind is SourceKind.ATLAS_PAPER_REGISTER and self.reference not in ATLAS_PAPER_IDS:
            raise ValueError(
                f"{self.field} claims Atlas paper-register id {self.reference!r}, which is "
                "not in the confirmed set (ATLAS_PAPER_IDS) — add it there only after "
                "checking apps/web/lib/repository/paper-register.ts directly"
            )


# Every AssumptionSet field that states a physical or algorithmic number.
# Everything else on the dataclass is bookkeeping: identity (name, version),
# the citation machinery itself (source_citation, working_allowances,
# value_provenance), and rotation_synthesis_epsilon, which is per-estimate by
# design (see AssumptionSet.identity) and None on every built-in set.
ASSUMPTION_SET_CONSTANT_FIELDS: tuple[str, ...] = (
    "physical_error_rate",
    "threshold",
    "logical_error_prefactor",
    "routing_factor",
    "factory_footprint_logical",
    "physical_qubits_per_patch",
    "cycle_time_s",
    "reaction_time_s",
    "factory_cycles_per_state",
    "t_per_toffoli",
    "rotation_t_coefficient",
)

_BOOKKEEPING_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "version",
        "source_citation",
        "working_allowances",
        "value_provenance",
        "rotation_synthesis_epsilon",
    }
)


def _cited_source(qualified_field: str, reference: str) -> ConstantSource:
    """A field attributed to `reference` (either `source_citation` text or a
    `value_provenance` note), classified by whether that text names an
    Atlas-registered arXiv id.

    Substring matching on the id string itself, not on prose, because arXiv
    ids are precise and every citation in this package that names one spells
    it out in full (`arXiv:1808.06709`, not "Fowler and Gidney's paper").

    **When a note names more than one registered paper, the earliest wins.**
    Notes lead with their source and name other papers after it, often to
    disown them: `rotation_t_coefficient`'s note cites Ross and Selinger and
    then says "Not from arXiv:2505.15917". Returning the first id found while
    iterating `ATLAS_PAPER_IDS` instead made the answer depend on a frozenset's
    iteration order, which Python randomises per process through string
    hashing: once Gidney 2025 joined the register, that constant was
    attributed to the paper its own note rules out in 7 of 16 hash seeds.
    """
    positions = [
        (reference.find(atlas_id.removeprefix("arxiv:")), atlas_id)
        for atlas_id in ATLAS_PAPER_IDS
        if atlas_id.removeprefix("arxiv:") in reference
    ]
    if positions:
        _, atlas_id = min(positions)
        return ConstantSource(
            field=qualified_field, kind=SourceKind.ATLAS_PAPER_REGISTER, reference=atlas_id
        )
    return ConstantSource(field=qualified_field, kind=SourceKind.CITED, reference=reference)


def sources_for(assumptions: AssumptionSet) -> tuple[ConstantSource, ...]:
    """Where every constant field of one `AssumptionSet` comes from.

    Reuses the set's own disclosure fields rather than a second, parallel
    list that could drift from them: a field named in `working_allowances` is
    exactly what "no source recorded" means for a physical constant; a field
    named in `value_provenance` is attributed to whatever that entry's note
    says; a field named in neither is claimed by `source_citation` itself —
    which is the literal contract `AssumptionSet.citation` renders (the
    source, plus every named exception to it).
    """
    provenance_by_field: dict[str, str] = {}
    for entry in assumptions.value_provenance:
        for name in entry.fields:
            provenance_by_field[name] = entry.note

    sources = []
    for name in ASSUMPTION_SET_CONSTANT_FIELDS:
        qualified = f"{assumptions.name}.{name}"
        if name in assumptions.working_allowances:
            sources.append(
                ConstantSource(
                    field=qualified,
                    kind=SourceKind.NO_SOURCE_RECORDED,
                    reference=(
                        f"{assumptions.source_citation!r} does not state {name}; no source "
                        "recorded, it is used here as a working allowance"
                    ),
                )
            )
        elif name in provenance_by_field:
            sources.append(_cited_source(qualified, provenance_by_field[name]))
        else:
            sources.append(_cited_source(qualified, assumptions.source_citation))
    return tuple(sources)


MODULE_LEVEL_CONSTANT_SOURCES: tuple[ConstantSource, ...] = (
    ConstantSource(
        field="estimate.MAX_CODE_DISTANCE",
        kind=SourceKind.NO_SOURCE_RECORDED,
        reference=(
            f"no source states {MAX_CODE_DISTANCE}; it is an engineering ceiling chosen to "
            "be well past any published surface-code design, so `choose_code_distance` "
            "refuses rather than returns an absurd distance. Not a physical constant."
        ),
    ),
    ConstantSource(
        field="estimate.estimate.target_failure_probability(default)",
        kind=SourceKind.NO_SOURCE_RECORDED,
        reference=(
            "no source states 0.01 as a total logical failure budget; it is a policy "
            "default an estimate can override, not a hardware or algorithmic constant"
        ),
    ),
)
"""Constants outside `AssumptionSet` that flow into a returned estimate.

Not derived automatically the way `sources_for` is, because these are two
specific module-level values rather than a dataclass whose fields can be
enumerated — `test_provenance.py` pins their names against the real symbols
in `estimate.py` so a rename here is caught rather than silently stale.
"""


def all_builtin_sources(assumption_sets: tuple[AssumptionSet, ...]) -> tuple[ConstantSource, ...]:
    """Every constant source across the given sets, plus the module-level ones."""
    sources: list[ConstantSource] = list(MODULE_LEVEL_CONSTANT_SOURCES)
    for assumptions in assumption_sets:
        sources.extend(sources_for(assumptions))
    return tuple(sources)


__all__ = [
    "ASSUMPTION_SET_CONSTANT_FIELDS",
    "ATLAS_PAPER_IDS",
    "MODULE_LEVEL_CONSTANT_SOURCES",
    "ConstantSource",
    "SourceKind",
    "all_builtin_sources",
    "sources_for",
]
