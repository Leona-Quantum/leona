/**
 * The plan-to-Studio link (`workflow-planner/studio-link.ts`) and the
 * Atlas-method -> Studio-block census it is carried alongside
 * (`workflow-planner/stage-blocks.ts`).
 *
 * The link's whole job is to fail closed: anything that does not match its
 * strict shape must decode to `null`, never throw, and never silently accept
 * a value the rest of the planner could not otherwise produce (an
 * undeclared parameter key, a non-finite number, more choices than a real
 * pipeline has stages for). Each rejection test below starts from a payload
 * that WOULD round-trip, and breaks exactly one field — so a false pass here
 * would mean the corresponding check in `studio-link.ts` is dead code, not
 * that the payload was wrong in some unrelated way.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { BLOCK_TEMPLATES } from "./circuit-blocks.ts";
import {
  decodeStudioPlanHash,
  encodeStudioPlanLink,
  studioPlanHref,
  validateStudioPlanPayload,
  STUDIO_PLAN_LINK_MAX_CHARS,
  STUDIO_PLAN_LINK_MAX_CHOICES,
  type StudioPlanLink,
} from "./workflow-planner/studio-link.ts";
import { STAGE_BLOCKS, stageBlockKeys, stageBlockMethodIds } from "./workflow-planner/stage-blocks.ts";

const VALID: Omit<StudioPlanLink, "v"> = {
  text: "Search a database of one million records for the single record that matches.",
  problem: "search",
  params: { domainSize: 1e6, markedCount: 1 },
  choices: { "marked-item-search": "grover-fixed-iteration-search" },
};

// ---------------------------------------------------------------------------
// Round-trip

test("a valid plan round-trips through the fragment exactly", () => {
  const fragment = encodeStudioPlanLink(VALID);
  assert.match(fragment, /^plan=[A-Za-z0-9_-]+$/, "base64url, no padding, no leading #");
  const decoded = decodeStudioPlanHash(`#${fragment}`);
  assert.deepEqual(decoded, { v: 1, ...VALID });
  // Without the leading `#` too — callers may hand either.
  assert.deepEqual(decodeStudioPlanHash(fragment), { v: 1, ...VALID });
});

test("a Japanese sentence round-trips — the payload is UTF-8, not Latin1", () => {
  const withJapanese: Omit<StudioPlanLink, "v"> = { ...VALID, text: "100 万件のデータベースから、条件に合う 1 件を探したい。" };
  const decoded = decodeStudioPlanHash(`#${encodeStudioPlanLink(withJapanese)}`);
  assert.equal(decoded?.text, withJapanese.text);
});

test("studioPlanHref builds the documented URL shape, sentence and numbers only in the fragment", () => {
  const href = studioPlanHref("grover-3q-101", VALID);
  const [beforeHash, afterHash] = href.split("#");
  assert.equal(beforeHash, "/studio?example=grover-3q-101&plan=1");
  assert.match(afterHash, /^plan=[A-Za-z0-9_-]+$/);
  assert.ok(!beforeHash.includes(encodeURIComponent(VALID.text.slice(0, 10))), "no sentence text before the #");
  assert.ok(!beforeHash.includes("1000000"), "no numbers before the #");
});

// ---------------------------------------------------------------------------
// Strict rejection — one broken field per test, everything else valid

test("rejects a fragment with no plan= key at all", () => {
  assert.equal(decodeStudioPlanHash("#other=1"), null);
  assert.equal(decodeStudioPlanHash(""), null);
});

test("rejects an oversized encoded payload before attempting to decode it", () => {
  const huge = "a".repeat(STUDIO_PLAN_LINK_MAX_CHARS + 1);
  assert.equal(decodeStudioPlanHash(`#plan=${huge}`), null);
  // One character under the cap, but otherwise garbage, still fails — on
  // shape, not on size. This pins the size check as a PRE-filter, not the
  // only line of defense.
  assert.equal(decodeStudioPlanHash(`#plan=${"a".repeat(STUDIO_PLAN_LINK_MAX_CHARS)}`), null);
});

test("rejects the wrong version", () => {
  assert.equal(validateStudioPlanPayload({ v: 2, text: VALID.text, problem: VALID.problem, params: VALID.params, choices: VALID.choices }), null);
  assert.equal(validateStudioPlanPayload({ text: VALID.text, problem: VALID.problem, params: VALID.params, choices: VALID.choices }), null);
});

test("rejects an unknown problem id", () => {
  assert.equal(validateStudioPlanPayload({ v: 1, text: VALID.text, problem: "not-a-real-problem", params: {}, choices: {} }), null);
});

test("rejects a param key the problem does not declare", () => {
  // "search" declares domainSize/markedCount/oracleToffolis — kappa belongs
  // to linear-system, not this problem.
  assert.equal(
    validateStudioPlanPayload({ v: 1, text: VALID.text, problem: "search", params: { kappa: 1000 }, choices: {} }),
    null,
  );
});

test("rejects a non-finite param value", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(
      validateStudioPlanPayload({ v: 1, text: VALID.text, problem: "search", params: { domainSize: bad }, choices: {} }),
      null,
      String(bad),
    );
  }
  // A string in a numeric slot is rejected, not coerced.
  assert.equal(
    validateStudioPlanPayload({ v: 1, text: VALID.text, problem: "search", params: { domainSize: "1000000" }, choices: {} }),
    null,
  );
  // `null` is the one non-number value the shape allows (a reader-cleared field).
  assert.deepEqual(
    validateStudioPlanPayload({ v: 1, text: VALID.text, problem: "search", params: { domainSize: null }, choices: {} }),
    { v: 1, text: VALID.text, problem: "search", params: { domainSize: null }, choices: {} },
  );
});

test("rejects more choices than the cap", () => {
  const tooMany: Record<string, string> = {};
  for (let i = 0; i <= STUDIO_PLAN_LINK_MAX_CHOICES; i += 1) tooMany[`path-${i}`] = "some-method";
  assert.equal(Object.keys(tooMany).length, STUDIO_PLAN_LINK_MAX_CHOICES + 1);
  assert.equal(validateStudioPlanPayload({ v: 1, text: VALID.text, problem: VALID.problem, params: {}, choices: tooMany }), null);
  // One under the cap is fine.
  delete tooMany[`path-${STUDIO_PLAN_LINK_MAX_CHOICES}`];
  assert.ok(validateStudioPlanPayload({ v: 1, text: VALID.text, problem: VALID.problem, params: {}, choices: tooMany }));
});

test("rejects a non-string choice value", () => {
  assert.equal(
    validateStudioPlanPayload({ v: 1, text: VALID.text, problem: VALID.problem, params: {}, choices: { "some-path": 42 } }),
    null,
  );
});

test("rejects text over the planner's own cap", () => {
  // eslint-disable-next-line
  const overLong = "a".repeat(2001); // PLAN_TEXT_MAX is 2000 (recognise.ts)
  assert.equal(
    validateStudioPlanPayload({ v: 1, text: overLong, problem: VALID.problem, params: {}, choices: {} }),
    null,
  );
  assert.ok(validateStudioPlanPayload({ v: 1, text: "a".repeat(2000), problem: VALID.problem, params: {}, choices: {} }));
});

test("rejects a payload that is not an object, and a params/choices field that is not an object", () => {
  assert.equal(validateStudioPlanPayload(null), null);
  assert.equal(validateStudioPlanPayload("plan"), null);
  assert.equal(validateStudioPlanPayload([1, 2, 3]), null);
  assert.equal(validateStudioPlanPayload({ v: 1, text: VALID.text, problem: VALID.problem, params: "nope", choices: {} }), null);
  assert.equal(validateStudioPlanPayload({ v: 1, text: VALID.text, problem: VALID.problem, params: {}, choices: "nope" }), null);
});

test("a malformed base64url fragment decodes to null rather than throwing", () => {
  assert.equal(decodeStudioPlanHash("#plan=not-valid-base64!!!"), null);
  assert.equal(decodeStudioPlanHash("#plan="), null);
});

// ---------------------------------------------------------------------------
// STAGE_BLOCKS census

test("every STAGE_BLOCKS key is a real Studio block template", () => {
  const templateKeys = new Set(BLOCK_TEMPLATES.map((t) => t.key));
  for (const key of stageBlockKeys()) assert.ok(templateKeys.has(key), `not a block template: ${key}`);
  assert.ok(stageBlockKeys().length > 0);
});

test("every STAGE_BLOCKS method id is a real method node in LAYER_GRAPH", () => {
  const methodIds = new Set(LAYER_GRAPH.nodes.filter((node) => node.kind === "method").map((node) => node.id));
  for (const id of stageBlockMethodIds()) assert.ok(methodIds.has(id), `not a method node: ${id}`);
  assert.ok(stageBlockMethodIds().length > 0);
});

test("STAGE_BLOCKS lists at least the pairings the plan panel is built around", () => {
  assert.deepEqual([...STAGE_BLOCKS["grover-fixed-iteration-search"]].sort(), ["grover_diffuser", "grover_iteration", "phase_oracle"]);
  assert.ok(STAGE_BLOCKS["cyclic-period-finding"]?.includes("qft_inverse"));
  assert.ok(STAGE_BLOCKS["amplitude-estimation-readout"]?.includes("amplitude_estimation_powers"));
  assert.ok(STAGE_BLOCKS["product-formula-simulation"]?.includes("ising_trotter_step"));
  assert.ok(STAGE_BLOCKS["qaoa-cost-mixer-alternation"]?.includes("qaoa_maxcut_layer"));
});
