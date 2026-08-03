"""Pure least-privilege contract for a future Phase 10 fetcher deployment.

This module does not create a workload, grant IAM, resolve DNS, open a socket,
read a secret, upload source, update a job, or claim that a live deployment is
safe.  It only produces a canonical, reviewable plan for the identity and
network separation that a future provider-specific deployment must prove.
"""

from __future__ import annotations

import dataclasses
import hashlib
import ipaddress
import json
import re
from collections.abc import Mapping
from typing import Any

FETCHER_IDENTITY_PLAN_SCHEMA_VERSION = 1
FETCHER_IDENTITY_CONTRACT_VERSION = "phase10-s4-fetcher-identity-preflight/1"
FETCHER_DEPLOYMENT_CLASS = "isolated_acquisition_fetcher"
FETCHER_NETWORK_POLICY_CLASS = "explicit_egress_only"
FETCHER_CREDENTIAL_DELIVERY = "workload_identity_only"

SOURCE_HOST = "api.github.com"
TLS_PORT = 443

REQUIRED_CAPABILITIES = (
    "source_https_fetch",
    "quarantine_object_create",
    "acquisition_status_append",
)
REQUIRED_SEPARATION_ROLES = (
    "application",
    "executor",
    "publisher",
    "quarantine_verifier",
    "registry_signer",
)
REQUIRED_EGRESS_KINDS = (
    "source_https",
    "quarantine_write",
    "status_append",
)

_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_HOST_LABEL_RE = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")


