/**
 * `workflow-planner/block-audit.ts`: the build-time audit that counts the
 * gates Leona's own Studio blocks build at small sizes and compares them
 * with the workflow planner's paper-sourced cost formulas.
 *
 * Four things this file proves, matching VISION.md §10's kill criterion
 * ("the small-instance cross-check finds nothing"):
 *
 * 1. Every method stage-blocks.ts pairs with Studio blocks gets a real
 *    look — audited (at least one MATCH or GAP) or explicitly not
 *    countable, with a reason. No stage is silently skipped.
 * 2. The audit finds gaps AND matches on the real planner — not vacuously
 *    one or the other.
 * 3. The audit CAN fail: a deliberately wrong formula, fed through the same
 *    comparison the real rows use, is caught as a "gap", not a silent
 *    match. This is the test the module comment says to watch go red.
 * 4. The generated report committed at docs/atlas/block-audit.md is
 *    current — regenerate with `node scripts/generate-block-audit-report.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditBlocks, auditCostLine, stageCoverage, summarize, workedExampleBlockCoverage } from "./workflow-planner/block-audit.ts";
import { renderReport } from "./workflow-planner/block-audit-report.ts";
import { stageBlockMethodIds } from "./workflow-planner/stage-blocks.ts";
import { WORKED_EXAMPLES } from "./worked-examples.ts";
import type { CostLine } from "./workflow-planner/types.ts";

const ROWS = auditBlocks();
const COVERAGE = stageCoverage(ROWS);
const SUMMARY = summarize(ROWS);

test("every stage-blocks.ts method is audited or explicitly not countable, with a reason", () => {
  const stages = stageBlockMethodIds();
  assert.equal(COVERAGE.length, stages.length, "stageCoverage should return exactly one row per stage-blocks.ts method");
  for (const row of COVERAGE) {
    assert.ok(stages.includes(row.stage), `"${row.stage}" is not a real stage-blocks.ts method id`);
    if (row.status === "not-countable") {
      assert.ok(row.reason && row.reason.length > 0, `${row.stage} is not-countable but carries no reason`);
    }
  }
  // Not vacuous: at least one stage is genuinely audited.
  assert.ok(COVERAGE.some((row) => row.status === "audited"), "no stage was ever genuinely audited");
});

test("summary counts add up, and the audit both finds a match and finds a gap on the real planner", () => {
  assert.equal(SUMMARY.total, ROWS.length);
  assert.equal(SUMMARY.matches + SUMMARY.gaps + SUMMARY.notCountable, SUMMARY.total);
  // VISION.md §10's kill criterion is that the small-instance cross-check
  // finds NOTHING. Both halves matter here: an audit that only ever reports
  // "match" is as untrustworthy as one that only ever reports "not
  // countable" — either way it would never surface a real disagreement.
  assert.ok(SUMMARY.matches > 0, "the audit never found a match — is it comparing anything at all?");
  assert.ok(SUMMARY.gaps > 0, "the audit never found a gap on the real planner — the cross-check would report nothing, VISION.md §10's kill criterion");
});

test("the known day-one gap (PLAN.md point 4): qft_inverse's swaps aren't in cemm-qft, so it's a match plus a named extra", () => {
  const row = ROWS.find((r) => r.stage === "register-phase-estimation" && r.block === "qft_inverse" && r.costLineId === "cemm-qft" && r.n === 4);
  assert.ok(row, "expected a cemm-qft row for qft_inverse at n=4");
  assert.equal(row!.verdict, "match");
  assert.equal(row!.predicted, row!.counted);
  assert.ok((row!.countedOps.SWAP ?? 0) > 0, "qft_inverse should still build SWAP gates that cemm-qft doesn't count");
  assert.match(row!.explanation, /SWAP/);
});

test("a genuine gap the audit found on its own: qaoa_maxcut_layer doesn't build the mixer's initial Hadamards", () => {
  const row = ROWS.find((r) => r.stage === "qaoa-cost-mixer-alternation" && r.block === "qaoa_maxcut_layer" && r.costLineId === "qaoa-mixer" && r.n === 4);
  assert.ok(row, "expected a qaoa-mixer row for qaoa_maxcut_layer at n=4");
  assert.equal(row!.verdict, "gap");
  assert.equal(row!.predicted, 8); // n + p*n = 4 + 1*4
  assert.equal(row!.counted, 4); // just the p*n RX mixer rotations; no H's
});

test("the audit CAN fail: a deliberately wrong formula produces a gap, not a silent match", () => {
  const wrongLine: CostLine = {
    id: "test-deliberately-wrong",
    label: { en: "test", ja: "test" },
    value: 999, // qft_inverse at n=4 builds 4 H + 6 CP = 10, not 999.
    unit: { en: "gates", ja: "ゲート" },
    formula: "999 (deliberately wrong, for this test)",
    kind: "exact",
    source: null,
    counts: { ops: ["H", "CP"] },
  };
  const row = auditCostLine("register-phase-estimation", "qft_inverse", 4, wrongLine);
  assert.equal(row.verdict, "gap", "a wrong formula must be caught as a gap, not waved through");
  assert.equal(row.predicted, 999);
  assert.equal(row.counted, 10);
});

test("the same mechanism reports a match when the formula IS right (positive control on the fixture above)", () => {
  const rightLine: CostLine = {
    id: "test-deliberately-right",
    label: { en: "test", ja: "test" },
    value: 10, // 4 H + 6 CP, matching qft_inverse at n=4 exactly.
    unit: { en: "gates", ja: "ゲート" },
    formula: "4 + 4*3/2",
    kind: "exact",
    source: null,
    counts: { ops: ["H", "CP"] },
  };
  const row = auditCostLine("register-phase-estimation", "qft_inverse", 4, rightLine);
  assert.equal(row.verdict, "match");
});

test("a line with no `counts` is reported not-countable, never guessed at", () => {
  const uncountedLine: CostLine = {
    id: "test-no-counts",
    label: { en: "test", ja: "test" },
    value: 10,
    unit: { en: "gates", ja: "ゲート" },
    formula: "10",
    kind: "exact",
    source: null,
  };
  const row = auditCostLine("register-phase-estimation", "qft_inverse", 4, uncountedLine);
  assert.equal(row.verdict, "not-countable");
  assert.equal(row.counted, null);
});

test("docs/atlas/block-audit.md is current with what auditBlocks() produces right now", () => {
  const docPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "atlas", "block-audit.md");
  const committed = readFileSync(docPath, "utf8");
  const generated = renderReport(ROWS, COVERAGE, SUMMARY);
  assert.equal(committed, generated, "docs/atlas/block-audit.md is stale — run `node scripts/generate-block-audit-report.mjs` and commit the result");
});

test("every worked-example block key this audit ALSO exercises via stage-blocks.ts resolves to the right stage", () => {
  const coverage = workedExampleBlockCoverage(WORKED_EXAMPLES);
  assert.ok(coverage.length > 0, "expected at least one block key across WORKED_EXAMPLES");
  const byKey = new Map(coverage.map((row) => [row.blockKey, row.coveredByStage]));
  assert.equal(byKey.get("qft_inverse"), "register-phase-estimation");
  assert.equal(byKey.get("qaoa_maxcut_layer"), "qaoa-cost-mixer-alternation");
  assert.equal(byKey.get("phase_oracle"), "grover-fixed-iteration-search");
  // hadamard_layer is placed by many worked examples but paired with no
  // single method in stage-blocks.ts (its own comment: state prep "belongs
  // to every stage, not this one specifically") — legitimately uncovered.
  assert.equal(byKey.get("hadamard_layer"), null);
});
