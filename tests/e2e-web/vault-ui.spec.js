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

function assetText(page, assetId) {
  return page.getByText(assetId, { exact: true });
}

async function waitForNewCollectionItems(page, expectedCount) {
  await page.waitForFunction(
    async (count) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("grok-power-tools");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      if (!db.objectStoreNames.contains("collections")) {
        db.close();
        return false;
      }
      const collections = await new Promise((resolve, reject) => {
        const tx = db.transaction("collections", "readonly");
        const request = tx.objectStore("collections").getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return collections.find((entry) => entry.name === "New Collection")?.items.length === count;
    },
    expectedCount,
  );
}

async function readNewCollectionState(page) {
  return await page.evaluate(async () => {
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
    if (!collection) return null;
    return {
      itemIds: collection.items.map((item) => item.id),
      assetIds: collection.items.map((item) => item.assetId).sort(),
      mediaTypes: collection.items.map((item) => item.mediaType).sort(),
    };
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
  await expect(page.getByText(/3 assets/i)).toBeVisible();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(assetText(page, "asset-video-1")).toBeVisible();
  await expect(assetText(page, "asset-image-1")).toBeVisible();
  await expect(assetText(page, "zz-page-2-image")).toBeVisible();
  await page.reload();
  await expect(assetText(page, "asset-video-1")).toBeVisible();
  await expect(assetText(page, "asset-image-1")).toBeVisible();
  await expect(assetText(page, "zz-page-2-image")).toBeVisible();
});

test("Vault viewer opens image and video assets", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await assetText(page, "asset-image-1").click();
  const imageDialog = page.getByRole("dialog", { name: /Vault media viewer/i });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog.locator("img[alt*='glass library']")).toBeVisible();
  await page.getByRole("button", { name: /Close/i }).click();
  await assetText(page, "asset-video-1").click();
  const videoDialog = page.getByRole("dialog", { name: /Vault media viewer/i });
  await expect(videoDialog).toBeVisible();
  await expect(videoDialog.getByText(/video \/ verified/i)).toBeVisible();
  await expect(videoDialog.locator("video")).toHaveAttribute("src", /asset-video-1/);
});

test("Vault page exposes dense controls and local overlay edits", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();

  await expect(page.getByLabel(/Search Vault assets/i)).toBeVisible();
  await page.getByLabel(/Search Vault assets/i).fill("glass library");
  await expect(assetText(page, "asset-image-1")).toBeVisible();
  await expect(assetText(page, "asset-video-1")).toHaveCount(0);
  await page.getByLabel(/Search Vault assets/i).fill("asset-video-1.mp4");
  await expect(assetText(page, "asset-video-1")).toBeVisible();
  await expect(assetText(page, "asset-image-1")).toHaveCount(0);
  await page.getByLabel(/Search Vault assets/i).fill("");

  await page.getByRole("button", { name: /Table view/i }).click();
  await expect(page.getByRole("columnheader", { name: /Object key/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open source for asset-video-1/i })).toHaveAttribute(
    "href",
    "https://grok.com/imagine/post/post-video-1",
  );
  await page.getByRole("button", { name: /Grid view/i }).click();

  await page.getByRole("button", { name: /Copy prompt for asset-image-1/i }).click();
  await expect(page.getByText(/Prompt copied/i)).toBeVisible();
  await page.getByRole("button", { name: /Add asset-video-1 to movie/i }).click();
  await page.getByRole("button", { name: /Favorite asset-image-1/i }).click();
  await page.getByLabel(/Tags for asset-image-1/i).fill("keeper, glass");
  await page.getByLabel(/Notes for asset-image-1/i).fill("Use this for the first scene.");
  await page.getByRole("button", { name: /Hide asset-image-1/i }).click();
  await expect(assetText(page, "asset-image-1")).toHaveCount(0);
  await page.getByLabel(/Visibility filter/i).selectOption("all");
  await expect(assetText(page, "asset-image-1")).toBeVisible();

  const overlayState = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const overlay = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_overlays", "readonly");
      const request = tx.objectStore("vault_overlays").get("asset-image-1");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    const movies = await new Promise((resolve, reject) => {
      const openRequest = indexedDB.open("grok-power-tools");
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        const movieDb = openRequest.result;
        const tx = movieDb.transaction("movies", "readonly");
        const request = tx.objectStore("movies").getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          movieDb.close();
          resolve(request.result);
        };
      };
    });
    return { overlay, movieSourceAssetIds: movies.find((entry) => entry.name === "Vault Movie")?.clips.map((clip) => clip.sourceAssetId) };
  });
  expect(overlayState.overlay).toMatchObject({
    assetId: "asset-image-1",
    favorite: true,
    hidden: true,
    notes: "Use this for the first scene.",
    tags: ["keeper", "glass"],
  });
  expect(overlayState.movieSourceAssetIds).toEqual(["asset-video-1"]);
});

