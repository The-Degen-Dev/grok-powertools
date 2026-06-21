const { test, expect } = require("@playwright/test");

const versionFourSchema = [
  { name: "collections", keyPath: "id", indexes: [["by-status", "status"], ["by-updated", "updatedAt"]] },
  { name: "settings" },
  { name: "movies", keyPath: "id", indexes: [["by-updated", "updatedAt"]] },
  { name: "prompts", keyPath: "id", indexes: [["by-created", "createdAt"]] },
  { name: "sync_meta" },
  {
    name: "vault_assets",
    keyPath: "assetId",
    indexes: [["by-media-type", "mediaType"], ["by-status", "verificationStatus"], ["by-updated", "updatedAt"]],
  },
  { name: "vault_overlays", keyPath: "assetId" },
  { name: "vault_import_runs", keyPath: "id", indexes: [["by-imported", "importedAt"]] },
  { name: "vault_gaps", keyPath: "id", indexes: [["by-asset", "assetId"]] },
  { name: "vault_prompts", keyPath: "id" },
  { name: "vault_media_tokens", keyPath: "assetId" },
];

async function seedVersionFourDb(page) {
  await page.route("**/__idb-seed", (route) => {
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>IDB seed</title>" });
  });
  await page.goto("/__idb-seed");
  await page.evaluate(async (schema) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("grok-power-tools");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => reject(new Error("grok-power-tools database deletion was blocked"));
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools", 4);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeDefinition of schema) {
          if (!db.objectStoreNames.contains(storeDefinition.name)) {
            const store = storeDefinition.keyPath
              ? db.createObjectStore(storeDefinition.name, { keyPath: storeDefinition.keyPath })
              : db.createObjectStore(storeDefinition.name);
            for (const [indexName, keyPath] of storeDefinition.indexes || []) {
              store.createIndex(indexName, keyPath);
            }
          }
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
  }, versionFourSchema);
}

test("Vault repair stores exist after IndexedDB upgrade", async ({ page }) => {
  await seedVersionFourDb(page);
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Vault" })).toBeVisible();
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const database = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(database?.version || 0) >= 5;
  });

  const database = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const stores = {};
        for (const storeName of Array.from(db.objectStoreNames)) {
          const tx = db.transaction(storeName, "readonly");
          stores[storeName] = Array.from(tx.objectStore(storeName).indexNames).sort();
        }
        const result = {
          version: db.version,
          stores,
        };
        db.close();
        resolve(result);
      };
    });
  });

  expect(database.version).toBe(5);
  expect(database.stores).toMatchObject({
    vault_repair_scans: ["by-scanned"],
    vault_repair_issues: ["by-tier", "by-write-class"],
    vault_repair_plans: ["by-created", "by-hash"],
    vault_repair_runs: ["by-plan", "by-status"],
    vault_repair_events: ["by-created", "by-run"],
  });
});
