"""The web composer's `workflow_context`, validated against this API's model.

`apps/web/lib/workflow-planner/workflow-context-fixture.json` is what the Run
composer sends for two fixed prompts, and the web test
`lib/workflow-planner-run-context.test.ts` asserts the file is what the web
code produces today. This test validates the same file against
`WorkflowContext`, so a field renamed, a bound tightened or a kind added on
either side fails a test instead of 422-ing a reader's run in production.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from majorana_api.routes.runs import CreateRunRequest, WorkflowContext

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "web"
    / "lib"
    / "workflow-planner"
    / "workflow-context-fixture.json"
)


def _fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_fixture_exists_and_has_both_prompts():
    data = _fixture()
    assert set(data) == {"en", "ja"}
    assert all(isinstance(value, dict) for value in data.values())


@pytest.mark.parametrize("locale", ["en", "ja"])
def test_what_the_web_sends_is_what_this_api_accepts(locale):
    context = _fixture()[locale]
    parsed = WorkflowContext.model_validate(context)
    # Round-trips without loss: nothing the web sends is silently dropped.
    assert parsed.model_dump(mode="json") == context
    request = CreateRunRequest.model_validate({"task_prompt": "x", "workflow_context": context})
    assert request.workflow_context == parsed
