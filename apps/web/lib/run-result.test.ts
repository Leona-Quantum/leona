import assert from "node:assert/strict";
import { test } from "node:test";

import { runResultFromEvents } from "./run-result.ts";
import {
  contextualReviewFollowUps,
  followUpPrompts,
  splitAssistantFollowUps,
} from "./follow-up-prompts.ts";
import type { OutcomeEvent } from "./run-outcome.ts";

const succeeded = (
  extra: OutcomeEvent[] = [],
  verificationSummary?: unknown,
): OutcomeEvent[] => [
  { type: "run.queued", mode: "execute" },
  {
    type: "plan.produced",
    plan: {
      problem_summary: "Prepare and measure a Bell state",
      algorithm: "Bell",
      framework: "qiskit",
      expected_output_keys: ["counts"],
    },
  },
  { type: "code.generated", revision: 1, code: "print('bell')", language: "python" },
  ...extra,
  { type: "run.finished", status: "succeeded", verification_summary: verificationSummary },
];

test("every completed response kind offers three editable follow-up prompts", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const kind of ["answer", "result", "failure"] as const) {
      const prompts = followUpPrompts(kind, locale);
      assert.equal(prompts.length, 3);
      assert.ok(prompts.every((prompt) => prompt.trim().length > 0));
      assert.equal(new Set(prompts).size, 3);
    }
  }
  assert.match(followUpPrompts("result", "ja")[0], /古典ベースライン/);
  assert.match(followUpPrompts("failure", "en")[1], /run the same objective again/i);
});

test("a chat answer carries contextual follow-ups without showing metadata as prose", () => {
  const parsed = splitAssistantFollowUps(
    "The H2 ansatz preserves particle number.\n\n"
      + '<!-- majorana-follow-ups: ["How does this ansatz represent H2?",'
      + ' "Would UCCSD improve this calculation?"] -->',
  );

  assert.equal(parsed.answer, "The H2 ansatz preserves particle number.");
  assert.deepEqual(parsed.prompts, [
    "How does this ansatz represent H2?",
    "Would UCCSD improve this calculation?",
  ]);
  assert.equal(splitAssistantFollowUps("Visible answer only").answer, "Visible answer only");
});

test("a half-streamed follow-ups marker never reaches the reader as prose", () => {
  // The worker emits deltas in fixed 160-character chunks and holds the shorter
  // tail until the model finishes, so a boundary inside the 25-character marker is
  // on screen for seconds. react-markdown here has no raw-HTML plugin, so an
  // unterminated comment is escaped and shown rather than dropped.
  const answer = "The Bell state is maximally entangled.";
  for (const cut of ["<", "<!", "<!-", "<!--", "<!-- majorana", "<!-- majorana-follow-ups"]) {
    assert.equal(
      splitAssistantFollowUps(`${answer}\n\n${cut}`).answer,
      answer,
      `partial marker "${cut}" leaked into the answer`,
    );
  }

  // A complete marker whose payload is still arriving was already handled; pin it.
  assert.equal(
    splitAssistantFollowUps(`${answer}\n\n<!-- majorana-follow-ups: ["How`).answer,
    answer,
  );

  // Prose that merely contains `<` is untouched — the cost is one trailing `<`
  // per chunk, never a word.
  assert.equal(splitAssistantFollowUps("Use a < b to compare.").answer, "Use a < b to compare.");
  assert.equal(splitAssistantFollowUps("A tag <div> is fine").answer, "A tag <div> is fine");
});

test("the latest semantic review supplies task-specific execution follow-ups", () => {
  const prompts = contextualReviewFollowUps([
    {
      type: "verification.semantic_review",
      feedback: {
        critic: {
          suggested_follow_ups: [
            "Compare this VQE energy with exact diagonalization?",
            "Try a deeper particle-preserving ansatz?",
          ],
        },
      },
    },
  ]);

  assert.deepEqual(prompts, [
    "Compare this VQE energy with exact diagonalization?",
    "Try a deeper particle-preserving ansatz?",
  ]);
});

test("a successful run leads with what it produced, not with a verdict", () => {
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { counts: { "00": 512, "11": 512 } } } as OutcomeEvent,
    ]),
  );

  assert.ok(result);
  assert.equal(
    result.summary,
    "The most frequent measured state is 00 (50%). The requested deliverable was generated and executed. You can review the result and generated code above, and reuse the code for further runs or adjustments. The displayed status and limitations show the scope of verification.",
  );
  assert.equal(result.distribution?.total, 1024);
  assert.deepEqual(
    result.distribution?.data.bars.map((bar) => bar.bitstring).sort(),
    ["00", "11"],
  );
  assert.equal(result.code?.source, "print('bell')");
});

