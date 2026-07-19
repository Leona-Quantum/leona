"""Owner bulk license attestation over the pinned bootstrap corpus (Slice C.5).

Publishing a catalog record requires an `artifact_sources` provenance row and an
*approved* license assertion. The importer creates neither on purpose: ADR-0019
keeps it content-agnostic, and approving a license is a legal act, not an import
step. This module carries the legal act as data.

What it is: a committed, content-hashed policy file expressing one named
attestation - who attested, in what words, granting which SPDX license, over
which records - plus a fail-closed planner that maps the policy onto the pinned
manifest. The policy checksum and statement travel into the audit row of every
record the attestation touches, so a published record can always be traced back
to the exact sentence someone signed.

What it is not: a license *detector*. Nothing here reads a record and concludes
what its license is. The manifest's own `source.license` strings are prose claims
("Citation metadata; Leona Quantum-authored scaffold"), never SPDX identifiers,
and they are recorded only as evidence of what was claimed - the grant itself
comes from the policy, i.e. from a human.

Fail-closed in both directions: a record the policy neither includes nor
explicitly excludes raises rather than defaulting either way, and an excluded
record is never attested, so it stays unpublishable.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from majorana_contracts.enums import LicenseAssertionKind, LicenseScope, SourceKind

from .catalog_bootstrap_manifest import canonicalize

SUPPORTED_POLICY_VERSION = 1


class AttestationPolicyError(ValueError):
    """The policy file is missing, malformed, or internally inconsistent."""


class UnclassifiedRecordError(ValueError):
    """A manifest record is neither included nor explicitly excluded.

    This is the fail-closed hinge. Regenerating the manifest with a record whose
    source kind the policy never considered must stop the run and force a human
    to extend the policy - silently including it would publish content under a
    grant nobody made, and silently dropping it would quietly shrink the corpus.
    """


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def default_policy_path() -> Path:
    """Locate the committed policy in both layouts, mirroring
    catalog_bootstrap_manifest.default_manifest_path (wheel copy first, then the
    source tree used by editable installs, dev, CI, and the tests)."""
    here = Path(__file__).resolve()
    packaged = here.parent / "catalog_bootstrap" / "attestation-policy.json"
    if packaged.is_file():
        return packaged
    return here.parents[2] / "catalog_bootstrap" / "attestation-policy.json"


@dataclass(frozen=True)
class AttestedRecord:
    """One record the attestation covers, with the claim it was made against."""

    upstream_identity: str
    source_kind_claim: str
    license_claim: str | None
    # sha256 over the record's canonicalized `source` object: pins *what was
    # claimed* at attestation time, so a later manifest regeneration that changes
    # a record's asserted provenance is detectable against the approved license.
    evidence_hash: str


@dataclass(frozen=True)
class ExcludedRecord:
    upstream_identity: str
    reason: str


@dataclass(frozen=True)
class AttestationPlan:
    included: tuple[AttestedRecord, ...]
    excluded: tuple[ExcludedRecord, ...]

    @property
    def identities(self) -> frozenset[str]:
        return frozenset(r.upstream_identity for r in self.included)


@dataclass(frozen=True)
class AttestationPolicy:
    policy_version: int
    statement: str
    spdx_id: str
    assertion_kind: LicenseAssertionKind
    license_scope: LicenseScope
    source_kind: SourceKind
    include_source_kinds: frozenset[str]
    excluded_identities: dict[str, str]
    checksum: str

    @classmethod
    def load(cls, path: Path | None = None) -> "AttestationPolicy":
        resolved = path or default_policy_path()
        try:
            raw = resolved.read_text(encoding="utf-8")
        except OSError as exc:
            raise AttestationPolicyError(f"cannot read policy at {resolved}: {exc}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AttestationPolicyError(f"policy at {resolved} is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise AttestationPolicyError("policy root is not an object")
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AttestationPolicy":
        version = data.get("policy_version")
        if version != SUPPORTED_POLICY_VERSION:
            raise AttestationPolicyError(
                f"unsupported policy_version {version!r} (expected {SUPPORTED_POLICY_VERSION})"
            )

        statement = data.get("statement")
        if not isinstance(statement, str) or not statement.strip():
            raise AttestationPolicyError("policy statement is missing")

        spdx_id = data.get("spdx_id")
        # An approved assertion with no concrete SPDX id would satisfy the
        # publication-readiness check (it inspects only the decision) and make an
        # unnamed license publishable; repos.catalog.decide_license_assertion
        # rejects that too, but refusing here keeps the policy itself honest.
        if not isinstance(spdx_id, str) or not spdx_id.strip():
            raise AttestationPolicyError("policy must name a concrete spdx_id")

        include_raw = data.get("include_source_kinds")
        if not isinstance(include_raw, list) or not include_raw:
            raise AttestationPolicyError("policy must list include_source_kinds")
        if not all(isinstance(k, str) and k for k in include_raw):
            raise AttestationPolicyError("include_source_kinds must be non-empty strings")

        excluded_raw = data.get("excluded_identities", {})
        if not isinstance(excluded_raw, dict):
            raise AttestationPolicyError("excluded_identities must be an object")
        # A bare exclusion is unauditable: the reason is the whole point of
        # recording which records the owner declined to attest.
        if not all(isinstance(v, str) and v.strip() for v in excluded_raw.values()):
            raise AttestationPolicyError("every excluded identity needs a non-empty reason")

        try:
            assertion_kind = LicenseAssertionKind(data.get("assertion_kind"))
            license_scope = LicenseScope(data.get("license_scope"))
            source_kind = SourceKind(data.get("source_kind"))
        except ValueError as exc:
            raise AttestationPolicyError(f"policy enum value is invalid: {exc}") from exc

        return cls(
            policy_version=version,
            statement=statement.strip(),
            spdx_id=spdx_id.strip(),
            assertion_kind=assertion_kind,
            license_scope=license_scope,
            source_kind=source_kind,
            include_source_kinds=frozenset(include_raw),
            excluded_identities=dict(excluded_raw),
            checksum=_sha256_hex(canonicalize(data)),
        )

    def audit_meta(self) -> dict[str, Any]:
        """The attestation provenance stamped onto every audited row it touches."""
        return {
            "policy_version": self.policy_version,
            "policy_checksum": self.checksum,
            "statement": self.statement,
            "spdx_id": self.spdx_id,
        }

    def plan(self, records: dict[str, dict[str, Any]]) -> AttestationPlan:
        """Classify every manifest record; raise on anything unclassifiable.

        `records` maps upstream_identity -> the record's parsed `source` object
        (the already hash-verified manifest blob). Exclusions are checked before
        inclusions so naming an identity always overrides its source kind.
        """
        included: list[AttestedRecord] = []
        excluded: list[ExcludedRecord] = []
        unclassified: list[str] = []

        for identity in sorted(records):
            claim = records[identity] or {}
            if identity in self.excluded_identities:
                excluded.append(ExcludedRecord(identity, self.excluded_identities[identity]))
                continue
            kind = claim.get("kind")
            if not isinstance(kind, str) or kind not in self.include_source_kinds:
                unclassified.append(f"{identity} (source.kind={kind!r})")
                continue
            license_claim = claim.get("license")
            included.append(
                AttestedRecord(
                    upstream_identity=identity,
                    source_kind_claim=kind,
                    license_claim=license_claim if isinstance(license_claim, str) else None,
                    evidence_hash=_sha256_hex(canonicalize(claim)),
                )
            )

        if unclassified:
            raise UnclassifiedRecordError(
                "policy covers neither inclusion nor exclusion for: " + "; ".join(unclassified)
            )
        missing = sorted(set(self.excluded_identities) - set(records))
        if missing:
            # A stale exclusion means the policy is describing a corpus that no
            # longer exists; whoever regenerated the manifest must reconfirm.
            raise AttestationPolicyError(
                "excluded identities are absent from the manifest: " + ", ".join(missing)
            )
        return AttestationPlan(included=tuple(included), excluded=tuple(excluded))
