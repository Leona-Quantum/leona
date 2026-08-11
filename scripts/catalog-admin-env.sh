#!/usr/bin/env bash
# Export everything `majorana_api.catalog_admin` needs to reach production, from
# inside the deploy job. SOURCE it (`. scripts/catalog-admin-env.sh`); it exports
# rather than runs.
#
# Extracted because two steps in deploy.yml now need it — the sync itself and,
# while the sync is parked, the read-only reviewer diagnostic. Copied into both
# it would be the shape that becomes five, and the copy that drifts is the one
# that points a production admin command at the wrong workspace.
#
# Requires: the Cloud SQL Auth Proxy already started by the migrate step, and
# $GCP_PROJECT / $GCP_REGION from the workflow env.
#
# Exits non-zero on any problem and writes ::error:: lines. Callers that must not
# fail the deploy should source it inside a guarded subshell.

# The proxy has been up since before `build image`, several minutes of build and
# rollout ago. Checked here so a proxy that died in between reports itself,
# instead of surfacing as a connection error that reads like a broken database.
if ! curl -fsS http://127.0.0.1:9090/startup >/dev/null 2>&1; then
  echo "::error::the Cloud SQL Auth Proxy is no longer answering, so catalog-admin"
  echo "::error::cannot reach the database. Any code rollout above SUCCEEDED."
  return 1 2>/dev/null || exit 1
fi

# The three authority ids are configuration of the deployed service and exist
# nowhere else: not in this workflow, not in the repo, not in Secret Manager.
# Reading them back off the service is what makes an admin command provably
# target the same workspace the API serves from, and adds no second place for a
# production identity to be stated and go stale.
_read_service_env() {
  gcloud run services describe majorana-api \
    --project "$GCP_PROJECT" --region "$GCP_REGION" \
    --format="value(spec.template.spec.containers[0].env.filter(\"name:$1\").extract(value))" \
    | tr -d "[]' "
}
_uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
for _var in SYSTEM_CATALOG_WORKSPACE_ID SYSTEM_CATALOG_IMPORTER_USER_ID \
            SYSTEM_CATALOG_PUBLIC_READER_USER_ID; do
  _value=$(_read_service_env "$_var")
  # Validated, not just read. gcloud's projection returns a list, so a name that
  # matched two env vars would come back joined rather than empty — and an id
  # that is silently wrong is the one failure this must not have. The regex turns
  # a format change into a loud stop instead of a command against a workspace
  # nobody meant.
  if ! [[ "$_value" =~ $_uuid_re ]]; then
    echo "::error::$_var did not read back as a UUID from majorana-api. Either the"
    echo "::error::service no longer carries the catalog authority ids as plain env"
    echo "::error::values, or the projection shape changed."
    return 1 2>/dev/null || exit 1
  fi
  export "$_var=$_value"
done

# Same Secret Manager entry the migrate step reads: since the Cloud SQL move it
# holds a 127.0.0.1:5432 URL that resolves through the proxy. Exported into the
# calling shell rather than $GITHUB_ENV, so a production connection string does
# not outlive the step that needs it.
if ! _db_url=$(gcloud secrets versions access latest \
  --secret=DATABASE_URL_SECRET --project "$GCP_PROJECT" 2>/tmp/catalog_secret.err); then
  echo "::error::could not read DATABASE_URL_SECRET: $(cat /tmp/catalog_secret.err)"
  return 1 2>/dev/null || exit 1
fi
if [ -z "$_db_url" ]; then
  echo "::error::DATABASE_URL_SECRET is empty"
  return 1 2>/dev/null || exit 1
fi
echo "::add-mask::$_db_url"
export DATABASE_URL="$_db_url"

# The admin commands go through the catalog scope checks, which open with
# `if not authority.enabled`. With the flag off they fail as `AuthzError: invalid
# catalog importer scope`, which reads like a permissions problem and is not one.
# This is the calling process's environment only — no deployed service reads a
# runner's env.
export SYSTEM_CATALOG_ENABLED=true
# Names the connection in pg_stat_activity: a one-shot admin process on the
# production instance should be attributable to what it is.
export MAJORANA_SERVICE=catalog-sync
# Sessions here are sequential. Pinned rather than defaulted so this run is a
# term the connection budget in docs/runbooks/database.md can account for.
export DB_POOL_SIZE=2
export DB_MAX_OVERFLOW=0
