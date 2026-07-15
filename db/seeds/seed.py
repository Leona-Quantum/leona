"""Deterministic dev/CI seed dataset (04-database.md §4.3): 2 users, 2 workspaces,
20 artifacts (each with versions), 200 runs with event streams, verification
records, usage events, a few jobs and audit rows.

Fresh-DB only: refuses to run if `users` has rows. Usage:
    DATABASE_URL=... uv run python db/seeds/seed.py

Deterministic on purpose (fixed RNG seed + fixed clock base) so benchmark and
authz-suite fixtures are stable across Neon branches.
"""

import datetime as dt
import json
import os
import random
import sys
import uuid

import psycopg
from majorana_api.repos.system import insert_seed_artifact_version

RNG = random.Random(42)
BASE_TS = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
_clock_ms = 0

FAMILIES = ["VQE", "QAOA", "Grover", "Bell", "GHZ", "QFT", "QPE", "Simulation"]
FRAMEWORKS = ["qiskit", "pennylane", "cirq"]
EVENT_FLOW_OK = ["run.queued", "run.started", "stage.started", "stage.finished", "run.finished"]
EVENT_FLOW_FAIL = ["run.queued", "run.started", "stage.started", "run.error", "run.finished"]


def uuid7() -> uuid.UUID:
    """Deterministic UUIDv7: seeded RNG + monotonic fake clock."""
    global _clock_ms
    _clock_ms += RNG.randint(1, 900_000)  # up to ~15 min apart
    ts = int(BASE_TS.timestamp() * 1000) + _clock_ms
    rand_a = RNG.getrandbits(12)
    rand_b = RNG.getrandbits(62)
    value = (ts << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return uuid.UUID(int=value)


def ts_for(u: uuid.UUID) -> dt.datetime:
    """created_at consistent with the UUIDv7 timestamp."""
    return dt.datetime.fromtimestamp((u.int >> 80) / 1000, tz=dt.timezone.utc)


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("select count(*) from users")
        if cur.fetchone()[0]:
            sys.exit("seed refused: users table is not empty (seeds are fresh-DB only)")

        # --- users + workspaces + memberships -------------------------------
        users = [uuid7(), uuid7()]
        cur.executemany(
            "insert into users (id, workos_user_id, email, display_name, plan, created_at)"
            " values (%s, %s, %s, %s, %s, %s)",
            [
                (users[0], "user_seed_ada", "ada@example.dev", "Ada Seed", "pro", ts_for(users[0])),
                (users[1], "user_seed_bo", "bo@example.dev", "Bo Seed", "free", ts_for(users[1])),
            ],
        )
        ws_personal, ws_team = uuid7(), uuid7()
        cur.executemany(
            "insert into workspaces (id, kind, name, owner_user_id, plan, created_at)"
            " values (%s, %s, %s, %s, %s, %s)",
            [
                (ws_personal, "personal", "Ada's workspace", users[0], "pro", ts_for(ws_personal)),
                (ws_team, "team", "Seed Lab", users[1], "free", ts_for(ws_team)),
            ],
        )
        cur.executemany(
            "insert into memberships (workspace_id, user_id, role) values (%s, %s, %s)",
            [
                (ws_personal, users[0], "owner"),
                (ws_team, users[1], "owner"),
                (ws_team, users[0], "member"),
            ],
        )

        # --- 20 artifacts, 1-3 versions each ---------------------------------
        artifacts = []  # (artifact_id, workspace_id, [version_ids])
        for i in range(20):
            art_id = uuid7()
            ws = ws_personal if i % 2 == 0 else ws_team
            family = FAMILIES[i % len(FAMILIES)]
            framework = FRAMEWORKS[i % len(FRAMEWORKS)]
            cur.execute(
                "insert into artifacts (id, workspace_id, slug, title, family, framework,"
                " visibility, created_at) values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    art_id,
                    ws,
                    f"seed-{family.lower()}-{i:02d}",
                    f"{family} example {i:02d}",
                    family,
                    framework,
                    "public" if i % 5 == 0 else "private",
                    ts_for(art_id),
                ),
            )
            version_ids = []
            for seq in range(1, RNG.randint(1, 3) + 1):
                ver_id = uuid7()
                version_ids.append(ver_id)
                insert_seed_artifact_version(
                    cur,
                    version_id=ver_id,
                    artifact_id=art_id,
                    seq=seq,
                    qasm=(
                        f'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit q;\nrx({seq}.0) q;\n'
                        if seq % 2
                        else None
                    ),
                    code=f"# seed {family} v{seq}\nprint('seed')",
                    code_lang="python",
                    fallback_fingerprint=f"fp-{art_id.hex[:8]}-{seq}",
                    export_status="lossless" if seq % 2 else "lossy_with_reason",
                    resource_estimates=json.dumps(
                        {"depth": RNG.randint(3, 40), "gates": RNG.randint(5, 200)}
                    ),
                    created_at=ts_for(ver_id),
                )
            cur.execute(
                "update artifacts set current_version_id = %s where id = %s",
                (version_ids[-1], art_id),
            )
            artifacts.append((art_id, ws, version_ids))

        # --- 200 runs + events + verification + usage ------------------------
        for i in range(200):
            run_id = uuid7()
            ws = ws_personal if i % 2 == 0 else ws_team
            user = users[0] if ws == ws_personal or i % 3 == 0 else users[1]
            art = RNG.choice([a for a in artifacts if a[1] == ws])
            version_id = RNG.choice(art[2]) if i % 4 else None
            succeeded = i % 10 != 7  # ~10% failed
            status = "succeeded" if succeeded else "failed"
            framework = FRAMEWORKS[i % len(FRAMEWORKS)]
            created = ts_for(run_id)
            cur.execute(
                "insert into runs (id, workspace_id, user_id, conversation_id, artifact_version_id, task_prompt,"
                " mode, status, framework, seed, shots, timeout_s, sandbox_provider,"
                " sandbox_meta, verifier_decision, started_at, finished_at, created_at)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    run_id,
                    ws,
                    user,
                    run_id,
                    version_id,
                    f"Seed run {i:03d}: build a {FAMILIES[i % len(FAMILIES)]} circuit",
                    "execute" if i % 3 else "explain",
                    status,
                    framework,
                    RNG.randint(0, 2**31),
                    1024,
                    300,
                    "vercel-sandbox",
                    json.dumps(
                        {"duration_s": round(RNG.uniform(1, 90), 1), "exit": 0 if succeeded else 1}
                    ),
                    ("pass" if succeeded else "fail") if i % 4 else None,
                    created,
                    created + dt.timedelta(seconds=RNG.randint(5, 120)),
                    created,
                ),
            )
            flow = EVENT_FLOW_OK if succeeded else EVENT_FLOW_FAIL
            cur.executemany(
                "insert into run_events (id, run_id, seq, ts, type, payload)"
                " values (%s, %s, %s, %s, %s, %s)",
                [
                    (
                        uuid7(),
                        run_id,
                        seq,
                        created + dt.timedelta(seconds=seq),
                        etype,
                        json.dumps({"run_id": str(run_id), "seq": seq}),
                    )
                    for seq, etype in enumerate(flow, start=1)
                ],
            )
            if i % 4:
                cur.execute(
                    "insert into verification_records (id, run_id, method, params, result)"
                    " values (%s, %s, %s, %s, %s)",
                    (
                        uuid7(),
                        run_id,
                        RNG.choice(["exact", "statistical", "return_contract"]),
                        json.dumps({"tolerance": 0.01}),
                        "pass" if succeeded else "fail",
                    ),
                )
            cur.executemany(
                "insert into usage_events (id, workspace_id, user_id, kind, quantity, ts)"
                " values (%s, %s, %s, %s, %s, %s)",
                [
                    (uuid7(), ws, user, "run", 1, created),
                    (uuid7(), ws, user, "llm_tokens", RNG.randint(500, 20000), created),
                    (uuid7(), ws, user, "sandbox_seconds", RNG.randint(2, 120), created),
                ],
            )

        # --- a few jobs + audit rows -----------------------------------------
        cur.executemany(
            "insert into jobs (id, kind, payload, status, attempts) values (%s, %s, %s, %s, %s)",
            [
                (uuid7(), "run.execute", json.dumps({"seed": True}), "done", 1),
                (uuid7(), "run.execute", json.dumps({"seed": True}), "queued", 0),
                (uuid7(), "run.execute", json.dumps({"seed": True}), "dead", 5),
            ],
        )
        cur.executemany(
            "insert into audit_log (id, workspace_id, actor_user_id, action, target_kind, ip)"
            " values (%s, %s, %s, %s, %s, %s)",
            [
                (uuid7(), ws_team, users[1], "workspace.created", "workspace", "203.0.113.7"),
                (uuid7(), ws_team, users[1], "member.added", "user", "203.0.113.7"),
                (uuid7(), ws_personal, users[0], "workspace.created", "workspace", "203.0.113.9"),
            ],
        )

        conn.commit()

        for table in (
            "users",
            "workspaces",
            "artifacts",
            "artifact_versions",
            "runs",
            "run_events",
        ):
            cur.execute(f"select count(*) from {table}")  # noqa: S608 — fixed table names
            print(f"{table}: {cur.fetchone()[0]}")


if __name__ == "__main__":
    main()
