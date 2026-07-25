import { defineConfig, devices } from "@playwright/test";

const webPort = 13_000;
const apiPort = 18_000;

export default defineConfig({
  testDir: "./e2e/vqe",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/vqe/mock-control-plane.mjs",
      url: `http://127.0.0.1:${apiPort}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_VQE_API_PORT: String(apiPort) },
    },
    {
      command: `pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}/studio?vqe=1`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CI: "",
        MAJORANA_LOCAL_DEV_AUTH: "true",
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
