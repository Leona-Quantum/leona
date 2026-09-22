"""Release configuration rejects unsafe or incomplete settings before rollout."""

import json
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
_module = runpy.run_path(str(ROOT / "scripts/news-deploy-config.py"))
render = _module["render"]
PLACEHOLDER_SITE_URL = _module["PLACEHOLDER_SITE_URL"]


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
    # renderer_deploy/site_url are outputs of render(), never API/worker env.
    assert "RENDERER_DEPLOY" not in result["api_env"]
    assert "RENDERER_DEPLOY" not in result["worker_env"]
    assert "SITE_URL" not in result["api_env"]
    assert "SITE_URL" not in result["worker_env"]


def test_renderer_deploy_defaults_off_with_the_owner_ruled_hostname():
    # The hostname is the owner's ruling (ai-ops 354, option 1: news.leonaqt.com);
    # setting it switches nothing on, because renderer_deploy stays false.
    config = settings()
    assert config["renderer_deploy"] is False
    assert config["site_url"] == "https://news.leonaqt.com"
    result = render(config, "")
    assert result["renderer_deploy"] == "false"
    assert result["site_url"] == "https://news.leonaqt.com"


def test_renderer_deploy_off_needs_no_real_hostname():
    config = settings()
    config["site_url"] = PLACEHOLDER_SITE_URL
    result = render(config, "")
    assert result["renderer_deploy"] == "false"
    assert result["site_url"] == PLACEHOLDER_SITE_URL


def test_renderer_deploy_rejects_the_placeholder_hostname():
    config = settings()
    config.update(renderer_deploy=True, site_url=PLACEHOLDER_SITE_URL)
    with pytest.raises(ValueError):
        render(config, "")


def test_renderer_deploy_accepts_a_real_hostname():
    config = settings()
    config.update(renderer_deploy=True, site_url="https://news.leonaqt.com")
    result = render(config, "")
    assert result["renderer_deploy"] == "true"
    assert result["site_url"] == "https://news.leonaqt.com"


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
        {"renderer_deploy": "false"},
        {"site_url": "http://news.leonaqt.com"},
        {"site_url": "not a url"},
    ],
)
def test_rejects_malformed_release_settings(change):
    config = settings()
    config.update(change)
    with pytest.raises(ValueError):
        render(config, "LEONA_NEWS_OPENAI_API_KEY:1")


@pytest.mark.parametrize("secret", ["", "news-test-secret:7"])
def test_worker_deploy_preserves_core_key(tmp_path, secret):
    """Execute the real deploy shell with gcloud replaced by an argument recorder."""
    import os
    import re
    import subprocess

    import yaml

    workflow = yaml.safe_load((ROOT / ".github/workflows/deploy.yml").read_text())
    step = next(s for s in workflow["jobs"]["deploy"]["steps"] if s.get("name") == "deploy worker")
    script = step["run"].replace("${{ steps.news.outputs.openai_secret }}", secret)
    script = re.sub(r"\$\{\{.*?\}\}", "test-value", script)
    capture = tmp_path / "arguments"
    recorder = r"""gcloud() {
      printf '%s\0' "$@" >> "$NEWS_TEST_CAPTURE"
      if [ "$2" = services ]; then printf '%s\n' test-revision; fi
    }
"""
    env = dict(os.environ, NEWS_TEST_CAPTURE=str(capture), GITHUB_OUTPUT=str(tmp_path / "output"))
    subprocess.run(
        ["bash", "-e", "-c", recorder + script], env=env, check=True, capture_output=True
    )
    arguments = capture.read_bytes().decode().split("\0")
    bindings = arguments[arguments.index("--update-secrets") + 1].split(",")
    removed = arguments[arguments.index("--remove-env-vars") + 1].split(",")
    assert "OPENAI_API_KEY" not in removed
    assert all(binding.split("=", 1)[0] != "OPENAI_API_KEY" for binding in bindings)
    assert "SENTRY_DSN=SENTRY_DSN:latest" in bindings
    if secret:
        assert f"LEONA_NEWS_OPENAI_API_KEY={secret}" in bindings
    else:
        assert not any(binding.startswith("LEONA_NEWS_OPENAI_API_KEY=") for binding in bindings)
