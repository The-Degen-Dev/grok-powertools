const { test, expect } = require("@playwright/test");

async function clearAppStores(page) {
  await page.goto("/vault");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    return databases.some((entry) => entry.name === "grok-power-tools");
  });
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const stores = [
      "collections",
      "movies",
      "prompts",
      "settings",
      "sync_meta",
      "vault_assets",
      "vault_overlays",
      "vault_import_runs",
      "vault_gaps",
      "vault_prompts",
      "vault_media_tokens",
      "movie_review_projects",
      "movie_versions",
      "movie_director_proposals",
      "movie_export_runs",
      "movie_review_notes",
    ].filter((name) => db.objectStoreNames.contains(name));
    if (stores.length === 0) {
      db.close();
      return;
    }
    const tx = db.transaction(stores, "readwrite");
    stores.forEach((name) => tx.objectStore(name).clear());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
}

async function commitVaultPreview(page) {
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(page.getByText("asset-video-1", { exact: true })).toBeVisible();
}

test("Phase 0 preserves Vault-to-Movie draft creation", async ({ page }) => {
  await clearAppStores(page);
  await commitVaultPreview(page);
  await page.goto("/movie");
  await page.getByRole("button", { name: /Build from Vault/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await expect(page.getByText("2 candidates")).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-1", exact: true })).toBeVisible();
});

test("Phase 0 keeps current Movie list usable", async ({ page }) => {
  await clearAppStores(page);
  await page.goto("/movie");
  await page.getByRole("button", { name: /New Movie/i }).first().click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await page.goto("/movie");
  await expect(page.getByText(/Untitled Movie/i)).toBeVisible();
});
