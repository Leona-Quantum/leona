"""Tests for the Phase 2 curated corpus validator (docs/atlas/corpus/).

Two kinds of test here: (1) unit tests against small synthetic records for
each validation rule, and (2) an integration test that runs the validator
against the REAL corpus at docs/atlas/corpus/ and asserts it is clean --
that second test is the actual audit this module exists to provide.
"""

from __future__ import annotations

import json
from pathlib import Path

from majorana_vqe.corpus_validation import (
    CURRENT_SCHEMA_VERSION,
    CURRENT_VALIDATOR_VERSION,
    is_valid_url,
    update_validation_state,
    validate_comparison_record,
    validate_corpus,
    validate_paper_record,
    validate_repository_record,
)


def _valid_validation_state() -> dict:
    return {
        "state": "draft",
        "validator_version": None,
        "validated_at": None,
        "validation_errors": [],
        "validation_warnings": [],
    }


def _minimal_paper(**overrides) -> dict:
    record = {
        "paper_id": "example2024",
        "annotation_schema_version": CURRENT_SCHEMA_VERSION,
        "title": "Example Paper",
        "authors": ["A. Author"],
        "year": 2024,
        "venue": "Example Venue",
        "volume": None,
        "pages_or_article_number": None,
        "doi": "10.1234/example",
        "arxiv_id": None,
        "method_family": ["vqe_uccsd"],
        "problem_summary": "An example.",
        "sources_verified": ["https://arxiv.org/abs/1234.56789"],
        "components": [
            {
                "component_type": "ansatz",
                "family_or_name": "example ansatz",
                "notes": None,
                "evidence_locator": "abstract",
            }
        ],
        "workflow_composition_notes": None,
        "unknown_or_ambiguous_fields": [],
        "conflicting_fields": [],
        "negative_results_or_missing_implementation": None,
        "implementation_ref": None,
        "validation_state": _valid_validation_state(),
    }
    record.update(overrides)
    return record


def _minimal_repo(**overrides) -> dict:
    record = {
        "repo_id": "example_repo",
        "annotation_schema_version": CURRENT_SCHEMA_VERSION,
        "repository_url": "https://github.com/example/repo",
        "relation": "official",
        "associated_paper_ids": ["example2024"],
        "paper_associated_commit": None,
        "license_state": "unknown",
        "environment_completeness": "unknown",
        "evidence_locators": ["https://github.com/example/repo"],
        "sources_verified": ["https://github.com/example/repo"],
        "unknown_or_ambiguous_fields": [],
        "validation_state": _valid_validation_state(),
    }
    record.update(overrides)
    return record


def _minimal_comparison(**overrides) -> dict:
    record = {
        "comparison_id": "example_comparison",
        "annotation_schema_version": CURRENT_SCHEMA_VERSION,
        "generation_method": "majorana_vqe.comparison.classify_comparison",
        "generator_version": "0.1.0",
        "source_record_ids": ["example2024"],
        "generated_at": "2026-07-24T00:00:00Z",
        "dimensions": [
            {
                "name": "seed",
                "status": "unknown",
                "detail": None,
                "evidence_locator": None,
            }
        ],
        "classification": "partial",
        "unresolved_conflicts": [],
        "validation_warnings": [],
        "is_manual_gold": False,
        "human_validated": False,
    }
    record.update(overrides)
    return record


class TestIsValidUrl:
    def test_accepts_https(self):
        assert is_valid_url("https://arxiv.org/abs/1234.56789")

    def test_rejects_prose(self):
        assert not is_valid_url("referenced via multiple corroborating secondary sources")

    def test_rejects_non_string(self):
        assert not is_valid_url(None)

    def test_rejects_scheme_only(self):
        assert not is_valid_url("https://")


class TestValidatePaperRecord:
    def test_valid_record_has_no_errors(self):
        assert validate_paper_record(_minimal_paper(), "example2024.json") == []

    def test_missing_required_field_is_an_error(self):
        record = _minimal_paper()
        del record["title"]
        issues = validate_paper_record(record, "example2024.json")
        assert any("missing required fields" in str(i) for i in issues)

    def test_unexpected_field_is_an_error(self):
        record = _minimal_paper()
        record["surprise_field"] = "nope"
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "surprise_field" for i in issues)

    def test_wrong_schema_version_is_an_error(self):
        record = _minimal_paper(annotation_schema_version="0.1.0")
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "annotation_schema_version" for i in issues)

    def test_filename_mismatch_is_an_error(self):
        issues = validate_paper_record(_minimal_paper(), "wrong_name.json")
        assert any(i.field_name == "paper_id" for i in issues)

    def test_empty_sources_verified_is_an_error(self):
        record = _minimal_paper(sources_verified=[])
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "sources_verified" for i in issues)

    def test_non_url_source_is_an_error(self):
        record = _minimal_paper(sources_verified=["this is not a url"])
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "sources_verified" for i in issues)

    def test_invalid_method_family_is_an_error(self):
        record = _minimal_paper(method_family=["not_a_real_family"])
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "method_family" for i in issues)

    def test_invalid_component_type_is_an_error(self):
        record = _minimal_paper()
        record["components"][0]["component_type"] = "not_a_real_type"
        issues = validate_paper_record(record, "example2024.json")
        assert any("component_type" in i.field_name for i in issues)

    def test_component_missing_evidence_locator_is_an_error(self):
        record = _minimal_paper()
        record["components"][0]["evidence_locator"] = ""
        issues = validate_paper_record(record, "example2024.json")
        assert any("evidence_locator" in i.field_name for i in issues)

    def test_empty_components_is_an_error(self):
        record = _minimal_paper(components=[])
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "components" for i in issues)


