# WorkOS production cutover

Moving authentication from the **staging** WorkOS environment (which has been
serving production since launch) to the **production** one.

Written 2026-07-29, session 40. Nothing here is guesswork: every value was read
back from the live dashboard or the live service, and the `email` claim was
proved with a real token rather than trusted.

---

## What this is

| | Staging (serving production today) | Production (the target) |
|---|---|---|
| Client ID | `client_01KX3TN2D9X2JHZ75WZJQ95N9X` | `client_01KX3TN2Y37QDVCWG1M7M5WRG8` |
| Environment | — | `environment_01KX3TN2S4DFYSWE10JD45PHBC` |
| AuthKit domain | `intimate-heart-12-staging.authkit.app` | `admirable-portrait-37.authkit.app` |
| Application | — | `app_01KX3TN3C267QTK0NEN3EE3F1D` |
| Users | 7 real accounts | 0 |
| API key | — | Secret Manager `LEONA_API_KEY` (`majorana-core`) |

## Preconditions — verified 2026-07-29

- **Google OAuth is live** on the production environment. Confirmed from the
  AuthKit sign-in page's own `oauth_providers` payload, not the dashboard.
- **Redirect URIs** are registered: `https://leonaqt.com/auth/callback` and the
  `www` variant. An unregistered address is still rejected, so the check works.
- **CORS** lists all four origins: `leonaqt.com`, `www.leonaqt.com`,
  `leonaquantum.com`, `www.leonaquantum.com`.
- **The JWT template emits `email`.** This was the blocker for two sessions and
  it is now *proved*, not assumed. See below — the method matters, because
  "the dashboard shows the right JSON" is not the same claim.
- **The production API key exists** in Secret Manager as `LEONA_API_KEY`, and
  it does belong to the production environment (it lists 0 users and its
  authorize endpoint redirects to `admirable-portrait-37.authkit.app`).

### How the `email` claim was proved

The API returns 403 "access token lacks email claim" for any token without it,
so a wrong answer here takes production down rather than degrading it. Reading
the template in the dashboard proves what the field contains, not what WorkOS
puts in a token.

Neither of the two API paths that can mint a token works by default here: the
production environment has only Google OAuth enabled, and both
`grant_type=password` and Magic Auth are refused. So:

1. Enable **Email + Password** in Authentication → Methods (clicking only).
2. Create a throwaway user via the Management API, authenticate with
   `grant_type=password`, base64-decode the access token's payload.
3. Turn Email + Password back off, and delete the user.

The result on 2026-07-29:

```
claims present: ['auth_time', 'client_id', 'email', 'exp', 'iat', 'iss',
                 'jti', 'name', 'sid', 'sub']
email claim   : 'jwt-claim-probe@leonaqt.com'
```

Both the toggle and the user were reverted, and the revert was confirmed from
outside the dashboard (the same call now returns `email_password_auth_disabled`,
and the environment lists 0 users).

## What has to change, and where

Four values in two places. **The worker has no WorkOS variables at all** and
needs nothing — do not "fix" that.

| Where | Variable | New value |
|---|---|---|
| Vercel (production) | `WORKOS_CLIENT_ID` | `client_01KX3TN2Y37QDVCWG1M7M5WRG8` |
| Vercel (production) | `WORKOS_API_KEY` | the `LEONA_API_KEY` secret |
| `majorana-api` | `WORKOS_CLIENT_ID` | `client_01KX3TN2Y37QDVCWG1M7M5WRG8` |
| `majorana-api` | `WORKOS_JWT_ISSUER` | `https://api.workos.com/user_management/client_01KX3TN2Y37QDVCWG1M7M5WRG8` |

`NEXT_PUBLIC_WORKOS_REDIRECT_URI` and `WORKOS_COOKIE_PASSWORD` do **not**
change — the first is the same URL in both environments, the second is our own
cookie-sealing secret and has nothing to do with WorkOS environments.

### The issuer is the trap

`WORKOS_JWT_ISSUER` *defaults* to being derived from the client id, so it is
easy to assume it moves on its own. **It does not: `majorana-api` pins it
explicitly.** Changing only `WORKOS_CLIENT_ID` leaves token validation pointed
at the environment we just left — every request 403s, sign-in included, while
the service reports itself perfectly healthy. It is the same total outage as a
missing `email` claim, with no symptom that names its cause.

Earlier drafts of the cutover order in `memory/NEXT.md` listed three variables
and did not include this one. That order would have taken production down.

The API now refuses to start on that combination
(`settings._validate_workos_client_consistency`), so the half-cutover is no
longer expressible. The guard only fires on WorkOS-shaped URLs — a custom auth
domain is a deliberate override and is left alone.

## The order

The owner must be present and able to sign in. **An agent cannot verify a real
Google sign-in**, and will not enter the owner's credentials.

1. Set the four values above. Vercel needs `--value ... --force --yes`; piping
   stdin silently stores an empty string.
2. Redeploy `majorana-api` and the Vercel production deployment.
3. **The owner signs in immediately.** This is the actual test.
4. Dry-run the reattachment and read the per-person artifact/run counts:

   ```bash
   WORKOS_API_KEY=... DATABASE_URL=... uv run python \
     services/api/scripts/reattach_workos_identities.py
   ```

5. If the numbers name the right humans, re-run with `--apply`.

## Rollback

Two values, one redeploy, about a minute:

```bash
gcloud run services update majorana-api --region=us-west1 --project=majorana-core \
  --update-env-vars \
WORKOS_CLIENT_ID=client_01KX3TN2D9X2JHZ75WZJQ95N9X,\
WORKOS_JWT_ISSUER=https://api.workos.com/user_management/client_01KX3TN2D9X2JHZ75WZJQ95N9X
```

and set Vercel's `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` back to the staging pair.

Rolling back **after** the reattachment has been applied is not this simple —
the reattachment retires the duplicate identity to a `retired-workos-env:`
tombstone, which is reversible but by hand. Do not apply it until sign-in has
been confirmed working.

## Still open

- **Sign-out redirects are `Not set` on the production application. This blocks
  the cutover.** WorkOS's own documentation is explicit: *"if you haven't
  configured a Sign-out redirect in the WorkOS dashboard, users will see an
  error when logging out."* Not a wrong destination — an error page. So
  cutting over today would replace the reported sign-out bug with a worse one.

  `https://leonaqt.com` must be added as a sign-out redirect **and marked
  Default** before the cutover. It needs typing into the WorkOS dashboard, which
  the harness has blocked six times across four tools, so it is an owner action.

- The staging environment (live today) *does* have sign-out redirects, with
  `https://web-eshmis-majoranaq.vercel.app` — a stale Vercel preview host — as
  the default. That is the bug the owner reported. Because a default exists
  there, an unregistered `return_to` falls back to it rather than erroring,
  which is why PR 180 is inert rather than harmful on the current environment.
  Adding `https://leonaqt.com` to *either* environment's list is what actually
  fixes the reported bug.
