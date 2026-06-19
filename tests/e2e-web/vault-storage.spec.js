const { test, expect } = require("@playwright/test");

async function deleteAppDb(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("grok-power-tools");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

async function objectStoreNames(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const names = Array.from(db.objectStoreNames);
        db.close();
        resolve(names);
      };
    });
  });
}

test("local database migration preserves app stores and adds Vault stores", async ({ page }) => {
  await page.goto("/");
  await deleteAppDb(page);
  await page.reload();
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const db = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(db?.version || 0) >= 4;
  });

  const stores = await objectStoreNames(page);
  expect(stores).toEqual(
    expect.arrayContaining([
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
    ]),
  );
});
