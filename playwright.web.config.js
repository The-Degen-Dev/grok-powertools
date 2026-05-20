// playwright.web.config.js
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e-web',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    timeout: 90000,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:3101',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'cd web && npm exec -- next dev --port 3101',
        url: 'http://127.0.0.1:3101',
        reuseExistingServer: false,
        timeout: 120000,
        env: {
            ...process.env,
            AUTH_SECRET: 'watch-mode-e2e-secret',
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
