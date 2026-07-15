# Contributing to Majorana

Thanks for helping make quantum software easier to inspect. Keep changes small enough
to review and preserve the product boundary: model output is a proposal, while measured
results and saved artifacts must be backed by recorded evidence.

## Before opening a pull request

```bash
pnpm install
uv sync --all-packages
pnpm turbo run lint typecheck test
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

For circuit changes, add or update tests for normalized OpenQASM and every affected
framework connector. For worker changes, keep the sandbox deny-all invariant and add a
regression test for any provider or compatibility failure.

Do not commit credentials, private workspace exports, generated local environments, or
provider tokens. Use a feature branch and describe the user-visible behavior, evidence
path, and any remaining limitation in the pull request.
