# Leona News

Independent news renderer for news.leonaquantum.com. Root AGENTS.md applies.

- Run `npm run build` and `npm test` here; check desktop and mobile after UI edits.
- Modes: `preview` renders samples; `editor` is loopback-only and uses an existing admin bearer server-side; `published` reads only the public API.
- API/Worker own Postgres. Never add a renderer database connection or send OpenAI/admin credentials to the browser.
- `content/articles.mjs` contains samples, never publishable records. Upstream errors in published mode must never fall back to samples.
- Images with confirmed usage terms take priority. Generated images must be labeled. Draft images are protected by the same article publication scope.
- Read RUNBOOK.md for configuration, schema migration, scheduling, release checks and remaining live verification.
- DNS, cloud deployment, production migrations and paid test calls have not been performed by this implementation.
