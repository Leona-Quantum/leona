import type {
  RunOutcomeBadge,
  RunOutcomeCheck,
  RunOutcomeFact,
  RunOutcomeTone,
  RunOutcomeView,
} from "@majorana/ui";

import {
  verificationSummaryFromValue,
  type VerificationSummary,
} from "./verification-record.ts";
import type { PublicLocale } from "./public-locale.ts";

export interface OutcomeEvent {
  type: string;
  mode?: string;
  status?: string;
  stage?: string | null;
  message?: string;
  code?: string;
  language?: string;
  revision?: number;
  candidates_considered?: number;
  failed_checks?: string[];
  critic_summary?: string | null;
  artifact_id?: string;
  interpretation?: string;
  residual_risks?: string | string[] | null;
  verification_summary?: unknown;
  details?: Record<string, unknown>;
  method?: string;
  result?: unknown;
  plan?: {
    problem_summary?: string;
    algorithm?: string;
    framework?: string;
    expected_output_keys?: string[];
  };
}

function lastEvent(
  events: readonly OutcomeEvent[],
  type: string,
): OutcomeEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

function isCircuitRun(events: readonly OutcomeEvent[]): boolean {
  const queued = lastEvent(events, "run.queued");
  return queued?.mode === "execute" || events.some((event) =>
    [
      "plan.produced",
      "code.generated",
      "sandbox.result",
      "verification.semantic_review",
      "artifact.saved",
      "run.best_effort",
    ].includes(event.type),
  );
}

const JAPANESE_TERM: Record<string, string> = {
  return_contract: "戻り値契約",
  statistical: "統計的検証",
  statistical_native: "ネイティブ再実行との比較",
  exact: "厳密参照との比較",
  exact_diag: "厳密対角化",
  brute_force: "全探索ベースライン",
  statistical_reproducibility: "再実行による再現性",
  resource_contract: "量子ビット・リソース契約",
  measurement_policy: "測定範囲",
  success_criteria: "成功条件",
  structural: "回路構造",
  native_optimization_evidence: "ネイティブ最適化",
};