class TestValidateRepositoryRecord:
    def test_valid_record_has_no_errors(self):
        assert validate_repository_record(_minimal_repo(), "example_repo.json") == []

    def test_invalid_relation_is_an_error(self):
        record = _minimal_repo(relation="totally_official_trust_me")
        issues = validate_repository_record(record, "example_repo.json")
        assert any(i.field_name == "relation" for i in issues)

    def test_general_framework_library_is_a_valid_relation(self):
        record = _minimal_repo(relation="general_framework_library")
        assert validate_repository_record(record, "example_repo.json") == []

    def test_invalid_repository_url_is_an_error(self):
        record = _minimal_repo(repository_url="not-a-url")
        issues = validate_repository_record(record, "example_repo.json")
        assert any(i.field_name == "repository_url" for i in issues)

    def test_empty_evidence_locators_is_an_error(self):
        record = _minimal_repo(evidence_locators=[])
        issues = validate_repository_record(record, "example_repo.json")
        assert any(i.field_name == "evidence_locators" for i in issues)


class TestValidationStateConsistency:
    def test_machine_validated_requires_validator_version_and_timestamp(self):
        record = _minimal_paper(
            validation_state={
                "state": "machine_validated",
                "validator_version": None,
                "validated_at": None,
                "validation_errors": [],
                "validation_warnings": [],
            }
        )
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "validation_state" for i in issues)

    def test_machine_validated_must_not_carry_errors(self):
        record = _minimal_paper(
            validation_state={
                "state": "machine_validated",
                "validator_version": "0.1.0",
                "validated_at": "2026-07-24T00:00:00Z",
                "validation_errors": ["some error"],
                "validation_warnings": [],
            }
        )
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "validation_state" for i in issues)

    def test_validation_failed_requires_errors(self):
        record = _minimal_paper(
            validation_state={
                "state": "validation_failed",
                "validator_version": "0.1.0",
                "validated_at": "2026-07-24T00:00:00Z",
                "validation_errors": [],
                "validation_warnings": [],
            }
        )
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "validation_state" for i in issues)

    def test_human_reviewed_is_not_a_valid_state(self):
        """ADR-0027: there is no human-reviewed state at all in this schema."""
        record = _minimal_paper(
            validation_state={
                "state": "human_reviewed",
                "validator_version": None,
                "validated_at": None,
                "validation_errors": [],
                "validation_warnings": [],
            }
        )
        issues = validate_paper_record(record, "example2024.json")
        assert any(i.field_name == "validation_state.state" for i in issues)


class TestValidateComparisonRecord:
    def test_valid_record_has_no_errors(self):
        assert validate_comparison_record(_minimal_comparison(), "example_comparison.json") == []

    def test_is_manual_gold_true_is_rejected(self):
        record = _minimal_comparison(is_manual_gold=True)
        issues = validate_comparison_record(record, "example_comparison.json")
        assert any(i.field_name == "is_manual_gold" for i in issues)

    def test_human_validated_true_is_rejected(self):
        record = _minimal_comparison(human_validated=True)
        issues = validate_comparison_record(record, "example_comparison.json")
        assert any(i.field_name == "human_validated" for i in issues)

    def test_fixed_dimension_requires_evidence_locator(self):
        record = _minimal_comparison(
            dimensions=[
                {
                    "name": "seed",
                    "status": "fixed",
                    "detail": "both use seed=0",
                    "evidence_locator": None,
                }
            ]
        )
        issues = validate_comparison_record(record, "example_comparison.json")
        assert any("evidence_locator" in i.field_name for i in issues)

    def test_unknown_dimension_does_not_require_evidence_locator(self):
        record = _minimal_comparison(
            dimensions=[
                {"name": "seed", "status": "unknown", "detail": None, "evidence_locator": None}
            ]
        )
        assert validate_comparison_record(record, "example_comparison.json") == []


