"""Canonical Hamiltonian model, deterministic digest/canonicalization, and
the H2/STO-3G Phase 0 fixture loader.

Canonicalization contract: the same logical Hamiltonian produces the same
digest regardless of input dict/list key order, and regardless of which of
two runtime candidates produced it -- see
docs/atlas/fixtures/h2_sto3g/generate_fixture.py for the empirical qubit-
permutation + local-Pauli-frame reconciliation this loader trusts as
already-applied input.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Self

from pydantic import Field, model_validator

from .models import SCHEMA_VERSION, ScientificExperimentSpec, VqeBaseModel

PAULI_STRING_PATTERN = re.compile(r"^[IXYZ]+$")


class PauliTerm(VqeBaseModel):
    """One term of a qubit Hamiltonian. `pauli_qubit0_first[i]` is the
    single-qubit Pauli operator on qubit i (canonical convention fixed by
    the Phase 0 spike, not either framework's native ordering)."""

    pauli_qubit0_first: str = Field(min_length=1, max_length=64)
    coeff_re: float
    coeff_im: float = 0.0

    @model_validator(mode="after")
    def _label_is_pauli_only(self) -> Self:
        if not PAULI_STRING_PATTERN.match(self.pauli_qubit0_first):
            raise ValueError(
                f"pauli_qubit0_first must contain only I/X/Y/Z, got {self.pauli_qubit0_first!r}"
            )
        return self


class CanonicalHamiltonian(VqeBaseModel):
    """A qubit Hamiltonian in canonical form: terms sorted deterministically
    by Pauli string, coefficients rounded to a fixed precision. Two
    Hamiltonians representing the same physical operator must canonicalize
    to the same digest once expressed in the same qubit convention -- this
    model does not itself reconcile different conventions (that is what the
    Phase 0 fixture's qubit-permutation + local-Pauli-frame search does,
    upstream of this model)."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    num_qubits: int = Field(ge=1, le=64)
    terms: list[PauliTerm] = Field(min_length=1, max_length=4096)
    coefficient_rounding_decimals: int = Field(default=12, ge=0, le=15)

    @model_validator(mode="after")
    def _term_widths_match_num_qubits(self) -> Self:
        for term in self.terms:
            if len(term.pauli_qubit0_first) != self.num_qubits:
                raise ValueError(
                    f"term {term.pauli_qubit0_first!r} has width "
                    f"{len(term.pauli_qubit0_first)}, expected num_qubits={self.num_qubits}"
                )
        labels = [t.pauli_qubit0_first for t in self.terms]
        if len(labels) != len(set(labels)):
            raise ValueError("duplicate Pauli-string term in canonical Hamiltonian")
        return self


def canonicalize_hamiltonian(hamiltonian: CanonicalHamiltonian) -> CanonicalHamiltonian:
    """Deterministic normal form: terms sorted by Pauli string, coefficients
    rounded to `coefficient_rounding_decimals`. Idempotent -- canonicalizing
    an already-canonical Hamiltonian returns an equal object."""
    rounded_terms = [
        PauliTerm(
            pauli_qubit0_first=term.pauli_qubit0_first,
            coeff_re=round(term.coeff_re, hamiltonian.coefficient_rounding_decimals),
            coeff_im=round(term.coeff_im, hamiltonian.coefficient_rounding_decimals),
        )
        for term in hamiltonian.terms
    ]
    rounded_terms.sort(key=lambda t: t.pauli_qubit0_first)
    return CanonicalHamiltonian(
        num_qubits=hamiltonian.num_qubits,
        terms=rounded_terms,
        coefficient_rounding_decimals=hamiltonian.coefficient_rounding_decimals,
    )


def hamiltonian_digest(hamiltonian: CanonicalHamiltonian) -> str:
    """SHA-256 of the canonicalized form's deterministic JSON serialization.
    Callers should pass a Hamiltonian through canonicalize_hamiltonian()
    first if it did not already come from one -- this function does not
    canonicalize implicitly, so a caller can also digest a deliberately
    non-canonical form to detect that fact (e.g. in a round-trip test)."""
    payload = [
        {"pauli_qubit0_first": t.pauli_qubit0_first, "coeff_re": t.coeff_re, "coeff_im": t.coeff_im}
        for t in hamiltonian.terms
    ]
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def scientific_experiment_spec_digest(spec: ScientificExperimentSpec) -> str:
    """SHA-256 of a ScientificExperimentSpec's canonical JSON. Because this
    type never contains framework/runtime/provider information (the
    ADR-0023 spec/binding separation), the same digest is produced
    regardless of which ExecutionBinding later executes it -- that
    invariant is exactly what the "scientific spec hash unchanged across
    framework bindings" test (plan Part IV Phase 1 Tests) checks."""
    encoded = spec.model_dump_json(exclude_none=False)
    canonical = json.dumps(json.loads(encoded), sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def compute_idempotency_key(
    *,
    scientific_spec_sha256: str,
    runtime_profile_id: str,
    adapter_release_id: str,
    dataset_snapshot_id: str | None,
    protocol_version: str,
) -> str:
    """Server-generated experiment-creation idempotency identity (plan Part
    II §9: scientific_spec_sha256 + runtime_profile_id + adapter_release_id +
    dataset_snapshot_id + protocol_version). Never a client-chosen key."""
    payload = {
        "scientific_spec_sha256": scientific_spec_sha256,
        "runtime_profile_id": runtime_profile_id,
        "adapter_release_id": adapter_release_id,
        "dataset_snapshot_id": dataset_snapshot_id,
        "protocol_version": protocol_version,
    }
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class H2Sto3gFixture(VqeBaseModel):
    """Typed view of docs/atlas/fixtures/h2_sto3g/manifest.json -- the
    Phase 0B golden fixture (owner-approved as an engineering slice; see
    docs/atlas/PHASE0_OWNER_REVIEW.md; NOT yet a domain-scientist-reviewed
    golden fixture per plan Part III §12)."""

    fixture_id: str
    canonical_hamiltonian: CanonicalHamiltonian
    hamiltonian_digest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    nuclear_repulsion_ha: float
    independent_direct_fci_reference_ha: float
    human_or_owner_review_status: str


class RepoFixtureNotFoundError(RuntimeError):
    pass


def _find_repo_root(start: Path) -> Path:
    """Walk upward from `start` looking for the `.git` directory marking the
    majorana repo root. Raises RepoFixtureNotFoundError rather than
    guessing, since a wrong root would silently load fixture data from
    somewhere unintended."""
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise RepoFixtureNotFoundError(
        f"could not find repo root (no .git found walking up from {start})"
    )


def load_h2_sto3g_fixture(manifest_path: Path | None = None) -> H2Sto3gFixture:
    """Load the Phase 0B H2/STO-3G fixture manifest as a typed object. No
    Qiskit/PennyLane import -- pure JSON parsing, matching this package's
    framework-free constraint (AGENTS.md)."""
    if manifest_path is None:
        repo_root = _find_repo_root(Path(__file__).parent)
        manifest_path = repo_root / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
    if not manifest_path.exists():
        raise RepoFixtureNotFoundError(f"H2/STO-3G fixture manifest not found: {manifest_path}")

    raw = json.loads(manifest_path.read_text())
    canonical = raw["canonical_hamiltonian"]
    hamiltonian = CanonicalHamiltonian(
        num_qubits=raw["electron_orbital_qubit_counts"]["n_qubits"],
        terms=[
            PauliTerm(
                pauli_qubit0_first=t["pauli_qubit0_first"],
                coeff_re=t["coeff_re"],
                coeff_im=t["coeff_im"],
            )
            for t in canonical["terms"]
        ],
        coefficient_rounding_decimals=canonical["coefficient_rounding_decimals"],
    )
    return H2Sto3gFixture(
        fixture_id=raw["fixture_id"],
        canonical_hamiltonian=hamiltonian,
        hamiltonian_digest_sha256=raw["hamiltonian_digest_sha256"],
        nuclear_repulsion_ha=raw["nuclear_repulsion_ha"],
        independent_direct_fci_reference_ha=raw["independent_direct_fci_reference_ha"],
        human_or_owner_review_status=raw["review_record"]["human_or_owner_review"],
    )
