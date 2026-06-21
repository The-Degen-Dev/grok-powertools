const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/vault");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const db = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(db?.version || 0) >= 5;
  });
  await page.evaluate(async () => {
    const storeNames = [
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
      "vault_repair_scans",
      "vault_repair_issues",
      "vault_repair_plans",
      "vault_repair_runs",
      "vault_repair_events",
    ];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const existingStores = storeNames.filter((name) => db.objectStoreNames.contains(name));
    if (existingStores.length === 0) {
      db.close();
      return;
    }
    const tx = db.transaction(existingStores, "readwrite");
    await Promise.all(existingStores.map((name) => tx.objectStore(name).clear()));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
}

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

test("Repair Workbench scans and displays classified repair issues", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  const workbench = page.locator("section").filter({ has: page.getByRole("heading", { name: "Repair Workbench" }) });
  await expect(workbench.getByRole("heading", { name: "Repair Workbench" })).toBeVisible();
  await workbench.getByRole("button", { name: "Scan for Repair Issues" }).click();
  await expect(workbench.getByText("5 issues")).toBeVisible();
  await expect(workbench.getByText("1 writable")).toBeVisible();
  await expect(workbench.getByText("1 blocked")).toBeVisible();
  const indexDriftRow = workbench.getByRole("row").filter({ hasText: "repair-gap-index-drift-asset-image-1" });
  await expect(indexDriftRow.getByText("T1")).toBeVisible();
  await expect(indexDriftRow.getByText("d1_index")).toBeVisible();
  await expect(workbench.getByLabel("Select repair-gap-index-drift-asset-image-1")).toBeEnabled();
  const liveGrokRow = workbench.getByRole("row").filter({ hasText: "repair-gap-live-grok-asset-missing" });
  await expect(liveGrokRow.getByText("LIVE_GROK_RUNBOOK_ONLY")).toBeVisible();
  await expect(workbench.getByLabel("Select repair-gap-live-grok-asset-missing")).toBeDisabled();
  await expect(workbench.getByLabel("Select repair-scan-warning-1")).toBeDisabled();

  const localIssues = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const issues = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_issues", "readonly");
      const request = tx.objectStore("vault_repair_issues").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return issues.map((issue) => issue.issueId).sort();
  });
  expect(localIssues).toEqual([
    "repair-gap-index-drift-asset-image-1",
    "repair-gap-live-grok-asset-missing",
    "repair-scan-warning-1",
    "repair-scan-warning-2",
    "repair-scan-warning-3",
  ]);
});

test("Repair Workbench creates an approved plan and records blocked run history", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  const workbench = page.locator("section").filter({ has: page.getByRole("heading", { name: "Repair Workbench" }) });
  await workbench.getByRole("button", { name: "Scan for Repair Issues" }).click();
  await workbench.getByLabel("Select repair-gap-index-drift-asset-image-1").check();
  await workbench.getByRole("button", { name: "Create Repair Plan" }).click();
  await expect(workbench.getByText(/Plan hash/)).toBeVisible();
  await expect(workbench.getByText(/1 target/)).toBeVisible();
  await workbench.getByRole("button", { name: "Approve Exact Plan" }).click();
  await expect(workbench.getByText("Approved")).toBeVisible();
  await workbench.getByRole("button", { name: "Run Approved Repair" }).click();
  await expect(workbench.getByText("REPAIR_WRITE_NOT_ARMED")).toBeVisible();
  await expect(workbench.getByRole("button", { name: "Run Approved Repair" })).toBeDisabled();

  const history = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const runs = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_runs", "readonly");
      const request = tx.objectStore("vault_repair_runs").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const events = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_events", "readonly");
      const request = tx.objectStore("vault_repair_events").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return { runs, events };
  });
  expect(history.runs).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "blocked", error: "REPAIR_WRITE_NOT_ARMED" })]),
  );
  expect(history.events.map((event) => event.eventType)).toEqual(
    expect.arrayContaining(["plan", "approval", "run_blocked"]),
  );
  expect(history.runs.filter((run) => run.status === "blocked")).toHaveLength(1);
  expect(history.runs.find((run) => run.status === "blocked")?.runId).toMatch(/-blocked$/);
});

test("Repair Workbench clears approval state when selection changes after planning", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  const workbench = page.locator("section").filter({ has: page.getByRole("heading", { name: "Repair Workbench" }) });
  await workbench.getByRole("button", { name: "Scan for Repair Issues" }).click();
  await workbench.getByLabel("Select repair-gap-index-drift-asset-image-1").check();
  await workbench.getByRole("button", { name: "Create Repair Plan" }).click();
  await expect(workbench.getByText(/Plan hash/)).toBeVisible();
  await workbench.getByLabel("Select repair-gap-index-drift-asset-image-1").uncheck();
  await expect(workbench.getByText(/Plan hash/)).toHaveCount(0);
  await expect(workbench.getByRole("button", { name: "Create Repair Plan" })).toBeDisabled();
});
