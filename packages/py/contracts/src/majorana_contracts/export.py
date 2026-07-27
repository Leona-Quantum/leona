"""Deterministic OpenAPI export: models → components/schemas → openapi.json at the
package root. packages/ts/contracts-gen generates TS types from that file; CI
regenerates both and fails on diff (ADR-0008).

Usage: uv run python -m majorana_contracts.export [--check] [--out PATH]
"""

import argparse
import json
import sys
from pathlib import Path

from pydantic import RootModel
from pydantic.json_schema import models_json_schema

from . import CONTRACTS_VERSION, events, models, plan, scope

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "openapi.json"


class RunEvent(RootModel[events.RunEvent]):
    """Discriminated union of all run event types (class name sets the schema id)."""


EXPORTED = [
    RunEvent,
    plan.Plan,
    scope.Scope,
    models.Workspace,
    models.WorkspaceFolder,
    models.WorkspaceMember,
    models.WorkspaceOverview,
    models.WorkspaceSummary,
    models.Artifact,
    models.ArtifactVersion,
    models.CatalogProvenance,
    models.PublicCatalogEntry,
    models.Run,
    models.VerificationRecord,
    models.QpuRunRecord,
]


def build_document() -> dict:
    _, top = models_json_schema(
        [(m, "serialization") for m in EXPORTED],
        ref_template="#/components/schemas/{model}",
    )
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "majorana-contracts",
            "version": CONTRACTS_VERSION,
            "description": "Cross-boundary types only; API paths are owned by services/api.",
        },
        "paths": {},
        "components": {"schemas": top["$defs"]},
    }


def render() -> str:
    return json.dumps(build_document(), indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="majorana_contracts.export")
    parser.add_argument("--check", action="store_true", help="verify openapi.json is current")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    rendered = render()
    if args.check:
        if not args.out.exists() or args.out.read_text() != rendered:
            print(f"STALE: {args.out} does not match the models — run the export", file=sys.stderr)
            return 1
        print(f"OK: {args.out} is current")
        return 0
    args.out.write_text(rendered)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
