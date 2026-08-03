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
    # claimed* at attestation time. This is the governing hash for carry-forward
    # (see `grant_carries_forward`) — the grant is about the record's identity
    # and provenance, so a change here is a change to the thing that was signed.
    claim_hash: str
    # sha256 over the claim *and* a digest of the record's content. Recorded on
    # the audit row so it names the exact bytes the grant was made over, not just
    # the provenance sub-object. Owner decision B, 2026-08-04: without this, the
    # audit trail says a human approved "this record" while being unable to
    # distinguish any two revisions of its code — the 156 content fixes leave the
    # `source` object untouched, so a claim-only hash is identical across them.
    evidence_hash: str

    def grant_carries_forward(self, previous_claim_hash: str | None) -> bool:
        """May a prior human grant bind to this record's new version unattended?

        Owner decision B (2026-08-04): yes, when the *provenance claim* is
        unchanged. The attestation's own sentence grants "original first-party
        work ... reference implementations, scaffolds, and explanatory metadata",
        which is a statement about where a record comes from, not about each byte
        revision of it. Editing Leona-authored scaffold does not change who
        authored it or what it cites, so re-collecting a signature for that would
        be a rubber stamp — and a rubber stamp on every content session teaches
        people to sign without reading.

        It stops being defensible the moment a record's origin is third-party,
        which is exactly what a changed claim indicates. So a changed claim
        refuses and falls back to option A: a human re-attests (`--attested-by`).

        `previous_claim_hash` of None means no prior grant exists, which is not a
        carry-forward at all — it needs a first signature.
        """
        return previous_claim_hash is not None and previous_claim_hash == self.claim_hash


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

    def plan(
        self,
        records: dict[str, dict[str, Any]],
        content_digests: dict[str, str] | None = None,
    ) -> AttestationPlan:
        """Classify every manifest record; raise on anything unclassifiable.

        `records` maps upstream_identity -> the record's parsed `source` object
        (the already hash-verified manifest blob). Exclusions are checked before
        inclusions so naming an identity always overrides its source kind.

        `content_digests` maps the same identities to a digest of the record's
        *content* — `source_blob_sha256` from the manifest, which the manifest
        loader has already verified against the bytes it handed back. It widens
        `evidence_hash` so the audit row names the bytes, not just the claim.
        Optional because the claim-only form is what the tests of the
        classification rules need, and because an older manifest has no digest to
        offer; when it is absent the two hashes coincide and the audit row is
        exactly as informative as it was before.
        """
        included: list[AttestedRecord] = []
        excluded: list[ExcludedRecord] = []
        unclassified: list[str] = []
        digests = content_digests or {}

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
            claim_hash = _sha256_hex(canonicalize(claim))
            content_digest = digests.get(identity)
            included.append(
                AttestedRecord(
                    upstream_identity=identity,
                    source_kind_claim=kind,
                    license_claim=license_claim if isinstance(license_claim, str) else None,
                    claim_hash=claim_hash,
                    evidence_hash=(
                        _sha256_hex(f"{claim_hash}:{content_digest}")
                        if content_digest
                        else claim_hash
                    ),
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
