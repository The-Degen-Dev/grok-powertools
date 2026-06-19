const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/vault");
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

test("Vault viewer opens image and video assets", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByText("asset-image-1").click();
  const imageDialog = page.getByRole("dialog", { name: /Vault media viewer/i });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog.locator("img[alt*='glass library']")).toBeVisible();
  await page.getByRole("button", { name: /Close/i }).click();
  await page.getByText("asset-video-1").click();
  const videoDialog = page.getByRole("dialog", { name: /Vault media viewer/i });
  await expect(videoDialog).toBeVisible();
  await expect(videoDialog.getByText(/video \/ verified/i)).toBeVisible();
  await expect(videoDialog.locator("video")).toHaveAttribute("src", /asset-video-1/);
});

test("Vault assets can become a collection and watch queue", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  const addButtons = page.getByRole("button", { name: /Add to Collection/i });
  await addButtons.nth(0).click();
  await expect(page.getByText(/Added to New Collection/i)).toBeVisible();
  await addButtons.nth(1).click();
  await expect(page.getByText(/Added to New Collection/i)).toBeVisible();
  const collectionState = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const collections = await new Promise((resolve, reject) => {
      const tx = db.transaction("collections", "readonly");
      const request = tx.objectStore("collections").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    const collection = collections.find((entry) => entry.name === "New Collection");
    return {
      itemIds: collection.items.map((item) => item.id),
      assetIds: collection.items.map((item) => item.assetId).sort(),
      mediaTypes: collection.items.map((item) => item.mediaType).sort(),
    };
  });
  expect(collectionState.assetIds).toEqual(["asset-image-1", "asset-video-1"]);
  expect(collectionState.mediaTypes).toEqual(["image", "video"]);
  expect(new Set(collectionState.itemIds).size).toBe(2);
  await page.getByRole("link", { name: /Collections/i }).click();
  await page.getByRole("button", { name: /Watch All/i }).click();
  await expect(page.getByText(/Watch Mode/i)).toBeVisible();
  await page.getByRole("button", { name: /Save as Movie/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  const movieState = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const movies = await new Promise((resolve, reject) => {
      const tx = db.transaction("movies", "readonly");
      const request = tx.objectStore("movies").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    const movie = movies.find((entry) => entry.name === "New Collection Compilation");
    return {
      clipTypes: movie.clips.map((clip) => clip.type).sort(),
      sourceAssetIds: movie.clips.map((clip) => clip.sourceAssetId).sort(),
      imageStillDuration: movie.clips.find((clip) => clip.type === "image")?.stillDuration,
    };
  });
  expect(movieState.clipTypes).toEqual(["image", "video"]);
  expect(movieState.sourceAssetIds).toEqual(["asset-image-1", "asset-video-1"]);
  expect(movieState.imageStillDuration).toBe(3);
});
