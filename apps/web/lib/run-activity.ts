import type {
  AgentActivityIcon,
  AgentActivityItem,
  AgentActivityState,
  AgentActivityView,
} from "@majorana/ui";

export interface RunActivityEvent {
  type: string;
  seq?: number;
  ts?: string;
  mode?: string;
  stage?: string | null;
  status?: string;
  message?: string;
  reason_code?: string | null;
  duration_ms?: number;
  revision?: number;
  code?: string;
  language?: string;
  phase?: string;
  exit_code?: number;
  lint_ok?: boolean;
  typecheck_ok?: boolean;
  method?: string;
  result?: unknown;
  decision?: string;
  accepted?: boolean;
  artifact_id?: string;
  candidates_considered?: number;
  critic_summary?: string | null;
  summary?: string;
  plan?: {
    problem_summary?: string;
    framework?: string;
    algorithm?: string;
  };
  metrics?: Record<string, unknown>;
}

export interface RunAttemptSummary {
  revision: number;
  state: AgentActivityState;
  status: string;
  eventIndex: number;
}

export type RunActivityDetail =
  | {
      kind: "plan";
      eventIndices: number[];
      callIndex: number | null;
    }
  | {
      kind: "code";
      eventIndex: number | null;
      callIndex: number | null;
      bestEffortIndex: number | null;
      attempts: RunAttemptSummary[];
    }
  | {
      kind: "checks";
      screenIndex: number | null;
      resourceIndex: number | null;
    }
  | {
      kind: "execution";
      eventIndex: number | null;
    }
  | {
      kind: "verification";
      eventIndices: number[];
      reviewIndex: number | null;
      strictIndex: number | null;
    }
  | {
      kind: "compilation";
      eventIndex: number | null;
      resourceIndex: number | null;
    }
  | {
      kind: "finalize";
      eventIndices: number[];
      bestEffortIndex: number | null;
    };

export type RunActivityItem = AgentActivityItem<RunActivityDetail>;
export type RunActivityView = AgentActivityView<RunActivityDetail>;

type ActivityId =
  | "plan"
  | "code"
  | "checks"
  | "execution"
  | "verification"
  | "compilation"
  | "finalize";

const ERROR_ACTIVITY: Record<string, ActivityId> = {
  plan: "plan",
  generate: "code",
  screen: "checks",
  resource_estimate: "checks",
  simulate: "execution",
  execute: "execution",
  verify: "verification",
  review: "verification",
  compile: "compilation",
  compiled_resource_estimate: "compilation",
  finalize: "finalize",
  final_execute: "finalize",
  baseline: "finalize",
  analyze: "finalize",
  export: "finalize",
  save: "finalize",
};

function lastIndex(
  events: readonly RunActivityEvent[],
  predicate: (event: RunActivityEvent, index: number) => boolean,
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index], index)) return index;
  }
  return -1;
}

function indicesOf(
  events: readonly RunActivityEvent[],
  predicate: (event: RunActivityEvent, index: number) => boolean,
): number[] {
  const indices: number[] = [];
  events.forEach((event, index) => {
    if (predicate(event, index)) indices.push(index);
  });
  return indices;
}

function eventAt(
  events: readonly RunActivityEvent[],
  index: number,
): RunActivityEvent | null {
  return index >= 0 ? events[index] ?? null : null;
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function stageDuration(
  events: readonly RunActivityEvent[],
  ...stages: string[]
): string | undefined {
  const index = lastIndex(
    events,
    (event) => event.type === "stage.finished" && Boolean(event.stage && stages.includes(event.stage)),
  );
  return formatDuration(eventAt(events, index)?.duration_ms);
}

function latestCallIndex(
  events: readonly RunActivityEvent[],
  beforeIndex: number,
  ...stages: string[]
): number | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "llm.call" && event.stage && stages.includes(event.stage)) {
      return index;
    }
  }
  return null;
}

