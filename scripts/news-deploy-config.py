"""Validate reviewed news settings before a migration or rollout; no secret values."""

import json
import os
import re
import uuid
from pathlib import Path


def render(config: dict, secret: str) -> dict[str, str]:
    flags = ("enabled", "public", "schedule_enabled", "auto_publish", "arxiv_enabled")
    expected = {
        *flags,
        "workspace_id",
        "editor_user_id",
        "daily_batch_limit",
        "interval_hours",
        "model",
        "image_model",
    }
    if set(config) != expected:
        raise ValueError("Unexpected or missing news configuration keys")
    for key in flags:
        if type(config[key]) is not bool:
            raise ValueError(f"{key} must be a boolean")
    for key, maximum in (("daily_batch_limit", 20), ("interval_hours", 24)):
        if type(config[key]) is not int or not 1 <= config[key] <= maximum:
            raise ValueError(f"Invalid {key}")
    for key in ("workspace_id", "editor_user_id"):
        if config[key] is not None:
            config[key] = str(uuid.UUID(config[key]))
    for key in ("model", "image_model"):
        if not isinstance(config[key], str) or not re.fullmatch(
            r"[a-zA-Z0-9._-]{1,100}", config[key]
        ):
            raise ValueError(f"Invalid {key}")
    if (
        any(config[key] for key in ("public", "schedule_enabled", "auto_publish"))
        and not config["enabled"]
    ):
        raise ValueError("News must be enabled before publication or scheduling")
    if config["enabled"] and not config["workspace_id"]:
        raise ValueError("An existing newsroom workspace UUID is required")
    if config["schedule_enabled"] and not config["editor_user_id"]:
        raise ValueError("Scheduling requires an existing administrator UUID")
    if config["enabled"] and not re.fullmatch(r"[a-zA-Z0-9_-]+:[1-9][0-9]*", secret):
        raise ValueError(
            "Set LEONA_NEWS_OPENAI_SECRET_VERSION to an existing Secret Manager name:numeric-version"
        )

    def value(v):
        return str(v).lower() if isinstance(v, bool) else str(v)

    common = {"enabled", "workspace_id", "daily_batch_limit"}

    def encode(keys):
        return ",".join(
            f"LEONA_NEWS_{key.upper()}={value(config[key])}"
            for key in sorted(keys)
            if config[key] is not None
        )

    return {
        "api_env": encode(common | {"public"}),
        "worker_env": encode(expected - {"public"}),
        "openai_secret": secret if config["enabled"] else "",
    }


if __name__ == "__main__":
    settings = json.loads(Path("infra/news.json").read_text())
    result = render(settings, os.environ.get("LEONA_NEWS_OPENAI_SECRET_VERSION", ""))
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a") as stream:
            for key, content in result.items():
                stream.write(f"{key}={content}\n")
    else:
        print("News deployment configuration is valid")
