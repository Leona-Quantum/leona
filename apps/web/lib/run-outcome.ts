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

function humanize(value: string): string {
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

// Whole families share one cause and one user action; spelling out every member would
// go stale the next time a stage is added.
function failureByCodeFamily(code: string): string | null {
  if (code.endsWith("_persistence_failed") || code.endsWith("_step_begin_failed")) {
    return "The run could not be recorded. Nothing was lost; try running it again.";
  }
  if (code.startsWith("export_") || code === "openqasm_export_failed") {
    return "The OpenQASM export could not be produced. The framework-native program is unaffected.";
  }
  if (code.endsWith("_lookup_failed") || code.endsWith("_binding_mismatch")) {
    return "The run's stored evidence could not be read back consistently.";
  }
  return null;
}

export function friendlyFailure(
  message: string | undefined,
  stage: string | null | undefined,
  code?: string | undefined,
): string {
  if (code) {
    const known = failureByCode[code] ?? failureByCodeFamily(code);
    if (known) return known;
  }
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("rate_limit") || normalized.includes("rate limit") || normalized.includes("429")) {
    return "The model provider is temporarily rate-limited. Retry in a moment.";
  }
  if (
    normalized.includes("credentials_missing")
    || normalized.includes("authentication_failed")
    || normalized.includes("client_unavailable")
  ) {
    return "The model provider is not configured for this environment.";
  }
  if (normalized.includes("quota_exhausted")) {
    return "The model provider quota is currently unavailable.";
  }
  if (normalized.includes("model_not_found")) {
    return "The configured model is not available from the provider.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "The provider did not respond before the request timed out.";
  }
  if (normalized.includes("provider call failed") || normalized.includes("provider unavailable")) {
    return "The model provider could not complete this step.";
  }
  if (normalized.includes("invalid structured data")) {
    return "The reviewer response could not be read. New runs retry this case automatically.";
  }
  if (normalized.includes("candidate_budget_exhausted") || normalized.includes("repair budget")) {
    return "The available repair attempts were used without producing an acceptable candidate.";
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
  return `${stageLabel[stage ?? ""] ?? "The run"} stopped before the step completed.`;
}

function metricFromEvents(events: readonly OutcomeEvent[]): string | null {
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
  return `${humanize(metric)} ${Number(value.toFixed(4))}`;
}

function checksFrom(
  summary: VerificationSummary | null,
  failedChecks: string[] | undefined,
): RunOutcomeCheck[] {
  if (summary?.checks?.length) {
    return summary.checks.map((check) => ({
      label: humanize(check.method),
      state: check.result === "pass"
        ? "pass"
        : check.result === "fail" || check.result === "error"
          ? "fail"
          : "unavailable",
    }));
  }
  return (failedChecks ?? []).map((check) => ({
    label: humanize(check),
    state: "fail",
  }));
}

function factsFrom(events: readonly OutcomeEvent[]): RunOutcomeFact[] {
  const plan = lastEvent(events, "plan.produced")?.plan;
  const best = lastEvent(events, "run.best_effort");
  const generated = lastEvent(events, "code.finalized") ?? lastEvent(events, "code.generated");
  const metric = metricFromEvents(events);
  const facts: RunOutcomeFact[] = [];

  if (metric) facts.push({ label: "Result", value: metric });
  if (plan?.algorithm) facts.push({ label: "Algorithm", value: plan.algorithm });
  if (plan?.framework) facts.push({ label: "Framework", value: plan.framework });
  const revision = best?.revision ?? generated?.revision;
  if (revision !== undefined) facts.push({ label: "Revision", value: String(revision) });
  return facts.slice(0, 6);
}

function badgesFor(
  tone: RunOutcomeTone,
  trustLabel: string,
  saved: boolean,
): RunOutcomeBadge[] {
  return [
    { label: trustLabel, tone },
    { label: saved ? "Saved" : "Not saved", tone: saved ? "neutral" : "warn" },
  ];
}

function codeFrom(
  events: readonly OutcomeEvent[],
): RunOutcomeView["code"] {
  const best = lastEvent(events, "run.best_effort");
  const final = lastEvent(events, "code.finalized");
  const generated = lastEvent(events, "code.generated");
  const source = best ?? final ?? generated;
  if (!source?.code) return undefined;
  const plan = lastEvent(events, "plan.produced")?.plan;
  const revision = source.revision ? ` · revision ${source.revision}` : "";
  return {
    label: best ? `Best candidate${revision}` : `Generated code${revision}`,
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
    ?? "Quantum circuit workflow";
  const facts = factsFrom(events);
  const code = codeFrom(events);

  if (finished.status === "cancelled") {
    return {
      tone: "neutral",
      eyebrow: "Run stopped",
      title: "The run was cancelled",
      description: "No completed result was produced.",
      badges: badgesFor("neutral", "Cancelled", saved),
      facts,
      callout: {
        title: "No verification result",
        body: "The workflow ended before its evidence could be completed.",
      },
      code,
    };
  }

  if (finished.status !== "succeeded") {
    const failureDescription = friendlyFailure(failure?.message, failure?.stage, failure?.code);
    const checks = checksFrom(summary, best?.failed_checks);
    if (best) {
      return {
        tone: "warn",
        eyebrow: "Best available result",
        title: "The strongest candidate was preserved",
        description: "The generated result remains available for inspection, with its verification limits clearly marked.",
        badges: badgesFor("warn", "Not verified", false),
        facts,
        callout: {
          title: "Why it was not accepted",
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
        eyebrow: "Verification failed",
        title: "The candidate did not pass verification",
        description,
        badges: badgesFor("err", "Failed", saved),
        facts,
        callout: {
          title: "Result rejected",
          body: humanize(summary.reason_code),
        },
        checks: checks.length ? checks : undefined,
        code,
      };
    }
    return {
      tone: "err",
      eyebrow: "Run incomplete",
      title: failure?.stage === "plan" || failure?.stage === "generate"
        ? "Generation could not complete"
        : "The workflow could not complete",
      description,
      badges: badgesFor("err", "Not verified", false),
      facts,
      callout: {
        title: "What happened",
        body: failureDescription,
      },
      code,
    };
  }

  if (!summary) {
    return {
      tone: "warn",
      eyebrow: "Legacy result",
      title: "Verification evidence is unavailable",
      description,
      badges: badgesFor("warn", "Evidence unknown", saved),
      facts,
      callout: {
        title: "Not treated as Verified",
        body: "This successful record has no typed verification summary. Review or rerun it before relying on the result.",
      },
      code,
    };
  }

  const checks = checksFrom(summary, undefined);
  if (summary.decision === "fail") {
    return {
      tone: "err",
      eyebrow: "Verification failed",
      title: "The completed workflow did not pass verification",
      description,
      badges: badgesFor("err", "Failed", saved),
      facts,
      callout: {
        title: "Result rejected",
        body: humanize(summary.reason_code),
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
      eyebrow: advisory ? "Executed result" : "Verification unavailable",
      title: advisory
        ? "The circuit executed and matched the request"
        : "The circuit ran, but correctness is unconfirmed",
      description,
      badges: badgesFor("warn", advisory ? "Executed" : "Not verified", saved),
      facts,
      callout: {
        title: advisory ? "Strict verification was not run" : "Evidence is incomplete",
        body: claims.length
          ? `Not established: ${claims.map(humanize).join(", ")}.`
          : "Review the available evidence before relying on this result.",
      },
      checks: checks.length ? checks : undefined,
      code,
    };
  }

  const physical = summary.evidence_strength === "physical";
  const risk = residualRisk(events);
  return {
    tone: physical ? "ok" : "warn",
    eyebrow: physical ? "Verified result" : "Structural result",
    title: physical ? "The circuit passed verification" : "The circuit passed structural checks",
    description,
    badges: badgesFor(physical ? "ok" : "warn", physical ? "Verified" : "Structurally verified", saved),
    facts,
    callout: !physical || risk
      ? {
          title: physical ? "Residual limitation" : "Physical correctness was not established",
          body: risk ?? "The available evidence confirms structure and result shape, not physical correctness.",
        }
      : undefined,
    checks: checks.length ? checks : undefined,
    code,
  };
}
