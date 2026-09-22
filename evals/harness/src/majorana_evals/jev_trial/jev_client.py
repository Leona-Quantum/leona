"""A real HTTP client for Jev (TypeSafe AI), built from primary sources only:

- https://typesafe.ai/                         (product page: pricing, early access)
- https://docs.typesafe.ai/introduction/quickstart   (base URL, auth header, example call)
- https://docs.typesafe.ai/primitives                (Choice/Score/Noul request schemas)
- https://docs.typesafe.ai/models                    (model aliases, rate limits, token
  limits)
- https://docs.typesafe.ai/api.md                    (error codes)
- https://typesafe.ai/legal/privacy-policy            (data-retention statement)
- https://www.langchain.com/blog/building-a-harness-with-jev  (a second, independent
  worked example confirming the request/response shape and the `TYPESAFE_API_KEY`
  env var name)

Confirmed (2026-09-21, docs read without an early-access login — they were publicly
reachable):

- Base URL: `https://api.typesafe.ai/v1/systemone`
- Auth: `Authorization: Bearer <key>`
- Request: `{"model": "jev-latest", "state": <str|object|array, <=32k tokens>,
  "questions": {<id>: {"type": "choice"|"score"|"noul", "instructions": <str>,
  "criteria": <dict for choice, list for score, optional for noul>}}}`
  (combined budget 64k tokens per request).
- Response: `{"model": "jev-<version>", "answers": {<id>: {"type", ...}},
  "usage": {"input_tokens", "output_tokens"}}`. A `"choice"` answer carries
  `"choice"`, `"confidence"`, `"probabilities"` (one per criterion key).
- Models: `jev-latest`/`jev-preview` both alias the single current model
  (`jev-1.13.0` as of the docs read); no separate "trial" or "free" tier model.
- Rate limits: 250,000 tokens/second, 1,200 requests/minute (docs: "subject to
  change during high-demand periods").
- Pricing: $42 / billion input tokens; output is not billed (typesafe.ai homepage).
- Data retention: "We will not train or fine tune any artificial intelligence or
  machine learning model on your prompts or other Input" and "We will not disclose
  any Input to a third party other than our service providers" (privacy policy).

NOT confirmed, and NOT guessed at:

- **Whether the API is "OpenAI-compatible."** The research that fed ai-ops#358
  (`ai-ops/desk/leona/plans/strategy-20260921/benchmarks-and-jev.md` §4) describes it
  that way, but the primary docs contradict it: the endpoint path
  (`/v1/systemone`, not `/v1/chat/completions`), the request body (`state`/
  `questions`/`answers`, not `messages`/`choices`), and the api.md error-code page
  make no OpenAI-compatibility claim anywhere. This client speaks Jev's own
  documented shape, not an OpenAI-compatible one — see ai-ops#358's own comment
  thread for this discrepancy, which the owner should see rather than have silently
  resolved by picking one source over the other.
- Whether the docs above require an early-access login for content BEYOND what was
  read here — they did not, as read; a real call may still 401 without an active
  early-access account even though the account exists (issue text: "i have created
  account").
- Concrete error-response JSON body shape (the docs describe the HTTP status codes
  — 401/422/429/529 — but not a worked error body).
- Any SLA / uptime terms, or a support/escalation contact.

This module makes zero network calls at import time, and `JevClient.ask` refuses to
run at all without `TYPESAFE_API_KEY` in the environment — see `JevKeyMissing`."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Literal

#: The LangChain integration blog (see module docstring) is the only source that
#: names an env var at all, and this is what it uses for the TypeSafe SDK. The
#: primary docs.typesafe.ai quickstart uses the same name in its own example
#: (`$TYPESAFE_API_KEY`) — see the curl example this client's request mirrors.
JEV_API_KEY_ENV_VAR = "TYPESAFE_API_KEY"

JEV_BASE_URL = "https://api.typesafe.ai/v1/systemone"
JEV_DEFAULT_MODEL = "jev-latest"

QuestionType = Literal["choice", "score", "noul"]


class JevKeyMissing(RuntimeError):
    """`TYPESAFE_API_KEY` is not set. The harness must refuse to call the network
    when this is raised — never fall back to a default, a placeholder, or another
    env var the operator did not name."""


@dataclass(frozen=True)
class JevChoiceQuestion:
    """A single "choice" question: which of `criteria`'s keys best fits `state`,
    per Jev's own `/primitives` schema (module docstring)."""

    instructions: str
    #: option key -> the option's own description text (what the finder-rank.mts
    #: candidate's title+description supplies for this trial).
    criteria: dict[str, str]


