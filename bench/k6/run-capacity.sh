#!/usr/bin/env bash
# Run one bounded 100-user capacity profile and record a JSON result.
#
# The wrapper is local-only by default. It never starts a service, runs a
# migration, drops a database, or changes Cloud Run. Non-local targets need an
# explicit operator acknowledgement, and production-like hostnames need a
# second acknowledgement. Write profiles need a separate acknowledgement so a
# typo cannot create runs in a shared environment.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO="$PWD"

VALIDATE_ONLY=0
if [[ "${1:-}" == "--validate-only" ]]; then
  VALIDATE_ONLY=1
  shift
fi

if [[ "$#" -gt 1 ]]; then
  echo "usage: $0 [--validate-only] [read_100|sse_100|submit_100|mixed_100]" >&2
  exit 2
fi

CAPACITY_SCENARIO="${1:-${CAPACITY_SCENARIO:-read_100}}"
case "$CAPACITY_SCENARIO" in
  read_100|sse_100|submit_100|mixed_100) ;;
  *)
    echo "unknown capacity scenario: $CAPACITY_SCENARIO" >&2
    exit 2
    ;;
esac
export CAPACITY_SCENARIO

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
BASE_URL="${BASE_URL%/}"
export BASE_URL

USER_COUNT="${CAPACITY_USER_COUNT:-100}"
MAX_DURATION="${CAPACITY_MAX_DURATION:-60s}"
REQUEST_TIMEOUT="${CAPACITY_REQUEST_TIMEOUT:-15s}"
SSE_TIMEOUT="${CAPACITY_SSE_TIMEOUT:-15s}"
READ_LIMIT="${CAPACITY_READ_LIMIT:-100}"
# A floor of 1 means the profile passes against a catalogue holding one record,
# printing "CAPACITY SUITE PASSED" while measuring essentially nothing. That is
# not hypothetical: the local stack is stood up by hand and a half-finished
# import leaves exactly that state. The published corpus is 369; anything much
# below it means the run is not measuring the product.
MIN_CATALOG_ENTRIES="${CAPACITY_MIN_CATALOG_ENTRIES:-300}"
READ_P95_MS="${CAPACITY_READ_P95_MS:-10000}"
SUBMIT_P95_MS="${CAPACITY_SUBMIT_P95_MS:-10000}"
MIX_READ_PERCENT="${CAPACITY_MIX_READ_PERCENT:-70}"
MIX_SSE_PERCENT="${CAPACITY_MIX_SSE_PERCENT:-20}"
MIX_SUBMIT_PERCENT="${CAPACITY_MIX_SUBMIT_PERCENT:-10}"
export USER_COUNT MAX_DURATION REQUEST_TIMEOUT SSE_TIMEOUT READ_LIMIT MIN_CATALOG_ENTRIES
export READ_P95_MS SUBMIT_P95_MS MIX_READ_PERCENT MIX_SSE_PERCENT MIX_SUBMIT_PERCENT

# THE SAME NUMBERS UNDER THE NAMES k6 ACTUALLY READS.
#
# The block above exports the un-prefixed names, which are what this script and
# the config.json writer use. capacity.js reads none of them: every constant in
# it is `__ENV.CAPACITY_<NAME>`. So a default resolved here never reached the
# load generator at all — k6 silently fell back to its own copy of each default,
# and `config.json` recorded the value that was NOT applied.
#
# Harmless while the two sides' defaults happened to match, and they mostly did.
# The exception is the one that matters: the catalogue floor was raised to 300
# here and capacity.js still defaults it to 1, so a result file has been
# claiming a floor of 300 over a run that would have accepted a single record.
#
# Re-exporting the RESOLVED value keeps operator-set variables winning — they
# were the default in each expansion above — while making the recorded config
# and the enforced config the same numbers by construction.
export CAPACITY_USER_COUNT="$USER_COUNT"
export CAPACITY_MAX_DURATION="$MAX_DURATION"
export CAPACITY_REQUEST_TIMEOUT="$REQUEST_TIMEOUT"
export CAPACITY_SSE_TIMEOUT="$SSE_TIMEOUT"
export CAPACITY_READ_LIMIT="$READ_LIMIT"
export CAPACITY_MIN_CATALOG_ENTRIES="$MIN_CATALOG_ENTRIES"
export CAPACITY_READ_P95_MS="$READ_P95_MS"
export CAPACITY_SUBMIT_P95_MS="$SUBMIT_P95_MS"
export CAPACITY_MIX_READ_PERCENT="$MIX_READ_PERCENT"
export CAPACITY_MIX_SSE_PERCENT="$MIX_SSE_PERCENT"
export CAPACITY_MIX_SUBMIT_PERCENT="$MIX_SUBMIT_PERCENT"

