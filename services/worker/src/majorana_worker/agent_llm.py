"""Meter every LLM call made by the durable circuit agent."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from uuid import UUID, uuid5

from majorana_contracts import Scope
from majorana_contracts.enums import Stage, UsageKind
from majorana_llm import LLMClient, LLMRequest, LLMResponse

from majorana_api.db import AsyncSession
from majorana_api.repos import agent as agent_repo
from majorana_api.repos import usage as usage_repo


_ROLE_STAGE = {
    "request_plan": Stage.PLAN,
    "reference_audit": Stage.PLAN,
    "agent_tool_call": Stage.GENERATE,
    "generate_circuit": Stage.GENERATE,
    "generate_qapp": Stage.GENERATE,
    "intent_alignment": Stage.VERIFY,
    "explain_result": Stage.ANALYZE,
    "research_triage": Stage.PLAN,
    # The notebook lane (leona_notebooks / majorana_worker.notebook_handlers).
    # Mirrors `_STAGE_MAP` in notebook_handlers.py — same reasoning: no
    # `Stage` member names a notebook stage, so each request's `schema_name`
    # (== its LLM role) is classified onto the closest existing one.
    "notebook_outline": Stage.PLAN,
    "notebook_draft": Stage.GENERATE,
    "notebook_repair": Stage.GENERATE,
    "notebook_revise": Stage.GENERATE,
    "notebook_review": Stage.VERIFY,
}

_LIVE_DELTA_CHARS = 160

log = logging.getLogger("majorana_worker.agent_llm")


class MeteredAgentLLM:
    def __init__(
        self,
        *,
        delegate: LLMClient,
        sink,
        scope: Scope,
        session: AsyncSession,
        run_id: UUID,
    ) -> None:
        self._delegate = delegate
        self._sink = sink
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def complete(self, request: LLMRequest, *, on_delta=None) -> LLMResponse:
        request_fingerprint = hashlib.sha256(
            json.dumps(
                request.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        call_id = uuid5(self._run_id, request_fingerprint)
        stored = await agent_repo.get_llm_call(
            self._scope, self._session, self._run_id, request_fingerprint
        )
        stage = _ROLE_STAGE.get(request.schema_name, Stage.GENERATE)
        delta_buffers = {"reasoning": "", "output": ""}

        async def flush_deltas() -> None:
            for kind, text in delta_buffers.items():
                if text:
                    delta_buffers[kind] = ""
                    await self._sink.emit(
                        "llm.delta",
                        {"stage": stage, "kind": kind, "text": text},
                    )

        async def stream_delta(text: str, kind: str) -> None:
            normalized_kind = kind if kind in delta_buffers else "output"
            if not text:
                return
            # Only generation deltas are useful to the circuit Run UI. Plans and
            # reviews are structured control records, not user-facing prose.
            if stage is Stage.GENERATE:
                delta_buffers[normalized_kind] += text
                while len(delta_buffers[normalized_kind]) >= _LIVE_DELTA_CHARS:
                    chunk = delta_buffers[normalized_kind][:_LIVE_DELTA_CHARS]
                    delta_buffers[normalized_kind] = delta_buffers[normalized_kind][
                        _LIVE_DELTA_CHARS:
                    ]
                    await self._sink.emit(
                        "llm.delta",
                        {"stage": stage, "kind": normalized_kind, "text": chunk},
                    )
            if on_delta is not None:
                await on_delta(text, normalized_kind)

        if stored is None:
            started = time.monotonic()
            try:
                response = await self._delegate.complete(
                    request,
                    # The provider only enables its stream when it receives a handler.
                    # Keep all other circuit calls non-streaming unless their caller
                    # explicitly needs deltas.
                    on_delta=stream_delta
                    if request.schema_name == "generate_circuit" or on_delta is not None
                    else None,
                )
            finally:
                # Preserve any safely received prefix if the provider disconnects.
                await flush_deltas()
            duration_ms = int((time.monotonic() - started) * 1000)
            stored = await agent_repo.add_llm_call(
                self._scope,
                self._session,
                self._run_id,
                call_id=call_id,
                request_fingerprint=request_fingerprint,
                response=response.model_dump(mode="json"),
                duration_ms=duration_ms,
            )
            # The response is the durable inbox for accounting retries.
            await self._session.commit()
        else:
            response = LLMResponse.model_validate(stored.response)
            duration_ms = stored.duration_ms
        if stored.metered:
            return response
        try:
            await self._sink.emit(
                "llm.call",
                {
                    "stage": stage,
                    "model": response.model,
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "duration_ms": duration_ms,
                },
                event_id=uuid5(call_id, "llm.call"),
            )
            await usage_repo.record_usage(
                self._scope,
                self._session,
                kind=UsageKind.LLM_TOKENS,
                quantity=response.input_tokens + response.output_tokens,
                meta={
                    "model": response.model,
                    "role": request.schema_name,
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "run_id": str(self._run_id),
                },
                event_id=uuid5(call_id, "usage"),
            )
            await agent_repo.mark_llm_call_metered(
                self._scope, self._session, self._run_id, call_id
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            log.exception("LLM response persisted but metering reconciliation failed")
            raise
        return response