class Phase10FetcherIdentityContractError(ValueError):
    """The proposed fetcher deployment is over-privileged or ambiguous."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class FetcherSeparatedIdentity:
    """Digest-only reference to a principal that must differ from the fetcher."""

    role: str
    principal_ref_sha256: str

    def descriptor(self) -> dict[str, str]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class FetcherEgressDestination:
    """One exact destination class; never a URL, wildcard, CIDR, or proxy."""

    kind: str
    host: str
    port: int

    def descriptor(self) -> dict[str, str | int]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class Phase10FetcherIdentityPlan:
    """Canonical expected deployment shape without credentials or cloud I/O."""

    fetcher_principal_ref_sha256: str
    separated_identities: tuple[FetcherSeparatedIdentity, ...]
    capabilities: tuple[str, ...]
    egress_destinations: tuple[FetcherEgressDestination, ...]
    secret_environment_names: tuple[str, ...] = ()
    mounted_control_paths: tuple[str, ...] = ()
    deployment_class: str = FETCHER_DEPLOYMENT_CLASS
    network_policy_class: str = FETCHER_NETWORK_POLICY_CLASS
    credential_delivery: str = FETCHER_CREDENTIAL_DELIVERY
    contract_version: str = FETCHER_IDENTITY_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_plan(self)

    def body(self) -> dict[str, Any]:
        return {
            "plan_schema_version": FETCHER_IDENTITY_PLAN_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "deployment_class": self.deployment_class,
            "network_policy_class": self.network_policy_class,
            "credential_delivery": self.credential_delivery,
            "fetcher_principal_ref_sha256": self.fetcher_principal_ref_sha256,
            "separated_identities": [
                identity.descriptor() for identity in self.separated_identities
            ],
            "capabilities": list(self.capabilities),
            "egress_destinations": [
                destination.descriptor() for destination in self.egress_destinations
            ],
            "secret_environment_names": list(self.secret_environment_names),
            "mounted_control_paths": list(self.mounted_control_paths),
        }

    @property
    def plan_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_plan(self) -> dict[str, Any]:
        return {**self.body(), "plan_sha256": self.plan_sha256}

    @classmethod
    def from_plan(cls, payload: dict[str, Any]) -> Phase10FetcherIdentityPlan:
        if not isinstance(payload, dict) or set(payload) != {
            "plan_schema_version",
            "contract_version",
            "deployment_class",
            "network_policy_class",
            "credential_delivery",
            "fetcher_principal_ref_sha256",
            "separated_identities",
            "capabilities",
            "egress_destinations",
            "secret_environment_names",
            "mounted_control_paths",
            "plan_sha256",
        }:
            raise Phase10FetcherIdentityContractError("invalid_fetcher_identity_plan")
        if payload["plan_schema_version"] != FETCHER_IDENTITY_PLAN_SCHEMA_VERSION:
            raise Phase10FetcherIdentityContractError("unsupported_fetcher_identity_plan_schema")
        raw_identities = payload["separated_identities"]
        raw_destinations = payload["egress_destinations"]
        raw_capabilities = payload["capabilities"]
        raw_secret_names = payload["secret_environment_names"]
        raw_mounts = payload["mounted_control_paths"]
        if (
            not isinstance(raw_identities, list)
            or not isinstance(raw_destinations, list)
            or not isinstance(raw_capabilities, list)
            or not isinstance(raw_secret_names, list)
            or not isinstance(raw_mounts, list)
        ):
            raise Phase10FetcherIdentityContractError("invalid_fetcher_identity_plan")
        plan = cls(
            fetcher_principal_ref_sha256=payload["fetcher_principal_ref_sha256"],
            separated_identities=tuple(
                _identity_from_descriptor(value) for value in raw_identities
            ),
            capabilities=tuple(raw_capabilities),
            egress_destinations=tuple(
                _destination_from_descriptor(value) for value in raw_destinations
            ),
            secret_environment_names=tuple(raw_secret_names),
            mounted_control_paths=tuple(raw_mounts),
            deployment_class=payload["deployment_class"],
            network_policy_class=payload["network_policy_class"],
            credential_delivery=payload["credential_delivery"],
            contract_version=payload["contract_version"],
        )
        claimed_digest = payload["plan_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10FetcherIdentityContractError("invalid_fetcher_identity_plan_digest")
        if claimed_digest != plan.plan_sha256:
            raise Phase10FetcherIdentityContractError("fetcher_identity_plan_digest_mismatch")
        return plan


def build_phase10_fetcher_identity_plan(
    *,
    fetcher_identity_ref: str,
    separated_identity_refs: Mapping[str, str],
    quarantine_host: str,
    status_host: str,
) -> Phase10FetcherIdentityPlan:
    """Build the expected least-privilege shape from non-secret references."""

    if not isinstance(separated_identity_refs, Mapping) or set(separated_identity_refs) != set(
        REQUIRED_SEPARATION_ROLES
    ):
        raise Phase10FetcherIdentityContractError("incomplete_identity_separation")
    fetcher_digest = _principal_ref_sha256(fetcher_identity_ref)
    identities = tuple(
        FetcherSeparatedIdentity(
            role=role,
            principal_ref_sha256=_principal_ref_sha256(separated_identity_refs[role]),
        )
        for role in REQUIRED_SEPARATION_ROLES
    )
    return Phase10FetcherIdentityPlan(
        fetcher_principal_ref_sha256=fetcher_digest,
        separated_identities=identities,
        capabilities=REQUIRED_CAPABILITIES,
        egress_destinations=(
            FetcherEgressDestination(
                kind="source_https",
                host=SOURCE_HOST,
                port=TLS_PORT,
            ),
            FetcherEgressDestination(
                kind="quarantine_write",
                host=_canonical_host(quarantine_host),
                port=TLS_PORT,
            ),
            FetcherEgressDestination(
                kind="status_append",
                host=_canonical_host(status_host),
                port=TLS_PORT,
            ),
        ),
    )


def _identity_from_descriptor(value: Any) -> FetcherSeparatedIdentity:
    if not isinstance(value, dict) or set(value) != {"role", "principal_ref_sha256"}:
        raise Phase10FetcherIdentityContractError("invalid_separated_identity")
    return FetcherSeparatedIdentity(
        role=value["role"],
        principal_ref_sha256=value["principal_ref_sha256"],
    )


def _destination_from_descriptor(value: Any) -> FetcherEgressDestination:
    if not isinstance(value, dict) or set(value) != {"kind", "host", "port"}:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_egress")
    return FetcherEgressDestination(
        kind=value["kind"],
        host=value["host"],
        port=value["port"],
    )


def _validate_plan(plan: Phase10FetcherIdentityPlan) -> None:
    if plan.contract_version != FETCHER_IDENTITY_CONTRACT_VERSION:
        raise Phase10FetcherIdentityContractError("unsupported_fetcher_identity_contract")
    if plan.deployment_class != FETCHER_DEPLOYMENT_CLASS:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_deployment_class")
    if plan.network_policy_class != FETCHER_NETWORK_POLICY_CLASS:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_network_policy")
    if plan.credential_delivery != FETCHER_CREDENTIAL_DELIVERY:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_credential_delivery")
    if not _is_sha256(plan.fetcher_principal_ref_sha256):
        raise Phase10FetcherIdentityContractError("invalid_fetcher_identity")
    if plan.capabilities != REQUIRED_CAPABILITIES:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_capabilities")
    if plan.secret_environment_names:
        raise Phase10FetcherIdentityContractError("fetcher_secret_environment_denied")
    if plan.mounted_control_paths:
        raise Phase10FetcherIdentityContractError("fetcher_control_mount_denied")
    _validate_identity_separation(plan)
    _validate_egress(plan.egress_destinations)


def _validate_identity_separation(plan: Phase10FetcherIdentityPlan) -> None:
    if (
        not isinstance(plan.separated_identities, tuple)
        or any(
            not isinstance(identity, FetcherSeparatedIdentity)
            for identity in plan.separated_identities
        )
        or tuple(identity.role for identity in plan.separated_identities)
        != REQUIRED_SEPARATION_ROLES
    ):
        raise Phase10FetcherIdentityContractError("incomplete_identity_separation")
    digests = [plan.fetcher_principal_ref_sha256]
    for identity in plan.separated_identities:
        if not _is_sha256(identity.principal_ref_sha256):
            raise Phase10FetcherIdentityContractError("invalid_separated_identity")
        digests.append(identity.principal_ref_sha256)
    if len(digests) != len(set(digests)):
        raise Phase10FetcherIdentityContractError("fetcher_identity_alias_denied")


def _validate_egress(destinations: tuple[FetcherEgressDestination, ...]) -> None:
    if (
        not isinstance(destinations, tuple)
        or any(
            not isinstance(destination, FetcherEgressDestination) for destination in destinations
        )
        or tuple(destination.kind for destination in destinations) != REQUIRED_EGRESS_KINDS
    ):
        raise Phase10FetcherIdentityContractError("invalid_fetcher_egress")
    canonical_hosts: list[str] = []
    for destination in destinations:
        if (
            not isinstance(destination.port, int)
            or isinstance(destination.port, bool)
            or destination.port != TLS_PORT
            or destination.host != _canonical_host(destination.host)
        ):
            raise Phase10FetcherIdentityContractError("invalid_fetcher_egress")
        canonical_hosts.append(destination.host)
    if destinations[0].host != SOURCE_HOST:
        raise Phase10FetcherIdentityContractError("invalid_source_egress")
    if len(canonical_hosts) != len(set(canonical_hosts)):
        raise Phase10FetcherIdentityContractError("ambiguous_fetcher_egress")


def _principal_ref_sha256(value: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or not value
        or len(value) > 512
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise Phase10FetcherIdentityContractError("invalid_principal_reference")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_host(value: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or value != value.lower()
        or not value
        or len(value) > 253
        or value.endswith(".")
        or "*" in value
        or "://" in value
        or "/" in value
        or ":" in value
    ):
        raise Phase10FetcherIdentityContractError("invalid_fetcher_egress_host")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        pass
    else:
        raise Phase10FetcherIdentityContractError("invalid_fetcher_egress_host")
    labels = value.split(".")
    if (
        len(labels) < 2
        or all(label.isdigit() for label in labels)
        or any(_HOST_LABEL_RE.fullmatch(label) is None for label in labels)
    ):
        raise Phase10FetcherIdentityContractError("invalid_fetcher_egress_host")
    return value


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None
