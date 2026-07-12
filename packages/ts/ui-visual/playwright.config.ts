import { defineConfig, devices } from "@playwright/test";

// Headless chromium only — the stories are static HTML rendered from source (no server,
// no auth). Slice 2a asserts a11y (axe); the later visual-diff slice adds screenshots
// with baselines generated on the CI Linux runner.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
