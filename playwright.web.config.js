// playwright.web.config.js
// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const workerPort = 43117;
const webPort = 3001;

module.exports = defineConfig({
  testDir: "./tests/e2e-web",
  fullyParallel: false,
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `FAKE_VAULT_WORKER_PORT=${workerPort} FAKE_VAULT_WORKER_API_KEY=client-sample node tests/e2e-web/fixtures/fake-vault-worker.mjs`,
      url: `http://127.0.0.1:${workerPort}/health`,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: `WORKER_URL=http://127.0.0.1:${workerPort} CLIENT_API_KEY=client-sample AUTH_SECRET=local-test-secret npm --prefix web run dev`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
