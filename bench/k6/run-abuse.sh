#!/usr/bin/env bash
# Build the environment `abuse.js` asserts against, run it, and keep the report.
#
# ## Local by default, and that is a decision rather than a convenience
#
# The scenarios here deliberately exceed the API's admission ceilings — that is
# what "abuse scenario" means in 05-security.md §2. Pointing them at a shared or
# production service would be a self-inflicted denial of service on a per-IP
# limiter whose failure mode is *silently serving stale data*. So this builds a
# throwaway API against a local Postgres, and BASE_URL is not an argument.
#
# ## Why the account is new every run
#
# The quota scenario asserts EXACTLY five admissions, which is only true against
# an account whose weekly allowance is untouched. A cleanup step would work until
# the day it half-worked, and a re-run that quietly measured a partly-spent
# account would report zero admissions and read as a broken lock. Instead the
# local-dev identity gets a fresh id and address each run, so the account is new
# by construction and there is no state to reset.
#
# The address must NOT be `local-dev@majorana.test`: that one is in
# OPERATOR_IDENTITIES and is not metered at all, so the scenario would submit
# forty runs, have all forty admitted, and report a quota gate that does not
# exist.
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

# The real production ceiling, read from the source rather than restated here.
# A copy of this number in a shell script is a second place for it to be wrong,
# and the failure would be invisible: the flood would simply never reach the
# limit and every threshold would pass.
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

# --- its own database, for the reason ci.yml gives ------------------------
# The catalog authority is provisioned with a deterministic uuid AND the fixed
# `workos_user_id='system:catalog-importer'`. Any database that another suite has
# already provisioned holds that identity under a different uuid, so this one's
# `ON CONFLICT (id)` misses and the users_workos_user_id_key UNIQUE fires
# instead. That is not hypothetical — running the API test tree against the
# development database is enough to cause it, and the error names a unique
# constraint rather than the collision, so it reads like a bug in the importer.
#
# ci.yml solves it with a database per concern (majorana_authz, majorana_live).
# Same here: `majorana_k6` is this harness's, and nothing else writes it.
K6_DB="${K6_DB_NAME:-majorana_k6}"
export DATABASE_URL="$(python3 - "$DATABASE_URL" "$K6_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
url, name = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
print(urlunsplit(parts._replace(path=f"/{name}")))
PY
)"
export DATABASE_URL_DIRECT="$DATABASE_URL"

PGPW="$(python3 -c '
import sys, urllib.parse
print(urllib.parse.urlsplit(sys.argv[1]).password or "")' "$DATABASE_URL")"
psql_admin() {
  docker exec -e PGPASSWORD="$PGPW" majorana-pg \
    psql -h 127.0.0.1 -U postgres -d postgres -tAc "$1"
}

# `CREATE DATABASE` cannot run inside the transaction SQLAlchemy opens and has
# no IF NOT EXISTS, so it goes through psql and tolerates already-exists rather
# than testing for it — the test would race a concurrent invocation and the
# tolerate does not.
psql_admin "CREATE DATABASE ${K6_DB}" >/dev/null 2>&1 || true

STAMP="$(date +%s)"
export MAJORANA_ENV=development
export MAJORANA_LOCAL_DEV_AUTH=true
export MAJORANA_SANDBOX=local
export MAJORANA_LOCAL_DEV_TOKEN="k6-abuse-${STAMP}"
export MAJORANA_LOCAL_DEV_USER_ID="k6-abuse-${STAMP}"
export MAJORANA_LOCAL_DEV_EMAIL="k6-abuse-${STAMP}@k6.majorana.test"
export WEB_ORIGIN="http://localhost:3000"

# 32 chars minimum, enforced by settings.py. Generated per run: a token in a
# committed script is a token that ends up in a deployment.
TRUSTED_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
export TRUSTED_CALLER_TOKEN="$TRUSTED_TOKEN"

# --- the catalog the readers actually read --------------------------------
# Without this the routes 404 before touching Postgres, and `sustained_readers`
# would measure an empty middleware chain rather than 120 people reading a
# 283-record catalog. Idempotent, so a second invocation skips the import.
export SYSTEM_CATALOG_ENABLED=true
export SYSTEM_CATALOG_WORKSPACE_ID="${SYSTEM_CATALOG_WORKSPACE_ID:-11111111-1111-4111-8111-111111111111}"
export SYSTEM_CATALOG_IMPORTER_USER_ID="${SYSTEM_CATALOG_IMPORTER_USER_ID:-22222222-2222-4222-8222-222222222222}"
export SYSTEM_CATALOG_PUBLIC_READER_USER_ID="${SYSTEM_CATALOG_PUBLIC_READER_USER_ID:-33333333-3333-4333-8333-333333333333}"

admin() { uv run --package majorana-api python -m majorana_api.catalog_admin "$@"; }

# A fully-published catalog is reused; ANYTHING else is rebuilt from empty.
#
# The middle states are the trap and they are easy to reach: `provision` refuses
# outright once artifacts exist ("Step 2 requires an empty system catalog"), so a
# run that imported and then failed before publishing leaves a database that can
# neither be reused nor re-provisioned. Branching per partial state would be a
# growing tree of cases nobody re-tests. Dropping is one case, always correct,
# and costs a minute on a throwaway database whose only content is a manifest
# committed to this repository.
published="$(psql_admin "select 1 from pg_database where datname='${K6_DB}'" >/dev/null 2>&1 &&
  docker exec -e PGPASSWORD="$PGPW" majorana-pg psql -h 127.0.0.1 -U postgres -d "$K6_DB" -tAc \
    "select count(*) from catalog_entries where published_at is not null" 2>/dev/null || echo 0)"
