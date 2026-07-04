async function seedReviewMovie(page, options = {}) {
  await page.goto("/movie");
  await page.getByRole("button", { name: /New Movie/i }).first().waitFor();
  return page.evaluate(async ({ useAudioFixture = false } = {}) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const movieId = `movie-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const suffix = useAudioFixture ? "audio-" : "";
    const now = new Date().toISOString();
    const movie = {
      id: movieId,
      name: "Seeded Review Movie",
      resolution: { w: 1080, h: 1920 },
      clips: [
        {
          id: "clip-a",
          type: "video",
          videoUrl: `/api/vault/media/asset-video-${suffix}1`,
          sourceAssetId: `asset-video-${suffix}1`,
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
        {
          id: "clip-b",
          type: "video",
          videoUrl: `/api/vault/media/asset-video-${suffix}2`,
          sourceAssetId: `asset-video-${suffix}2`,
          transition: { type: "cut", duration: 0 },
          position: 1,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["movies"], "readwrite");
      tx.objectStore("movies").put(movie);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return movieId;
  }, options);
}

module.exports = { seedReviewMovie };