test("a generated final explanation replaces the short deterministic fallback", () => {
  const explanation = [
    "H2の基底状態エネルギーは **-1.137 Ha** でした。",
    "VQEで試行状態を最適化し、隔離されたシミュレータ上で期待値を評価しました。",
    "次は厳密対角化の基準値と比較すると、誤差を定量的に確認できます。",
  ].join("\n\n");
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { energy_Ha: -1.137 } } as OutcomeEvent,
      { type: "run.analysis", interpretation: explanation } as OutcomeEvent,
    ]),
    null,
    "ja",
  );

  assert.equal(result?.summary, explanation);
  assert.doesNotMatch(result?.summary ?? "", /ご依頼に基づく成果物/);
});

test("scalar values are reported in the order the plan promised them", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    {
      type: "plan.produced",
      plan: {
        problem_summary: "H2 ground state",
        framework: "qiskit",
        expected_output_keys: ["energy_Ha", "iterations"],
      },
    },
    { type: "code.generated", revision: 2, code: "print('vqe')" },
    {
      type: "sandbox.result",
      result: { iterations: 34, energy_Ha: -1.1373061, notes: "converged" },
    } as OutcomeEvent,
    { type: "run.finished", status: "succeeded" },
  ]);

  assert.deepEqual(result?.values.map((value) => value.label), [
    "Energy Ha",
    "Iterations",
    "Notes",
  ]);
  assert.equal(result?.values[0].value, "-1.137306");
});

test("a distribution is found under whatever key the plan chose", () => {
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { histogram: { "000": 900, "111": 100 } } } as OutcomeEvent,
    ]),
  );

  assert.equal(result?.distribution?.total, 1000);
  assert.equal(result?.distribution?.data.peak.bitstring, "000");
});

test("a run with no distribution still reports its values and code", () => {
  const result = runResultFromEvents(
    succeeded([{ type: "sandbox.result", result: { fidelity: 0.998 } } as OutcomeEvent]),
  );

  assert.equal(result?.distribution, null);
  assert.deepEqual(result?.values, [{ key: "fidelity", label: "Fidelity", value: "0.998" }]);
  assert.ok(result?.code);
});

test("a research-style optimization history becomes a convergence visual", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    {
      type: "plan.produced",
      plan: {
        problem_summary: "Estimate a variational ground-state energy",
        framework: "qiskit",
        expected_output_keys: ["energy", "optimization_history"],
      },
    },
    { type: "code.generated", revision: 1, code: "run_vqe()" },
    {
      type: "sandbox.result",
      result: { energy: -1.137, optimization_history: [-0.2, -0.8, -1.1, -1.137] },
    } as OutcomeEvent,
    { type: "run.finished", status: "succeeded" },
  ]);

  assert.equal(result?.traces.length, 1);
  assert.equal(result?.traces[0]?.label, "Optimization History");
  assert.equal(result?.traces[0]?.end, -1.137);
  assert.deepEqual(result?.values, [{ key: "energy", label: "Energy", value: "-1.137" }]);
});

test("a review that did not accept is marked, not hidden", () => {
  const result = runResultFromEvents(
    succeeded(
      [{ type: "sandbox.result", result: { counts: { "00": 1024 } } } as OutcomeEvent],
      {
        decision: "inconclusive",
        evidence_strength: "structural",
        reason_code: "trusted_evidence_without_review_acceptance",
        candidate_defect_observed: false,
        failure_class: null,
        retry_target: "none",
        semantic_review_decision: "code_repair",
        checks: [],
        unverified_claims: ["intent alignment"],
      },
    ),
  );

  // Distinguished by a LABEL, not by colour alone, and without naming the reviewer.
  assert.equal(result?.trust.tone, "warn");
  assert.equal(result?.trust.label, "Executed · needs attention");
  assert.deepEqual(result?.limitations, ["Intent Alignment"]);
  assert.match(result?.summary ?? "", /some points remain unverified/i);
});

test("the fallback explanation addresses a Japanese reader instead of repeating the plan", () => {
  const result = runResultFromEvents(
    succeeded([
      { type: "sandbox.result", result: { counts: { "00": 512, "11": 512 } } } as OutcomeEvent,
    ]),
    null,
    "ja",
  );

  assert.equal(
    result?.summary,
    "測定で最も多かった状態は00（50%）です。ご依頼に基づく成果物を生成し、実行しました。上の成果物で結果と生成コードを確認でき、コードは再実行や追加調整にも利用できます。検証の範囲は表示されている状態と注意点から確認できます。",
  );
  assert.doesNotMatch(result?.summary ?? "", /Bell state/);
});

test("a chat turn is not a deliverable — the answer owns the message", () => {
  // A conversation run finishes SUCCEEDED with no plan, no code and no sandbox
  // result. Returning a view here rendered "✓ Deliverable / Final Output /
  // Quantum circuit run" *in place of* the assistant's answer, because both
  // render sites prefer the result over the text.
  assert.equal(
    runResultFromEvents([
      { type: "run.queued", mode: "auto" },
      { type: "run.started" },
      { type: "run.mode_resolved", requested: "auto", resolved: "chat" } as OutcomeEvent,
      { type: "chat.completed", text: "A Bell state is a maximally entangled two-qubit state." } as OutcomeEvent,
      { type: "run.finished", status: "succeeded" },
    ]),
    null,
  );
});

