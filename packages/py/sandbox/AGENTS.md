# AGENTS.md — packages/py/sandbox (BLAST-RADIUS)

Sandbox provider adapters (Vercel Sandbox primary; Modal heavy-lane seam). Security
invariants (plans/rebuild/05-security.md §1):
1. deny-all egress applied AT CREATION, explicitly — Vercel's default is allow-all
2. zero credentials in sandbox env
3. one sandbox per execution, destroyed after; hard timeout ≤120s; mem/CPU caps
4. pre-flight qubit ceiling (≤27 default lane) BEFORE dispatch
5. capture stdout/stderr/exit/duration/memory for 100% of runs
Hostile-payload suite must stay green; it is a release gate, not a nice-to-have.
