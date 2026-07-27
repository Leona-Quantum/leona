#!/usr/bin/env python3
"""Generate the bounded public component-first VQE catalog bundle."""

from __future__ import annotations

import argparse
import dataclasses
import enum
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "py" / "vqe" / "src"))

from majorana_vqe.standard_catalog import (  # noqa: E402
    CATALOG_SCHEMA_VERSION,
    CONTROLLED_COMPARISONS,
    STANDARD_COMPONENTS,
    STANDARD_IMPLEMENTATIONS,
    STANDARD_WORKFLOWS,
    check_workflow_compatibility,
)

OUTPUT = ROOT / "apps" / "web" / "lib" / "atlas-vqe" / "standard-catalog.generated.json"


def _json_value(value):
    if dataclasses.is_dataclass(value):
        return {
            field.name: _json_value(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, tuple):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    return value


def build_bundle() -> dict[str, object]:
    return {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "components": _json_value(STANDARD_COMPONENTS),
        "implementations": _json_value(STANDARD_IMPLEMENTATIONS),
        "workflows": [
            {
                **_json_value(workflow),
                "compatibility": _json_value(check_workflow_compatibility(workflow)),
            }
            for workflow in STANDARD_WORKFLOWS
        ],
        "controlled_comparisons": _json_value(CONTROLLED_COMPARISONS),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build_bundle(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            print(f"{OUTPUT} is stale", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