function humanize(value: string, locale: PublicLocale = "en"): string {
  if (locale === "ja" && JAPANESE_TERM[value]) return JAPANESE_TERM[value];
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

// `run.error` carries a machine-readable `code` (contracts events.RunError). Match on
// that first: the worker's `message` is prose written for the failure, not a carrier
// for the code, so substring-matching it silently missed every pipeline outcome —
// `candidate_budget_exhausted` arrives with the message "intent review did not align
// the candidate", which contains none of the strings the prose branches look for.
const failureByCode: Record<string, string> = {
  // Bounded-budget outcomes: the run worked, and stopped honestly.
  candidate_budget_exhausted:
    "The available repair attempts were used without producing a candidate that passed every check.",
  plan_budget_exhausted:
    "The review kept sending the plan back, and the replan budget ran out. Try rephrasing the request, or narrowing it to one clearly-stated goal.",
  review_feedback_budget_exhausted:
    "The review asked for more changes than this run's budget allows.",
  run_time_budget_exhausted:
    "The run stopped before starting another attempt it had no time to finish. The closest candidate is included.",
  run_timeout:
    "The run exceeded its time budget before finishing. Simpler circuits and fewer shots finish well inside it.",
  run_cancelled: "The run was cancelled.",

  // The model produced something the pipeline could not use.
  plan_output_invalid: "The planner returned a plan that could not be read.",
  plan_framework_mismatch: "The planner changed the requested framework.",
  replan_parameters_changed: "The replan changed the requested shots or seed.",
  generation_output_invalid: "The generated response could not be read as a program.",
  generated_source_invalid: "The generated program was not valid Python for the selected framework.",
  review_output_invalid: "The reviewer response could not be read. New runs retry this case automatically.",
  repeated_review_output_invalid: "The reviewer response could not be read on any attempt.",

  // Execution and its contract.
  basic_contract_failed:
    "The generated program ran but did not produce the result keys the plan promised.",
  sandbox_provider_failed: "The sandbox could not run the generated program.",

  // Operational.
  legacy_run_requires_restart:
    "This unfinished run uses the retired pipeline. Start a new run to use the current workflow.",
  job_dead_letter: "The run could not be completed after repeated attempts.",
  run_orphaned: "The run was interrupted and could not be resumed.",
  simple_save_not_enabled: "Saving is not enabled for this workspace.",
};

const failureByCodeJa: Record<string, string> = {
  candidate_budget_exhausted: "利用可能な修正回数を使い切りましたが、すべての確認に合格する候補を生成できませんでした。",
  plan_budget_exhausted: "再計画の上限に達しました。依頼を一つの明確な目的に絞って再実行してください。",
  review_feedback_budget_exhausted: "レビューが求めた修正回数が、この実行の上限を超えました。",
  run_time_budget_exhausted: "次の試行を完了できる時間が残っていないため停止しました。最も良い候補は保持されています。",
  run_timeout: "制限時間内に実行を完了できませんでした。回路を簡略化するか、ショット数を減らしてください。",
  run_cancelled: "実行はキャンセルされました。",
  plan_output_invalid: "Plannerの出力を有効な計画として読み取れませんでした。",
  plan_framework_mismatch: "Plannerが指定されたフレームワークを変更しました。",
  replan_parameters_changed: "再計画で指定されたショット数またはseedが変更されました。",
  generation_output_invalid: "生成された応答をプログラムとして読み取れませんでした。",
  generated_source_invalid: "生成されたコードは、指定フレームワークの有効なPythonではありませんでした。",
  review_output_invalid: "Reviewerの応答を読み取れませんでした。新しい実行では自動的に再試行されます。",
  repeated_review_output_invalid: "すべての試行でReviewerの応答を読み取れませんでした。",
  basic_contract_failed: "コードは実行されましたが、計画で指定されたRESULTキーが返されませんでした。",
  sandbox_provider_failed: "Sandboxで生成コードを実行できませんでした。",
  legacy_run_requires_restart: "この未完了Runは旧Pipelineを使用しています。新しいRunを開始してください。",
  job_dead_letter: "繰り返し試行しても実行を完了できませんでした。",
  run_orphaned: "実行が中断され、再開できませんでした。",
  simple_save_not_enabled: "このWorkspaceでは保存が有効になっていません。",
};

// Whole families share one cause and one user action; spelling out every member would
// go stale the next time a stage is added.
function failureByCodeFamily(code: string, locale: PublicLocale): string | null {
  if (code.endsWith("_persistence_failed") || code.endsWith("_step_begin_failed")) {
    return locale === "ja" ? "実行を記録できませんでした。内容は失われていないため、もう一度実行してください。" : "The run could not be recorded. Nothing was lost; try running it again.";
  }
  if (code.startsWith("export_") || code === "openqasm_export_failed") {
    return locale === "ja" ? "OpenQASMを書き出せませんでした。フレームワークネイティブのコードには影響ありません。" : "The OpenQASM export could not be produced. The framework-native program is unaffected.";
  }
  if (code.endsWith("_lookup_failed") || code.endsWith("_binding_mismatch")) {
    return locale === "ja" ? "保存された実行証拠を一貫した形で読み戻せませんでした。" : "The run's stored evidence could not be read back consistently.";
  }
  return null;
}

export function friendlyFailure(
  message: string | undefined,
  stage: string | null | undefined,
  code?: string | undefined,
  locale: PublicLocale = "en",
): string {
  if (code) {
    const known = (locale === "ja" ? failureByCodeJa[code] : failureByCode[code])
      ?? failureByCodeFamily(code, locale);
    if (known) return known;
  }
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("rate_limit") || normalized.includes("rate limit") || normalized.includes("429")) {
    return locale === "ja" ? "モデル提供元が一時的にレート制限中です。少し待ってから再試行してください。" : "The model provider is temporarily rate-limited. Retry in a moment.";
  }
  if (
    normalized.includes("credentials_missing")
    || normalized.includes("authentication_failed")
    || normalized.includes("client_unavailable")
  ) {
    return locale === "ja" ? "この環境にはモデル提供元が設定されていません。" : "The model provider is not configured for this environment.";
  }
  if (normalized.includes("quota_exhausted")) {
    return locale === "ja" ? "モデル提供元の利用枠を現在使用できません。" : "The model provider quota is currently unavailable.";
  }
  if (normalized.includes("model_not_found")) {
    return locale === "ja" ? "設定されたモデルを提供元で利用できません。" : "The configured model is not available from the provider.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return locale === "ja" ? "モデル提供元から制限時間内に応答がありませんでした。" : "The provider did not respond before the request timed out.";
  }
  if (normalized.includes("provider call failed") || normalized.includes("provider unavailable")) {
    return locale === "ja" ? "モデル提供元がこの処理を完了できませんでした。" : "The model provider could not complete this step.";
  }
  if (normalized.includes("invalid structured data")) {
    return locale === "ja" ? "Reviewerの応答を読み取れませんでした。新しい実行では自動的に再試行されます。" : "The reviewer response could not be read. New runs retry this case automatically.";
  }
  if (normalized.includes("candidate_budget_exhausted") || normalized.includes("repair budget")) {
    return locale === "ja" ? "修正回数を使い切りましたが、採用可能な候補を生成できませんでした。" : "The available repair attempts were used without producing an acceptable candidate.";
  }
  // Keys are contracts `Stage` values, which is what run.error actually carries after
  // the worker projects SimplePipelineStage through _SIMPLE_EVENT_STAGE. `execute` and
  // `review` were never emitted — the worker sends `final_execute` and `verify` — so
  // every execution and screening failure fell through to the bare "The run" wording.
  const stageLabel: Record<string, string> = {
    plan: "Planning",
    generate: "Code generation",
    screen: "Contract checking",
    final_execute: "Execution",
    execute: "Execution",
    verify: "Review",
    review: "Review",
    export: "Export",
    save: "Saving",
  };
  if (locale === "ja") {
    const stageLabelJa: Record<string, string> = {
      plan: "計画",
      generate: "コード生成",
      screen: "契約確認",
      final_execute: "実行",
      execute: "実行",
      verify: "レビュー",
      review: "レビュー",
      export: "書き出し",
      save: "保存",
    };
    return `${stageLabelJa[stage ?? ""] ?? "実行"}を完了する前に停止しました。`;
  }
  return `${stageLabel[stage ?? ""] ?? "The run"} stopped before the step completed.`;
}

