import pathlib
import re
from types import SimpleNamespace

import pytest

from majorana_api.db import (
    DEFAULT_MAX_OVERFLOW,
    DEFAULT_POOL_SIZE,
    _application_name,
    _clear_query_timer,
    _fleet_file,
    _pool_setting,
    _validate_application_url,
    fleet_peak_connections,
    fleet_sizing,
)

FLEET = fleet_sizing()

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
    """The instance allows 200 (`max_connections`, set explicitly on 2026-08-15
    with the move to db-custom-1-3840; it was 50 under db-g1-small). The fleet
    must not be able to claim them all, or a deploy's migration step cannot
    connect and the deploy fails at the worst possible moment.

    The ceiling is read from `infra/fleet.env`, so this test does not need
    editing when the tier moves again — only that file does.

    This asserts the ACTUAL fleet — API maxScale plus the worker count — rather
    than a hardcoded process count. The old version of this test asserted
    `per_process * 3`, which stopped describing production the moment the worker
    count moved off one, and would have passed while the real total was 60.
    """
    peak = fleet_peak_connections()
    budget = FLEET.connection_budget
    assert peak <= budget, (
        f"the fleet can reach {peak} connections "
        f"({FLEET.api_max_instances} api × {DEFAULT_POOL_SIZE}+{DEFAULT_MAX_OVERFLOW}, "
        f"{FLEET.worker_instances} worker × {FLEET.worker_pool_size}+{FLEET.worker_max_overflow}) "
        f"but only {budget} of the instance's {FLEET.instance_connection_ceiling} are available "
        f"after {FLEET.superuser_reserved} superuser-reserved and {FLEET.operational_headroom} for "
        "a deploy's Alembic step and one operator"
    )


def test_the_budget_survives_a_deploy_not_just_a_quiet_afternoon():
    """The rollout is the case that breaks, and the reason the count is capped.

    `--min-instances` is revision-level, so while a `gcloud run deploy` is in
    flight the outgoing revision is still in the traffic split and still holding
    its minimum: both revisions run their full complement at once. Sizing for the
    steady state passes every day and fails on the one operation that also needs
    a connection for Alembic.
    """
    budget = FLEET.connection_budget
    assert fleet_peak_connections(during_worker_rollout=True) <= budget
    assert fleet_peak_connections(during_worker_rollout=False) < fleet_peak_connections(
        during_worker_rollout=True
    ), "the rollout case must actually be the larger of the two, or it is not a check"


def test_where_the_worker_count_actually_runs_out():
    """A positive control, and the answer to "can we turn it up?".

    A budget assertion that holds for every input is the same as no assertion.
    So this finds the boundary and proves it is real: some worker count fits and
    the next one does not, ONCE the deploy-time doubling is counted.

    It used to hard-code "three fits, four does not", which was the boundary
    under db-g1-small's 50 connections. That stopped being true on 2026-08-15
    when the instance moved to db-custom-1-3840 with an explicit
    max_connections=200, and the hard-coded pair then failed for the right
    reason — the budget really had moved. Hard-coding it again would only queue
    up the same failure for the next tier change, and the docstring already
    claimed to pin the boundary "rather than today's setting". Now it does.

    What still holds regardless of the tier: the deployed count must fit, there
    must EXIST a count that does not fit (or the budget is not bounding
    anything), and the deployed count must sit at or below that boundary. It
    fails if someone raises WORKER_INSTANCES past what fits, so that edit is
    caught in CI rather than in production.

    Four workers is no longer blocked by the database. It was never blocked at
    rest — it was blocked by the deploy, because `--min-instances` is a
    REVISION-level floor that both revisions hold at once.
    """
    budget = FLEET.connection_budget

    def fits(workers: int) -> bool:
        return fleet_peak_connections(workers=workers) <= budget

    assert fits(FLEET.worker_instances), (
        f"infra/fleet.env deploys {FLEET.worker_instances} workers, which does not fit the budget"
    )

    # Walk up until it stops fitting. The cap is a runaway guard, not a claim
    # about plausible fleet sizes — if nothing in 1..512 exceeds the budget then
    # the budget is not bounding the worker count at all, which is the one thing
    # this test exists to rule out.
    boundary = next((n for n in range(1, 513) if not fits(n)), None)
    assert boundary is not None, (
        "no worker count up to 512 exceeded the connection budget — the budget "
        "is not bounding anything, so this check proves nothing"
    )
    assert fits(boundary - 1), (
        f"{boundary} workers is where the budget runs out, so {boundary - 1} must fit"
    )
    assert FLEET.worker_instances < boundary, (
        f"infra/fleet.env deploys {FLEET.worker_instances} workers but the budget "
        f"runs out at {boundary}"
    )


