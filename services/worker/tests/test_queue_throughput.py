"""Small regression test for the provider-free Worker benchmark harness."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from bench.worker.queue_throughput import BenchmarkConfig, run_benchmark  # noqa: E402


async def test_bounded_queue_benchmark_drains_each_job_once():
    result = await run_benchmark(
        BenchmarkConfig(jobs=8, workers=2, handler_delay_ms=0.25, timeout_s=5.0)
    )

    assert result["status"] == "passed"
    assert result["jobs_completed"] == 8
    assert result["finish_calls"] == 8
    assert result["invariants"] == {
        "all_jobs_finished_once": True,
        "all_attempts_are_one": True,
        "provider_preflight_called": False,
        "external_database_called": False,
    }
