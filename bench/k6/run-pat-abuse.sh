#!/usr/bin/env bash
# Build the environment `pat-abuse.js` asserts against, run it, and keep the report.
#
# The §2 release-gate item PR 973 left owed before `LEONA_PERSONAL_ACCESS_TOKENS`
# could be switched on: a k6 abuse run against the per-token ceiling. Same shape as
# `run-abuse.sh` — local by construction, `BASE_URL` is not an argument, the real
# ceiling is read out of the source rather than restated — but a personal access
# token needs a real user and workspace to belong to, which no anonymous or
# shared-secret scenario in `abuse.js` does. So this script also runs
# `mint_pat_fixtures.py`, which mints six tokens through the repository layer
# (never through WorkOS — nothing here signs anyone in) after the API is up and
# before k6 ever starts.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO="$PWD"
OUT="${OUT_DIR:-$REPO/bench/k6/out}"
mkdir -p "$OUT"

command -v k6 >/dev/null || { echo "k6 is not installed (brew install k6)"; exit 1; }
test -f .env.db.local || {
  echo "no .env.db.local — see docs/runbooks/auth-dev.md § The local database"
  exit 1
}

# The real production default, read from the source rather than restated here —
# same reasoning as run-abuse.sh's ANON_LIMIT: a copy of this number in a shell
# script is a second place for it to be wrong, and the failure would be invisible
# (the flood would simply never reach a ceiling that had quietly drifted, and every
# threshold would pass regardless of what the real default is).
TOKEN_LIMIT="$(python3 - <<'PY'
import re, pathlib, sys
src = pathlib.Path("services/api/src/majorana_api/rate_limit.py").read_text()
m = re.search(r"^DEFAULT_TOKEN_LIMIT\s*=\s*(\d+)", src, re.M)
if not m:
    sys.exit("could not read DEFAULT_TOKEN_LIMIT out of rate_limit.py")
print(m.group(1))
PY
)"
test -n "$TOKEN_LIMIT" || { echo "could not read DEFAULT_TOKEN_LIMIT"; exit 1; }
echo "per-token ceiling under test: ${TOKEN_LIMIT}/min"

set -a; . ./.env.db.local; set +a

# --- its own database, for the reason run-abuse.sh's twin gives -----------
# A database another suite already provisioned holds identities and rows this
# harness does not expect; `majorana_k6_pat` is this harness's alone.
K6_DB="${K6_DB_NAME:-majorana_k6_pat}"
export DATABASE_URL="$(python3 - "$DATABASE_URL" "$K6_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
url, name = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
print(urlunsplit(parts._replace(path=f"/{name}")))
PY
)"
export DATABASE_URL_DIRECT="$DATABASE_URL"

# No local `psql` client on this machine (checked, not assumed — the first version
# of this script shelled out to it and failed at the first `docker exec`-free
# invocation). `psycopg`, the driver `db.py` already depends on, reaches the same
# maintenance connection without needing either a local client binary or a
# hardcoded container name — this harness does not know or need to know that its
# Postgres is a Docker container at all.
admin_sql() {
  DATABASE_URL="$DATABASE_URL" uv run --package majorana-api python3 - "$1" <<'PY'
import os, sys
import psycopg
from urllib.parse import urlsplit
url = urlsplit(os.environ["DATABASE_URL"])
with psycopg.connect(
    host=url.hostname, port=url.port or 5432,
    user=url.username, password=url.password, dbname="postgres", autocommit=True,
) as conn:
    conn.execute(sys.argv[1])
PY
}

# ALWAYS rebuilt from empty — same reasoning run-abuse.sh's comment gives for the
# catalog database: one code path, always correct, and a database that failed
# mid-run cannot be half-reused.
echo "harness database ${K6_DB}: rebuilding from empty"
admin_sql "DROP DATABASE IF EXISTS ${K6_DB} WITH (FORCE)"
admin_sql "CREATE DATABASE ${K6_DB}"
uv run --package majorana-api alembic -c db/alembic.ini upgrade head >/dev/null