test("Vault bulk selection uses local favorite and hide actions", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();

  await page.getByLabel(/Select asset-video-1/i).check();
  await page.getByLabel(/Select asset-image-1/i).check();
  await expect(page.getByText(/2 selected/i)).toBeVisible();
  await page.getByRole("button", { name: /Favorite selected/i }).click();
  await page.getByRole("button", { name: /Hide selected locally/i }).click();
  await expect(assetText(page, "asset-video-1")).toHaveCount(0);
  await expect(assetText(page, "asset-image-1")).toHaveCount(0);

  const bulkState = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const overlays = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_overlays", "readonly");
      const request = tx.objectStore("vault_overlays").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return {
      favoriteAssetIds: overlays.filter((entry) => entry.favorite).map((entry) => entry.assetId).sort(),
      hiddenAssetIds: overlays.filter((entry) => entry.hidden).map((entry) => entry.assetId).sort(),
    };
  });
  expect(bulkState.favoriteAssetIds).toEqual(["asset-image-1", "asset-video-1"]);
  expect(bulkState.hiddenAssetIds).toEqual(["asset-image-1", "asset-video-1"]);
});

test("Vault assets can become a collection and watch queue", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  const addButtons = page.getByRole("button", { name: /Add to Collection/i });
  await addButtons.nth(0).click();
  await addButtons.nth(1).click();

  let collectionState = null;
  await expect
    .poll(async () => {
      collectionState = await readNewCollectionState(page);
      const itemIds = collectionState?.itemIds || [];
      return {
        assetIds: collectionState?.assetIds || [],
        mediaTypes: collectionState?.mediaTypes || [],
        itemCount: itemIds.length,
        uniqueItemCount: new Set(itemIds).size,
      };
    })
    .toEqual({
      assetIds: ["asset-image-1", "asset-video-1"],
      mediaTypes: ["image", "video"],
      itemCount: 2,
      uniqueItemCount: 2,
    });
  expect(collectionState).not.toBeNull();
  if (!collectionState) {
    throw new Error("New Collection state was not persisted");
  }
  expect(collectionState).toEqual({
    itemIds: expect.any(Array),
    assetIds: ["asset-image-1", "asset-video-1"],
    mediaTypes: ["image", "video"],
  });
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

test("Movie Maker can persist mixed image and video clips from Vault", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  const addButtons = page.getByRole("button", { name: /Add to Collection/i });
  await addButtons.nth(0).click();
  await addButtons.nth(1).click();
  await waitForNewCollectionItems(page, 2);
  await page.getByRole("link", { name: /Collections/i }).click();
  await page.getByRole("button", { name: /Watch All/i }).click();
  await page.getByRole("button", { name: /Save as Movie/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await expect(page.getByText(/2 clips/i)).toBeVisible();
  await expect(assetText(page, "asset-image-1")).toBeVisible();
  const range = page.locator('input[type="range"]');
  await range.evaluate((input) => {
    input.value = "5.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(async () =>
      page.locator("canvas").evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return 0;
        const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        return r + g + b;
      }),
    )
    .toBeGreaterThan(0);
});

test("Movie Maker source picker preserves Vault source assets", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  const addButtons = page.getByRole("button", { name: /Add to Collection/i });
  await addButtons.nth(0).click();
  await addButtons.nth(1).click();
  await waitForNewCollectionItems(page, 2);
  await page.goto("/movie");
  await page.getByRole("button", { name: /New Movie/i }).first().click();
  await page.getByRole("button", { name: /Add Clip/i }).click();
  await page.getByRole("button", { name: /New Collection/i }).click();
  await page.getByText(/glass library/i).click();
  await page.getByText(/cinematic neon canyon/i).click();
  await page.getByRole("button", { name: /Add 2 clips/i }).click();
  await expect(page.getByText(/2 clips/i)).toBeVisible();
  const pickerMovieState = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
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
    const movie = movies.find((entry) => entry.name === "Untitled Movie");
    return {
      clipTypes: movie.clips.map((clip) => clip.type).sort(),
      sourceAssetIds: movie.clips.map((clip) => clip.sourceAssetId).sort(),
    };
  });
  expect(pickerMovieState.clipTypes).toEqual(["image", "video"]);
  expect(pickerMovieState.sourceAssetIds).toEqual(["asset-image-1", "asset-video-1"]);
});

