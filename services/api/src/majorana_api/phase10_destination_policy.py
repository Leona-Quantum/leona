"""Offline destination policy for a future Phase 10 acquisition connector.

The module classifies already-resolved DNS answers and later checks that an
observed peer is one of those short-lived, approved answers. It performs no DNS
lookup or network connection. A future transport must still bind the approved
IP to the TLS connection while retaining ``api.github.com`` for SNI and
certificate/Host validation.
"""

from __future__ import annotations

import dataclasses
import ipaddress
from datetime import UTC, datetime, timedelta

ALLOWED_SOURCE_HOST = "api.github.com"
ALLOWED_SOURCE_PORT = 443
MAX_DNS_ANSWERS = 16
MAX_RESOLUTION_AGE_SECONDS = 60
DESTINATION_POLICY_VERSION = "phase10-s2-destination/1"

_IPV6_TRANSLATION_NETWORKS = (
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
)


class Phase10DestinationPolicyError(ValueError):
    """A destination or peer observation is not safe under the S2 policy."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10DestinationEvidence:
    """Short-lived normalized A/AAAA answer set approved before connection."""

    host: str
    port: int
    addresses: tuple[str, ...]
    resolved_at: str
    valid_until: str
    policy_version: str = DESTINATION_POLICY_VERSION

    def __post_init__(self) -> None:
        if self.host != ALLOWED_SOURCE_HOST:
            raise Phase10DestinationPolicyError("destination_host_not_allowed")
        if (
            not isinstance(self.port, int)
            or isinstance(self.port, bool)
            or self.port != ALLOWED_SOURCE_PORT
        ):
            raise Phase10DestinationPolicyError("destination_port_not_allowed")
        if self.policy_version != DESTINATION_POLICY_VERSION:
            raise Phase10DestinationPolicyError("unsupported_destination_policy")
        normalized = _validate_answers(self.addresses)
        if normalized != self.addresses:
            raise Phase10DestinationPolicyError("noncanonical_destination_answers")
        resolved = _parse_timestamp(self.resolved_at)
        valid_until = _parse_timestamp(self.valid_until)
        if valid_until != resolved + timedelta(seconds=MAX_RESOLUTION_AGE_SECONDS):
            raise Phase10DestinationPolicyError("invalid_destination_validity_window")

    def authorize_peer(self, peer_address: str, *, observed_at: datetime) -> str:
        """Return the canonical peer only when it matches an unexpired answer."""

        peer = _normalize_global_address(peer_address)
        observed = _aware_utc(observed_at)
        resolved = _parse_timestamp(self.resolved_at)
        valid_until = _parse_timestamp(self.valid_until)
        if observed < resolved:
            raise Phase10DestinationPolicyError("destination_observation_before_resolution")
        if observed > valid_until:
            raise Phase10DestinationPolicyError("destination_resolution_expired")
        if peer not in self.addresses:
            raise Phase10DestinationPolicyError("destination_peer_not_pinned")
        return peer

    def descriptor(self) -> dict[str, str | int | list[str]]:
        return {
            "host": self.host,
            "port": self.port,
            "addresses": list(self.addresses),
            "resolved_at": self.resolved_at,
            "valid_until": self.valid_until,
            "policy_version": self.policy_version,
        }


def validate_phase10_destination_answers(
    *,
    host: str,
    port: int,
    answers: tuple[str, ...],
    resolved_at: datetime,
) -> Phase10DestinationEvidence:
    """Fail closed unless every A/AAAA answer is globally routable and bounded."""

    if host != ALLOWED_SOURCE_HOST:
        raise Phase10DestinationPolicyError("destination_host_not_allowed")
    if not isinstance(port, int) or isinstance(port, bool) or port != ALLOWED_SOURCE_PORT:
        raise Phase10DestinationPolicyError("destination_port_not_allowed")
    normalized = _validate_answers(answers)
    resolved = _aware_utc(resolved_at).replace(microsecond=0)
    return Phase10DestinationEvidence(
        host=host,
        port=port,
        addresses=normalized,
        resolved_at=_format_timestamp(resolved),
        valid_until=_format_timestamp(resolved + timedelta(seconds=MAX_RESOLUTION_AGE_SECONDS)),
    )


def _validate_answers(answers: tuple[str, ...]) -> tuple[str, ...]:
    if not isinstance(answers, tuple):
        raise Phase10DestinationPolicyError("invalid_destination_answers")
    if not answers:
        raise Phase10DestinationPolicyError("empty_destination_answers")
    if len(answers) > MAX_DNS_ANSWERS:
        raise Phase10DestinationPolicyError("destination_answer_limit_exceeded")
    normalized = tuple(_normalize_global_address(answer) for answer in answers)
    if len(normalized) != len(set(normalized)):
        raise Phase10DestinationPolicyError("duplicate_destination_answer")
    return tuple(sorted(normalized, key=_address_sort_key))


def _normalize_global_address(value: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise Phase10DestinationPolicyError("invalid_destination_address")
    if "%" in value or value.startswith("[") or value.endswith("]"):
        raise Phase10DestinationPolicyError("ambiguous_destination_address")
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise Phase10DestinationPolicyError("invalid_destination_address") from exc
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        raise Phase10DestinationPolicyError("ipv4_mapped_destination_rejected")
    if isinstance(address, ipaddress.IPv6Address) and (
        address.sixtofour is not None
        or address.teredo is not None
        or any(address in network for network in _IPV6_TRANSLATION_NETWORKS)
    ):
        raise Phase10DestinationPolicyError("translated_destination_rejected")
    # ``is_global`` alone is intentionally insufficient: Python 3.12 reports
    # multicast addresses as global. Spell out every forbidden destination
    # class so an interpreter-version semantic difference cannot open SSRF.
    if (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        or not address.is_global
    ):
        raise Phase10DestinationPolicyError("non_global_destination_rejected")
    return address.compressed


def _address_sort_key(value: str) -> tuple[int, bytes]:
    address = ipaddress.ip_address(value)
    return (address.version, address.packed)


def _aware_utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Phase10DestinationPolicyError("invalid_destination_timestamp")
    return value.astimezone(UTC)


def _format_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise Phase10DestinationPolicyError("invalid_destination_timestamp")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise Phase10DestinationPolicyError("invalid_destination_timestamp") from exc
    if _format_timestamp(parsed) != value:
        raise Phase10DestinationPolicyError("invalid_destination_timestamp")
    return parsed
