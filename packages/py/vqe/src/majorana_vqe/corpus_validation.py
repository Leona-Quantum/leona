"""Phase 2 curated corpus validator (docs/atlas/corpus/) -- offline schema,
enum, and cross-reference checks only. See
docs/atlas/corpus/ANNOTATION_GUIDELINE.md for the schema this checks against
and ADR-0026 for why validation here is machine-only (no claim of human
review is made or checked).

Deliberately offline: never makes a network call. Online URL-reachability
auditing is a separate, explicitly-online tool
(docs/atlas/corpus/validator/online_url_audit.py) that must never run as
part of normal CI, so a network blip never makes the standard test suite
flaky.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from .models import ComponentType

CURRENT_SCHEMA_VERSION = "0.2.0"
CURRENT_VALIDATOR_VERSION = "0.1.0"

VALID_METHOD_FAMILIES = frozenset(
    {
        "vqe_uccsd",
        "adapt_vqe",
        "qubit_adapt",
        "qeb_adapt",
        "tetris_adapt",
        "ceo_adapt",
        "param_adapt",
        "pruning_compression",
        "measurement_reduction",
        "learning_guided_vqe",
    }
)

VALID_RELATIONS = frozenset(
    {"official", "author", "general_framework_library", "third_party_reference_implementation"}
)

VALID_VALIDATION_STATES = frozenset(
    {"draft", "machine_validated", "validation_failed", "conflicting"}
)

VALID_COMPONENT_TYPES = frozenset(t.value for t in ComponentType)

VALID_COMPARISON_DIMENSION_STATUSES = frozenset({"fixed", "changed", "unknown"})
VALID_COMPARISON_CLASSIFICATIONS = frozenset({"strict", "controlled", "partial", "invalid"})

REQUIRED_PAPER_FIELDS = frozenset(
    {
        "paper_id",
        "annotation_schema_version",
        "title",
        "authors",
        "year",
        "venue",
        "volume",
        "pages_or_article_number",
        "doi",
        "arxiv_id",
        "method_family",
        "problem_summary",
        "sources_verified",
        "components",
        "workflow_composition_notes",
        "unknown_or_ambiguous_fields",
        "conflicting_fields",
        "negative_results_or_missing_implementation",
        "implementation_ref",
        "validation_state",
    }
)

REQUIRED_REPOSITORY_FIELDS = frozenset(
    {
        "repo_id",
        "annotation_schema_version",
        "repository_url",
        "relation",
        "associated_paper_ids",
        "paper_associated_commit",
        "license_state",
        "environment_completeness",
        "evidence_locators",
        "sources_verified",
        "unknown_or_ambiguous_fields",
        "validation_state",
    }
)

REQUIRED_COMPARISON_FIELDS = frozenset(
    {
        "comparison_id",
        "annotation_schema_version",
        "generation_method",
        "generator_version",
        "source_record_ids",
        "generated_at",
        "dimensions",
        "classification",
        "unresolved_conflicts",
        "validation_warnings",
        "is_manual_gold",
        "human_validated",
    }
)

REQUIRED_VALIDATION_STATE_FIELDS = frozenset(
    {"state", "validator_version", "validated_at", "validation_errors", "validation_warnings"}
)


@dataclass(frozen=True)
class ValidationIssue:
    record_id: str
    field_name: str
    severity: str  # "error" | "warning"
    message: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.record_id}.{self.field_name}: {self.message}"


def is_valid_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _check_no_unexpected_fields(
    record: dict, allowed: frozenset[str], record_id: str
) -> list[ValidationIssue]:
    unexpected = set(record.keys()) - allowed
    return [
        ValidationIssue(record_id, key, "error", "unexpected field not in schema")
        for key in sorted(unexpected)
    ]


def _check_validation_state(record: dict, record_id: str) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    vs = record.get("validation_state")
    if not isinstance(vs, dict):
        return [ValidationIssue(record_id, "validation_state", "error", "missing or not an object")]
    missing = REQUIRED_VALIDATION_STATE_FIELDS - set(vs.keys())
    if missing:
        issues.append(
            ValidationIssue(
                record_id, "validation_state", "error", f"missing sub-fields: {sorted(missing)}"
            )
        )
        return issues
    state = vs.get("state")
    if state not in VALID_VALIDATION_STATES:
        issues.append(
            ValidationIssue(
                record_id, "validation_state.state", "error", f"invalid state {state!r}"
            )
        )
    if state == "machine_validated":
        if vs.get("validator_version") is None or vs.get("validated_at") is None:
            issues.append(
                ValidationIssue(
                    record_id,
                    "validation_state",
                    "error",
                    "state=machine_validated requires validator_version and validated_at",
                )
            )
        if vs.get("validation_errors"):
            issues.append(
                ValidationIssue(
                    record_id,
                    "validation_state",
                    "error",
                    "state=machine_validated must not carry validation_errors",
                )
            )
    if state == "validation_failed" and not vs.get("validation_errors"):
        issues.append(
            ValidationIssue(
                record_id,
                "validation_state",
                "error",
                "state=validation_failed requires at least one validation_errors entry",
            )
        )
    # NOTE: this state is machine-only by construction -- there is no
    # "human_reviewed" value in VALID_VALIDATION_STATES at all (ADR-0026).
    return issues


def validate_paper_record(record: dict, filename: str) -> list[ValidationIssue]:
    record_id = record.get("paper_id", filename)
    issues: list[ValidationIssue] = []

    missing = REQUIRED_PAPER_FIELDS - set(record.keys())
    if missing:
        issues.append(
            ValidationIssue(
                record_id, "<record>", "error", f"missing required fields: {sorted(missing)}"
            )
        )
    issues += _check_no_unexpected_fields(record, REQUIRED_PAPER_FIELDS, record_id)

    if record.get("annotation_schema_version") != CURRENT_SCHEMA_VERSION:
        issues.append(
            ValidationIssue(
                record_id,
                "annotation_schema_version",
                "error",
                f"expected {CURRENT_SCHEMA_VERSION!r}, got {record.get('annotation_schema_version')!r}",
            )
        )

    expected_filename = f"{record.get('paper_id')}.json"
    if filename != expected_filename:
        issues.append(
            ValidationIssue(
                record_id,
                "paper_id",
                "error",
                f"filename {filename!r} != paper_id-derived {expected_filename!r}",
            )
        )

    sources = record.get("sources_verified")
    if not sources:
        issues.append(ValidationIssue(record_id, "sources_verified", "error", "must be non-empty"))
    else:
        for url in sources:
            if not is_valid_url(url):
                issues.append(
                    ValidationIssue(
                        record_id, "sources_verified", "error", f"not a valid http(s) URL: {url!r}"
                    )
                )

    for fam in record.get("method_family", []):
        if fam not in VALID_METHOD_FAMILIES:
            issues.append(
                ValidationIssue(record_id, "method_family", "error", f"unknown family {fam!r}")
            )

    components = record.get("components", [])
    if not isinstance(components, list) or not components:
        issues.append(ValidationIssue(record_id, "components", "error", "must be a non-empty list"))
    else:
        for i, comp in enumerate(components):
            ctype = comp.get("component_type")
            if ctype not in VALID_COMPONENT_TYPES:
                issues.append(
                    ValidationIssue(
                        record_id,
                        f"components[{i}].component_type",
                        "error",
                        f"invalid type {ctype!r}",
                    )
                )
            if not comp.get("evidence_locator"):
                issues.append(
                    ValidationIssue(
                        record_id, f"components[{i}].evidence_locator", "error", "missing"
                    )
                )

    issues += _check_validation_state(record, record_id)
    return issues


def validate_repository_record(record: dict, filename: str) -> list[ValidationIssue]:
    record_id = record.get("repo_id", filename)
    issues: list[ValidationIssue] = []

    missing = REQUIRED_REPOSITORY_FIELDS - set(record.keys())
    if missing:
        issues.append(
            ValidationIssue(
                record_id, "<record>", "error", f"missing required fields: {sorted(missing)}"
            )
        )
    issues += _check_no_unexpected_fields(record, REQUIRED_REPOSITORY_FIELDS, record_id)

    if record.get("annotation_schema_version") != CURRENT_SCHEMA_VERSION:
        issues.append(
            ValidationIssue(
                record_id,
                "annotation_schema_version",
                "error",
                f"expected {CURRENT_SCHEMA_VERSION!r}, got {record.get('annotation_schema_version')!r}",
            )
        )

    expected_filename = f"{record.get('repo_id')}.json"
    if filename != expected_filename:
        issues.append(
            ValidationIssue(
                record_id,
                "repo_id",
                "error",
                f"filename {filename!r} != repo_id-derived {expected_filename!r}",
            )
        )

    if not is_valid_url(record.get("repository_url")):
        issues.append(
            ValidationIssue(record_id, "repository_url", "error", "not a valid http(s) URL")
        )

    relation = record.get("relation")
    if relation not in VALID_RELATIONS:
        issues.append(
            ValidationIssue(record_id, "relation", "error", f"invalid relation {relation!r}")
        )

    sources = record.get("sources_verified")
    if not sources:
        issues.append(ValidationIssue(record_id, "sources_verified", "error", "must be non-empty"))
    else:
        for url in sources:
            if not is_valid_url(url):
                issues.append(
                    ValidationIssue(
                        record_id, "sources_verified", "error", f"not a valid http(s) URL: {url!r}"
                    )
                )

    if not record.get("evidence_locators"):
        issues.append(ValidationIssue(record_id, "evidence_locators", "error", "must be non-empty"))

    issues += _check_validation_state(record, record_id)
    return issues


def validate_comparison_record(record: dict, filename: str) -> list[ValidationIssue]:
    record_id = record.get("comparison_id", filename)
    issues: list[ValidationIssue] = []

    missing = REQUIRED_COMPARISON_FIELDS - set(record.keys())
    if missing:
        issues.append(
            ValidationIssue(
                record_id, "<record>", "error", f"missing required fields: {sorted(missing)}"
            )
        )
    issues += _check_no_unexpected_fields(record, REQUIRED_COMPARISON_FIELDS, record_id)

    if record.get("annotation_schema_version") != CURRENT_SCHEMA_VERSION:
        issues.append(
            ValidationIssue(
                record_id,
                "annotation_schema_version",
                "error",
                f"expected {CURRENT_SCHEMA_VERSION!r}, got {record.get('annotation_schema_version')!r}",
            )
        )

    if record.get("is_manual_gold") is not False:
        issues.append(
            ValidationIssue(
                record_id,
                "is_manual_gold",
                "error",
                "MVP comparison reports must have is_manual_gold=false (ADR-0026)",
            )
        )
    if record.get("human_validated") is not False:
        issues.append(
            ValidationIssue(
                record_id,
                "human_validated",
                "error",
                "MVP comparison reports must have human_validated=false (ADR-0026)",
            )
        )

    classification = record.get("classification")
    if classification not in VALID_COMPARISON_CLASSIFICATIONS:
        issues.append(
            ValidationIssue(
                record_id, "classification", "error", f"invalid classification {classification!r}"
            )
        )

    dimensions = record.get("dimensions", [])
    if not dimensions:
        issues.append(ValidationIssue(record_id, "dimensions", "error", "must be non-empty"))
    for i, dim in enumerate(dimensions):
        status = dim.get("status")
        if status not in VALID_COMPARISON_DIMENSION_STATUSES:
            issues.append(
                ValidationIssue(
                    record_id, f"dimensions[{i}].status", "error", f"invalid status {status!r}"
                )
            )
        if status in ("fixed", "changed") and not dim.get("evidence_locator"):
            issues.append(
                ValidationIssue(
                    record_id,
                    f"dimensions[{i}].evidence_locator",
                    "error",
                    f"status={status!r} requires an evidence_locator, not just an assertion",
                )
            )

    return issues


@dataclass
class CorpusValidationReport:
    paper_count: int
    repository_count: int
    component_count: int
    comparison_count: int
    relation_counts: dict[str, int]
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError(f"could not find repo root (no .git found walking up from {start})")


def validate_corpus(corpus_root: Path | None = None) -> CorpusValidationReport:
    """Run every offline check against docs/atlas/corpus/. Does not write
    anything or make a network call. Use update_validation_state() to write
    the results back into each record's validation_state."""
    if corpus_root is None:
        corpus_root = _find_repo_root(Path(__file__).parent) / "docs" / "atlas" / "corpus"

    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    paper_files = sorted((corpus_root / "papers").glob("*.json"))
    repo_files = sorted((corpus_root / "repositories").glob("*.json"))
    comparisons_dir = corpus_root / "comparisons"
    comparison_files = sorted(comparisons_dir.glob("*.json")) if comparisons_dir.exists() else []

    papers: dict[str, dict] = {}
    doi_seen: dict[str, str] = {}
    arxiv_seen: dict[str, str] = {}
    component_count = 0

    for pf in paper_files:
        record = json.loads(pf.read_text())
        pid = record.get("paper_id", pf.stem)
        if pid in papers:
            errors.append(ValidationIssue(pid, "paper_id", "error", "duplicate paper_id"))
        papers[pid] = record
        errors.extend(validate_paper_record(record, pf.name))
        component_count += len(record.get("components", []))

        doi = record.get("doi")
        if doi:
            if doi in doi_seen:
                errors.append(
                    ValidationIssue(
                        pid, "doi", "error", f"duplicate DOI {doi!r} also used by {doi_seen[doi]!r}"
                    )
                )
            else:
                doi_seen[doi] = pid
        arxiv_id = record.get("arxiv_id")
        if arxiv_id:
            if arxiv_id in arxiv_seen:
                errors.append(
                    ValidationIssue(
                        pid,
                        "arxiv_id",
                        "error",
                        f"duplicate arXiv ID {arxiv_id!r} also used by {arxiv_seen[arxiv_id]!r}",
                    )
                )
            else:
                arxiv_seen[arxiv_id] = pid

    repos: dict[str, dict] = {}
    relation_counts: dict[str, int] = dict.fromkeys(VALID_RELATIONS, 0)
    for rf in repo_files:
        record = json.loads(rf.read_text())
        rid = record.get("repo_id", rf.stem)
        if rid in repos:
            errors.append(ValidationIssue(rid, "repo_id", "error", "duplicate repo_id"))
        repos[rid] = record
        errors.extend(validate_repository_record(record, rf.name))
        relation = record.get("relation")
        if relation in relation_counts:
            relation_counts[relation] += 1

    # Cross-reference integrity: paper -> repository
    for pid, precord in papers.items():
        ref = precord.get("implementation_ref")
        if ref is not None and ref not in repos:
            errors.append(
                ValidationIssue(
                    pid, "implementation_ref", "error", f"references unknown repo_id {ref!r}"
                )
            )

    # Cross-reference integrity: repository -> paper
    for rid, rrecord in repos.items():
        for pid in rrecord.get("associated_paper_ids", []):
            if pid not in papers:
                errors.append(
                    ValidationIssue(
                        rid, "associated_paper_ids", "error", f"references unknown paper_id {pid!r}"
                    )
                )

    comparison_count = 0
    for cf in comparison_files:
        record = json.loads(cf.read_text())
        cid = record.get("comparison_id", cf.stem)
        comparison_count += 1
        errors.extend(validate_comparison_record(record, cf.name))
        for source_id in record.get("source_record_ids", []):
            if source_id not in papers and source_id not in repos:
                errors.append(
                    ValidationIssue(
                        cid,
                        "source_record_ids",
                        "error",
                        f"references unknown record id {source_id!r}",
                    )
                )

    return CorpusValidationReport(
        paper_count=len(papers),
        repository_count=len(repos),
        component_count=component_count,
        comparison_count=comparison_count,
        relation_counts=relation_counts,
        errors=errors,
        warnings=warnings,
    )


