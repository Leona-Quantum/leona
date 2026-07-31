"""Redacted evidence records for the Phase 8 official-provider dry run.

The records deliberately omit raw third-party bytes and declared fact values.
They are operational evidence about deterministic extraction, not scientific
capability, compatibility, precision, recall, or publication eligibility.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from .github_snapshot import GitHubRepositorySnapshot
from .vqe_metadata_assertions import extract_metadata_assertions
from .vqe_standard_sources import StandardSource


def build_redacted_source_report(
    source: StandardSource,
    snapshot: GitHubRepositorySnapshot,
) -> dict[str, Any]:
    """Build a replay-checked report without source bytes or fact values."""

    assertions = extract_metadata_assertions(source, snapshot)
    if assertions != extract_metadata_assertions(source, snapshot):
        raise RuntimeError("non_deterministic_replay")

    fields: Counter[str] = Counter()
    issue_codes: Counter[str] = Counter()
    issue_records: list[dict[str, str]] = []
    for assertion in assertions:
        fields.update(fact.field for fact in assertion.declared_facts)
        for issue in assertion.extraction_issues:
            issue_codes[f"{issue.parser}:{issue.code}"] += 1
            issue_records.append(issue.as_dict())

    return {
        "source_key": source.source_key,
        "repository_url": snapshot.canonical_repository_url,
        "commit_sha": snapshot.commit_sha,
        "tree_sha": snapshot.tree_sha,
        "tree_entry_count": snapshot.tree_entry_count,
        "metadata_manifest_sha256": snapshot.metadata_manifest_sha256,
        "selected_metadata_bytes": snapshot.selected_metadata_bytes,
        "selected_metadata_files": [
            {
                "path": item.path,
                "size": item.size,
                "content_sha256": item.content_sha256,
            }
            for item in snapshot.metadata_files
        ],
        "skipped_oversized_paths": list(snapshot.skipped_oversized_paths),
        "assertion_count": len(assertions),
        "declared_fact_count": sum(len(item.declared_facts) for item in assertions),
        "declared_field_counts": dict(sorted(fields.items())),
        "issue_count": sum(issue_codes.values()),
        "issue_code_counts": dict(sorted(issue_codes.items())),
        "extraction_issues": sorted(
            issue_records,
            key=lambda item: (
                item["path"],
                item["parser"],
                item["code"],
                item["content_sha256"],
            ),
        ),
        "deterministic_replay": True,
        "publication_eligible": False,
    }
