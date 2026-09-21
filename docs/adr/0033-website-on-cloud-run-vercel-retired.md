# ADR-0033: The website is hosted on Cloud Run; Vercel is retired except the code sandbox

**Date:** 2026-09-21 · **Status:** accepted — supersedes the web half of ADR-0011
**Context:** The owner asked on 2026-09-12 for a plan to move deployment off Vercel onto
Google Cloud (`~/Developer/ai-ops/desk/leona/plans/gcp-migration-20260912/PLAN.md`) and on
2026-09-20 for the move to be finished with nothing left on Vercel except, possibly, the
sandbox. The website had been running on Cloud Run (`majorana-web`, built by
`.github/workflows/deploy-web.yml`) beside Vercel since phase 2, and DNS for `leonaqt.com`
moved to Cloudflare in front of the Google load balancer on 2026-09-20. From then on Vercel
built every push only as a rollback target nobody was served from.
**Decision:** Cloud Run is the website's only host. `vercel.json` and `apps/web/vercel.json`
are removed, the Vercel project's Git integration is disconnected so a push builds nothing
there, and `web-deploy-watch.yml` (which asserted that *Vercel* built each commit) is
removed. The build-skip rule survives as `scripts/web-build-needed.sh` and now gates only
the Cloud Build image build; `deploy-web.yml` fails instead of warning when it cannot deploy
or when sign-in is switched off, because nothing else deploys the site. The
`Vercel-CDN-Cache-Control` header is dropped: Cloudflare reads `CDN-Cache-Control`. The
code-execution sandbox (ADR-0006) stays on Vercel Sandbox — it is the product's security
boundary, any replacement is a new provider under the security gate
(`~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md` §1a), and its future is an
owner decision recorded on the desk, not here.
**Consequences:** One deploy lane for the website, and its evidence is `deploy-web`'s own
steps (smoke test on the private twin, traffic shift, read-back) plus `verify-web-cache`
after it. No Vercel build minutes. Rollback to Vercel is no longer "switch DNS back": the
last Vercel production deployment stays in the project, frozen at the commit it was built
from, so pointing DNS back would serve a stale site, not the current one. Preview
deployments per PR no longer exist; a branch is tried locally or on the private twin.
The ADR-0030 reasoning that middleware stays on the edge runtime because of Vercel's CDN
design no longer holds on Cloud Run; moving to Next's `proxy` convention is now a free
choice, not a blocked one. Reversal trigger: none planned.
