#!/usr/bin/env python3
"""Run bounded Phase 8 extraction over owner-approved public provider sources.

This command retrieves only the Phase 7 metadata allowlist, resolves HEAD to an
immutable commit, and emits a redacted aggregate report. It does not clone,
install, import, execute, persist to Postgres, materialize a component, or
publish a claim.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from majorana_api.github_client import GitHubClientError, GitHubRestClient
from majorana_api.github_coordinates import parse_public_github_repository
from majorana_api.github_snapshot import GitHubSnapshotError, build_github_metadata_snapshot
from majorana_api.vqe_metadata_assertions import EXTRACTOR_VERSION
from majorana_api.vqe_provider_dry_run import build_redacted_source_report
from majorana_api.vqe_standard_sources import (
    STANDARD_VQE_SOURCES,
    StandardSourceKind,
    get_standard_source,
)

REPORT_SCHEMA_VERSION = "atlas.phase8.official-provider-dry-run.v1"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--source",
        action="append",
        dest="sources",
        help="approved source key; repeat to restrict the run",
    )
    return parser.parse_args()


def _selected_sources(keys: list[str] | None):
    sources = (
        [get_standard_source(key) for key in keys]
        if keys
        else [
            source
            for source in STANDARD_VQE_SOURCES
            if source.source_kind is StandardSourceKind.GITHUB_REPOSITORY
            and source.acquisition_enabled
        ]
    )
    for source in sources:
        if (
            source.source_kind is not StandardSourceKind.GITHUB_REPOSITORY
            or not source.acquisition_enabled
        ):
            raise ValueError(f"source is not enabled for GitHub acquisition: {source.source_key}")
    return sources


async def _run(keys: list[str] | None) -> dict[str, object]:
    token = os.environ.get("GITHUB_TOKEN") or None
    reports = []
    failures = []
    async with GitHubRestClient(token=token) as client:
        for source in _selected_sources(keys):
            coordinate = parse_public_github_repository(source.canonical_locator)
            try:
                snapshot = await build_github_metadata_snapshot(client, coordinate)
                reports.append(build_redacted_source_report(source, snapshot))
            except (GitHubClientError, GitHubSnapshotError) as exc:
                failures.append(
                    {
                        "source_key": source.source_key,
                        "failure_code": str(exc),
                    }
                )
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "scope": "live_official_provider_metadata_dry_run",
        "sources": reports,
        "failures": failures,
        "scientific_quality_metrics": "not_measured_without_independent_gold_labels",
        "publication_eligible": False,
        "limitations": [
            "Source metadata is not scientific capability evidence",
            "Counts do not measure precision or recall",
            "No repository code was cloned, imported, installed, or executed",
            "No component or performance claim was materialized",
        ],
    }


def main() -> int:
    args = _arguments()
    report = asyncio.run(_run(args.sources))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
