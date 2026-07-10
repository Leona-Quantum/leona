"""CLI: run the corpus against the REAL providers and write report.json.

  uv run --package majorana-evals python -m majorana_evals \
      --corpus evals/corpus --out evals/report.json

Needs DATABASE_URL and (for a real baseline) provider keys — OPENAI_API_KEY +
DEEPSEEK_API_KEY for the default profile, or ANTHROPIC_API_KEY with
MAJORANA_LLM_PROVIDER=anthropic — plus Vercel Sandbox auth. Without a provider key
this run cannot produce the honest baseline number."""

from __future__ import annotations

import argparse
import asyncio
import uuid
from pathlib import Path

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import default_llm
from majorana_sandbox import LocalSubprocessSandbox, VercelSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals.runner import run_corpus
from majorana_evals.schema import load_corpus


async def _main(corpus_dir: str, out: str, sandbox: str = "vercel") -> int:
    cases = load_corpus(corpus_dir)
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            user, ws = await system.get_or_provision_user(
                session,
                workos_user_id=f"eval-harness-{uuid.uuid4()}",
                email=f"eval-{uuid.uuid4().hex[:8]}@eval.majorana",
            )
            await session.commit()
            scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)

        report = await run_corpus(
            cases,
            factory=factory,
            scope=scope,
            llm=default_llm(),
            # --sandbox local: real LLMs but the subprocess double instead of the
            # Vercel microVM — for local baselines before the runner image exists
            # (Phase 4). The report note records which boundary was used.
            sandbox=LocalSubprocessSandbox() if sandbox == "local" else VercelSandbox(),
            note=f"baseline run against real LLM providers (sandbox={sandbox})",
        )
    finally:
        await engine.dispose()

    Path(out).write_text(report.model_dump_json(indent=2) + "\n")
    print(f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}) → {out}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals")
    parser.add_argument("--corpus", default="evals/corpus")
    parser.add_argument("--out", default="evals/report.json")
    parser.add_argument("--sandbox", choices=["vercel", "local"], default="vercel")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.corpus, args.out, args.sandbox)))


if __name__ == "__main__":
    main()
