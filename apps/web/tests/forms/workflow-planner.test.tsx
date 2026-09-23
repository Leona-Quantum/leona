import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AtlasWorkflowPlanner, type PlannerExample, type PlannerPaper } from "../../components/atlas-workflow-planner.tsx";
import { LAYER_GRAPH } from "../../lib/repository/layer-graph.ts";
import { PAPER_REGISTER } from "../../lib/repository/paper-register.ts";
import { slimLayerGraph } from "../../lib/workflow-planner/graph.ts";
import { plannerPaperIds } from "../../lib/workflow-planner/sources.ts";
import { stubFetch } from "./dom-env.ts";

const GRAPH = slimLayerGraph(LAYER_GRAPH, "en");
const CITED = new Set(plannerPaperIds());
const PAPERS: PlannerPaper[] = PAPER_REGISTER.papers
  .filter((paper) => CITED.has(paper.id))
  .map(({ id, title, authors, year, url }) => ({ id, title, authors, year, url }));
const EXAMPLES: Record<string, PlannerExample> = {
  "grover-3q-101": { id: "grover-3q-101", title: "Grover's algorithm finds |101⟩", instance: "3 qubits", blocks: ["Hadamard layer", "Phase oracle", "Grover diffuser"] },
};

function renderPlanner() {
  const session = stubFetch(() => ({ status: 200, body: { signedIn: false, signInHref: "/auth/sign-in" } }));
  const view = render(<AtlasWorkflowPlanner locale="en" graph={GRAPH} papers={PAPERS} examples={EXAMPLES} />);
  return { view, restore: session.restore };
}

function row(container: HTMLElement, label: RegExp): HTMLTableRowElement {
  const found = [...container.querySelectorAll("tbody tr")].find((tr) => label.test(tr.querySelector("th")?.textContent ?? ""));
  assert.ok(found, `no row matching ${label}`);
  return found as HTMLTableRowElement;
}

test("a sentence becomes a costed workflow: the reading, the numbers and their words, the blocks, and the sourced cost", async () => {
  const { view, restore } = renderPlanner();
  try {
    fireEvent.change(screen.getByLabelText("Your problem"), {
      target: { value: "Search a database of 2^20 records for the single record that matches." },
    });
    await waitFor(() => assert.match(view.container.textContent ?? "", /Reading this as/));
    assert.match(view.container.textContent ?? "", /From your text: “2\^20 records”/);
    // Boyer, Brassard, Høyer and Tapp's own worked number for N = 2^20, t = 1.
    const iterations = row(view.container, /Grover iterations/);
    assert.match(iterations.textContent ?? "", /804/);
    assert.match(iterations.textContent ?? "", /Exact/);
    assert.match(iterations.textContent ?? "", /Boyer et al\. 1996, Eq\. \(3\)/);
    assert.match(view.container.textContent ?? "", /quadratic speedup may not pay/i);
    assert.match(view.container.textContent ?? "", /Hadamard layer → Phase oracle → Grover diffuser/);
  } finally {
    restore();
  }
});

test("a number the reader types outranks the sentence, and a missing one blanks only the lines that need it", async () => {
  const { view, restore } = renderPlanner();
  try {
    fireEvent.change(screen.getByLabelText("Your problem"), { target: { value: "Solve a linear system of equations." } });
    await waitFor(() => assert.ok(view.container.querySelector("table")));
    assert.match(row(view.container, /Adiabatic walk steps/).textContent ?? "", /needs Condition number/);
    fireEvent.change(screen.getByLabelText(/Condition number/), { target: { value: "1000" } });
    await waitFor(() => assert.match(row(view.container, /Adiabatic walk steps/).textContent ?? "", /834,000/));
    assert.match(view.container.textContent ?? "", /You set this\./);
  } finally {
    restore();
  }
});

test("swapping the block a cost model is for withdraws its numbers and says why", async () => {
  const { view, restore } = renderPlanner();
  try {
    fireEvent.change(screen.getByLabelText("Your problem"), {
      target: { value: "Ground-state energy of a molecule with 100 spin-orbitals and λ = 500 hartree, to chemical accuracy." },
    });
    await waitFor(() => assert.ok(row(view.container, /select circuit/)));
    const simulationSwap = [...view.container.querySelectorAll<HTMLSelectElement>(".mj-plan-swap select")].find(
      (select) => select.value === "qubitization-simulation",
    );
    assert.ok(simulationSwap, "the qubitization block is on screen and swappable");
    fireEvent.change(simulationSwap, { target: { value: "product-formula-simulation" } });
    await waitFor(() => assert.match(view.container.textContent ?? "", /Put the simulation block back on qubitization/));
    assert.equal(
      [...view.container.querySelectorAll("tbody th")].some((th) => /select circuit/.test(th.textContent ?? "")),
      false,
      "no number is left describing a construction that is no longer on screen",
    );
  } finally {
    restore();
  }
});

test("a sentence with nothing recognisable asks the reader to pick, instead of guessing", async () => {
  const { view, restore } = renderPlanner();
  try {
    fireEvent.change(screen.getByLabelText("Your problem"), { target: { value: "Make my code faster." } });
    await waitFor(() => assert.match(view.container.textContent ?? "", /found no problem it knows/));
    assert.equal(view.container.querySelector("table"), null);
  } finally {
    restore();
  }
});

test("a #q= link followed while the page is open replaces the sentence, and near-certain success is not printed as 100%", async () => {
  const { view, restore } = renderPlanner();
  try {
    window.location.hash = `q=${encodeURIComponent("Search a database of 2^20 records for the single record that matches.")}`;
    window.dispatchEvent(new Event("hashchange"));
    await waitFor(() => assert.match(row(view.container, /Grover iterations/).textContent ?? "", /804/));
    assert.match(row(view.container, /Chance the measured item/).textContent ?? "", /> 99\.99%/);
  } finally {
    window.location.hash = "";
    restore();
  }
});
