#!/usr/bin/env python3
"""Generate/check the provider-neutral H2 hardware-efficient circuit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from majorana_vqe.hardware_efficient import build_canonical_h2_hardware_efficient

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "canonical_hardware_efficient_v0.1.json"
)


def _render() -> bytes:
    circuit = build_canonical_h2_hardware_efficient()
    return (
        json.dumps(
            circuit.model_dump(mode="json"),
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = _render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != rendered:
            raise SystemExit(f"{OUTPUT} is stale; regenerate without --check")
        print(f"{OUTPUT.relative_to(ROOT)} is current")
        return
    OUTPUT.write_bytes(rendered)
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
