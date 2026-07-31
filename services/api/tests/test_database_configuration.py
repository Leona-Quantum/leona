import pathlib
from types import SimpleNamespace

import pytest

from majorana_api.db import (
    API_MAX_INSTANCES,
    DEFAULT_MAX_OVERFLOW,
    DEFAULT_POOL_SIZE,
    INSTANCE_CONNECTION_CEILING,
    OPERATIONAL_HEADROOM,
    SUPERUSER_RESERVED,
    WORKER_INSTANCES,
    WORKER_MAX_OVERFLOW,
    WORKER_POOL_SIZE,
    _application_name,
    _clear_query_timer,
    _pool_setting,
    _validate_application_url,
    fleet_peak_connections,
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


def test_the_whole_fleet_fits_under_the_instance_ceiling():
    """db-g1-small allows 50. The fleet must not be able to claim them all, or a
    deploy's migration step cannot connect and the deploy fails at the worst
    possible moment.

    This asserts the ACTUAL fleet — API maxScale plus the worker count — rather
    than a hardcoded process count. The old version of this test asserted
    `per_process * 3`, which stopped describing production the moment the worker
    count moved off one, and would have passed while the real total was 60.
    """
    peak = fleet_peak_connections()
    budget = INSTANCE_CONNECTION_CEILING - SUPERUSER_RESERVED - OPERATIONAL_HEADROOM
    assert peak <= budget, (
        f"the fleet can reach {peak} connections "
        f"({API_MAX_INSTANCES} api × {DEFAULT_POOL_SIZE}+{DEFAULT_MAX_OVERFLOW}, "
        f"{WORKER_INSTANCES} worker × {WORKER_POOL_SIZE}+{WORKER_MAX_OVERFLOW}) "
        f"but only {budget} of the instance's {INSTANCE_CONNECTION_CEILING} are available "
        f"after {SUPERUSER_RESERVED} superuser-reserved and {OPERATIONAL_HEADROOM} for "
        "a deploy's Alembic step and one operator"
    )


def test_where_the_worker_count_actually_runs_out(monkeypatch):
    """A positive control, and the answer to "can we add more?".

    A budget assertion that holds for every input is the same as no assertion.
    This pins the boundary instead: on today's constants six workers fit and
    seven do not. Change any term — the API's maxScale, either pool number, the
    instance tier — and this test moves, which is the point. It is also the
    honest answer to the next scaling question: today's four is not the ceiling,
    six is, and past that the tier has to grow rather than the count.
    """
    budget = INSTANCE_CONNECTION_CEILING - SUPERUSER_RESERVED - OPERATIONAL_HEADROOM
    api = API_MAX_INSTANCES * (DEFAULT_POOL_SIZE + DEFAULT_MAX_OVERFLOW)
    per_worker = WORKER_POOL_SIZE + WORKER_MAX_OVERFLOW

    def fits(workers: int) -> bool:
        return api + workers * per_worker <= budget

    assert fits(6), "six workers were expected to fit inside the budget"
    assert not fits(7), "seven workers were expected to exceed it"
    assert fits(WORKER_INSTANCES), "the deployed worker count must itself fit"


def test_the_worker_pool_is_sized_for_two_concurrent_sessions():
    """The worker holds the job handler and its lease heartbeat at once, and
    nothing else concurrently — see `_execute_with_heartbeat`. The pool proper
    must cover that without reaching for overflow, since overflow connections are
    opened and closed per use rather than kept.
    """
    assert WORKER_POOL_SIZE >= 2
    assert WORKER_MAX_OVERFLOW >= 1, "no slack at all turns one unexpected session into a stall"


def test_the_application_name_identifies_the_service(monkeypatch):
    """`pg_stat_activity.application_name` is how the runbook says to measure the
    pool before resizing it. Before this it was empty on every backend."""
    monkeypatch.setenv("MAJORANA_SERVICE", "worker")
    assert _application_name() == "majorana-worker"
    monkeypatch.setenv("MAJORANA_SERVICE", "api")
    assert _application_name() == "majorana-api"


def test_an_unlabelled_process_does_not_impersonate_a_service(monkeypatch):
    """Reading `majorana-api` off a backend that is actually something else is
    worse than reading nothing: the whole point is attribution."""
    monkeypatch.delenv("MAJORANA_SERVICE", raising=False)
    assert _application_name() == "majorana-unset"
    monkeypatch.setenv("MAJORANA_SERVICE", "   ")
    assert _application_name() == "majorana-unset"


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


def _deploy_workflow() -> str:
    root = pathlib.Path(__file__).resolve()
    for parent in root.parents:
        candidate = parent / ".github" / "workflows" / "deploy.yml"
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")
    pytest.skip("deploy.yml is not present in this checkout")


def test_the_deployed_worker_count_matches_the_budget_constant():
    """The budget above is arithmetic about a number that lives in a shell line
    in another file. Nothing but this test connects them.

    If `deploy.yml` says `--min-instances 6` while `db.py` still says four, every
    assertion in this module keeps passing and production quietly runs 1.5× the
    connections the budget was computed for.
    """
    workflow = _deploy_workflow()
    assert f"--min-instances {WORKER_INSTANCES} --max-instances {WORKER_INSTANCES}" in workflow, (
        f"deploy.yml does not deploy {WORKER_INSTANCES} workers; "
        "db.py's WORKER_INSTANCES and the worker deploy line have drifted apart"
    )
    assert f"--max-instances {API_MAX_INSTANCES} \\" in workflow, (
        f"deploy.yml does not pin the api at {API_MAX_INSTANCES} instances"
    )


def test_the_worker_pool_override_is_actually_deployed():
    """WORKER_POOL_SIZE is not a default — it only takes effect because
    deploy.yml sets DB_POOL_SIZE on the worker service. A rename or a dropped
    flag turns the worker back into a 5+5 process, silently, and four of those
    plus the api is 60 against a ceiling of 50."""
    workflow = _deploy_workflow()
    assert f"DB_POOL_SIZE={WORKER_POOL_SIZE}" in workflow
    assert f"DB_MAX_OVERFLOW={WORKER_MAX_OVERFLOW}" in workflow
    assert "MAJORANA_SERVICE=worker" in workflow
    assert "MAJORANA_SERVICE=api" in workflow


def test_the_worker_env_is_updated_never_replaced():
    """`--set-env-vars` replaces the whole environment. Neither service declares
    DATABASE_URL here — it is live-service state — so a --set on either deploy
    line ships a revision that cannot reach the database at all.

    Comment lines are excluded deliberately: the reason this flag is forbidden is
    written in a comment beside the deploy line, and a naive substring search
    over the whole file fails on the explanation of its own rule.
    """
    commands = [
        line
        for line in _deploy_workflow().splitlines()
        if not line.lstrip().startswith("#") and line.strip()
    ]
    offenders = [line.strip() for line in commands if "--set-env-vars" in line]
    assert not offenders, (
        "--set-env-vars replaces the entire container environment, including the "
        f"DATABASE_URL that neither deploy declares; use --update-env-vars: {offenders}"
    )


def test_clear_query_timer_removes_one_matching_timer_without_raising():
    connection = SimpleNamespace(info={"query_started_at": [1.0, 2.0]})

    _clear_query_timer(connection)
    _clear_query_timer(connection)
    _clear_query_timer(connection)

    assert connection.info["query_started_at"] == []
