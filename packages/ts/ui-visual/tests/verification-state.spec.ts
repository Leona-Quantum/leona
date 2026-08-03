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
  // Renamed from "Unavailable or errored checks" when `skipped` joined the group:
  // three different reasons a check established nothing, under one honest heading.
  await expect(page.getByText("Checks that did not establish anything")).toBeVisible();
  await expect(page.getByText("exact_diag")).toBeVisible();
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

/** The panel's own words, in the language the page is in.
 *
 * Asserting "no Latin prose survives" rather than listing the Japanese strings
 * is deliberate: a list of expected strings passes while every string NOT on
 * the list stays English, which is exactly how this panel came to be the one
 * unlocalised surface on two otherwise bilingual pages. Reason codes and check
 * method names are contract identifiers and stay Latin on purpose. */
async function untranslatedProse(page: Page): Promise<string[]> {
  return page.locator(".mj-trust-summary").evaluate((panel) => {
    const identifiers = new Set(
      [...panel.querySelectorAll("code")].map((node) => node.textContent ?? ""),
    );
    return [...panel.querySelectorAll("strong, p, dt, h3, li")]
      .map((node) => (node.textContent ?? "").trim())
      .filter((text) => text && !identifiers.has(text))
      // A run of two or more Latin words is prose; a lone token is a unit or an id.
      .filter((text) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text));
  });
}

for (const story of [
  "studio-verification-fail-ja",
  "studio-verification-pass-ja",
  "studio-verification-inconclusive-ja",
  "studio-verification-stale-ja",
]) {
  test(`${story} says nothing in English`, async ({ page }) => {
    await loadStory(page, story);
    expect(await untranslatedProse(page)).toEqual([]);
  });
}

test("a Japanese FAIL panel names the failed check and what to do next", async ({ page }) => {
  await loadStory(page, "studio-verification-fail-ja");
  await expect(page.getByText("検証失敗")).toBeVisible();
  await expect(page.getByText("不合格の確認項目")).toBeVisible();
  await expect(page.getByText("次にすべきこと")).toBeVisible();
  // The identifiers a support conversation is conducted in stay Latin.
  await expect(page.locator(".mj-trust-summary code").first()).toBeVisible();
});

test("the English panel is unchanged by the locale prop", async ({ page }) => {
  await loadStory(page, "studio-verification-fail");
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Failed checks")).toBeVisible();
  await expect(page.getByText("Recommended next action")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "The circuit executed and matched the request" })).toBeVisible();
  await page.getByText("Generated code · revision 1").click();
  await expect(page.getByText("QuantumCircuit", { exact: false })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});

test("mobile agent activity exposes stage state without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadStory(page, "agent-activity-active");
  await expect(page.getByText("Checking the result against the declared evidence", { exact: true })).toBeVisible();
  await expect(page.locator('summary[aria-current="step"]')).toContainText("Verification");
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
});
