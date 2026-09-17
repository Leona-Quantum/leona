#!/usr/bin/env bash
#
# Give the website its own identity on Google Cloud, holding nothing.
#
# ## Why this exists
#
# On Vercel the website ran with no cloud credentials at all. On Cloud Run every
# service runs AS a service account, and a container can ask the metadata server
# for that account's token at any time. `majorana-web` was created without one
# named, so it inherited the project's default compute account — which holds
# `roles/editor` on `majorana-core` (read 2026-09-17, not assumed). Behind the
# load balancer that would make the public web renderer the most privileged
# thing on the internet-facing side of the project: one server-side request
# forgery against the metadata address would hand out an Editor token.
#
# So the move would have WIDENED what a web compromise reaches, where the point
# of the origin lock and the ingress restriction is to narrow it. This script
# closes that: a dedicated account with NO project roles, able to read exactly
# the secrets the website is configured with and nothing else.
#
# The api and the worker still run as the default compute account. That is older
# than this migration and is theirs to fix in their own lane; it is written down
# here so that nobody reads this script as having fixed it.
#
# ## What it grants, all of it
#
#   majorana-web-runtime   secretAccessor on each secret in WEB_SECRETS, if the
#                          secret exists (a missing one is reported, not created)
#   majorana-deploy        serviceAccountUser on majorana-web-runtime, so the
#                          deploy workflow may deploy a revision that runs as it
#   majorana-deploy        secretAccessor on WEB_SENTRY_DSN only: the browser DSN
#                          is a build argument, and the build reads it from there
#
# Idempotent. Re-running it is how you check the shape is still right.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

RUNTIME_SA_NAME=majorana-web-runtime
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
DEPLOY_SA="majorana-deploy@${PROJECT}.iam.gserviceaccount.com"

# Every secret deploy-web.yml may mount. Named with a WEB_ prefix on purpose: the
# unqualified SENTRY_DSN belongs to the api (a different Sentry project), and
# reusing an obvious name routes data to the wrong place with no error.
WEB_SECRETS="WEB_SENTRY_DSN TRUSTED_CALLER_TOKEN WEB_DEVELOPER_EMAILS WEB_CONTACT_FALLBACK WEB_WORKOS_API_KEY WEB_WORKOS_COOKIE_PASSWORD"

step "service account ${RUNTIME_SA_NAME}"
if exists iam service-accounts describe "$RUNTIME_SA"; then have "$RUNTIME_SA"; else
  g iam service-accounts create "$RUNTIME_SA_NAME" \
    --display-name "majorana-web runtime (no project roles)" >/dev/null
  made "$RUNTIME_SA"
fi

step "it holds no project-level role"
roles=$(g projects get-iam-policy "$PROJECT" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:${RUNTIME_SA}" --format='value(bindings.role)')
if [ -n "$roles" ]; then
  echo "  ! ${RUNTIME_SA} holds project roles it should not:" >&2
  printf '  !   %s\n' $roles >&2
  echo "  ! Remove them; the whole point of this account is that it has none." >&2
  exit 1
fi
echo "   none"

step "it may read the website's secrets, and only those"
for s in $WEB_SECRETS; do
  if exists secrets describe "$s"; then
    g secrets add-iam-policy-binding "$s" --member "serviceAccount:${RUNTIME_SA}" \
      --role roles/secretmanager.secretAccessor --condition=None >/dev/null
    echo "   ${s}"
  else
    echo "   ${s} does not exist yet — skipped (06-sign-in-secrets.sh, or the owner's step)"
  fi
done

step "the deploy account may deploy revisions that run as it"
g iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser >/dev/null
echo "   ${DEPLOY_SA} -> serviceAccountUser"

step "the deploy account may read the browser DSN for the build"
g secrets add-iam-policy-binding WEB_SENTRY_DSN --member "serviceAccount:${DEPLOY_SA}" \
  --role roles/secretmanager.secretAccessor --condition=None >/dev/null
echo "   WEB_SENTRY_DSN"

printf '\nRuntime identity: %s\n' "$RUNTIME_SA"
