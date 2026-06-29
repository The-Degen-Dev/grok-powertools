const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

async function expectReviewReady(page) {
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByRole("button", { name: "asset-video-1", exact: true })).toBeVisible();
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
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByLabel(/trimmed/i)).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByLabel(/muted in mix/i)).toBeVisible();
});

test("Focus mode supports Enter to keep and Escape to return to Review", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expectReviewReady(page);
  await page.keyboard.press("Digit2");
  await expect(page.getByRole("region", { name: /Focus Loupe/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review/i })).toHaveAttribute("aria-pressed", "true");
});