function metricFromEvents(events: readonly OutcomeEvent[], locale: PublicLocale): string | null {
  const checks = [...events].reverse().filter((event) => event.type === "verification.result");
  const selected = checks.find((event) => event.method === "success_criteria")
    ?? checks.find((event) =>
      typeof event.details?.metric === "string"
      && (typeof event.details?.value === "number" || typeof event.details?.metric_value === "number")
    );
  const metric = selected?.details?.metric;
  const value = selected?.details?.value ?? selected?.details?.metric_value;
  if (typeof metric !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${humanize(metric, locale)} ${Number(value.toFixed(4))}`;
}

function checksFrom(
  summary: VerificationSummary | null,
  failedChecks: string[] | undefined,
  locale: PublicLocale,
): RunOutcomeCheck[] {
  if (summary?.checks?.length) {
    return summary.checks.map((check) => ({
      label: humanize(check.method, locale),
      state: check.result === "pass"
        ? "pass"
        : check.result === "fail" || check.result === "error"
          ? "fail"
          : "unavailable",
    }));
  }
  return (failedChecks ?? []).map((check) => ({
    label: humanize(check, locale),
    state: "fail",
  }));
}

function factsFrom(events: readonly OutcomeEvent[], locale: PublicLocale): RunOutcomeFact[] {
  const plan = lastEvent(events, "plan.produced")?.plan;
  const best = lastEvent(events, "run.best_effort");
  const generated = lastEvent(events, "code.finalized") ?? lastEvent(events, "code.generated");
  const metric = metricFromEvents(events, locale);
  const facts: RunOutcomeFact[] = [];

  if (metric) facts.push({ label: locale === "ja" ? "結果" : "Result", value: metric });
  if (plan?.algorithm) facts.push({ label: locale === "ja" ? "アルゴリズム" : "Algorithm", value: plan.algorithm });
  if (plan?.framework) facts.push({ label: locale === "ja" ? "フレームワーク" : "Framework", value: plan.framework });
  const revision = best?.revision ?? generated?.revision;
  if (revision !== undefined) facts.push({ label: locale === "ja" ? "リビジョン" : "Revision", value: String(revision) });
  return facts.slice(0, 6);
}

function badgesFor(
  tone: RunOutcomeTone,
  trustLabel: string,
  saved: boolean,
  locale: PublicLocale,
): RunOutcomeBadge[] {
  return [
    { label: trustLabel, tone },
    { label: saved ? locale === "ja" ? "保存済み" : "Saved" : locale === "ja" ? "未保存" : "Not saved", tone: saved ? "neutral" : "warn" },
  ];
}

function codeFrom(
  events: readonly OutcomeEvent[],
  locale: PublicLocale,
): RunOutcomeView["code"] {
  const best = lastEvent(events, "run.best_effort");
  const final = lastEvent(events, "code.finalized");
  const generated = lastEvent(events, "code.generated");
  const source = best ?? final ?? generated;
  if (!source?.code) return undefined;
  const plan = lastEvent(events, "plan.produced")?.plan;
  const revision = source.revision
    ? ` · ${locale === "ja" ? "リビジョン" : "revision"} ${source.revision}`
    : "";
  return {
    label: best
      ? `${locale === "ja" ? "最良候補" : "Best candidate"}${revision}`
      : `${locale === "ja" ? "生成コード" : "Generated code"}${revision}`,
    language: source.language ?? plan?.framework ?? "python",
    source: source.code,
  };
}

function residualRisk(events: readonly OutcomeEvent[]): string | null {
  const value = lastEvent(events, "run.finished")?.residual_risks;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return items.length ? items.join(" ") : null;
  }
  return null;
}

export function runOutcomeFromEvents(
  events: readonly OutcomeEvent[],
  recordSummary: VerificationSummary | null = null,
  locale: PublicLocale = "en",
): RunOutcomeView | null {
  if (!isCircuitRun(events)) return null;
  const finished = lastEvent(events, "run.finished");
  if (!finished) return null;

  const eventSummary = verificationSummaryFromValue(finished.verification_summary);
  const summary = recordSummary ?? eventSummary;
  const saved = Boolean(lastEvent(events, "artifact.saved"));
  const best = lastEvent(events, "run.best_effort");
  const failure = lastEvent(events, "run.error");
  const plan = lastEvent(events, "plan.produced")?.plan;
  const description = plan?.problem_summary
    ?? lastEvent(events, "run.analysis")?.interpretation
    ?? (locale === "ja" ? "量子回路ワークフロー" : "Quantum circuit workflow");
  const facts = factsFrom(events, locale);
  const code = codeFrom(events, locale);

  if (finished.status === "cancelled") {
    return {
      tone: "neutral",
      eyebrow: locale === "ja" ? "実行停止" : "Run stopped",
      title: locale === "ja" ? "実行はキャンセルされました" : "The run was cancelled",
      description: locale === "ja" ? "完了した結果は生成されませんでした。" : "No completed result was produced.",
      badges: badgesFor("neutral", locale === "ja" ? "キャンセル済み" : "Cancelled", saved, locale),
      facts,
      callout: {
        title: locale === "ja" ? "検証結果なし" : "No verification result",
        body: locale === "ja" ? "証拠の記録が完了する前にワークフローが終了しました。" : "The workflow ended before its evidence could be completed.",
      },
      code,
    };
  }

  if (finished.status !== "succeeded") {
    const failureDescription = friendlyFailure(failure?.message, failure?.stage, failure?.code, locale);
    const checks = checksFrom(summary, best?.failed_checks, locale);
    if (best) {
      return {
        tone: "warn",
        eyebrow: locale === "ja" ? "利用可能な最良結果" : "Best available result",
        title: locale === "ja" ? "最も良い候補を保持しました" : "The strongest candidate was preserved",
        description: locale === "ja" ? "生成結果は確認用に保持され、検証上の制限も明示されています。" : "The generated result remains available for inspection, with its verification limits clearly marked.",
        badges: badgesFor("warn", locale === "ja" ? "未検証" : "Not verified", false, locale),
        facts,
        callout: {
          title: locale === "ja" ? "採用されなかった理由" : "Why it was not accepted",
          body: best.critic_summary
            ? `${best.critic_summary} ${failureDescription}`
            : failureDescription,
        },
        checks: checks.length ? checks : undefined,
        code,
      };
    }
    if (summary?.decision === "fail") {
      return {
        tone: "err",
        eyebrow: locale === "ja" ? "検証失敗" : "Verification failed",
        title: locale === "ja" ? "候補は検証に合格しませんでした" : "The candidate did not pass verification",
        description,
        badges: badgesFor("err", locale === "ja" ? "失敗" : "Failed", saved, locale),
        facts,
        callout: {
          title: locale === "ja" ? "結果は不採用" : "Result rejected",
          body: humanize(summary.reason_code, locale),
        },
        checks: checks.length ? checks : undefined,
        code,
      };
    }
    return {
      tone: "err",
      eyebrow: locale === "ja" ? "実行未完了" : "Run incomplete",
      title: failure?.stage === "plan" || failure?.stage === "generate"
        ? locale === "ja" ? "生成を完了できませんでした" : "Generation could not complete"
        : locale === "ja" ? "ワークフローを完了できませんでした" : "The workflow could not complete",
      description,
      badges: badgesFor("err", locale === "ja" ? "未検証" : "Not verified", false, locale),
      facts,
      callout: {
        title: locale === "ja" ? "発生したこと" : "What happened",
        body: failureDescription,
      },
      code,
    };
  }

  if (!summary) {
    return {
      tone: "warn",
      eyebrow: locale === "ja" ? "旧形式の結果" : "Legacy result",
      title: locale === "ja" ? "検証証拠を利用できません" : "Verification evidence is unavailable",
      description,
      badges: badgesFor("warn", locale === "ja" ? "証拠不明" : "Evidence unknown", saved, locale),
      facts,
      callout: {
        title: locale === "ja" ? "検証済みとして扱えません" : "Not treated as Verified",
        body: locale === "ja" ? "この記録には型付き検証サマリーがありません。結果を利用する前にレビューまたは再実行してください。" : "This successful record has no typed verification summary. Review or rerun it before relying on the result.",
      },
      code,
    };
  }

  const checks = checksFrom(summary, undefined, locale);
  if (summary.decision === "fail") {
    return {
      tone: "err",
      eyebrow: locale === "ja" ? "検証失敗" : "Verification failed",
      title: locale === "ja" ? "完了したワークフローは検証に合格しませんでした" : "The completed workflow did not pass verification",
      description,
      badges: badgesFor("err", locale === "ja" ? "失敗" : "Failed", saved, locale),
      facts,
      callout: {
        title: locale === "ja" ? "結果は不採用" : "Result rejected",
        body: humanize(summary.reason_code, locale),
      },
      checks: checks.length ? checks : undefined,
      code,
    };
  }

  if (summary.decision === "inconclusive") {
    const advisory = summary.reason_code === "ai_review_aligned";
    const claims = summary.unverified_claims ?? [];
    return {
      tone: "warn",
      eyebrow: advisory
        ? locale === "ja" ? "実行済み結果" : "Executed result"
        : locale === "ja" ? "検証利用不可" : "Verification unavailable",
      title: advisory
        ? locale === "ja" ? "回路は実行され、依頼内容と整合しました" : "The circuit executed and matched the request"
        : locale === "ja" ? "回路は実行されましたが、正しさは未確認です" : "The circuit ran, but correctness is unconfirmed",
      description,
      badges: badgesFor("warn", advisory ? locale === "ja" ? "実行済み" : "Executed" : locale === "ja" ? "未検証" : "Not verified", saved, locale),
      facts,
      callout: {
        title: advisory
          ? locale === "ja" ? "厳密検証は未実行" : "Strict verification was not run"
          : locale === "ja" ? "証拠が不完全です" : "Evidence is incomplete",
        body: claims.length
          ? locale === "ja"
            ? `未確認: ${claims.map((claim) => humanize(claim, locale)).join("、")}。`
            : `Not established: ${claims.map((claim) => humanize(claim, locale)).join(", ")}.`
          : locale === "ja" ? "この結果を利用する前に、利用可能な証拠を確認してください。" : "Review the available evidence before relying on this result.",
      },
      checks: checks.length ? checks : undefined,
      code,
    };
  }

  const physical = summary.evidence_strength === "physical";
  const risk = residualRisk(events);
  return {
    tone: physical ? "ok" : "warn",
    eyebrow: physical
      ? locale === "ja" ? "検証済み結果" : "Verified result"
      : locale === "ja" ? "構造検証結果" : "Structural result",
    title: physical
      ? locale === "ja" ? "回路は検証に合格しました" : "The circuit passed verification"
      : locale === "ja" ? "回路は構造チェックに合格しました" : "The circuit passed structural checks",
    description,
    badges: badgesFor(
      physical ? "ok" : "warn",
      physical ? locale === "ja" ? "検証済み" : "Verified" : locale === "ja" ? "構造検証済み" : "Structurally verified",
      saved,
      locale,
    ),
    facts,
    callout: !physical || risk
      ? {
          title: physical
            ? locale === "ja" ? "残る制限" : "Residual limitation"
            : locale === "ja" ? "物理的な正しさは確認されていません" : "Physical correctness was not established",
          body: risk ?? (locale === "ja" ? "利用可能な証拠が確認するのは構造と結果形式であり、物理的な正しさではありません。" : "The available evidence confirms structure and result shape, not physical correctness."),
        }
      : undefined,
    checks: checks.length ? checks : undefined,
    code,
  };
}
