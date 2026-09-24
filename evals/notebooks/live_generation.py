"""Generate real notebooks end to end and report how many a reader would get.

    uv run --package majorana-worker python evals/notebooks/live_generation.py \
        --image majorana-runner:nbide-local --briefs evals/notebooks/briefs.json \
        --out /tmp/notebook-eval.json [--only N] [--max-usd 2]

**This spends money.** Every brief is a real model call chain (outline, draft, up to three
repairs, review) on whatever provider `majorana_llm` resolves from the environment, which in
production is DeepSeek. Nothing here runs in CI, and nothing should: the owner approves a
spend before it is run (2026-09-23: up to $10 for the notebook IDE work).

What it measures is the thing the reader sees, not a proxy for it: whether
`leona_notebooks.pipeline.generate` returns a notebook (`ready`), how many code cells ran,
which raised, how many repairs it took, and the model's token counts. It runs the pipeline
through the worker's own `ProductionNotebookPorts`, so the prompts, parsing, repair loop and
report reader are the production ones.

The sandbox is the production image (`infra/sandbox/Dockerfile`) under Docker with
`--network none`, a read-only root, a memory cap and the 120 s ceiling: the same rootfs and
the same limits Vercel's microVM applies, minus Firecracker. Code the model wrote runs
inside it and nowhere else. It is an evaluation double, not an isolation boundary for
untrusted users, and the guard (`majorana_sandbox.guard`) still runs first, exactly as in
production.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from majorana_sandbox.spec import (
    MAX_OUTPUT_BYTES,
    ExecutionSpec,
    SandboxResult,
    compose_execution,
    parse_protected_result,
)


class DockerSandbox:
    """`majorana_sandbox.Sandbox` over `docker run` of the production image."""

    provider = "docker-eval"

    def __init__(self, image: str, *, platform: str = "linux/amd64") -> None:
        self._image = image
        self._platform = platform

    @property
    def environment_id(self) -> str:
        return f"docker:{self._image}"

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="leona-eval-") as host_tmp:
            Path(host_tmp, "main.py").write_text(compose_execution(spec), encoding="utf-8")
            os.chmod(host_tmp, 0o777)
            name = f"leona-eval-{os.getpid()}-{int(started * 1000)}"
            memory = max(spec.memory_mb, 512)
            proc = await asyncio.create_subprocess_exec(
                "docker", "run", "--rm", "--name", name,
                "--platform", self._platform,
                "--network", "none",
                "--read-only",
                "--memory", f"{memory}m", "--memory-swap", f"{memory}m",
                "--cpus", "2", "--pids-limit", "256",
                # The image runs as root under plain Docker (Vercel supplies its own
                # user), so the eval drops to nobody with no capabilities.
                "--user", "65534:65534", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges",
                "-e", "PYTHONUNBUFFERED=1",
                "-v", f"{host_tmp}:/tmp",
                "-w", "/tmp",
                self._image,
                "python", "-I", "/tmp/main.py",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            timed_out = False
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=spec.timeout_s + 30)
            except TimeoutError:
                timed_out = True
                killer = await asyncio.create_subprocess_exec("docker", "kill", name)
                await killer.wait()
                stdout, stderr = b"", b"timed out"
                await proc.wait()
            protected = None
            if spec.protected_result_path is not None:
                relative = spec.protected_result_path.removeprefix("/tmp/")
                sidecar = Path(host_tmp, relative)
                if sidecar.exists():
                    try:
                        protected = parse_protected_result(sidecar.read_bytes())
                    except Exception:  # noqa: BLE001 - same tolerance as the Vercel adapter
                        protected = None
        exit_code = -9 if timed_out else (proc.returncode or 0)
        return SandboxResult(
            ok=(not timed_out) and exit_code == 0,
            exit_code=exit_code,
            duration_ms=int((time.monotonic() - started) * 1000),
            memory_mb=None,
            stdout=stdout[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"),
            stderr=stderr[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"),
            truncated=len(stdout) > MAX_OUTPUT_BYTES or len(stderr) > MAX_OUTPUT_BYTES,
            provider=self.provider,
            protected_result=protected,
        )


@dataclass
class CountingLLM:
    """Wraps the real client and adds up what it was asked to do."""

    delegate: Any
    calls: list[dict] = field(default_factory=list)

    async def complete(self, request, *, on_delta=None):
        started = time.monotonic()
        if on_delta is None:
            response = await self.delegate.complete(request)
        else:
            response = await self.delegate.complete(request, on_delta=on_delta)
        self.calls.append(
            {
                "schema": request.schema_name,
                "model": getattr(response, "model", request.model),
                "input_tokens": getattr(response, "input_tokens", None),
                "output_tokens": getattr(response, "output_tokens", None),
                "seconds": round(time.monotonic() - started, 2),
            }
        )
        return response


class RecordingSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    async def emit(self, event_type: str, payload: dict) -> None:
        self.events.append((event_type, payload))


async def run_one(brief: dict, *, sandbox: DockerSandbox, llm) -> dict:
    from leona_notebooks.pipeline import GenerationRequest, generate
    from majorana_worker.notebook_handlers import ProductionNotebookPorts

    counting = CountingLLM(llm)
    sink = RecordingSink()
    ports = ProductionNotebookPorts(
        llm=counting, sandbox=sandbox, sink=sink, response_locale=brief.get("locale", "en")
    )
    started = time.monotonic()
    outcome = await generate(
        ports,
        GenerationRequest(
            brief=brief["brief"],
            kind_hint=brief.get("kind"),
            audience=brief.get("audience"),
            style=brief.get("style"),
            response_locale=brief.get("locale", "en"),
        ),
    )
    report = outcome.report
    cells = report.cells if report is not None else []
    code_cells = [c for c in (outcome.spec.cells if outcome.spec else []) if c.is_code]
    return {
        "name": brief["name"],
        "status": outcome.status,
        "clean": bool(report is not None and report.ok),
        "error": outcome.error,
        "cell_errors": getattr(outcome, "cell_errors", ""),
        "cells": len(outcome.spec.cells) if outcome.spec else 0,
        "code_cells": len(code_cells),
        "ran": sum(1 for c in cells if c.status == "ok"),
        "raised": [
            {"id": c.id, "error": f"{c.error.ename}: {c.error.evalue[:200]}"}
            for c in cells
            if c.status == "error" and c.error is not None
        ],
        "not_run": sum(1 for c in cells if c.status == "not_run"),
        "repairs": sum(1 for a in outcome.attempts if a.stage == "notebook.repair"),
        "repairs_ok": sum(1 for a in outcome.attempts if a.stage == "notebook.repair" and a.ok),
        "sandbox_seconds": round(ports.sandbox_seconds_used, 2),
        "seconds": round(time.monotonic() - started, 1),
        "llm_calls": counting.calls,
        "input_tokens": sum(c["input_tokens"] or 0 for c in counting.calls),
        "output_tokens": sum(c["output_tokens"] or 0 for c in counting.calls),
        "attempts": [(a.stage, a.ok, a.detail[:200]) for a in outcome.attempts],
        "source": outcome.source,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--image", required=True)
    parser.add_argument("--briefs", type=Path, default=Path(__file__).with_name("briefs.json"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", type=int, default=None, help="run the first N briefs")
    parser.add_argument("--names", default="", help="comma-separated brief names to run")
    parser.add_argument("--concurrency", type=int, default=2)
    args = parser.parse_args()

    from majorana_llm import default_llm

    briefs = json.loads(args.briefs.read_text())["briefs"]
    if args.names:
        wanted = {n.strip() for n in args.names.split(",") if n.strip()}
        briefs = [b for b in briefs if b["name"] in wanted]
    if args.only is not None:
        briefs = briefs[: args.only]
    sandbox = DockerSandbox(args.image)
    llm = default_llm()
    gate = asyncio.Semaphore(args.concurrency)
    results: list[dict] = []

    async def guarded(brief: dict) -> None:
        async with gate:
            try:
                result = await run_one(brief, sandbox=sandbox, llm=llm)
            except Exception as exc:  # noqa: BLE001 - one brief's crash is a result too
                result = {"name": brief["name"], "status": "crashed", "error": repr(exc)}
            results.append(result)
            print(
                f"{result['name']}: {result['status']}"
                + (f" ran {result.get('ran')}/{result.get('code_cells')}" if "ran" in result else "")
                + (f" raised {[r['id'] for r in result.get('raised', [])]}" if result.get("raised") else "")
                + f" repairs {result.get('repairs', '-')}",
                flush=True,
            )

    await asyncio.gather(*(guarded(b) for b in briefs))
    ready = sum(1 for r in results if r["status"] == "ready")
    clean = sum(1 for r in results if r.get("clean"))
    summary = {
        "briefs": len(results),
        "ready": ready,
        "clean": clean,
        "input_tokens": sum(r.get("input_tokens", 0) for r in results),
        "output_tokens": sum(r.get("output_tokens", 0) for r in results),
        "image": args.image,
    }
    args.out.write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
