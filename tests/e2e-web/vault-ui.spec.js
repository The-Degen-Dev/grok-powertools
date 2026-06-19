const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("grok-power-tools");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

test("empty local app points to Vault load instead of demo-first flow", async ({ page }) => {
  await resetDb(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Vault/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview Vault/i })).toBeVisible();
  await expect(page.getByText(/fake-grok-r2-backup/i)).toBeVisible();
});

test("Vault route renders preview controls", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: /Vault/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview Vault/i })).toBeVisible();
});