test("a succeeded run with neither a program nor a result is not a deliverable", () => {
  // Mode-independent: the header says "Deliverable", so something has to have
  // been delivered. Without this the fallback summary invents one.
  assert.equal(
    runResultFromEvents([
      { type: "run.queued", mode: "execute" },
      { type: "run.finished", status: "succeeded" },
    ]),
    null,
  );
});

test("a legacy analysis-only run leaves the message to its answer text", () => {
  assert.equal(
    runResultFromEvents([
      { type: "run.queued", mode: "auto" },
      { type: "run.analysis", interpretation: "Here is how Grover's algorithm works." },
      { type: "run.finished", status: "succeeded" },
    ]),
    null,
  );
});

test("a failed run produces no result view — the failure card owns that case", () => {
  assert.equal(
    runResultFromEvents([
      { type: "run.queued", mode: "execute" },
      { type: "run.finished", status: "failed" },
    ]),
    null,
  );
});

test("a failed verification still exposes protected results and best available code", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    {
      type: "plan.produced",
      plan: {
        problem_summary: "Estimate the H2 ground state",
        framework: "qiskit",
        expected_output_keys: ["energy_Ha"],
      },
    },
    { type: "code.generated", revision: 4, code: "print('revision 4')" },
    {
      type: "sandbox.result",
      result: { energy_Ha: -1.12 },
    } as OutcomeEvent,
    {
      type: "run.best_effort",
      revision: 4,
      code: "print('best revision 4')",
      language: "python",
      residual_risks: ["Energy missed the requested tolerance."],
    },
    {
      type: "run.error",
      stage: "verify",
      code: "candidate_budget_exhausted",
      message: "intent review did not align the candidate",
    },
    {
      type: "run.finished",
      status: "failed",
      residual_risks: "Verification did not accept this candidate.",
    },
  ]);

  assert.ok(result);
  assert.equal(result.trust.label, "Best available · not verified");
  assert.equal(result.values[0]?.value, "-1.12");
  assert.equal(result.code?.label, "Best available code");
  assert.equal(result.code?.source, "print('best revision 4')");
  assert.deepEqual(result.limitations, [
    "Energy missed the requested tolerance.",
    "Verification did not accept this candidate.",
  ]);
  assert.equal(result.notice?.title, "Why this result was not accepted");
  assert.match(result.notice?.body ?? "", /repair attempts were used/i);
  assert.match(result.summary, /did not pass final verification/i);
});

test("a failed run never pairs an older revision's result with newer best-effort code", () => {
  const result = runResultFromEvents([
    { type: "run.queued", mode: "execute" },
    { type: "code.generated", revision: 1, code: "revision_one()" },
    { type: "sandbox.result", result: { energy_Ha: -1.137 } } as OutcomeEvent,
    { type: "code.generated", revision: 2, code: "revision_two()" },
    { type: "sandbox.result", result: null } as OutcomeEvent,
    {
      type: "run.best_effort",
      revision: 2,
      code: "revision_two()",
      language: "python",
    },
    { type: "run.finished", status: "failed" },
  ]);

  assert.ok(result);
  assert.deepEqual(result.values, []);
  assert.equal(result.distribution, null);
  assert.equal(result.code?.source, "revision_two()");
});

test("the result badge never advertises that a model did the reviewing", () => {
  const accepted = runResultFromEvents(
    succeeded([{ type: "sandbox.result", result: { counts: { "00": 1024 } } } as OutcomeEvent]),
  );

  assert.equal(accepted?.trust.label, "Executed");
  assert.doesNotMatch(JSON.stringify(accepted), /AI[- ]review/i);
});

test("a Japanese run localizes result metadata but preserves code and framework values", () => {
  const result = runResultFromEvents(
    succeeded(
      [{ type: "sandbox.result", result: { counts: { "00": 1024 }, energy_Ha: -1.137 } } as OutcomeEvent],
      {
        decision: "inconclusive",
        evidence_strength: "structural",
        reason_code: "trusted_evidence_without_review_acceptance",
        candidate_defect_observed: false,
        failure_class: null,
        retry_target: "none",
        semantic_review_decision: "code_repair",
        checks: [],
        unverified_claims: ["intent_alignment"],
      },
    ),
    null,
    "ja",
  );

  assert.equal(result?.trust.label, "実行済み・要確認");
  assert.deepEqual(result?.limitations, ["意図との整合性"]);
  assert.ok(result?.facts.some((fact) => fact.label === "フレームワーク" && fact.value === "qiskit"));
  assert.equal(result?.code?.label, "最終コード");
  assert.equal(result?.code?.source, "print('bell')");
});
