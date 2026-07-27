from types import SimpleNamespace

import pytest

from majorana_api.db import (
    DEFAULT_MAX_OVERFLOW,
    DEFAULT_POOL_SIZE,
    _clear_query_timer,
    _pool_setting,
    _validate_application_url,
)

CLOUD_SQL_URL = (
    "postgresql+psycopg://app:secret@/majorana?host=/cloudsql/majorana-core:us-west1:majorana-pg"
)


def test_the_cloud_sql_socket_url_is_accepted(monkeypatch):
    """The shape production actually runs: no host, socket path in the query."""
    monkeypatch.setenv("MAJORANA_ENV", "production")
    _validate_application_url(CLOUD_SQL_URL)


def test_a_deployed_url_still_pointing_at_neon_is_refused(monkeypatch):
    """Production left Neon on 2026-07-27. A stale secret that still CONNECTS is
    the worst outcome available — two live databases, both taking writes."""
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(RuntimeError, match="points at Neon"):
        _validate_application_url(
            "postgresql://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/neondb"
        )


def test_the_neon_refusal_does_not_care_whether_it_was_pooled(monkeypatch):
    """Pooled or direct is no longer the question — being Neon at all is."""
    monkeypatch.setenv("MAJORANA_ENV", "production")
    with pytest.raises(RuntimeError, match="points at Neon"):
        _validate_application_url(
            "postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb"
        )


def test_a_local_developer_may_still_point_anywhere(monkeypatch):
    """The guard is about deployed environments; `development` is not one."""
    monkeypatch.setenv("MAJORANA_ENV", "development")
    _validate_application_url("postgresql://postgres:postgres@localhost:5432/majorana")
    _validate_application_url("postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb")


def test_a_plain_postgres_host_is_accepted(monkeypatch):
    """CI runs against a Postgres container, in a production-like MAJORANA_ENV."""
    monkeypatch.setenv("MAJORANA_ENV", "production")
    _validate_application_url("postgresql://pg:pg@localhost:5432/majorana_migrations")


def test_the_pool_ceiling_fits_the_instance(monkeypatch):
    """db-g1-small allows 50 connections. Two API instances plus one worker must
    not be able to claim them all, or a deploy's migration step cannot connect.
    """
    per_process = DEFAULT_POOL_SIZE + DEFAULT_MAX_OVERFLOW
    assert per_process * 3 <= 40, (
        f"{per_process} connections × 3 processes leaves too little of the 50-connection "
        "ceiling for migrations and operator access"
    )


def test_pool_settings_come_from_the_environment_when_set(monkeypatch):
    monkeypatch.setenv("DB_POOL_SIZE", "2")
    assert _pool_setting("DB_POOL_SIZE", DEFAULT_POOL_SIZE) == 2


def test_an_unset_or_empty_pool_setting_falls_back(monkeypatch):
    monkeypatch.delenv("DB_POOL_SIZE", raising=False)
    assert _pool_setting("DB_POOL_SIZE", DEFAULT_POOL_SIZE) == DEFAULT_POOL_SIZE
    monkeypatch.setenv("DB_POOL_SIZE", "")
    assert _pool_setting("DB_POOL_SIZE", DEFAULT_POOL_SIZE) == DEFAULT_POOL_SIZE


def test_a_negative_pool_setting_is_refused(monkeypatch):
    monkeypatch.setenv("DB_POOL_SIZE", "-1")
    with pytest.raises(RuntimeError, match="must not be negative"):
        _pool_setting("DB_POOL_SIZE", DEFAULT_POOL_SIZE)


def test_clear_query_timer_removes_one_matching_timer_without_raising():
    connection = SimpleNamespace(info={"query_started_at": [1.0, 2.0]})

    _clear_query_timer(connection)
    _clear_query_timer(connection)
    _clear_query_timer(connection)

    assert connection.info["query_started_at"] == []
