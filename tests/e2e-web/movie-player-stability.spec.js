const { test, expect } = require("@playwright/test");

async function seedMovie(page) {
  await page.goto("/movie");
  await page.getByRole("button", { name: /New Movie/i }).first().waitFor();
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const now = new Date().toISOString();
    const movie = {
      id: "movie-playback-stability",
      name: "Playback Stability",
      resolution: { w: 320, h: 240 },
      clips: [
        {
          id: "clip-1",
          type: "video",
          videoUrl:
            "/api/vault/media/asset-video-1?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-1.mp4",
          sourceAssetId: "asset-video-1",
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
        {
          id: "clip-2",
          type: "video",
          videoUrl:
            "/api/vault/media/asset-video-2?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-2.mp4",
          sourceAssetId: "asset-video-2",
          transition: { type: "cut", duration: 0 },
          position: 1,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("movies", "readwrite");
      const request = tx.objectStore("movies").put(movie);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return movie.id;
  });
}

test("Movie Maker playback does not seek the active video every frame", async ({ page }) => {
  const movieId = await seedMovie(page);
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    window.__movieSeekWrites = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        window.__movieSeekWrites += 1;
        descriptor.set.call(this, value);
      },
    });
  });
  await page.goto(`/movie?id=${movieId}`);
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForTimeout(1600);
  const seekWrites = await page.evaluate(() => window.__movieSeekWrites);
  expect(seekWrites).toBeLessThan(12);
});

test("Movie Maker scrubbing still updates the canvas", async ({ page }) => {
  const movieId = await seedMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  const range = page.locator('input[type="range"]');
  await range.evaluate((input) => {
    input.value = "1";
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
