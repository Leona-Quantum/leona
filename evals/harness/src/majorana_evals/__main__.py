"""CLI: run the corpus against the REAL providers and write report.json.

  uv run --package majorana-evals python -m majorana_evals \
      --corpus evals/corpus --out evals/report.json

Needs DATABASE_URL and (for a real baseline) ANTHROPIC_API_KEY + Vercel Sandbox
auth. Without a provider key this run cannot produce the honest baseline number —
that is the owner-gated spend the nightly workflow is waiting on."""

from __future__ import annotations

import argparse
import asyncio
import uuid
from pathlib import Path

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import AnthropicLLM
from majorana_sandbox import VercelSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals.runner import run_corpus
from majorana_evals.schema import load_corpus


async def _main(corpus_dir: str, out: str) -> int:
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
            llm=AnthropicLLM(),
            sandbox=VercelSandbox(),
            note="baseline run against real providers",
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
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.corpus, args.out)))


if __name__ == "__main__":
    main()