function openStage(events: readonly RunActivityEvent[]): string | null {
  let stage: string | null = null;
  for (const event of events) {
    if (event.type === "stage.started" && event.stage) stage = event.stage;
    if (event.type === "stage.finished" && event.stage === stage) stage = null;
    if (event.type === "run.finished") stage = null;
  }
  return stage;
}

function verificationOutcome(event: RunActivityEvent): string {
  return typeof event.result === "string" ? event.result : "unavailable";
}

function attemptSummaries(
  events: readonly RunActivityEvent[],
  codeIndices: readonly number[],
  bestEffortIndex: number,
  activeId: ActivityId | null,
  terminalFailed: boolean,
): RunAttemptSummary[] {
  const bestEffort = eventAt(events, bestEffortIndex);

  return codeIndices.map((eventIndex, position) => {
    const code = events[eventIndex];
    const revision = code.revision ?? position + 1;
    const end = codeIndices[position + 1] ?? events.length;
    const segment = events.slice(eventIndex + 1, end);
    const sandbox = [...segment].reverse().find(
      (event) => event.type === "sandbox.result" && event.phase !== "final",
    );
    const review = [...segment].reverse().find(
      (event) => event.type === "verification.semantic_review",
    );
    const checks = segment.filter((event) => event.type === "verification.result");
    const checkFailed = checks.some((event) => ["fail", "error"].includes(verificationOutcome(event)));
    const hasLaterAttempt = position < codeIndices.length - 1;
    const isLatest = !hasLaterAttempt;

    if (isLatest && activeId === "code") {
      return { revision, state: "active", status: "Repairing", eventIndex };
    }
    if (bestEffort && bestEffort.revision === revision) {
      return { revision, state: "warn", status: "Best available", eventIndex };
    }
    if (sandbox?.exit_code !== undefined && sandbox.exit_code !== 0) {
      return {
        revision,
        state: hasLaterAttempt ? "warn" : terminalFailed ? "error" : "warn",
        status: hasLaterAttempt ? "Repair requested" : "Sandbox failed",
        eventIndex,
      };
    }
    if (review?.decision === "code_repair" || review?.decision === "replan" || checkFailed) {
      return {
        revision,
        state: hasLaterAttempt ? "warn" : terminalFailed ? "error" : "warn",
        status: hasLaterAttempt ? "Repair requested" : "Verification failed",
        eventIndex,
      };
    }
    return {
      revision,
      state: "done",
      status: isLatest ? "Selected" : "Completed",
      eventIndex,
    };
  });
}

function activeActivity(
  events: readonly RunActivityEvent[],
  running: boolean,
  latestCodeIndex: number,
): ActivityId | null {
  if (!running || lastIndex(events, (event) => event.type === "run.finished") >= 0) {
    return null;
  }

  const stage = openStage(events);
  if (stage === "plan") return "plan";
  if (stage === "generate") return "code";
  if (stage === "screen" || stage === "resource_estimate") return "checks";
  if (stage === "verify") {
    const sandboxAfterCode = lastIndex(
      events,
      (event, index) =>
        index > latestCodeIndex
        && event.type === "sandbox.result"
        && event.phase !== "final",
    );
    return sandboxAfterCode >= 0 ? "verification" : "execution";
  }
  if (stage === "compile" || stage === "compiled_resource_estimate") return "compilation";
  if (["finalize", "final_execute", "baseline", "analyze", "save", "export"].includes(stage ?? "")) {
    return "finalize";
  }

  const reviewIndex = lastIndex(events, (event) => event.type === "verification.semantic_review");
  const review = eventAt(events, reviewIndex);
  if (review?.decision === "replan") return "plan";
  if (review?.decision === "code_repair") return "code";

  const sandboxIndex = lastIndex(
    events,
    (event) => event.type === "sandbox.result" && event.phase !== "final",
  );
  const sandbox = eventAt(events, sandboxIndex);
  if (
    sandboxIndex > latestCodeIndex
    && sandbox?.exit_code !== undefined
    && sandbox.exit_code !== 0
  ) {
    return "code";
  }
  if (latestCodeIndex >= 0 && sandboxIndex < latestCodeIndex) return "checks";
  if (latestCodeIndex >= 0) return "execution";
  if (lastIndex(events, (event) => event.type === "plan.produced") >= 0) return "code";
  return "plan";
}