published="$(printf '%s' "${published:-0}" | tr -dc '0-9')"

NEEDS_CATALOG=0
if [ "${published:-0}" -ge 1 ]; then
  echo "harness database ${K6_DB}: reusing ${published} published entries"
  uv run --package majorana-api alembic -c db/alembic.ini upgrade head >/dev/null
else
  echo "harness database ${K6_DB}: rebuilding from empty"
  # FORCE so an idle connection left by a previous run cannot block the drop.
  psql_admin "DROP DATABASE IF EXISTS ${K6_DB} WITH (FORCE)" >/dev/null
  psql_admin "CREATE DATABASE ${K6_DB}" >/dev/null
  uv run --package majorana-api alembic -c db/alembic.ini upgrade head >/dev/null
  NEEDS_CATALOG=1
  echo "provisioning and importing the catalog (~1 min)"
  admin provision >/dev/null
  admin bootstrap-import | tail -1
fi

# --- the service under test ------------------------------------------------
# ONE worker, deliberately. The limiter is an in-process fixed window, so two
# workers halve the effective ceiling per process and the flood's arithmetic
# stops meaning anything. Production runs multiple Cloud Run instances and has
# the same property — rate_limit.py says so — which is why the ceiling is set
# far above legitimate use rather than tuned to be exact.
uv run --package majorana-api uvicorn --factory majorana_api.app:create_app \
  --host 127.0.0.1 --port 8000 --workers 1 --log-level warning \
  > "$OUT/api.log" 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8000/health 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:8000/health || {
  echo "API did not come up:"; tail -30 "$OUT/api.log"; exit 1
}

# Provision the k6 account before the storm. /v1/me is what creates the user row
# and its personal workspace; doing it inside the scenario would mean the first
# few of forty concurrent submissions were racing account creation rather than
# the allowance lock, which is a different race and not the one under test.
me_status="$(curl -sS -o "$OUT/me.json" -w '%{http_code}' \
  -H "Authorization: Bearer ${MAJORANA_LOCAL_DEV_TOKEN}" http://127.0.0.1:8000/v1/me)"
test "$me_status" = "200" || { echo "/v1/me returned $me_status"; cat "$OUT/me.json"; exit 1; }

# The tier this service resolved for the k6 account, asserted rather than
# assumed. `local-dev@majorana.test` is in OPERATOR_IDENTITIES and is NOT
# metered, so an account that came out unmetered would have all forty
# submissions admitted and quota_storm would report a quota gate that does not
# exist. This is the single line that stops the whole scenario being decorative.
tier="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["tier"])' "$OUT/me.json")"
test "$tier" = "free" || {
  echo "the k6 account resolved to tier '$tier', expected 'free'"
  echo "an unmetered identity makes quota_storm vacuous — check MAJORANA_LOCAL_DEV_EMAIL"
  exit 1
}
echo "k6 account provisioned on the metered free tier"

# Attestation and publication happen HERE, after the account exists, because
# `--attested-by` must be a real human account — `attest-bootstrap` refuses the
# importer and public-reader service identities outright. That is ADR-0016's
# separation, not an inconvenience: the importer stages content and a named
# person approves it. The k6 account is the named person for this throwaway
# database, and it is created by /v1/me above, which is why the import (slow,
# identity-free) runs before the API starts and these two run after.
if [ "$NEEDS_CATALOG" = "1" ]; then
  attester="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["user_id"])' "$OUT/me.json")"
  test -n "$attester" || { echo "could not read the attester id out of /v1/me"; exit 1; }
  admin attest-bootstrap  --attested-by "$attester" | tail -1
  admin publish-bootstrap --attested-by "$attester" | tail -1
fi

entries="$(curl -sS "http://127.0.0.1:8000/v1/catalog/entries?limit=1&view=list" \
  -o /dev/null -w '%header{x-catalog-total}')"
test "${entries:-0}" -gt 0 || {
  echo "the catalog serves ${entries:-0} entries — the soak would measure an empty read"
  exit 1
}
echo "catalog serving ${entries} entries"

# The exemption, read back before it is relied on. If this says `anonymous` the
# trusted_renderer thresholds would fail 18 seconds later with no explanation;
# failing here names the cause.
verdict="$(curl -sSI "http://127.0.0.1:8000/v1/catalog/entries?limit=1&view=list" \
  -H "X-Majorana-Trusted-Caller: ${TRUSTED_TOKEN}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="x-majorana-caller-trust"{print $2}')"
test "$verdict" = "trusted" || {
  echo "the trusted-caller header read '$verdict', expected 'trusted'"
  echo "this API build may predate the exemption; abuse.js would fail opaquely"
  exit 1
}
echo "trusted-caller exemption verified against the running service"

# --- run -------------------------------------------------------------------
set +e
BASE_URL=http://127.0.0.1:8000 \
API_TOKEN="$MAJORANA_LOCAL_DEV_TOKEN" \
TRUSTED_TOKEN="$TRUSTED_TOKEN" \
ANON_LIMIT="$ANON_LIMIT" \
k6 run --summary-export "$OUT/summary.json" bench/k6/abuse.js \
  2>&1 | tee "$OUT/k6.log"
status=${PIPESTATUS[0]}
set -e

echo
if [ "$status" -eq 0 ]; then
  echo "ABUSE SUITE PASSED — every threshold held. report: $OUT/summary.json"
else
  echo "ABUSE SUITE FAILED (k6 exit $status). thresholds and counters: $OUT/k6.log"
  echo "API log: $OUT/api.log"
fi
exit "$status"
