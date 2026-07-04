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

async function commitVault(page) {
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(page.locator('article[data-asset-id="asset-video-1"]')).toBeVisible();
}

async function readMovies(page) {
  return page.evaluate(async () => {
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
    return movies;
  });
}

test("Vault Build Movies creates local selected video drafts with cut transitions", async ({ page }) => {
  await resetDb(page);
  await commitVault(page);
  await expect(page.getByRole("button", { name: /Build Movies/i })).toBeVisible();
  await page.getByLabel(/Select asset-video-1/i).check();
  await page.getByLabel(/Select asset-video-2/i).check();
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await expect(page.getByRole("heading", { name: /What will happen/i })).toBeVisible();
  await expect(page.getByText("2 eligible videos", { exact: true })).toBeVisible();
  await expect(page.getByText("1 local movie draft", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cut transition/i)).toBeVisible();
  await page.getByLabel(/Recipe/i).selectOption("selected");
  await page.getByLabel(/Max clips per movie/i).fill("10");
  await page.getByLabel(/Max movies/i).fill("2");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 1 movie draft/i)).toBeVisible();

  const movies = await readMovies(page);
  const draft = movies.find((movie) => movie.name.includes("Selected Video Draft"));
  expect(draft.clips.map((clip) => clip.sourceAssetId).sort()).toEqual(["asset-video-1", "asset-video-2"]);
  expect(draft.clips.every((clip) => clip.transition.type === "cut")).toBe(true);
  expect(draft.clips.every((clip) => clip.videoUrl.includes("/api/vault/media/"))).toBe(true);
});

test("Vault Build Movies uses current filtered visible set when nothing is selected", async ({ page }) => {
  await resetDb(page);
  await commitVault(page);
  await page.getByLabel(/Search Vault assets/i).fill("asset-video");
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByLabel(/Max clips per movie/i).fill("1");
  await page.getByLabel(/Max movies/i).fill("4");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 2 movie drafts/i)).toBeVisible();

  const movies = await readMovies(page);
  expect(movies.filter((movie) => movie.name.includes("Recent Video Draft"))).toHaveLength(2);
});

test("Vault Build Movies can create favorite drafts", async ({ page }) => {
  await resetDb(page);
  await commitVault(page);
  const card = page.locator('article[data-asset-id="asset-video-2"]');
  await card.hover();
  await card.getByRole("button", { name: /Favorite asset-video-2/i }).click();
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Source scope/i).selectOption("favorites");
  await page.getByLabel(/Recipe/i).selectOption("favorites");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 1 movie draft/i)).toBeVisible();

  const movies = await readMovies(page);
  const draft = movies.find((movie) => movie.name.includes("Favorite Video Draft"));
  expect(draft.clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
});

test("Vault Build Movies explains empty eligible scopes with recovery", async ({ page }) => {
  await resetDb(page);
  await commitVault(page);
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Source scope/i).selectOption("favorites");
  await expect(page.getByText(/No eligible videos for this setup/i)).toBeVisible();
  await expect(page.getByText(/not favorite/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create movie drafts/i })).toBeDisabled();
  await page.getByRole("button", { name: /Use visible verified videos/i }).click();
  await expect(page.getByText("2 eligible videos", { exact: true })).toBeVisible();
});

test("Movie Maker exposes Build from Vault after Vault assets are committed", async ({ page }) => {
  await resetDb(page);
  await commitVault(page);
  await page.goto("/movie");
  await expect(page.getByRole("heading", { name: /Movie Maker/i })).toBeVisible();
  await expect(page.getByText(/0 movies/i)).toBeVisible();
  await expect(page.getByText(/4 Vault assets/i)).toBeVisible();
  await page.getByRole("button", { name: /Build from Vault/i }).click();
  await expect(page.getByRole("heading", { name: /What will happen/i })).toBeVisible();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
});
