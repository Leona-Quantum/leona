"""Meter every LLM call made by the durable circuit agent."""

from __future__ import annotations

import time
import logging
from uuid import UUID

from majorana_contracts import Scope
from majorana_contracts.enums import Stage, UsageKind
from majorana_llm import LLMClient, LLMRequest, LLMResponse

from majorana_api.db import AsyncSession
from majorana_api.repos import usage as usage_repo


_ROLE_STAGE = {
    "request_plan": Stage.PLAN,
    "agent_tool_call": Stage.GENERATE,
    "intent_alignment": Stage.VERIFY,
}

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
        started = time.monotonic()
        response = await self._delegate.complete(request, on_delta=on_delta)
        duration_ms = int((time.monotonic() - started) * 1000)
        stage = _ROLE_STAGE.get(request.schema_name, Stage.GENERATE)
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
            )
            await self._session.commit()
        except Exception:
            # The paid provider call already completed. Accounting failures are
            # operational alerts, not a reason to issue the same request again.
            await self._session.rollback()
            log.exception("LLM call succeeded but metering persistence failed")
        return response
