# Leona Quantum

Leona Quantum is an open quantum workbench that turns a natural-language question into
copyable code, a measured result, and an evidence-backed artifact. Run owns the
pipeline, and Studio edits verified versions and keeps the provenance.

Public product page: `https://web-majoranaq.vercel.app/open-source`

## Architecture

- Next.js web app on Vercel, with WorkOS AuthKit for workspace identity.
- FastAPI control plane and a separate Cloud Run worker backed by Neon Postgres.
- OpenAI-compatible and DeepSeek LLM routing, with stage-specific model selection.
- Vercel Sandbox with explicit deny-all egress for generated code.
- The reproducible Vercel Sandbox runner image lives in `infra/sandbox/Dockerfile` and
  carries the pinned Qiskit, Aer, PennyLane, Cirq, Braket, Qibo, and Qulacs runtime used
  by production. Editing it is not shipping it — rebuild and publish with
  `docs/runbooks/sandbox-image.md`.
- Framework-native Qiskit, Cirq, and PennyLane artifacts; OpenQASM is optional
  interchange data used only for explicit cross-framework conversion.

The control plane stores run events and artifacts; the sandbox never receives provider
credentials. See `docs/` for the security and verification contracts.

## Local quickstart

```bash
pnpm install
uv sync --all-packages
pnpm --filter @majorana/web dev
```

For the API and worker, use the commands in `docs/runbooks/`. Provider credentials are
required only for real LLM acceptance and must never be committed.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), run the focused checks for the files you touch,
and keep generated contracts current. New circuit behavior should include a connector
or worker regression test plus a hosted acceptance note when it crosses the live path.

Licensed under the MIT License.
