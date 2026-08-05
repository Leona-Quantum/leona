import type {
  AgentActivityIcon,
  AgentActivityItem,
  AgentActivityState,
  AgentActivityView,
} from "@majorana/ui";
import type { PublicLocale } from "./public-locale.ts";

function text(locale: PublicLocale, english: string, japanese: string): string {
  return locale === "ja" ? japanese : english;
}

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
  locale: PublicLocale,
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
      return { revision, state: "active", status: text(locale, "Repairing", "修正中"), eventIndex };
    }
    if (bestEffort && bestEffort.revision === revision) {
      return { revision, state: "warn", status: text(locale, "Best available", "利用可能な最良候補"), eventIndex };
    }
    if (sandbox?.exit_code !== undefined && sandbox.exit_code !== 0) {
      return {
        revision,
        state: hasLaterAttempt ? "warn" : terminalFailed ? "error" : "warn",
        status: hasLaterAttempt ? text(locale, "Repair requested", "修正要求") : text(locale, "Sandbox failed", "Sandbox失敗"),
        eventIndex,
      };
    }
    if (review?.decision === "code_repair" || review?.decision === "replan" || checkFailed) {
      return {
        revision,
        state: hasLaterAttempt ? "warn" : terminalFailed ? "error" : "warn",
        status: hasLaterAttempt ? text(locale, "Repair requested", "修正要求") : text(locale, "Verification failed", "検証失敗"),
        eventIndex,
      };
    }
    return {
      revision,
      state: "done",
      status: isLatest ? text(locale, "Selected", "採用") : text(locale, "Completed", "完了"),
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
  locale: PublicLocale,
): string {
  if (activeId === "plan") return text(locale, "Understanding the request and choosing an approach", "依頼を理解し、解法を選んでいます");
  if (activeId === "code") return text(locale, `Writing candidate revision ${nextRevision}`, `候補リビジョン${nextRevision}を作成しています`);
  if (activeId === "checks") {
    return stage === "resource_estimate"
      ? text(locale, "Estimating circuit resources", "回路リソースを見積もっています")
      : text(locale, "Checking the generated program", "生成コードを確認しています");
  }
  if (activeId === "execution") return text(locale, "Running the candidate in the sandbox", "候補をSandboxで実行しています");
  if (activeId === "verification") return text(locale, "Checking the result against the declared evidence", "宣言された証拠と結果を照合しています");
  if (activeId === "compilation") return text(locale, "Compiling the circuit without changing its behavior", "動作を保ったまま回路をコンパイルしています");
  if (activeId === "finalize") {
    if (stage === "final_execute") return text(locale, "Re-running the final program", "最終コードを再実行しています");
    if (stage === "baseline") return text(locale, "Comparing against the reference baseline", "参照ベースラインと比較しています");
    if (stage === "analyze") return text(locale, "Summarizing the measured result", "測定結果をまとめています");
    if (stage === "save") return text(locale, "Packaging the final result", "最終結果をパッケージ化しています");
    return text(locale, "Preparing the final output", "最終出力を準備しています");
  }
  return text(locale, "Replaying recorded activity", "記録された実行過程を再生しています");
}

