"""Exercise the real OpenAI SDK against a local HTTP transport, without paid calls."""

import base64
import io
import json

import httpx
import pytest
from openai import AsyncOpenAI
from PIL import Image
from majorana_api.news_models import Review
from majorana_worker.news_pipeline import OpenAIEditor


def response_payload(text, *, search=False, status="completed"):
    annotations = (
        [
            {
                "type": "url_citation",
                "url": url,
                "title": "Research source",
                "start_index": 0,
                "end_index": 5,
            }
            for url in ["https://example.org/research", "https://example.net/analysis"]
        ]
        if search
        else []
    )
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1,
        "status": status,
        "model": "test-model",
        "output": [
            {
                "id": "msg_test",
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": annotations}],
            }
        ],
        "usage": {
            "input_tokens": 50,
            "output_tokens": 60,
            "total_tokens": 110,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 0},
        },
    }


@pytest.mark.asyncio
async def test_provider_request_shapes_and_citations(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-not-real")
    monkeypatch.setenv("LEONA_NEWS_MODEL", "test-model")
    monkeypatch.setenv("LEONA_NEWS_IMAGE_MODEL", "test-image")
    seen = []

    def transport(request):
        body = json.loads(request.content)
        seen.append(body)
        if request.url.path.endswith("/images/generations"):
            img = io.BytesIO()
            Image.new("RGB", (640, 480), "blue").save(img, format="PNG")
            return httpx.Response(
                200,
                json={
                    "created": 1,
                    "data": [{"b64_json": base64.b64encode(img.getvalue()).decode()}],
                },
            )
        if body.get("tools"):
            return httpx.Response(
                200, json=response_payload("Research evidence from two sources.", search=True)
            )
        return httpx.Response(
            200,
            json=response_payload(
                json.dumps(
                    {
                        "verdict": "hold",
                        "blockers": ["Unverified claim"],
                        "notes": "There are facts that still need verification.",
                        "checked_source_ids": ["s1"],
                    }
                )
            ),
        )

    editor = OpenAIEditor()
    await editor.close()
    editor.client = AsyncOpenAI(
        api_key="test-not-real",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    research = await editor.research("Investigate quantum news")
    assert len(research["sources"]) == 2
    review, _ = await editor.structured("Review this evidence", Review)
    assert review.verdict == "hold"
    assert (await editor.image("A quantum processor")).startswith(b"RIFF")
    await editor.close()
    assert seen[0]["tools"] == [{"type": "web_search"}]
    assert seen[0]["store"] is False and seen[0]["max_tool_calls"] == 4
    assert seen[1]["text"]["format"]["type"] == "json_schema"
    assert seen[1]["text"]["format"]["strict"] is True
    assert seen[2]["output_format"] == "webp" and seen[2]["n"] == 1


@pytest.mark.asyncio
async def test_incomplete_response_fails_closed(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-not-real")
    monkeypatch.setenv("LEONA_NEWS_MODEL", "test-model")
    editor = OpenAIEditor()
    await editor.close()
    editor.client = AsyncOpenAI(
        api_key="test-not-real",
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json=response_payload("truncated", search=True, status="incomplete")
                )
            )
        ),
    )
    with pytest.raises(ValueError, match="incomplete"):
        await editor.research("Find news")
    await editor.close()
