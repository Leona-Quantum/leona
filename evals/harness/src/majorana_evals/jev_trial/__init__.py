"""The Jev offline trial (ai-ops#358): compares the production Atlas method
finder's ranking against Jev's (TypeSafe AI) ranking on a small, curated,
catalog-derived ground truth — offline, with NO user data of any kind (no logged
query, nothing from the users/workspaces database; every case in
`evals/jev-trial/curated-cases.yaml` is built only from the Atlas catalog's own
public content).

This package makes NO change to the product: nothing here is imported by
`apps/web`, `services/api`, or `services/worker`, and a run never touches
`DATABASE_URL` or the run pipeline. See `evals/jev-trial/README.md` for what each
module does and how to run it, and `runner.py` for the orchestration entry point.

Owner ruling (ai-ops#358): "option 1. i have created account" — option 1's text:
"Sign up and trial it offline on Atlas method ranking, no user data (recommended)"."""
