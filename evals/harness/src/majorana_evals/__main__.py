"""CLI: run the corpus against the REAL providers and write report.json.

The harness uses direct-handler ownership: it does not enqueue jobs, so a separate
worker cannot race the evaluation process.

  uv run --package majorana-evals python -m majorana_evals \
      --corpus evals/corpus --out evals/report.json --repetitions 1

  # Add two reproducible fresh instances from each procedural family:
  uv run --package majorana-evals python -m majorana_evals \
      --corpus evals/holdout-v15 --out evals/report.json \
      --procedural-seed 20260802 --procedural-cases-per-family 2 \
      --procedural-prompt-variants 3

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
from majorana_evals.procedural import (
    PROCEDURAL_GENERATOR_VERSION,
    PROCEDURAL_SURFACE_VERSION,
    generate_procedural_cases,
)
from majorana_evals.schema import load_corpus


def _load_eval_cases(
    corpus_dir: str,
    *,
    procedural_seed: int | None,
    procedural_cases_per_family: int,
    procedural_prompt_variants: int = 1,
):
    cases = load_corpus(corpus_dir)
    if procedural_cases_per_family:
        if procedural_seed is None:
            raise ValueError("procedural_seed is required when procedural cases are requested")
        cases.extend(
            generate_procedural_cases(
                procedural_seed,
                cases_per_family=procedural_cases_per_family,
                prompt_variants_per_case=procedural_prompt_variants,
            )
        )
    elif procedural_seed is not None:
        raise ValueError("procedural_cases_per_family is required with procedural_seed")
    elif procedural_prompt_variants != 1:
        raise ValueError("procedural_prompt_variants requires procedural cases")
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("static and procedural eval case IDs must be unique")
    return cases


async def _main(
    corpus_dir: str,
    out: str,
    sandbox: str = "vercel",
    repetitions: int = 1,
    procedural_seed: int | None = None,
    procedural_cases_per_family: int = 0,
    procedural_prompt_variants: int = 1,
) -> int:
    cases = _load_eval_cases(
        corpus_dir,
        procedural_seed=procedural_seed,
        procedural_cases_per_family=procedural_cases_per_family,
        procedural_prompt_variants=procedural_prompt_variants,
    )
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
            repetitions=repetitions,
            note=(
                "baseline run against real LLM providers "
                f"(sandbox={sandbox}, repetitions={repetitions}, "
                f"procedural={PROCEDURAL_GENERATOR_VERSION if procedural_cases_per_family else 'none'}, "
                f"seed={procedural_seed if procedural_cases_per_family else 'none'}, "
                f"cases_per_family={procedural_cases_per_family}, "
                f"prompt_variants={procedural_prompt_variants if procedural_cases_per_family else 'none'}, "
                f"surface={PROCEDURAL_SURFACE_VERSION if procedural_cases_per_family and procedural_prompt_variants > 1 else 'none'})"
            ),
        )
    finally:
        await engine.dispose()

    Path(out).write_text(report.model_dump_json(indent=2) + "\n")
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}); "
        f"first-candidate={report.first_candidate_passed}/{report.total}; "
        f"false-positive={report.false_positives} → {out}"
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals")
    parser.add_argument("--corpus", default="evals/corpus")
    parser.add_argument("--out", default="evals/report.json")
    parser.add_argument("--sandbox", choices=["vercel", "local"], default="vercel")
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--procedural-seed", type=int)
    parser.add_argument("--procedural-cases-per-family", type=int, default=0)
    parser.add_argument("--procedural-prompt-variants", type=int, default=1)
    args = parser.parse_args()
    if args.repetitions < 1:
        parser.error("--repetitions must be at least 1")
    if not 0 <= args.procedural_cases_per_family <= 20:
        parser.error("--procedural-cases-per-family must be between zero and twenty")
    if not 1 <= args.procedural_prompt_variants <= 3:
        parser.error("--procedural-prompt-variants must be between one and three")
    if args.procedural_seed is not None and not 0 <= args.procedural_seed < 2**63:
        parser.error("--procedural-seed must be in 0..2**63-1")
    if args.procedural_cases_per_family and args.procedural_seed is None:
        parser.error("--procedural-seed is required when procedural cases are requested")
    if args.procedural_seed is not None and not args.procedural_cases_per_family:
        parser.error("--procedural-cases-per-family is required with --procedural-seed")
    if not args.procedural_cases_per_family and args.procedural_prompt_variants != 1:
        parser.error("--procedural-prompt-variants requires procedural cases")
    raise SystemExit(
        asyncio.run(
            _main(
                args.corpus,
                args.out,
                args.sandbox,
                args.repetitions,
                args.procedural_seed,
                args.procedural_cases_per_family,
                args.procedural_prompt_variants,
            )
        )
    )


if __name__ == "__main__":
    main()