validate_target() {
  python3 - "$BASE_URL" <<'PY'
import os
import sys
from urllib.parse import urlsplit

value = sys.argv[1]
parsed = urlsplit(value)
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit("BASE_URL must be an absolute http(s) URL")
if parsed.query or parsed.fragment:
    raise SystemExit("BASE_URL must not contain a query or fragment")
if parsed.username or parsed.password:
    raise SystemExit("BASE_URL must not contain embedded credentials")

host = (parsed.hostname or "").lower()
local = host in {"localhost", "127.0.0.1", "::1"}
if not local:
    if not (
        os.environ.get("CAPACITY_ALLOW_NONLOCAL_TARGET") == "1"
        and os.environ.get("CAPACITY_NONLOCAL_TARGET_APPROVAL")
        == "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION"
    ):
        raise SystemExit(
            "refusing non-local BASE_URL; set CAPACITY_ALLOW_NONLOCAL_TARGET=1 and "
            "CAPACITY_NONLOCAL_TARGET_APPROVAL=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION "
            "only for an approved isolated target"
        )

# What production actually IS, rather than a hostname somebody expected it to
# have. `api.leonaquantum.com` was the only name in this set and it does not
# resolve — nothing has ever served from it — while the real API is
# `majorana-api-<hash>-uw.a.run.app`, which contains no "prod" token either. So
# every clause of this guard missed the one host it exists to protect, and a
# `BASE_URL` pointing straight at the production API needed only the non-local
# acknowledgement, not the production one.
#
# The suffix rule is the load-bearing part: a `*.run.app` host is by definition
# a deployed Cloud Run service and can never be an isolated local target,
# whatever it is called. The site's own domains are listed because a capacity
# profile aimed at the web app hits the same database through the renderer.
# The prod/production token stays as a catch-all for a name nobody has thought
# of yet.
PRODUCTION_HOSTS = {"leonaqt.com", "leonaquantum.com"}
PRODUCTION_SUFFIXES = (".run.app", ".leonaqt.com", ".leonaquantum.com")
production_like = (
    host in PRODUCTION_HOSTS
    or host.endswith(PRODUCTION_SUFFIXES)
    or any(part in {"prod", "production"} for part in host.replace(".", "-").split("-"))
)
if production_like and not (
    os.environ.get("CAPACITY_ALLOW_PRODUCTION") == "1"
    and os.environ.get("CAPACITY_PRODUCTION_TARGET_APPROVAL")
    == "I_UNDERSTAND_THIS_CAN_AFFECT_PRODUCTION"
):
    raise SystemExit(
        "refusing a production-like BASE_URL; use an isolated local or staging target"
    )
PY
}

validate_write_scope() {
  case "$CAPACITY_SCENARIO" in
    submit_100|mixed_100)
      if [[ "${CAPACITY_ALLOW_WRITES:-}" != "1" || \
        "${CAPACITY_WRITE_APPROVAL:-}" != "I_UNDERSTAND_THIS_CREATES_TEST_RUNS" ]]; then
        echo "${CAPACITY_SCENARIO} creates test runs and requires explicit write approval" >&2
        exit 2
      fi
      ;;
    sse_100)
      if [[ -z "${CAPACITY_SSE_RUN_ID:-}" && \
        ( "${CAPACITY_ALLOW_WRITES:-}" != "1" || \
          "${CAPACITY_WRITE_APPROVAL:-}" != "I_UNDERSTAND_THIS_CREATES_TEST_RUNS" ) ]]; then
        echo "sse_100 needs CAPACITY_SSE_RUN_ID or explicit approval to create a seed run" >&2
        exit 2
      fi
      ;;
  esac
}

validate_target
validate_write_scope

if [[ "$CAPACITY_SCENARIO" != "read_100" && -z "${API_TOKEN:-}" ]]; then
  echo "API_TOKEN is required for ${CAPACITY_SCENARIO}" >&2
  exit 2
fi

if [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  echo "capacity configuration valid: ${CAPACITY_SCENARIO} -> ${BASE_URL}"
  exit 0
fi

# k6 emits only the trend statistics it is told to. The default set stops at
# p95, so every result.json this harness has ever written is silently missing
# p99 — the number anyone reading a capacity report asks for second.
export K6_SUMMARY_TREND_STATS="${K6_SUMMARY_TREND_STATS:-min,avg,med,p(90),p(95),p(99),max}"

K6_BIN="${K6_BIN:-k6}"
command -v "$K6_BIN" >/dev/null || {
  echo "k6 is not installed (brew install k6)" >&2
  exit 1
}
command -v curl >/dev/null || {
  echo "curl is required for the health preflight" >&2
  exit 1
}
K6_VERSION="$("$K6_BIN" version 2>/dev/null | sed -n '1p')"
K6_VERSION="${K6_VERSION:-unknown}"
export K6_VERSION

curl -fsS --max-time 10 -o /dev/null "${BASE_URL}/health" || {
  echo "API health preflight failed for ${BASE_URL}" >&2
  exit 1
}

# How big the catalog this run measured actually was.
#
# The floor above says the run cleared 300 records. It does not say it ran
# against 369, and the two read identically in a result file. Recording the
# observed total and naming it beside the verdict is what stops a latency figure
# being quoted without the corpus it was measured on — which is the same failure
# the floor was raised to prevent, one step further along.
#
# Read here rather than inferred from the k6 summary: k6 has no metric for it,
# and a preflight that only throws below the floor tells you nothing about a run
# that cleared it.
OBSERVED_CATALOG_ENTRIES="$(
  curl -fsS --max-time 10 -D - -o /dev/null \
    "${BASE_URL}/v1/catalog/entries?limit=1&offset=0&view=list" 2>/dev/null \
    | tr -d '\r' \
    | awk 'tolower($1) == "x-catalog-total:" { print $2; exit }'
)"
OBSERVED_CATALOG_ENTRIES="${OBSERVED_CATALOG_ENTRIES:-unknown}"
export OBSERVED_CATALOG_ENTRIES

