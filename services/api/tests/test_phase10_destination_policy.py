from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.phase10_destination_policy import (
    ALLOWED_SOURCE_HOST,
    ALLOWED_SOURCE_PORT,
    MAX_DNS_ANSWERS,
    Phase10DestinationEvidence,
    Phase10DestinationPolicyError,
    validate_phase10_destination_answers,
)

RESOLVED = datetime(2026, 8, 3, 15, 0, 0, 123456, tzinfo=UTC)


def _evidence(
    *answers: str,
    host: str = ALLOWED_SOURCE_HOST,
    port: int = ALLOWED_SOURCE_PORT,
) -> Phase10DestinationEvidence:
    return validate_phase10_destination_answers(
        host=host,
        port=port,
        answers=tuple(answers) or ("140.82.113.6",),
        resolved_at=RESOLVED,
    )


def test_global_answers_are_canonicalized_sorted_and_short_lived():
    evidence = _evidence("2606:4700:4700:0:0:0:0:1111", "140.82.113.6")

    assert evidence.addresses == ("140.82.113.6", "2606:4700:4700::1111")
    assert evidence.resolved_at == "2026-08-03T15:00:00Z"
    assert evidence.valid_until == "2026-08-03T15:01:00Z"
    assert evidence.descriptor()["host"] == "api.github.com"


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "192.0.2.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "2001:db8::1",
    ],
)
def test_non_global_and_metadata_destinations_are_rejected(address: str):
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="non_global_destination_rejected",
    ):
        _evidence(address)


def test_one_unsafe_answer_rejects_the_entire_dns_set():
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="non_global_destination_rejected",
    ):
        _evidence("140.82.113.6", "127.0.0.1")


@pytest.mark.parametrize(
    "address, failure_code",
    [
        ("not-an-ip", "invalid_destination_address"),
        (" fe80::1", "invalid_destination_address"),
        ("fe80::1%en0", "ambiguous_destination_address"),
        ("[2606:4700:4700::1111]", "ambiguous_destination_address"),
        ("::ffff:140.82.113.6", "ipv4_mapped_destination_rejected"),
        ("2002:7f00:1::", "translated_destination_rejected"),
        ("64:ff9b::7f00:1", "translated_destination_rejected"),
    ],
)
def test_ambiguous_or_invalid_addresses_are_rejected(address: str, failure_code: str):
    with pytest.raises(Phase10DestinationPolicyError, match=failure_code):
        _evidence(address)


def test_fixed_host_and_port_cannot_be_overridden():
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="destination_host_not_allowed",
    ):
        _evidence("140.82.113.6", host="github.com")
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="destination_port_not_allowed",
    ):
        _evidence("140.82.113.6", port=80)


def test_empty_duplicate_and_excessive_answer_sets_are_rejected():
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="empty_destination_answers",
    ):
        validate_phase10_destination_answers(
            host=ALLOWED_SOURCE_HOST,
            port=ALLOWED_SOURCE_PORT,
            answers=(),
            resolved_at=RESOLVED,
        )
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="duplicate_destination_answer",
    ):
        _evidence("2606:4700:4700::1111", "2606:4700:4700:0:0:0:0:1111")
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="destination_answer_limit_exceeded",
    ):
        validate_phase10_destination_answers(
            host=ALLOWED_SOURCE_HOST,
            port=ALLOWED_SOURCE_PORT,
            answers=tuple(f"8.8.8.{index}" for index in range(1, MAX_DNS_ANSWERS + 2)),
            resolved_at=RESOLVED,
        )


def test_peer_must_match_a_pinned_answer_inside_the_validity_window():
    evidence = _evidence("140.82.113.6")
    assert (
        evidence.authorize_peer(
            "140.82.113.6",
            observed_at=RESOLVED + timedelta(seconds=30),
        )
        == "140.82.113.6"
    )

    with pytest.raises(
        Phase10DestinationPolicyError,
        match="destination_peer_not_pinned",
    ):
        evidence.authorize_peer(
            "140.82.113.7",
            observed_at=RESOLVED + timedelta(seconds=30),
        )
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="destination_resolution_expired",
    ):
        evidence.authorize_peer(
            "140.82.113.6",
            observed_at=RESOLVED + timedelta(seconds=61),
        )


def test_noncanonical_evidence_cannot_be_constructed_directly():
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="noncanonical_destination_answers",
    ):
        Phase10DestinationEvidence(
            host=ALLOWED_SOURCE_HOST,
            port=ALLOWED_SOURCE_PORT,
            addresses=("2606:4700:4700:0:0:0:0:1111",),
            resolved_at="2026-08-03T15:00:00Z",
            valid_until="2026-08-03T15:01:00Z",
        )


def test_naive_resolution_timestamp_is_rejected():
    with pytest.raises(
        Phase10DestinationPolicyError,
        match="invalid_destination_timestamp",
    ):
        validate_phase10_destination_answers(
            host=ALLOWED_SOURCE_HOST,
            port=ALLOWED_SOURCE_PORT,
            answers=("140.82.113.6",),
            resolved_at=datetime(2026, 8, 3, 15, 0, 0),
        )
