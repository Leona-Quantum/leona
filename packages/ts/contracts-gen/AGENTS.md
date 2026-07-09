# AGENTS.md — packages/ts/contracts-gen (GENERATED)

`src/schema.d.ts` is generated from `packages/py/contracts/openapi.json` — NEVER
hand-edit either file. To change a type: edit the Pydantic models in
`packages/py/contracts`, then regenerate both layers:

```bash
uv run python -m majorana_contracts.export
pnpm --filter @majorana/contracts-gen gen
```

CI regenerates and fails on diff, so a stale commit cannot merge (ADR-0008).
Consumers import `components["schemas"]["RunEvent"]` etc. from `src/schema.d.ts`.