function failureHeadline(error: RunActivityEvent | null, locale: PublicLocale): string {
  const message = `${error?.reason_code ?? ""} ${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  if (message.includes("rate_limit") || message.includes("rate limit") || message.includes("429")) {
    return text(locale, "The model provider is temporarily rate-limited", "モデル提供元が一時的にレート制限中です");
  }
  if (
    message.includes("credential")
    || message.includes("authentication")
    || message.includes("client_unavailable")
  ) {
    return text(locale, "The model provider is not configured", "モデル提供元が設定されていません");
  }
  if (message.includes("quota_exhausted")) return text(locale, "The model provider quota is unavailable", "モデル提供元の利用枠を使用できません");
  if (message.includes("model_not_found")) return text(locale, "The configured model is unavailable", "設定されたモデルを利用できません");
  if (message.includes("timeout") || message.includes("timed out")) {
    return text(locale, "A required provider did not respond before the timeout", "必要な提供元から制限時間内に応答がありませんでした");
  }
  if (message.includes("candidate_budget_exhausted")) {
    return text(locale, "No candidate met every acceptance check", "すべての採用条件を満たす候補がありませんでした");
  }
  return text(locale, "The run stopped before every required step completed", "必要な処理がすべて完了する前に実行が停止しました");
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
  locale: PublicLocale = "en",
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
      planIndices.length > 1 ? text(locale, "Revised plan", "修正計画") : text(locale, "Plan", "計画"),
      plan?.plan?.problem_summary
        ?? (state === "active"
          ? text(locale, "Choosing an algorithm and evidence plan", "アルゴリズムと検証方法を選んでいます")
          : state === "error"
            ? text(locale, "No complete circuit plan was recorded", "完全な回路計画を記録できませんでした")
            : text(locale, "Circuit plan recorded", "回路計画を記録しました")),
      state,
      state === "active" ? text(locale, "Planning", "計画中") : state === "error" ? text(locale, "Needs attention", "要確認") : text(locale, "Complete", "完了"),
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
      locale,
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
        ? text(locale, `Repairing the ${framework ?? "framework-native"} candidate`, `${framework ?? "フレームワークネイティブ"}候補を修正しています`)
        : text(locale, `Writing a ${framework ?? "framework-native"} candidate`, `${framework ?? "フレームワークネイティブ"}候補を作成しています`)
      : state === "error" && !latestCode
        ? text(locale, "No candidate source was recorded", "候補コードを記録できませんでした")
      : considered
        ? text(locale, `${considered} candidates considered; revision ${effectiveRevision} retained`, `${considered}件の候補を検討し、リビジョン${effectiveRevision}を保持しました`)
        : codeIndices.length > 1
          ? text(locale, `${codeIndices.length} revisions produced during repair`, `修正中に${codeIndices.length}件のリビジョンを生成しました`)
          : text(locale, `${framework ?? latestCode?.language ?? "Framework-native"} source produced`, `${framework ?? latestCode?.language ?? "フレームワークネイティブ"}コードを生成しました`);
    items.push(item(
      "code",
      "code",
      text(locale, "Generated code", "生成コード"),
      title,
      state,
      state === "active"
        ? text(locale, `Writing revision ${nextRevision}`, `リビジョン${nextRevision}を作成中`)
        : state === "error"
          ? text(locale, "Generation failed", "生成失敗")
          : bestEffort
            ? text(locale, `Revision ${effectiveRevision}`, `リビジョン${effectiveRevision}`)
            : text(locale, `Revision ${Math.max(1, effectiveRevision)}`, `リビジョン${Math.max(1, effectiveRevision)}`),
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
      text(locale, "Code quality and resources", "コード品質とリソース"),
      state === "active"
        ? text(locale, "Inspecting the program before execution", "実行前にコードを確認しています")
        : state === "error"
          ? text(locale, "The pre-execution checks did not complete", "実行前チェックを完了できませんでした")
        : resourceIndex >= 0
          ? text(locale, "Static checks passed and resources were bounded", "静的チェックに合格し、リソース範囲を確認しました")
          : failed
            ? text(locale, "Static checks found a blocking issue", "静的チェックで実行を妨げる問題が見つかりました")
            : text(locale, "Static checks completed", "静的チェックが完了しました"),
      state,
      state === "active" ? text(locale, "Checking", "確認中") : state === "error" ? text(locale, "Needs repair", "要修正") : text(locale, "Passed", "合格"),
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
      text(locale, "Sandbox execution", "Sandbox実行"),
      state === "active"
        ? text(locale, `Running revision ${Math.max(1, effectiveRevision)} in the isolated sandbox`, `隔離Sandboxでリビジョン${Math.max(1, effectiveRevision)}を実行しています`)
        : state === "error"
          ? text(locale, `Revision ${Math.max(1, effectiveRevision)} exited with an error`, `リビジョン${Math.max(1, effectiveRevision)}はエラーで終了しました`)
          : text(locale, `Revision ${Math.max(1, effectiveRevision)} produced a structured result`, `リビジョン${Math.max(1, effectiveRevision)}が構造化結果を生成しました`),
      state,
      state === "active" ? text(locale, "Running", "実行中") : state === "error" ? text(locale, "Failed", "失敗") : text(locale, "Passed", "合格"),
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
      ? text(locale, "Checking", "確認中")
      : repairRequested
        ? text(locale, "Repair requested", "修正要求")
        : count
          ? text(locale, `${passed}/${count} passed`, `${count}件中${passed}件合格`)
          : review?.decision === "ready"
            ? text(locale, "Aligned", "整合")
            : strict?.decision === "pass"
              ? text(locale, "Passed", "合格")
              : text(locale, "Reviewed", "レビュー済み");
    items.push(item(
      "verification",
      "verify",
      text(locale, "Verification", "検証"),
      state === "active"
        ? text(locale, "Checking the result against the declared evidence", "宣言された証拠と結果を照合しています")
        : repairRequested
          ? text(locale, "The reviewer requested another bounded attempt", "Reviewerが追加の限定試行を要求しました")
          : state === "error"
            ? text(locale, "One or more required checks failed", "必須チェックの一部が不合格でした")
            : limited
              ? text(locale, "Available checks completed with evidence limits", "証拠上の制限を伴って確認が完了しました")
              : text(locale, "The recorded checks support the candidate", "記録された確認結果が候補を支持しています"),
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
      text(locale, "Compilation", "コンパイル"),
      state === "active"
        ? text(locale, "Optimizing the circuit while preserving behavior", "動作を保ったまま回路を最適化しています")
        : state === "error"
          ? text(locale, "Compilation stopped before a compatible result was recorded", "互換性のある結果を記録する前にコンパイルが停止しました")
        : compilation?.accepted === false
          ? text(locale, "The original circuit was retained", "元の回路を保持しました")
          : text(locale, "The compiled circuit remained compatible", "コンパイル後も回路の互換性が保たれました"),
      state,
      state === "active"
        ? text(locale, "Compiling", "コンパイル中")
        : state === "error"
          ? text(locale, "Failed", "失敗")
          : compilation?.accepted === false
            ? text(locale, "Unchanged", "変更なし")
            : text(locale, "Complete", "完了"),
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
      text(locale, "Finalize result", "結果を確定"),
      state === "active"
        ? activeHeadline("finalize", stage, nextRevision, locale)
        : bestEffort
          ? text(locale, "The strongest recorded candidate was preserved for inspection", "最も良い候補を確認用に保持しました")
          : state === "error"
            ? text(locale, "Final packaging stopped before all outputs were recorded", "すべての出力を記録する前に最終パッケージ化が停止しました")
          : analysis?.summary
            ?? (artifactIndex >= 0 ? text(locale, "The result package is ready", "結果パッケージの準備ができました") : text(locale, "The final program was prepared", "最終コードを準備しました")),
      state,
      state === "active"
        ? text(locale, "Working", "処理中")
        : state === "error"
          ? text(locale, "Failed", "失敗")
          : bestEffort
            ? text(locale, "Best available", "利用可能な最良結果")
            : artifactIndex >= 0
              ? text(locale, "Packaged", "パッケージ済み")
              : text(locale, "Complete", "完了"),
      {
        kind: "finalize",
        eventIndices: finalizeIndices,
        bestEffortIndex: bestEffortIndex >= 0 ? bestEffortIndex : null,
      },
      bestEffort?.candidates_considered
        ? text(locale, `${bestEffort.candidates_considered} candidates`, `${bestEffort.candidates_considered}件の候補`)
        : stageDuration(events, "finalize", "final_execute", "baseline", "analyze", "save"),
    ));
  }

  const label = terminalSucceeded
    ? text(locale, "Run complete", "実行完了")
    : terminalFailed && bestEffort
      ? text(locale, "Run complete with limits", "制限付きで実行完了")
      : terminalFailed || error
        ? text(locale, "Run needs attention", "実行結果の確認が必要です")
        : terminalCancelled
          ? text(locale, "Run stopped", "実行停止")
        : running
          ? text(locale, "Working", "実行中")
          : text(locale, "Run activity", "実行過程");
  const headline = terminalSucceeded
    ? text(locale, "Final output prepared", "最終出力を準備しました")
    : terminalFailed && bestEffort
      ? text(locale, "Best available result preserved", "利用可能な最良結果を保持しました")
      : terminalFailed || error
        ? failureHeadline(error, locale)
        : terminalCancelled
          ? text(locale, "The run was cancelled before completion", "完了前に実行がキャンセルされました")
        : activeHeadline(activeId, stage, nextRevision, locale);

  return { label, headline, items };
}
