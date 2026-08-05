import { expect, test } from "@playwright/test";

async function createExperiment(page: import("@playwright/test").Page) {
  await page.goto("/studio?vqe=1");
  await expect(
    page.getByRole("heading", { name: "Create a reproducible VQE experiment" }),
  ).toBeVisible();
  await expect(page.getByLabel("Workflow")).toContainText("h2_sto3g_actual_vqe_v1");
  await page.getByRole("button", { name: "Create experiment" }).click();
  await page.waitForURL(/\/studio\?vqeExperiment=/);
  await expect(page.getByRole("heading", { name: "H₂ STO-3G actual-VQE proof" })).toBeVisible();
}

test("authenticated private candidate happy path preserves the private claim boundary", async ({
  page,
  request,
}) => {
  await createExperiment(page);
  await page.getByRole("button", { name: "Run private candidate" }).click();

  await expect(page.getByText("qiskit · succeeded")).toBeVisible();
  await expect(page.getByText("48", { exact: true })).toBeVisible();
  await expect(page.getByText("83", { exact: true })).toBeVisible();
  await expect(page.getByText("Research candidate — not a public result")).toBeVisible();

  await page.getByRole("button", { name: "Save private candidate" }).click();
  await expect(page.getByText(/Private candidate saved:/)).toBeVisible();

  const state = await (await request.get("http://127.0.0.1:18000/__state")).json();
  expect(state.authenticatedRequests).toBeGreaterThanOrEqual(5);
  expect(state.unauthorizedRequests).toBe(0);
});

test("runtime failure stays failed and cannot be materialized", async ({ page }) => {
  await createExperiment(page);
  await page.getByLabel("Candidate framework").selectOption("pennylane");
  await page.getByRole("button", { name: "Run private candidate" }).click();

  await expect(page.getByText("pennylane · failed")).toBeVisible();
  await expect(page.getByText("runtime_failure · attempt 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save private candidate" })).toBeDisabled();
  await expect(page.getByText("Energy (Ha)")).toHaveCount(0);
});

test("fixed-excitation SLSQP to COBYLA is saved, compared, and reopened", async ({
  page,
}) => {
  await page.goto(
    "/studio?vqe=1"
      + "&vqeWorkflowKey=vqe.workflow.h2_sto3g_actual_vqe_v1"
      + "&vqeProvider=qiskit"
      + "&vqeSwap=optimizer.slsqp.v1",
  );
  await page.getByRole("button", { name: "Save private SLSQP swap" }).click();
  await expect(
    page.getByText(/private controlled-swap workflow was saved/i),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reopen saved workflow" }).click();
  await page.getByRole("button", { name: "Create experiment" }).click();
  await page.waitForURL(/vqeExperiment=/);
  await page.getByRole("button", { name: "Run private candidate" }).click();
  await expect(page.getByText("qiskit · succeeded")).toBeVisible();

  await page.getByRole("link", { name: "Swap one component to COBYLA" }).click();
  await page.getByRole("button", { name: "Save private COBYLA swap" }).click();
  await expect(
    page.getByText(/private controlled-swap workflow was saved/i),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reopen saved workflow" }).click();
  await Promise.all([
    page.waitForURL((url) =>
      url.pathname === "/studio"
      && url.searchParams.has("vqeExperiment")
      && url.searchParams.has("vqeBaselineExperiment")),
    page.getByRole("button", { name: "Create experiment" }).click(),
  ]);
  await page.getByRole("button", { name: "Run private candidate" }).click();
  await expect(page.getByText("qiskit · succeeded")).toBeVisible();
  await page.getByRole("link", {
    name: "Verify and save controlled comparison",
  }).click();

  await page.getByRole("button", {
    name: "Verify and save private comparison",
  }).click();
  await expect(page.getByText("comparable", { exact: true })).toBeVisible();
  const observations = page.getByRole("region", {
    name: "SLSQP and COBYLA observations",
  });
  await expect(observations).toBeVisible();
  await expect(observations.getByRole("columnheader", { name: "SLSQP" })).toBeVisible();
  await expect(observations.getByRole("columnheader", { name: "COBYLA" })).toBeVisible();
  await expect(observations.getByRole("row", { name: /Energy \(Ha\)/ }))
    .toContainText("-1.137306035753");
  await expect(observations.getByRole("row", { name: /energy evaluations/ }))
    .toContainText("13");
  await expect(observations.getByRole("row", { name: /energy evaluations/ }))
    .toContainText("11");
  await expect(page.getByText(/saved and reopened from server-recomputed evidence/i))
    .toBeVisible();
  await expect(page).toHaveURL(/vqeComparison=70000000-0000-4000-8000-/);

  await page.reload();
  await expect(page.getByText("comparable", { exact: true })).toBeVisible();
  await expect(page.getByText("private", { exact: true })).toBeVisible();
  await expect(page.getByText("blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", {
    name: "SLSQP and COBYLA observations",
  })).toBeVisible();
});

test("private UCCSD migration is chained through its SLSQP prerequisite", async ({
  page,
}) => {
  await page.goto(
    "/studio?vqe=1"
      + "&vqeWorkflowKey=vqe.workflow.h2_sto3g_actual_vqe_v1"
      + "&vqeProvider=qiskit"
      + "&vqeMigration=h2_fixed_excitation_slsqp_to_uccsd_slsqp",
  );
  await page.getByRole("button", { name: "Save private UCCSD migration" }).click();
  await expect(
    page.getByText(/The private UCCSD capability migration was saved/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reopen saved workflow" }).click();
  await page.getByRole("button", { name: "Create experiment" }).click();
  await page.waitForURL(/\/studio\?vqeExperiment=/);
  await expect(
    page.getByRole("heading", {
      name: "H₂ STO-3G UCCSD private qualification",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run private candidate" }).click();
  await expect(page.getByText("qiskit · succeeded")).toBeVisible();
  await expect(page.getByText("56", { exact: true })).toBeVisible();
  await expect(page.getByText("96", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/public execution, public results, and performance claims remain blocked/i),
  ).toBeVisible();
});

test("private hardware-efficient migration runs on its qualified profile", async ({
  page,
}) => {
  await page.goto(
    "/studio?vqe=1"
      + "&vqeWorkflowKey=vqe.workflow.h2_sto3g_actual_vqe_v1"
      + "&vqeProvider=qiskit"
      + "&vqeMigration=h2_uccsd_slsqp_to_hardware_efficient_slsqp",
  );
  await page.getByRole("button", {
    name: "Save private hardware-efficient migration",
  }).click();
  await expect(
    page.getByText(/The private hardware-efficient capability migration was saved/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reopen saved workflow" }).click();
  await expect(page.getByLabel("Workflow")).toContainText(
    "workflow.instance.mock.hardware-efficient",
  );
  await expect(page.getByText("private_qualification_candidate")).toBeVisible();
  await page.getByRole("button", { name: "Create experiment" }).click();
  await page.waitForURL(/\/studio\?vqeExperiment=/);
  await expect(
    page.getByRole("heading", {
      name: "H₂ STO-3G hardware-efficient private qualification",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run private candidate" }).click();
  await expect(page.getByText("qiskit · succeeded")).toBeVisible();
  await expect(page.getByText("6", { exact: true })).toBeVisible();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/public execution, public results, and performance claims remain blocked/i),
  ).toBeVisible();
});