OUT_ROOT="${OUT_DIR:-$REPO/bench/k6/out/capacity}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${OUT_ROOT%/}/${CAPACITY_SCENARIO}-${STAMP}-$$"
mkdir -p "$RUN_DIR"

GIT_REVISION="$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
export GIT_REVISION

python3 - "$RUN_DIR/config.json" "$BASE_URL" "$CAPACITY_SCENARIO" "$GIT_REVISION" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

output, base_url, scenario, revision = sys.argv[1:]
config = {
    "schema_version": 1,
    "scenario": scenario,
    "base_url": base_url,
    "git_revision": revision,
    "k6_version": os.environ["K6_VERSION"],
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "vus": int(os.environ["USER_COUNT"]),
    "iterations_per_vu": 1,
    "max_duration": os.environ["MAX_DURATION"],
    "request_timeout": os.environ["REQUEST_TIMEOUT"],
    "sse_timeout": os.environ["SSE_TIMEOUT"],
    "read_limit": int(os.environ["READ_LIMIT"]),
    "min_catalog_entries": int(os.environ["MIN_CATALOG_ENTRIES"]),
    # The corpus the run actually measured, not the floor it had to clear. A
    # latency figure quoted without this is a figure about an unknown catalog.
    "observed_catalog_entries": (
        int(os.environ["OBSERVED_CATALOG_ENTRIES"])
        if os.environ.get("OBSERVED_CATALOG_ENTRIES", "unknown").isdigit()
        else None
    ),
    "thresholds": {
        "read_p95_ms": int(os.environ["READ_P95_MS"]),
        "submit_p95_ms": int(os.environ["SUBMIT_P95_MS"]),
        "server_errors": "count==0",
        "unexpected_responses": "count==0",
    },
    "mixed_percent": {
        "read": int(os.environ["MIX_READ_PERCENT"]),
        "sse": int(os.environ["MIX_SSE_PERCENT"]),
        "submit": int(os.environ["MIX_SUBMIT_PERCENT"]),
    },
    "sse_run_id_supplied": bool(os.environ.get("CAPACITY_SSE_RUN_ID")),
    "writes_approved": os.environ.get("CAPACITY_ALLOW_WRITES") == "1",
}
with open(output, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY

SUMMARY_FILE="$RUN_DIR/k6-summary.json"
RESULT_FILE="$RUN_DIR/result.json"
set +e
"$K6_BIN" run \
  --summary-export "$SUMMARY_FILE" \
  bench/k6/capacity.js \
  2>&1 | tee "$RUN_DIR/k6.log"
K6_STATUS=${PIPESTATUS[0]}
set -e

python3 - "$RUN_DIR/config.json" "$SUMMARY_FILE" "$RESULT_FILE" "$K6_STATUS" <<'PY'
import json
import os
import sys

config_path, summary_path, result_path, status = sys.argv[1:]
with open(config_path, encoding="utf-8") as handle:
    config = json.load(handle)
summary = None
if os.path.exists(summary_path):
    with open(summary_path, encoding="utf-8") as handle:
        summary = json.load(handle)
result = {
    "schema_version": 1,
    "exit_code": int(status),
    "config": config,
    "summary_available": summary is not None,
    "summary": summary,
}
with open(result_path, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY

# The corpus size is in both lines on purpose. A pass against a one-record
# catalog is not a capacity result, and the only thing that stops it being
# quoted as one is printing what it ran against next to the verdict.
if [[ "$K6_STATUS" -eq 0 ]]; then
  echo "CAPACITY SUITE PASSED against ${OBSERVED_CATALOG_ENTRIES} catalog entries — report: $RESULT_FILE"
else
  echo "CAPACITY SUITE FAILED (k6 exit $K6_STATUS) against ${OBSERVED_CATALOG_ENTRIES} catalog entries — report: $RESULT_FILE" >&2
fi
exit "$K6_STATUS"