def test_the_worker_pool_is_sized_for_two_concurrent_sessions():
    """The worker holds the job handler and its lease heartbeat at once, and
    nothing else concurrently — see `_execute_with_heartbeat`. The pool proper
    must cover that without reaching for overflow, since overflow connections are
    opened and closed per use rather than kept.
    """
    assert FLEET.worker_pool_size >= 2
    assert FLEET.worker_max_overflow >= 1, (
        "no slack at all turns one unexpected session into a stall"
    )


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


def test_the_deploy_reads_the_sizing_from_the_same_file_the_budget_does():
    """The previous version of this test asserted the literal `--min-instances 3`
    against db.py's constant, because the number lived in two files and only a
    test connected them. It now lives in ONE file, infra/fleet.env, so what has
    to be asserted changed: not that the two copies agree, but that there is no
    second copy — that deploy.yml interpolates the variables rather than pasting
    a number beside them.

    A literal here would still deploy correctly today and drift the first time
    somebody edits fleet.env and pushes, which is exactly the operation the file
    exists to make safe.
    """
    workflow = _deploy_workflow()
    assert "infra/fleet.env" in workflow, "deploy.yml does not read the fleet sizing file at all"
    assert '--min-instances "$WORKER_INSTANCES" --max-instances "$WORKER_INSTANCES"' in workflow, (
        "the worker deploy line does not take its instance count from infra/fleet.env"
    )
    assert '--max-instances "$API_MAX_INSTANCES" \\' in workflow, (
        "the api deploy line does not take its instance count from infra/fleet.env"
    )
    scaling = re.findall(r"--(?:min|max)-instances +(\S+)", workflow)
    literals = [value for value in scaling if value.strip('"').isdigit()]
    assert not literals, (
        f"deploy.yml pins a scaling flag to a literal: {literals}. "
        "Every instance count comes from infra/fleet.env — see the 'load fleet sizing' step"
    )
    # The API's per-instance shape (infra/pin-api-cloud-run-shape, 2026-08-14):
    # same failure mode as the instance counts above, so the same assertion.
    assert (
        '--cpu "$API_CPU" --memory "${API_MEMORY_MI}Mi" --concurrency "$API_CONCURRENCY" \\'
        in workflow
    ), "the api deploy line does not take its CPU/memory/concurrency from infra/fleet.env"
    # `--cpu-boost` is the same class of pin and has no fleet.env key, because
    # it is a boolean and the loader takes KEY=INTEGER only. Asserted here so it
    # cannot be dropped back into live-service state: the API has no
    # min-instances, so it scales to zero and every burst starts cold.
    assert "--cpu-boost \\" in workflow, (
        "the api deploy no longer states --cpu-boost; startup-cpu-boost is live on the "
        "service and would go back to being state no file in this repo declares"
    )
    # `[^\s"]+` rather than `\S+`: this file's own prose writes "--cpu /
    # --memory / --concurrency" side by side in a comment, and a plain `\S+`
    # capture after `--concurrency` there would grab the next English word
    # ("are") as if it were a value. A real gcloud value always starts with a
    # digit ("2", "512Mi") or a variable ("$API_CPU"); no prose word does, so
    # that is the check — not "does this start with $", which is exactly what
    # broke on "are".
    shape = re.findall(r'--(?:cpu|memory|concurrency) +"?([^\s"]+)', workflow)
    shape_literals = [value for value in shape if re.match(r"^[0-9]", value)]
    assert not shape_literals, (
        f"deploy.yml pins a shape flag (cpu/memory/concurrency) to a literal: {shape_literals}. "
        "Every value comes from infra/fleet.env — see the 'load fleet sizing' step"
    )