# --- the service under test -------------------------------------------------
# Deliberately NOT `MAJORANA_LOCAL_DEV_AUTH=true`, unlike run-abuse.sh's twin.
# `get_verified_token`'s local-dev branch is checked FIRST and unconditionally
# refuses any bearer that is not byte-for-byte the one local-dev token — before
# the `lq_pat_` prefix is ever looked at. Every scenario here presents a real
# personal access token, so turning local-dev auth on would 401 all six of them
# on "invalid local development token", which is exactly what the first version
# of this script did (every request, every scenario, the same misleading 401).
#
# Instead: a WorkOS client id shaped like the live test suite's own
# (`SETTINGS_KWARGS` in test_personal_access_tokens_live.py) — non-WorkOS-shaped
# issuer/JWKS values, so `_validate_workos_client_consistency` has nothing to
# compare and does not require them to agree with anything real. Nothing here
# ever presents a WorkOS session JWT, so these values are never actually
# resolved against WorkOS; they only have to let `Settings.from_env()` construct.
#
# What is switched on is the thing under test: LEONA_PERSONAL_ACCESS_TOKENS=true.
# TOKEN_RATE_LIMIT_PER_MINUTE is deliberately NOT set, so the service runs at its
# real default — the number this run reads out of rate_limit.py above and
# nowhere lowers.
export MAJORANA_ENV=development
export MAJORANA_SANDBOX=local
export WORKOS_CLIENT_ID=client_test
export WORKOS_JWT_ISSUER=https://test.invalid
export WORKOS_JWKS_URL=https://test.invalid/jwks
export WEB_ORIGIN="http://localhost:3000"
export LEONA_PERSONAL_ACCESS_TOKENS=true

uv run --package majorana-api uvicorn --factory majorana_api.app:create_app \
  --host 127.0.0.1 --port 8001 --workers 1 --log-level warning \
  > "$OUT/pat-api.log" 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8001/health 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:8001/health || {
  echo "API did not come up:"; tail -30 "$OUT/pat-api.log"; exit 1
}

# The switch, read back before it is relied on. If this were still off every
# scenario below would fail on 401s that name no cause other than "invalid
# token", which is indistinguishable from a bad fixture without this line.
probe_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/v1/tokens)"
test "$probe_status" != "404" || {
  echo "GET /v1/tokens is 404 — LEONA_PERSONAL_ACCESS_TOKENS did not take effect"
  exit 1
}
echo "personal access tokens are switched on against the running service"

# --- fixtures: six tokens, minted through the repository layer -------------
TOKENS_FILE="$OUT/pat-tokens.env"
rm -f "$TOKENS_FILE"
uv run --package majorana-api python bench/k6/mint_pat_fixtures.py "$TOKENS_FILE"
test -f "$TOKENS_FILE" || { echo "mint_pat_fixtures.py did not write $TOKENS_FILE"; exit 1; }
set -a; . "$TOKENS_FILE"; set +a
for name in FLOOD_TOKEN SECOND_TOKEN REVOKED_TOKEN EXPIRED_TOKEN READONLY_TOKEN RUNSCOPE_TOKEN; do
  test -n "${!name:-}" || { echo "fixture $name is empty"; exit 1; }
done
echo "six personal access tokens minted"

# --- run ---------------------------------------------------------------------
set +e
BASE_URL=http://127.0.0.1:8001 \
TOKEN_LIMIT="$TOKEN_LIMIT" \
FLOOD_TOKEN="$FLOOD_TOKEN" \
SECOND_TOKEN="$SECOND_TOKEN" \
REVOKED_TOKEN="$REVOKED_TOKEN" \
EXPIRED_TOKEN="$EXPIRED_TOKEN" \
READONLY_TOKEN="$READONLY_TOKEN" \
RUNSCOPE_TOKEN="$RUNSCOPE_TOKEN" \
k6 run --summary-export "$OUT/pat-summary.json" bench/k6/pat-abuse.js \
  2>&1 | tee "$OUT/pat-k6.log"
status=${PIPESTATUS[0]}
set -e

echo
if [ "$status" -eq 0 ]; then
  echo "PAT ABUSE SUITE PASSED — every threshold held. report: $OUT/pat-summary.json"
else
  echo "PAT ABUSE SUITE FAILED (k6 exit $status). thresholds and counters: $OUT/pat-k6.log"
  echo "API log: $OUT/pat-api.log"
fi
exit "$status"
