const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { seedReviewMovie } = require("./support/movie-fixtures");

test.setTimeout(240000);

async function expectReviewReady(page) {
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "Select Clip 1" }).first()).toBeVisible();
}

test("Export pre-flight blocks unresolved candidates and enables clean cut", async ({ page }) => {
  const movieId = await seedReviewMovie(page, { useAudioFixture: true });
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  const exportBlocked = page.getByRole("button", { name: /Export blocked/i });
  await expect(exportBlocked).toBeEnabled();
  await exportBlocked.click();
  await expect(page.getByText(/Resolve before export/i)).toBeVisible();
  await expect(page.getByText("2 candidates still awaiting keep or reject.")).toBeVisible();
  await page.keyboard.press("KeyK");
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("button", { name: /^Export movie$/i })).toBeEnabled();
});

test("Movie export creates MP4 with an audio stream and keeps WebM fallback", async ({ page }, testInfo) => {
  const movieId = await seedReviewMovie(page, { useAudioFixture: true });
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("KeyK");
  await page.keyboard.press("KeyK");
  await page.getByRole("button", { name: /^Export movie$/i }).click();
  await page.getByRole("button", { name: /Load export engine/i }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 180000 }),
    page.getByRole("button", { name: /Export MP4/i }).click(),
  ]);
  const outputPath = path.join(testInfo.outputDir, "review-bay-export.mp4");
  await download.saveAs(outputPath);
  const codec = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", outputPath],
    { encoding: "utf8" },
  ).trim();
  expect(codec).toBe("aac");
  const [webmDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 180000 }),
    page.getByRole("button", { name: /Export WebM/i }).click(),
  ]);
  const webmPath = path.join(testInfo.outputDir, "review-bay-export.webm");
  await webmDownload.saveAs(webmPath);
  expect(fs.statSync(webmPath).size).toBeGreaterThan(0);
});
