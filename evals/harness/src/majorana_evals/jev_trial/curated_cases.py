"""Loads `evals/jev-trial/curated-cases.yaml` — hash-pinned the same way
`public_benchmarks.qiskit_human_eval`/`qcircuiteval` pin their vendored datasets, so a
silent edit to the curated set (this repo's OWN ground truth, not a vendored one) is a
loud loader error, not a quietly different report."""

from __future__ import annotations

import hashlib
from pathlib import Path

import yaml
from pydantic import ValidationError

from majorana_evals.jev_trial.schema import CuratedCase

#: Recomputed and checked at load time. Update after a deliberate edit to
#: curated-cases.yaml — see DERIVATION.md for what counts as one.
PINNED_SHA256 = "acaba7471870d6b7e561ac47a9a661178ca2e39d900c5a04df9b84f84da59247"

DEFAULT_CASES_PATH = Path(__file__).resolve().parents[4] / "jev-trial" / "curated-cases.yaml"


def load_curated_cases(path: Path | str | None = None) -> tuple[list[CuratedCase], str]:
    """Returns (cases, sha256_hex). Raises `ValueError` if the file does not match
    `PINNED_SHA256` (only when loading the default path — an explicit alternate path,
    e.g. from a test's `tmp_path`, is not checked against this repo's own pin) or if
    a case fails schema validation or repeats an id."""

    resolved = Path(path) if path is not None else DEFAULT_CASES_PATH
    raw = resolved.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if path is None and digest != PINNED_SHA256:
        raise ValueError(
            f"{resolved} does not match the pinned sha256 ({PINNED_SHA256}); got {digest}. "
            "If this is a deliberate edit, update PINNED_SHA256 in curated_cases.py."
        )

    payload = yaml.safe_load(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("cases"), list):
        raise ValueError(f"{resolved} must be a mapping with a top-level 'cases' list")

    cases: list[CuratedCase] = []
    for i, row in enumerate(payload["cases"]):
        try:
            cases.append(CuratedCase.model_validate(row))
        except ValidationError as exc:
            raise ValueError(f"{resolved}: case at index {i} failed validation: {exc}") from exc

    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        dupes = sorted({cid for cid in ids if ids.count(cid) > 1})
        raise ValueError(f"{resolved}: duplicate case ids: {dupes}")

    return cases, digest
