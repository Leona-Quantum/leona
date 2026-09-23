import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, waitFor } from "@testing-library/react";
import { StudioPlanPanel } from "../../app/(app)/studio/studio-plan-panel.tsx";
import { LAYER_GRAPH } from "../../lib/repository/layer-graph.ts";
import { slimLayerGraph } from "../../lib/workflow-planner/graph.ts";
import { encodeStudioPlanLink } from "../../lib/workflow-planner/studio-link.ts";

const GRAPH = slimLayerGraph(LAYER_GRAPH, "en");

function renderPanel() {
  return render(<StudioPlanPanel graph={GRAPH} locale="en" activeExample={null} onInsertBlock={() => {}} />);
}

test("a valid plan link shows the problem, a sourced logical-cost line, and an Insert action for a stage with blocks", async () => {
  window.location.hash = `#${encodeStudioPlanLink({
    text: "Search a database of one million records for the single record that matches.",
    problem: "search",
    params: { domainSize: 1e6, markedCount: 1 },
    choices: {},
  })}`;
  const view = renderPanel();
  try {
    await waitFor(() => assert.match(view.container.textContent ?? "", /From your plan/));
    assert.match(view.container.textContent ?? "", /Search a database of one million records/);
    // The pipeline: the planner's own choice label, reused verbatim.
    assert.match(view.container.textContent ?? "", /Planner's pick/);
    // "At your size": the exact iteration count, its kind, and its source —
    // never a bare number.
    assert.match(view.container.textContent ?? "", /Exact/);
    assert.match(view.container.textContent ?? "", /quant-ph\/9605034/);
    // Build a stage here: grover-fixed-iteration-search has no `steps`, so
    // this is the root stage's own Insert list (stage-blocks.ts).
    const insertButtons = [...view.container.querySelectorAll("button")].filter((b) => /Insert/.test(b.textContent ?? ""));
    assert.ok(insertButtons.length >= 3, `expected at least 3 Insert buttons, found ${insertButtons.length}`);
    assert.match(view.container.textContent ?? "", /Grover diffuser|Phase oracle|Grover iteration/);
    // Back to the full plan carries the sentence, not the query string.
    const backLink = [...view.container.querySelectorAll("a")].find((a) => /Back to the full plan/.test(a.textContent ?? ""));
    assert.ok(backLink);
    assert.match(backLink!.getAttribute("href") ?? "", /^\/repository\/plan#q=/);
  } finally {
    window.location.hash = "";
  }
});

test("clicking Insert calls back with the block's key", async () => {
  window.location.hash = `#${encodeStudioPlanLink({
    text: "Search a database of one million records for the single record that matches.",
    problem: "search",
    params: { domainSize: 1e6, markedCount: 1 },
    choices: {},
  })}`;
  const inserted: string[] = [];
  const view = render(<StudioPlanPanel graph={GRAPH} locale="en" activeExample={null} onInsertBlock={(key) => inserted.push(key)} />);
  try {
    await waitFor(() => assert.match(view.container.textContent ?? "", /Build a stage here/));
    const button = [...view.container.querySelectorAll("button")].find((b) => /Insert/.test(b.textContent ?? ""));
    assert.ok(button);
    button!.click();
    assert.deepEqual(inserted, ["phase_oracle"]);
  } finally {
    window.location.hash = "";
  }
});

test("an invalid plan fragment shows the error, with a link back to the planner, and never throws", async () => {
  window.location.hash = "#plan=not-a-real-payload";
  const view = renderPanel();
  try {
    await waitFor(() => assert.match(view.container.textContent ?? "", /could not be read/));
    const link = view.container.querySelector("a[href='/repository/plan']");
    assert.ok(link, "a way back to the planner is shown");
  } finally {
    window.location.hash = "";
  }
});

test("no plan fragment renders nothing", () => {
  window.location.hash = "";
  const view = renderPanel();
  assert.equal(view.container.textContent, "");
  assert.equal(view.container.childElementCount, 0);
});

test("a hash used for something else (e.g. #comments) is read as no plan, not as an invalid one", () => {
  window.location.hash = "#comments";
  const view = renderPanel();
  try {
    assert.equal(view.container.textContent, "");
  } finally {
    window.location.hash = "";
  }
});
