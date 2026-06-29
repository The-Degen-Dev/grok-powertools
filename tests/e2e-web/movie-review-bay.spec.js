const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

async function expectReviewReady(page) {
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-1", exact: true })).toBeVisible();
}

async function readActiveReviewProject(page, movieId) {
  return page.evaluate(async (targetMovieId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(["movie_review_projects"], "readonly");
      const request = tx.objectStore("movie_review_projects").index("by-movie").getAll(targetMovieId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }, movieId);
}

async function seedMovieVersion(page, movieId) {
  await page.evaluate(async (targetMovieId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const project = await new Promise((resolve, reject) => {
      const tx = db.transaction(["movie_review_projects"], "readonly");
      const request = tx.objectStore("movie_review_projects").index("by-movie").getAll(targetMovieId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () =>
        resolve(request.result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]);
    });
    const timestamp = new Date().toISOString();
    if (!project.committedClips[0]) {
      throw new Error("Expected a committed clip before seeding a saved movie version");
    }
    const versionClip = {
      ...project.committedClips[0],
      id: "version-clip-b",
      sourceAssetId: "asset-video-2",
      mediaRef: { type: "vault", assetId: "asset-video-2" },
      videoUrl: "/api/vault/media/asset-video-2",
      position: 9,
    };
    const tx = db.transaction(["movie_versions"], "readwrite");
    tx.objectStore("movie_versions").put({
      id: "version-current",
      movieId: targetMovieId,
      projectId: project.id,
      name: "Version B",
      description: "Project-scoped version",
      clips: [versionClip],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    tx.objectStore("movie_versions").put({
      id: "version-stale",
      movieId: targetMovieId,
      projectId: "project-stale",
      name: "Stale Other Project",
      description: "Should not show in this project",
      clips: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, movieId);
}

test("Review Bay first viewport exposes operator regions", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Drafts and Director/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
});

test("Keyboard keep and reject move candidates into the right lanes", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.getByRole("button", { name: /Back to movies/i }).click();
  await expect(page).toHaveURL(/\/movie$/);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.keyboard.press("KeyX");
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-2").first()).toBeVisible();
  await page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-2", exact: true }).click();
  await page.keyboard.press("KeyX");
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-2")).toHaveCount(0);
});

test("Review Bay keeps Candidates Grid separate from committed Clip Strip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-1")).toHaveCount(0);
});

test("Inspector updates trim and audio state for selected committed clip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await page.getByLabel(/Trim in/i).fill("0.4");
  await page.getByLabel(/Trim out/i).fill("1.4");
  await page.getByLabel(/Clip volume/i).fill("0.5");
  await page.getByRole("button", { name: /Mute clip/i }).click();
  await page.getByRole("button", { name: /Solo clip/i }).click();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByRole("img", { name: /trimmed/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByRole("img", { name: /muted in mix/i })).toBeVisible();
  await page.waitForTimeout(400);
  const project = await readActiveReviewProject(page, movieId);
  expect(project.committedClips[0]).toMatchObject({
    trimStartSeconds: 0.4,
    trimEndSeconds: 1.4,
    volume: 0.5,
    muted: true,
    solo: true,
  });
  await page.reload();
  await expect(page.getByLabel(/Trim in/i)).toHaveValue("0.4");
  await expect(page.getByRole("region", { name: /Inspector/i }).getByRole("button", { name: /Unmute clip/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i }).getByRole("button", { name: /Unsolo clip/i })).toBeVisible();
});

test("Focus mode supports Enter to keep and Escape to return to Review", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("Digit2");
  await expect(page.getByRole("region", { name: /Focus Loupe/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await expect(page.getByRole("region", { name: /Focus Loupe/i }).getByText("asset-video-2").first()).toBeVisible();
  await page.keyboard.press("KeyX");
  await expect(page.getByRole("region", { name: /Focus Loupe/i }).getByText(/No candidate in focus/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review/i })).toHaveAttribute("aria-pressed", "true");
});

test("Draft Queue applies only project-scoped versions with repaired selection", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.waitForTimeout(400);
  await seedMovieVersion(page, movieId);
  await page.reload();
  await expect(page.getByRole("button", { name: /Version B/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Stale Other Project/i })).toHaveCount(0);
  await page.getByRole("button", { name: /Version B/i }).click();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-2").first()).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i }).getByText("asset-video-2")).toBeVisible();
});

test("Assemble mode shows continuous preview, ribbon, waveform controls, and audio lane", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await page.keyboard.press("Digit3");
  await expect(page.getByRole("region", { name: /Clip preview/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Time-proportional ribbon/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim in/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim out/i })).toBeVisible();
  await expect(page.getByText(/Source audio/i)).toBeVisible();
});

test("Review Bay remains usable at phone width", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Focus/i })).toBeVisible();
});

test("Review Bay status indicators have accessible names", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await expect(page.getByLabel(/lifecycle kept/i).first()).toBeVisible();
});
