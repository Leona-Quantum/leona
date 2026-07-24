import type { RunProgressItem, RunProgressView } from "@majorana/ui";

export interface ProgressEvent {
  type: string;
  mode?: string;
  status?: string;
  stage?: string | null;
  message?: string;
  revision?: number;
  exit_code?: number;
  duration_ms?: number;
  decision?: string;
  artifact_id?: string;
  plan?: {
    algorithm?: string;
    framework?: string;
    qubits_estimate?: number;
  };
}

type ProgressStepId = "plan" | "generate" | "execute" | "review" | "save";

const STEP_ORDER: readonly ProgressStepId[] = [
  "plan",
  "generate",
  "execute",
  "review",
  "save",
];

const STEP_COPY: Record<ProgressStepId, { title: string; waiting: string }> = {
  plan: {
    title: "Plan",
    waiting: "Turn the request into a bounded circuit plan",
  },
  generate: {
    title: "Generate",
    waiting: "Write framework-native circuit code",
  },
  execute: {
    title: "Execute",
    waiting: "Run the candidate inside the sandbox",
  },
  review: {
    title: "Review",
    waiting: "Check request, code, and result alignment",
  },
  save: {
    title: "Save",
    waiting: "Package the private artifact and optional OpenQASM",
  },
};

const ERROR_STAGE: Record<string, ProgressStepId> = {
  plan: "plan",
  generate: "generate",
  screen: "execute",
  resource_estimate: "execute",
  simulate: "execute",
  final_execute: "execute",
  execute: "execute",
  verify: "review",
  review: "review",
  compile: "review",
  compiled_resource_estimate: "review",
  finalize: "review",
  export: "save",
  save: "save",
};

function failureHeadline(message: string | undefined, step: ProgressStepId): string {
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("rate_limit") || normalized.includes("rate limit") || normalized.includes("429")) {
    return "The model provider is temporarily rate-limited";
  }
  if (
    normalized.includes("credentials_missing")
    || normalized.includes("authentication_failed")
    || normalized.includes("client_unavailable")
  ) {
    return "The model provider is not configured";
  }
  if (normalized.includes("quota_exhausted")) {
    return "The model provider quota is unavailable";
  }
  if (normalized.includes("model_not_found")) {
    return "The configured model is unavailable";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "The provider did not respond before the timeout";
  }
  if (normalized.includes("provider call failed") || normalized.includes("provider unavailable")) {
    return "The model provider could not complete this step";
  }
  if (normalized.includes("candidate_budget_exhausted")) {
    return "The repair budget ended without an accepted candidate";
  }
  return `${STEP_COPY[step].title} could not complete`;
}

function lastEvent(events: readonly ProgressEvent[], type: string): ProgressEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

function eventIndex(events: readonly ProgressEvent[], type: string): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return index;
  }
  return -1;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function activeStep(
  events: readonly ProgressEvent[],
  terminal: ProgressEvent | null,
): ProgressStepId {
  const failure = lastEvent(events, "run.error");
  if (failure?.stage) {
    return ERROR_STAGE[failure.stage] ?? "review";
  }

  const review = lastEvent(events, "verification.semantic_review");
  if (review?.decision === "code_repair") return "generate";
  if (review?.decision === "replan") return "plan";
  if (review?.decision === "ready") return "save";
  if (review) return "review";

  const generatedIndex = eventIndex(events, "code.generated");
  const sandboxIndex = eventIndex(events, "sandbox.result");
  const sandbox = lastEvent(events, "sandbox.result");
  if (sandboxIndex > generatedIndex && sandbox?.exit_code !== 0) return "generate";
  if (sandboxIndex > generatedIndex) return "review";
  if (generatedIndex >= 0) return "execute";
  if (eventIndex(events, "plan.produced") >= 0) return "generate";
  return "plan";
}