def update_validation_state(corpus_root: Path | None = None) -> CorpusValidationReport:
    """Re-run validate_corpus() and write the outcome back into every
    paper/repository record's validation_state (machine_validated if that
    specific record had zero errors, validation_failed otherwise). Never
    invents a human review state -- VALID_VALIDATION_STATES has none."""
    if corpus_root is None:
        corpus_root = _find_repo_root(Path(__file__).parent) / "docs" / "atlas" / "corpus"

    report = validate_corpus(corpus_root)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    errors_by_record: dict[str, list[str]] = {}
    for issue in report.errors:
        errors_by_record.setdefault(issue.record_id, []).append(str(issue))

    for subdir, id_field in (("papers", "paper_id"), ("repositories", "repo_id")):
        for path in sorted((corpus_root / subdir).glob("*.json")):
            record = json.loads(path.read_text())
            rid = record.get(id_field, path.stem)
            record_errors = errors_by_record.get(rid, [])
            record["validation_state"] = {
                "state": "validation_failed" if record_errors else "machine_validated",
                "validator_version": CURRENT_VALIDATOR_VERSION,
                "validated_at": now,
                "validation_errors": record_errors,
                "validation_warnings": [],
            }
            path.write_text(json.dumps(record, indent=2) + "\n")

    return validate_corpus(corpus_root)


def main() -> int:
    report = validate_corpus()
    print(
        f"papers={report.paper_count} repositories={report.repository_count} "
        f"components={report.component_count} comparisons={report.comparison_count}"
    )
    print(f"relation_counts={report.relation_counts}")
    for issue in report.errors:
        print(issue)
    for issue in report.warnings:
        print(issue)
    print(f"errors={len(report.errors)} warnings={len(report.warnings)}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
