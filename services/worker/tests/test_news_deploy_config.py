"""Release configuration rejects unsafe or incomplete settings before rollout."""

import json
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
render = runpy.run_path(str(ROOT / "scripts/news-deploy-config.py"))["render"]


def settings():
    return json.loads((ROOT / "infra/news.json").read_text())


def test_disabled_release_needs_no_credential():
    config = settings()
    config.update(enabled=False, public=False, schedule_enabled=False, auto_publish=False)
    result = render(config, "")
    assert result["openai_secret"] == ""
    assert "LEONA_NEWS_ENABLED=false" in result["api_env"]
    assert "LEONA_NEWS_SCHEDULE_ENABLED=false" in result["worker_env"]
    assert "MODEL=" not in result["api_env"]


def test_enabled_release_requires_workspace_and_pinned_secret():
    config = settings()
    config.update(enabled=True, workspace_id=None)
    with pytest.raises(ValueError):
        render(config, "")
    config["workspace_id"] = "01900000-0000-7000-8000-000000000001"
    for secret in ("", "LEONA_NEWS_OPENAI_API_KEY:latest", "KEY:1,$(id)", "KEY:1\nx=1"):
        with pytest.raises(ValueError):
            render(config, secret)
    assert (
        render(config, "LEONA_NEWS_OPENAI_API_KEY:1")["openai_secret"]
        == "LEONA_NEWS_OPENAI_API_KEY:1"
    )


@pytest.mark.parametrize(
    "change",
    [
        {"model": "$(id)"},
        {"daily_batch_limit": 21},
        {"public": "false"},
        {"enabled": False, "schedule_enabled": True},
        {"enabled": True, "workspace_id": "invalid"},
    ],
)
def test_rejects_malformed_release_settings(change):
    config = settings()
    config.update(change)
    with pytest.raises(ValueError):
        render(config, "LEONA_NEWS_OPENAI_API_KEY:1")
