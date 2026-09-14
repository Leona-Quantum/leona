## What

Add Leona Quantum News: a separate public renderer and local editorial UI backed by the existing API, Worker and PostgreSQL. Collections research global quantum news, draft Japanese articles, independently verify sources and persist content/images with resumable processing. Admins can revise, review, publish and withdraw; scheduling and automatic publication are opt-in.

## Why

Implement the owner's request for a deployable news publication at news.leonaquantum.com. The existing queue, workspace authorization and database ownership remain the integration points. CI exercises the news storage and renderer, and the normal dev deployment applies the additive migration and reviewed news settings. A separate Vercel project builds apps/news; first-time project, secret and DNS setup is documented in RUNBOOK.md. Initial feature flags are disabled.

## Checks

- [ ] Full required GitHub CI green (not run remotely yet)
- [x] 126 targeted Python tests, including real PostgreSQL storage/RLS/concurrency and existing worker recovery/auth regression tests
- [x] 5 Node tests, including a build and HTTP exercise of the actual Vercel function artifact
- [x] Targeted Ruff, Node syntax/build, workspace inventory and workflow YAML/shell parsing
- [x] Local PostgreSQL migration up→down→up; no production migration performed
- [x] Explicit deployment file allowlist; local .env excluded; no generated contract edits
- [ ] Owner review of migration and workflow changes before release
- [ ] Paid live model/article acceptance, cloud deployment, backup/monitoring and HTTPS checks

UI evidence uses deterministic fixtures, not published news: [desktop](screenshots/live-article-desktop.png), [mobile](screenshots/live-article-mobile.png), [editor](screenshots/editor-review.png).

Release notes: dev is production. Vercel and backend roll out independently, so APIs must remain compatible with the preceding renderer revision. Initial flags prevent collection/publication on merge; configure the existing workspace, pinned Secret Manager reference and renderer project before enabling. Reverting the code does not require dropping the newsroom tables; migration downgrade destroys news data and requires backup/review.
