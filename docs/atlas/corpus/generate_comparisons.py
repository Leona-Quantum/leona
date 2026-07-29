"""Generates the 3 MVP comparison reports (docs/atlas/corpus/comparisons/)
from the existing paper records. Machine-generated, not curated gold --
every dimension not directly backed by a corpus record's own recorded
evidence is left `unknown`, per ADR-0027 and ANNOTATION_GUIDELINE.md §8.

At this corpus depth (literature-review-level annotation, no executed
ScientificExperimentSpec yet -- that is Phase 3/5), most dimensions are
honestly `unknown`: things like PROBLEM_DIGEST, SEED, or MAPPING require an
actual computed digest or executed spec this corpus does not have. This
script does not force a stronger classification than the evidence supports.

Usage: python3 generate_comparisons.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "packages" / "py" / "vqe" / "src"))

from majorana_vqe import VQE_SCHEMA_VERSION  # noqa: E402
from majorana_vqe.comparison import (  # noqa: E402
    ComparisonDimension,
    ComparisonDimensionName,
    ComparisonDimensionStatus,
    ComparisonResult,
    classify_comparison,
)

HERE = Path(__file__).resolve().parent
PAPERS_DIR = HERE / "papers"
COMPARISONS_DIR = HERE / "comparisons"

GENERATOR_METHOD = "majorana_vqe.comparison.classify_comparison (literature-level, pre-execution)"
GENERATOR_VERSION = VQE_SCHEMA_VERSION


def load_paper(paper_id: str) -> dict:
    return json.loads((PAPERS_DIR / f"{paper_id}.json").read_text())


def unknown(name: ComparisonDimensionName) -> ComparisonDimension:
    return ComparisonDimension(name=name, status=ComparisonDimensionStatus.UNKNOWN, detail=None)


def build_comparison(
    comparison_id: str,
    paper_a_id: str,
    paper_b_id: str,
    known_dimensions: dict[ComparisonDimensionName, tuple[ComparisonDimension, str]],
    unresolved_conflicts: list[str],
) -> dict:
    """`known_dimensions` maps each known dimension to (ComparisonDimension,
    evidence_locator) -- a fixed/changed status is never recorded without a
    citation to where in the corpus it comes from (validator-enforced)."""
    all_names = set(ComparisonDimensionName)
    evidence_by_name: dict[ComparisonDimensionName, str | None] = {
        name: locator for name, (_dim, locator) in known_dimensions.items()
    }
    dims = [dim for dim, _locator in known_dimensions.values()]
    for name in all_names - set(known_dimensions.keys()):
        dims.append(unknown(name))
        evidence_by_name[name] = None
    dims.sort(key=lambda d: d.name.value)

    result = ComparisonResult(
        dimensions=dims,
        classification=classify_comparison(dims),
    )

    return {
        "comparison_id": comparison_id,
        "annotation_schema_version": "0.2.0",
        "generation_method": GENERATOR_METHOD,
        "generator_version": GENERATOR_VERSION,
        "source_record_ids": [paper_a_id, paper_b_id],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dimensions": [
            {
                "name": d.name.value,
                "status": d.status.value,
                "detail": d.detail,
                "evidence_locator": evidence_by_name[d.name],
            }
            for d in result.dimensions
        ],
        "classification": result.classification.value,
        "unresolved_conflicts": unresolved_conflicts,
        "validation_warnings": [],
        "is_manual_gold": False,
        "human_validated": False,
    }


def main() -> int:
    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)

    # Confirm the six source papers this script cites actually exist and are
    # valid corpus records before generating anything that references them.
    for paper_id in (
        "peruzzo2014",
        "shen2017",
        "grimsley2019",
        "tang2021",
        "omalley2016",
        "kandala2017",
    ):
        load_paper(paper_id)

    comparisons = []

    # 1. peruzzo2014 vs shen2017: same molecule (HeH+), different hardware
    # (photonic vs. trapped-ion). Both use a UCC-family ansatz. Neither
    # record has a computed Hamiltonian/problem digest at this corpus depth,
    # so PROBLEM_DIGEST/HAMILTONIAN_DIGEST_OR_EQUIVALENCE stay unknown rather
    # than being assumed equal just because the molecule name matches.
    comparisons.append(
        build_comparison(
            "peruzzo2014_vs_shen2017",
            "peruzzo2014",
            "shen2017",
            {
                ComparisonDimensionName.ANSATZ_SEMANTIC_DEFINITION: (
                    ComparisonDimension(
                        name=ComparisonDimensionName.ANSATZ_SEMANTIC_DEFINITION,
                        status=ComparisonDimensionStatus.FIXED,
                        detail="Both records describe a unitary-coupled-cluster-family variational ansatz for the same HeH+ system (peruzzo2014: 'small parameterized variational ansatz, original VQE proposal'; shen2017: explicit UCC).",
                    ),
                    "docs/atlas/corpus/papers/peruzzo2014.json#components[1], docs/atlas/corpus/papers/shen2017.json#components[1]",
                ),
            },
            unresolved_conflicts=[
                "Both papers study HeH+, but no computed problem/Hamiltonian digest exists in this corpus to confirm identical geometry/basis -- PROBLEM_DIGEST and HAMILTONIAN_DIGEST_OR_EQUIVALENCE are left unknown rather than assumed from the shared molecule name alone.",
            ],
        )
    )

    # 2. grimsley2019 vs tang2021: both ADAPT-style, but fermionic operator
    # pool vs. qubit-excitation operator pool -- a genuine, evidenced
    # difference in ansatz construction, not merely unknown.
    comparisons.append(
        build_comparison(
            "grimsley2019_vs_tang2021",
            "grimsley2019",
            "tang2021",
            {
                ComparisonDimensionName.OPERATOR_POOL: (
                    ComparisonDimension(
                        name=ComparisonDimensionName.OPERATOR_POOL,
                        status=ComparisonDimensionStatus.CHANGED,
                        detail="grimsley2019 uses a fermionic operator pool; tang2021 uses a qubit-excitation operator pool (qubit-ADAPT-VQE), per both records' component notes.",
                    ),
                    "docs/atlas/corpus/papers/grimsley2019.json#components[1-2], docs/atlas/corpus/papers/tang2021.json#components[1-2]",
                ),
            },
            unresolved_conflicts=[
                "Both use gradient-based adaptive operator selection, but the literature-level records do not provide enough normalized detail to mark search scoring or stopping conditions fixed.",
            ],
        )
    )

    # 3. omalley2016 vs kandala2017: different molecules (H2 vs. LiH/BeH2) --
    # a genuinely different problem, not just an unknown. This is expected
    # to classify as invalid, demonstrating the schema correctly refuses to
    # produce a misleading strict/controlled/partial verdict across
    # different physical systems.
    comparisons.append(
        build_comparison(
            "omalley2016_vs_kandala2017",
            "omalley2016",
            "kandala2017",
            {
                ComparisonDimensionName.PROBLEM_DIGEST: (
                    ComparisonDimension(
                        name=ComparisonDimensionName.PROBLEM_DIGEST,
                        status=ComparisonDimensionStatus.CHANGED,
                        detail="omalley2016 studies H2 (molecular hydrogen); kandala2017 studies LiH and BeH2 -- different molecular systems, confirmed by both records' own problem_summary fields. No computed digest exists, but the underlying physical systems are evidenced to differ, which is sufficient to mark this CHANGED (blocking) rather than merely unknown.",
                    ),
                    "docs/atlas/corpus/papers/omalley2016.json#problem_summary, docs/atlas/corpus/papers/kandala2017.json#problem_summary",
                ),
                ComparisonDimensionName.ANSATZ_SEMANTIC_DEFINITION: (
                    ComparisonDimension(
                        name=ComparisonDimensionName.ANSATZ_SEMANTIC_DEFINITION,
                        status=ComparisonDimensionStatus.CHANGED,
                        detail="omalley2016 uses a unitary coupled cluster ansatz; kandala2017 uses a hardware-efficient ansatz -- different ansatz families, per both records' component notes.",
                    ),
                    "docs/atlas/corpus/papers/omalley2016.json#components[1], docs/atlas/corpus/papers/kandala2017.json#components[1]",
                ),
            },
            unresolved_conflicts=[
                "Different problem systems make this comparison invalid regardless of any other dimension -- recorded here as a genuine example of the schema's INVALID classification, not a defect in the comparison.",
            ],
        )
    )

    for comp in comparisons:
        path = COMPARISONS_DIR / f"{comp['comparison_id']}.json"
        path.write_text(json.dumps(comp, indent=2) + "\n")
        print(f"{comp['comparison_id']}: classification={comp['classification']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