function activeHeadline(
  activeId: ActivityId | null,
  stage: string | null,
  nextRevision: number,
): string {
  if (activeId === "plan") return "Understanding the request and choosing an approach";
  if (activeId === "code") return `Writing candidate revision ${nextRevision}`;
  if (activeId === "checks") {
    return stage === "resource_estimate"
      ? "Estimating circuit resources"
      : "Checking the generated program";
  }
  if (activeId === "execution") return "Running the candidate in the sandbox";
  if (activeId === "verification") return "Checking the result against the declared evidence";
  if (activeId === "compilation") return "Compiling the circuit without changing its behavior";
  if (activeId === "finalize") {
    if (stage === "final_execute") return "Re-running the final program";
    if (stage === "baseline") return "Comparing against the reference baseline";
    if (stage === "analyze") return "Summarizing the measured result";
    if (stage === "save") return "Packaging the final result";
    return "Preparing the final output";
  }
  return "Replaying recorded activity";
}

function failureHeadline(error: RunActivityEvent | null): string {
  const message = `${error?.reason_code ?? ""} ${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  if (message.includes("rate_limit") || message.includes("rate limit") || message.includes("429")) {
    return "The model provider is temporarily rate-limited";
  }
  if (
    message.includes("credential")
    || message.includes("authentication")
    || message.includes("client_unavailable")
  ) {
    return "The model provider is not configured";
  }
  if (message.includes("quota_exhausted")) return "The model provider quota is unavailable";
  if (message.includes("model_not_found")) return "The configured model is unavailable";
  if (message.includes("timeout") || message.includes("timed out")) {
    return "A required provider did not respond before the timeout";
  }
  if (message.includes("candidate_budget_exhausted")) {
    return "No candidate met every acceptance check";
  }
  return "The run stopped before every required step completed";
}

function item(
  id: ActivityId,
  icon: AgentActivityIcon,
  label: string,
  title: string,
  state: AgentActivityState,
  status: string,
  detail: RunActivityDetail,
  meta?: string,
  defaultOpen?: boolean,
): RunActivityItem {
  return {
    id,
    icon,
    label,
    title,
    state,
    status,
    detail,
    ...(meta ? { meta } : {}),
    ...(defaultOpen !== undefined ? { defaultOpen } : {}),
  };
}

export function runActivityFromEvents(
  events: readonly RunActivityEvent[],
  running: boolean,
): RunActivityView | null {
  const queued = eventAt(events, lastIndex(events, (event) => event.type === "run.queued"));
  const hasCircuitActivity = events.some((event) =>
    [
      "plan.produced",
      "code.generated",
      "screen.result",
      "resource.estimate",
      "sandbox.result",
      "verification.result",
      "verification.semantic_review",
      "compilation.result",
      "code.finalized",
      "run.best_effort",
      "artifact.saved",
    ].includes(event.type),
  );
  if (!hasCircuitActivity && queued?.mode !== "execute") return null;

  const terminalIndex = lastIndex(events, (event) => event.type === "run.finished");
  const terminal = eventAt(events, terminalIndex);
  const terminalFailed = terminal?.status === "failed";
  const terminalSucceeded = terminal?.status === "succeeded";
  const terminalCancelled = terminal?.status === "cancelled";
  const errorIndex = lastIndex(events, (event) => event.type === "run.error");
  const error = eventAt(events, errorIndex);
  const bestEffortIndex = lastIndex(events, (event) => event.type === "run.best_effort");
  const bestEffort = eventAt(events, bestEffortIndex);
  const codeIndices = indicesOf(events, (event) => event.type === "code.generated");
  const latestCodeIndex = codeIndices.at(-1) ?? -1;
  const latestCode = eventAt(events, latestCodeIndex);
  const effectiveRevision = Math.max(
    latestCode?.revision ?? codeIndices.length,
    bestEffort?.revision ?? 0,
  );
  const activeId = activeActivity(events, running, latestCodeIndex);
  const stage = openStage(events);
  const nextRevision = Math.max(1, effectiveRevision + (activeId === "code" ? 1 : 0));
  const failedId = error?.stage ? ERROR_ACTIVITY[error.stage] ?? "verification" : null;
  const items: RunActivityItem[] = [];

  const planIndices = indicesOf(events, (event) => event.type === "plan.produced");
  const planIndex = planIndices.at(-1) ?? -1;
  const plan = eventAt(events, planIndex);
  if (plan || activeId === "plan" || queued?.mode === "execute") {
    const state: AgentActivityState = activeId === "plan"
      ? "active"
      : failedId === "plan"
        ? "error"
        : "done";
    items.push(item(
      "plan",
      "plan",
      planIndices.length > 1 ? "Revised plan" : "Plan",
      plan?.plan?.problem_summary
        ?? (state === "active"
          ? "Choosing an algorithm and evidence plan"
          : state === "error"
            ? "No complete circuit plan was recorded"
            : "Circuit plan recorded"),
      state,
      state === "active" ? "Planning" : state === "error" ? "Needs attention" : "Complete",
      {
        kind: "plan",
        eventIndices: planIndices,
        callIndex: planIndex >= 0 ? latestCallIndex(events, planIndex, "plan") : null,
      },
      stageDuration(events, "plan"),
    ));
  }

  if (latestCode || activeId === "code" || failedId === "code" || bestEffort) {
    const attempts = attemptSummaries(
      events,
      codeIndices,
      bestEffortIndex,
      activeId,
      terminalFailed,
    );
    const state: AgentActivityState = activeId === "code"
      ? "active"
      : failedId === "code"
        ? "error"
        : bestEffort
          ? "warn"
          : "done";
    const framework = plan?.plan?.framework;
    const considered = bestEffort?.candidates_considered;
    const title = state === "active"
      ? effectiveRevision > 0
        ? `Repairing the ${framework ?? "framework-native"} candidate`
        : `Writing a ${framework ?? "framework-native"} candidate`
      : state === "error" && !latestCode
        ? "No candidate source was recorded"
      : considered
        ? `${considered} candidates considered; revision ${effectiveRevision} retained`
        : codeIndices.length > 1
          ? `${codeIndices.length} revisions produced during repair`
          : `${framework ?? latestCode?.language ?? "Framework-native"} source produced`;
    items.push(item(
      "code",
      "code",
      "Generated code",
      title,
      state,
      state === "active"
        ? `Writing revision ${nextRevision}`
        : state === "error"
          ? "Generation failed"
          : bestEffort
            ? `Revision ${effectiveRevision}`
            : `Revision ${Math.max(1, effectiveRevision)}`,
      {
        kind: "code",
        eventIndex: latestCodeIndex >= 0 ? latestCodeIndex : null,
        callIndex: latestCodeIndex >= 0
          ? latestCallIndex(events, latestCodeIndex, "generate")
          : null,
        bestEffortIndex: bestEffortIndex >= 0 ? bestEffortIndex : null,
        attempts,
      },
      stageDuration(events, "generate"),
    ));
  }

  const screenIndex = lastIndex(
    events,
    (event, index) => index > latestCodeIndex && event.type === "screen.result",
  );
  const resourceIndex = lastIndex(
    events,
    (event, index) =>
      index > latestCodeIndex
      && event.type === "resource.estimate"
      && event.phase !== "compiled",
  );
  const screen = eventAt(events, screenIndex);
  const checksPresent = screenIndex >= 0 || resourceIndex >= 0;
  if (checksPresent || activeId === "checks" || failedId === "checks") {
    const failed = screen?.lint_ok === false || screen?.typecheck_ok === false;
    const state: AgentActivityState = activeId === "checks"
      ? "active"
      : failed || failedId === "checks"
        ? "error"
        : "done";
    items.push(item(
      "checks",
      "check",
      "Code quality and resources",
      state === "active"
        ? "Inspecting the program before execution"
        : state === "error"
          ? "The pre-execution checks did not complete"
        : resourceIndex >= 0
          ? "Static checks passed and resources were bounded"
          : failed
            ? "Static checks found a blocking issue"
            : "Static checks completed",
      state,
      state === "active" ? "Checking" : state === "error" ? "Needs repair" : "Passed",
      {
        kind: "checks",
        screenIndex: screenIndex >= 0 ? screenIndex : null,
        resourceIndex: resourceIndex >= 0 ? resourceIndex : null,
      },
      stageDuration(events, "screen", "resource_estimate"),
    ));
  }

  const executionIndex = lastIndex(
    events,
    (event, index) =>
      index > latestCodeIndex
      && event.type === "sandbox.result"
      && event.phase !== "final",
  );
  const execution = eventAt(events, executionIndex);
  if (execution || activeId === "execution" || failedId === "execution") {
    const failed = execution?.exit_code !== undefined && execution.exit_code !== 0;
    const state: AgentActivityState = activeId === "execution"
      ? "active"
      : failed || failedId === "execution"
        ? "error"
        : "done";
    items.push(item(
      "execution",
      "run",
      "Sandbox execution",
      state === "active"
        ? `Running revision ${Math.max(1, effectiveRevision)} in the isolated sandbox`
        : state === "error"
          ? `Revision ${Math.max(1, effectiveRevision)} exited with an error`
          : `Revision ${Math.max(1, effectiveRevision)} produced a structured result`,
      state,
      state === "active" ? "Running" : state === "error" ? "Failed" : "Passed",
      {
        kind: "execution",
        eventIndex: executionIndex >= 0 ? executionIndex : null,
      },
      formatDuration(execution?.duration_ms),
    ));
  }

  const verificationIndices = indicesOf(
    events,
    (event, index) => index > latestCodeIndex && event.type === "verification.result",
  );
  const reviewIndex = lastIndex(
    events,
    (event, index) => index > latestCodeIndex && event.type === "verification.semantic_review",
  );
  const strictIndex = lastIndex(
    events,
    (event, index) => index > latestCodeIndex && event.type === "verification.strict_attempt",
  );
  const review = eventAt(events, reviewIndex);
  const strict = eventAt(events, strictIndex);
  const verificationPresent = verificationIndices.length > 0 || reviewIndex >= 0 || strictIndex >= 0;
  if (verificationPresent || activeId === "verification" || failedId === "verification") {
    const outcomes = verificationIndices.map((index) => verificationOutcome(events[index]));
    const passed = outcomes.filter((outcome) => outcome === "pass").length;
    const failed = outcomes.some((outcome) => ["fail", "error"].includes(outcome))
      || strict?.decision === "fail";
    const limited = outcomes.some((outcome) =>
      ["unavailable", "skipped", "inconclusive"].includes(outcome),
    ) || strict?.decision === "inconclusive";
    const repairRequested = review?.decision === "code_repair" || review?.decision === "replan";
    const state: AgentActivityState = activeId === "verification"
      ? "active"
      : failedId === "verification" || (failed && terminalFailed)
        ? "error"
        : repairRequested || failed || limited
          ? "warn"
          : "done";
    const count = verificationIndices.length;
    const status = state === "active"
      ? "Checking"
      : repairRequested
        ? "Repair requested"
        : count
          ? `${passed}/${count} passed`
          : review?.decision === "ready"
            ? "Aligned"
            : strict?.decision === "pass"
              ? "Passed"
              : "Reviewed";
    items.push(item(
      "verification",
      "verify",
      "Verification",
      state === "active"
        ? "Checking the result against the declared evidence"
        : repairRequested
          ? "The reviewer requested another bounded attempt"
          : state === "error"
            ? "One or more required checks failed"
            : limited
              ? "Available checks completed with evidence limits"
              : "The recorded checks support the candidate",
      state,
      status,
      {
        kind: "verification",
        eventIndices: verificationIndices,
        reviewIndex: reviewIndex >= 0 ? reviewIndex : null,
        strictIndex: strictIndex >= 0 ? strictIndex : null,
      },
      stageDuration(events, "verify", "review"),
      state === "warn" && Boolean(terminal) ? true : undefined,
    ));
  }

  const compilationIndex = lastIndex(events, (event) => event.type === "compilation.result");
  const compilation = eventAt(events, compilationIndex);
  const compiledResourceIndex = lastIndex(
    events,
    (event) => event.type === "resource.estimate" && event.phase === "compiled",
  );
  if (
    compilation
    || compiledResourceIndex >= 0
    || activeId === "compilation"
    || failedId === "compilation"
  ) {
    const state: AgentActivityState = activeId === "compilation"
      ? "active"
      : failedId === "compilation"
        ? "error"
        : compilation?.accepted === false
          ? "warn"
          : "done";
    items.push(item(
      "compilation",
      "compile",
      "Compilation",
      state === "active"
        ? "Optimizing the circuit while preserving behavior"
        : state === "error"
          ? "Compilation stopped before a compatible result was recorded"
        : compilation?.accepted === false
          ? "The original circuit was retained"
          : "The compiled circuit remained compatible",
      state,
      state === "active"
        ? "Compiling"
        : state === "error"
          ? "Failed"
          : compilation?.accepted === false
            ? "Unchanged"
            : "Complete",
      {
        kind: "compilation",
        eventIndex: compilationIndex >= 0 ? compilationIndex : null,
        resourceIndex: compiledResourceIndex >= 0 ? compiledResourceIndex : null,
      },
      stageDuration(events, "compile", "compiled_resource_estimate"),
    ));
  }

  const finalizeIndices = indicesOf(events, (event) =>
    [
      "code.finalized",
      "sandbox.result",
      "baseline.result",
      "run.analysis",
      "artifact.saved",
    ].includes(event.type) && !(event.type === "sandbox.result" && event.phase !== "final"),
  );
  if (
    finalizeIndices.length > 0
    || activeId === "finalize"
    || failedId === "finalize"
    || bestEffort
  ) {
    const artifactIndex = lastIndex(events, (event) => event.type === "artifact.saved");
    const analysisIndex = lastIndex(events, (event) => event.type === "run.analysis");
    const analysis = eventAt(events, analysisIndex);
    const state: AgentActivityState = activeId === "finalize"
      ? "active"
      : bestEffort
        ? "warn"
        : failedId === "finalize"
          ? "error"
          : "done";
    items.push(item(
      "finalize",
      "finalize",
      "Finalize result",
      state === "active"
        ? activeHeadline("finalize", stage, nextRevision)
        : bestEffort
          ? "The strongest recorded candidate was preserved for inspection"
          : state === "error"
            ? "Final packaging stopped before all outputs were recorded"
          : analysis?.summary
            ?? (artifactIndex >= 0 ? "The result package is ready" : "The final program was prepared"),
      state,
      state === "active"
        ? "Working"
        : state === "error"
          ? "Failed"
          : bestEffort
            ? "Best available"
            : artifactIndex >= 0
              ? "Packaged"
              : "Complete",
      {
        kind: "finalize",
        eventIndices: finalizeIndices,
        bestEffortIndex: bestEffortIndex >= 0 ? bestEffortIndex : null,
      },
      bestEffort?.candidates_considered
        ? `${bestEffort.candidates_considered} candidates`
        : stageDuration(events, "finalize", "final_execute", "baseline", "analyze", "save"),
    ));
  }

  const label = terminalSucceeded
    ? "Run complete"
    : terminalFailed && bestEffort
      ? "Run complete with limits"
      : terminalFailed || error
        ? "Run needs attention"
        : terminalCancelled
          ? "Run stopped"
        : running
          ? "Working"
          : "Run activity";
  const headline = terminalSucceeded
    ? "Final output prepared"
    : terminalFailed && bestEffort
      ? "Best available result preserved"
      : terminalFailed || error
        ? failureHeadline(error)
        : terminalCancelled
          ? "The run was cancelled before completion"
        : activeHeadline(activeId, stage, nextRevision);

  return { label, headline, items };
}
