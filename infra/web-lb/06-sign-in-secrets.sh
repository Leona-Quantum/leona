#!/usr/bin/env bash
#
# Put the website's runtime settings that are not numbers into Secret Manager,
# so the Google copy signs people in and treats them as production does.
#
# ## What production has that the Google copy did not
#
# Read from Vercel on 2026-09-17 (`vercel env ls production`): thirteen settings.
# The deploy workflow already carried six. The rest, and where each comes from:
#
#   LEONA_DEVELOPER_EMAILS   readable from Vercel. Without it every developer
#                            account resolves to the free tier at the switch —
#                            no error, just the wrong plan.
#   CONTACT_FALLBACK         write-only on Vercel, but the site SERVES it: GET
#                            /api/contact answers {"configured":false,"mailto":…}.
#                            Without it the contact form reports itself
#                            unavailable and offers nothing (ai-ops 146 is still
#                            open, so the fallback is the only path there is).
#   WORKOS_COOKIE_PASSWORD   write-only, unrecoverable. ai-ops 321, the owner's
#                            words: "Generate fresh values: everyone signed in
#                            gets signed out once at the switch and signs back
#                            in, and nothing else changes". Generated here.
#   WORKOS_API_KEY           write-only, unrecoverable, and only the WorkOS
#                            dashboard can mint one. THE OWNER'S STEP — this
#                            script reports whether it is there and prints the
#                            command that stores it without it touching a
#                            terminal scrollback, a chat or an issue.
#   WORKOS_CLIENT_ID,        public (the live sign-in redirect prints both), so
#   the redirect URI         they are plain values in deploy-web.yml.
#
# Values are never printed. Every secret is created only if absent: re-running
# this does not rotate anything, because rotating the cookie password signs
# everybody out again.
#
#   ./06-sign-in-secrets.sh --from-env-file <vercel-pull.env> [--contact-fallback auto|<address>]
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

env_file=""; contact=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-env-file) env_file="${2:-}"; shift 2 ;;
    --contact-fallback) contact="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# create_secret <name> — value on stdin. Refuses an empty value: an empty secret
# mounts fine, reads as "", and turns the feature off exactly as if it were
# missing, except that every check for its existence now passes.
create_secret() {
  local name="$1" tmp rc=0
  tmp=$(mktemp)
  cat > "$tmp"
  if [ -s "$tmp" ]; then
    g secrets create "$name" --replication-policy=automatic --data-file="$tmp" >/dev/null || rc=$?
  else
    echo "  ! refusing to create ${name} from an empty value" >&2; rc=1
  fi
  rm -f "$tmp"
  [ "$rc" -eq 0 ] || return "$rc"
  made "$name"
}

step "WEB_WORKOS_COOKIE_PASSWORD (fresh, ai-ops 321)"
if exists secrets describe WEB_WORKOS_COOKIE_PASSWORD; then have WEB_WORKOS_COOKIE_PASSWORD; else
  # AuthKit needs at least 32 characters; 48 random bytes is 64 of base64.
  openssl rand -base64 48 | tr -d '\n' | create_secret WEB_WORKOS_COOKIE_PASSWORD
fi

step "WEB_DEVELOPER_EMAILS"
if exists secrets describe WEB_DEVELOPER_EMAILS; then have WEB_DEVELOPER_EMAILS
elif [ -n "$env_file" ] && [ -r "$env_file" ]; then
  python3 - "$env_file" <<'PY' | create_secret WEB_DEVELOPER_EMAILS
import re, sys
for line in open(sys.argv[1]):
    m = re.match(r'^LEONA_DEVELOPER_EMAILS=(.*)$', line.rstrip("\n"))
    if m:
        sys.stdout.write(m.group(1).strip().strip('"'))
        break
PY
else
  echo "   absent, and no --from-env-file given — pull it first:"
  echo "     (cd apps/web && vercel env pull <file outside the repo> --environment=production)"
fi

step "WEB_CONTACT_FALLBACK"
if exists secrets describe WEB_CONTACT_FALLBACK; then have WEB_CONTACT_FALLBACK
elif [ -n "$contact" ]; then
  if [ "$contact" = auto ]; then
    # What production serves today, read from production rather than typed.
    contact=$(curl -sS --max-time 20 https://leonaqt.com/api/contact \
      | python3 -c 'import json,sys,urllib.parse as u
m=(json.load(sys.stdin).get("mailto") or "")
print(u.unquote(m.split(":",1)[-1].split("?")[0]))')
  fi
  case "$contact" in
    *@*.*) printf '%s' "$contact" | create_secret WEB_CONTACT_FALLBACK ;;
    *) echo "  ! that is not an address; production answered without a mailto" >&2; exit 1 ;;
  esac
else
  echo "   absent — pass --contact-fallback auto to copy what production serves"
fi

step "WEB_WORKOS_API_KEY (the owner's step)"
if exists secrets describe WEB_WORKOS_API_KEY; then
  have WEB_WORKOS_API_KEY
  ready=yes
else
  ready=no
  cat <<'TXT'
   ABSENT. Sign-in cannot work on Google Cloud until it exists, and only the
   WorkOS dashboard can mint it:

     WorkOS dashboard -> (Production environment) -> API Keys -> Create key
     copy the key, then in a terminal on this Mac:

       pbpaste | tr -d '\n' | gcloud secrets create WEB_WORKOS_API_KEY \
         --project=majorana-core --replication-policy=automatic --data-file=-

   That reads the clipboard straight into Secret Manager: the key is never
   typed, echoed, pasted into a chat or written to a file. Creating a second key
   does not disturb the one Vercel uses, so the rollback path keeps working.
TXT
fi

# The runtime account's access is granted per secret, so anything created above
# needs the binding — delegate to the script that owns that rule.
./05-runtime-identity.sh >/dev/null
echo
echo "runtime identity re-applied to whatever exists now"
if [ "$ready" = yes ]; then
  echo "Every sign-in secret is present: set WEB_SIGN_IN=1 in infra/fleet.env and merge."
else
  echo "Leave WEB_SIGN_IN=0 in infra/fleet.env until WEB_WORKOS_API_KEY exists."
fi
