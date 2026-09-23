#!/usr/bin/env bash
# Build the environment `share-abuse.js` asserts against, run it, and keep the report.
#
# The §1a/§2 release-gate item this PR's own body flagged as owed: a k6 abuse run
# against `POST /v1/notebooks/shared/lookup` (ai-ops 349 option 2), a NEW ANONYMOUS
# ROUTE. Same shape as `run-abuse.sh`/`run-pat-abuse.sh` — local by construction,
# `BASE_URL` is not an argument, the real ceiling is read out of the source rather
# than restated — but a share link needs a real notebook and a real minted token,
# which no anonymous or shared-secret scenario in `abuse.js` provides. So this
# script also runs `mint_share_fixtures.py`, which mints those through the
# repository layer (never through WorkOS, never through the mint HTTP route)
# after the API is up and before k6 ever starts.
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
# same reasoning as run-abuse.sh's ANON_LIMIT and run-pat-abuse.sh's TOKEN_LIMIT:
# a copy of this number in a shell script is a second place for it to be wrong,
# and the failure would be invisible (the flood would simply never reach a
# ceiling that had quietly drifted, and every threshold would pass regardless of
# what the real default is).
ANON_LIMIT="$(python3 - <<'PY'
import re, pathlib, sys
src = pathlib.Path("services/api/src/majorana_api/rate_limit.py").read_text()
m = re.search(r"^DEFAULT_ANON_LIMIT\s*=\s*(\d+)", src, re.M)
if not m:
    sys.exit("could not read DEFAULT_ANON_LIMIT out of rate_limit.py")
print(m.group(1))
PY
)"
test -n "$ANON_LIMIT" || { echo "could not read DEFAULT_ANON_LIMIT"; exit 1; }
echo "anonymous ceiling under test: ${ANON_LIMIT}/min"

set -a; . ./.env.db.local; set +a

# --- its own database, for the reason run-abuse.sh's twin gives -----------
K6_DB="${K6_DB_NAME:-majorana_k6_share}"
export DATABASE_URL="$(python3 - "$DATABASE_URL" "$K6_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
url, name = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
print(urlunsplit(parts._replace(path=f"/{name}")))
PY
)"
export DATABASE_URL_DIRECT="$DATABASE_URL"

# No local `psql` client assumed — same reasoning as run-pat-abuse.sh: `psycopg`
# (already a dependency) reaches the maintenance connection without needing a
# local client binary or a hardcoded container name.
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

echo "harness database ${K6_DB}: rebuilding from empty"
admin_sql "DROP DATABASE IF EXISTS ${K6_DB} WITH (FORCE)"
admin_sql "CREATE DATABASE ${K6_DB}"
uv run --package majorana-api alembic -c db/alembic.ini upgrade head >/dev/null

# --- the service under test -------------------------------------------------
# Deliberately NOT `MAJORANA_LOCAL_DEV_AUTH=true` — same reasoning as
# run-pat-abuse.sh: nothing here presents a bearer token at all (the route is
# fully anonymous), so local-dev auth buys nothing and only adds a branch that
# could refuse something unexpectedly. A WorkOS-client-id-shaped-but-fake set
# of values lets `Settings.from_env()` construct without ever resolving against
# WorkOS for real.
export MAJORANA_ENV=development
export MAJORANA_SANDBOX=local
export WORKOS_CLIENT_ID=client_test
export WORKOS_JWT_ISSUER=https://test.invalid
export WORKOS_JWKS_URL=https://test.invalid/jwks
export WEB_ORIGIN="http://localhost:3000"

uv run --package majorana-api uvicorn --factory majorana_api.app:create_app \
  --host 127.0.0.1 --port 8002 --workers 1 --log-level warning \
  > "$OUT/share-api.log" 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8002/health 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:8002/health || {
  echo "API did not come up:"; tail -30 "$OUT/share-api.log"; exit 1
}

# The route reachable at all, read back before it is relied on — this feature
# ships with no off switch, so a 404 here would mean something else is wrong
# (routing, not the flag every sibling gate script checks for its own route).
probe_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d '{"token":"lq_shr_probe"}' \
  http://127.0.0.1:8002/v1/notebooks/shared/lookup)"
test "$probe_status" = "404" || {
  echo "POST /v1/notebooks/shared/lookup on a bogus token answered $probe_status, expected 404"
  exit 1
}
echo "the anonymous share-lookup route is live and reachable"

# --- fixtures: one notebook, four tokens, one sentinel ----------------------
TOKENS_FILE="$OUT/share-tokens.env"
rm -f "$TOKENS_FILE"
uv run --package majorana-api python bench/k6/mint_share_fixtures.py "$TOKENS_FILE"
test -f "$TOKENS_FILE" || { echo "mint_share_fixtures.py did not write $TOKENS_FILE"; exit 1; }
set -a; . "$TOKENS_FILE"; set +a
for name in VALID_TOKEN REVOKED_TOKEN EXPIRED_TOKEN RANDOM_TOKEN SENTINEL; do
  test -n "${!name:-}" || { echo "fixture $name is empty"; exit 1; }
done
echo "share-link fixtures minted (notebook + 4 tokens + sentinel)"

# The valid token, read back once before the flood relies on it — a 404 here
# means the fixture itself is broken, which the flood's own thresholds could
# not tell apart from "the route refuses everything".
valid_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d "{\"token\":\"$VALID_TOKEN\"}" \
  http://127.0.0.1:8002/v1/notebooks/shared/lookup)"
test "$valid_status" = "200" || {
  echo "VALID_TOKEN answered $valid_status, expected 200 — fixture is broken"
  exit 1
}
echo "VALID_TOKEN resolves cleanly against the running service"

# --- run ---------------------------------------------------------------------
set +e
BASE_URL=http://127.0.0.1:8002 \
ANON_LIMIT="$ANON_LIMIT" \
VALID_TOKEN="$VALID_TOKEN" \
REVOKED_TOKEN="$REVOKED_TOKEN" \
EXPIRED_TOKEN="$EXPIRED_TOKEN" \
RANDOM_TOKEN="$RANDOM_TOKEN" \
SENTINEL="$SENTINEL" \
k6 run --summary-export "$OUT/share-summary.json" bench/k6/share-abuse.js \
  2>&1 | tee "$OUT/share-k6.log"
status=${PIPESTATUS[0]}
set -e

echo
if [ "$status" -eq 0 ]; then
  echo "SHARE-LINK ABUSE SUITE PASSED — every threshold held. report: $OUT/share-summary.json"
else
  echo "SHARE-LINK ABUSE SUITE FAILED (k6 exit $status). thresholds and counters: $OUT/share-k6.log"
  echo "API log: $OUT/share-api.log"
fi
exit "$status"