def _method_ranking_request(
    *, state: str, question_id: str, question: JevChoiceQuestion, model: str
) -> dict[str, Any]:
    return {
        "model": model,
        "state": state,
        "questions": {
            question_id: {
                "type": "choice",
                "instructions": question.instructions,
                "criteria": question.criteria,
            }
        },
    }


@dataclass(frozen=True)
class JevChoiceAnswer:
    choice: str
    confidence: float
    probabilities: dict[str, float]


@dataclass(frozen=True)
class JevAskResult:
    model: str
    answer: JevChoiceAnswer
    input_tokens: int
    output_tokens: int
    raw: dict[str, Any] = field(repr=False)


def require_api_key(env: dict[str, str]) -> str:
    """Reads `TYPESAFE_API_KEY` from `env` (pass `os.environ` in real use — an
    explicit mapping so tests never depend on the real process environment).
    Raises `JevKeyMissing` rather than returning None, so a caller cannot
    accidentally treat a missing key as "use no auth"."""

    key = env.get(JEV_API_KEY_ENV_VAR, "").strip()
    if not key:
        raise JevKeyMissing(
            f"{JEV_API_KEY_ENV_VAR} is not set. The operator loads it from "
            "~/Developer/projects/leona-secrets/llm-keys.txt into the environment "
            "before running --ranker live-jev; this harness will not call the "
            "network without it, and never looks for the key anywhere else."
        )
    return key


class JevClient:
    """A thin, single-endpoint HTTP client. Uses `urllib.request` (stdlib) rather
    than adding a new dependency for one occasional POST call — this client is only
    ever constructed for `--ranker live-jev`, gated behind `require_api_key`."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = JEV_BASE_URL,
        model: str = JEV_DEFAULT_MODEL,
        timeout_s: float = 30.0,
    ):
        if not api_key:
            raise JevKeyMissing("JevClient constructed with an empty api_key")
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._timeout_s = timeout_s

    def ask_choice(
        self, *, state: str, question_id: str, question: JevChoiceQuestion
    ) -> JevAskResult:
        """Never prints, logs, or includes `self._api_key` in any exception message —
        network/HTTP errors below surface status/body only."""

        body = json.dumps(
            _method_ranking_request(
                state=state, question_id=question_id, question=question, model=self._model
            )
        ).encode("utf-8")
        req = urllib.request.Request(
            self._base_url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout_s) as resp:
                raw_response = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Jev returned HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Jev request failed: {exc.reason}") from exc

        answers = raw_response.get("answers", {})
        if question_id not in answers:
            raise RuntimeError(f"Jev response missing answer for {question_id!r}: {raw_response}")
        raw_answer = answers[question_id]
        if raw_answer.get("type") != "choice":
            raise RuntimeError(f"expected a 'choice' answer, got: {raw_answer}")

        usage = raw_response.get("usage", {})
        return JevAskResult(
            model=raw_response.get("model", self._model),
            answer=JevChoiceAnswer(
                choice=raw_answer["choice"],
                confidence=float(raw_answer["confidence"]),
                probabilities={k: float(v) for k, v in raw_answer.get("probabilities", {}).items()},
            ),
            input_tokens=int(usage.get("input_tokens", 0)),
            output_tokens=int(usage.get("output_tokens", 0)),
            raw=raw_response,
        )
