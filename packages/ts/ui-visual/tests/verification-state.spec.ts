import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

async function loadStory(page: Page, name: string) {
  const html = readFileSync(join(distDir, `${name}.html`), "utf8");
  await page.setContent(html, { waitUntil: "load" });
}

test("INCONCLUSIVE warning is persistent and exposes all audit fields", async ({ page }) => {
  await loadStory(page, "studio-verification-inconclusive");
  await expect(page.getByText("Verification unavailable — correctness has not been confirmed.")).toBeVisible();
  await expect(page.getByText("required_check_unavailable")).toBeVisible();
  await expect(page.getByText("Unavailable or errored checks")).toBeVisible();
  await expect(page.getByText("Unverified claims")).toBeVisible();
  await expect(page.getByText("Recommended next action")).toBeVisible();
});

test("edited PASS evidence is replaced by stale state", async ({ page }) => {
  await loadStory(page, "studio-verification-stale");
  await expect(page.getByText("Verification stale")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
});

test("legacy evidence never displays Verified", async ({ page }) => {
  await loadStory(page, "studio-verification-legacy");
  await expect(page.getByText("Legacy evidence unknown")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
});

test("mobile INCONCLUSIVE warning remains visible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadStory(page, "studio-verification-inconclusive");
  await expect(page.getByText("Verification unavailable — correctness has not been confirmed.")).toBeVisible();
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("mobile run outcome keeps facts and code inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadStory(page, "run-outcome-reviewed");
  await expect(page.getByText("The circuit executed and matched the request")).toBeVisible();
  await page.getByText("Generated code · revision 1").click();
  await expect(page.getByText("QuantumCircuit", { exact: false })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("mobile run progress exposes stage state without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadStory(page, "run-progress-active");
  await expect(page.getByText("3 of 5")).toBeVisible();
  await expect(page.getByText("60%")).toBeVisible();
  await expect(page.getByText("Running")).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});