def test_every_value_the_deploy_needs_survives_the_grep_that_exports_it():
    """The export is `grep -E '^[A-Z_]+=[0-9]+$' infra/fleet.env >> $GITHUB_ENV`.

    A key that does not match is not an error — grep simply does not print it,
    the variable stays unset, and the failure lands much later as
    `--min-instances ""` or `DB_POOL_SIZE=`, which gcloud reads as "clear this
    setting" and ships a revision nobody sized. Rename a key, add a trailing
    space, quote a value, and this is the test that notices.

    This reproduces the workflow's own regex against the real file rather than
    trusting that the two stayed in step.
    """
    workflow = _deploy_workflow()
    pattern = re.search(r"grep -E '(\^\[A-Z_\]\+=\[0-9\]\+\$)' infra/fleet\.env", workflow)
    assert pattern, "the 'load fleet sizing' step's export line is not shaped as expected"

    exported = {
        line.split("=", 1)[0]
        for line in _fleet_file().read_text(encoding="utf-8").splitlines()
        if re.fullmatch(r"[A-Z_]+=[0-9]+", line)
    }
    required = {
        "WORKER_INSTANCES",
        "WORKER_POOL_SIZE",
        "WORKER_MAX_OVERFLOW",
        "API_MAX_INSTANCES",
        "API_CPU",
        "API_MEMORY_MI",
        "API_CONCURRENCY",
    }
    assert required <= exported, (
        f"infra/fleet.env keys the deploy needs but the export regex would drop: "
        f"{sorted(required - exported)}"
    )
    # And the parser and the shell must agree about what the file contains.
    assert exported >= {
        "INSTANCE_CONNECTION_CEILING",
        "SUPERUSER_RESERVED",
        "OPERATIONAL_HEADROOM",
    }, "fleet_sizing() reads budget keys that the shell export would not see"


def test_the_worker_pool_override_is_actually_deployed():
    """The worker's pool size is not a default in code — it only takes effect
    because deploy.yml sets DB_POOL_SIZE on the worker service. A rename or a
    dropped flag turns the worker back into a 5+5 process, silently, and several
    of those plus the api is 60 against a ceiling of 50."""
    workflow = _deploy_workflow()
    assert "DB_POOL_SIZE=$WORKER_POOL_SIZE" in workflow
    assert "DB_MAX_OVERFLOW=$WORKER_MAX_OVERFLOW" in workflow
    assert "MAJORANA_SERVICE=worker" in workflow
    assert "MAJORANA_SERVICE=api" in workflow


def test_the_deploy_refuses_to_run_with_a_key_missing():
    """Belt to the grep's braces. The export step checks each key it needs before
    exporting anything, so a malformed fleet.env fails the deploy at the top
    rather than at `gcloud run deploy` with an empty flag.
    """
    workflow = _deploy_workflow()
    guard = re.search(r'grep -qE "\^\$\{key\}=\[0-9\]\+\$" infra/fleet\.env \|\|', workflow)
    assert guard, "the 'load fleet sizing' step no longer validates keys before exporting them"


def test_no_runtime_module_reads_the_fleet_file():
    """infra/ is NOT copied into the container image (services/api/Dockerfile
    copies services/, packages/py/, evals/harness/ and db/). `fleet_sizing()`
    therefore raises in production, which is correct — it is deploy-time
    configuration — but only for as long as nothing on a request path calls it.

    This is the guard. Tests and scripts may call it; nothing under a service's
    or package's `src/` may.
    """
    root = _fleet_file().parent.parent
    sources = [
        path
        for pattern in ("services/*/src/**/*.py", "packages/py/*/src/**/*.py")
        for path in root.glob(pattern)
    ]
    assert sources, "found no service sources to scan — the glob is wrong, not the code"

    offenders = [
        f"{path.relative_to(root)}:{number}"
        for path in sources
        if path.name != "db.py"
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        if "fleet_sizing(" in line or "fleet_peak_connections(" in line
    ]
    assert not offenders, (
        "deploy-time fleet sizing is read from a request path; infra/fleet.env is "
        f"not in the container image and this raises in production: {offenders}"
    )


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
