import "./dom-env.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AtlasWorkflowPlanner, type PlannerPaper } from "../../components/atlas-workflow-planner.tsx";
import { LAYER_GRAPH } from "../../lib/repository/layer-graph.ts";
import { PAPER_REGISTER } from "../../lib/repository/paper-register.ts";
import { slimLayerGraph } from "../../lib/workflow-planner/graph.ts";
import { plannerPaperIds } from "../../lib/workflow-planner/sources.ts";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const GRAPH = slimLayerGraph(LAYER_GRAPH, "en");
const CITED = new Set(plannerPaperIds());
const PAPERS: PlannerPaper[] = PAPER_REGISTER.papers
  .filter((paper) => CITED.has(paper.id))
  .map(({ id, title, authors, year, url }) => ({ id, title, authors, year, url }));
// The route's own response, generated from services/api (see the lib test that parses it).
// Read from the working directory: the runner bundles this file into a temp
// directory, so a path relative to the module would point inside that.
const ESTIMATE: unknown = JSON.parse(readFileSync(join(process.cwd(), "lib/workflow-planner/physical-fixture.json"), "utf8"));
const RSA = "Factor a 2048-bit RSA modulus.";

// Signed in: the planner renders for an account only (ai-ops 369), so the
// input exists once the session read lands.
async function renderPlanner(signedIn: boolean) {
  const stub = stubFetch((request: RecordedRequest) => {
    if (request.url === "/api/auth/session") return { status: 200, body: { signedIn, signInHref: "/auth/sign-in" } };
    if (request.url === "/api/estimates/logical") return { status: 200, body: ESTIMATE };
    return { status: 404 };
  });
  const view = render(<AtlasWorkflowPlanner locale="en" graph={GRAPH} papers={PAPERS} examples={{}} />);
  const input = await waitFor(() => screen.getByLabelText("Your problem"));
  fireEvent.change(input, { target: { value: RSA } });
  return { view, stub };
}

function chartTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mj-plan-chart-title")].map((node) => node.textContent ?? "");
}

test("a plan draws one chart per quantity, with the published sizes marked, and costs nothing until asked", async () => {
  const { view, stub } = await renderPlanner(true);
  try {
    await waitFor(() => assert.match(view.container.textContent ?? "", /How it grows, and what machine it needs/));
    assert.deepEqual(chartTitles(view.container), ["Logical qubits", "Toffoli gates", "Serial depth"]);
    // Gidney 2025's Table 5 sizes that fall on the curve (1024…8192), and no others.
    assert.equal(view.container.querySelectorAll(".mj-plan-chart-mark").length, 8);
    assert.match(view.container.textContent ?? "", /Published at this size/);
    const axis = screen.getByLabelText(/Vary/) as HTMLSelectElement;
    assert.equal(axis.value, "bits");
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Estimate the machine" })));
    // The machine is costed on request, not on every keystroke.
    assert.equal(stub.calls.filter((c) => c.url === "/api/estimates/logical").length, 0);
  } finally {
    stub.restore();
  }
});

test("a signed-in reader costs the whole curve in one request and sees both machines at their size", async () => {
  const { view, stub } = await renderPlanner(true);
  try {
    const button = await waitFor(() => screen.getByRole("button", { name: "Estimate the machine" }));
    fireEvent.click(button);
    await waitFor(() => assert.match(view.container.textContent ?? "", /Fastest useful machine/));

    const sent = stub.calls.filter((c) => c.url === "/api/estimates/logical");
    assert.equal(sent.length, 1);
    const body = sent[0].body as { assumptions: string; points: { parameter_value: number; non_clifford_depth: number; t_count: number }[] };
    assert.equal(body.assumptions, "gidney-2025@v2");
    assert.deepEqual(
      body.points.map((p) => p.parameter_value),
      [128, 256, 512, 1024, 2048, 4096, 8192, 16384],
    );
    assert.ok(body.points.every((p) => p.non_clifford_depth > 0 && p.t_count === 0));

    // 25,772,032 physical qubits on 17 factories at 2048 bits, from the fixture.
    assert.match(view.container.textContent ?? "", /2\.58 × 10⁷/);
    assert.match(view.container.textContent ?? "", /17 factories/);
    assert.match(view.container.textContent ?? "", /Limited by the serial depth/);
    assert.match(view.container.textContent ?? "", /measurement depth/);
    assert.ok(chartTitles(view.container).includes("Runtime"));

    // Another hardware set is another question: the old answer is withdrawn.
    fireEvent.change(screen.getByLabelText(/Hardware assumptions/), { target: { value: "composed-trapped-ion@v2" } });
    await waitFor(() => assert.doesNotMatch(view.container.textContent ?? "", /Fastest useful machine/));
  } finally {
    stub.restore();
  }
});