test("Prompt library includes Vault prompts after commit", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("prompts", "readwrite");
    tx.objectStore("prompts").put({
      id: "local-duplicate-prompt",
      text: "  A cinematic   neon canyon flythrough.  ",
      tags: ["local"],
      usageCount: 10,
      createdAt: "2026-06-17T00:00:00.000Z",
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByRole("button", { name: /Prompts/i }).click();
  const promptLibrary = page.locator(".fixed.inset-0").filter({ hasText: "Prompt Library" });
  await expect(promptLibrary.getByText(/cinematic\s+neon canyon/i)).toBeVisible();
  await expect(promptLibrary.getByText(/quiet glass library/i)).toBeVisible();
  await expect(promptLibrary.locator("p").filter({ hasText: /cinematic\s+neon canyon/i })).toHaveCount(1);
  await promptLibrary.getByPlaceholder(/Search prompts/i).fill("vault");
  await expect(promptLibrary.getByText(/cinematic\s+neon canyon/i)).toBeVisible();
  await expect(promptLibrary.getByTitle("Delete")).toHaveCount(0);
});

test("Ops shows Vault proof and does not mark Worker health as object proof", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("sync_meta", "readwrite");
    tx.objectStore("sync_meta").put({
      lastSyncAt: "2026-06-18T14:00:00.000Z",
      lastPushAt: "2026-06-18T14:05:00.000Z",
      deviceId: "local-device-ops",
    }, "sync-state");
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto("/ops");
  await expect(page.getByRole("heading", { name: /Vault Ops Proof/i })).toBeVisible();
  await expect(page.getByLabel(/Worker service fake-grok-r2-backup/i)).toBeVisible();
  await expect(page.getByLabel(/Health endpoint verified/i)).toBeVisible();
  await expect(page.getByLabel(/Worker host 127\.0\.0\.1/i)).toBeVisible();
  await expect(page.getByLabel(/Key prefix grok-powertools\/v1/i)).toBeVisible();
  await expect(page.getByLabel(/R2 preview 3 assets/i)).toBeVisible();
  await expect(page.getByLabel(/Committed locally 3 assets/i)).toBeVisible();
  await expect(page.getByLabel(/Metadata proof 2 prompts/i)).toBeVisible();
  await expect(page.getByLabel(/Latest import committed/i)).toBeVisible();
  await expect(page.getByLabel(/Open gaps 2 gaps/i)).toBeVisible();
  await expect(page.getByLabel(/Owner mode local IndexedDB/i)).toBeVisible();
  await expect(page.getByLabel(/Auth signed out/i)).toBeVisible();
  await expect(page.getByLabel(/Last sync 6\/18\/2026/i)).toBeVisible();
  await expect(page.getByLabel(/Last push 6\/18\/2026/i)).toBeVisible();
  await expect(page.getByText(/Worker health is not object proof/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Gap Fill Requires Approval/i })).toBeDisabled();
});
