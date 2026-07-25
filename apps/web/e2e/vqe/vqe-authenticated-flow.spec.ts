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

test("authenticated local candidate happy path preserves the private claim boundary", async ({
  page,
  request,
}) => {
  await createExperiment(page);
  await page.getByRole("button", { name: "Run local candidate" }).click();

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
  await page.getByRole("button", { name: "Run local candidate" }).click();

  await expect(page.getByText("pennylane · failed")).toBeVisible();
  await expect(page.getByText("runtime_failure · attempt 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save private candidate" })).toBeDisabled();
  await expect(page.getByText("Energy (Ha)")).toHaveCount(0);
});
