#!/usr/bin/env python3
"""Generate the immutable provider-neutral H2 UCCSD circuit fixture."""

from __future__ import annotations

import json
from pathlib import Path

from majorana_vqe.uccsd import build_canonical_h2_uccsd

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "canonical_uccsd_v0.1.json"


def main() -> None:
    circuit = build_canonical_h2_uccsd()
    OUTPUT.write_text(json.dumps(circuit.model_dump(mode="json"), indent=2) + "\n")
    print(OUTPUT)
    print(circuit.canonical_circuit_sha256)


if __name__ == "__main__":
    main()
