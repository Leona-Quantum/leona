"""majorana-llm — LLM client, per-stage model constants, system prompts, and
structured-output parsing for the pipeline (plans/rebuild/08-phases.md §Phase 2
step 3). The pipeline depends only on the LLMClient protocol; FakeLLM and
AnthropicLLM are drop-in swappable."""

from majorana_llm.client import (
    AnthropicLLM,
    FakeLLM,
    LLMClient,
    LLMRequest,
    LLMResponse,
    OpenAICompatibleLLM,
    default_llm,
    endpoint_for,
)
from majorana_llm.models import model_for, resolve_provider
from majorana_llm.parsing import (
    FINAL_QASM_BEGIN,
    FINAL_QASM_END,
    FINAL_QASM_ERROR,
    QasmExtraction,
    StageOutputError,
    extract_code,
    extract_qasm,
    extract_qasm_with_provenance,
    parse_plan,
)
from majorana_llm.prompts import (
    CRITIC_SYSTEM_PROMPT,
    FRAMEWORK_DIRECTIVE,
    GENERATE_SYSTEM_PROMPT,
    PLAN_SYSTEM_PROMPT,
    STAGE_PROMPTS,
    WRITEBACK_SYSTEM_PROMPT,
)
from majorana_llm.research import ResearchResult, ResearchSource, research_for_prompt

__all__ = [
    "LLMClient",
    "LLMRequest",
    "LLMResponse",
    "FakeLLM",
    "AnthropicLLM",
    "OpenAICompatibleLLM",
    "default_llm",
    "endpoint_for",
    "model_for",
    "resolve_provider",
    "parse_plan",
    "extract_code",
    "extract_qasm",
    "extract_qasm_with_provenance",
    "QasmExtraction",
    "FINAL_QASM_BEGIN",
    "FINAL_QASM_END",
    "FINAL_QASM_ERROR",
    "StageOutputError",
    "PLAN_SYSTEM_PROMPT",
    "GENERATE_SYSTEM_PROMPT",
    "CRITIC_SYSTEM_PROMPT",
    "WRITEBACK_SYSTEM_PROMPT",
    "FRAMEWORK_DIRECTIVE",
    "STAGE_PROMPTS",
    "ResearchResult",
    "ResearchSource",
    "research_for_prompt",
]
