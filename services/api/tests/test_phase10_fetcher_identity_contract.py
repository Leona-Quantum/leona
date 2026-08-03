from __future__ import annotations

import copy
import hashlib
import json

import pytest

from majorana_api.phase10_fetcher_identity_contract import (
    FETCHER_CREDENTIAL_DELIVERY,
    FETCHER_DEPLOYMENT_CLASS,
    FETCHER_NETWORK_POLICY_CLASS,
    REQUIRED_CAPABILITIES,
    REQUIRED_SEPARATION_ROLES,
    Phase10FetcherIdentityContractError,
    Phase10FetcherIdentityPlan,
    build_phase10_fetcher_identity_plan,
)


def _identity_refs() -> dict[str, str]:
    return {role: f"principal://phase10/{role}" for role in REQUIRED_SEPARATION_ROLES}


def _plan() -> Phase10FetcherIdentityPlan:
    return build_phase10_fetcher_identity_plan(
        fetcher_identity_ref="principal://phase10/fetcher",
        separated_identity_refs=_identity_refs(),
        quarantine_host="quarantine.example.test",
        status_host="status.example.test",
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "plan_sha256"}
    payload["plan_sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def test_plan_is_digest_only_least_privilege_and_round_trips():
    plan = _plan()
    payload = plan.to_plan()
    serialized = json.dumps(payload)

    assert plan.deployment_class == FETCHER_DEPLOYMENT_CLASS
    assert plan.network_policy_class == FETCHER_NETWORK_POLICY_CLASS
    assert plan.credential_delivery == FETCHER_CREDENTIAL_DELIVERY
    assert plan.capabilities == REQUIRED_CAPABILITIES
    assert plan.secret_environment_names == ()
    assert plan.mounted_control_paths == ()
    assert [item.host for item in plan.egress_destinations] == [
        "api.github.com",
        "quarantine.example.test",
        "status.example.test",
    ]
    assert "principal://" not in serialized
    assert "password" not in serialized.lower()
    assert "database" not in serialized.lower()
    assert Phase10FetcherIdentityPlan.from_plan(payload).to_plan() == payload


def test_every_sensitive_role_must_have_a_distinct_principal():
    refs = _identity_refs()
    refs["publisher"] = "principal://phase10/fetcher"

    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="fetcher_identity_alias_denied",
    ):
        build_phase10_fetcher_identity_plan(
            fetcher_identity_ref="principal://phase10/fetcher",
            separated_identity_refs=refs,
            quarantine_host="quarantine.example.test",
            status_host="status.example.test",
        )

    refs = _identity_refs()
    refs.pop("publisher")
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="incomplete_identity_separation",
    ):
        build_phase10_fetcher_identity_plan(
            fetcher_identity_ref="principal://phase10/fetcher",
            separated_identity_refs=refs,
            quarantine_host="quarantine.example.test",
            status_host="status.example.test",
        )


@pytest.mark.parametrize(
    "host",
    [
        "https://quarantine.example.test",
        "*.example.test",
        "127.0.0.1",
        "999.999.999.999",
        "[::1]",
        "Quarantine.example.test",
        "quarantine.example.test/path",
        "localhost",
    ],
)
def test_wildcard_url_ip_and_noncanonical_egress_hosts_are_denied(host):
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="invalid_fetcher_egress_host",
    ):
        build_phase10_fetcher_identity_plan(
            fetcher_identity_ref="principal://phase10/fetcher",
            separated_identity_refs=_identity_refs(),
            quarantine_host=host,
            status_host="status.example.test",
        )


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        (
            "capabilities",
            [*REQUIRED_CAPABILITIES, "database_read"],
            "invalid_fetcher_capabilities",
        ),
        (
            "secret_environment_names",
            ["DATABASE_URL"],
            "fetcher_secret_environment_denied",
        ),
        (
            "mounted_control_paths",
            ["/var/run/docker.sock"],
            "fetcher_control_mount_denied",
        ),
        (
            "credential_delivery",
            "environment_secret",
            "invalid_fetcher_credential_delivery",
        ),
    ],
)
def test_self_consistent_privilege_escalation_is_denied(field, value, failure):
    payload = _plan().to_plan()
    payload[field] = value
    _rehash(payload)

    with pytest.raises(Phase10FetcherIdentityContractError, match=failure):
        Phase10FetcherIdentityPlan.from_plan(payload)


def test_source_destination_and_destination_classes_are_fixed():
    payload = _plan().to_plan()
    payload["egress_destinations"][0]["host"] = "github.com"
    _rehash(payload)
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="invalid_source_egress",
    ):
        Phase10FetcherIdentityPlan.from_plan(payload)

    payload = _plan().to_plan()
    payload["egress_destinations"][2]["kind"] = "arbitrary_https"
    _rehash(payload)
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="invalid_fetcher_egress",
    ):
        Phase10FetcherIdentityPlan.from_plan(payload)

    payload = _plan().to_plan()
    payload["egress_destinations"][2]["host"] = "quarantine.example.test"
    _rehash(payload)
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="ambiguous_fetcher_egress",
    ):
        Phase10FetcherIdentityPlan.from_plan(payload)


def test_unknown_fields_versions_and_outer_digest_tampering_fail_closed():
    payload = _plan().to_plan()
    with_unknown = copy.deepcopy(payload)
    with_unknown["github_write_token"] = "secret"
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="invalid_fetcher_identity_plan",
    ):
        Phase10FetcherIdentityPlan.from_plan(with_unknown)

    payload["contract_version"] = "phase10-s4-fetcher-identity-preflight/2"
    _rehash(payload)
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="unsupported_fetcher_identity_contract",
    ):
        Phase10FetcherIdentityPlan.from_plan(payload)

    payload = _plan().to_plan()
    payload["fetcher_principal_ref_sha256"] = "f" * 64
    with pytest.raises(
        Phase10FetcherIdentityContractError,
        match="fetcher_identity_plan_digest_mismatch",
    ):
        Phase10FetcherIdentityPlan.from_plan(payload)