class TestValidateCorpusIntegration:
    """The actual audit: run the validator against the real corpus."""

    def test_real_corpus_has_zero_errors(self):
        report = validate_corpus()
        assert report.errors == [], "\n".join(str(e) for e in report.errors)

    def test_real_corpus_meets_plan_targets(self):
        report = validate_corpus()
        assert report.paper_count >= 25
        assert report.repository_count >= 15
        assert report.component_count >= 50

    def test_real_corpus_relation_breakdown_is_reported(self):
        report = validate_corpus()
        assert sum(report.relation_counts.values()) == report.repository_count
        # official + author must never be silently inflated by counting
        # general_framework_library or third_party entries in it.
        assert report.relation_counts["general_framework_library"] > 0

    def test_real_corpus_has_at_least_three_comparison_reports(self):
        report = validate_corpus()
        assert report.comparison_count >= 3

    def test_real_corpus_official_and_author_do_not_include_general_or_third_party(self):
        """Regression guard for the exact miscount an earlier pass made:
        official+author must be reported separately from
        general_framework_library/third_party_reference_implementation, never
        summed together and called 'official/author'."""
        report = validate_corpus()
        official_and_author = report.relation_counts["official"] + report.relation_counts["author"]
        assert official_and_author < report.repository_count, (
            "if this ever equals repository_count, general_framework_library and "
            "third_party_reference_implementation silently vanished from the corpus"
        )

    def test_real_corpus_has_no_duplicate_dois(self):
        report = validate_corpus()
        assert not any("duplicate DOI" in str(e) for e in report.errors)

    def test_real_comparison_reports_are_not_manual_gold(self):
        from majorana_vqe.corpus_validation import _find_repo_root

        corpus_root = _find_repo_root(Path(__file__).parent) / "docs" / "atlas" / "corpus"
        comparison_files = sorted((corpus_root / "comparisons").glob("*.json"))
        assert len(comparison_files) >= 3
        for path in comparison_files:
            record = json.loads(path.read_text())
            assert record["is_manual_gold"] is False, path
            assert record["human_validated"] is False, path


class TestCrossReferenceIntegrity:
    def test_dangling_implementation_ref_is_an_error(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        paper = _minimal_paper(implementation_ref="does_not_exist")
        (corpus_root / "papers" / "example2024.json").write_text(json.dumps(paper))

        report = validate_corpus(corpus_root)
        assert any(e.field_name == "implementation_ref" for e in report.errors)

    def test_dangling_associated_paper_id_is_an_error(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        repo = _minimal_repo(associated_paper_ids=["does_not_exist"])
        (corpus_root / "repositories" / "example_repo.json").write_text(json.dumps(repo))

        report = validate_corpus(corpus_root)
        assert any(e.field_name == "associated_paper_ids" for e in report.errors)

    def test_duplicate_doi_is_an_error(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        p1 = _minimal_paper(paper_id="one", doi="10.1234/same")
        p2 = _minimal_paper(paper_id="two", doi="10.1234/same")
        (corpus_root / "papers" / "one.json").write_text(json.dumps(p1))
        (corpus_root / "papers" / "two.json").write_text(json.dumps(p2))

        report = validate_corpus(corpus_root)
        assert any("duplicate DOI" in str(e) for e in report.errors)

    def test_valid_mini_corpus_has_no_errors(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        paper = _minimal_paper(implementation_ref="example_repo")
        repo = _minimal_repo()
        (corpus_root / "papers" / "example2024.json").write_text(json.dumps(paper))
        (corpus_root / "repositories" / "example_repo.json").write_text(json.dumps(repo))

        report = validate_corpus(corpus_root)
        assert report.ok, "\n".join(str(e) for e in report.errors)
        assert report.paper_count == 1
        assert report.repository_count == 1
        assert report.component_count == 1


class TestUpdateValidationState:
    def test_writes_machine_validated_for_a_clean_record(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        paper_path = corpus_root / "papers" / "example2024.json"
        paper_path.write_text(json.dumps(_minimal_paper()))

        update_validation_state(corpus_root)

        updated = json.loads(paper_path.read_text())
        assert updated["validation_state"]["state"] == "machine_validated"
        assert updated["validation_state"]["validator_version"] == CURRENT_VALIDATOR_VERSION
        assert updated["validation_state"]["validated_at"] is not None
        assert updated["validation_state"]["validation_errors"] == []

    def test_writes_validation_failed_for_a_broken_record(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        paper_path = corpus_root / "papers" / "example2024.json"
        broken = _minimal_paper(sources_verified=[])
        paper_path.write_text(json.dumps(broken))

        update_validation_state(corpus_root)

        updated = json.loads(paper_path.read_text())
        assert updated["validation_state"]["state"] == "validation_failed"
        assert updated["validation_state"]["validation_errors"]

    def test_never_writes_a_human_reviewed_state(self, tmp_path: Path):
        corpus_root = tmp_path / "corpus"
        (corpus_root / "papers").mkdir(parents=True)
        (corpus_root / "repositories").mkdir(parents=True)
        paper_path = corpus_root / "papers" / "example2024.json"
        paper_path.write_text(json.dumps(_minimal_paper()))

        update_validation_state(corpus_root)

        updated = json.loads(paper_path.read_text())
        assert updated["validation_state"]["state"] != "human_reviewed"