function detailsFor(
  id: ProgressStepId,
  events: readonly ProgressEvent[],
  active: ProgressStepId,
): string {
  const plan = lastEvent(events, "plan.produced")?.plan;
  const generated = lastEvent(events, "code.generated");
  const sandbox = lastEvent(events, "sandbox.result");
  const review = lastEvent(events, "verification.semantic_review");
  const saved = lastEvent(events, "artifact.saved");

  if (id === "plan" && plan) {
    const parts = [
      plan.algorithm,
      plan.framework,
      plan.qubits_estimate !== undefined ? `${plan.qubits_estimate} qubits` : null,
    ].filter((part): part is string => Boolean(part));
    return parts.join(" · ") || "Plan ready";
  }
  if (id === "generate" && generated) {
    const revision = generated.revision ? `Revision ${generated.revision}` : "Candidate";
    if (active === "generate" && sandbox?.exit_code !== undefined && sandbox.exit_code !== 0) {
      return `${revision} needs repair after sandbox execution`;
    }
    if (active === "generate" && review?.decision === "code_repair") {
      return `${revision} needs repair after intent review`;
    }
    return `${revision} ready`;
  }
  if (id === "execute" && sandbox) {
    const duration = formatDuration(sandbox.duration_ms);
    if (sandbox.exit_code === 0) {
      return duration ? `Sandbox completed in ${duration}` : "Sandbox completed";
    }
    return `Sandbox exited with code ${sandbox.exit_code ?? "unknown"}`;
  }
  if (id === "review" && review) {
    if (review.decision === "ready") return "Request, code, and result are aligned";
    if (review.decision === "code_repair") return "Code repair requested";
    if (review.decision === "replan") return "A revised plan was requested";
    return "Review needs another bounded attempt";
  }
  if (id === "save" && saved?.artifact_id) return "Private artifact saved to Vault";
  return STEP_COPY[id].waiting;
}

export function runProgressFromEvents(
  events: readonly ProgressEvent[],
  running: boolean,
): RunProgressView | null {
  const queued = lastEvent(events, "run.queued");
  const hasCircuitActivity = events.some((event) =>
    [
      "plan.produced",
      "code.generated",
      "sandbox.result",
      "verification.semantic_review",
      "artifact.saved",
    ].includes(event.type),
  );
  if (!hasCircuitActivity && queued?.mode !== "execute") return null;

  const terminal = lastEvent(events, "run.finished");
  const error = lastEvent(events, "run.error");
  const current = activeStep(events, terminal);
  const currentIndex = STEP_ORDER.indexOf(current);
  const failed = terminal?.status === "failed" || Boolean(error);
  const cancelled = terminal?.status === "cancelled";
  const succeeded = terminal?.status === "succeeded";
  const generated = lastEvent(events, "code.generated");
  const sandbox = lastEvent(events, "sandbox.result");
  const review = lastEvent(events, "verification.semantic_review");
  const saved = lastEvent(events, "artifact.saved");
  const plan = lastEvent(events, "plan.produced");

  const establishedDone: Record<ProgressStepId, boolean> = {
    plan: Boolean(plan),
    generate: Boolean(generated) && current !== "generate",
    execute: sandbox?.exit_code === 0 && !["plan", "generate", "execute"].includes(current),
    review: review?.decision === "ready" && current === "save",
    save: Boolean(saved),
  };

  const items: RunProgressItem[] = STEP_ORDER.map((id, index) => {
    let state: RunProgressItem["state"] = establishedDone[id] ? "done" : "waiting";
    if (succeeded) state = id === "save" && !saved ? "stopped" : "done";
    else if (failed && index === currentIndex) state = "error";
    else if (cancelled && index === currentIndex) state = "stopped";
    else if (!terminal && running && index === currentIndex) state = "active";
    return {
      id,
      title: STEP_COPY[id].title,
      detail: succeeded && id === "save" && !saved
        ? "No artifact was saved"
        : detailsFor(id, events, current),
      state,
    };
  });

  const activeItem = items.find((item) => item.state === "active");
  const label = succeeded
    ? "Run complete"
    : failed
      ? "Run needs attention"
      : cancelled
        ? "Run stopped"
        : "Run in progress";
  const headline = succeeded
    ? saved
      ? "Circuit generated, executed, reviewed, and saved"
      : "Circuit generated, executed, and reviewed"
    : failed
      ? failureHeadline(error?.message, current)
      : cancelled
        ? "The run was cancelled before completion"
        : activeItem?.detail || STEP_COPY[current].waiting;

  return { label, headline, items };
}
