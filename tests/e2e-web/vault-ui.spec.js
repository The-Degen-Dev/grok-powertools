const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("grok-power-tools");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
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

test("preview commit stores Vault assets and survives reload", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await expect(page.getByText(/2 assets/i)).toBeVisible();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(page.getByText(/asset-video-1/i)).toBeVisible();
  await expect(page.getByText(/asset-image-1/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/asset-video-1/i)).toBeVisible();
  await expect(page.getByText(/asset-image-1/i)).toBeVisible();
});
