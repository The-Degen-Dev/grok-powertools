const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const db = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(db?.version || 0) >= 4;
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
    ];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const existingStores = storeNames.filter((name) => db.objectStoreNames.contains(name));
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

async function putRecord(page, storeName, value, key) {
  await page.evaluate(
    async ({ storeName: targetStore, value: record, key: recordKey }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("grok-power-tools");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(targetStore, "readwrite");
      if (recordKey === undefined) {
        tx.objectStore(targetStore).put(record);
      } else {
        tx.objectStore(targetStore).put(record, recordKey);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { storeName, value, key },
  );
}

async function getVaultOverlay(page, assetId) {
  return page.evaluate(async (targetAssetId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("vault_overlays", "readonly");
    const overlay = await new Promise((resolve, reject) => {
      const request = tx.objectStore("vault_overlays").get(targetAssetId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return overlay;
  }, assetId);
}

test("initial sign-in push includes changed Vault overlays", async ({ page }) => {
  let signedIn = false;
  const pushBodies = [];

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn ? { user: { name: "Test User", email: "test@example.com" } } : {}),
    });
  });
  await page.route("**/api/sync/push", async (route) => {
    pushBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, syncedAt: "2026-06-18T13:00:00.000Z" }),
    });
  });

  await resetDb(page);
  await putRecord(page, "vault_overlays", {
    assetId: "asset-image-1",
    tags: ["local"],
    hidden: false,
    favorite: true,
    updatedAt: "2026-06-18T12:00:00.000Z",
  });

  signedIn = true;
  await page.reload();

  await expect.poll(() => pushBodies.some((body) => (
    body?.vaultOverlays?.some((overlay) => overlay.assetId === "asset-image-1")
  )), { timeout: 15000 }).toBe(true);

  const overlayBody = pushBodies
    .flatMap((body) => body.vaultOverlays || [])
    .find((overlay) => overlay.assetId === "asset-image-1");
  expect(JSON.parse(overlayBody.data)).toMatchObject({
    assetId: "asset-image-1",
    tags: ["local"],
    favorite: true,
  });
});

test("sync pull keeps newer local Vault overlay edits", async ({ page }) => {
  let signedIn = false;
  let pullCount = 0;

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn ? { user: { name: "Test User", email: "test@example.com" } } : {}),
    });
  });
  await page.route("**/api/sync/pull**", async (route) => {
    pullCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        collections: [],
        movies: [],
        vaultOverlays: [
          {
            assetId: "asset-image-1",
            data: JSON.stringify({
              assetId: "asset-image-1",
              tags: ["remote-old"],
              hidden: true,
              favorite: false,
              updatedAt: "2026-06-18T12:00:00.000Z",
            }),
            updatedAt: "2026-06-18T12:00:00.000Z",
            deletedAt: null,
          },
        ],
        syncedAt: "2026-06-18T14:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/sync/push", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, syncedAt: "2026-06-18T14:00:00.000Z" }),
    });
  });

  await resetDb(page);
  await putRecord(page, "vault_overlays", {
    assetId: "asset-image-1",
    tags: ["local-newer"],
    hidden: false,
    favorite: true,
    updatedAt: "2026-06-18T13:00:00.000Z",
  });
  await putRecord(page, "sync_meta", {
    lastSyncAt: "2026-06-18T14:00:00.000Z",
    lastPushAt: "2026-06-18T14:00:00.000Z",
    deviceId: "test-device",
  }, "sync-state");

  signedIn = true;
  await page.reload();

  await expect.poll(() => pullCount, { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(async () => getVaultOverlay(page, "asset-image-1"), { timeout: 15000 }).toMatchObject({
    tags: ["local-newer"],
    hidden: false,
    favorite: true,
    updatedAt: "2026-06-18T13:00:00.000Z",
  });
});
